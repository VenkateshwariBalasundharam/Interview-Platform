// Pure rules for candidate emails: how the mail settings are read, which emails are duplicates, when a failed send is
// tried again, when a reminder is due, and when a queued email should no longer go out.
// No database, no clock reads and no network here, so everything in this file is unit tested (tests/email-core.test.ts).
export type EmailKind = 'INVITE' | 'SELECTED_NEXT_ROUND' | 'RESULT_READY' | 'REMINDER';

// ───────────────────────── Settings ─────────────────────────

export type EmailConfig =
  | { mode: 'off'; reason: string }
  | { mode: 'console'; appUrl: string; from: string; replyTo: string | null }
  | { mode: 'smtp'; appUrl: string; from: string; replyTo: string | null; host: string; port: number; secure: boolean; user: string | null; pass: string | null };

/** The raw settings, as strings straight from the environment. Nothing here has been checked yet. */
export interface EmailEnv {
  APP_URL?: string;
  EMAIL_DRIVER?: string;
  SMTP_HOST?: string;
  SMTP_PORT?: string;
  SMTP_USER?: string;
  SMTP_PASS?: string;
  EMAIL_FROM?: string;
  EMAIL_REPLY_TO?: string;
  NODE_ENV?: string;
}

/** A setting with its spaces and surrounding quotes removed. A blank value counts as not set. */
export function cleanSetting(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const v = value.trim().replace(/^(["'])(.*)\1$/, '$2').trim();
  return v === '' ? undefined : v;
}

/** Anything that looks like a plain address, or `Name <address>`. Not a full RFC check: the mail server has the final say. */
const ADDRESS = /^(?:[^<>\r\n]+<)?[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+>?$/;

export function isPlausibleAddress(value: string | undefined | null): value is string {
  return typeof value === 'string' && value.length <= 254 && ADDRESS.test(value.trim());
}

/** The site's public address with no trailing slash, or null when it is missing or not http(s). */
export function normalizeAppUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
  } catch {
    return null;
  }
}

/**
 * Reads the mail settings. Email is OFF unless it is fully set up, and `reason` says what is missing so the admin page can
 * show it. The console driver prints emails to the server log instead of sending them: for development only.
 */
export function resolveEmailConfig(env: EmailEnv): EmailConfig {
  const rawDriver = cleanSetting(env.EMAIL_DRIVER)?.toLowerCase();
  if (rawDriver !== undefined && rawDriver !== 'smtp' && rawDriver !== 'console') {
    return { mode: 'off', reason: `EMAIL_DRIVER must be "smtp" or "console" (it is "${rawDriver.slice(0, 20)}").` };
  }
  const driver = rawDriver ?? (cleanSetting(env.SMTP_HOST) ? 'smtp' : undefined);
  if (!driver) return { mode: 'off', reason: 'Email is not set up. Add SMTP_HOST, EMAIL_FROM and APP_URL to .env (see .env.example).' };

  const appUrl = normalizeAppUrl(cleanSetting(env.APP_URL));
  if (!appUrl) return { mode: 'off', reason: 'APP_URL is missing or is not an http(s) address. It is the link candidates are sent, for example https://interview.example.com.' };

  const replyToRaw = cleanSetting(env.EMAIL_REPLY_TO);
  const replyTo = isPlausibleAddress(replyToRaw) ? replyToRaw.trim() : null;
  const fromCandidate = cleanSetting(env.EMAIL_FROM) ?? cleanSetting(env.SMTP_USER);
  const host = cleanSetting(env.SMTP_HOST);
  const user = cleanSetting(env.SMTP_USER);
  const pass = cleanSetting(env.SMTP_PASS);
  const portRaw = cleanSetting(env.SMTP_PORT);

  if (driver === 'console') {
    if (cleanSetting(env.NODE_ENV) === 'production') return { mode: 'off', reason: 'EMAIL_DRIVER=console only prints emails and is for development. Use smtp in production.' };
    return { mode: 'console', appUrl, from: isPlausibleAddress(fromCandidate) ? fromCandidate : 'Interview Platform <no-reply@localhost>', replyTo };
  }

  if (!host) return { mode: 'off', reason: 'SMTP_HOST is missing.' };
  if (!isPlausibleAddress(fromCandidate)) return { mode: 'off', reason: 'EMAIL_FROM is missing or is not an email address.' };
  const port = portRaw ? Number(portRaw) : 587;
  if (!Number.isInteger(port) || port < 1 || port > 65535) return { mode: 'off', reason: 'SMTP_PORT must be a number such as 587 or 465.' };
  if (Boolean(user) !== Boolean(pass)) return { mode: 'off', reason: 'Set both SMTP_USER and SMTP_PASS, or neither.' };

  return {
    mode: 'smtp',
    appUrl,
    from: fromCandidate,
    replyTo,
    host,
    port,
    secure: port === 465, // 465 is TLS from the first byte; other ports (587) upgrade with STARTTLS
    user: user ?? null,
    pass: pass ?? null,
  };
}

// ───────────────────────── Reminder settings ─────────────────────────

export interface ReminderSettings {
  enabled: boolean;
  /** Hours after the invitation before the first reminder. */
  afterHours: number;
  /** Hours between reminders. */
  everyHours: number;
  /** Most reminders one candidate ever gets. */
  max: number;
}

function boundedInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  const n = cleanSetting(raw) === undefined ? NaN : Number(cleanSetting(raw));
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
}

export function resolveReminderSettings(env: { EMAIL_REMINDERS?: string; REMINDER_AFTER_HOURS?: string; REMINDER_EVERY_HOURS?: string; REMINDER_MAX?: string }): ReminderSettings {
  return {
    enabled: cleanSetting(env.EMAIL_REMINDERS)?.toLowerCase() !== 'off',
    afterHours: boundedInt(env.REMINDER_AFTER_HOURS, 48, 1, 24 * 30),
    everyHours: boundedInt(env.REMINDER_EVERY_HOURS, 48, 1, 24 * 30),
    max: boundedInt(env.REMINDER_MAX, 2, 0, 10),
  };
}

// ───────────────────────── Idempotency keys ─────────────────────────

/**
 * One key per real-world event. The database refuses a second row with the same key, so enqueueing twice (a double click,
 * two admins, a retried request) sends one email.
 */
export const emailKeys = {
  /** The invitation created by a bulk import. */
  invite: (candidateId: string) => `invite:${candidateId}:first`,
  /** An admin pressing "Email invite" again. One per minute, so a double click is one email but a real resend later works. */
  inviteResend: (candidateId: string, now: Date) => `invite:${candidateId}:resend:${Math.floor(now.getTime() / 60_000)}`,
  /** One per approval. Each approval has its own timestamp, so a later approval (another flagged round) is a new email. */
  selected: (candidateId: string, approvedAt: Date) => `selected:${candidateId}:${approvedAt.getTime()}`,
  /** Once per candidate: a changed decision does not send "your result is ready" again. */
  resultReady: (candidateId: string) => `result:${candidateId}`,
  reminder: (candidateId: string, sequence: number) => `reminder:${candidateId}:${sequence}`,
};

// ───────────────────────── Retrying ─────────────────────────

export const MAX_ATTEMPTS = 5;
/** A row still marked "sending" after this long means the sender crashed; it goes back in the queue. */
export const STALE_SENDING_MS = 10 * 60_000;
/** Emails sent per run of the background sweep. The sweep runs every minute. */
export const SEND_PER_RUN = 30;
/** After this many failed sends in a row the run stops (the mail server is probably down) instead of using up everyone's attempts. */
export const SEND_BREAKER_LIMIT = 3;

const RETRY_DELAYS_MINUTES = [1, 5, 15, 60];

/** Wait before the next try, after `attemptsMade` tries have failed. */
export function retryDelayMs(attemptsMade: number): number {
  const i = Math.min(Math.max(attemptsMade, 1), RETRY_DELAYS_MINUTES.length) - 1;
  return RETRY_DELAYS_MINUTES[i] * 60_000;
}

export type FailureKind = 'recipient' | 'transient';

/**
 * A mail server saying "no such mailbox" will say it every time, so that email is not retried, and it says nothing about
 * whether the server itself works. Everything else (timeouts, refused connections, 4xx, wrong password) is retried.
 */
export function classifyFailure(e: unknown): FailureKind {
  const code = typeof e === 'object' && e !== null && 'responseCode' in e ? Number((e as { responseCode?: unknown }).responseCode) : NaN;
  return [550, 551, 552, 553, 554].includes(code) ? 'recipient' : 'transient';
}

export interface FailureDecision {
  status: 'PENDING' | 'FAILED';
  nextAttemptAt: Date | null;
}

export function afterFailure(kind: FailureKind, attemptsMade: number, now: Date): FailureDecision {
  if (kind === 'recipient' || attemptsMade >= MAX_ATTEMPTS) return { status: 'FAILED', nextAttemptAt: null };
  return { status: 'PENDING', nextAttemptAt: new Date(now.getTime() + retryDelayMs(attemptsMade)) };
}

/** A short, single-line reason for the admin page. Mail server replies can be long; control characters never get through. */
export function describeError(e: unknown): string {
  const name = e instanceof Error ? e.name : 'Error';
  const code = typeof e === 'object' && e !== null && 'code' in e && typeof (e as { code?: unknown }).code === 'string' ? (e as { code: string }).code : null;
  const response = typeof e === 'object' && e !== null && 'responseCode' in e ? String((e as { responseCode?: unknown }).responseCode) : null;
  const message = e instanceof Error ? e.message : '';
  const head = [code ?? name, response].filter(Boolean).join(' ');
  // eslint-disable-next-line no-control-regex
  const clean = message.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
  return `${head}${clean ? `: ${clean}` : ''}`.slice(0, 240);
}

// ───────────────────────── Sending only what is still true ─────────────────────────

export interface CandidateNow {
  status: 'ACTIVE' | 'DISQUALIFIED' | 'PENDING_REVIEW' | 'COMPLETED';
  /** True once the candidate has started any round. */
  hasStarted: boolean;
}

/**
 * An email waits in the queue, sometimes for minutes, sometimes for hours after a mail outage. If it is no longer true by
 * the time it would go out, it is cancelled instead of sent. Returns the reason, or null to send.
 */
export function cancelReason(kind: EmailKind, c: CandidateNow): string | null {
  if (kind === 'REMINDER') {
    if (c.hasStarted) return 'The candidate started the interview before this reminder went out.';
    if (c.status !== 'ACTIVE') return 'The candidate is no longer active.';
  }
  if (kind === 'SELECTED_NEXT_ROUND' && c.status === 'DISQUALIFIED') return 'The candidate was disqualified before this email went out.';
  return null;
}

// ───────────────────────── Reminders ─────────────────────────

export interface ReminderHistory {
  /** When the most recent invitation went out (a resend counts); null if none has been sent. */
  lastInviteSentAt: Date | null;
  /** Every reminder ever queued for this candidate, whatever happened to it. */
  reminders: { status: 'PENDING' | 'SENDING' | 'SENT' | 'FAILED' | 'CANCELLED'; sentAt: Date | null }[];
}

export type ReminderDecision = { due: false } | { due: true; sequence: number };

/**
 * Whether a candidate who has not started is due another reminder. The clock starts when the invitation was SENT (not
 * when it was queued), then restarts from each reminder, so nobody gets two emails close together.
 * Callers only pass candidates who are active and have not started.
 */
export function reminderDue(history: ReminderHistory, settings: ReminderSettings, now: Date): ReminderDecision {
  if (!settings.enabled || settings.max === 0 || !history.lastInviteSentAt) return { due: false };
  const count = history.reminders.length;
  if (count >= settings.max) return { due: false };
  if (history.reminders.some((r) => r.status === 'PENDING' || r.status === 'SENDING')) return { due: false };

  const sentTimes = history.reminders.map((r) => r.sentAt?.getTime() ?? 0);
  const baseline = Math.max(history.lastInviteSentAt.getTime(), ...sentTimes);
  const waitHours = count === 0 ? settings.afterHours : settings.everyHours;
  return now.getTime() >= baseline + waitHours * 3_600_000 ? { due: true, sequence: count + 1 } : { due: false };
}

/**
 * Only invitations sent after this moment are looked at when searching for reminders. An invitation older than every
 * reminder could still need keeps the search from rereading candidates who have used up their reminders.
 */
export function reminderSearchStart(settings: ReminderSettings, now: Date): Date {
  const hours = (settings.afterHours + settings.everyHours * settings.max) * 2 + 24;
  return new Date(now.getTime() - hours * 3_600_000);
}

// ───────────────────────── Login link ─────────────────────────

/** The sign-in page with the Candidate ID filled in. The password (date of birth) is never put in a link. */
export function loginLink(appUrl: string, candidateCode: string): string {
  return `${appUrl}/login?code=${encodeURIComponent(candidateCode)}`;
}

// ───────────────────────── Admin display ─────────────────────────

const KIND_NAME: Record<EmailKind, string> = { INVITE: 'Invite', SELECTED_NEXT_ROUND: 'Next round', RESULT_READY: 'Result', REMINDER: 'Reminder' };

export interface LastEmail {
  kind: EmailKind;
  status: 'PENDING' | 'SENDING' | 'SENT' | 'FAILED' | 'CANCELLED';
  sentAt: Date | null;
}

/** The small badge on the Candidates page for a candidate's most recent email. Null when there has been none. */
export function emailBadge(last: LastEmail | null): { label: string; tone: 'good' | 'warn' | 'bad' | 'neutral' } | null {
  if (!last) return null;
  const name = KIND_NAME[last.kind];
  switch (last.status) {
    case 'SENT':
      return { label: `${name} sent`, tone: 'good' };
    case 'PENDING':
    case 'SENDING':
      return { label: `${name} queued`, tone: 'neutral' };
    case 'FAILED':
      return { label: `${name} failed`, tone: 'bad' };
    case 'CANCELLED':
      return { label: `${name} not needed`, tone: 'neutral' };
  }
}
