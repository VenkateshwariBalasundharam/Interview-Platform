// Question-set rules shared by the API and the admin UI. Pure and client-safe (no server imports).
import { z } from 'zod';
import { DIFFICULTIES, type Difficulty, type RoundType } from '@/lib/pipeline';

export const QUESTION_KINDS = ['MCQ', 'SHORT_ANSWER', 'WRITTEN'] as const;
export type QuestionKind = (typeof QUESTION_KINDS)[number];

export const SET_STATUSES = ['DRAFT', 'APPROVED', 'LOCKED'] as const;
export type SetStatus = (typeof SET_STATUSES)[number];

export const SET_ACTIONS = ['approve', 'reopen', 'lock'] as const;
export type SetAction = (typeof SET_ACTIONS)[number];

export const KIND_LABEL: Record<QuestionKind, string> = {
  MCQ: 'Multiple choice',
  SHORT_ANSWER: 'Short answer',
  WRITTEN: 'Written',
};

/** Rounds whose questions come from the job description. Coding uses the problem bank; Manager is a live interview. */
export const GENERATED_ROUNDS = ['ASSESSMENT', 'TECHNICAL', 'SYSTEM_DESIGN', 'SCENARIO', 'HR'] as const satisfies readonly RoundType[];
export type GeneratedRound = (typeof GENERATED_ROUNDS)[number];

export function isGeneratedRound(roundType: string): roundType is GeneratedRound {
  return (GENERATED_ROUNDS as readonly string[]).includes(roundType);
}

/** Which question kinds each round may contain. */
export const ROUND_KINDS: Record<GeneratedRound, readonly QuestionKind[]> = {
  ASSESSMENT: ['MCQ'],
  TECHNICAL: ['MCQ', 'SHORT_ANSWER'],
  SYSTEM_DESIGN: ['WRITTEN'],
  SCENARIO: ['WRITTEN'],
  HR: ['WRITTEN'],
};

export const DEFAULT_POINTS: Record<QuestionKind, number> = { MCQ: 1, SHORT_ANSWER: 2, WRITTEN: 5 };
export const MCQ_OPTION_COUNT = 4;
export const MAX_SET_SIZE = 100;
const TECHNICAL_MCQ_SHARE = 0.6;

/** The kind of each question to ask for. Technical is a 60/40 mix of MCQ and short answer; every other round has one kind. */
export function planKinds(roundType: GeneratedRound, count: number): QuestionKind[] {
  const n = Math.max(0, Math.floor(count));
  const kinds = ROUND_KINDS[roundType];
  if (kinds.length === 1) return Array<QuestionKind>(n).fill(kinds[0]);
  const mcq = Math.ceil(n * TECHNICAL_MCQ_SHARE);
  return [...Array<QuestionKind>(mcq).fill('MCQ'), ...Array<QuestionKind>(n - mcq).fill('SHORT_ANSWER')];
}

// ───────────────────────── Schemas ─────────────────────────

const promptSchema = z.string().trim().min(10, 'Question text must be at least 10 characters').max(1500, 'Question text is too long');
const pointsSchema = z.number().int().min(1, 'Points must be at least 1').max(20, 'Points cannot exceed 20');
const difficultySchema = z.enum(DIFFICULTIES);

export const rubricSchema = z.object({
  keyPoints: z
    .array(z.string().trim().min(3, 'Key points must be at least 3 characters').max(300))
    .min(2, 'Add at least 2 key points')
    .max(8, 'Use at most 8 key points'),
  sampleAnswer: z.string().trim().min(10, 'Add a sample answer').max(2500),
});
export type Rubric = z.infer<typeof rubricSchema>;

export const mcqFieldsSchema = z
  .object({
    prompt: promptSchema,
    options: z
      .array(z.string().trim().min(1, 'Options cannot be empty').max(300, 'An option is too long'))
      .length(MCQ_OPTION_COUNT, `Provide exactly ${MCQ_OPTION_COUNT} options`),
    correctIndex: z.number().int().min(0).max(MCQ_OPTION_COUNT - 1),
    points: pointsSchema.default(DEFAULT_POINTS.MCQ),
    difficulty: difficultySchema,
  })
  .superRefine((value, ctx) => {
    const distinct = new Set(value.options.map((o) => o.toLowerCase()));
    if (distinct.size !== value.options.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['options'], message: 'Options must all be different' });
    }
  });

function openFieldsSchema(kind: 'SHORT_ANSWER' | 'WRITTEN') {
  return z.object({
    prompt: promptSchema,
    rubric: rubricSchema,
    points: pointsSchema.default(DEFAULT_POINTS[kind]),
    difficulty: difficultySchema,
  });
}

export type McqFields = z.infer<typeof mcqFieldsSchema>;
export type OpenFields = z.infer<ReturnType<typeof openFieldsSchema>>;

