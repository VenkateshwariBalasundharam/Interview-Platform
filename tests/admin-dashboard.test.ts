import { describe, expect, it } from 'vitest';
import { averageByRound, funnel, matchesTab, outcomeCounts, outcomeOf, parseTab, roundCompletion, share, tabCounts } from '@/lib/admin-dashboard-core';

const c = (status: string, finalDecision: string | null = null, hasAttempt = true) => ({ status, finalDecision, hasAttempt });

describe('outcomeOf', () => {
  it('puts each candidate in exactly one outcome, strongest first', () => {
    expect(outcomeOf(c('DISQUALIFIED', 'SHORTLIST'))).toBe('disqualified');
    expect(outcomeOf(c('COMPLETED', 'SHORTLIST'))).toBe('shortlisted');
    expect(outcomeOf(c('COMPLETED', 'REJECT'))).toBe('rejected');
    expect(outcomeOf(c('PENDING_REVIEW'))).toBe('pending');
    expect(outcomeOf(c('COMPLETED'))).toBe('awaiting');
    expect(outcomeOf(c('ACTIVE'))).toBe('in_progress');
    expect(outcomeOf(c('ACTIVE', null, false))).toBe('not_started');
  });
  it('the parts add up to the total', () => {
    const list = [c('ACTIVE', null, false), c('ACTIVE'), c('COMPLETED'), c('COMPLETED', 'SHORTLIST'), c('DISQUALIFIED'), c('PENDING_REVIEW'), c('COMPLETED', 'REJECT')];
    const counts = outcomeCounts(list);
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(list.length);
    expect(counts.shortlisted).toBe(1);
  });
});

describe('funnel', () => {
  it('counts the four steps and their share of everyone registered', () => {
    const f = funnel([c('ACTIVE', null, false), c('ACTIVE'), c('COMPLETED', 'SHORTLIST'), c('COMPLETED', 'REJECT')]);
    expect(f.map((s) => s.value)).toEqual([4, 3, 2, 1]);
    expect(f.map((s) => s.percent)).toEqual([100, 75, 50, 25]);
  });
  it('is all zero with no candidates', () => {
    expect(funnel([]).every((s) => s.value === 0 && s.percent === 0)).toBe(true);
  });
});

describe('averages and completion', () => {
  it('averages graded attempts only, ignoring blanks', () => {
    const avg = averageByRound([
      { roundType: 'CODING', status: 'GRADED', percent: 100 },
      { roundType: 'CODING', status: 'GRADED', percent: 50 },
      { roundType: 'CODING', status: 'IN_PROGRESS', percent: null },
      { roundType: 'HR', status: 'GRADED', percent: null },
      { roundType: 'HR', status: 'SUBMITTED', percent: 10 },
    ]);
    expect(avg).toEqual([{ roundType: 'CODING', average: 75, count: 2 }]);
  });
  it('round completion follows the given order and skips rounds nobody has handed in', () => {
    const out = roundCompletion(
      [
        { roundType: 'CODING', status: 'GRADED' },
        { roundType: 'ASSESSMENT', status: 'GRADED' },
        { roundType: 'ASSESSMENT', status: 'SUBMITTED' },
        { roundType: 'HR', status: 'IN_PROGRESS' },
      ],
      4,
      ['ASSESSMENT', 'TECHNICAL', 'CODING', 'HR'] as const,
    );
    expect(out).toEqual([
      { roundType: 'ASSESSMENT', value: 2, percent: 50 },
      { roundType: 'CODING', value: 1, percent: 25 },
    ]);
  });
  it('share shows a dash for nobody', () => {
    expect(share(1, 4)).toBe('25%');
    expect(share(0, 0)).toBe('–');
  });
});

describe('candidate tabs', () => {
  it('parses the tab from the address, falling back to all', () => {
    expect(parseTab('pending')).toBe('pending');
    expect(parseTab('nonsense')).toBe('all');
    expect(parseTab(undefined)).toBe('all');
  });
  it('filters and counts', () => {
    const list = [c('PENDING_REVIEW'), c('COMPLETED'), c('COMPLETED', 'SHORTLIST'), c('COMPLETED', 'REJECT'), c('DISQUALIFIED'), c('ACTIVE')];
    expect(tabCounts(list)).toEqual({ all: 6, pending: 1, awaiting: 1, shortlisted: 1, rejected: 1, disqualified: 1 });
    expect(list.filter((x) => matchesTab('shortlisted', x))).toHaveLength(1);
    expect(list.filter((x) => matchesTab('all', x))).toHaveLength(6);
  });
});
