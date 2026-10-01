import { describe, expect, it } from 'vitest';
import { CANDIDATE_CODE_REGEX, NUMBERED_CODE_REGEX, NUMBER_CODE_REGEX, buildCandidateCode, generateCandidateCode, normalizeCandidateCode, numberCodes } from '@/lib/candidate-code';

describe('candidate codes', () => {
  it('matches the documented format and avoids ambiguous characters', () => {
    for (let i = 0; i < 200; i++) {
      const code = generateCandidateCode();
      expect(code).toMatch(CANDIDATE_CODE_REGEX);
      expect(code.slice(5)).not.toMatch(/[01OIL]/);
    }
  });

  it('does not collide across a large sample', () => {
    const codes = new Set(Array.from({ length: 5000 }, generateCandidateCode));
    expect(codes.size).toBe(5000);
  });

  it('builds CAND- + 4 random letters + the running number, in order', () => {
    const codes = numberCodes(1002, 2);
    expect(codes[0]).toMatch(/^CAND-[A-Z]{4}1001$/);
    expect(codes[1]).toMatch(/^CAND-[A-Z]{4}1002$/);
    expect(numberCodes(1200, 200)[0]).toMatch(/1001$/);
    expect(numberCodes(10000, 1)[0]).toMatch(/^CAND-[A-Z]{4}10000$/);
    for (const code of numberCodes(1003, 3)) expect(code).toMatch(NUMBERED_CODE_REGEX);
  });

  it('uses no ambiguous letters in the random part', () => {
    for (let i = 0; i < 300; i++) expect(buildCandidateCode(1001).slice(5, 9)).not.toMatch(/[OIL]/);
  });

  it('accepts the current format, the first random format and plain numbers', () => {
    expect('CAND-KQMT1001').toMatch(CANDIDATE_CODE_REGEX);
    expect('CAND-AB23CD45').toMatch(CANDIDATE_CODE_REGEX);
    expect('1001').toMatch(CANDIDATE_CODE_REGEX);
    expect('CAND-KQ1001').not.toMatch(CANDIDATE_CODE_REGEX);
    expect('CAND-1234').not.toMatch(CANDIDATE_CODE_REGEX);
    expect('12').not.toMatch(CANDIDATE_CODE_REGEX);
    expect(NUMBER_CODE_REGEX.test('1001')).toBe(true);
  });

  it('normalises what candidates type', () => {
    expect(normalizeCandidateCode(' cand-kqmt1001 ')).toBe('CAND-KQMT1001');
  });
});
