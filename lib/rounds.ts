// Database operations for candidates taking rounds (server only).
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { MAX_ANSWER_CHARS, answerBodySchema, cleanAnswerText, isOpenKind, type AnswerBody } from '@/lib/answer-input';
import type { CandidateSession } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { buildCodingView, codingTotals, pickProblemIdsForRound } from '@/lib/coding-rounds';
import { prisma } from '@/lib/db';
import { getEnv } from '@/lib/env';
import { MANUAL_REVIEW_MARK, gradeOpenAnswers, needsHumanReview, type GradeInput } from '@/lib/grading-ai';
import { gradeHrAnswers } from '@/lib/hr-rubric';
import { AppError, err } from '@/lib/http';
import { chooseSet, isPersonalisedRound } from '@/lib/personalisation';
import { ROUND_LIBRARY, ROUND_TYPES, type RoundType } from '@/lib/pipeline';
import { consumeRateLimit } from '@/lib/ratelimit';
import { refreshResultSafely } from '@/lib/results';
import { ROUND_KINDS, isGeneratedRound, rubricSchema, type SetStatus } from '@/lib/questions';
import {
  SUBMIT_GRACE_SECONDS,
  blockedReason,
  computeDeadline,
  computeRoundStates,
  decideOutcome,
  effectiveCutoffMode,
  isAiGradedRound,
  isPastDeadline,
  isPastGrace,
  orderQuestions,
  readChoice,
  readText,
  scoreWithoutAi,
  secondsLeft,
  toCandidateQuestion,
  totalScores,
  type CandidateStatusName,
  type ExamView,
  type RoundInfo,
  type RoundPageState,
  type RoundResult,
  type RoundState,
} from '@/lib/round-engine';

export { answerBodySchema };

/** Whether an AI-graded score is allowed to disqualify by itself. Off unless the deployment opts in. */
function aiCanDisqualify(): boolean {
  return getEnv().AI_GRADING_CAN_DISQUALIFY === 'true';
}

export function parseRoundType(value: string): RoundType {
  const parsed = z.enum(ROUND_TYPES).safeParse(value);
  if (!parsed.success) throw err.notFound('This round does not exist', 'ROUND_NOT_FOUND');
  return parsed.data;
}

// ───────────────────────── Shared loading ─────────────────────────

type RoundRow = Awaited<ReturnType<typeof prisma.roundConfig.findMany>>[number];

function toRoundInfo(r: Pick<RoundRow, 'roundType' | 'position' | 'durationMinutes' | 'questionCount' | 'humanScored' | 'proctoringLevel' | 'maxTabSwitches' | 'blockPaste'>): RoundInfo {
  return {
    roundType: r.roundType,
    label: ROUND_LIBRARY[r.roundType].label,
    position: r.position,
    durationMinutes: r.durationMinutes,
    questionCount: r.questionCount,
    humanScored: r.humanScored,
    aiGraded: isAiGradedRound(r.roundType),
    proctored: r.proctoringLevel !== 'OFF',
    maxTabSwitches: r.proctoringLevel !== 'OFF' ? r.maxTabSwitches : 0,
    blockPaste: r.proctoringLevel !== 'OFF' && r.blockPaste,
  };
}

function toResult(
  attempt: { roundType: RoundType; status: string; score: number | null; maxScore: number | null; percent: number | null },
  round: Pick<RoundRow, 'cutoffPercent' | 'cutoffMode'>,
): RoundResult | null {
  if (attempt.status !== 'GRADED' || attempt.score === null || attempt.maxScore === null || attempt.percent === null) return null;
  return {
    score: attempt.score,
    maxScore: attempt.maxScore,
    percent: attempt.percent,
    verdict: decideOutcome({
      score: attempt.score,
      maxScore: attempt.maxScore,
      cutoffPercent: round.cutoffPercent,
      cutoffMode: effectiveCutoffMode(round.cutoffMode, attempt.roundType, aiCanDisqualify()),
    }),
  };
}

