// Admin round reset (server only). The rules are in lib/round-reset.ts.
import { audit } from '@/lib/audit';
import { prisma } from '@/lib/db';
import { getEnv } from '@/lib/env';
import { err } from '@/lib/http';
import { ROUND_LIBRARY, type RoundType } from '@/lib/pipeline';
import { refreshResultSafely } from '@/lib/results';
import { planRoundReset } from '@/lib/round-reset';
import { deletePrivate } from '@/lib/storage';

/**
 * Throws away one candidate's attempt for one round so they can start it again with a fresh timer.
 *
 * Removed: the attempt, its answers and coding submissions, and that attempt's proctoring events and snapshots.
 * Also removed: the stored Result (it was computed from the old score; any final decision on it no longer applies) and the
 * job-fit summary (the admin can generate a new one). Kept: the candidate, their other rounds, their resume and the question set.
 * The audit log records who did it, why, and what the discarded attempt looked like (numbers only, never answers).
 */
export async function resetCandidateRound(candidateId: string, roundType: RoundType, input: { reason: string }, adminId: string) {
  const aiCanDisqualify = getEnv().AI_GRADING_CAN_DISQUALIFY === 'true';

  // Reads first, outside the transaction: a remote database makes every query slow, and an interactive transaction that
  // runs several of them can hit Prisma's 5 second limit. The writes below are one batch with no such limit.
  const candidate = await prisma.candidate.findUnique({
    where: { id: candidateId },
    select: {
      status: true,
      job: { select: { rounds: { select: { roundType: true, position: true, enabled: true, humanScored: true, cutoffPercent: true, cutoffMode: true } } } },
      attempts: { select: { id: true, roundType: true, status: true, score: true, maxScore: true, percent: true } },
      result: { select: { finalDecision: true } },
    },
  });
  if (!candidate) throw err.notFound('Candidate not found', 'CANDIDATE_NOT_FOUND');

  const plan = planRoundReset({
    candidateStatus: candidate.status,
    rounds: candidate.job.rounds.map((r) => ({ ...r, label: ROUND_LIBRARY[r.roundType].label })),
    attempts: candidate.attempts,
    target: roundType,
    aiCanDisqualify,
  });
  if (!plan.ok) throw plan.httpStatus === 404 ? err.notFound(plan.message, plan.code) : err.conflict(plan.message, plan.code);

  const attempt = candidate.attempts.find((a) => a.roundType === roundType)!;
  const snapshots = await prisma.proctorSnapshot.findMany({ where: { event: { attemptId: attempt.id } }, select: { storageKey: true } });

  // All-or-nothing: either every one of these happens or none does. Snapshot rows go with their events, and answers and
  // coding answers go with the attempt (both are ON DELETE CASCADE).
  const [events] = await prisma.$transaction([
    prisma.proctorEvent.deleteMany({ where: { attemptId: attempt.id } }),
    prisma.attempt.delete({ where: { id: attempt.id } }),
    prisma.result.deleteMany({ where: { candidateId } }),
    prisma.fitSummary.deleteMany({ where: { candidateId } }),
    ...(plan.statusChanges ? [prisma.candidate.update({ where: { id: candidateId }, data: { status: plan.nextStatus } })] : []),
  ]);

  const outcome = {
    plan,
    previousStatus: candidate.status,
    files: snapshots.map((s) => s.storageKey),
    discarded: { status: attempt.status, percent: attempt.percent, proctorEvents: events.count },
    hadFinalDecision: candidate.result?.finalDecision ?? null,
  };

  // Snapshot images are removed after the commit. One that cannot be removed is left for the retention clean-up, never an error.
  await Promise.all(outcome.files.map((key) => deletePrivate(key).catch(() => undefined)));

  await audit({
    actorType: 'ADMIN',
    actorId: adminId,
    action: 'ROUND_RESET',
    entity: 'Candidate',
    entityId: candidateId,
    meta: {
      roundType,
      reason: input.reason,
      discardedStatus: outcome.discarded.status,
      discardedPercent: outcome.discarded.percent,
      discardedProctorEvents: outcome.discarded.proctorEvents,
      previousCandidateStatus: outcome.previousStatus,
      newCandidateStatus: outcome.plan.nextStatus,
      discardedFinalDecision: outcome.hadFinalDecision,
    },
  });
  await refreshResultSafely(candidateId); // an optional round can leave a still-complete result; this rebuilds it without the old decision
  return { roundType, roundLabel: outcome.plan.roundLabel, status: outcome.plan.nextStatus };
}
