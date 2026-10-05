import { describe, expect, it } from 'vitest';
import { buildResultsCsv, computeFinalResult, decisionBadge, decisionBodySchema, isPending, managerScoreSchema, meetsCutoff, type ResultInput, type RoundInput } from '@/lib/final-result';

const round = (over: Partial<RoundInput> & Pick<RoundInput, 'roundType'>): RoundInput => ({
  label: over.roundType,
  weight: 25,
  cutoffPercent: 60,
  required: true,
  aiGraded: false,
  percent: null,
  ...over,
});

const input = (rounds: RoundInput[], candidateStatus: ResultInput['candidateStatus'] = 'ACTIVE'): ResultInput => ({ candidateStatus, rounds });

describe('weighted score', () => {
  it('is the weighted sum of the round percents, out of 100', () => {
    const r = computeFinalResult(input([round({ roundType: 'ASSESSMENT', weight: 30, percent: 80 }), round({ roundType: 'CODING', weight: 70, percent: 50 })]));
    expect(r.weightedScore).toBe(59); // 0.3*80 + 0.7*50
    expect(r.rounds.map((x) => x.weightPercent)).toEqual([30, 70]);
    expect(r.rounds.map((x) => x.contribution)).toEqual([24, 35]);
  });

  it('normalises weights that do not add up to 100', () => {
    const r = computeFinalResult(input([round({ roundType: 'ASSESSMENT', weight: 1, percent: 100 }), round({ roundType: 'CODING', weight: 3, percent: 0 })]));
    expect(r.weightedScore).toBe(25);
  });

  it('counts a round with no score as 0', () => {
    const r = computeFinalResult(input([round({ roundType: 'ASSESSMENT', weight: 50, percent: 100 }), round({ roundType: 'CODING', weight: 50, percent: null })]));
    expect(r.weightedScore).toBe(50);
    expect(r.complete).toBe(false);
  });

  it('leaves an optional round out when the candidate did not take it, and counts it when they did', () => {
    const base = [round({ roundType: 'ASSESSMENT', weight: 50, percent: 80 })];
    const skipped = computeFinalResult(input([...base, round({ roundType: 'SCENARIO', weight: 50, required: false, percent: null })]));
    expect(skipped.weightedScore).toBe(80);
    expect(skipped.complete).toBe(true);
    expect(skipped.rounds[1].counted).toBe(false);
    const taken = computeFinalResult(input([...base, round({ roundType: 'SCENARIO', weight: 50, required: false, percent: 40 })]));
    expect(taken.weightedScore).toBe(60);
  });

  it('weights rounds equally when every weight is 0, and never divides by zero', () => {
    const r = computeFinalResult(input([round({ roundType: 'ASSESSMENT', weight: 0, percent: 90 }), round({ roundType: 'CODING', weight: 0, percent: 70 })]));
    expect(r.weightedScore).toBe(80);
    expect(computeFinalResult(input([])).weightedScore).toBe(0);
  });

  it('rounds to two decimals', () => {
    const r = computeFinalResult(input([round({ roundType: 'ASSESSMENT', weight: 1, percent: 100 }), round({ roundType: 'CODING', weight: 2, percent: 50 })]));
    expect(r.weightedScore).toBe(66.67);
  });
});

describe('cutoff', () => {
  it('is met at the cutoff and missed just under it, with no rounding', () => {
    expect(meetsCutoff(60, 60)).toBe(true);
    expect(meetsCutoff(59.996, 60)).toBe(false);
  });
});

describe('suggestion', () => {
  const pass = [round({ roundType: 'ASSESSMENT', percent: 70 }), round({ roundType: 'TECHNICAL', aiGraded: true, percent: 65 })];

  it('suggests nothing while a required round has no score', () => {
    const r = computeFinalResult(input([pass[0], round({ roundType: 'TECHNICAL', aiGraded: true, percent: null })]));
    expect(r.suggestion).toBeNull();
    expect(r.reasons).toEqual([]);
  });

  it('suggests shortlisting when every round is finished at or above its cutoff', () => {
    const r = computeFinalResult(input(pass));
    expect(r.suggestion).toBe('SHORTLIST');
    expect(r.complete).toBe(true);
    expect(r.rejectionRestsOnAi).toBe(false);
  });

  it('asks for a person (never a silent reject) when a finished round is below its cutoff', () => {
    const r = computeFinalResult(input([pass[0], round({ roundType: 'TECHNICAL', aiGraded: true, percent: 40 })]));
    expect(r.suggestion).toBe('REVIEW');
    expect(r.reasons[0]).toContain('TECHNICAL');
  });

  it('suggests rejecting a disqualified candidate and names the round below its cutoff', () => {
    const r = computeFinalResult(input([round({ roundType: 'ASSESSMENT', label: 'Assessment', percent: 30 }), round({ roundType: 'CODING', label: 'Coding', percent: null })], 'DISQUALIFIED'));
    expect(r.suggestion).toBe('REJECT');
    expect(r.reasons[0]).toContain('Assessment');
    expect(r.rejectionRestsOnAi).toBe(false);
  });

  it('flags a rejection that rests on an AI-graded round', () => {
    const r = computeFinalResult(input([pass[0], round({ roundType: 'HR', aiGraded: true, percent: 20 })], 'DISQUALIFIED'));
    expect(r.suggestion).toBe('REJECT');
    expect(r.rejectionRestsOnAi).toBe(true);
  });

  it('handles a rejection made by an admin at review, with no round below its cutoff', () => {
    const r = computeFinalResult(input(pass, 'DISQUALIFIED'));
    expect(r.suggestion).toBe('REJECT');
    expect(r.reasons).toEqual(['Rejected after review.']);
    expect(r.rejectionRestsOnAi).toBe(false);
  });

  it('is pending until a person decides', () => {
    expect(isPending(null)).toBe(true);
    expect(isPending('SHORTLIST')).toBe(false);
  });
});

