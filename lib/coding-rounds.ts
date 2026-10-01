// Database operations for the Coding round (server only): pinning problems, drafts, Run and Submit.
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { audit } from '@/lib/audit';
import {
  CODING_LANGUAGE_IDS,
  CODING_POINTS_PER_PROBLEM,
  MAX_CODE_CHARS,
  MAX_CUSTOM_INPUT_CHARS,
  clip,
  fraction,
  isBetterSubmission,
  judgeTest,
  overallVerdict,
  pickProblems,
  starterFor,
  summarize,
  verdictFromStatus,
  type CandidateProblem,
  type CodingLanguageId,
  type CodingView,
  type CustomRunReport,
  type ProblemProgress,
  type RunReport,
  type TestReport,
  type TestVerdict,
} from '@/lib/coding';
import { prisma } from '@/lib/db';
import { AppError, err } from '@/lib/http';
import { executeAll, type RunResult } from '@/lib/judge0';
import { consumeRateLimit } from '@/lib/ratelimit';
import { isPastGrace, secondsLeft, type RoundInfo } from '@/lib/round-engine';

type Tx = Prisma.TransactionClient;

export const codeBodySchema = z.object({
  problemId: z.string().min(1).max(64),
  language: z.enum(CODING_LANGUAGE_IDS),
  code: z.string().max(MAX_CODE_CHARS),
});
export const runBodySchema = codeBodySchema.extend({ customInput: z.string().max(MAX_CUSTOM_INPUT_CHARS).optional() });
export type CodeBody = z.infer<typeof codeBodySchema>;
export type RunBody = z.infer<typeof runBodySchema>;

const RUN_LIMIT = { max: 25, windowMs: 60_000 };
const SUBMIT_LIMIT = { max: 8, windowMs: 60_000 };

const asLanguage = (value: string): CodingLanguageId => ((CODING_LANGUAGE_IDS as readonly string[]).includes(value) ? (value as CodingLanguageId) : 'python');
const asVerdict = (value: string | null): TestVerdict | null =>
  value && ['PASSED', 'WRONG_ANSWER', 'TIME_LIMIT', 'RUNTIME_ERROR', 'COMPILE_ERROR', 'ERROR'].includes(value) ? (value as TestVerdict) : null;

// ───────────────────────── Starting ─────────────────────────

/** The problems a candidate will get: same for everyone, chosen from the job's own problems and the shared bank. */
export async function pickProblemIdsForRound(jobId: string, round: { difficulty: 'EASY' | 'MEDIUM' | 'HARD'; questionCount: number }): Promise<string[]> {
  const job = await prisma.job.findUnique({ where: { id: jobId }, select: { tier: true } });
  if (!job) throw err.notFound('Job not found', 'JOB_NOT_FOUND');
  const rows = await prisma.codingProblem.findMany({
    where: { OR: [{ jobId }, { jobId: null, OR: [{ tier: job.tier }, { tier: null }] }] },
    select: { id: true, jobId: true, difficulty: true, createdAt: true, testCases: { select: { isSample: true } } },
  });
  const picked = pickProblems(
    rows.map((r) => ({
      id: r.id,
      jobId: r.jobId,
      difficulty: r.difficulty,
      createdAt: r.createdAt,
      sampleCount: r.testCases.filter((t) => t.isSample).length,
      testCount: r.testCases.length,
    })),
    { jobId, difficulty: round.difficulty, count: round.questionCount },
  );
  if (round.questionCount < 1 || picked.length < round.questionCount) {
    throw err.conflict('This round is not ready yet. Please contact the hiring team.', 'ROUND_NOT_READY');
  }
  return picked.map((p) => p.id);
}

// ───────────────────────── What the candidate sees ─────────────────────────

