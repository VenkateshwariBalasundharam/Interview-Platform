// Final result rules: the weighted score, the suggested decision and the CSV export. Pure and client-safe
// (no database, no server imports), so every rule here is covered by tests/final-result.test.ts.
//
// The decision is only ever a SUGGESTION. A Result is never final until an admin confirms or overrides it,
// and a rejection that rests on AI-graded answers is labelled so the admin knows to read them first.
import { z } from 'zod';
import { csvSafeCell } from '@/lib/csv-export';

export const SUGGESTIONS = ['SHORTLIST', 'REJECT', 'REVIEW'] as const;
export type Suggestion = (typeof SUGGESTIONS)[number];
/** What an admin can decide. REVIEW is a suggestion only: it means "a person has to look". */
export const DECISIONS = ['SHORTLIST', 'REJECT'] as const;
export type Decision = (typeof DECISIONS)[number];

export const managerScoreSchema = z.object({
  score: z.number().int().min(0).max(100),
  notes: z.string().trim().max(2000).optional(),
});

export const decisionBodySchema = z.object({
  decision: z.enum(DECISIONS),
  note: z.string().trim().max(1000).optional(),
});

export const exportQuerySchema = z.object({ jobId: z.string().min(1).max(64).optional() });

export interface RoundInput {
  roundType: string;
  label: string;
  weight: number;
  cutoffPercent: number;
  /** A required round must be finished before a result exists. An optional one counts only if the candidate took it. */
  required: boolean;
  /** Typed answers in this round were scored by the AI. */
  aiGraded: boolean;
  /** Final percent for the round (graded attempt, or the admin's Manager score). Null until there is one. */
  percent: number | null;
}

export interface ResultInput {
  candidateStatus: 'ACTIVE' | 'DISQUALIFIED' | 'PENDING_REVIEW' | 'COMPLETED';
  /** Enabled rounds only, in pipeline order. */
  rounds: RoundInput[];
}

export interface RoundBreakdown {
  roundType: string;
  label: string;
  weight: number;
  /** Share of the final score this round carries, in percent (weights are normalised). */
  weightPercent: number;
  percent: number | null;
  cutoffPercent: number;
  /** Null until the round has a score. */
  passed: boolean | null;
  /** Points this round adds to the weighted score. */
  contribution: number;
  counted: boolean;
}

