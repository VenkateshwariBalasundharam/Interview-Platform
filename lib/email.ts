// Candidate emails (server only): the outbox, the sender and the reminder scheduler.
//
// How it works:
//   1. Something happens (bulk import, an admin approves a flagged candidate, an admin decides a result) and a row is
//      added to EmailNotification. That is all the admin's request does, so a mail outage never fails or slows it.
//   2. The background sweep (lib/sweeper.ts) calls queueDueReminders and sendDueEmails every minute. "Send now" on the
//      Candidates page calls sendDueEmails directly.
//   3. A send claims its row first (PENDING -> SENDING), so two senders never send the same email. Failures are retried
//      with growing waits; a bad address is not retried. An email that stopped being true while it waited is cancelled.
// The pure rules are in lib/email-core.ts and the wording in lib/email-templates.ts.
import nodemailer, { type Transporter } from 'nodemailer';
import { audit } from '@/lib/audit';
import { prisma } from '@/lib/db';
import {
  SEND_BREAKER_LIMIT,
  SEND_PER_RUN,
  STALE_SENDING_MS,
  afterFailure,
  cancelReason,
  classifyFailure,
  describeError,
  emailKeys,
  isPlausibleAddress,
  loginLink,
  reminderDue,
  reminderSearchStart,
  resolveEmailConfig,
  resolveReminderSettings,
  type EmailConfig,
  type EmailKind,
} from '@/lib/email-core';
import { buildEmail, type EmailContext } from '@/lib/email-templates';
import { ROUND_LIBRARY, type RoundType } from '@/lib/pipeline';

/**
 * Reads the email settings straight from the environment. It deliberately does not go through getEnv(): the rest of the app's
 * settings are validated strictly, and one bad value there (or here) must never stop emails from reporting what is wrong.
 * This never throws; a bad setting gives mode 'off' with a reason the admin page shows.
 */
export function getEmailConfig(): EmailConfig {
  return resolveEmailConfig(process.env);
}

// ───────────────────────── Transport ─────────────────────────

let cached: { key: string; transporter: Transporter } | null = null;

function transporterFor(config: Exclude<EmailConfig, { mode: 'off' }>): Transporter {
  const key = JSON.stringify(config);
  if (cached?.key === key) return cached.transporter;
  const transporter =
    config.mode === 'console'
      ? nodemailer.createTransport({ jsonTransport: true })
      : nodemailer.createTransport({
          host: config.host,
          port: config.port,
          secure: config.secure,
          auth: config.user && config.pass ? { user: config.user, pass: config.pass } : undefined,
          connectionTimeout: 10_000,
          greetingTimeout: 10_000,
          socketTimeout: 20_000,
        });
  cached = { key, transporter };
  return transporter;
}

// ───────────────────────── Queueing ─────────────────────────

export interface EnqueueItem {
  candidateId: string;
  kind: EmailKind;
  dedupeKey: string;
}

export interface EnqueueResult {
  /** New rows added. Items whose key already exists are skipped, not counted. */
  queued: number;
  /** Set when email is not set up; nothing was queued. */
  disabledReason: string | null;
}

/** Adds emails to the outbox. Nothing is queued while email is off, so switching it on later never sends a pile of stale emails. */
export async function enqueueEmails(items: EnqueueItem[], now = new Date()): Promise<EnqueueResult> {
  const config = getEmailConfig();
  if (config.mode === 'off') return { queued: 0, disabledReason: config.reason };
  if (items.length === 0) return { queued: 0, disabledReason: null };
  const created = await prisma.emailNotification.createMany({
    data: items.map((i) => ({ candidateId: i.candidateId, kind: i.kind, dedupeKey: i.dedupeKey, nextAttemptAt: now })),
    skipDuplicates: true,
  });
  return { queued: created.count, disabledReason: null };
}

/** For places that already did their real work: a queueing problem is logged and never breaks the request. */
export async function enqueueEmailsSafely(items: EnqueueItem[]): Promise<EnqueueResult> {
  try {
    return await enqueueEmails(items);
  } catch (e) {
    console.error('Could not queue email', { name: e instanceof Error ? e.name : 'UnknownError' });
    return { queued: 0, disabledReason: null };
  }
}