/** Attempts whose timer and grace window have run out are graded whenever the candidate next loads anything. */
async function finalizeExpired(candidateId: string) {
  const stale = await prisma.attempt.findMany({
    where: { candidateId, status: 'IN_PROGRESS', deadlineAt: { lt: new Date(Date.now() - SUBMIT_GRACE_SECONDS * 1000) } },
    select: { id: true },
  });
  for (const a of stale) await finalizeAttempt(a.id);
}

async function loadPipeline(candidate: Pick<CandidateSession, 'id' | 'jobId'>) {
  await finalizeExpired(candidate.id);
  const [rounds, attempts, current] = await Promise.all([
    prisma.roundConfig.findMany({ where: { jobId: candidate.jobId, enabled: true }, orderBy: { position: 'asc' } }),
    prisma.attempt.findMany({ where: { candidateId: candidate.id } }),
    prisma.candidate.findUniqueOrThrow({ where: { id: candidate.id }, select: { status: true } }),
  ]);
  const states = computeRoundStates({
    rounds: rounds.map((r) => ({ roundType: r.roundType, humanScored: r.humanScored })),
    attempts: attempts.map((a) => ({ roundType: a.roundType, status: a.status })),
    candidateStatus: current.status,
  });
  return { rounds, attempts, status: current.status as CandidateStatusName, states };
}

/** Adds how many tab switches a running round has used. Skipped when the round has no limit. */
async function withTabSwitchCount(attemptId: string, info: RoundInfo): Promise<RoundInfo> {
  if (info.maxTabSwitches <= 0) return info;
  const used = await prisma.proctorEvent.count({ where: { attemptId, type: 'TAB_SWITCH' } });
  return { ...info, tabSwitchesUsed: used };
}

// ───────────────────────── Dashboard ─────────────────────────

export interface DashboardRound extends RoundInfo {
  state: RoundState;
  result: RoundResult | null;
}

export async function getCandidateRounds(candidate: Pick<CandidateSession, 'id' | 'jobId'>) {
  const ctx = await loadPipeline(candidate);
  const rounds: DashboardRound[] = ctx.rounds.map((r, i) => {
    const attempt = ctx.attempts.find((a) => a.roundType === r.roundType);
    return { ...toRoundInfo(r), state: ctx.states[i].state, result: attempt ? toResult(attempt, r) : null };
  });
  return { status: ctx.status, rounds };
}

// ───────────────────────── One round's page ─────────────────────────

async function buildExamView(
  attempt: { id: string; roundType: RoundType; seed: string | null; deadlineAt: Date },
  round: RoundRow,
  now: Date,
): Promise<ExamView> {
  // Only these columns are read. The answer key and rubric are never loaded for a candidate.
  const rows = await prisma.answer.findMany({
    where: { attemptId: attempt.id },
    orderBy: { question: { position: 'asc' } },
    select: { response: true, question: { select: { id: true, kind: true, prompt: true, points: true, options: true } } },
  });
  const ordered = orderQuestions(attempt.roundType, rows, attempt.seed);
  const choices: Record<string, number> = {};
  const texts: Record<string, string> = {};
  for (const row of ordered) {
    if (row.question.kind === 'MCQ') {
      const choice = readChoice(row.response);
      if (choice !== null) choices[row.question.id] = choice;
    } else {
      const text = readText(row.response);
      if (text) texts[row.question.id] = text;
    }
  }
  return {
    round: toRoundInfo(round),
    secondsLeft: secondsLeft(attempt.deadlineAt, now),
    questions: ordered.map((row) => toCandidateQuestion(row.question)),
    choices,
    texts,
  };
}

