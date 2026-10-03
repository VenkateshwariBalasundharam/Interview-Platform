// Proctoring database operations (server only). Pure rules live in lib/proctoring-core.ts.
import { Prisma } from '@prisma/client';
import type { CandidateSession } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { prisma } from '@/lib/db';
import { err } from '@/lib/http';
import { ROUND_LIBRARY, type ProctoringLevel, type RoundType } from '@/lib/pipeline';
import {
  MAX_EVENTS_PER_ATTEMPT,
  limitReachedAt,
  summarizeEvents,
  tabSwitchMessage,
  tabSwitchStatus,
  toStoredEvent,
  type EventCounts,
  type ProctorBatch,
  type ReportEvent,
  type TabSwitchStatus,
} from '@/lib/proctoring-core';
import { consumeRateLimit } from '@/lib/ratelimit';
import { SUBMIT_GRACE_SECONDS, isPastGrace } from '@/lib/round-engine';
import { finalizeAttempt } from '@/lib/rounds';

export { proctorBatchSchema } from '@/lib/proctoring-core';

const REQUESTS_PER_MINUTE = 60;

export interface RecordResult {
  recorded: number;
  dropped: number;
  /** Only present when the round has a tab-switch limit. */
  tabSwitches?: TabSwitchStatus & { message: string | null };
  /** The tab-switch limit was reached by this batch and the round has been submitted. */
  ended?: boolean;
}

/** Ends the round the same way the Submit button does, so grading, cutoffs and the audit log behave as for a normal submit. */
async function endRoundForLimit(attemptId: string, roundType: RoundType, max: number, now: Date): Promise<void> {
  await finalizeAttempt(attemptId, now);
  await audit({ actorType: 'SYSTEM', action: 'ROUND_ENDED_TAB_SWITCH_LIMIT', entity: 'Attempt', entityId: attemptId, meta: { roundType, limit: max } });
}

/** How many tab switches this attempt has used so far. The server's count is the only one that matters. */
export async function countTabSwitches(attemptId: string): Promise<number> {
  return prisma.proctorEvent.count({ where: { attemptId, type: 'TAB_SWITCH' } });
}

/**
 * Stores events sent by the candidate's browser for a round that is currently running.
 *  - 404 if the round was never started, 409 once it has ended (submitted, graded or past its grace window).
 *  - A round whose proctoring is Off stores nothing and answers 200 with recorded: 0.
 *  - Never changes a score, a flag or a decision. Events are signals for the admin.
 *  - One exception: if the round has a tab-switch limit and this batch uses up the last switch, the round is submitted
 *    exactly as if the candidate had pressed Submit. What they answered so far is graded as usual.
 */
