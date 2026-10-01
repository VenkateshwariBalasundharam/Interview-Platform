import { describe, expect, it } from 'vitest';
import { evaluateLock, lockUntilAfterFailure, LOCK_MS, MAX_FAILED_ATTEMPTS } from '@/lib/lockout';

const now = new Date('2026-01-01T10:00:00Z');

describe('account lockout', () => {
  it('locks after the fifth failure and not before', () => {
    for (let n = 1; n < MAX_FAILED_ATTEMPTS; n++) expect(lockUntilAfterFailure(n, now)).toBeNull();
    expect(lockUntilAfterFailure(MAX_FAILED_ATTEMPTS, now)?.getTime()).toBe(now.getTime() + 15 * 60 * 1000);
    expect(LOCK_MS).toBe(15 * 60 * 1000);
  });

  it('reports remaining time while locked', () => {
    const lockedUntil = new Date(now.getTime() + 90_000);
    expect(evaluateLock({ failedLoginCount: 0, lockedUntil }, now)).toEqual({ locked: true, retryAfterSec: 90, expired: false });
  });

  it('treats an expired lock as unlocked and asks for a counter reset', () => {
    const lockedUntil = new Date(now.getTime() - 1000);
    expect(evaluateLock({ failedLoginCount: 0, lockedUntil }, now)).toEqual({ locked: false, retryAfterSec: 0, expired: true });
  });

  it('is unlocked when there is no lock', () => {
    expect(evaluateLock({ failedLoginCount: 3, lockedUntil: null }, now)).toEqual({ locked: false, retryAfterSec: 0, expired: false });
  });

  it('unlocks exactly at the boundary', () => {
    expect(evaluateLock({ failedLoginCount: 0, lockedUntil: new Date(now) }, now).locked).toBe(false);
  });
});