export async function getRoundPage(candidate: Pick<CandidateSession, 'id' | 'jobId'>, roundType: RoundType, now = new Date()): Promise<RoundPageState> {
  const ctx = await loadPipeline(candidate);
  const index = ctx.rounds.findIndex((r) => r.roundType === roundType);
  if (index === -1) throw err.notFound('This round is not part of your interview', 'ROUND_NOT_FOUND');
  const round = ctx.rounds[index];
  const state = ctx.states[index].state;
  const attempt = ctx.attempts.find((a) => a.roundType === roundType);

  if (state === 'IN_PROGRESS' && attempt) {
    if (roundType === 'CODING') {
      const info = await withTabSwitchCount(attempt.id, toRoundInfo(round));
      return { phase: 'coding', coding: await buildCodingView(attempt.id, info, attempt.deadlineAt, now) };
    }
    const exam = await buildExamView(attempt, round, now);
    return { phase: 'exam', exam: { ...exam, round: await withTabSwitchCount(attempt.id, exam.round) } };
  }
  if (state === 'GRADING') return { phase: 'grading', round: toRoundInfo(round) };
  if (state === 'DONE' && attempt) {
    const result = toResult(attempt, round);
    if (result) {
      const next = ctx.states[index + 1];
      return {
        phase: 'result',
        round: toRoundInfo(round),
        result,
        nextRoundType: next && (next.state === 'AVAILABLE' || next.state === 'IN_PROGRESS') ? next.roundType : null,
      };
    }
  }
  return { phase: 'intro', round: toRoundInfo(round), canStart: state === 'AVAILABLE', blockedReason: blockedReason(state) };
}

// ───────────────────────── Starting ─────────────────────────

export async function startRound(candidate: Pick<CandidateSession, 'id' | 'jobId'>, roundType: RoundType) {
  const now = new Date();
  const ctx = await loadPipeline(candidate);
  const index = ctx.rounds.findIndex((r) => r.roundType === roundType);
  if (index === -1) throw err.notFound('This round is not part of your interview', 'ROUND_NOT_FOUND');
  const round = ctx.rounds[index];
  const state = ctx.states[index].state;

  if (state === 'IN_PROGRESS') return getRoundPage(candidate, roundType, now); // resume, never restart the clock
  if (state === 'DONE') throw err.conflict('You have already completed this round.', 'ROUND_ALREADY_DONE');
  if (state !== 'AVAILABLE') throw err.conflict(blockedReason(state) ?? 'This round is not available.', state === 'CLOSED' ? 'ROUND_CLOSED' : 'ROUND_LOCKED');

  if (roundType === 'CODING') {
    // Same problems for every candidate. Creating the answer rows pins exactly which problems this candidate was given.
    const problemIds = await pickProblemIdsForRound(candidate.jobId, round);
    try {
      await prisma.attempt.create({
        data: {
          candidateId: candidate.id,
          roundType,
          startedAt: now,
          deadlineAt: computeDeadline(now, round.durationMinutes),
          seed: randomUUID(),
          codingAnswers: { create: problemIds.map((problemId, position) => ({ problemId, position })) },
        },
      });
    } catch (e) {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
      return getRoundPage(candidate, roundType, now);
    }
    await audit({ actorType: 'CANDIDATE', actorId: candidate.id, action: 'ROUND_STARTED', entity: 'Candidate', entityId: candidate.id, meta: { roundType } });
    return getRoundPage(candidate, roundType, now);
  }

  // The first N questions of the approved set, in position order. A candidate with their own resume-personalised set
  // (Technical and HR) gets that one; everyone else gets the job-wide set, so those candidates share the same questions.
  const questionSelect = { orderBy: { position: 'asc' as const }, take: round.questionCount, select: { id: true, kind: true } };
  const own = isPersonalisedRound(roundType)
    ? await prisma.questionSet.findFirst({
        where: { jobId: candidate.jobId, roundType, candidateId: candidate.id },
        orderBy: { createdAt: 'desc' },
        select: { status: true, questions: questionSelect },
      })
    : null;
  const choice = chooseSet(own as { status: SetStatus } | null);
  // A personalised draft the admin has not approved yet: wait for it rather than quietly handing out the shared questions.
  if (choice === 'pending') throw err.conflict('This round is not ready yet. Please contact the hiring team.', 'ROUND_NOT_READY');
  const set =
    choice === 'own'
      ? own
      : await prisma.questionSet.findFirst({
          where: { jobId: candidate.jobId, roundType, candidateId: null, status: { in: ['APPROVED', 'LOCKED'] } },
          orderBy: { createdAt: 'desc' },
          select: { questions: questionSelect },
        });
  const allowedKinds: readonly string[] = isGeneratedRound(roundType) ? ROUND_KINDS[roundType] : [];
  if (!set || set.questions.length < round.questionCount || !set.questions.every((q) => allowedKinds.includes(q.kind))) {
    throw err.conflict('This round is not ready yet. Please contact the hiring team.', 'ROUND_NOT_READY');
  }

  try {
    // Creating the answer rows here pins exactly which questions this candidate was given.
    await prisma.attempt.create({
      data: {
        candidateId: candidate.id,
        roundType,
        startedAt: now,
        deadlineAt: computeDeadline(now, round.durationMinutes),
        seed: randomUUID(),
        answers: { create: set.questions.map((q) => ({ questionId: q.id })) },
      },
    });
  } catch (e) {
    // A double click or second tab started it first: carry on with that attempt.
    if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
    return getRoundPage(candidate, roundType, now);
  }

  await audit({ actorType: 'CANDIDATE', actorId: candidate.id, action: 'ROUND_STARTED', entity: 'Candidate', entityId: candidate.id, meta: { roundType } });
  return getRoundPage(candidate, roundType, now);
}

