import { describe, expect, it } from 'vitest';
import { evaluateWindow } from '@/lib/ratelimit-core';

const windowStart = new Date('2026-01-01T10:00:00Z');
const windowMs = 15 * 60 * 1000;

describe('rate limit window', () => {
  it('allows hits up to and including the limit', () => {
    const now = new Date(windowStart.getTime() + 1000);
    expect(evaluateWindow({ count: 5, windowStart, limit: 5, windowMs, now })).toEqual({ allowed: true, remaining: 0, retryAfterSec: 0 });
    expect(evaluateWindow({ count: 1, windowStart, limit: 5, windowMs, now }).remaining).toBe(4);
  });

  it('blocks once the limit is exceeded and reports when the window resets', () => {
    const now = new Date(windowStart.getTime() + 60_000);
    const r = evaluateWindow({ count: 6, windowStart, limit: 5, windowMs, now });
    expect(r.allowed).toBe(false);
    expect(r.remaining).toBe(0);
    expect(r.retryAfterSec).toBe(14 * 60);
  });

  it('never reports a retry time below one second', () => {
    const now = new Date(windowStart.getTime() + windowMs + 5000);
    expect(evaluateWindow({ count: 9, windowStart, limit: 5, windowMs, now }).retryAfterSec).toBe(1);
  });
});
