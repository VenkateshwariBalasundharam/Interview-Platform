import { describe, expect, it } from 'vitest';
import {
  MAX_ATTEMPTS,
  afterFailure,
  cancelReason,
  classifyFailure,
  describeError,
  emailBadge,
  emailKeys,
  isPlausibleAddress,
  loginLink,
  normalizeAppUrl,
  reminderDue,
  reminderSearchStart,
  resolveEmailConfig,
  resolveReminderSettings,
  retryDelayMs,
  type ReminderHistory,
} from '@/lib/email-core';

const base = { APP_URL: 'https://interview.example.com', EMAIL_DRIVER: undefined, SMTP_HOST: 'smtp.example.com', SMTP_PORT: undefined, SMTP_USER: 'u', SMTP_PASS: 'p', EMAIL_FROM: 'Hiring <hr@example.com>', EMAIL_REPLY_TO: undefined, NODE_ENV: 'production' as const };
const hour = 3_600_000;
const now = new Date('2026-10-05T12:00:00.000Z');
const ago = (h: number) => new Date(now.getTime() - h * hour);

describe('email settings', () => {
  it('is off, with a reason, when nothing is configured', () => {
    const c = resolveEmailConfig({ ...base, SMTP_HOST: undefined, SMTP_USER: undefined, SMTP_PASS: undefined, EMAIL_FROM: undefined });
    expect(c.mode).toBe('off');
    expect(c.mode === 'off' && c.reason).toContain('SMTP_HOST');
  });
  it('turns on with a host, a sender and the site address', () => {
    const c = resolveEmailConfig(base);
    expect(c).toMatchObject({ mode: 'smtp', host: 'smtp.example.com', port: 587, secure: false, appUrl: 'https://interview.example.com' });
  });
  it('uses TLS from the first byte on port 465 only', () => {
    expect(resolveEmailConfig({ ...base, SMTP_PORT: '465' })).toMatchObject({ secure: true, port: 465 });
  });
  it('stays off without a usable APP_URL, because the email would carry a broken link', () => {
    for (const APP_URL of [undefined, '', 'not a url', 'ftp://x.com', 'javascript:alert(1)']) expect(resolveEmailConfig({ ...base, APP_URL }).mode).toBe('off');
  });
  it('stays off for a bad sender, port, or half a login', () => {
    expect(resolveEmailConfig({ ...base, EMAIL_FROM: 'nope' }).mode).toBe('off');
    expect(resolveEmailConfig({ ...base, SMTP_PORT: '99999' }).mode).toBe('off');
    expect(resolveEmailConfig({ ...base, SMTP_PORT: 'abc' }).mode).toBe('off');
    expect(resolveEmailConfig({ ...base, SMTP_PASS: undefined }).mode).toBe('off');
  });
  it('falls back to the SMTP user as the sender when it is an address', () => {
    expect(resolveEmailConfig({ ...base, EMAIL_FROM: undefined, SMTP_USER: 'hr@example.com' })).toMatchObject({ mode: 'smtp', from: 'hr@example.com' });
  });
  it('allows the console driver in development but not production', () => {
    expect(resolveEmailConfig({ ...base, EMAIL_DRIVER: 'console', SMTP_HOST: undefined, NODE_ENV: 'development' }).mode).toBe('console');
    expect(resolveEmailConfig({ ...base, EMAIL_DRIVER: 'console', SMTP_HOST: undefined }).mode).toBe('off');
  });
  it('keeps a valid reply-to and drops an invalid one', () => {
    expect(resolveEmailConfig({ ...base, EMAIL_REPLY_TO: 'help@example.com' })).toMatchObject({ replyTo: 'help@example.com' });
    expect(resolveEmailConfig({ ...base, EMAIL_REPLY_TO: 'junk' })).toMatchObject({ replyTo: null });
  });
});