// ───────────────────────── Autosave ─────────────────────────

export async function saveAnswer(candidate: Pick<CandidateSession, 'id'>, roundType: RoundType, input: AnswerBody) {
  const now = new Date();
  const attempt = await prisma.attempt.findUnique({
    where: { candidateId_roundType: { candidateId: candidate.id, roundType } },
    select: { id: true, status: true, deadlineAt: true },
  });
  if (!attempt) throw err.notFound('You have not started this round.', 'ATTEMPT_NOT_FOUND');
  if (attempt.status !== 'IN_PROGRESS') throw err.conflict('This round has already been submitted.', 'ATTEMPT_ENDED');
  if (isPastGrace(attempt.deadlineAt, now)) {
    await finalizeAttempt(attempt.id);
    throw err.conflict('Time is up. Your round was submitted automatically.', 'ATTEMPT_ENDED');
  }

  // Also proves the question belongs to this candidate's attempt.
  const row = await prisma.answer.findUnique({
    where: { attemptId_questionId: { attemptId: attempt.id, questionId: input.questionId } },
    select: { question: { select: { kind: true, options: true } } },
  });
  if (!row) throw err.notFound('That question is not part of this round.', 'QUESTION_NOT_FOUND');

  let response: Prisma.InputJsonValue | typeof Prisma.DbNull;
  if ('choice' in input) {
    if (row.question.kind !== 'MCQ') throw err.badRequest('This question needs a written answer.', 'WRONG_ANSWER_TYPE');
    const optionCount = Array.isArray(row.question.options) ? row.question.options.length : 0;
    if (input.choice !== null && input.choice >= optionCount) throw err.badRequest('That option does not exist.', 'INVALID_CHOICE');
    response = input.choice === null ? Prisma.DbNull : { choice: input.choice };
  } else {
    const kind = row.question.kind;
    if (!isOpenKind(kind)) throw err.badRequest('This question is multiple choice.', 'WRONG_ANSWER_TYPE');
    const text = cleanAnswerText(input.text);
    if (text.length > MAX_ANSWER_CHARS[kind]) {
      throw err.badRequest(`Answers to this question are limited to ${MAX_ANSWER_CHARS[kind]} characters.`, 'ANSWER_TOO_LONG');
    }
    response = text === '' ? Prisma.DbNull : { text };
  }

  // The status is part of the write itself, so an answer cannot slip in after the round was submitted.
  const result = await prisma.answer.updateMany({
    where: { attemptId: attempt.id, questionId: input.questionId, attempt: { status: 'IN_PROGRESS' } },
    data: { response },
  });
  if (result.count === 0) throw err.conflict('This round has already been submitted.', 'ATTEMPT_ENDED');
  return { saved: true, serverTime: now.toISOString() };
}

// ───────────────────────── Submitting and grading ─────────────────────────
//
// Grading happens in three steps so that no database transaction is ever held open while waiting for the AI:
//   1. finalizeAttempt      Claims the attempt (SUBMITTED / AUTO_SUBMITTED), scores every MCQ and every empty answer.
//                           If nothing needs the AI it finishes the round right there.
//   2. gradePendingAnswers  Sends the remaining typed answers to the AI and saves each score (first write wins).
//   3. completeAttempt      Once every answer has a score: totals, GRADED, cutoff decision. The status-guarded claim means
//                           it happens exactly once, however many callers race.
// A round whose typed answers could not be graded stays in the GRADING state (blocking the next round) and is retried
// by the candidate's grading screen, or by an admin's "Grade now".

