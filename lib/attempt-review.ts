// Admin view of a candidate's rounds: every answer with its score and AI feedback, plus the review decision
// for flagged candidates (server only).
import { z } from 'zod';
import { audit } from '@/lib/audit';
import { CODING_POINTS_PER_PROBLEM, verdictLabel } from '@/lib/coding';
import { prisma } from '@/lib/db';
import { getEnv } from '@/lib/env';
import { needsHumanReview } from '@/lib/grading-ai';
import { enqueueEmailsSafely } from '@/lib/email';
import { emailKeys } from '@/lib/email-core';
import { err } from '@/lib/http';
import { ROUND_LIBRARY, ROUND_TYPES, type RoundType } from '@/lib/pipeline';
import { readChoice, readText } from '@/lib/answer-input';
import { rubricSchema, type QuestionKind } from '@/lib/questions';
import { refreshResultSafely } from '@/lib/results';
import { decideOutcome, effectiveCutoffMode, isAiGradedRound, type RoundVerdict } from '@/lib/round-engine';
import { gradeAttemptForAdmin, type GradingStatus } from '@/lib/rounds';

export const reviewBodySchema = z.object({ decision: z.enum(['APPROVE', 'REJECT']) });
export const regradeBodySchema = z.object({ roundType: z.enum(ROUND_TYPES) });

export interface ReviewAnswer {
  position: number;
  kind: QuestionKind;
  prompt: string;
  points: number;
  score: number | null;
  /** MCQ: the option the candidate picked. Typed: what they wrote. Null when unanswered. */
  candidateAnswer: string | null;
  /** MCQ: the correct option. Typed: the rubric's key points and sample answer. */
  correctOption: string | null;
  keyPoints: string[];
  sampleAnswer: string | null;
  feedback: string | null;
  needsReview: boolean;
}

export interface ReviewCoding {
  position: number;
  title: string;
  submissions: number;
  passed: number;
  total: number;
  /** Points earned out of CODING_POINTS_PER_PROBLEM. */
  points: number;
  language: string | null;
  lastVerdict: string | null;
  /** The best submission's code (what was scored). Null if the candidate never submitted. */
  code: string | null;
  /** Their latest unsubmitted draft, when it differs from the scored code. */
  draft: string | null;
}

export interface ReviewAttempt {
  roundType: RoundType;
  label: string;
  status: 'IN_PROGRESS' | 'SUBMITTED' | 'AUTO_SUBMITTED' | 'GRADED';
  startedAt: string;
  submittedAt: string | null;
  score: number | null;
  maxScore: number | null;
  percent: number | null;
  cutoffPercent: number;
  verdict: RoundVerdict | null;
  /** Typed answers that still have no score. */
  ungraded: number;
  aiGraded: boolean;
  answers: ReviewAnswer[];
  coding: ReviewCoding[];
}

export interface CandidateReview {
  id: string;
  candidateCode: string;
  name: string;
  email: string;
  status: 'ACTIVE' | 'DISQUALIFIED' | 'PENDING_REVIEW' | 'COMPLETED';
  jobTitle: string;
  attempts: ReviewAttempt[];
}