describe('request validation', () => {
  it('accepts a whole Manager score from 0 to 100 only', () => {
    expect(managerScoreSchema.safeParse({ score: 0 }).success).toBe(true);
    expect(managerScoreSchema.safeParse({ score: 100, notes: 'Strong' }).success).toBe(true);
    for (const score of [-1, 101, 55.5, '70', null]) expect(managerScoreSchema.safeParse({ score }).success).toBe(false);
    expect(managerScoreSchema.safeParse({ score: 50, notes: 'x'.repeat(2001) }).success).toBe(false);
  });

  it('accepts only SHORTLIST or REJECT as a decision (REVIEW is a suggestion, not a decision)', () => {
    expect(decisionBodySchema.safeParse({ decision: 'SHORTLIST' }).success).toBe(true);
    expect(decisionBodySchema.safeParse({ decision: 'REJECT', note: 'Missed the bar' }).success).toBe(true);
    expect(decisionBodySchema.safeParse({ decision: 'REVIEW' }).success).toBe(false);
    expect(decisionBodySchema.safeParse({}).success).toBe(false);
  });
});

describe('CSV export', () => {
  const labels = { ASSESSMENT: 'Assessment', CODING: 'Coding', MANAGER: 'Manager' };
  const row = {
    candidateCode: 'C-001',
    name: 'Asha Verma',
    email: 'asha@example.com',
    job: 'Backend Engineer',
    status: 'PENDING_REVIEW',
    roundPercents: { ASSESSMENT: 72.5, CODING: null } as Record<string, number | null>,
    weightedScore: 41.25,
    suggestion: 'REVIEW',
    finalDecision: null,
    rejectionRestsOnAi: false,
    proctorEvents: 3,
  };

  it('has a header, a Byte Order Mark for Excel, and a column per round the job uses', () => {
    const csv = buildResultsCsv([row], labels);
    expect(csv.startsWith('\uFEFF"Candidate ID"')).toBe(true);
    const [header, line] = csv.replace('\uFEFF', '').trim().split('\r\n');
    expect(header).toBe('"Candidate ID","Name","Email","Job","Status","Assessment %","Coding %","Weighted score","Suggested decision","Final decision","Rests on AI-graded answers","Proctoring events"');
    expect(line).toBe('"C-001","Asha Verma","asha@example.com","Backend Engineer","pending review",72.5,,41.25,"Needs a decision","Pending",,3');
  });

  it('marks decided rows and AI-based rejections', () => {
    const csv = buildResultsCsv([{ ...row, suggestion: 'REJECT', finalDecision: 'REJECT', rejectionRestsOnAi: true }], labels);
    expect(csv).toContain('"Reject","Reject",Yes,3');
  });

  it('neutralises spreadsheet formulas in names and emails', () => {
    const csv = buildResultsCsv([{ ...row, name: '=HYPERLINK("http://evil")', email: '+cmd@x.com' }], labels);
    expect(csv).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(csv).toContain(`"'+cmd@x.com"`);
  });

  it('leaves out round columns no row uses and copes with no rows', () => {
    expect(buildResultsCsv([row], labels)).not.toContain('Manager %');
    expect(buildResultsCsv([], labels).trim().split('\r\n')).toHaveLength(1);
  });
});

describe('decisionBadge', () => {
  it('labels the final decision, and shows nothing while undecided', () => {
    expect(decisionBadge('SHORTLIST')).toEqual({ label: 'shortlisted', tone: 'good' });
    expect(decisionBadge('REJECT')).toEqual({ label: 'rejected', tone: 'bad' });
    expect(decisionBadge(null)).toBeNull();
    expect(decisionBadge('SOMETHING_ELSE')).toBeNull();
  });
});
