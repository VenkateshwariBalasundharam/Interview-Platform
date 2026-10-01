import { describe, expect, it } from 'vitest';
import { MAX_ANSWER_CHARS, answerBodySchema, cleanAnswerText, isOpenKind, readChoice, readText } from '@/lib/answer-input';

describe('answerBodySchema', () => {
  it('accepts a choice, a cleared choice and typed text', () => {
    expect(answerBodySchema.safeParse({ questionId: 'q1', choice: 2 }).success).toBe(true);
    expect(answerBodySchema.safeParse({ questionId: 'q1', choice: null }).success).toBe(true);
    expect(answerBodySchema.safeParse({ questionId: 'q1', text: 'An index speeds up reads.' }).success).toBe(true);
    expect(answerBodySchema.safeParse({ questionId: 'q1', text: '' }).success).toBe(true);
  });

  it('rejects a body with both fields, neither, or extra fields', () => {
    expect(answerBodySchema.safeParse({ questionId: 'q1', choice: 1, text: 'x' }).success).toBe(false);
    expect(answerBodySchema.safeParse({ questionId: 'q1' }).success).toBe(false);
    expect(answerBodySchema.safeParse({ questionId: 'q1', choice: 1, score: 5 }).success).toBe(false);
  });

  it('rejects bad choices and oversized payloads', () => {
    expect(answerBodySchema.safeParse({ questionId: 'q1', choice: -1 }).success).toBe(false);
    expect(answerBodySchema.safeParse({ questionId: 'q1', choice: 1.5 }).success).toBe(false);
    expect(answerBodySchema.safeParse({ questionId: 'q1', text: 'x'.repeat(MAX_ANSWER_CHARS.WRITTEN * 2 + 1) }).success).toBe(false);
    expect(answerBodySchema.safeParse({ questionId: '', text: 'x' }).success).toBe(false);
  });
});

describe('cleanAnswerText', () => {
  it('normalises line endings and trims the ends', () => {
    expect(cleanAnswerText('  line one\r\nline two\rline three  ')).toBe('line one\nline two\nline three');
  });

  it('removes characters PostgreSQL jsonb cannot store', () => {
    expect(cleanAnswerText('a\u0000b\u0007c')).toBe('abc');
    expect(cleanAnswerText('bad \uD800 half')).toBe('bad \uFFFD half');
    expect(JSON.stringify(cleanAnswerText('x\uDC00y'))).not.toContain('\\udc00');
  });

  it('keeps tabs, newlines and real emoji', () => {
    expect(cleanAnswerText('a\tb\nc 😀')).toBe('a\tb\nc 😀');
  });

  it('turns whitespace-only text into an empty string', () => {
    expect(cleanAnswerText('  \n\t ')).toBe('');
  });
});

describe('reading stored answers', () => {
  it('readChoice and readText do not confuse the two shapes', () => {
    expect(readChoice({ text: 'x' })).toBeNull();
    expect(readText({ choice: 1 })).toBe('');
    expect(readChoice({ choice: 0 })).toBe(0);
  });

  it('isOpenKind is true only for typed kinds', () => {
    expect(isOpenKind('SHORT_ANSWER')).toBe(true);
    expect(isOpenKind('WRITTEN')).toBe(true);
    expect(isOpenKind('MCQ')).toBe(false);
  });
});