describe('settings that are blank, quoted or in the wrong case', () => {
  it('treats blank settings as not set instead of failing', () => {
    expect(resolveEmailConfig({ ...base, EMAIL_DRIVER: '', SMTP_PORT: '', SMTP_USER: '', SMTP_PASS: '', EMAIL_REPLY_TO: '' }).mode).toBe('smtp');
    expect(resolveEmailConfig({ APP_URL: '', EMAIL_DRIVER: '' }).mode).toBe('off');
  });
  it('ignores case, spaces and quotes copied from a .env file', () => {
    const c = resolveEmailConfig({ ...base, EMAIL_DRIVER: ' "Console" ', SMTP_HOST: undefined, NODE_ENV: 'development', APP_URL: ' "http://localhost:3100/" ' });
    expect(c).toMatchObject({ mode: 'console', appUrl: 'http://localhost:3100' });
  });
  it('says what is wrong with an unknown driver instead of throwing', () => {
    const c = resolveEmailConfig({ ...base, EMAIL_DRIVER: 'mailgun' });
    expect(c.mode).toBe('off');
    expect(c.mode === 'off' && c.reason).toContain('EMAIL_DRIVER');
  });
  it('never throws, whatever the environment holds', () => {
    for (const v of ['', ' ', '\n', 'x'.repeat(5000), '"', "'", '0', '-1', 'null']) {
      expect(() => resolveEmailConfig({ APP_URL: v, EMAIL_DRIVER: v, SMTP_HOST: v, SMTP_PORT: v, SMTP_USER: v, SMTP_PASS: v, EMAIL_FROM: v, EMAIL_REPLY_TO: v, NODE_ENV: v })).not.toThrow();
      expect(() => resolveReminderSettings({ EMAIL_REMINDERS: v, REMINDER_AFTER_HOURS: v, REMINDER_EVERY_HOURS: v, REMINDER_MAX: v })).not.toThrow();
    }
  });
  it('reads reminder settings the same forgiving way', () => {
    expect(resolveReminderSettings({ EMAIL_REMINDERS: ' OFF ' }).enabled).toBe(false);
    expect(resolveReminderSettings({ EMAIL_REMINDERS: '' }).enabled).toBe(true);
    expect(resolveReminderSettings({ REMINDER_AFTER_HOURS: ' "12" ' }).afterHours).toBe(12);
  });
});

describe('addresses and links', () => {
  it('accepts plain and named addresses, rejects junk and header injection', () => {
    expect(isPlausibleAddress('asha@example.com')).toBe(true);
    expect(isPlausibleAddress('Asha V <asha@example.com>')).toBe(true);
    for (const bad of ['', 'asha', 'asha@', '@example.com', 'a b@example.com', 'a@b', 'a@example.com\r\nBcc: x@y.com', 'a@x.com,b@y.com', undefined, null]) expect(isPlausibleAddress(bad as string)).toBe(false);
  });
  it('normalises the site address', () => {
    expect(normalizeAppUrl('https://x.com/')).toBe('https://x.com');
    expect(normalizeAppUrl('https://x.com/app/')).toBe('https://x.com/app');
    expect(normalizeAppUrl('  http://localhost:3100 ')).toBe('http://localhost:3100');
    expect(normalizeAppUrl(undefined)).toBeNull();
  });
  it('builds a login link with the ID filled in and no password', () => {
    expect(loginLink('https://x.com', 'CAND-KQMT1001')).toBe('https://x.com/login?code=CAND-KQMT1001');
    expect(loginLink('https://x.com', 'a&b=c')).toBe('https://x.com/login?code=a%26b%3Dc');
  });
});

describe('idempotency keys', () => {
  it('is the same for the same event and different for different ones', () => {
    expect(emailKeys.invite('c1')).toBe(emailKeys.invite('c1'));
    expect(emailKeys.resultReady('c1')).not.toBe(emailKeys.resultReady('c2'));
    expect(emailKeys.reminder('c1', 1)).not.toBe(emailKeys.reminder('c1', 2));
  });
  it('treats a double click as one resend but a later resend as a new one', () => {
    const t = new Date('2026-10-05T10:00:10.000Z');
    expect(emailKeys.inviteResend('c1', t)).toBe(emailKeys.inviteResend('c1', new Date(t.getTime() + 20_000)));
    expect(emailKeys.inviteResend('c1', t)).not.toBe(emailKeys.inviteResend('c1', new Date(t.getTime() + 5 * 60_000)));
  });
  it('gives each approval its own email', () => {
    expect(emailKeys.selected('c1', new Date(1000))).not.toBe(emailKeys.selected('c1', new Date(2000)));
  });
});

