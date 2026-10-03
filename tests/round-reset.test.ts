import { describe, expect, it } from 'vitest';
import { planRoundReset, resetRoundBodySchema, type ResetAttempt, type ResetRoundConfig } from '@/lib/round-reset';

const cfg = (roundType: ResetRoundConfig['roundType'], position: number, over: Partial<ResetRoundConfig> = {}): ResetRoundConfig => ({
  roundType,
  label: roundType,
  position,
  enabled: true,
  humanScored: false,
  cutoffPercent: 60,
  cutoffMode: 'DISQUALIFY',
  ...over,
});
const rounds = [cfg('ASSESSMENT', 1), cfg('CODING', 2, { cutoffPercent: 50 }), cfg('TECHNICAL', 3), cfg('HR', 4, { cutoffPercent: 50 }), cfg('MANAGER', 5, { humanScored: true })];
const graded = (roundType: ResetAttempt['roundType'], score: number, maxScore = 100): ResetAttempt => ({ roundType, status: 'GRADED', score, maxScore });
const inProgress = (roundType: ResetAttempt['roundType']): ResetAttempt => ({ roundType, status: 'IN_PROGRESS', score: null, maxScore: null });

const plan = (over: Partial<Parameters<typeof planRoundReset>[0]>) =>
  planRoundReset({ candidateStatus: 'ACTIVE', rounds, attempts: [], target: 'ASSESSMENT', aiCanDisqualify: false, ...over });

describe('planRoundReset: what can be reset', () => {
  it('resets the candidate’s only started round', () => {
    const p = plan({ attempts: [graded('ASSESSMENT', 80)] });
    expect(p.ok).toBe(true);
  });

  it('resets a round that is still in progress (a crashed session)', () => {
    const p = plan({ attempts: [inProgress('ASSESSMENT')] });
    expect(p.ok).toBe(true);
  });

  it('is a 404 when the candidate never started that round', () => {
    const p = plan({ attempts: [], target: 'CODING' });
    expect(p).toMatchObject({ ok: false, httpStatus: 404, code: 'ATTEMPT_NOT_FOUND' });
  });

  it('is a 404 for a round the job does not have or has switched off', () => {
    expect(plan({ target: 'SYSTEM_DESIGN', attempts: [] })).toMatchObject({ ok: false, httpStatus: 404, code: 'ROUND_NOT_IN_JOB' });
    const off = [cfg('ASSESSMENT', 1, { enabled: false })];
    expect(plan({ rounds: off, attempts: [graded('ASSESSMENT', 80)] })).toMatchObject({ ok: false, code: 'ROUND_NOT_IN_JOB' });
  });

  it('refuses the live Manager round: that is an admin score, not an attempt', () => {
    const p = plan({ target: 'MANAGER', attempts: [] });
    expect(p).toMatchObject({ ok: false, httpStatus: 409, code: 'ROUND_NOT_RESETTABLE' });
  });
});

describe('planRoundReset: rounds stay in order', () => {
  it('refuses to reset an earlier round while a later one has been started', () => {
    const p = plan({ target: 'ASSESSMENT', attempts: [graded('ASSESSMENT', 80), graded('CODING', 70)] });
    expect(p).toMatchObject({ ok: false, httpStatus: 409, code: 'LATER_ROUNDS_STARTED' });
    if (!p.ok) expect(p.message).toContain('CODING');
  });

  it('names every later round, and counts a later round that is only in progress', () => {
    const p = plan({ target: 'ASSESSMENT', attempts: [graded('ASSESSMENT', 80), graded('CODING', 70), inProgress('TECHNICAL')] });
    if (p.ok) throw new Error('expected a refusal');
    expect(p.message).toContain('CODING, TECHNICAL');
    expect(p.message).toContain('latest first');
  });

  it('allows resetting the latest round, then the one before it', () => {
    const attempts = [graded('ASSESSMENT', 80), graded('CODING', 70)];
    expect(plan({ target: 'CODING', attempts }).ok).toBe(true);
    expect(plan({ target: 'ASSESSMENT', attempts: [graded('ASSESSMENT', 80)] }).ok).toBe(true);
  });

  it('ignores pipeline order in the arrays: only the configured position matters', () => {
    const shuffled = [rounds[3], rounds[0], rounds[2], rounds[1], rounds[4]];
    expect(plan({ rounds: shuffled, target: 'CODING', attempts: [graded('ASSESSMENT', 80), graded('CODING', 70), graded('TECHNICAL', 70)] })).toMatchObject({ ok: false, code: 'LATER_ROUNDS_STARTED' });
  });
});

