import { describe, expect, it } from 'vitest';
import { normalizeLoginDob, parseDob } from '@/lib/dob';

const now = new Date('2026-06-01T00:00:00Z');

describe('parseDob', () => {
  it.each([
    ['15-08-2001', '15082001'],
    ['15/08/2001', '15082001'],
    ['15.08.2001', '15082001'],
    ['15082001', '15082001'],
    ['2001-08-15', '15082001'],
    ['5-8-2001', '05082001'],
    ['  01-02-1999 ', '01021999'],
  ])('accepts %s', (input, password) => {
    expect(parseDob(input, now)).toEqual({ ok: true, password });
  });

  it.each(['31-02-2000', '29-02-2001', '00-01-2000', '15-13-2000', 'abc', '', '15-08-01', '1508200'])('rejects %j', (input) => {
    expect(parseDob(input, now).ok).toBe(false);
  });

  it('accepts a leap day only in a leap year', () => {
    expect(parseDob('29-02-2000', now).ok).toBe(true);
  });

  it('rejects future dates and implausibly old dates', () => {
    expect(parseDob('01-01-2030', now)).toMatchObject({ ok: false });
    expect(parseDob('01-01-1899', now)).toMatchObject({ ok: false });
  });
});

describe('normalizeLoginDob', () => {
  it('keeps exactly eight digits and strips separators', () => {
    expect(normalizeLoginDob('15082001')).toBe('15082001');
    expect(normalizeLoginDob('15-08-2001')).toBe('15082001');
    expect(normalizeLoginDob(' 15/08/2001 ')).toBe('15082001');
  });
  it('rejects anything else', () => {
    expect(normalizeLoginDob('1508201')).toBeNull();
    expect(normalizeLoginDob('150820011')).toBeNull();
    expect(normalizeLoginDob('')).toBeNull();
  });
});
