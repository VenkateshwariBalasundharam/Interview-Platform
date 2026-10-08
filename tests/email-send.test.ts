import { beforeEach, describe, expect, it, vi } from 'vitest';

// A tiny in-memory stand-in for the EmailNotification table and the mail transport, so the sender's real logic runs.
type Row = {
  id: string; candidateId: string; kind: 'INVITE' | 'SELECTED_NEXT_ROUND' | 'RESULT_READY' | 'REMINDER'; dedupeKey: string;
  status: 'PENDING' | 'SENDING' | 'SENT' | 'FAILED' | 'CANCELLED'; attempts: number; nextAttemptAt: Date; lockedAt: Date | null;
  sentAt: Date | null; sentTo: string | null; lastError: string | null;
};
const db = vi.hoisted(() => ({ rows: [] as Row[], candidates: {} as Record<string, unknown>, sent: [] as { to: string; subject: string; text: string }[], failWith: null as unknown }));

vi.mock('@/lib/audit', () => ({ audit: vi.fn() }));
vi.mock('nodemailer', () => ({
  default: {
    createTransport: () => ({
      sendMail: async (m: { to: string; subject: string; text: string }) => {
        if (db.failWith) throw db.failWith;
        db.sent.push({ to: m.to, subject: m.subject, text: m.text });
        return {};
      },
    }),
  },
}));
vi.mock('@/lib/db', () => {
  const match = (r: Row, where: Record<string, unknown>) =>
    Object.entries(where).every(([k, v]) => {
      const val = (r as unknown as Record<string, unknown>)[k];
      if (v && typeof v === 'object' && !(v instanceof Date)) {
        const o = v as { in?: unknown[]; lte?: Date; lt?: Date };
        if (o.in) return o.in.includes(val);
        if (o.lte) return (val as Date).getTime() <= o.lte.getTime();
        if (o.lt) return val !== null && (val as Date).getTime() < o.lt.getTime();
      }
      return val === v;
    });
  return {
    prisma: {
      emailNotification: {
        createMany: async ({ data }: { data: Partial<Row>[] }) => {
          let count = 0;
          for (const d of data) {
            if (db.rows.some((r) => r.dedupeKey === d.dedupeKey)) continue;
            db.rows.push({ id: `n${db.rows.length + 1}`, status: 'PENDING', attempts: 0, lockedAt: null, sentAt: null, sentTo: null, lastError: null, ...d } as Row);
            count++;
          }
          return { count };
        },
        updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
          const hits = db.rows.filter((r) => match(r, where));
          for (const r of hits) {
            for (const [k, v] of Object.entries(data)) {
              if (v && typeof v === 'object' && 'increment' in (v as object)) (r as unknown as Record<string, number>)[k] += (v as { increment: number }).increment;
              else (r as unknown as Record<string, unknown>)[k] = v;
            }
          }
          return { count: hits.length };
        },
        update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const r = db.rows.find((x) => x.id === where.id)!;
          for (const [k, v] of Object.entries(data)) if (v !== undefined) (r as unknown as Record<string, unknown>)[k] = v;
          return r;
        },
        findMany: async ({ where, take }: { where: Record<string, unknown>; take: number }) =>
          db.rows
            .filter((r) => match(r, where))
            .sort((a, b) => a.nextAttemptAt.getTime() - b.nextAttemptAt.getTime())
            .slice(0, take)
            .map((r) => ({ id: r.id, kind: r.kind, attempts: r.attempts, candidate: db.candidates[r.candidateId] })),
      },
    },
  };
});

const now = new Date('2026-10-05T12:00:00.000Z');
const candidate = (over: Record<string, unknown> = {}) => ({
  id: 'c1', name: 'Asha Verma', email: 'asha@example.com', candidateCode: 'CAND-KQMT1001', status: 'ACTIVE',
  job: { title: 'Backend Engineer', rounds: [{ roundType: 'ASSESSMENT', position: 1, enabled: true, proctoringLevel: 'OFF' }, { roundType: 'CODING', position: 2, enabled: true, proctoringLevel: 'OFF' }] },
  attempts: [],
  ...over,
});