export type NewQuestion =
  | ({ kind: 'MCQ' } & McqFields)
  | ({ kind: 'SHORT_ANSWER' | 'WRITTEN' } & OpenFields);

/** The editable fields of one question, validated for its kind. */
export function fieldsSchemaFor(kind: QuestionKind) {
  return kind === 'MCQ' ? mcqFieldsSchema : openFieldsSchema(kind);
}

/** A question as the admin sees it, answer key included. Never send this to a candidate. */
export interface AdminQuestion {
  id: string;
  kind: QuestionKind;
  position: number;
  prompt: string;
  options: string[] | null;
  correctIndex: number | null;
  rubric: Rubric | null;
  points: number;
  difficulty: Difficulty;
}

// ───────────────────────── Model output handling ─────────────────────────

/** Pulls the JSON object out of a model reply, tolerating markdown fences or a short preamble. */
export function extractJson(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('No JSON object found in the model output');
  return JSON.parse(text.slice(start, end + 1));
}

/**
 * Validates the questions in a parsed model reply. Items of the wrong kind or with missing/invalid fields are
 * counted in `rejected` and dropped. Difficulty and points always come from us, never from the model.
 */
export function parseGeneratedQuestions(
  raw: unknown,
  roundType: GeneratedRound,
  difficulty: Difficulty,
): { valid: NewQuestion[]; rejected: number } {
  const items = raw && typeof raw === 'object' ? (raw as { questions?: unknown }).questions : undefined;
  if (!Array.isArray(items)) throw new Error('The model output has no "questions" array');

  const allowed = ROUND_KINDS[roundType] as readonly string[];
  const valid: NewQuestion[] = [];
  let rejected = 0;
  for (const item of items) {
    const record = item && typeof item === 'object' ? (item as Record<string, unknown>) : null;
    const kind = record?.kind;
    if (!record || typeof kind !== 'string' || !allowed.includes(kind)) {
      rejected++;
      continue;
    }
    const k = kind as QuestionKind;
    const parsed = fieldsSchemaFor(k).safeParse({ ...record, difficulty, points: DEFAULT_POINTS[k] });
    if (!parsed.success) {
      rejected++;
      continue;
    }
    valid.push({ kind: k, ...parsed.data } as NewQuestion);
  }
  return { valid, rejected };
}

export function normalizePrompt(prompt: string): string {
  return prompt.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Drops questions whose text matches an earlier one (or one in `existing`), ignoring case and punctuation. */
export function dedupeQuestions<T extends { prompt: string }>(items: T[], existing: Iterable<string> = []): T[] {
  const seen = new Set([...existing].map(normalizePrompt));
  const out: T[] = [];
  for (const item of items) {
    const key = normalizePrompt(item.prompt);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

/** Models favour certain answer positions, so shuffle the options and remap the key. `rng` must return [0, 1). */
export function shuffleMcq<T extends { options: string[]; correctIndex: number }>(question: T, rng: () => number = Math.random): T {
  const order = question.options.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return { ...question, options: order.map((i) => question.options[i]), correctIndex: order.indexOf(question.correctIndex) };
}

/** Splits `total` into the fewest batches of at most `maxPerBatch`, as evenly as possible. */
export function splitBatches(total: number, maxPerBatch: number): number[] {
  if (total <= 0) return [];
  const batches = Math.ceil(total / maxPerBatch);
  const base = Math.floor(total / batches);
  const extra = total % batches;
  return Array.from({ length: batches }, (_, i) => base + (i < extra ? 1 : 0));
}

/** Spreads the required skills across batches so parallel batches cover different ground. */
export function assignFocus(skills: string[], batches: number): string[][] {
  return Array.from({ length: batches }, (_, batch) => {
    const mine = skills.filter((_skill, index) => index % batches === batch);
    return mine.length > 0 ? mine : skills;
  });
}

// ───────────────────────── Approval ─────────────────────────

export interface StoredQuestion {
  kind: QuestionKind;
  prompt: string;
  options: unknown;
  correctIndex: number | null;
  rubric: unknown;
  points: number;
  difficulty: Difficulty;
}

/** Problems that stop a draft from being approved. An empty array means it is ready. */
export function validateSetForApproval(questions: StoredQuestion[], required: number): string[] {
  const issues: string[] = [];
  if (questions.length < required) {
    issues.push(`This round needs at least ${required} questions (currently ${questions.length})`);
  }
  questions.forEach((q, i) => {
    const parsed = fieldsSchemaFor(q.kind).safeParse({
      prompt: q.prompt,
      options: q.options ?? undefined,
      correctIndex: q.correctIndex ?? undefined,
      rubric: q.rubric ?? undefined,
      points: q.points,
      difficulty: q.difficulty,
    });
    if (!parsed.success) issues.push(`Question ${i + 1}: ${parsed.error.issues[0].message}`);
  });
  return issues;
}