type Tx = Prisma.TransactionClient;

export async function submitRound(candidate: Pick<CandidateSession, 'id' | 'jobId'>, roundType: RoundType) {
  const attempt = await prisma.attempt.findUnique({
    where: { candidateId_roundType: { candidateId: candidate.id, roundType } },
    select: { id: true, status: true },
  });
  if (!attempt) throw err.notFound('You have not started this round.', 'ATTEMPT_NOT_FOUND');
  if (attempt.status === 'IN_PROGRESS') await finalizeAttempt(attempt.id); // safe to repeat: only the first call claims it
  return getRoundPage(candidate, roundType);
}

interface Completed {
  candidateId: string;
  roundType: RoundType;
  verdict: 'PASSED' | 'DISQUALIFIED' | 'FLAGGED';
  percent: number;
  downgraded: boolean;
  needsReview: boolean;
}

/** Step 3, inside a transaction. Returns null if answers are still ungraded or another caller already finished the round. */
async function completeInTx(tx: Tx, attemptId: string): Promise<Completed | null> {
  const attempt = await tx.attempt.findUnique({
    where: { id: attemptId },
    select: { id: true, status: true, roundType: true, candidate: { select: { id: true, jobId: true } } },
  });
  if (!attempt || (attempt.status !== 'SUBMITTED' && attempt.status !== 'AUTO_SUBMITTED')) return null;

  // Coding is scored from each problem's best submission; every other round from its answers.
  const answers =
    attempt.roundType === 'CODING'
      ? []
      : await tx.answer.findMany({ where: { attemptId }, select: { score: true, feedback: true, question: { select: { points: true } } } });
  if (answers.some((a) => a.score === null)) return null;
  const totals =
    attempt.roundType === 'CODING'
      ? totalScores((await codingTotals(tx, attemptId)).items)
      : totalScores(answers.map((a) => ({ points: a.question.points, score: a.score ?? 0 })));

  const round = await tx.roundConfig.findFirst({ where: { jobId: attempt.candidate.jobId, roundType: attempt.roundType } });
  if (!round) throw new Error('Round configuration is missing');

  const claimed = await tx.attempt.updateMany({
    where: { id: attemptId, status: { in: ['SUBMITTED', 'AUTO_SUBMITTED'] } },
    data: { status: 'GRADED', score: totals.score, maxScore: totals.maxScore, percent: totals.percent },
  });
  if (claimed.count === 0) return null;

  const mode = effectiveCutoffMode(round.cutoffMode, attempt.roundType, aiCanDisqualify());
  const verdict = decideOutcome({ ...totals, cutoffPercent: round.cutoffPercent, cutoffMode: mode });
  const needsReview = answers.some((a) => needsHumanReview(a.feedback));

  if (verdict === 'DISQUALIFIED') {
    await tx.candidate.update({ where: { id: attempt.candidate.id }, data: { status: 'DISQUALIFIED' } });
  } else if (verdict === 'FLAGGED' || needsReview) {
    // A flag pauses this round for a human decision; the candidate can still carry on with later rounds.
    await tx.candidate.updateMany({ where: { id: attempt.candidate.id, status: 'ACTIVE' }, data: { status: 'PENDING_REVIEW' } });
  }
  return {
    candidateId: attempt.candidate.id,
    roundType: attempt.roundType,
    verdict,
    percent: totals.percent,
    downgraded: mode !== round.cutoffMode,
    needsReview,
  };
}

async function auditCompleted(attemptId: string, done: Completed) {
  await audit({
    actorType: 'SYSTEM',
    action: 'ROUND_GRADED',
    entity: 'Attempt',
    entityId: attemptId,
    meta: { roundType: done.roundType, verdict: done.verdict, percent: done.percent, aiDowngradedDisqualify: done.downgraded, needsReview: done.needsReview },
  });
  if (done.verdict === 'DISQUALIFIED') {
    await audit({ actorType: 'SYSTEM', action: 'CANDIDATE_DISQUALIFIED', entity: 'Candidate', entityId: done.candidateId, meta: { roundType: done.roundType } });
  }
  // Keep the weighted result current. A failure here never affects the round that was just graded.
  await refreshResultSafely(done.candidateId);
}

