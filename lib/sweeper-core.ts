// Pure rules for the background sweep: what counts as overdue, when to stop, who may call it, how a run is reported.
// No database and no clock reads here, so everything in this file is unit tested (tests/sweeper.test.ts).
import { createHash, timingSafeEqual } from 'node:crypto';
import { SUBMIT_GRACE_SECONDS } from '@/lib/round-engine';

/** Only one sweep runs per this window (a database lease), so two cron callers never do the same work twice. */
export const SWEEP_LEASE_MS = 45_000;
/** A run stops starting new work after this long, so it ends before a 60 s serverless limit. */
export const DEFAULT_BUDGET_MS = 45_000;
/** Time kept in reserve after the budget for writing the report. */
export const RESERVE_MS = 5_000;
export const MAX_FINALIZE_PER_RUN = 100;
export const MAX_GRADE_PER_RUN = 15;
/** A submitted round is left alone this long: the candidate's own grading screen is probably working on it. */
export const GRADING_RETRY_AFTER_SECONDS = 90;
/** Stop retrying one round after this many failed AI gradings in an hour; an admin can still press "Grade now". */
export const MAX_FAILURES_PER_HOUR = 5;
/** Stop the run after this many gradings in a row that did not finish (the AI is probably down). */
export const BREAKER_LIMIT = 3;
export const HOUSEKEEPING_EVERY_MS = 60 * 60_000;
/** Rate-limit counters older than this are dead weight (the longest window in use is an hour). */
export const RATE_LIMIT_MAX_AGE_MS = 2 * 24 * 60 * 60_000;
export const RUN_HISTORY_DAYS = 7;
/** The dashboard warns when nothing has run for this long. */
export const LATE_AFTER_MINUTES = 5;
/** A submitted round waiting longer than this shows on the dashboard as stuck. */
export const STUCK_AFTER_MINUTES = 10;

/** In-progress rounds whose timer and grace window ended before this moment are submitted for the candidate. */
export function expiredBefore(now: Date): Date {
  return new Date(now.getTime() - SUBMIT_GRACE_SECONDS * 1000);
}

/** Submitted rounds older than this moment are picked up for grading. */
export function gradingStaleBefore(now: Date): Date {
  return new Date(now.getTime() - GRADING_RETRY_AFTER_SECONDS * 1000);
}

export function hasTimeLeft(startedAtMs: number, nowMs: number, budgetMs = DEFAULT_BUDGET_MS, reserveMs = RESERVE_MS): boolean {
  return nowMs - startedAtMs < budgetMs - reserveMs;
}

export function shouldRetryGrading(failuresInLastHour: number): boolean {
  return failuresInLastHour < MAX_FAILURES_PER_HOUR;
}

/** Tracks gradings that did not finish in a row. A finished grading resets it. */
export function nextStreak(streak: number, finished: boolean): number {
  return finished ? 0 : streak + 1;
}

export function breakerTripped(streak: number): boolean {
  return streak >= BREAKER_LIMIT;
}

export type CronAuth = 'ok' | 'not_configured' | 'denied';

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

/**
 * The scheduler sends `Authorization: Bearer <CRON_SECRET>` (Vercel Cron does this by itself once CRON_SECRET is set).
 * Compared in constant time on digests, so neither the secret nor its length leaks through timing.
 * With no secret configured the route stays closed.
 */
export function cronAuthorized(authorizationHeader: string | null, secret: string | undefined): CronAuth {
  if (!secret || secret.length < 16) return 'not_configured';
  const match = /^Bearer (.+)$/.exec(authorizationHeader ?? '');
  if (!match) return 'denied';
  return timingSafeEqual(digest(match[1]), digest(secret)) ? 'ok' : 'denied';
}

export type SweepTrigger = 'cron' | 'admin' | 'script';

export interface SweepReport {
  trigger: SweepTrigger;
  startedAt: string;
  durationMs: number;
  /** Set when the run did nothing because another run holds the lease. */
  skipped: 'ALREADY_RUNNING' | null;
  /** Rounds whose timer had run out and that were submitted for the candidate. */
  finalized: number;
  /** Rounds whose typed answers were graded (or whose result was completed) this run. */
  graded: number;
  /** Rounds the AI could not finish this time; they are tried again next run. */
  stillPending: number;
  /** Rounds left alone: busy, or failed too often in the last hour. */
  held: number;
  errors: number;
  /** The run ran out of time or the AI looked down, so some work was left for the next run. */
  stoppedEarly: boolean;
  housekeeping: { ran: boolean; snapshots: number; faceReferences: number; rateLimits: number; runs: number };
  /** Candidate emails: reminders newly queued, and what the sender did with the outbox this run. */
  emails: { remindersQueued: number; sent: number; failed: number; retrying: number; cancelled: number };
}

export function emptyReport(trigger: SweepTrigger, startedAt: Date): SweepReport {
  return {
    trigger,
    startedAt: startedAt.toISOString(),
    durationMs: 0,
    skipped: null,
    finalized: 0,
    graded: 0,
    stillPending: 0,
    held: 0,
    errors: 0,
    stoppedEarly: false,
    housekeeping: { ran: false, snapshots: 0, faceReferences: 0, rateLimits: 0, runs: 0 },
    emails: { remindersQueued: 0, sent: 0, failed: 0, retrying: 0, cancelled: 0 },
  };
}

export function reportHadWork(r: SweepReport): boolean {
  const e = r.emails;
  return r.finalized + r.graded + r.stillPending + r.errors + e.remindersQueued + e.sent + e.failed + e.retrying + e.cancelled > 0;
}

/** One sentence for the admin button and the script log. */
export function summarizeReport(r: SweepReport): string {
  if (r.skipped === 'ALREADY_RUNNING') return 'A sweep ran a moment ago, so nothing was done. Try again in under a minute.';
  const parts: string[] = [];
  if (r.finalized > 0) parts.push(`submitted ${r.finalized} expired round${r.finalized === 1 ? '' : 's'}`);
  if (r.graded > 0) parts.push(`finished grading ${r.graded} round${r.graded === 1 ? '' : 's'}`);
  if (r.stillPending > 0) parts.push(`${r.stillPending} round${r.stillPending === 1 ? '' : 's'} still waiting on the AI`);
  if (r.held > 0) parts.push(`${r.held} left for a person (grading failed repeatedly or is busy)`);
  if (r.emails.sent > 0) parts.push(`sent ${r.emails.sent} email${r.emails.sent === 1 ? '' : 's'}`);
  if (r.emails.retrying > 0) parts.push(`${r.emails.retrying} email${r.emails.retrying === 1 ? '' : 's'} will be retried`);
  if (r.emails.failed > 0) parts.push(`${r.emails.failed} email${r.emails.failed === 1 ? '' : 's'} failed (see Candidates)`);
  if (r.errors > 0) parts.push(`${r.errors} error${r.errors === 1 ? '' : 's'}`);
  const base = parts.length === 0 ? 'Nothing needed doing.' : `Done: ${parts.join(', ')}.`;
  return r.stoppedEarly ? `${base} Stopped early; the rest is picked up next run.` : base;
}

export type HeartbeatState = 'never' | 'ok' | 'late';

export function heartbeatState(lastStartedAt: Date | null, now: Date): HeartbeatState {
  if (!lastStartedAt) return 'never';
  return now.getTime() - lastStartedAt.getTime() > LATE_AFTER_MINUTES * 60_000 ? 'late' : 'ok';
}

/** "just now", "3 min ago", "2 h ago", "3 days ago". */
export function agoLabel(then: Date, now: Date): string {
  const s = Math.max(0, Math.round((now.getTime() - then.getTime()) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}
