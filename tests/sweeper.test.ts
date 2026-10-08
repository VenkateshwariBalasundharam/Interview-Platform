import { describe, expect, it } from 'vitest';
import {
  BREAKER_LIMIT,
  DEFAULT_BUDGET_MS,
  GRADING_RETRY_AFTER_SECONDS,
  LATE_AFTER_MINUTES,
  MAX_FAILURES_PER_HOUR,
  RESERVE_MS,
  agoLabel,
  breakerTripped,
  cronAuthorized,
  emptyReport,
  expiredBefore,
  gradingStaleBefore,
  hasTimeLeft,
  heartbeatState,
  nextStreak,
  reportHadWork,
  shouldRetryGrading,
  summarizeReport,
} from '@/lib/sweeper-core';
import { SUBMIT_GRACE_SECONDS, isPastGrace } from '@/lib/round-engine';

const now = new Date('2026-10-05T10:00:00.000Z');
const SECRET = 'a-long-enough-secret-value';

describe('what counts as overdue', () => {
  it('uses the same grace window as the exam screens', () => {
    const cutoff = expiredBefore(now);
    expect(now.getTime() - cutoff.getTime()).toBe(SUBMIT_GRACE_SECONDS * 1000);
    // A deadline just before the cutoff is past grace, one just after is not.
    expect(isPastGrace(new Date(cutoff.getTime() - 1), now)).toBe(true);
    expect(isPastGrace(new Date(cutoff.getTime() + 1000), now)).toBe(false);
  });
  it('leaves freshly submitted rounds to the candidate screen', () => {
    expect(now.getTime() - gradingStaleBefore(now).getTime()).toBe(GRADING_RETRY_AFTER_SECONDS * 1000);
  });
});

describe('time budget', () => {
  it('keeps starting work until the budget minus the reserve is used', () => {
    expect(hasTimeLeft(0, 0)).toBe(true);
    expect(hasTimeLeft(0, DEFAULT_BUDGET_MS - RESERVE_MS - 1)).toBe(true);
    expect(hasTimeLeft(0, DEFAULT_BUDGET_MS - RESERVE_MS)).toBe(false);
    expect(hasTimeLeft(1000, 1000 + 10_000, 12_000, 5_000)).toBe(false);
  });
});

describe('retry limits', () => {
  it('stops retrying a round that keeps failing', () => {
    expect(shouldRetryGrading(0)).toBe(true);
    expect(shouldRetryGrading(MAX_FAILURES_PER_HOUR - 1)).toBe(true);
    expect(shouldRetryGrading(MAX_FAILURES_PER_HOUR)).toBe(false);
  });
  it('trips after several unfinished gradings in a row, and a finished one resets it', () => {
    let streak = 0;
    for (let i = 0; i < BREAKER_LIMIT - 1; i++) streak = nextStreak(streak, false);
    expect(breakerTripped(streak)).toBe(false);
    expect(breakerTripped(nextStreak(streak, true))).toBe(false);
    streak = nextStreak(streak, false);
    expect(breakerTripped(streak)).toBe(true);
    expect(nextStreak(streak, true)).toBe(0);
  });
});

describe('who may start a sweep', () => {
  it('stays closed when no secret is set or the secret is too short', () => {
    expect(cronAuthorized(`Bearer ${SECRET}`, undefined)).toBe('not_configured');
    expect(cronAuthorized(`Bearer short`, 'short')).toBe('not_configured');
  });
  it('accepts only the exact bearer secret', () => {
    expect(cronAuthorized(`Bearer ${SECRET}`, SECRET)).toBe('ok');
    expect(cronAuthorized(`Bearer ${SECRET}x`, SECRET)).toBe('denied');
    expect(cronAuthorized(`Bearer wrong-secret-of-any-length-at-all`, SECRET)).toBe('denied');
    expect(cronAuthorized(SECRET, SECRET)).toBe('denied');
    expect(cronAuthorized(`bearer ${SECRET}`, SECRET)).toBe('denied');
    expect(cronAuthorized(null, SECRET)).toBe('denied');
    expect(cronAuthorized('', SECRET)).toBe('denied');
  });
});

describe('reporting', () => {
  it('starts empty and counts as no work', () => {
    const r = emptyReport('cron', now);
    expect(reportHadWork(r)).toBe(false);
    expect(summarizeReport(r)).toBe('Nothing needed doing.');
  });
  it('describes what happened in plain words', () => {
    const r = { ...emptyReport('admin', now), finalized: 2, graded: 1, stillPending: 3, held: 1, errors: 1, stoppedEarly: true };
    expect(reportHadWork(r)).toBe(true);
    const text = summarizeReport(r);
    expect(text).toContain('submitted 2 expired rounds');
    expect(text).toContain('finished grading 1 round');
    expect(text).toContain('3 rounds still waiting on the AI');
    expect(text).toContain('1 error');
    expect(text).toContain('Stopped early');
  });
  it('says so when another run holds the lease', () => {
    expect(summarizeReport({ ...emptyReport('admin', now), skipped: 'ALREADY_RUNNING' })).toContain('a moment ago');
  });
  it('reports candidate emails in plain words and counts them as work', () => {
    const r = { ...emptyReport('cron', now), emails: { remindersQueued: 0, sent: 3, failed: 1, retrying: 2, cancelled: 0 } };
    expect(reportHadWork(r)).toBe(true);
    const text = summarizeReport(r);
    expect(text).toContain('sent 3 emails');
    expect(text).toContain('2 emails will be retried');
    expect(text).toContain('1 email failed');
    expect(reportHadWork({ ...emptyReport('cron', now), emails: { remindersQueued: 4, sent: 0, failed: 0, retrying: 0, cancelled: 0 } })).toBe(true);
  });
  it('held rounds alone are not "work" but are still mentioned', () => {
    const r = { ...emptyReport('cron', now), held: 2 };
    expect(reportHadWork(r)).toBe(false);
    expect(summarizeReport(r)).toContain('2 left for a person');
  });
});

describe('heartbeat', () => {
  it('is never, ok or late', () => {
    expect(heartbeatState(null, now)).toBe('never');
    expect(heartbeatState(new Date(now.getTime() - 60_000), now)).toBe('ok');
    expect(heartbeatState(new Date(now.getTime() - (LATE_AFTER_MINUTES * 60 + 1) * 1000), now)).toBe('late');
  });
  it('labels ages', () => {
    expect(agoLabel(new Date(now.getTime() - 10_000), now)).toBe('just now');
    expect(agoLabel(new Date(now.getTime() - 3 * 60_000), now)).toBe('3 min ago');
    expect(agoLabel(new Date(now.getTime() - 5 * 3600_000), now)).toBe('5 h ago');
    expect(agoLabel(new Date(now.getTime() - 72 * 3600_000), now)).toBe('3 days ago');
    expect(agoLabel(new Date(now.getTime() + 5000), now)).toBe('just now');
  });
});