/** Step 3 on its own. Safe to call any number of times. */
async function completeAttempt(attemptId: string): Promise<boolean> {
  const done = await prisma.$transaction((tx) => completeInTx(tx, attemptId), { maxWait: 10_000, timeout: 20_000 });
  if (done) await auditCompleted(attemptId, done);
  return done !== null;
}

/**
 * Steps 1 (and 3 when no typed answers need the AI). Claims an in-progress attempt exactly once: a manual Submit racing the
 * auto-submit timer (or two tabs) cannot both claim it. Fast: it makes no AI call.
 */
export async function finalizeAttempt(attemptId: string, now = new Date()): Promise<void> {
  const claimed = await prisma.$transaction(
    async (tx) => {
      const attempt = await tx.attempt.findUnique({
        where: { id: attemptId },
        select: { id: true, status: true, roundType: true, deadlineAt: true, candidate: { select: { id: true } } },
      });
      if (!attempt || attempt.status !== 'IN_PROGRESS') return null;

      // A submit after the timer ran out counts as automatic and is stamped with the deadline itself.
      const auto = isPastDeadline(attempt.deadlineAt, now);
      const result = await tx.attempt.updateMany({
        where: { id: attemptId, status: 'IN_PROGRESS' },
        data: { status: auto ? 'AUTO_SUBMITTED' : 'SUBMITTED', submittedAt: auto ? attempt.deadlineAt : now },
      });
      if (result.count === 0) return null;

      const answers =
        attempt.roundType === 'CODING'
          ? [] // Coding has no Answer rows: its score comes from the best submissions already stored.
          : await tx.answer.findMany({
              where: { attemptId },
              select: { id: true, response: true, question: { select: { kind: true, points: true, correctIndex: true } } },
            });
      let pendingAi = 0;
      for (const a of answers) {
        const outcome = scoreWithoutAi({ id: a.id, ...a.question }, a.response);
        if (outcome.kind === 'needs-ai') pendingAi++;
        else await tx.answer.update({ where: { id: a.id }, data: { score: outcome.score, feedback: outcome.feedback } });
      }

      const completed = pendingAi === 0 ? await completeInTx(tx, attemptId) : null;
      return { candidateId: attempt.candidate.id, roundType: attempt.roundType, auto, pendingAi, completed };
    },
    { maxWait: 10_000, timeout: 20_000 },
  );
  if (!claimed) return;

  await audit({
    actorType: 'CANDIDATE',
    actorId: claimed.candidateId,
    action: 'ROUND_SUBMITTED',
    entity: 'Attempt',
    entityId: attemptId,
    meta: { roundType: claimed.roundType, auto: claimed.auto, awaitingAiGrading: claimed.pendingAi },
  });
  if (claimed.completed) await auditCompleted(attemptId, claimed.completed);
}

// Attempts being graded by this server process. Stops a double click, a second tab or React's dev double-effect from
// sending the same answers to the AI twice. (Across several server instances a rare duplicate call is harmless:
// saving a score never overwrites one that already exists.)
const gradingInFlight = new Set<string>();

export type GradingStatus = 'done' | 'pending' | 'busy';

