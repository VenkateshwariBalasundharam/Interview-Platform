import { describe, expect, it } from 'vitest';
import {
  CODING_LANGUAGES,
  CODING_LANGUAGE_IDS,
  clip,
  fraction,
  isBetterSubmission,
  judgeTest,
  normalizeOutput,
  outputsMatch,
  overallVerdict,
  pickProblems,
  starterFor,
  summarize,
  verdictFromStatus,
  type PickableProblem,
} from '@/lib/coding';

describe('languages', () => {
  it('every language id has a definition with a unique Judge0 id and a starter', () => {
    expect(CODING_LANGUAGES.map((l) => l.id)).toEqual([...CODING_LANGUAGE_IDS]);
    expect(new Set(CODING_LANGUAGES.map((l) => l.judge0Id)).size).toBe(CODING_LANGUAGES.length);
    for (const l of CODING_LANGUAGES) expect(l.starter.length).toBeGreaterThan(10);
  });
  it('Java starts from a class called Main, which Judge0 requires', () => {
    expect(CODING_LANGUAGES.find((l) => l.id === 'java')!.starter).toContain('public class Main');
  });
  it('a problem starter wins over the template; blank or missing falls back', () => {
    expect(starterFor({ python: 'def solve(): pass' }, 'python')).toBe('def solve(): pass');
    expect(starterFor({ python: '   ' }, 'python')).toBe(CODING_LANGUAGES[0].starter);
    expect(starterFor(null, 'go')).toContain('package main');
    expect(starterFor([], 'go')).toContain('package main');
  });
});

describe('output comparison', () => {
  it('ignores line endings, trailing spaces and trailing blank lines', () => {
    expect(normalizeOutput('1 2 \r\n3\r\n\r\n')).toBe('1 2\n3');
    expect(outputsMatch('5\n', '5')).toBe(true);
    expect(outputsMatch('a b\n', 'a b   \n\n')).toBe(true);
  });
  it('still notices real differences, including leading whitespace and inner blank lines', () => {
    expect(outputsMatch(' 5', '5')).toBe(false);
    expect(outputsMatch('1\n\n2', '1\n2')).toBe(false);
    expect(outputsMatch('1 2', '1  2')).toBe(false);
    expect(outputsMatch(null, '')).toBe(true);
    expect(outputsMatch(null, '0')).toBe(false);
  });
});

describe('verdicts', () => {
  it('maps Judge0 statuses', () => {
    expect(verdictFromStatus(3)).toBe('PASSED');
    expect(verdictFromStatus(4)).toBe('WRONG_ANSWER');
    expect(verdictFromStatus(5)).toBe('TIME_LIMIT');
    expect(verdictFromStatus(6)).toBe('COMPILE_ERROR');
    for (const s of [7, 8, 9, 10, 11, 12]) expect(verdictFromStatus(s)).toBe('RUNTIME_ERROR');
    expect(verdictFromStatus(13)).toBe('ERROR');
    expect(verdictFromStatus(1)).toBe('ERROR');
  });
  it('a clean run is only a pass when the output matches', () => {
    expect(judgeTest({ statusId: 3, stdout: '42\n' }, '42')).toBe('PASSED');
    expect(judgeTest({ statusId: 3, stdout: '41\n' }, '42')).toBe('WRONG_ANSWER');
    expect(judgeTest({ statusId: 5, stdout: '42' }, '42')).toBe('TIME_LIMIT');
    expect(judgeTest({ statusId: 11, stdout: '42' }, '42')).toBe('RUNTIME_ERROR');
  });
  it('picks the most telling overall verdict', () => {
    expect(overallVerdict(['PASSED', 'PASSED'])).toBe('PASSED');
    expect(overallVerdict(['PASSED', 'WRONG_ANSWER', 'TIME_LIMIT'])).toBe('TIME_LIMIT');
    expect(overallVerdict(['COMPILE_ERROR', 'COMPILE_ERROR'])).toBe('COMPILE_ERROR');
    expect(overallVerdict([])).toBe('ERROR');
  });
});

describe('scoring', () => {
  it('counts passes and computes a fraction', () => {
    expect(summarize(['PASSED', 'WRONG_ANSWER', 'PASSED'])).toEqual({ passed: 2, total: 3 });
    expect(fraction(2, 3)).toBeCloseTo(0.6667, 3);
    expect(fraction(0, 0)).toBe(0);
  });
  it('only a strictly better submission replaces the best', () => {
    expect(isBetterSubmission(null, { passed: 0, total: 5 })).toBe(true);
    expect(isBetterSubmission({ passed: 3, total: 5 }, { passed: 4, total: 5 })).toBe(true);
    expect(isBetterSubmission({ passed: 3, total: 5 }, { passed: 3, total: 5 })).toBe(false);
    expect(isBetterSubmission({ passed: 3, total: 5 }, { passed: 2, total: 5 })).toBe(false);
  });
  it('compares fractions, so a changed test count is handled', () => {
    expect(isBetterSubmission({ passed: 2, total: 4 }, { passed: 6, total: 10 })).toBe(true);
    expect(isBetterSubmission({ passed: 5, total: 10 }, { passed: 2, total: 4 })).toBe(false);
  });
});

describe('pickProblems', () => {
  const mk = (id: string, jobId: string | null, difficulty: PickableProblem['difficulty'], day: number, sampleCount = 1, testCount = 3): PickableProblem => ({
    id, jobId, difficulty, createdAt: new Date(2026, 0, day), sampleCount, testCount,
  });
  it("puts the job's own problems first, then the nearest difficulty, then the oldest", () => {
    const list = [mk('g-hard', null, 'HARD', 1), mk('g-easy-old', null, 'EASY', 1), mk('g-easy-new', null, 'EASY', 5), mk('own-hard', 'j1', 'HARD', 9)];
    const picked = pickProblems(list, { jobId: 'j1', difficulty: 'EASY', count: 3 });
    expect(picked.map((p) => p.id)).toEqual(['own-hard', 'g-easy-old', 'g-easy-new']);
  });
  it('skips problems with no sample or no test, and returns fewer when the bank is short', () => {
    const list = [mk('no-sample', null, 'EASY', 1, 0, 3), mk('no-tests', null, 'EASY', 2, 1, 0), mk('ok', null, 'EASY', 3)];
    expect(pickProblems(list, { jobId: 'j', difficulty: 'EASY', count: 3 }).map((p) => p.id)).toEqual(['ok']);
  });
  it('is stable: the same input always gives the same order', () => {
    const list = [mk('b', null, 'MEDIUM', 1), mk('a', null, 'MEDIUM', 1)];
    expect(pickProblems(list, { jobId: 'j', difficulty: 'MEDIUM', count: 2 }).map((p) => p.id)).toEqual(['a', 'b']);
  });
});

describe('clip', () => {
  it('cuts long output and leaves short output alone', () => {
    expect(clip('abc', 10)).toBe('abc');
    expect(clip('x'.repeat(20), 5)).toContain('output cut');
    expect(clip(null)).toBe('');
  });
});
