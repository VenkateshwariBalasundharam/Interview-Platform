import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { route } from '@/lib/http';
import { runSweep } from '@/lib/sweeper';
import { summarizeReport } from '@/lib/sweeper-core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Admin only. Runs one sweep now ("Run now" on the dashboard). Respects the same one-at-a-time lease as the scheduler. */
export const POST = route(async () => {
  const admin = await requireAdmin();
  const report = await runSweep({ trigger: 'admin', actorId: admin.id });
  return NextResponse.json({ report, message: summarizeReport(report) }, { headers: { 'Cache-Control': 'no-store' } });
});
