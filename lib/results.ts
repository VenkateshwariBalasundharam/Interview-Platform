// Final results (server only): the weighted Result per candidate, the Manager score, the admin's decision and the export.
// The rules themselves are in lib/final-result.ts.
import { prisma } from '@/lib/db';
import { audit } from '@/lib/audit';
import { enqueueEmailsSafely } from '@/lib/email';
import { emailKeys } from '@/lib/email-core';
import { err } from '@/lib/http';
import { ROUND_LIBRARY, ROUND_TYPES, type RoundType } from '@/lib/pipeline';
import { isAiGradedRound } from '@/lib/round-engine';
import { buildCandidatePdf, buildResultsPdf } from '@/lib/results-pdf';
import {
  buildResultsCsv,
  computeFinalResult,
  type Decision,
  type ExportRow,
  type FinalResult,
  type ResultInput,
  type Suggestion,
} from '@/lib/final-result';

export { decisionBodySchema, exportQuerySchema, managerScoreSchema } from '@/lib/final-result';

type RoundRow = { roundType: RoundType; position: number; enabled: boolean; weight: number; cutoffPercent: number; required: boolean };
type AttemptRow = { roundType: RoundType; status: string; percent: number | null };
type HumanRow = { roundType: RoundType; score: number };

function toInput(status: ResultInput['candidateStatus'], rounds: RoundRow[], attempts: AttemptRow[], human: HumanRow[]): ResultInput {
  return {
    candidateStatus: status,
    rounds: [...rounds]
      .filter((r) => r.enabled)
      .sort((a, b) => a.position - b.position)
      .map((r) => {
        const lib = ROUND_LIBRARY[r.roundType];
        const attempt = attempts.find((a) => a.roundType === r.roundType);
        const scored = lib.humanScored ? human.find((h) => h.roundType === r.roundType)?.score ?? null : attempt && attempt.status === 'GRADED' ? attempt.percent : null;
        return {
          roundType: r.roundType,
          label: lib.label,
          weight: r.weight,
          cutoffPercent: r.cutoffPercent,
          required: r.required,
          aiGraded: isAiGradedRound(r.roundType),
          percent: scored,
        };
      }),
  };
}

const ROUND_SELECT = { roundType: true, position: true, enabled: true, weight: true, cutoffPercent: true, required: true } as const;

/**
 * Recomputes and stores a candidate's Result. Call it whenever a round is graded, a Manager score is saved or a flag is
 * reviewed. An admin's final decision is never touched here. Marks the candidate COMPLETED once every required round has a score.
 */
export async function recomputeResult(candidateId: string): Promise<FinalResult | null> {
  const candidate = await prisma.candidate.findUnique({
    where: { id: candidateId },
    select: {
      status: true,
      job: { select: { rounds: { select: ROUND_SELECT } } },
      attempts: { select: { roundType: true, status: true, percent: true } },
      humanScores: { select: { roundType: true, score: true } },
      result: { select: { finalDecision: true } },
    },
  });
  if (!candidate) return null;

  const computed = computeFinalResult(toInput(candidate.status, candidate.job.rounds, candidate.attempts, candidate.humanScores));
  if (computed.suggestion === null) return computed;

  await prisma.result.upsert({
    where: { candidateId },
    create: { candidateId, weightedScore: computed.weightedScore, suggestedDecision: computed.suggestion, pendingHumanReview: true },
    update: { weightedScore: computed.weightedScore, suggestedDecision: computed.suggestion, pendingHumanReview: candidate.result?.finalDecision == null },
  });
  if (computed.complete && candidate.status === 'ACTIVE') {
    await prisma.candidate.updateMany({ where: { id: candidateId, status: 'ACTIVE' }, data: { status: 'COMPLETED' } });
  }
  return computed;
}

/** For the places that grade or review: a failure here must never break the request that triggered it. */
export async function refreshResultSafely(candidateId: string): Promise<void> {
  try {
    await recomputeResult(candidateId);
  } catch (e) {
    console.error('Result refresh failed', { name: e instanceof Error ? e.name : 'UnknownError' });
  }
}