/** Fields are picked one by one. Only sample tests are read with their expected output; hidden tests are only counted. */
export async function buildCodingView(attemptId: string, round: RoundInfo, deadlineAt: Date, now: Date): Promise<CodingView> {
  const rows = await prisma.codingAnswer.findMany({
    where: { attemptId },
    orderBy: { position: 'asc' },
    select: {
      problemId: true,
      language: true,
      code: true,
      submissions: true,
      passed: true,
      total: true,
      lastVerdict: true,
      problem: {
        select: {
          title: true,
          statement: true,
          difficulty: true,
          starterCode: true,
          timeLimitSec: true,
          testCases: { where: { isSample: true }, orderBy: { id: 'asc' }, select: { input: true, expectedOutput: true } },
          _count: { select: { testCases: true } },
        },
      },
    },
  });

  const problems: CandidateProblem[] = [];
  const drafts: CodingView['drafts'] = {};
  const progress: Record<string, ProblemProgress> = {};
  for (const r of rows) {
    const starter = Object.fromEntries(CODING_LANGUAGE_IDS.map((id) => [id, starterFor(r.problem.starterCode, id)])) as Record<CodingLanguageId, string>;
    problems.push({
      id: r.problemId,
      title: r.problem.title,
      statement: r.problem.statement,
      difficulty: r.problem.difficulty,
      samples: r.problem.testCases.map((t) => ({ input: t.input, expectedOutput: t.expectedOutput })),
      hiddenCount: Math.max(0, r.problem._count.testCases - r.problem.testCases.length),
      timeLimitSec: r.problem.timeLimitSec,
      starter,
    });
    const language = asLanguage(r.language);
    drafts[r.problemId] = { language, code: r.code === '' ? starter[language] : r.code };
    progress[r.problemId] = { passed: r.passed, total: r.total, submissions: r.submissions, verdict: asVerdict(r.lastVerdict) };
  }
  return { round, secondsLeft: secondsLeft(deadlineAt, now), problems, drafts, progress };
}

// ───────────────────────── Guarding every action ─────────────────────────

async function requireOpenProblem(candidateId: string, problemId: string) {
  const attempt = await prisma.attempt.findUnique({
    where: { candidateId_roundType: { candidateId, roundType: 'CODING' } },
    select: { id: true, status: true, deadlineAt: true },
  });
  if (!attempt) throw err.notFound('You have not started this round.', 'ATTEMPT_NOT_FOUND');
  if (attempt.status !== 'IN_PROGRESS' || isPastGrace(attempt.deadlineAt, new Date())) {
    throw err.conflict('This round has ended.', 'ATTEMPT_ENDED');
  }
  const answer = await prisma.codingAnswer.findUnique({
    where: { attemptId_problemId: { attemptId: attempt.id, problemId } },
    select: { id: true, problem: { select: { timeLimitSec: true } } },
  });
  if (!answer) throw err.notFound('That problem is not part of this round.', 'PROBLEM_NOT_FOUND');
  return { attemptId: attempt.id, answerId: answer.id, timeLimitSec: answer.problem.timeLimitSec };
}

async function persistDraft(answerId: string, body: CodeBody) {
  // The status is part of the write, so nothing can be saved after the round was submitted.
  const res = await prisma.codingAnswer.updateMany({
    where: { id: answerId, attempt: { status: 'IN_PROGRESS' } },
    data: { language: body.language, code: body.code },
  });
  if (res.count === 0) throw err.conflict('This round has ended.', 'ATTEMPT_ENDED');
}

export async function saveDraft(candidate: { id: string }, body: CodeBody) {
  const { answerId } = await requireOpenProblem(candidate.id, body.problemId);
  await persistDraft(answerId, body);
  return { saved: true, serverTime: new Date().toISOString() };
}

// ───────────────────────── Run and Submit ─────────────────────────

function failureText(r: RunResult): string {
  return clip(r.compileOutput || r.stderr || r.message || '');
}

async function limit(key: string, cfg: { max: number; windowMs: number }) {
  const res = await consumeRateLimit(key, cfg.max, cfg.windowMs);
  if (!res.allowed) throw err.tooMany(res.retryAfterSec, 'You are running code too quickly. Please wait a few seconds.');
}

/** Run Code: sample tests only (or your own input). Costs nothing and never changes your score. */
export async function runCode(candidate: { id: string }, body: RunBody): Promise<RunReport | CustomRunReport> {
  const { attemptId, answerId, timeLimitSec } = await requireOpenProblem(candidate.id, body.problemId);
  await limit(`code-run:${attemptId}`, RUN_LIMIT);
  await persistDraft(answerId, body);

  if (body.customInput !== undefined) {
    const [r] = await executeAll({ language: body.language, code: body.code, inputs: [body.customInput], timeLimitSec });
    return {
      mode: 'custom',
      verdict: verdictFromStatus(r.statusId),
      stdout: clip(r.stdout),
      message: r.statusId === 3 ? clip(r.stderr) : failureText(r),
      timeMs: r.timeSec === null ? null : Math.round(r.timeSec * 1000),
    };
  }

  const samples = await prisma.testCase.findMany({
    where: { problemId: body.problemId, isSample: true },
    orderBy: { id: 'asc' },
    select: { input: true, expectedOutput: true },
  });
  const results = await executeAll({ language: body.language, code: body.code, inputs: samples.map((s) => s.input), timeLimitSec });
  const tests: TestReport[] = samples.map((s, index) => {
    const r = results[index];
    const verdict = judgeTest({ statusId: r.statusId, stdout: r.stdout }, s.expectedOutput);
    return {
      index,
      isSample: true,
      verdict,
      input: s.input,
      expected: s.expectedOutput,
      actual: clip(r.stdout),
      message: verdict === 'PASSED' || verdict === 'WRONG_ANSWER' ? undefined : failureText(r),
      timeMs: r.timeSec === null ? undefined : Math.round(r.timeSec * 1000),
    };
  });
  const verdicts = tests.map((t) => t.verdict);
  return { mode: 'run', overall: overallVerdict(verdicts), ...summarize(verdicts), tests };
}

