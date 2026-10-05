// Background sweep (server only). Does the work that used to happen only when a candidate next opened a page:
//   1. submits rounds whose timer and grace window have run out,
//   2. grades typed answers that were never graded (candidate closed the tab, AI was down) and completes the result,
//   3. once an hour: removes expired photos / face references, dead rate-limit rows and old sweep history.
// It reuses finalizeAttempt and gradePendingAnswers, so the rules are exactly the ones candidates and admins already
// get. Both are safe to repeat, so overlapping runs cannot double-submit or double-score. A short database lease
// (the rate-limit table) keeps two runs from working at once anyway. Pure rules: lib/sweeper-core.ts.
import { audit } from '@/lib/audit';
import { prisma } from '@/lib/db';
import { purgeExpired } from '@/lib/face';
import { AppError } from '@/lib/http';
import { consumeRateLimit } from '@/lib/ratelimit';
import { finalizeAttempt, gradePendingAnswers } from '@/lib/rounds';
import {
  DEFAULT_BUDGET_MS,
  HOUSEKEEPING_EVERY_MS,
  MAX_FINALIZE_PER_RUN,
  MAX_GRADE_PER_RUN,
  RATE_LIMIT_MAX_AGE_MS,
  RUN_HISTORY_DAYS,
  STUCK_AFTER_MINUTES,
  SWEEP_LEASE_MS,
  breakerTripped,
  emptyReport,
  expiredBefore,
  gradingStaleBefore,
  hasTimeLeft,
  heartbeatState,
  nextStreak,
  reportHadWork,
  shouldRetryGrading,
  type HeartbeatState,
  type SweepReport,
  type SweepTrigger,
} from '@/lib/sweeper-core';

const WAITING_STATUSES = ['SUBMITTED', 'AUTO_SUBMITTED'] as const;

function errorCode(e: unknown): string {
  return e instanceof AppError ? e.code : e instanceof Error ? e.name : 'UnknownError';
}

