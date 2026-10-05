// Round-engine rules shared by the API and the candidate screens. Pure and client-safe (no server imports).
import { MAX_ANSWER_CHARS, isOpenKind, readChoice, readText } from '@/lib/answer-input';
import type { CutoffMode, RoundType } from '@/lib/pipeline';
import type { CodingView } from '@/lib/coding';
import type { QuestionKind } from '@/lib/questions';

export { readChoice, readText };

// ───────────────────────── Configuration ─────────────────────────

/** Rounds whose typed answers are scored by the AI against each question's rubric. */
export const AI_GRADED_ROUNDS: readonly RoundType[] = ['TECHNICAL', 'SYSTEM_DESIGN', 'SCENARIO', 'HR'];

/**
 * Rounds a candidate can take on the platform today. Coding runs through Judge0 (hidden tests, no AI). Manager is a
 * live interview, so it shows "live interview" instead of a Start button.
 */
export const RUNNABLE_ROUNDS: readonly RoundType[] = ['ASSESSMENT', 'CODING', ...AI_GRADED_ROUNDS];

/** Rounds where every candidate sees the same questions in a different, seeded order. Written rounds keep the admin's order. */
export const SHUFFLED_ROUNDS: readonly RoundType[] = ['ASSESSMENT', 'TECHNICAL'];

/** Answers that arrive up to this long after the deadline still count (network delay on the last autosave/submit). */
export const SUBMIT_GRACE_SECONDS = 15;

export function isRunnableRound(roundType: string): boolean {
  return (RUNNABLE_ROUNDS as readonly string[]).includes(roundType);
}

export function isAiGradedRound(roundType: string): boolean {
  return (AI_GRADED_ROUNDS as readonly string[]).includes(roundType);
}

// ───────────────────────── Seeded shuffle ─────────────────────────