describe('retrying', () => {
  it('waits longer after each failure, then holds at the longest wait', () => {
    expect(retryDelayMs(1)).toBe(60_000);
    expect(retryDelayMs(2)).toBe(5 * 60_000);
    expect(retryDelayMs(3)).toBe(15 * 60_000);
    expect(retryDelayMs(4)).toBe(60 * 60_000);
    expect(retryDelayMs(9)).toBe(60 * 60_000);
    expect(retryDelayMs(0)).toBe(60_000);
  });
  it('does not retry a rejected mailbox, but retries server trouble', () => {
    expect(classifyFailure({ responseCode: 550 })).toBe('recipient');
    expect(classifyFailure({ responseCode: 553 })).toBe('recipient');
    expect(classifyFailure({ responseCode: 421 })).toBe('transient');
    expect(classifyFailure({ responseCode: 535 })).toBe('transient'); // wrong SMTP password: fixable, so keep the email
    expect(classifyFailure({ code: 'ETIMEDOUT' })).toBe('transient');
    expect(classifyFailure(new Error('x'))).toBe('transient');
    expect(classifyFailure(null)).toBe('transient');
  });
  it('schedules a retry until the attempts run out', () => {
    expect(afterFailure('transient', 1, now)).toEqual({ status: 'PENDING', nextAttemptAt: new Date(now.getTime() + 60_000) });
    expect(afterFailure('transient', MAX_ATTEMPTS - 1, now).status).toBe('PENDING');
    expect(afterFailure('transient', MAX_ATTEMPTS, now)).toEqual({ status: 'FAILED', nextAttemptAt: null });
    expect(afterFailure('recipient', 1, now)).toEqual({ status: 'FAILED', nextAttemptAt: null });
  });
  it('keeps error text short and on one line', () => {
    const e = Object.assign(new Error('line one\r\nline two ' + 'x'.repeat(500)), { code: 'EENVELOPE', responseCode: 550 });
    const text = describeError(e);
    expect(text.length).toBeLessThanOrEqual(240);
    expect(text).not.toMatch(/[\r\n]/);
    expect(text).toContain('EENVELOPE 550');
  });
});

describe('cancelling an email that is no longer true', () => {
  it('cancels a reminder once the candidate has started or is no longer active', () => {
    expect(cancelReason('REMINDER', { status: 'ACTIVE', hasStarted: false })).toBeNull();
    expect(cancelReason('REMINDER', { status: 'ACTIVE', hasStarted: true })).toContain('started');
    expect(cancelReason('REMINDER', { status: 'DISQUALIFIED', hasStarted: false })).not.toBeNull();
    expect(cancelReason('REMINDER', { status: 'PENDING_REVIEW', hasStarted: false })).not.toBeNull();
  });
  it('cancels "selected" for a disqualified candidate only', () => {
    expect(cancelReason('SELECTED_NEXT_ROUND', { status: 'DISQUALIFIED', hasStarted: true })).not.toBeNull();
    expect(cancelReason('SELECTED_NEXT_ROUND', { status: 'ACTIVE', hasStarted: true })).toBeNull();
  });
  it('always sends invitations and results', () => {
    for (const status of ['ACTIVE', 'DISQUALIFIED', 'COMPLETED', 'PENDING_REVIEW'] as const) {
      expect(cancelReason('INVITE', { status, hasStarted: true })).toBeNull();
      expect(cancelReason('RESULT_READY', { status, hasStarted: true })).toBeNull();
    }
  });
});

