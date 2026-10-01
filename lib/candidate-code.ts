import { randomInt } from 'node:crypto';

// No 0/O/1/I/L so codes can be read out over a call without confusion.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;
/** The first random format (CAND- plus 8 random characters), still valid for candidates created before running numbers. */
export const RANDOM_CODE_REGEX = /^CAND-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/;
/** Current format: CAND- + 4 random letters + a running number, e.g. CAND-KQMT1001. */
export const NUMBERED_CODE_REGEX = /^CAND-[ABCDEFGHJKMNPQRSTUVWXYZ]{4}\d{4,9}$/;
/** A bare running number (the briefly used plain format), still accepted at sign-in. */
export const NUMBER_CODE_REGEX = /^\d{4,9}$/;
export const CANDIDATE_CODE_REGEX = /^(?:CAND-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}|CAND-[ABCDEFGHJKMNPQRSTUVWXYZ]{4}\d{4,9}|\d{4,9})$/;
export const FIRST_CANDIDATE_NUMBER = 1001;

const LETTERS = 'ABCDEFGHJKMNPQRSTUVWXYZ';

/** CAND-<4 random letters><running number>. The number makes every ID unique; the letters make the ID harder to guess. */
export function buildCandidateCode(number: number): string {
  let letters = '';
  for (let i = 0; i < 4; i++) letters += LETTERS[randomInt(LETTERS.length)];
  return `CAND-${letters}${number}`;
}

/** The IDs for a block of `count` candidates whose block ends at `lastNumber` (the counter value after reserving it). */
export function numberCodes(lastNumber: number, count: number): string[] {
  const first = lastNumber - count + 1;
  return Array.from({ length: count }, (_, i) => buildCandidateCode(first + i));
}

export function generateCandidateCode(): string {
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  return `CAND-${out}`;
}

export function normalizeCandidateCode(input: string): string {
  return input.trim().toUpperCase();
}