async function load() {
  vi.resetModules();
  vi.stubEnv('APP_URL', 'https://interview.example.com');
  vi.stubEnv('SMTP_HOST', 'smtp.example.com');
  vi.stubEnv('EMAIL_FROM', 'Hiring <hr@example.com>');
  vi.stubEnv('DATABASE_URL', 'postgresql://x');
  vi.stubEnv('JWT_SECRET', 'x'.repeat(40));
  return import('@/lib/email');
}

beforeEach(() => {
  db.rows = [];
  db.candidates = { c1: candidate() };
  db.sent = [];
  db.failWith = null;
  vi.unstubAllEnvs();
});

describe('queueing', () => {
  it('queues nothing, and says why, while email is not set up', async () => {
    vi.resetModules();
    vi.stubEnv('DATABASE_URL', 'postgresql://x');
    vi.stubEnv('JWT_SECRET', 'x'.repeat(40));
    const { enqueueEmails } = await import('@/lib/email');
    const res = await enqueueEmails([{ candidateId: 'c1', kind: 'INVITE', dedupeKey: 'k1' }]);
    expect(res.queued).toBe(0);
    expect(res.disabledReason).toContain('SMTP_HOST');
    expect(db.rows).toHaveLength(0);
  });
  it('queues one row per event, so repeating the same event is a no-op', async () => {
    const { enqueueEmails } = await load();
    const item = { candidateId: 'c1', kind: 'RESULT_READY' as const, dedupeKey: 'result:c1' };
    expect((await enqueueEmails([item])).queued).toBe(1);
    expect((await enqueueEmails([item])).queued).toBe(0);
    expect(db.rows).toHaveLength(1);
  });
});

describe('settings problems elsewhere in the environment', () => {
  it('do not stop email from working, because email reads its own settings', async () => {
    vi.resetModules();
    vi.stubEnv('APP_URL', 'https://interview.example.com');
    vi.stubEnv('SMTP_HOST', 'smtp.example.com');
    vi.stubEnv('EMAIL_FROM', 'Hiring <hr@example.com>');
    vi.stubEnv('JWT_SECRET', 'too-short'); // would make getEnv() throw
    vi.stubEnv('EMAIL_REMINDERS', '');
    vi.stubEnv('EMAIL_DRIVER', '');
    const { enqueueEmails, sendDueEmails, getEmailConfig } = await import('@/lib/email');
    expect(getEmailConfig().mode).toBe('smtp');
    await enqueueEmails([{ candidateId: 'c1', kind: 'INVITE', dedupeKey: 'k1' }], now);
    expect((await sendDueEmails({ now })).sent).toBe(1);
  });
  it('a bad email setting turns email off with a reason instead of throwing', async () => {
    vi.resetModules();
    vi.stubEnv('EMAIL_DRIVER', 'carrier-pigeon');
    const { sendDueEmails } = await import('@/lib/email');
    expect((await sendDueEmails({ now })).skipped).toContain('EMAIL_DRIVER');
  });
});

