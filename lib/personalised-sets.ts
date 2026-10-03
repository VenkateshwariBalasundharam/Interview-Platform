// Database operations for per-candidate (resume-personalised) question sets (server only).
// Editing, approving and locking one candidate's set reuses the functions in question-sets.ts.
import type { Prisma } from '@prisma/client';
import { audit } from '@/lib/audit';
import { prisma } from '@/lib/db';
import { err } from '@/lib/http';
import { ROUND_LIBRARY } from '@/lib/pipeline';
import {
  countStates,
  resumeSupports,
  toResumeContext,
  type CandidateSetState,
  type PersonalisedRound,
  type SetCounts,
} from '@/lib/personalisation';
import { generateQuestions } from '@/lib/question-generation';
import { assertDraft, assertSetEditable, toAdminQuestion, toRow, type RoundQuestionSet } from '@/lib/question-sets';
import { validateSetForApproval, type SetStatus } from '@/lib/questions';
import { parsedResumeSchema } from '@/lib/resume-parse';

export type BulkAction = 'approve' | 'lock';

export interface PersonalisedRow {
  candidateId: string;
  candidateCode: string;
  name: string;
  state: CandidateSetState;
  /** Why no set can be generated yet (only when state is NO_RESUME). */
  reason: string | null;
  setId: string | null;
  questionCount: number;
  version: number | null;
  /** The candidate has already started this round, so the set is frozen. */
  started: boolean;
}

export interface PersonalisedOverview {
  roundType: PersonalisedRound;
  label: string;
  requiredQuestions: number;
  rows: PersonalisedRow[];
  counts: SetCounts;
}

function noResumeReason(roundType: PersonalisedRound, hasResume: boolean): string {
  if (!hasResume) return 'No parsed resume. This candidate gets the job-wide questions.';
  return roundType === 'TECHNICAL'
    ? 'No skills found in the resume. This candidate gets the job-wide questions.'
    : 'No projects found in the resume. This candidate gets the job-wide questions.';
}

export async function getPersonalisedOverview(jobId: string, roundType: PersonalisedRound): Promise<PersonalisedOverview> {
  const round = await prisma.roundConfig.findFirst({ where: { jobId, roundType }, select: { questionCount: true } });
  if (!round) throw err.notFound(`This job has no ${ROUND_LIBRARY[roundType].label} round.`, 'ROUND_NOT_FOUND');

  const [candidates, sets, attempts] = await Promise.all([
    prisma.candidate.findMany({ where: { jobId }, orderBy: { candidateCode: 'asc' }, select: { id: true, candidateCode: true, name: true, resumeParsed: true } }),
    prisma.questionSet.findMany({
      where: { jobId, roundType, candidateId: { not: null } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, candidateId: true, status: true, version: true, _count: { select: { questions: true } } },
    }),
    prisma.attempt.findMany({ where: { roundType, candidate: { jobId } }, select: { candidateId: true } }),
  ]);

  const latest = new Map<string, (typeof sets)[number]>();
  for (const set of sets) if (set.candidateId && !latest.has(set.candidateId)) latest.set(set.candidateId, set); // newest first
  const started = new Set(attempts.map((a) => a.candidateId));

  const rows: PersonalisedRow[] = candidates.map((c) => {
    const parsed = parsedResumeSchema.safeParse(c.resumeParsed);
    const set = latest.get(c.id) ?? null;
    const usable = resumeSupports(roundType, parsed.success ? parsed.data : null);
    const state: CandidateSetState = set ? (set.status as SetStatus) : usable ? 'NOT_GENERATED' : 'NO_RESUME';
    return {
      candidateId: c.id,
      candidateCode: c.candidateCode,
      name: c.name,
      state,
      reason: state === 'NO_RESUME' ? noResumeReason(roundType, parsed.success) : null,
      setId: set?.id ?? null,
      questionCount: set?._count.questions ?? 0,
      version: set?.version ?? null,
      started: started.has(c.id),
    };
  });

  return {
    roundType,
    label: ROUND_LIBRARY[roundType].label,
    requiredQuestions: round.questionCount,
    rows,
    counts: countStates(rows.map((r) => r.state)),
  };
}

