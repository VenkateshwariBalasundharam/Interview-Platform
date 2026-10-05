// Orchestration of runSweep with the database, grading, lease and purge replaced by fakes.
// (The real database paths are covered by the manual checklist in the README.)
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  const state = {
    leaseAllowed: true,
    housekeepingAllowed: true,
    overdue: [] as { id: string }[],
    waiting: [] as { id: string }[],
    failures: {} as Record<string, number>,
    finalizeFails: new Set<string>(),
    gradeResult: {} as Record<string, 'done' | 'pending' | 'busy' | 'throw'>,
    purgeFails: false,
  };
  return {
    state,
    calls: { finalize: [] as string[], grade: [] as string[], waitingWhere: null as unknown, audit: [] as unknown[], runs: [] as unknown[], leaseKeys: [] as string[] },
  };
});

vi.mock('@/lib/http', () => ({
  AppError: class AppError extends Error {
    constructor(public status: number, public code: string, message: string) {
      super(message);
    }
  },
}));
vi.mock('@/lib/ratelimit', () => ({
  consumeRateLimit: vi.fn(async (key: string) => {
    h.calls.leaseKeys.push(key);
    return { allowed: key === 'sweep:lease' ? h.state.leaseAllowed : h.state.housekeepingAllowed, retryAfterSec: 1 };
  }),
}));
vi.mock('@/lib/audit', () => ({ audit: vi.fn(async (e: unknown) => void h.calls.audit.push(e)) }));
vi.mock('@/lib/face', () => ({
  purgeExpired: vi.fn(async () => {
    if (h.state.purgeFails) throw new Error('disk gone');
    return { snapshots: 2, faceReferences: 1 };
  }),
}));
vi.mock('@/lib/rounds', () => ({
  finalizeAttempt: vi.fn(async (id: string) => {
    h.calls.finalize.push(id);
    if (h.state.finalizeFails.has(id)) throw new Error('db blip');
  }),
  gradePendingAnswers: vi.fn(async (id: string) => {
    h.calls.grade.push(id);
    const r = h.state.gradeResult[id] ?? 'done';
    if (r === 'throw') throw new Error('ai exploded');
    return r;
  }),
}));
vi.mock('@/lib/db', () => ({
  prisma: {
    attempt: {
      findMany: vi.fn(async ({ where }: { where: { status: unknown } }) => {
        if (where.status === 'IN_PROGRESS') return h.state.overdue;
        h.calls.waitingWhere = where;
        return h.state.waiting;
      }),
    },
    auditLog: { count: vi.fn(async ({ where }: { where: { entityId: string } }) => h.state.failures[where.entityId] ?? 0) },
    rateLimit: { deleteMany: vi.fn(async () => ({ count: 4 })) },
    sweepRun: {
      create: vi.fn(async ({ data }: { data: unknown }) => void h.calls.runs.push(data)),
      deleteMany: vi.fn(async () => ({ count: 7 })),
    },
  },
}));

import { runSweep } from '@/lib/sweeper';
import { BREAKER_LIMIT, MAX_FAILURES_PER_HOUR } from '@/lib/sweeper-core';