describe('sending', () => {
  it('sends an invitation with the login link and marks it sent', async () => {
    const { enqueueEmails, sendDueEmails } = await load();
    await enqueueEmails([{ candidateId: 'c1', kind: 'INVITE', dedupeKey: 'k1' }], now);
    const report = await sendDueEmails({ now });
    expect(report).toMatchObject({ sent: 1, failed: 0, retrying: 0, cancelled: 0 });
    expect(db.sent[0].to).toBe('asha@example.com');
    expect(db.sent[0].text).toContain('https://interview.example.com/login?code=CAND-KQMT1001');
    expect(db.rows[0]).toMatchObject({ status: 'SENT', sentTo: 'asha@example.com', attempts: 1, lockedAt: null });
  });
  it('does not send the same email twice when two senders overlap', async () => {
    const { enqueueEmails, sendDueEmails } = await load();
    await enqueueEmails([{ candidateId: 'c1', kind: 'INVITE', dedupeKey: 'k1' }], now);
    await Promise.all([sendDueEmails({ now }), sendDueEmails({ now })]);
    expect(db.sent).toHaveLength(1);
  });
  it('leaves emails that are not due yet', async () => {
    const { enqueueEmails, sendDueEmails } = await load();
    await enqueueEmails([{ candidateId: 'c1', kind: 'INVITE', dedupeKey: 'k1' }], new Date(now.getTime() + 60_000));
    expect((await sendDueEmails({ now })).sent).toBe(0);
  });
  it('sends to the address the candidate has now, not the one they had when it was queued', async () => {
    const { enqueueEmails, sendDueEmails } = await load();
    await enqueueEmails([{ candidateId: 'c1', kind: 'INVITE', dedupeKey: 'k1' }], now);
    db.candidates.c1 = candidate({ email: 'asha.new@example.com' });
    await sendDueEmails({ now });
    expect(db.sent[0].to).toBe('asha.new@example.com');
  });
  it('names the next round in the "selected" email', async () => {
    const { enqueueEmails, sendDueEmails } = await load();
    db.candidates.c1 = candidate({ attempts: [{ roundType: 'ASSESSMENT' }] });
    await enqueueEmails([{ candidateId: 'c1', kind: 'SELECTED_NEXT_ROUND', dedupeKey: 'k1' }], now);
    await sendDueEmails({ now });
    expect(db.sent[0].text).toContain('Your next round is Coding.');
  });
});