/** Invites for candidates just created by an import. */
export function queueInvites(candidateIds: string[]): Promise<EnqueueResult> {
  return enqueueEmailsSafely(candidateIds.map((id) => ({ candidateId: id, kind: 'INVITE' as const, dedupeKey: emailKeys.invite(id) })));
}

/** An admin sends (or resends) an invitation. The key changes each minute, so a double click is one email. */
export async function queueInviteResend(candidateId: string, adminId: string, now = new Date()): Promise<EnqueueResult> {
  const candidate = await prisma.candidate.findUnique({ where: { id: candidateId }, select: { id: true } });
  if (!candidate) return { queued: 0, disabledReason: null };
  const res = await enqueueEmails([{ candidateId, kind: 'INVITE', dedupeKey: emailKeys.inviteResend(candidateId, now) }], now);
  if (res.queued > 0) await audit({ actorType: 'ADMIN', actorId: adminId, action: 'EMAIL_INVITE_QUEUED', entity: 'Candidate', entityId: candidateId });
  return res;
}

/**
 * Invites for everyone who has none queued or sent and has not started: the way to email people imported while email was
 * off. Up to 500 per press.
 */
export async function queueMissingInvites(jobId: string | undefined, adminId: string, now = new Date()): Promise<EnqueueResult> {
  const config = getEmailConfig();
  if (config.mode === 'off') return { queued: 0, disabledReason: config.reason };
  const rows = await prisma.candidate.findMany({
    where: {
      ...(jobId ? { jobId } : {}),
      status: 'ACTIVE',
      attempts: { none: {} },
      emailNotifications: { none: { kind: 'INVITE', status: { in: ['PENDING', 'SENDING', 'SENT'] } } },
    },
    orderBy: { createdAt: 'asc' },
    take: 500,
    select: { id: true },
  });
  const res = await enqueueEmails(rows.map((r) => ({ candidateId: r.id, kind: 'INVITE' as const, dedupeKey: emailKeys.inviteResend(r.id, now) })), now);
  if (res.queued > 0) await audit({ actorType: 'ADMIN', actorId: adminId, action: 'EMAIL_INVITES_QUEUED', entity: jobId ? 'Job' : 'System', entityId: jobId ?? 'all', meta: { queued: res.queued } });
  return res;
}

/** Puts failed emails back in the queue (the mail server was fixed, or an address was corrected). */
export async function retryFailedEmails(adminId: string, now = new Date()): Promise<number> {
  const res = await prisma.emailNotification.updateMany({
    where: { status: 'FAILED' },
    data: { status: 'PENDING', attempts: 0, nextAttemptAt: now, lockedAt: null, lastError: null },
  });
  if (res.count > 0) await audit({ actorType: 'ADMIN', actorId: adminId, action: 'EMAIL_RETRY_FAILED', entity: 'System', entityId: 'email', meta: { count: res.count } });
  return res.count;
}

// ───────────────────────── Reminders ─────────────────────────

/** Queues a reminder for each candidate who was invited, has not started and is due one. Returns how many were queued. */
export async function queueDueReminders(now = new Date()): Promise<number> {
  const config = getEmailConfig();
  const settings = resolveReminderSettings(process.env as Record<string, string | undefined>);
  if (config.mode === 'off' || !settings.enabled || settings.max === 0) return 0;

  const rows = await prisma.candidate.findMany({
    where: {
      status: 'ACTIVE',
      attempts: { none: {} },
      emailNotifications: {
        some: { kind: 'INVITE', status: 'SENT', sentAt: { gte: reminderSearchStart(settings, now) } },
        none: { kind: 'REMINDER', status: { in: ['PENDING', 'SENDING'] } },
      },
    },
    orderBy: { createdAt: 'asc' },
    take: 500,
    select: { id: true, emailNotifications: { where: { kind: { in: ['INVITE', 'REMINDER'] } }, select: { kind: true, status: true, sentAt: true } } },
  });

  const items: EnqueueItem[] = [];
  for (const c of rows) {
    const inviteTimes = c.emailNotifications.filter((n) => n.kind === 'INVITE' && n.status === 'SENT' && n.sentAt).map((n) => n.sentAt!.getTime());
    const decision = reminderDue(
      {
        lastInviteSentAt: inviteTimes.length ? new Date(Math.max(...inviteTimes)) : null,
        reminders: c.emailNotifications.filter((n) => n.kind === 'REMINDER').map((n) => ({ status: n.status, sentAt: n.sentAt })),
      },
      settings,
      now,
    );
    if (decision.due) items.push({ candidateId: c.id, kind: 'REMINDER', dedupeKey: emailKeys.reminder(c.id, decision.sequence) });
  }
  const res = await enqueueEmails(items, now);
  return res.queued;
}