/** Generates (or regenerates, while still a draft) one candidate's set from their parsed resume. */
export async function generateCandidateSet(candidateId: string, roundType: PersonalisedRound, adminId: string) {
  const candidate = await prisma.candidate.findUnique({
    where: { id: candidateId },
    select: { id: true, jobId: true, resumeParsed: true, job: { select: { title: true, tier: true, jdText: true, requiredSkills: true, rounds: true } } },
  });
  if (!candidate) throw err.notFound('Candidate not found', 'CANDIDATE_NOT_FOUND');
  const label = ROUND_LIBRARY[roundType].label;
  const round = candidate.job.rounds.find((r) => r.roundType === roundType);
  if (!round) throw err.notFound(`This job has no ${label} round. Add it to the pipeline first.`, 'ROUND_NOT_FOUND');

  const parsed = parsedResumeSchema.safeParse(candidate.resumeParsed);
  if (!parsed.success || !resumeSupports(roundType, parsed.data)) {
    throw err.badRequest(`${noResumeReason(roundType, parsed.success)} Upload and parse a resume with ${roundType === 'TECHNICAL' ? 'skills' : 'projects'} first.`, 'RESUME_NOT_READY');
  }

  const scope = { jobId: candidate.jobId, roundType, candidateId };
  await assertSetEditable(scope);
  const before = await prisma.questionSet.findFirst({ where: scope, orderBy: { createdAt: 'desc' }, select: { status: true } });
  if (before) assertDraft(before.status as SetStatus);

  // The slow part: runs before any database write so no transaction is held open while waiting on the model.
  const { questions, requested } = await generateQuestions({
    title: candidate.job.title,
    tier: candidate.job.tier,
    jdText: candidate.job.jdText,
    requiredSkills: candidate.job.requiredSkills,
    roundType,
    difficulty: round.difficulty,
    count: round.questionCount,
    resume: toResumeContext(parsed.data),
  });
  const rows = questions.map((q, i) => toRow(q, i + 1));

  const { setId, version } = await prisma.$transaction(
    async (tx) => {
      // Read again inside the transaction: the draft may have been approved, or a second click may have created one.
      const current = await tx.questionSet.findFirst({ where: scope, orderBy: { createdAt: 'desc' }, select: { id: true, status: true } });
      if (current) {
        if (current.status !== 'DRAFT') throw err.conflict('This question set changed while generating. Reload and try again.', 'SET_NOT_DRAFT');
        await tx.question.deleteMany({ where: { setId: current.id } });
        const updated = await tx.questionSet.update({ where: { id: current.id }, data: { version: { increment: 1 } }, select: { version: true } });
        await tx.question.createMany({ data: rows.map((r) => ({ ...r, setId: current.id })) });
        return { setId: current.id, version: updated.version };
      }
      const created = await tx.questionSet.create({ data: { ...scope, questions: { create: rows } }, select: { id: true, version: true } });
      return { setId: created.id, version: created.version };
    },
    { timeout: 20_000 },
  );

  await audit({
    actorType: 'ADMIN',
    actorId: adminId,
    action: 'QUESTION_SET_GENERATED',
    entity: 'QuestionSet',
    entityId: setId,
    meta: { roundType, candidateId, requested, created: questions.length, version, personalised: true },
  });
  return { setId, version, requested, created: questions.length };
}

/** Removes a candidate's draft so they go back to the job-wide questions. Approved and locked sets are never removed. */
export async function discardCandidateSet(candidateId: string, roundType: PersonalisedRound, adminId: string) {
  const candidate = await prisma.candidate.findUnique({ where: { id: candidateId }, select: { id: true, jobId: true } });
  if (!candidate) throw err.notFound('Candidate not found', 'CANDIDATE_NOT_FOUND');
  const scope = { jobId: candidate.jobId, roundType, candidateId };
  const latest = await prisma.questionSet.findFirst({ where: scope, orderBy: { createdAt: 'desc' }, select: { id: true, status: true } });
  if (!latest) throw err.notFound('This candidate has no personalised questions.', 'SET_NOT_FOUND');
  assertDraft(latest.status as SetStatus);

  const result = await prisma.questionSet.deleteMany({ where: { ...scope, status: 'DRAFT' } });
  await audit({ actorType: 'ADMIN', actorId: adminId, action: 'QUESTION_SET_DISCARDED', entity: 'QuestionSet', entityId: latest.id, meta: { roundType, candidateId, removed: result.count } });
  return { removed: result.count };
}

export interface BulkResult {
  changed: number;
  skipped: { candidateCode: string; reason: string }[];
}

/**
 * Approves every valid draft (or locks every approved set) for one round of a job, in one go.
 * A draft that fails the same checks as a single approval, or whose candidate has already started, is skipped and reported.
 */
