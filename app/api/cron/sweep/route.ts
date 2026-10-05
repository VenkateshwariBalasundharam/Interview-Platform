import { NextResponse } from 'next/server';
import { getEnv } from '@/lib/env';
import { AppError, err, route } from '@/lib/http';
import { runSweep } from '@/lib/sweeper';
import { cronAuthorized } from '@/lib/sweeper-core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Grading makes AI calls; the run stops starting new work well before this limit (see DEFAULT_BUDGET_MS).
export const maxDuration = 60;

/**
 * Called by a scheduler (Vercel Cron, GitHub Actions, cron-job.org, a server cron) with
 * `Authorization: Bearer <CRON_SECRET>`. Not an admin or candidate route, and closed until CRON_SECRET is set.
 * Vercel Cron uses GET; POST works too.
 */
const handler = route(async (req) => {
  const auth = cronAuthorized(req.headers.get('authorization'), getEnv().CRON_SECRET);
  if (auth === 'not_configured') throw new AppError(500, 'CRON_NOT_CONFIGURED', 'Background sweeps are not set up on this server (CRON_SECRET is missing or shorter than 16 characters).');
  if (auth === 'denied') throw err.unauthorized('Not allowed.', 'CRON_DENIED');
  const report = await runSweep({ trigger: 'cron' });
  return NextResponse.json(report, { headers: { 'Cache-Control': 'no-store' } });
});

export const GET = handler;
export const POST = handler;