// ───────────────────────── Sending ─────────────────────────

function errorCodes(e: unknown): string {
  const o = typeof e === 'object' && e !== null ? (e as { code?: unknown; responseCode?: unknown }) : {};
  return [typeof o.code === 'string' ? o.code : null, typeof o.responseCode === 'number' ? o.responseCode : null].filter(Boolean).join(' ') || (e instanceof Error ? e.name : 'UnknownError');
}

export interface SendReport {
  sent: number;
  /** Failed for good: bad address, or out of attempts. */
  failed: number;
  /** Failed this time and will be tried again. */
  retrying: number;
  cancelled: number;
  /** The mail server kept failing, so the rest waits for the next run. */
  stoppedEarly: boolean;
  /** Why nothing was done, when email is off. */
  skipped: string | null;
}

export const emptySendReport = (): SendReport => ({ sent: 0, failed: 0, retrying: 0, cancelled: 0, stoppedEarly: false, skipped: null });

type CandidateForEmail = {
  id: string;
  name: string;
  email: string;
  candidateCode: string;
  status: 'ACTIVE' | 'DISQUALIFIED' | 'PENDING_REVIEW' | 'COMPLETED';
  job: { title: string; rounds: { roundType: RoundType; position: number; enabled: boolean; proctoringLevel: 'OFF' | 'PRESENCE' | 'IDENTITY' }[] };
  attempts: { roundType: RoundType }[];
};

function contextFor(c: CandidateForEmail, appUrl: string): EmailContext {
  const rounds = c.job.rounds.filter((r) => r.enabled).sort((a, b) => a.position - b.position);
  const started = new Set(c.attempts.map((a) => a.roundType));
  const next = rounds.find((r) => !started.has(r.roundType));
  return {
    name: c.name,
    jobTitle: c.job.title,
    candidateCode: c.candidateCode,
    loginUrl: loginLink(appUrl, c.candidateCode),
    roundLabels: rounds.map((r) => ROUND_LIBRARY[r.roundType].label),
    usesCamera: rounds.some((r) => r.proctoringLevel !== 'OFF'),
    nextRoundLabel: next ? ROUND_LIBRARY[next.roundType].label : null,
  };
}

const CANDIDATE_FOR_EMAIL = {
  id: true,
  name: true,
  email: true,
  candidateCode: true,
  status: true,
  job: { select: { title: true, rounds: { select: { roundType: true, position: true, enabled: true, proctoringLevel: true } } } },
  attempts: { select: { roundType: true } },
} as const;

