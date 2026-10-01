// Loads, generates and stores a candidate's job-fit summary (server only).
// Advisory: nothing here changes a score, a status or a decision.
import { Prisma } from '@prisma/client';
import { audit } from '@/lib/audit';
import { prisma } from '@/lib/db';
import { readText } from '@/lib/answer-input';
import { fitSummarySchema, generateFitSummary, type FitInput, type FitSummaryData } from '@/lib/fit-summary';
import { AppError, err } from '@/lib/http';
import type { Complete } from '@/lib/llm';
import { consumeRateLimit } from '@/lib/ratelimit';
import { parsedResumeSchema } from '@/lib/resume-parse';

export interface FitSummaryState {
  /** The HR round is in this job's pipeline and has been submitted, so a summary can be written. */
  canGenerate: boolean;
  /** Why not, in words for the admin. Null when it can. */
  reason: string | null;
  summary: (FitSummaryData & { generatedAt: string }) | null;
}

const NO_HR_ROUND = 'This job has no HR round, so there are no HR answers to summarise.';
const HR_NOT_DONE = 'The candidate has not submitted the HR round yet.';

/** Reads the HR answers, if the candidate has submitted that round. Returns the reason when they have not. */
async function loadInput(candidateId: string): Promise<{ input: FitInput } | { reason: string }> {
  const candidate = await prisma.candidate.findUnique({
    where: { id: candidateId },
    select: {
      resumeParsed: true,
      job: { select: { title: true, jdText: true, requiredSkills: true, rounds: { where: { roundType: 'HR', enabled: true }, select: { id: true } } } },
      attempts: {
        where: { roundType: 'HR' },
        select: {
          status: true,
          answers: { select: { response: true, score: true, question: { select: { position: true, prompt: true, points: true } } } },
        },
      },
    },
  });
  if (!candidate) throw err.notFound('Candidate not found', 'CANDIDATE_NOT_FOUND');
  if (candidate.job.rounds.length === 0) return { reason: NO_HR_ROUND };
  const attempt = candidate.attempts[0];
  if (!attempt || attempt.status === 'IN_PROGRESS') return { reason: HR_NOT_DONE };

  const resume = parsedResumeSchema.safeParse(candidate.resumeParsed);
  const answers = [...attempt.answers]
    .sort((a, b) => a.question.position - b.question.position)
    .map((a) => ({ prompt: a.question.prompt, answer: readText(a.response), score: a.score, points: a.question.points }));
  return {
    input: {
      job: { title: candidate.job.title, jdText: candidate.job.jdText, requiredSkills: candidate.job.requiredSkills },
      resume: resume.success ? resume.data : null,
      answers,
    },
  };
}

export async function getFitSummaryState(candidateId: string): Promise<FitSummaryState> {
  const [loaded, stored] = await Promise.all([loadInput(candidateId), prisma.fitSummary.findUnique({ where: { candidateId } })]);
  const parsed = stored ? fitSummarySchema.safeParse(stored.data) : null;
  return {
    canGenerate: 'input' in loaded,
    reason: 'reason' in loaded ? loaded.reason : null,
    summary: stored && parsed?.success ? { ...parsed.data, generatedAt: stored.generatedAt.toISOString() } : null,
  };
}

/** Writes (or rewrites) the summary. Rate limited per candidate so the button cannot be used to run up AI calls. */
export async function generateFitSummaryFor(candidateId: string, adminId: string, complete?: Complete): Promise<FitSummaryState> {
  const loaded = await loadInput(candidateId);
  if ('reason' in loaded) throw err.conflict(loaded.reason, loaded.reason === NO_HR_ROUND ? 'NO_HR_ROUND' : 'HR_NOT_SUBMITTED');

  const limit = await consumeRateLimit(`fit-summary:${candidateId}`, 5, 10 * 60_000);
  if (!limit.allowed) throw err.tooMany(limit.retryAfterSec, 'A summary was just requested for this candidate. Wait a few minutes and try again.');

  // AppErrors from the AI client (no key, bad key, rate limit) already carry a message that is safe for the admin.
  const data = await generateFitSummary(loaded.input, complete).catch((e) => {
    if (e instanceof AppError) throw e;
    throw err.conflict('The AI returned a summary that could not be read. Please try again.', 'AI_BAD_OUTPUT');
  });

  await prisma.fitSummary.upsert({
    where: { candidateId },
    create: { candidateId, data: data as Prisma.InputJsonValue },
    update: { data: data as Prisma.InputJsonValue },
  });
  // Only the fact that it happened: the summary text and the answers stay out of the log.
  await audit({ actorType: 'ADMIN', actorId: adminId, action: 'FIT_SUMMARY_GENERATED', entity: 'Candidate', entityId: candidateId, meta: { fit: data.fit, hadResume: data.hadResume } });
  return getFitSummaryState(candidateId);
}
