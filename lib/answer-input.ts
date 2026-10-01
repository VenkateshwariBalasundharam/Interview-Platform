// What a candidate may send and what is stored for an answer. Pure and client-safe (no server imports).
import { z } from 'zod';

/** Character limits for typed answers. Enforced by the server; the exam screen mirrors them. */
export const MAX_ANSWER_CHARS = { SHORT_ANSWER: 1200, WRITTEN: 6000 } as const;
export type OpenKind = keyof typeof MAX_ANSWER_CHARS;

export function isOpenKind(kind: string): kind is OpenKind {
  return kind === 'SHORT_ANSWER' || kind === 'WRITTEN';
}

const questionId = z.string().min(1).max(64);

/**
 * One autosave request: either a multiple-choice pick or typed text. The text cap here is only a payload guard;
 * the real per-kind limit is checked once the question's kind is known.
 */
export const answerBodySchema = z.union([
  z.object({ questionId, choice: z.number().int().min(0).max(9).nullable() }).strict(),
  z.object({ questionId, text: z.string().max(MAX_ANSWER_CHARS.WRITTEN * 2) }).strict(),
]);
export type AnswerBody = z.infer<typeof answerBodySchema>;

// Control characters (except tab and newline) and lone surrogates. PostgreSQL's jsonb refuses NUL and
// unpaired surrogates, so a single pasted character could otherwise make every autosave fail.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const LONE_SURROGATES = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/** Normalises typed text for storage: LF line endings, no control characters, no stray whitespace at the ends. */
export function cleanAnswerText(text: string): string {
  return text.replace(/\r\n?/g, '\n').replace(CONTROL_CHARS, '').replace(LONE_SURROGATES, '\uFFFD').trim();
}

/** Multiple-choice answers are stored as { choice: number }. Anything else (or null) means unanswered. */
export function readChoice(response: unknown): number | null {
  if (!response || typeof response !== 'object') return null;
  const choice = (response as { choice?: unknown }).choice;
  return typeof choice === 'number' && Number.isInteger(choice) && choice >= 0 ? choice : null;
}

/** Typed answers are stored as { text: string }. Anything else means an empty answer. */
export function readText(response: unknown): string {
  if (!response || typeof response !== 'object') return '';
  const text = (response as { text?: unknown }).text;
  return typeof text === 'string' ? text : '';
}