/** FNV-1a 32-bit hash of the seed string. */
function hashSeed(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32: small deterministic PRNG returning values in [0, 1). */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Same seed, same order. Returns a new array; the input is not changed. */
export function seededShuffle<T>(items: readonly T[], seed: string): T[] {
  const out = [...items];
  const rng = mulberry32(hashSeed(seed));
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Question order for one candidate: shuffled with the attempt's seed for shuffled rounds, else by position. */
export function orderQuestions<T>(roundType: RoundType, questionsByPosition: readonly T[], seed: string | null): T[] {
  if (seed && (SHUFFLED_ROUNDS as readonly string[]).includes(roundType)) return seededShuffle(questionsByPosition, seed);
  return [...questionsByPosition];
}

// ───────────────────────── Timer ─────────────────────────

export function computeDeadline(startedAt: Date, durationMinutes: number): Date {
  return new Date(startedAt.getTime() + durationMinutes * 60_000);
}

/** Whole seconds left, rounded up, never below 0. */
export function secondsLeft(deadline: Date, now: Date): number {
  return Math.max(0, Math.ceil((deadline.getTime() - now.getTime()) / 1000));
}

/** True once even the grace window has passed: nothing more can be saved. */
export function isPastGrace(deadline: Date, now: Date, graceSeconds = SUBMIT_GRACE_SECONDS): boolean {
  return now.getTime() > deadline.getTime() + graceSeconds * 1000;
}

/** True once the timer itself has run out (a submit after this counts as an automatic submission). */
export function isPastDeadline(deadline: Date, now: Date): boolean {
  return now.getTime() > deadline.getTime();
}

// ───────────────────────── Grading ─────────────────────────

export interface GradableQuestion {
  id: string;
  kind: 'MCQ' | 'SHORT_ANSWER' | 'WRITTEN';
  points: number;
  correctIndex: number | null;
}

export function gradeMcqAnswer(question: GradableQuestion, response: unknown): number {
  const choice = readChoice(response);
  return choice !== null && question.correctIndex !== null && choice === question.correctIndex ? question.points : 0;
}

/** The outcome of scoring one answer without the AI: either a final score, or "needs the AI". */
export type ObjectiveOutcome = { kind: 'scored'; score: number; feedback: string | null } | { kind: 'needs-ai' };

/**
 * MCQs are scored by comparing with the key. A typed answer that is empty scores 0 without involving the AI (nothing
 * to grade, nothing to attack). Any other typed answer has to be graded by the AI.
 */
export function scoreWithoutAi(question: GradableQuestion, response: unknown): ObjectiveOutcome {
  if (question.kind === 'MCQ') return { kind: 'scored', score: gradeMcqAnswer(question, response), feedback: null };
  if (readText(response).trim() === '') return { kind: 'scored', score: 0, feedback: 'No answer given.' };
  return { kind: 'needs-ai' };
}

export interface GradedAttempt {
  perQuestion: { questionId: string; score: number }[];
  score: number;
  maxScore: number;
  /** 0–100, two decimals. For display and storage only: use `decideOutcome` for cutoffs. */
  percent: number;
}

/** Auto-grades an attempt made only of MCQs. Throws on any other kind so nothing is silently scored as zero. */
export function gradeMcqAttempt(items: { question: GradableQuestion; response: unknown }[]): GradedAttempt {
  let score = 0;
  let maxScore = 0;
  const perQuestion = items.map(({ question, response }) => {
    if (question.kind !== 'MCQ') throw new Error(`Cannot auto-grade a ${question.kind} question`);
    const s = gradeMcqAnswer(question, response);
    score += s;
    maxScore += question.points;
    return { questionId: question.id, score: s };
  });
  const percent = maxScore > 0 ? Math.round((score / maxScore) * 10_000) / 100 : 0;
  return { perQuestion, score, maxScore, percent };
}

/** Adds up scored answers. `percent` is 0–100 with two decimals, for display and storage only. */
export function totalScores(items: { points: number; score: number }[]): { score: number; maxScore: number; percent: number } {
  const score = items.reduce((sum, i) => sum + i.score, 0);
  const maxScore = items.reduce((sum, i) => sum + i.points, 0);
  return { score, maxScore, percent: maxScore > 0 ? Math.round((score / maxScore) * 10_000) / 100 : 0 };
}

// ───────────────────────── Cutoff ─────────────────────────

/**
 * A score produced by the AI can send a candidate to a human, but by default it cannot disqualify anyone on its own:
 * DISQUALIFY becomes FLAG_FOR_REVIEW in AI-graded rounds unless the deployment opts in (AI_GRADING_CAN_DISQUALIFY=true).
 */
export function effectiveCutoffMode(mode: CutoffMode, roundType: RoundType, aiCanDisqualify: boolean): CutoffMode {
  return mode === 'DISQUALIFY' && isAiGradedRound(roundType) && !aiCanDisqualify ? 'FLAG_FOR_REVIEW' : mode;
}

export type RoundVerdict = 'PASSED' | 'DISQUALIFIED' | 'FLAGGED';

/** Compares exactly (no rounding) so 59.996% can never round up to a 60% cutoff. */
export function decideOutcome(input: { score: number; maxScore: number; cutoffPercent: number; cutoffMode: CutoffMode }): RoundVerdict {
  const { score, maxScore, cutoffPercent, cutoffMode } = input;
  const passed = maxScore > 0 ? score * 100 >= cutoffPercent * maxScore : cutoffPercent <= 0;
  if (passed) return 'PASSED';
  return cutoffMode === 'DISQUALIFY' ? 'DISQUALIFIED' : 'FLAGGED';
}

// ───────────────────────── Round gating ─────────────────────────

export type AttemptStatusName = 'IN_PROGRESS' | 'SUBMITTED' | 'AUTO_SUBMITTED' | 'GRADED';
export type CandidateStatusName = 'ACTIVE' | 'DISQUALIFIED' | 'PENDING_REVIEW' | 'COMPLETED';

export type RoundState =
  | 'DONE'
  | 'IN_PROGRESS'
  | 'GRADING' // submitted; typed answers are still being scored
  | 'AVAILABLE'
  | 'LOCKED' // an earlier round is not finished
  | 'CLOSED' // the candidate is disqualified
  | 'SCHEDULED' // live interview arranged by the hiring team
  | 'COMING_SOON'; // this build cannot run the round yet

/**
 * State of each enabled round, in pipeline order. A round opens only when every earlier round is done.
 * PENDING_REVIEW (flagged) candidates carry on; only DISQUALIFIED closes the remaining rounds.
 */
export function computeRoundStates(input: {
  rounds: { roundType: RoundType; humanScored: boolean }[];
  attempts: { roundType: RoundType; status: AttemptStatusName }[];
  candidateStatus: CandidateStatusName;
}): { roundType: RoundType; state: RoundState }[] {
  let previousDone = true;
  return input.rounds.map((round) => {
    const attempt = input.attempts.find((a) => a.roundType === round.roundType);
    let state: RoundState;
    if (attempt) state = attempt.status === 'IN_PROGRESS' ? 'IN_PROGRESS' : attempt.status === 'GRADED' ? 'DONE' : 'GRADING';
    else if (input.candidateStatus === 'DISQUALIFIED') state = 'CLOSED';
    else if (!previousDone) state = 'LOCKED';
    else if (round.humanScored) state = 'SCHEDULED';
    else if (!isRunnableRound(round.roundType)) state = 'COMING_SOON';
    else state = 'AVAILABLE';
    previousDone = previousDone && state === 'DONE';
    return { roundType: round.roundType, state };
  });
}

/**
 * Whether the "selected for the next round" notice may show. A final Shortlist always counts; an earlier review
 * approval counts unless the admin later made the final decision Reject. A Reject never shows anything to the candidate.
 */
export function isSelectedNotice(reviewApproved: boolean, finalDecision: string | null): boolean {
  if (finalDecision === 'SHORTLIST') return true;
  if (finalDecision === 'REJECT') return false;
  return reviewApproved;
}

export type CandidateOutcome = 'SHORTLISTED' | 'NOT_SELECTED' | 'DISQUALIFIED';

/** The headline outcome a candidate sees at the top of their dashboard; null while nothing has been decided. */
export function candidateOutcome(candidateStatus: CandidateStatusName, finalDecision: string | null): CandidateOutcome | null {
  if (candidateStatus === 'DISQUALIFIED') return 'DISQUALIFIED';
  if (finalDecision === 'SHORTLIST') return 'SHORTLISTED';
  if (finalDecision === 'REJECT') return 'NOT_SELECTED';
  return null;
}

/**
 * What to tell a candidate whose flagged result an admin approved.
 *  - a round that is ready, a live interview, or opening later: they are selected for that round;
 *  - every round already done (the candidate is COMPLETED): they are selected to move forward and the team will be in touch;
 *  - null when the candidate is not ACTIVE/COMPLETED, or has already started the next round (in progress or grading),
 *    so the notice goes away on its own.
 */
export type ApprovedNotice =
  | { kind: 'next'; roundType: RoundType; state: 'AVAILABLE' | 'SCHEDULED' | 'COMING_SOON' }
  | { kind: 'all_done' };

export function approvedNextRound(
  candidateStatus: CandidateStatusName,
  states: { roundType: RoundType; state: RoundState }[],
): ApprovedNotice | null {
  if (candidateStatus !== 'ACTIVE' && candidateStatus !== 'COMPLETED') return null;
  for (const s of states) {
    if (s.state === 'DONE') continue;
    if (s.state === 'AVAILABLE' || s.state === 'SCHEDULED' || s.state === 'COMING_SOON') return { kind: 'next', roundType: s.roundType, state: s.state };
    return null; // in progress, grading, locked or closed: nothing new to announce
  }
  return states.length > 0 ? { kind: 'all_done' } : null;
}

/** Why a candidate cannot start a round, in words they can act on. Null when they can. */
export function blockedReason(state: RoundState): string | null {
  switch (state) {
    case 'AVAILABLE':
    case 'IN_PROGRESS':
    case 'DONE':
      return null;
    case 'GRADING':
      return 'Your answers are being graded. This page updates when the result is ready.';
    case 'LOCKED':
      return 'Finish the earlier rounds first. Each round opens after the previous one is complete.';
    case 'CLOSED':
      return 'You are not continuing in this interview, so this round is closed.';
    case 'SCHEDULED':
      return 'This round is a live interview. The hiring team will contact you to schedule it.';
    case 'COMING_SOON':
      return 'This round is not open yet. The hiring team will let you know when it is.';
  }
}

// ───────────────────────── What the candidate may see ─────────────────────────

export interface CandidateQuestion {
  id: string;
  kind: QuestionKind;
  prompt: string;
  points: number;
  /** Answer choices for MCQs; empty for typed answers. */
  options: string[];
  /** Character limit for typed answers; null for MCQs. */
  maxChars: number | null;
}

/**
 * The only shape in which a question reaches a candidate. Fields are picked one by one, so a new column
 * (answer key, rubric, difficulty) can never leak by accident.
 */
export function toCandidateQuestion(q: { id: string; kind: QuestionKind; prompt: string; points: number; options: unknown }): CandidateQuestion {
  if (isOpenKind(q.kind)) {
    return { id: q.id, kind: q.kind, prompt: q.prompt, points: q.points, options: [], maxChars: MAX_ANSWER_CHARS[q.kind] };
  }
  if (!Array.isArray(q.options) || !q.options.every((o) => typeof o === 'string')) {
    throw new Error('Question has no valid options');
  }
  return { id: q.id, kind: q.kind, prompt: q.prompt, points: q.points, options: q.options as string[], maxChars: null };
}

export interface RoundInfo {
  roundType: RoundType;
  label: string;
  position: number;
  durationMinutes: number;
  questionCount: number;
  humanScored: boolean;
  /** Typed answers in this round are scored by the AI (and may be reviewed by the hiring team). */
  aiGraded: boolean;
  /** The round's proctoring level is not Off: the candidate sees the full-screen notice and events are recorded. */
  proctored: boolean;
  /** Camera checks for this round: Off, Presence (faces seen) or Identity (also matched to the registered face). */
  faceLevel: 'OFF' | 'PRESENCE' | 'IDENTITY';
  /** false = a candidate whose camera does not work may continue without it; the hiring team sees that. */
  cameraRequired: boolean;
  /** Tab switches allowed before the round is submitted automatically. 0 means no limit. */
  maxTabSwitches: number;
  /** Pasting is blocked in this round (only ever true when the round is proctored). */
  blockPaste: boolean;
  /** Switches already used in a running round, so a refresh does not reset the counter on screen. Only set while a round runs. */
  tabSwitchesUsed?: number;
}

export interface RoundResult {
  score: number;
  maxScore: number;
  percent: number;
  verdict: RoundVerdict;
}

export interface ExamView {
  round: RoundInfo;
  /** Seconds left when the server built this view. The screen counts down from it. */
  secondsLeft: number;
  questions: CandidateQuestion[];
  /** questionId → chosen option index (MCQs). */
  choices: Record<string, number>;
  /** questionId → typed text (short and written answers). */
  texts: Record<string, string>;
}

export type RoundPageState =
  | { phase: 'intro'; round: RoundInfo; canStart: boolean; blockedReason: string | null }
  | { phase: 'exam'; exam: ExamView }
  | { phase: 'coding'; coding: CodingView }
  | { phase: 'grading'; round: RoundInfo }
  | { phase: 'result'; round: RoundInfo; result: RoundResult; nextRoundType: RoundType | null };

export function verdictMessage(verdict: RoundVerdict): string {
  switch (verdict) {
    case 'PASSED':
      return 'You met the requirement for this round.';
    case 'FLAGGED':
      return 'The hiring team will review your result. You can continue to the next round.';
    case 'DISQUALIFIED':
      return 'Your score did not meet the requirement for this round, so you will not continue in this interview.';
  }
}