export async function recordProctorEvents(
  candidate: Pick<CandidateSession, 'id' | 'jobId'>,
  roundType: RoundType,
  batch: ProctorBatch,
  now = new Date(),
): Promise<RecordResult> {
  const limit = await consumeRateLimit(`proctor:${candidate.id}`, REQUESTS_PER_MINUTE, 60_000);
  if (!limit.allowed) throw err.tooMany(limit.retryAfterSec);

  const attempt = await prisma.attempt.findUnique({
    where: { candidateId_roundType: { candidateId: candidate.id, roundType } },
    select: { id: true, status: true, startedAt: true, deadlineAt: true },
  });
  if (!attempt) throw err.notFound('You have not started this round.', 'ATTEMPT_NOT_FOUND');
  if (attempt.status !== 'IN_PROGRESS' || isPastGrace(attempt.deadlineAt, now, SUBMIT_GRACE_SECONDS)) {
    throw err.conflict('This round has already ended.', 'ATTEMPT_ENDED');
  }

  const config = await prisma.roundConfig.findUnique({
    where: { jobId_roundType: { jobId: candidate.jobId, roundType } },
    select: { proctoringLevel: true, maxTabSwitches: true },
  });
  if (!config || config.proctoringLevel === 'OFF') return { recorded: 0, dropped: batch.events.length };
  const max = config.maxTabSwitches;

  // Switches stored so far. Counted from the database, so a tampered browser cannot lower it.
  const usedBefore = max > 0 ? await countTabSwitches(attempt.id) : 0;

  // The limit was already used up by an earlier batch whose submit did not finish (for example a database error).
  // Finish it now instead of storing the same events twice when the browser retries.
  if (max > 0 && usedBefore >= max) {
    await endRoundForLimit(attempt.id, roundType, max, now);
    const status = tabSwitchStatus(usedBefore, max);
    return { recorded: 0, dropped: batch.events.length, tabSwitches: { ...status, message: tabSwitchMessage(status) }, ended: true };
  }

  // The per-attempt cap never hides a tab switch while a limit is on, or the limit could be dodged by filling the cap first.
  let room = Math.max(0, MAX_EVENTS_PER_ATTEMPT - (await prisma.proctorEvent.count({ where: { attemptId: attempt.id } })));
  const accepted = batch.events.filter((event) => {
    if (event.type === 'TAB_SWITCH' && max > 0) return true;
    if (room <= 0) return false;
    room -= 1;
    return true;
  });

  // The event that uses up the last allowed switch ends the round. Anything after it in the batch is not stored.
  const endedAt = limitReachedAt(accepted.map((e) => e.type), usedBefore, max);
  const toStore = endedAt === -1 ? accepted : accepted.slice(0, endedAt + 1);

  if (toStore.length > 0) {
    await prisma.proctorEvent.createMany({
      data: toStore.map((event, i) => {
        const stored = toStoredEvent(event, now, attempt.startedAt);
        const meta = i === endedAt ? { ...(stored.meta ?? {}), limitReached: true } : stored.meta;
        return {
          candidateId: candidate.id,
          attemptId: attempt.id,
          roundType,
          type: stored.type,
          occurredAt: stored.occurredAt,
          meta: meta === null ? Prisma.DbNull : meta,
        };
      }),
    });
  }

  const result: RecordResult = { recorded: toStore.length, dropped: batch.events.length - toStore.length };
  if (max <= 0) return result;

  const status = tabSwitchStatus(usedBefore + toStore.filter((e) => e.type === 'TAB_SWITCH').length, max);
  if (status.reached) await endRoundForLimit(attempt.id, roundType, max, now);
  return { ...result, tabSwitches: { ...status, message: tabSwitchMessage(status) }, ended: status.reached };
}

// ───────────────────────── Admin report ─────────────────────────

export interface ProctorRoundReport {
  roundType: RoundType;
  label: string;
  level: ProctoringLevel;
  counts: EventCounts;
  events: ReportEvent[];
}

/**
 * One entry per round the admin can learn something from: rounds that are proctored and were started,
 * plus any round that has events. Rounds with proctoring off and no events are left out.
 */
export async function getProctoringReport(candidateId: string): Promise<ProctorRoundReport[]> {
  const candidate = await prisma.candidate.findUnique({ where: { id: candidateId }, select: { jobId: true } });
  if (!candidate) throw err.notFound('Candidate not found', 'CANDIDATE_NOT_FOUND');

  const [rounds, attempts, events] = await Promise.all([
    prisma.roundConfig.findMany({
      where: { jobId: candidate.jobId },
      orderBy: { position: 'asc' },
      select: { roundType: true, proctoringLevel: true },
    }),
    prisma.attempt.findMany({ where: { candidateId }, select: { roundType: true, startedAt: true } }),
    prisma.proctorEvent.findMany({
      where: { candidateId },
      orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
      select: { id: true, roundType: true, type: true, occurredAt: true, meta: true },
    }),
  ]);

  const reports: ProctorRoundReport[] = [];
  for (const round of rounds as { roundType: RoundType; proctoringLevel: ProctoringLevel }[]) {
    const attempt = (attempts as { roundType: RoundType; startedAt: Date }[]).find((a) => a.roundType === round.roundType);
    const own = (events as { id: string; roundType: RoundType; type: string; occurredAt: Date; meta: unknown }[]).filter((e) => e.roundType === round.roundType);
    const proctoredAndStarted = round.proctoringLevel !== 'OFF' && !!attempt;
    if (!proctoredAndStarted && own.length === 0) continue;

    const summary = summarizeEvents(own, attempt?.startedAt ?? null);
    reports.push({ roundType: round.roundType, label: ROUND_LIBRARY[round.roundType].label, level: round.proctoringLevel, counts: summary.counts, events: summary.events });
  }
  return reports;
}