export interface FinalResult {
  /** Every required round has a score. */
  complete: boolean;
  /** Weighted score out of 100, two decimals. A round with no score counts as 0. */
  weightedScore: number;
  rounds: RoundBreakdown[];
  /** Null while the interview is still running: there is nothing to suggest yet. */
  suggestion: Suggestion | null;
  /** Plain-words reasons for the suggestion. */
  reasons: string[];
  /** A rejection that depends on at least one AI-graded round. */
  rejectionRestsOnAi: boolean;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Compares exactly, like the round engine: 59.996 is never rounded up to a 60 cutoff. */
export function meetsCutoff(percent: number, cutoffPercent: number): boolean {
  return percent >= cutoffPercent;
}

/**
 * Weighted sum of the round scores: each round's percent times its weight, divided by the total weight of the rounds
 * that count (so the result is out of 100 whatever the weights add up to). If every weight is 0, rounds count equally.
 */
export function computeFinalResult(input: ResultInput): FinalResult {
  const counted = input.rounds.map((r) => r.required || r.percent !== null);
  const rawWeights = input.rounds.map((r, i) => (counted[i] ? Math.max(0, r.weight) : 0));
  const allZero = rawWeights.every((w) => w === 0);
  const weights = allZero ? counted.map((c) => (c ? 1 : 0)) : rawWeights;
  const total = weights.reduce((a, b) => a + b, 0);

  const rounds: RoundBreakdown[] = input.rounds.map((r, i) => {
    const share = total > 0 ? weights[i] / total : 0;
    return {
      roundType: r.roundType,
      label: r.label,
      weight: r.weight,
      weightPercent: round2(share * 100),
      percent: r.percent,
      cutoffPercent: r.cutoffPercent,
      passed: r.percent === null ? null : meetsCutoff(r.percent, r.cutoffPercent),
      contribution: round2(share * (r.percent ?? 0)),
      counted: counted[i],
    };
  });

  const weightedScore = round2(input.rounds.reduce((sum, r, i) => sum + (total > 0 ? (weights[i] / total) * (r.percent ?? 0) : 0), 0));
  const complete = input.rounds.every((r) => !r.required || r.percent !== null);
  const below = input.rounds.filter((r) => r.percent !== null && !meetsCutoff(r.percent, r.cutoffPercent));
  const belowNames = below.map((r) => r.label).join(', ');
  const belowAi = below.some((r) => r.aiGraded);

  if (input.candidateStatus === 'DISQUALIFIED') {
    return {
      complete,
      weightedScore,
      rounds,
      suggestion: 'REJECT',
      reasons: below.length > 0 ? [`Below the cutoff in: ${belowNames}.`] : ['Rejected after review.'],
      rejectionRestsOnAi: belowAi,
    };
  }
  if (!complete) return { complete, weightedScore, rounds, suggestion: null, reasons: [], rejectionRestsOnAi: false };
  if (below.length > 0) {
    return {
      complete,
      weightedScore,
      rounds,
      suggestion: 'REVIEW',
      reasons: [`Finished every round, but below the cutoff in: ${belowNames}. A person needs to decide.`],
      rejectionRestsOnAi: false,
    };
  }
  return { complete, weightedScore, rounds, suggestion: 'SHORTLIST', reasons: ['Finished every round at or above each cutoff.'], rejectionRestsOnAi: false };
}

export const SUGGESTION_LABEL: Record<Suggestion | Decision, string> = { SHORTLIST: 'Shortlist', REJECT: 'Reject', REVIEW: 'Needs a decision' };

/** Candidates the admin has not decided yet, which is every result until someone confirms it. */
export function isPending(finalDecision: string | null): boolean {
  return finalDecision === null;
}

// ───────────────────────── Export ─────────────────────────

export interface ExportRow {
  candidateCode: string;
  name: string;
  email: string;
  job: string;
  status: string;
  /** Percent per round type, null when not taken. */
  roundPercents: Record<string, number | null>;
  weightedScore: number | null;
  suggestion: string | null;
  finalDecision: string | null;
  rejectionRestsOnAi: boolean;
  proctorEvents: number;
}

/** CSV with a column per round type used by at least one row. Every text cell is quoted and formula-safe. */
export function buildResultsCsv(rows: ExportRow[], roundLabels: Record<string, string>): string {
  const types = Object.keys(roundLabels).filter((t) => rows.some((r) => r.roundPercents[t] !== undefined));
  const header = ['Candidate ID', 'Name', 'Email', 'Job', 'Status', ...types.map((t) => `${roundLabels[t]} %`), 'Weighted score', 'Suggested decision', 'Final decision', 'Rests on AI-graded answers', 'Proctoring events'];
  const lines = [header.map(csvSafeCell).join(',')];
  for (const r of rows) {
    const cells = [
      csvSafeCell(r.candidateCode),
      csvSafeCell(r.name),
      csvSafeCell(r.email),
      csvSafeCell(r.job),
      csvSafeCell(r.status.replace('_', ' ').toLowerCase()),
      ...types.map((t) => (r.roundPercents[t] === null || r.roundPercents[t] === undefined ? '' : String(r.roundPercents[t]))),
      r.weightedScore === null ? '' : String(r.weightedScore),
      csvSafeCell(r.suggestion ? SUGGESTION_LABEL[r.suggestion as Suggestion] ?? r.suggestion : ''),
      csvSafeCell(r.finalDecision ? SUGGESTION_LABEL[r.finalDecision as Decision] ?? r.finalDecision : 'Pending'),
      r.suggestion === 'REJECT' && r.rejectionRestsOnAi ? 'Yes' : '',
      String(r.proctorEvents),
    ];
    lines.push(cells.join(','));
  }
  return '\uFEFF' + lines.join('\r\n') + '\r\n';
}