describe('when things go wrong', () => {
  it('retries a server failure later and records why', async () => {
    const { enqueueEmails, sendDueEmails } = await load();
    await enqueueEmails([{ candidateId: 'c1', kind: 'INVITE', dedupeKey: 'k1' }], now);
    db.failWith = Object.assign(new Error('connect ETIMEDOUT'), { code: 'ETIMEDOUT' });
    const report = await sendDueEmails({ now });
    expect(report).toMatchObject({ sent: 0, retrying: 1, failed: 0 });
    expect(db.rows[0].status).toBe('PENDING');
    expect(db.rows[0].nextAttemptAt.getTime()).toBe(now.getTime() + 60_000);
    expect(db.rows[0].lastError).toContain('ETIMEDOUT');
    // Not due again immediately, due after the wait, and it goes out once the server recovers.
    expect((await sendDueEmails({ now })).retrying).toBe(0);
    db.failWith = null;
    expect((await sendDueEmails({ now: new Date(now.getTime() + 61_000) })).sent).toBe(1);
  });
  it('gives up after the attempts run out', async () => {
    const { enqueueEmails, sendDueEmails } = await load();
    await enqueueEmails([{ candidateId: 'c1', kind: 'INVITE', dedupeKey: 'k1' }], now);
    db.failWith = Object.assign(new Error('down'), { code: 'ECONNECTION' });
    let t = now.getTime();
    for (let i = 0; i < 6; i++) {
      await sendDueEmails({ now: new Date(t) });
      t += 2 * 3_600_000;
    }
    expect(db.rows[0].status).toBe('FAILED');
    expect(db.rows[0].attempts).toBe(5);
  });
  it('does not retry a mailbox the server rejected', async () => {
    const { enqueueEmails, sendDueEmails } = await load();
    await enqueueEmails([{ candidateId: 'c1', kind: 'INVITE', dedupeKey: 'k1' }], now);
    db.failWith = Object.assign(new Error('No such user'), { responseCode: 550 });
    expect(await sendDueEmails({ now })).toMatchObject({ failed: 1, retrying: 0 });
    expect(db.rows[0].status).toBe('FAILED');
  });
  it('fails an invalid stored address without trying to send', async () => {
    const { enqueueEmails, sendDueEmails } = await load();
    db.candidates.c1 = candidate({ email: 'not-an-email' });
    await enqueueEmails([{ candidateId: 'c1', kind: 'INVITE', dedupeKey: 'k1' }], now);
    expect((await sendDueEmails({ now })).failed).toBe(1);
    expect(db.sent).toHaveLength(0);
    expect(db.rows[0].lastError).toContain('not valid');
  });
  it('cancels a reminder for a candidate who started in the meantime', async () => {
    const { enqueueEmails, sendDueEmails } = await load();
    db.candidates.c1 = candidate({ attempts: [{ roundType: 'ASSESSMENT' }] });
    await enqueueEmails([{ candidateId: 'c1', kind: 'REMINDER', dedupeKey: 'k1' }], now);
    expect(await sendDueEmails({ now })).toMatchObject({ cancelled: 1, sent: 0 });
    expect(db.rows[0].status).toBe('CANCELLED');
    expect(db.sent).toHaveLength(0);
  });
  it('stops the run when the mail server keeps failing, leaving the rest untouched', async () => {
    const { enqueueEmails, sendDueEmails } = await load();
    for (let i = 1; i <= 6; i++) {
      db.candidates[`c${i}`] = candidate({ id: `c${i}`, email: `p${i}@example.com` });
      await enqueueEmails([{ candidateId: `c${i}`, kind: 'INVITE', dedupeKey: `k${i}` }], new Date(now.getTime() - (10 - i) * 1000));
    }
    db.failWith = Object.assign(new Error('down'), { code: 'ECONNECTION' });
    const report = await sendDueEmails({ now });
    expect(report.stoppedEarly).toBe(true);
    expect(report.retrying).toBe(3);
    expect(db.rows.filter((r) => r.attempts === 0)).toHaveLength(3); // the other three never used an attempt
  });
  it('a rejected mailbox does not count as the server being down', async () => {
    const { enqueueEmails, sendDueEmails } = await load();
    for (let i = 1; i <= 5; i++) {
      db.candidates[`c${i}`] = candidate({ id: `c${i}` });
      await enqueueEmails([{ candidateId: `c${i}`, kind: 'INVITE', dedupeKey: `k${i}` }], now);
    }
    db.failWith = Object.assign(new Error('No such user'), { responseCode: 550 });
    const report = await sendDueEmails({ now });
    expect(report.failed).toBe(5);
    expect(report.stoppedEarly).toBe(false);
  });
  it('puts a row back in the queue when its sender crashed mid-send', async () => {
    const { enqueueEmails, sendDueEmails } = await load();
    await enqueueEmails([{ candidateId: 'c1', kind: 'INVITE', dedupeKey: 'k1' }], now);
    db.rows[0].status = 'SENDING';
    db.rows[0].lockedAt = new Date(now.getTime() - 11 * 60_000);
    expect((await sendDueEmails({ now })).sent).toBe(1);
  });
  it('leaves a row that is being sent right now alone', async () => {
    const { enqueueEmails, sendDueEmails } = await load();
    await enqueueEmails([{ candidateId: 'c1', kind: 'INVITE', dedupeKey: 'k1' }], now);
    db.rows[0].status = 'SENDING';
    db.rows[0].lockedAt = new Date(now.getTime() - 60_000);
    expect((await sendDueEmails({ now })).sent).toBe(0);
  });
  it('stops starting new emails when the time budget is spent', async () => {
    const { enqueueEmails, sendDueEmails } = await load();
    await enqueueEmails([{ candidateId: 'c1', kind: 'INVITE', dedupeKey: 'k1' }], now);
    const report = await sendDueEmails({ now, hasTimeLeft: () => false });
    expect(report).toMatchObject({ sent: 0, stoppedEarly: true });
    expect(db.rows[0].status).toBe('PENDING');
  });
  it('does nothing while email is off', async () => {
    vi.resetModules();
    vi.stubEnv('DATABASE_URL', 'postgresql://x');
    vi.stubEnv('JWT_SECRET', 'x'.repeat(40));
    const { sendDueEmails } = await import('@/lib/email');
    expect((await sendDueEmails({ now })).skipped).toContain('SMTP_HOST');
  });
});
