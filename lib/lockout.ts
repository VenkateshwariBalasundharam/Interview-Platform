// Pure account-lockout rules (no I/O) so they can be unit tested.

export const MAX_FAILED_ATTEMPTS = 5;
export const LOCK_MINUTES = 15;
export const LOCK_MS = LOCK_MINUTES * 60 * 1000;

export interface LockState {
  failedLoginCount: number;
  lockedUntil: Date | null;
}

export interface LockEvaluation {
  locked: boolean;
  retryAfterSec: number;
  /** True when a previous lock has expired and counters should be reset before this attempt. */
  expired: boolean;
}

export function evaluateLock(state: LockState, now: Date): LockEvaluation {
  if (!state.lockedUntil) return { locked: false, retryAfterSec: 0, expired: false };
  const remaining = state.lockedUntil.getTime() - now.getTime();
  if (remaining > 0) return { locked: true, retryAfterSec: Math.ceil(remaining / 1000), expired: false };
  return { locked: false, retryAfterSec: 0, expired: true };
}

/** Given the failure count AFTER recording a failed attempt, returns the lock time to apply (or null). */
export function lockUntilAfterFailure(failedCountAfter: number, now: Date): Date | null {
  return failedCountAfter >= MAX_FAILED_ATTEMPTS ? new Date(now.getTime() + LOCK_MS) : null;
}