/** Sends what is due, oldest first, up to SEND_PER_RUN. Safe to run from several places at once. */
export async function sendDueEmails(opts: { now?: Date; hasTimeLeft?: () => boolean } = {}): Promise<SendReport> {
  const now = opts.now ?? new Date();
  const report = emptySendReport();
  const config = getEmailConfig();
  if (config.mode === 'off') {
    report.skipped = config.reason;
    return report;
  }
  const transporter = transporterFor(config);

  // A sender that crashed mid-send leaves its row marked SENDING; put those back.
  await prisma.emailNotification.updateMany({
    where: { status: 'SENDING', lockedAt: { lt: new Date(now.getTime() - STALE_SENDING_MS) } },
    data: { status: 'PENDING', lockedAt: null },
  });

  const due = await prisma.emailNotification.findMany({
    where: { status: 'PENDING', nextAttemptAt: { lte: now } },
    orderBy: { nextAttemptAt: 'asc' },
    take: SEND_PER_RUN,
    select: { id: true, kind: true, attempts: true, candidate: { select: CANDIDATE_FOR_EMAIL } },
  });

  let streak = 0;
  for (const row of due) {
    if (opts.hasTimeLeft && !opts.hasTimeLeft()) {
      report.stoppedEarly = true;
      break;
    }
    if (streak >= SEND_BREAKER_LIMIT) {
      report.stoppedEarly = true;
      break;
    }

    const claimed = await prisma.emailNotification.updateMany({
      where: { id: row.id, status: 'PENDING' },
      data: { status: 'SENDING', lockedAt: now, attempts: { increment: 1 } },
    });
    if (claimed.count === 0) continue; // another sender took it
    const attemptsMade = row.attempts + 1;
    const c = row.candidate as CandidateForEmail;

    const reason = cancelReason(row.kind, { status: c.status, hasStarted: c.attempts.length > 0 });
    if (reason) {
      await prisma.emailNotification.update({ where: { id: row.id }, data: { status: 'CANCELLED', lockedAt: null, lastError: reason } });
      report.cancelled += 1;
      continue;
    }
    if (!isPlausibleAddress(c.email)) {
      await prisma.emailNotification.update({ where: { id: row.id }, data: { status: 'FAILED', lockedAt: null, lastError: 'The candidate\'s email address is not valid. Correct it, then press Retry failed.' } });
      report.failed += 1;
      continue;
    }

    try {
      const mail = buildEmail(row.kind, contextFor(c, config.appUrl));
      await transporter.sendMail({ from: config.from, replyTo: config.replyTo ?? undefined, to: c.email.trim(), subject: mail.subject, text: mail.text, html: mail.html });
      if (config.mode === 'console') console.log(`[email:console] to=${c.email} subject="${mail.subject}"\n${mail.text}\n`);
      await prisma.emailNotification.update({ where: { id: row.id }, data: { status: 'SENT', sentAt: new Date(), sentTo: c.email.trim(), lockedAt: null, lastError: null } });
      report.sent += 1;
      streak = 0;
    } catch (e) {
      const kind = classifyFailure(e);
      const decision = afterFailure(kind, attemptsMade, now);
      await prisma.emailNotification.update({
        where: { id: row.id },
        data: { status: decision.status, nextAttemptAt: decision.nextAttemptAt ?? undefined, lockedAt: null, lastError: describeError(e) },
      });
      if (decision.status === 'FAILED') report.failed += 1;
      else report.retrying += 1;
      // A bad mailbox says nothing about the mail server; only server-side trouble counts toward stopping the run.
      streak = kind === 'transient' ? streak + 1 : streak;
      // Only codes are logged: a mail server's message text often repeats the recipient's address.
      console.error('Email send failed', { kind: row.kind, failure: kind, code: errorCodes(e) });
    }
  }
  return report;
}

// ───────────────────────── Admin overview ─────────────────────────

export interface EmailOverview {
  mode: 'off' | 'smtp' | 'console';
  /** Why email is off, or a note for the console driver. */
  note: string | null;
  queued: number;
  failed: number;
  sentLast24h: number;
  recentFailures: { id: string; candidateCode: string; name: string; kind: EmailKind; lastError: string | null }[];
}

export async function getEmailOverview(now = new Date()): Promise<EmailOverview> {
  const config = getEmailConfig();
  const [queued, failed, sentLast24h, recent] = await Promise.all([
    prisma.emailNotification.count({ where: { status: { in: ['PENDING', 'SENDING'] } } }),
    prisma.emailNotification.count({ where: { status: 'FAILED' } }),
    prisma.emailNotification.count({ where: { status: 'SENT', sentAt: { gte: new Date(now.getTime() - 86_400_000) } } }),
    prisma.emailNotification.findMany({ where: { status: 'FAILED' }, orderBy: { createdAt: 'desc' }, take: 5, select: { id: true, kind: true, lastError: true, candidate: { select: { candidateCode: true, name: true } } } }),
  ]);
  return {
    mode: config.mode,
    note: config.mode === 'off' ? config.reason : config.mode === 'console' ? 'Development mode: emails are printed in the server log, not sent.' : null,
    queued,
    failed,
    sentLast24h,
    recentFailures: recent.map((r) => ({ id: r.id, candidateCode: r.candidate.candidateCode, name: r.candidate.name, kind: r.kind, lastError: r.lastError })),
  };
}
