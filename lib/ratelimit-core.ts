// Pure rate-limit decision logic (no I/O).

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSec: number;
}

/** Pure decision from the counter state returned by the database. */
export function evaluateWindow(input: {
  count: number;
  windowStart: Date;
  limit: number;
  windowMs: number;
  now: Date;
}): RateLimitResult {
  const { count, windowStart, limit, windowMs, now } = input;
  const allowed = count <= limit;
  const resetAt = windowStart.getTime() + windowMs;
  return {
    allowed,
    remaining: Math.max(0, limit - count),
    retryAfterSec: allowed ? 0 : Math.max(1, Math.ceil((resetAt - now.getTime()) / 1000)),
  };
}
