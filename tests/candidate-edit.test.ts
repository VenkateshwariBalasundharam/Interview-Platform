import { describe, expect, it } from 'vitest';
import { updateCandidateSchema } from '@/lib/candidate-edit';

const issues = (input: unknown) => {
  const r = updateCandidateSchema.safeParse(input);
  return r.success ? [] : r.error.issues.map((i) => i.message);
};

describe('updateCandidateSchema', () => {
  it('accepts a single changed field', () => {
    expect(updateCandidateSchema.safeParse({ name: '  Tharani S ' }).success).toBe(true);
    expect(updateCandidateSchema.parse({ name: '  Tharani S ' }).name).toBe('Tharani S');
  });

  it('lowercases and trims the email, and rejects a bad one', () => {
    expect(updateCandidateSchema.parse({ email: '  Tharani@Gmail.COM ' }).email).toBe('tharani@gmail.com');
    expect(issues({ email: 'not-an-email' })).toContain('Email is not valid');
  });

  it('rejects an empty name', () => {
    expect(issues({ name: '   ' })).toContain('Name is required');
  });

  it('accepts a real date of birth in the date-picker format', () => {
    expect(updateCandidateSchema.safeParse({ dob: '2001-08-15' }).success).toBe(true);
  });

  it('rejects an impossible or future date of birth', () => {
    expect(issues({ dob: '2001-02-31' })).toContain('Date of birth is not a real calendar date');
    expect(issues({ dob: '2999-01-01' })).toContain('Date of birth is in the future');
  });

  it('treats a blank date of birth as "keep the current one"', () => {
    expect(updateCandidateSchema.safeParse({ name: 'A', dob: '' }).success).toBe(true);
    expect(issues({ dob: '' })).toContain('Nothing to change');
  });

  it('accepts a job change on its own', () => {
    expect(updateCandidateSchema.safeParse({ jobId: 'cjld2cjxh0000qzrmn831i7rn' }).success).toBe(true);
  });

  it('rejects a blank job id', () => {
    expect(issues({ jobId: '   ' })).toContain('Pick a job');
  });

  it('accepts unlock on its own', () => {
    expect(updateCandidateSchema.safeParse({ unlock: true }).success).toBe(true);
  });

  it('rejects a request that changes nothing', () => {
    expect(issues({})).toContain('Nothing to change');
    expect(issues({ unlock: false })).toContain('Nothing to change');
  });
});