export async function bulkTransition(jobId: string, roundType: PersonalisedRound, action: BulkAction, adminId: string): Promise<BulkResult> {
  const round = await prisma.roundConfig.findFirst({ where: { jobId, roundType }, select: { questionCount: true } });
  if (!round) throw err.notFound(`This job has no ${ROUND_LIBRARY[roundType].label} round.`, 'ROUND_NOT_FOUND');

  const from: SetStatus = action === 'approve' ? 'DRAFT' : 'APPROVED';
  const sets = await prisma.questionSet.findMany({
    where: { jobId, roundType, candidateId: { not: null }, status: from },
    include: { questions: { orderBy: { position: 'asc' } } },
  });
  // Only the newest set per candidate counts; an older leftover is ignored.
  const newest = new Map<string, (typeof sets)[number]>();
  for (const set of [...sets].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())) {
    if (set.candidateId && !newest.has(set.candidateId)) newest.set(set.candidateId, set);
  }
  const ids = [...newest.keys()];
  const [candidates, attempts] = await Promise.all([
    prisma.candidate.findMany({ where: { id: { in: ids } }, select: { id: true, candidateCode: true } }),
    action === 'approve' ? prisma.attempt.findMany({ where: { roundType, candidateId: { in: ids } }, select: { candidateId: true } }) : Promise.resolve([]),
  ]);
  const code = new Map(candidates.map((c) => [c.id, c.candidateCode]));
  const started = new Set(attempts.map((a) => a.candidateId));

  const ready: string[] = [];
  const skipped: BulkResult['skipped'] = [];
  for (const [candidateId, set] of newest) {
    const label = code.get(candidateId) ?? candidateId;
    if (action === 'approve') {
      if (started.has(candidateId)) {
        skipped.push({ candidateCode: label, reason: 'Already started this round' });
        continue;
      }
      const issues = validateSetForApproval(set.questions, round.questionCount);
      if (issues.length > 0) {
        skipped.push({ candidateCode: label, reason: issues[0] });
        continue;
      }
    }
    ready.push(set.id);
  }

  const data: Prisma.QuestionSetUpdateManyMutationInput = { status: action === 'approve' ? 'APPROVED' : 'LOCKED', ...(action === 'lock' ? { lockedAt: new Date() } : {}) };
  // The status is part of the write, so a set changed by someone else in the meantime is left alone.
  const result = ready.length > 0 ? await prisma.questionSet.updateMany({ where: { id: { in: ready }, status: from }, data }) : { count: 0 };

  await audit({
    actorType: 'ADMIN',
    actorId: adminId,
    action: action === 'approve' ? 'QUESTION_SETS_BULK_APPROVED' : 'QUESTION_SETS_BULK_LOCKED',
    entity: 'Job',
    entityId: jobId,
    meta: { roundType, changed: result.count, skipped: skipped.length },
  });
  return { changed: result.count, skipped };
}

/** One candidate's set for the review page, in the same shape the job-wide question panel uses. */
export async function getCandidateSetView(candidateId: string, roundType: PersonalisedRound) {
  const candidate = await prisma.candidate.findUnique({
    where: { id: candidateId },
    select: { id: true, candidateCode: true, name: true, jobId: true, job: { select: { title: true, rounds: true } } },
  });
  if (!candidate) throw err.notFound('Candidate not found', 'CANDIDATE_NOT_FOUND');
  const round = candidate.job.rounds.find((r) => r.roundType === roundType);
  if (!round) throw err.notFound(`This job has no ${ROUND_LIBRARY[roundType].label} round.`, 'ROUND_NOT_FOUND');

  const [set, started] = await Promise.all([
    prisma.questionSet.findFirst({
      where: { jobId: candidate.jobId, roundType, candidateId },
      orderBy: { createdAt: 'desc' },
      include: { questions: { orderBy: { position: 'asc' } } },
    }),
    prisma.attempt.count({ where: { candidateId, roundType } }),
  ]);

  const panel: RoundQuestionSet = {
    roundType,
    label: ROUND_LIBRARY[roundType].label,
    enabled: round.enabled,
    questionCount: round.questionCount,
    difficulty: round.difficulty,
    set: set && {
      id: set.id,
      status: set.status as SetStatus,
      version: set.version,
      lockedAt: set.lockedAt ? set.lockedAt.toISOString() : null,
      questions: set.questions.map(toAdminQuestion),
    },
  };
  return {
    candidate: { id: candidate.id, code: candidate.candidateCode, name: candidate.name, jobId: candidate.jobId, jobTitle: candidate.job.title },
    round: panel,
    started: started > 0,
  };
}