export async function runSweep(opts: { trigger: SweepTrigger; now?: Date; budgetMs?: number; actorId?: string } = { trigger: 'script' }): Promise<SweepReport> {
  const started = opts.now ?? new Date();
  const startedMs = Date.now();
  const budget = opts.budgetMs ?? DEFAULT_BUDGET_MS;
  const report = emptyReport(opts.trigger, started);
  const timeLeft = () => hasTimeLeft(startedMs, Date.now(), budget);

  // One sweep at a time. The first caller in each window takes the lease; the others report and leave.
  const lease = await consumeRateLimit('sweep:lease', 1, SWEEP_LEASE_MS);
  if (!lease.allowed) {
    report.skipped = 'ALREADY_RUNNING';
    return report;
  }

  // 1. Submit rounds whose timer ran out. Oldest first so the longest-waiting candidates are done first.
  const justFinalized = new Set<string>();
  const overdue = await prisma.attempt.findMany({
    where: { status: 'IN_PROGRESS', deadlineAt: { lt: expiredBefore(started) } },
    orderBy: { deadlineAt: 'asc' },
    take: MAX_FINALIZE_PER_RUN,
    select: { id: true },
  });
  for (const a of overdue) {
    if (!timeLeft()) {
      report.stoppedEarly = true;
      break;
    }
    try {
      await finalizeAttempt(a.id, started);
      justFinalized.add(a.id);
      report.finalized += 1;
    } catch (e) {
      report.errors += 1;
      console.error('Sweep: could not submit a round', { code: errorCode(e) });
    }
  }

  // 2. Grade rounds that are submitted but not graded. Rounds just submitted above go straight in; others must have
  //    waited a little so the candidate's own grading screen gets the first go.
  const waiting = await prisma.attempt.findMany({
    where: {
      status: { in: [...WAITING_STATUSES] },
      OR: [{ submittedAt: { lt: gradingStaleBefore(started) } }, { id: { in: [...justFinalized] } }],
    },
    orderBy: { submittedAt: 'asc' },
    take: MAX_GRADE_PER_RUN * 3,
    select: { id: true },
  });
  let gradedAttempts = 0;
  let streak = 0;
  for (const a of waiting) {
    if (gradedAttempts >= MAX_GRADE_PER_RUN || !timeLeft() || breakerTripped(streak)) {
      report.stoppedEarly = true;
      break;
    }
    try {
      const failures = await prisma.auditLog.count({
        where: { action: 'ROUND_GRADING_FAILED', entityId: a.id, createdAt: { gt: new Date(started.getTime() - 60 * 60_000) } },
      });
      if (!shouldRetryGrading(failures)) {
        report.held += 1;
        continue;
      }
      gradedAttempts += 1;
      const status = await gradePendingAnswers(a.id);
      if (status === 'done') report.graded += 1;
      else if (status === 'busy') report.held += 1;
      else report.stillPending += 1;
      streak = nextStreak(streak, status === 'done');
    } catch (e) {
      report.errors += 1;
      streak = nextStreak(streak, false);
      console.error('Sweep: grading failed', { code: errorCode(e) });
    }
  }

  // 3. Housekeeping, at most once an hour.
  try {
    const due = await consumeRateLimit('sweep:housekeeping', 1, HOUSEKEEPING_EVERY_MS);
    if (due.allowed && timeLeft()) {
      const purged = await purgeExpired(started);
      const rateLimits = await prisma.rateLimit.deleteMany({ where: { windowStart: { lt: new Date(started.getTime() - RATE_LIMIT_MAX_AGE_MS) } } });
      const runs = await prisma.sweepRun.deleteMany({ where: { startedAt: { lt: new Date(started.getTime() - RUN_HISTORY_DAYS * 86_400_000) } } });
      report.housekeeping = { ran: true, snapshots: purged.snapshots, faceReferences: purged.faceReferences, rateLimits: rateLimits.count, runs: runs.count };
    }
  } catch (e) {
    report.errors += 1;
    console.error('Sweep: housekeeping failed', { code: errorCode(e) });
  }

  report.durationMs = Date.now() - startedMs;

  // Heartbeat, so the admin dashboard can tell the sweep is running. Best effort: a failure here never fails the run.
  try {
    await prisma.sweepRun.create({
      data: {
        trigger: opts.trigger,
        startedAt: started,
        finishedAt: new Date(started.getTime() + report.durationMs),
        finalized: report.finalized,
        graded: report.graded,
        stillPending: report.stillPending,
        held: report.held,
        errors: report.errors,
        stoppedEarly: report.stoppedEarly,
      },
    });
    if (reportHadWork(report)) {
      await audit({
        actorType: opts.actorId ? 'ADMIN' : 'SYSTEM',
        actorId: opts.actorId ?? null,
        action: 'SWEEP_RUN',
        entity: 'System',
        entityId: 'sweep',
        meta: { trigger: opts.trigger, finalized: report.finalized, graded: report.graded, stillPending: report.stillPending, held: report.held, errors: report.errors },
      });
    }
  } catch (e) {
    console.error('Sweep: could not record the run', { code: errorCode(e) });
  }
  return report;
}

export interface SweepStatus {
  state: HeartbeatState;
  lastStartedAt: Date | null;
  lastFinalized: number;
  lastGraded: number;
  lastErrors: number;
  /** Submitted rounds that have waited a long time for grading. */
  stuckGrading: number;
  /** Rounds still "in progress" long after their timer ended (nothing has submitted them). */
  overdueRounds: number;
}

/** For the admin dashboard banner. */
export async function getSweepStatus(now = new Date()): Promise<SweepStatus> {
  const stuckBefore = new Date(now.getTime() - STUCK_AFTER_MINUTES * 60_000);
  const [last, stuckGrading, overdueRounds] = await Promise.all([
    prisma.sweepRun.findFirst({ orderBy: { startedAt: 'desc' }, select: { startedAt: true, finalized: true, graded: true, errors: true } }),
    prisma.attempt.count({ where: { status: { in: [...WAITING_STATUSES] }, submittedAt: { lt: stuckBefore } } }),
    prisma.attempt.count({ where: { status: 'IN_PROGRESS', deadlineAt: { lt: new Date(expiredBefore(now).getTime() - STUCK_AFTER_MINUTES * 60_000) } } }),
  ]);
  return {
    state: heartbeatState(last?.startedAt ?? null, now),
    lastStartedAt: last?.startedAt ?? null,
    lastFinalized: last?.finalized ?? 0,
    lastGraded: last?.graded ?? 0,
    lastErrors: last?.errors ?? 0,
    stuckGrading,
    overdueRounds,
  };
}