describe('planRoundReset: candidate status afterwards', () => {
  it('Active stays Active', () => {
    const p = plan({ attempts: [graded('ASSESSMENT', 80)] });
    expect(p).toMatchObject({ ok: true, nextStatus: 'ACTIVE', statusChanges: false });
  });

  it('Completed goes back to Active (the result is being redone)', () => {
    const all = [graded('ASSESSMENT', 80), graded('CODING', 70), graded('TECHNICAL', 70), graded('HR', 70)];
    const p = plan({ candidateStatus: 'COMPLETED', target: 'HR', attempts: all });
    expect(p).toMatchObject({ ok: true, nextStatus: 'ACTIVE', statusChanges: true });
  });

  it('Disqualified by this round goes back to Active', () => {
    const p = plan({ candidateStatus: 'DISQUALIFIED', attempts: [graded('ASSESSMENT', 40)] });
    expect(p).toMatchObject({ ok: true, nextStatus: 'ACTIVE', statusChanges: true });
  });

  it('exactly at the cutoff counts as passing, so it did not cause a disqualification', () => {
    const p = plan({ candidateStatus: 'DISQUALIFIED', attempts: [graded('ASSESSMENT', 60)] });
    expect(p).toMatchObject({ ok: true, nextStatus: 'DISQUALIFIED', statusChanges: false });
  });

  it('a near-miss is never rounded up to the cutoff', () => {
    const p = plan({ candidateStatus: 'DISQUALIFIED', attempts: [graded('ASSESSMENT', 59.996)] });
    expect(p).toMatchObject({ ok: true, nextStatus: 'ACTIVE', statusChanges: true });
  });

  it('Pending review caused by this round goes back to Active', () => {
    const p = plan({ candidateStatus: 'PENDING_REVIEW', attempts: [graded('ASSESSMENT', 40)] });
    expect(p).toMatchObject({ ok: true, nextStatus: 'ACTIVE' });
  });

  it('a flag or rejection from another round is left alone when this round passed', () => {
    const attempts = [graded('ASSESSMENT', 40), graded('CODING', 90)]; // flagged earlier and approved, later rejected for other reasons
    const p = plan({ candidateStatus: 'DISQUALIFIED', target: 'CODING', attempts });
    expect(p).toMatchObject({ ok: true, nextStatus: 'DISQUALIFIED', statusChanges: false });
  });

  it('an AI-graded round below cutoff counts as the cause even when it only flagged', () => {
    const p = plan({ candidateStatus: 'PENDING_REVIEW', target: 'TECHNICAL', attempts: [graded('ASSESSMENT', 80), graded('CODING', 80), graded('TECHNICAL', 30)] });
    expect(p).toMatchObject({ ok: true, nextStatus: 'ACTIVE' });
  });

  it('a disqualified candidate whose round is not graded yet keeps their status', () => {
    const p = plan({ candidateStatus: 'DISQUALIFIED', attempts: [{ roundType: 'ASSESSMENT', status: 'SUBMITTED', score: null, maxScore: null }] });
    expect(p).toMatchObject({ ok: true, nextStatus: 'DISQUALIFIED', statusChanges: false });
  });
});

describe('resetRoundBodySchema', () => {
  it('needs a real reason', () => {
    expect(resetRoundBodySchema.safeParse({}).success).toBe(false);
    expect(resetRoundBodySchema.safeParse({ reason: '   ok  ' }).success).toBe(false);
    expect(resetRoundBodySchema.safeParse({ reason: 'x'.repeat(501) }).success).toBe(false);
    const ok = resetRoundBodySchema.safeParse({ reason: '  Power cut at minute 12  ' });
    expect(ok.success && ok.data.reason).toBe('Power cut at minute 12');
  });
});