// ───────────────────────── Manager round ─────────────────────────

/** The admin's score for the live Manager interview, 0 to 100. Saving again replaces the earlier score. */
export async function saveManagerScore(candidateId: string, input: { score: number; notes?: string }, adminId: string) {
  const candidate = await prisma.candidate.findUnique({
    where: { id: candidateId },
    select: {
      status: true,
      job: { select: { rounds: { select: ROUND_SELECT } } },
      attempts: { select: { roundType: true, status: true } },
      humanScores: { select: { roundType: true } },
    },
  });
  if (!candidate) throw err.notFound('Candidate not found', 'CANDIDATE_NOT_FOUND');

  const rounds = [...candidate.job.rounds].filter((r) => r.enabled).sort((a, b) => a.position - b.position);
  const manager = rounds.find((r) => ROUND_LIBRARY[r.roundType].humanScored);
  if (!manager) throw err.conflict('This job has no live interview round.', 'NO_MANAGER_ROUND');
  if (candidate.status === 'DISQUALIFIED') throw err.conflict('This candidate is not continuing, so there is no interview to score.', 'CANDIDATE_CLOSED');

  const earlier = rounds.filter((r) => r.position < manager.position);
  const unfinished = earlier.filter((r) => !candidate.attempts.some((a) => a.roundType === r.roundType && a.status === 'GRADED'));
  if (unfinished.length > 0) {
    throw err.conflict(`The candidate has not finished: ${unfinished.map((r) => ROUND_LIBRARY[r.roundType].label).join(', ')}.`, 'EARLIER_ROUNDS_INCOMPLETE');
  }

  const existed = candidate.humanScores.some((h) => h.roundType === manager.roundType);
  await prisma.humanScore.upsert({
    where: { candidateId_roundType: { candidateId, roundType: manager.roundType } },
    create: { candidateId, roundType: manager.roundType, score: input.score, notes: input.notes || null, adminId },
    update: { score: input.score, notes: input.notes || null, adminId },
  });
  // Notes can name the candidate's answers; the audit trail keeps only the number.
  await audit({ actorType: 'ADMIN', actorId: adminId, action: existed ? 'MANAGER_SCORE_UPDATED' : 'MANAGER_SCORE_SAVED', entity: 'Candidate', entityId: candidateId, meta: { score: input.score } });
  await refreshResultSafely(candidateId);
  return { score: input.score };
}

// ───────────────────────── Decision ─────────────────────────

/** An admin confirms the suggestion or overrides it. Can be changed later; every change is audited. */
export async function decideResult(candidateId: string, input: { decision: Decision; note?: string }, adminId: string) {
  await recomputeResult(candidateId); // make sure the suggestion the admin is looking at is current
  const result = await prisma.result.findUnique({ where: { candidateId }, select: { suggestedDecision: true, finalDecision: true } });
  if (!result) throw err.conflict('There is no result to decide yet. The candidate has not finished the interview.', 'NO_RESULT');

  await prisma.result.update({
    where: { candidateId },
    data: { finalDecision: input.decision, decidedBy: adminId, decidedAt: new Date(), pendingHumanReview: false },
  });
  await audit({
    actorType: 'ADMIN',
    actorId: adminId,
    action: result.finalDecision ? 'RESULT_DECISION_CHANGED' : 'RESULT_DECIDED',
    entity: 'Candidate',
    entityId: candidateId,
    meta: {
      decision: input.decision,
      suggested: result.suggestedDecision,
      overrode: result.suggestedDecision !== input.decision,
      previous: result.finalDecision,
      ...(input.note ? { note: input.note } : {}),
    },
  });
  // One neutral "your result is ready" email per candidate, whichever way the decision went; changing the decision later sends nothing more.
  await enqueueEmailsSafely([{ candidateId, kind: 'RESULT_READY', dedupeKey: emailKeys.resultReady(candidateId) }]);
  return { decision: input.decision, overrode: result.suggestedDecision !== input.decision };
}

