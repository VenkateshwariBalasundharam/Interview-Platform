// Rules for an admin resetting ONE round for ONE candidate (for example after a crash, a network outage or a bad question).
// Pure and client-safe (no database), so every rule is covered by tests/round-reset.test.ts. The database work is in
// lib/round-reset-server.ts.
//
// A reset throws away that candidate's attempt for the round (answers, scores, proctoring log) so they can start it again from
// the beginning with a fresh timer. Nothing else about the candidate or the job changes.
import { z } from 'zod';
import { decideOutcome, effectiveCutoffMode, type CandidateStatusName } from '@/lib/round-engine';
import type { CutoffMode, RoundType } from '@/lib/pipeline';

export const resetRoundBodySchema = z.object({
  /** Why the admin is doing this. Required, and written to the audit log. */
  reason: z.string().trim().min(5, 'Please give a short reason (at least 5 characters).').max(500),
});

export interface ResetRoundConfig {
  roundType: RoundType;
  label: string;
  position: number;
  enabled: boolean;
  humanScored: boolean;
  cutoffPercent: number;
  cutoffMode: CutoffMode;
}

export interface ResetAttempt {
  roundType: RoundType;
  status: 'IN_PROGRESS' | 'SUBMITTED' | 'AUTO_SUBMITTED' | 'GRADED';
  score: number | null;
  maxScore: number | null;
}

export type ResetPlan =
  | { ok: true; roundLabel: string; nextStatus: CandidateStatusName; statusChanges: boolean }
  | { ok: false; httpStatus: 404 | 409; code: string; message: string };

/**
 * Decides whether the round can be reset and what the candidate's status becomes.
 *
 * - The round must be an enabled round that candidates take on the platform (a live Manager interview has no attempt: change that score instead).
 * - The candidate must have an attempt for it.
 * - No LATER round may have been started. Rounds are strictly sequential, so resetting an earlier round underneath a later
 *   one would leave the candidate with a result that should not exist. Reset the later rounds first, newest first.
 * - Status: a Completed candidate goes back to Active. A Disqualified or Pending-review candidate goes back to Active only
 *   when THIS round is what put them there (it scored below its cutoff). Otherwise their status is left alone.
 */
export function planRoundReset(input: {
  candidateStatus: CandidateStatusName;
  rounds: ResetRoundConfig[];
  attempts: ResetAttempt[];
  target: RoundType;
  aiCanDisqualify: boolean;
}): ResetPlan {
  const { rounds, attempts, target } = input;
  const config = rounds.find((r) => r.roundType === target && r.enabled);
  if (!config) return { ok: false, httpStatus: 404, code: 'ROUND_NOT_IN_JOB', message: 'This job does not have that round.' };
  if (config.humanScored) {
    return { ok: false, httpStatus: 409, code: 'ROUND_NOT_RESETTABLE', message: `${config.label} is scored by an admin, not taken on the platform. Change its score instead.` };
  }

  const attempt = attempts.find((a) => a.roundType === target);
  if (!attempt) return { ok: false, httpStatus: 404, code: 'ATTEMPT_NOT_FOUND', message: `This candidate has not started ${config.label}, so there is nothing to reset.` };

  const later = rounds
    .filter((r) => r.enabled && r.position > config.position && attempts.some((a) => a.roundType === r.roundType))
    .sort((a, b) => a.position - b.position);
  if (later.length > 0) {
    const names = later.map((r) => r.label).join(', ');
    return {
      ok: false,
      httpStatus: 409,
      code: 'LATER_ROUNDS_STARTED',
      message: `The candidate has already started a later round (${names}). Rounds run in order, so reset ${later.length === 1 ? 'that round' : 'those rounds, latest first,'} before ${config.label}.`,
    };
  }

  let nextStatus = input.candidateStatus;
  if (input.candidateStatus === 'COMPLETED') nextStatus = 'ACTIVE';
  else if (input.candidateStatus === 'DISQUALIFIED' || input.candidateStatus === 'PENDING_REVIEW') {
    const thisRoundCausedIt =
      attempt.status === 'GRADED' &&
      attempt.score !== null &&
      attempt.maxScore !== null &&
      decideOutcome({
        score: attempt.score,
        maxScore: attempt.maxScore,
        cutoffPercent: config.cutoffPercent,
        cutoffMode: effectiveCutoffMode(config.cutoffMode, target, input.aiCanDisqualify),
      }) !== 'PASSED';
    if (thisRoundCausedIt) nextStatus = 'ACTIVE';
  }
  return { ok: true, roundLabel: config.label, nextStatus, statusChanges: nextStatus !== input.candidateStatus };
}