/** Submit Code: every test, sample and hidden. The best submission counts; hidden tests are reported as pass or fail only. */
export async function submitCode(candidate: { id: string }, body: CodeBody): Promise<RunReport> {
  const { attemptId, answerId, timeLimitSec } = await requireOpenProblem(candidate.id, body.problemId);
  await limit(`code-submit:${attemptId}`, SUBMIT_LIMIT);
  await persistDraft(answerId, body);

  const cases = await prisma.testCase.findMany({
    where: { problemId: body.problemId },
    orderBy: [{ isSample: 'desc' }, { id: 'asc' }],
    select: { input: true, expectedOutput: true, isSample: true },
  });
  if (cases.length === 0) throw new AppError(500, 'PROBLEM_HAS_NO_TESTS', 'This problem has no tests yet. Please contact the hiring team.');
  const results = await executeAll({ language: body.language, code: body.code, inputs: cases.map((c) => c.input), timeLimitSec });

  const tests: TestReport[] = cases.map((c, index) => {
    const r = results[index];
    const verdict = judgeTest({ statusId: r.statusId, stdout: r.stdout }, c.expectedOutput);
    const timeMs = r.timeSec === null ? undefined : Math.round(r.timeSec * 1000);
    if (!c.isSample) {
      // A compile error does not depend on the hidden input, so it is safe and useful to show.
      return { index, isSample: false, verdict, message: verdict === 'COMPILE_ERROR' ? failureText(r) : undefined, timeMs };
    }
    return {
      index,
      isSample: true,
      verdict,
      input: c.input,
      expected: c.expectedOutput,
      actual: clip(r.stdout),
      message: verdict === 'PASSED' || verdict === 'WRONG_ANSWER' ? undefined : failureText(r),
      timeMs,
    };
  });
  const verdicts = tests.map((t) => t.verdict);
  const summary = summarize(verdicts);
  const overall = overallVerdict(verdicts);

  const best = await prisma.$transaction(async (tx) => {
    const current = await tx.codingAnswer.findUniqueOrThrow({ where: { id: answerId }, select: { passed: true, total: true, score: true } });
    const better = isBetterSubmission(current.score === null ? null : { passed: current.passed, total: current.total }, summary);
    const res = await tx.codingAnswer.updateMany({
      where: { id: answerId, attempt: { status: 'IN_PROGRESS' } },
      data: {
        submissions: { increment: 1 },
        lastVerdict: overall,
        ...(better ? { passed: summary.passed, total: summary.total, score: fraction(summary.passed, summary.total), submittedLanguage: body.language, submittedCode: body.code, submittedAt: new Date() } : {}),
      },
    });
    if (res.count === 0) throw err.conflict('This round has ended.', 'ATTEMPT_ENDED');
    return better ? summary : { passed: current.passed, total: current.total };
  });

  await audit({
    actorType: 'CANDIDATE',
    actorId: candidate.id,
    action: 'CODE_SUBMITTED',
    entity: 'Attempt',
    entityId: attemptId,
    meta: { problemId: body.problemId, language: body.language, passed: summary.passed, total: summary.total },
  });
  return { mode: 'submit', overall, ...summary, tests, best };
}

// ───────────────────────── Finishing the round ─────────────────────────

/** Round totals from each problem's best submission. A problem never submitted scores 0. Used inside the completion transaction. */
export async function codingTotals(tx: Tx, attemptId: string) {
  const rows = await tx.codingAnswer.findMany({ where: { attemptId }, select: { score: true } });
  return {
    items: rows.map((r) => ({ points: CODING_POINTS_PER_PROBLEM, score: (r.score ?? 0) * CODING_POINTS_PER_PROBLEM })),
  };
}