describe('reminder settings', () => {
  it('defaults to 48 hours, 48 hours between, two reminders', () => {
    expect(resolveReminderSettings({})).toEqual({ enabled: true, afterHours: 48, everyHours: 48, max: 2 });
  });
  it('reads valid values, ignores invalid ones, and can be switched off', () => {
    expect(resolveReminderSettings({ REMINDER_AFTER_HOURS: '24', REMINDER_EVERY_HOURS: '12', REMINDER_MAX: '3' })).toMatchObject({ afterHours: 24, everyHours: 12, max: 3 });
    expect(resolveReminderSettings({ REMINDER_AFTER_HOURS: '0', REMINDER_EVERY_HOURS: 'x', REMINDER_MAX: '99' })).toMatchObject({ afterHours: 48, everyHours: 48, max: 2 });
    expect(resolveReminderSettings({ EMAIL_REMINDERS: 'off' }).enabled).toBe(false);
    expect(resolveReminderSettings({ REMINDER_MAX: '0' }).max).toBe(0);
  });
});

describe('when a reminder is due', () => {
  const settings = { enabled: true, afterHours: 48, everyHours: 24, max: 2 };
  const hist = (over: Partial<ReminderHistory> = {}): ReminderHistory => ({ lastInviteSentAt: ago(50), reminders: [], ...over });

  it('is not due before the first wait has passed, and is due after', () => {
    expect(reminderDue(hist({ lastInviteSentAt: ago(47) }), settings, now)).toEqual({ due: false });
    expect(reminderDue(hist({ lastInviteSentAt: ago(48) }), settings, now)).toEqual({ due: true, sequence: 1 });
  });
  it('waits from the invitation being SENT, so nothing is due without one', () => {
    expect(reminderDue(hist({ lastInviteSentAt: null }), settings, now)).toEqual({ due: false });
  });
  it('waits the shorter gap after a reminder, measured from that reminder', () => {
    const sent = { status: 'SENT' as const, sentAt: ago(10) };
    expect(reminderDue(hist({ reminders: [sent] }), settings, now)).toEqual({ due: false });
    expect(reminderDue(hist({ reminders: [{ status: 'SENT', sentAt: ago(24) }] }), settings, now)).toEqual({ due: true, sequence: 2 });
  });
  it('stops at the maximum, counting failed and cancelled reminders too', () => {
    const r = [{ status: 'SENT' as const, sentAt: ago(100) }, { status: 'FAILED' as const, sentAt: null }];
    expect(reminderDue(hist({ reminders: r }), settings, now)).toEqual({ due: false });
  });
  it('does not queue another while one is waiting to go out', () => {
    expect(reminderDue(hist({ reminders: [{ status: 'PENDING', sentAt: null }] }), { ...settings, max: 5 }, now)).toEqual({ due: false });
  });
  it('restarts the clock when the invitation is resent', () => {
    expect(reminderDue(hist({ lastInviteSentAt: ago(1), reminders: [{ status: 'SENT', sentAt: ago(30) }] }), settings, now)).toEqual({ due: false });
  });
  it('sends nothing when reminders are off', () => {
    expect(reminderDue(hist(), { ...settings, enabled: false }, now)).toEqual({ due: false });
    expect(reminderDue(hist(), { ...settings, max: 0 }, now)).toEqual({ due: false });
  });
  it('looks far enough back to find every candidate who could still need a reminder', () => {
    const start = reminderSearchStart(settings, now);
    const lastPossibleReminderEnds = settings.afterHours + settings.everyHours * settings.max;
    expect(now.getTime() - start.getTime()).toBeGreaterThan(lastPossibleReminderEnds * hour);
  });
});

describe('admin email badge', () => {
  it('has no badge before any email', () => expect(emailBadge(null)).toBeNull());
  it('names the kind and the state', () => {
    expect(emailBadge({ kind: 'INVITE', status: 'SENT', sentAt: now })).toEqual({ label: 'Invite sent', tone: 'good' });
    expect(emailBadge({ kind: 'REMINDER', status: 'PENDING', sentAt: null })).toEqual({ label: 'Reminder queued', tone: 'neutral' });
    expect(emailBadge({ kind: 'RESULT_READY', status: 'FAILED', sentAt: null })).toEqual({ label: 'Result failed', tone: 'bad' });
    expect(emailBadge({ kind: 'SELECTED_NEXT_ROUND', status: 'CANCELLED', sentAt: null })?.label).toBe('Next round not needed');
  });
});
