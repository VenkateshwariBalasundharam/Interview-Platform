import { describe, expect, it } from 'vitest';
import { CODING_BANK, solve } from '../prisma/coding-bank';

describe('coding bank', () => {
  it('has unique titles and every problem has samples, hidden tests and a statement with formats', () => {
    expect(new Set(CODING_BANK.map((p) => p.title)).size).toBe(CODING_BANK.length);
    for (const p of CODING_BANK) {
      expect(p.samples.length).toBeGreaterThanOrEqual(1);
      expect(p.hidden().length).toBeGreaterThanOrEqual(4);
      expect(p.statement).toContain('Input format');
      expect(p.statement).toContain('Output format');
    }
  });

  it('covers all three difficulties', () => {
    for (const d of ['EASY', 'MEDIUM', 'HARD']) expect(CODING_BANK.some((p) => p.difficulty === d)).toBe(true);
  });

  it('hidden tests are the same every time the seed runs', () => {
    for (const p of CODING_BANK) expect(p.hidden()).toEqual(p.hidden());
  });

  it('every test has non-empty input and output, and the input ends with a newline', () => {
    for (const p of CODING_BANK) for (const c of [...p.samples, ...p.hidden()]) {
      expect(c.input.endsWith('\n')).toBe(true);
      expect(c.output.length).toBeGreaterThan(0);
    }
  });

  it('inputs stay a sensible size (under 1 MB) so they fit a request to the runner', () => {
    for (const p of CODING_BANK) for (const c of p.hidden()) expect(c.input.length).toBeLessThan(1_000_000);
  });

  it('known answers: statement samples and a few classic cases', () => {
    expect(solve.reverseWords('hello world')).toBe('world hello');
    expect(solve.palindrome('0P')).toBe('NO');
    expect(solve.palindrome('!!!')).toBe('YES');
    expect(solve.twoSum('4 9\n2 7 11 15')).toBe('1 2');
    expect(solve.brackets('([)]')).toBe('NO');
    expect(solve.mergeIntervals('2\n1 4\n4 5')).toBe('1 5');
    expect(solve.longestUnique('pwwkew')).toBe('3');
    expect(solve.lis('4\n7 7 7 7')).toBe('1');
    expect(solve.coinChange('4 6249\n186 419 83 408')).toBe('20');
    expect(solve.coinChange('1 3\n2')).toBe('-1');
  });

  it('the samples shown to candidates agree with the reference solutions', () => {
    const byTitle = Object.fromEntries(CODING_BANK.map((p) => [p.title, p]));
    const check = (title: string, fn: (input: string) => string) => {
      for (const s of byTitle[title].samples) expect(fn(s.input)).toBe(s.output);
    };
    check('Reverse the Words', solve.reverseWords);
    check('Palindrome Check', solve.palindrome);
    check('Two Sum (Indices)', solve.twoSum);
    check('Balanced Brackets', solve.brackets);
    check('Longest Substring Without Repeats', solve.longestUnique);
    check('Merge Intervals', solve.mergeIntervals);
    check('Longest Increasing Subsequence', solve.lis);
    check('Minimum Coins', solve.coinChange);
  });
});