/** Step 2 (then 3). Grades every typed answer that has no score yet. */
export async function gradePendingAnswers(attemptId: string): Promise<GradingStatus> {
  if (gradingInFlight.has(attemptId)) return 'busy';
  gradingInFlight.add(attemptId);
  try {
    const attempt = await prisma.attempt.findUnique({ where: { id: attemptId }, select: { status: true, roundType: true } });
    if (!attempt) throw err.notFound('Round not found', 'ATTEMPT_NOT_FOUND');
    if (attempt.status === 'GRADED') return 'done';
    // HR answers are rated on clarity, ownership, depth and communication instead of per-question key points.
    const isHr = attempt.roundType === 'HR';
    if (attempt.status === 'IN_PROGRESS') throw err.conflict('This round has not been submitted yet.', 'ROUND_NOT_SUBMITTED');

    const pending = await prisma.answer.findMany({
      where: { attemptId, score: null },
      select: { id: true, response: true, question: { select: { prompt: true, points: true, rubric: true } } },
    });

    const items: GradeInput[] = [];
    for (const p of pending) {
      const rubric = rubricSchema.safeParse(p.question.rubric);
      if (!rubric.success && !isHr) {
        // Approval checks rubrics, so this should not happen; if it does, a human decides rather than the round hanging.
        await prisma.answer.updateMany({
          where: { id: p.id, score: null },
          data: { score: 0, feedback: `${MANUAL_REVIEW_MARK} This question has no valid rubric.` },
        });
        continue;
      }
      items.push({
        id: p.id,
        points: p.question.points,
        prompt: p.question.prompt,
        keyPoints: rubric.success ? rubric.data.keyPoints : [],
        sampleAnswer: rubric.success ? rubric.data.sampleAnswer : '',
        answer: readText(p.response),
      });
    }

    const grade = isHr ? gradeHrAnswers : gradeOpenAnswers;
    const { graded, failed, firstError } = items.length > 0 ? await grade(items) : { graded: new Map(), failed: [], firstError: undefined };
    for (const [id, grade] of graded) {
      await prisma.answer.updateMany({ where: { id, score: null }, data: { score: grade.score, feedback: grade.feedback } });
    }

    if (failed.length > 0) {
      // Only the error code is recorded: messages from the AI client can mention configuration and must not reach candidates.
      await audit({
        actorType: 'SYSTEM',
        action: 'ROUND_GRADING_FAILED',
        entity: 'Attempt',
        entityId: attemptId,
        meta: { unfinished: failed.length, code: firstError instanceof AppError ? firstError.code : 'AI_BAD_OUTPUT' },
      });
    }
    const finished = await completeAttempt(attemptId);
    return finished || failed.length === 0 ? 'done' : 'pending';
  } finally {
    gradingInFlight.delete(attemptId);
  }
}

/**
 * The grading screen calls this until the round is graded. Rate limited per attempt so it cannot be used to run up AI
 * calls. If grading cannot finish (AI down, key missing) it answers with a friendly, retryable error.
 */
export async function gradeRound(candidate: Pick<CandidateSession, 'id' | 'jobId'>, roundType: RoundType): Promise<RoundPageState> {
  const attempt = await prisma.attempt.findUnique({
    where: { candidateId_roundType: { candidateId: candidate.id, roundType } },
    select: { id: true, status: true },
  });
  if (!attempt) throw err.notFound('You have not started this round.', 'ATTEMPT_NOT_FOUND');
  if (attempt.status === 'IN_PROGRESS') await finalizeAttempt(attempt.id);

  if (attempt.status !== 'GRADED') {
    const limit = await consumeRateLimit(`grade:${attempt.id}`, 12, 60_000);
    if (!limit.allowed) throw err.tooMany(limit.retryAfterSec, 'Still working on your grading. Please wait a moment.');
    const status = await gradePendingAnswers(attempt.id);
    if (status === 'pending') {
      throw new AppError(500, 'GRADING_DELAYED', 'We could not finish grading your answers yet. We will keep trying, and the hiring team can grade them manually if needed.');
    }
  }
  return getRoundPage(candidate, roundType);
}

/** Admin: grade whatever is still ungraded for a candidate's round. Same steps as the candidate's grading screen, without the rate limit. */
export async function gradeAttemptForAdmin(candidateId: string, roundType: RoundType): Promise<GradingStatus> {
  const attempt = await prisma.attempt.findUnique({
    where: { candidateId_roundType: { candidateId, roundType } },
    select: { id: true, status: true },
  });
  if (!attempt) throw err.notFound('This candidate has not started that round.', 'ATTEMPT_NOT_FOUND');
  if (attempt.status === 'IN_PROGRESS') throw err.conflict('The candidate is still taking this round.', 'ROUND_NOT_SUBMITTED');
  return gradePendingAnswers(attempt.id);
}