beforeEach(() => {
  Object.assign(h.state, { leaseAllowed: true, housekeepingAllowed: false, overdue: [], waiting: [], failures: {}, gradeResult: {}, purgeFails: false });
  h.state.finalizeFails.clear();
  h.calls.finalize.length = 0;
  h.calls.grade.length = 0;
  h.calls.audit.length = 0;
  h.calls.runs.length = 0;
  h.calls.leaseKeys.length = 0;
  h.calls.waitingWhere = null;
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

const ids = (...n: string[]) => n.map((id) => ({ id }));

describe('runSweep', () => {
  it('does nothing when another sweep holds the lease', async () => {
    h.state.leaseAllowed = false;
    h.state.overdue = ids('a');
    const r = await runSweep({ trigger: 'cron' });
    expect(r.skipped).toBe('ALREADY_RUNNING');
    expect(h.calls.finalize).toEqual([]);
    expect(h.calls.runs).toEqual([]);
  });

  it('submits overdue rounds in the order given and sends them straight to grading', async () => {
    h.state.overdue = ids('o1', 'o2');
    h.state.waiting = ids('o1', 'o2');
    const r = await runSweep({ trigger: 'cron' });
    expect(h.calls.finalize).toEqual(['o1', 'o2']);
    expect(r.finalized).toBe(2);
    const where = h.calls.waitingWhere as { OR: [unknown, { id: { in: string[] } }] };
    expect(where.OR[1].id.in.sort()).toEqual(['o1', 'o2']);
    expect(h.calls.grade).toEqual(['o1', 'o2']);
    expect(r.graded).toBe(2);
  });

  it('counts a failed submit as an error and keeps going', async () => {
    h.state.overdue = ids('bad', 'good');
    h.state.finalizeFails.add('bad');
    const r = await runSweep({ trigger: 'cron' });
    expect(r.errors).toBe(1);
    expect(r.finalized).toBe(1);
    expect(h.calls.finalize).toEqual(['bad', 'good']);
  });

  it('counts done, busy and unfinished gradings separately', async () => {
    h.state.waiting = ids('d', 'b', 'p');
    h.state.gradeResult = { d: 'done', b: 'busy', p: 'pending' };
    const r = await runSweep({ trigger: 'script' });
    expect(r).toMatchObject({ graded: 1, held: 1, stillPending: 1, errors: 0, stoppedEarly: false });
  });

  it('stops after several unfinished gradings in a row (AI down)', async () => {
    const all = Array.from({ length: BREAKER_LIMIT + 3 }, (_, i) => `w${i}`);
    h.state.waiting = ids(...all);
    for (const id of all) h.state.gradeResult[id] = 'pending';
    const r = await runSweep({ trigger: 'cron' });
    expect(h.calls.grade).toHaveLength(BREAKER_LIMIT);
    expect(r.stillPending).toBe(BREAKER_LIMIT);
    expect(r.stoppedEarly).toBe(true);
  });

  it('a finished grading resets the streak', async () => {
    h.state.waiting = ids('p1', 'p2', 'ok', 'p3', 'p4', 'p5');
    Object.assign(h.state.gradeResult, { p1: 'pending', p2: 'pending', ok: 'done', p3: 'pending', p4: 'pending', p5: 'pending' });
    await runSweep({ trigger: 'cron' });
    expect(h.calls.grade).toEqual(['p1', 'p2', 'ok', 'p3', 'p4', 'p5']);
  });

  it('leaves a round alone once it failed too often in the last hour', async () => {
    h.state.waiting = ids('flaky', 'fine');
    h.state.failures = { flaky: MAX_FAILURES_PER_HOUR };
    const r = await runSweep({ trigger: 'cron' });
    expect(h.calls.grade).toEqual(['fine']);
    expect(r.held).toBe(1);
    expect(r.graded).toBe(1);
  });

  it('treats a throwing grader as an error and counts it towards the streak', async () => {
    h.state.waiting = ids('t');
    h.state.gradeResult = { t: 'throw' };
    const r = await runSweep({ trigger: 'cron' });
    expect(r.errors).toBe(1);
    expect(r.graded).toBe(0);
  });

  it('does no new work once the time budget is used', async () => {
    h.state.overdue = ids('a', 'b');
    h.state.waiting = ids('c');
    const r = await runSweep({ trigger: 'cron', budgetMs: 1 });
    expect(h.calls.finalize).toEqual([]);
    expect(h.calls.grade).toEqual([]);
    expect(r.stoppedEarly).toBe(true);
  });

  it('runs housekeeping only when its hourly lease is free, and reports what it removed', async () => {
    let r = await runSweep({ trigger: 'cron' });
    expect(r.housekeeping.ran).toBe(false);
    h.calls.leaseKeys.length = 0;
    h.state.housekeepingAllowed = true;
    h.state.leaseAllowed = true;
    r = await runSweep({ trigger: 'cron' });
    expect(r.housekeeping).toEqual({ ran: true, snapshots: 2, faceReferences: 1, rateLimits: 4, runs: 7 });
  });

  it('a housekeeping failure is an error, not a crash', async () => {
    h.state.housekeepingAllowed = true;
    h.state.purgeFails = true;
    const r = await runSweep({ trigger: 'cron' });
    expect(r.errors).toBe(1);
    expect(r.housekeeping.ran).toBe(false);
  });

  it('records a heartbeat every run, and an audit entry only when something happened', async () => {
    await runSweep({ trigger: 'cron' });
    expect(h.calls.runs).toHaveLength(1);
    expect(h.calls.audit).toHaveLength(0);

    h.state.overdue = ids('x');
    await runSweep({ trigger: 'admin', actorId: 'adm1' });
    expect(h.calls.runs).toHaveLength(2);
    expect(h.calls.audit).toHaveLength(1);
    expect(h.calls.audit[0]).toMatchObject({ action: 'SWEEP_RUN', actorType: 'ADMIN', actorId: 'adm1', meta: { finalized: 1 } });
  });
});