// ───────────────────────── Admin views ─────────────────────────

export interface CandidateResultView {
  result: FinalResult;
  finalDecision: Decision | null;
  decidedAt: string | null;
  decidedByName: string | null;
  /** The live suggestion differs from what was stored (a score changed after the admin decided). */
  managerRound: { exists: boolean; score: number | null; notes: string | null; canScore: boolean; blockedReason: string | null };
}

export async function getCandidateResult(candidateId: string): Promise<CandidateResultView> {
  const candidate = await prisma.candidate.findUnique({
    where: { id: candidateId },
    select: {
      status: true,
      job: { select: { rounds: { select: ROUND_SELECT } } },
      attempts: { select: { roundType: true, status: true, percent: true } },
      humanScores: { select: { roundType: true, score: true, notes: true } },
      result: { select: { finalDecision: true, decidedAt: true, decidedBy: true } },
    },
  });
  if (!candidate) throw err.notFound('Candidate not found', 'CANDIDATE_NOT_FOUND');

  const result = computeFinalResult(toInput(candidate.status, candidate.job.rounds, candidate.attempts, candidate.humanScores));
  const rounds = [...candidate.job.rounds].filter((r) => r.enabled).sort((a, b) => a.position - b.position);
  const manager = rounds.find((r) => ROUND_LIBRARY[r.roundType].humanScored);
  const human = manager ? candidate.humanScores.find((h) => h.roundType === manager.roundType) : undefined;

  let blockedReason: string | null = null;
  if (manager) {
    if (candidate.status === 'DISQUALIFIED') blockedReason = 'The candidate is not continuing.';
    else {
      const unfinished = rounds.filter((r) => r.position < manager.position && !candidate.attempts.some((a) => a.roundType === r.roundType && a.status === 'GRADED'));
      if (unfinished.length > 0) blockedReason = `Waiting for: ${unfinished.map((r) => ROUND_LIBRARY[r.roundType].label).join(', ')}.`;
    }
  }

  const decider = candidate.result?.decidedBy ? await prisma.adminUser.findUnique({ where: { id: candidate.result.decidedBy }, select: { name: true } }) : null;
  return {
    result,
    finalDecision: (candidate.result?.finalDecision as Decision | null | undefined) ?? null,
    decidedAt: candidate.result?.decidedAt?.toISOString() ?? null,
    decidedByName: decider?.name ?? null,
    managerRound: { exists: Boolean(manager), score: human?.score ?? null, notes: human?.notes ?? null, canScore: Boolean(manager) && blockedReason === null, blockedReason },
  };
}

export interface ResultListRow {
  id: string;
  candidateCode: string;
  name: string;
  email: string;
  jobTitle: string;
  status: string;
  weightedScore: number | null;
  suggestion: Suggestion | null;
  finalDecision: Decision | null;
  rejectionRestsOnAi: boolean;
  proctorEvents: number;
  roundPercents: Record<string, number | null>;
}

const LIST_LIMIT = 500;

