import { prisma } from '@/lib/db';

import { evaluateWindow, type RateLimitResult } from '@/lib/ratelimit-core';

export type { RateLimitResult };

/**
 * DB-backed fixed-window counter. One atomic upsert per call, so it is safe across serverless instances.
 * Every call counts as a hit; `allowed` is false once the hits in the window exceed `limit`.
 */
export async function consumeRateLimit(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
  const rows = await prisma.$queryRaw<{ count: number; windowStart: Date }[]>`
    INSERT INTO "RateLimit" ("key", "count", "windowStart")
    VALUES (${key}, 1, (NOW() AT TIME ZONE 'UTC'))
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE
        WHEN "RateLimit"."windowStart" <= (NOW() AT TIME ZONE 'UTC') - (${windowMs}::double precision / 1000) * INTERVAL '1 second'
        THEN 1 ELSE "RateLimit"."count" + 1 END,
      "windowStart" = CASE
        WHEN "RateLimit"."windowStart" <= (NOW() AT TIME ZONE 'UTC') - (${windowMs}::double precision / 1000) * INTERVAL '1 second'
        THEN (NOW() AT TIME ZONE 'UTC') ELSE "RateLimit"."windowStart" END
    RETURNING "count", "windowStart"`;
  const row = rows[0];
  return evaluateWindow({ count: Number(row.count), windowStart: new Date(row.windowStart), limit, windowMs, now: new Date() });
}