export async function getCandidateReview(candidateId: string): Promise<CandidateReview> {
  const candidate = await prisma.candidate.findUnique({
    where: { id: candidateId },
    select: {
      id: true,
      candidateCode: true,
      name: true,
      email: true,
      status: true,
      job: { select: { title: true, rounds: { orderBy: { position: 'asc' }, select: { roundType: true, cutoffPercent: true, cutoffMode: true } } } },
      attempts: {
        select: {
          roundType: true,
          status: true,
          startedAt: true,
          submittedAt: true,
          score: true,
          maxScore: true,
          percent: true,
          codingAnswers: {
            orderBy: { position: 'asc' },
            select: { position: true, submissions: true, passed: true, total: true, score: true, language: true, code: true, lastVerdict: true, submittedLanguage: true, submittedCode: true, problem: { select: { title: true } } },
          },
          answers: {
            select: {
              response: true,
              score: true,
              feedback: true,
              question: { select: { kind: true, position: true, prompt: true, points: true, options: true, correctIndex: true, rubric: true } },
            },
          },
        },
      },
    },
  });
  if (!candidate) throw err.notFound('Candidate not found', 'CANDIDATE_NOT_FOUND');

  const aiCanDisqualify = getEnv().AI_GRADING_CAN_DISQUALIFY === 'true';
  const order = new Map(candidate.job.rounds.map((r, i) => [r.roundType, i]));

  const attempts: ReviewAttempt[] = candidate.attempts
    .map((a): ReviewAttempt => {
      const config = candidate.job.rounds.find((r) => r.roundType === a.roundType);
      const answers = a.answers
        .map((row): ReviewAnswer => {
          const q = row.question;
          const options = Array.isArray(q.options) ? q.options.filter((o): o is string => typeof o === 'string') : [];
          const rubric = rubricSchema.safeParse(q.rubric);
          const choice = readChoice(row.response);
          const text = readText(row.response);
          return {
            position: q.position,
            kind: q.kind,
            prompt: q.prompt,
            points: q.points,
            score: row.score,
            candidateAnswer: q.kind === 'MCQ' ? (choice !== null ? (options[choice] ?? null) : null) : text || null,
            correctOption: q.kind === 'MCQ' && q.correctIndex !== null ? (options[q.correctIndex] ?? null) : null,
            keyPoints: rubric.success ? rubric.data.keyPoints : [],
            sampleAnswer: rubric.success ? rubric.data.sampleAnswer : null,
            feedback: row.feedback,
            needsReview: needsHumanReview(row.feedback),
          };
        })
        .sort((x, y) => x.position - y.position);

      const graded = a.status === 'GRADED' && a.score !== null && a.maxScore !== null && a.percent !== null && config;
      return {
        roundType: a.roundType,
        label: ROUND_LIBRARY[a.roundType].label,
        status: a.status,
        startedAt: a.startedAt.toISOString(),
        submittedAt: a.submittedAt ? a.submittedAt.toISOString() : null,
        score: a.score,
        maxScore: a.maxScore,
        percent: a.percent,
        cutoffPercent: config?.cutoffPercent ?? 0,
        verdict: graded
          ? decideOutcome({
              score: a.score as number,
              maxScore: a.maxScore as number,
              cutoffPercent: config.cutoffPercent,
              cutoffMode: effectiveCutoffMode(config.cutoffMode, a.roundType, aiCanDisqualify),
            })
          : null,
        ungraded: a.answers.filter((x) => x.score === null && x.question.kind !== 'MCQ').length,
        aiGraded: isAiGradedRound(a.roundType),
        answers,
        coding: a.codingAnswers.map(
          (c): ReviewCoding => ({
            position: c.position + 1,
            title: c.problem.title,
            submissions: c.submissions,
            passed: c.passed,
            total: c.total,
            points: (c.score ?? 0) * CODING_POINTS_PER_PROBLEM,
            language: c.submittedLanguage,
            lastVerdict: c.lastVerdict,
            code: c.submittedCode,
            draft: c.code.trim() !== '' && c.code !== c.submittedCode ? c.code : null,
          }),
        ),
      };
    })
    .sort((x, y) => (order.get(x.roundType) ?? 99) - (order.get(y.roundType) ?? 99));

  return {
    id: candidate.id,
    candidateCode: candidate.candidateCode,
    name: candidate.name,
    email: candidate.email,
    status: candidate.status,
    jobTitle: candidate.job.title,
    attempts,
  };
}

/** Resolves a flagged candidate: approve lets them continue, reject ends their interview. */
export async function reviewCandidate(candidateId: string, decision: 'APPROVE' | 'REJECT', adminId: string) {
  const next = decision === 'APPROVE' ? 'ACTIVE' : 'DISQUALIFIED';
  const approvedAt = new Date();
  // The status is part of the write, so two admins cannot both resolve the same flag.
  const result = await prisma.candidate.updateMany({ where: { id: candidateId, status: 'PENDING_REVIEW' }, data: { status: next, reviewApprovedAt: decision === 'APPROVE' ? approvedAt : null } });
  if (result.count === 0) {
    const exists = await prisma.candidate.findUnique({ where: { id: candidateId }, select: { id: true } });
    if (!exists) throw err.notFound('Candidate not found', 'CANDIDATE_NOT_FOUND');
    throw err.conflict('This candidate is not waiting for review.', 'NOT_PENDING_REVIEW');
  }
  await audit({
    actorType: 'ADMIN',
    actorId: adminId,
    action: decision === 'APPROVE' ? 'CANDIDATE_REVIEW_APPROVED' : 'CANDIDATE_REVIEW_REJECTED',
    entity: 'Candidate',
    entityId: candidateId,
  });
  await refreshResultSafely(candidateId);
  // Approval is the moment a candidate is "selected for the next round". Rejecting sends nothing: the dashboard tells them.
  if (decision === 'APPROVE') await enqueueEmailsSafely([{ candidateId, kind: 'SELECTED_NEXT_ROUND', dedupeKey: emailKeys.selected(candidateId, approvedAt) }]);
  return { status: next };
}

export async function regradeCandidateRound(candidateId: string, roundType: RoundType, adminId: string): Promise<{ status: GradingStatus }> {
  const status = await gradeAttemptForAdmin(candidateId, roundType);
  await audit({ actorType: 'ADMIN', actorId: adminId, action: 'ROUND_GRADE_TRIGGERED', entity: 'Candidate', entityId: candidateId, meta: { roundType, status } });
  return { status };
}