export async function listResults(jobId?: string): Promise<ResultListRow[]> {
  const candidates = await prisma.candidate.findMany({
    where: jobId ? { jobId } : undefined,
    orderBy: { createdAt: 'desc' },
    take: LIST_LIMIT,
    select: {
      id: true,
      candidateCode: true,
      name: true,
      email: true,
      status: true,
      job: { select: { title: true, rounds: { select: ROUND_SELECT } } },
      attempts: { select: { roundType: true, status: true, percent: true } },
      humanScores: { select: { roundType: true, score: true } },
      result: { select: { finalDecision: true } },
    },
  });
  const counts = await prisma.proctorEvent.groupBy({ by: ['candidateId'], where: { candidateId: { in: candidates.map((c) => c.id) } }, _count: { _all: true } });
  const events = new Map(counts.map((c) => [c.candidateId, c._count._all]));

  const rows = candidates.map((c) => {
    const input = toInput(c.status, c.job.rounds, c.attempts, c.humanScores);
    const result = computeFinalResult(input);
    const roundPercents: Record<string, number | null> = {};
    for (const r of input.rounds) roundPercents[r.roundType] = r.percent;
    return {
      id: c.id,
      candidateCode: c.candidateCode,
      name: c.name,
      email: c.email,
      jobTitle: c.job.title,
      status: c.status,
      weightedScore: result.suggestion === null && !c.attempts.length ? null : result.weightedScore,
      suggestion: result.suggestion,
      finalDecision: (c.result?.finalDecision as Decision | null | undefined) ?? null,
      rejectionRestsOnAi: result.rejectionRestsOnAi,
      proctorEvents: events.get(c.id) ?? 0,
      roundPercents,
    };
  });
  return rows;
}

export async function exportResultsCsv(jobId?: string, adminId?: string): Promise<string> {
  const rows = await listResults(jobId);
  const labels = Object.fromEntries(ROUND_TYPES.map((t) => [t, ROUND_LIBRARY[t].label]));
  const exportRows: ExportRow[] = rows.map((r) => ({ ...r, job: r.jobTitle }));
  if (adminId) await audit({ actorType: 'ADMIN', actorId: adminId, action: 'RESULTS_EXPORTED', meta: { rows: rows.length, jobScoped: Boolean(jobId) } });
  return buildResultsCsv(exportRows, labels);
}

/** The results table as a PDF, optionally for one job. Same rows as the CSV, so the two exports always agree. */
export async function exportResultsPdf(jobId?: string, adminId?: string): Promise<Buffer> {
  const rows = await listResults(jobId);
  const labels = Object.fromEntries(ROUND_TYPES.map((t) => [t, ROUND_LIBRARY[t].label]));
  const exportRows: ExportRow[] = rows.map((r) => ({ ...r, job: r.jobTitle }));
  let heading = 'All jobs';
  if (jobId) {
    const job = await prisma.job.findUnique({ where: { id: jobId }, select: { title: true } });
    if (!job) throw err.notFound('Job not found', 'JOB_NOT_FOUND');
    heading = job.title;
  }
  if (adminId) await audit({ actorType: 'ADMIN', actorId: adminId, action: 'RESULTS_EXPORTED', meta: { rows: rows.length, jobScoped: Boolean(jobId), format: 'pdf' } });
  return buildResultsPdf({ heading, rows: exportRows, roundLabels: labels, generatedAt: new Date() });
}

/** A single candidate's result sheet as a PDF. Contains scores and the decision only: no answers, resume text or DOB. */
export async function exportCandidateResultPdf(candidateId: string, adminId?: string): Promise<{ pdf: Buffer; candidateCode: string }> {
  const candidate = await prisma.candidate.findUnique({
    where: { id: candidateId },
    select: { candidateCode: true, name: true, email: true, status: true, job: { select: { title: true } } },
  });
  if (!candidate) throw err.notFound('Candidate not found', 'CANDIDATE_NOT_FOUND');
  const [view, proctorEvents] = await Promise.all([getCandidateResult(candidateId), prisma.proctorEvent.count({ where: { candidateId } })]);
  if (adminId) await audit({ actorType: 'ADMIN', actorId: adminId, action: 'RESULT_PDF_EXPORTED', entity: 'Candidate', entityId: candidateId });
  const pdf = buildCandidatePdf({
    candidateCode: candidate.candidateCode,
    name: candidate.name,
    email: candidate.email,
    jobTitle: candidate.job.title,
    status: candidate.status,
    result: view.result,
    finalDecision: view.finalDecision,
    decidedAt: view.decidedAt,
    decidedByName: view.decidedByName,
    proctorEvents,
    generatedAt: new Date(),
  });
  return { pdf, candidateCode: candidate.candidateCode };
}
