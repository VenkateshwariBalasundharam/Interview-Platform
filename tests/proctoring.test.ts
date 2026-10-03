import { describe, expect, it } from 'vitest';
import {
  MAX_EVENTS_PER_REQUEST,
  describeEvent,
  formatDuration,
  formatOffset,
  limitReachedAt,
  occurredAtFor,
  proctorBatchSchema,
  summarizeEvents,
  tabSwitchMessage,
  tabSwitchStatus,
  toStoredEvent,
  type RawEvent,
} from '@/lib/proctoring-core';

const roundStart = new Date('2026-09-30T10:00:00Z');
const now = new Date('2026-09-30T10:20:00Z');

describe('proctor request validation', () => {
  it('accepts the three browser event types', () => {
    const parsed = proctorBatchSchema.safeParse({
      events: [
        { type: 'TAB_SWITCH', msAgo: 14000, awayMs: 12000, source: 'hidden' },
        { type: 'PASTE', msAgo: 200, chars: 340, target: 'answer' },
        { type: 'FULLSCREEN_EXIT', msAgo: 0 },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it('refuses face-check types and unknown types', () => {
    for (const type of ['NO_FACE', 'MULTIPLE_FACES', 'LOOKING_AWAY', 'IDENTITY_MISMATCH', 'WHATEVER']) {
      expect(proctorBatchSchema.safeParse({ events: [{ type, msAgo: 0 }] }).success).toBe(false);
    }
  });

  it('needs between 1 and 20 events', () => {
    const one = { type: 'FULLSCREEN_EXIT', msAgo: 0 };
    expect(proctorBatchSchema.safeParse({ events: [] }).success).toBe(false);
    expect(proctorBatchSchema.safeParse({ events: Array(MAX_EVENTS_PER_REQUEST).fill(one) }).success).toBe(true);
    expect(proctorBatchSchema.safeParse({ events: Array(MAX_EVENTS_PER_REQUEST + 1).fill(one) }).success).toBe(false);
  });

  it('drops unknown fields, so pasted text can never be smuggled into a row', () => {
    const parsed = proctorBatchSchema.parse({ events: [{ type: 'PASTE', msAgo: 5, chars: 10, target: 'editor', text: 'secret', extra: 1 }] });
    expect(parsed.events[0]).toEqual({ type: 'PASTE', msAgo: 5, chars: 10, target: 'editor' });
  });

  it('rejects negative, non-finite and oversized numbers and bad labels', () => {
    const bad = [
      { type: 'PASTE', msAgo: -1, chars: 5, target: 'answer' },
      { type: 'PASTE', msAgo: 0, chars: -5, target: 'answer' },
      { type: 'PASTE', msAgo: 0, chars: 5, target: 'clipboard' },
      { type: 'TAB_SWITCH', msAgo: 0, awayMs: Number.POSITIVE_INFINITY, source: 'hidden' },
      { type: 'TAB_SWITCH', msAgo: 0, awayMs: 10, source: 'minimised' },
      { type: 'TAB_SWITCH', msAgo: 7 * 3600 * 1000, awayMs: 10, source: 'blur' },
      { type: 'FULLSCREEN_EXIT', msAgo: 0, refused: false },
    ];
    for (const event of bad) expect(proctorBatchSchema.safeParse({ events: [event] }).success).toBe(false);
  });
});

describe('event time comes from the server clock', () => {
  it('is now minus msAgo', () => {
    expect(occurredAtFor(now, 14_000, roundStart).toISOString()).toBe('2026-09-30T10:19:46.000Z');
  });

  it('is never earlier than the round start', () => {
    expect(occurredAtFor(now, 5 * 3600 * 1000, roundStart).getTime()).toBe(roundStart.getTime());
  });

  it('is never in the future', () => {
    expect(occurredAtFor(now, -5000, roundStart).getTime()).toBe(now.getTime());
  });
});

describe('stored rows', () => {
  it('keeps only lengths, durations and labels', () => {
    expect(toStoredEvent({ type: 'PASTE', msAgo: 0, chars: 340.4, target: 'answer' }, now, roundStart).meta).toEqual({ chars: 340, target: 'answer' });
    expect(toStoredEvent({ type: 'TAB_SWITCH', msAgo: 0, awayMs: 12000.6, source: 'blur' }, now, roundStart).meta).toEqual({ awayMs: 12001, source: 'blur' });
  });

  it('marks a refused full-screen request and stores nothing otherwise', () => {
    expect(toStoredEvent({ type: 'FULLSCREEN_EXIT', msAgo: 0, refused: true }, now, roundStart).meta).toEqual({ refused: true });
    expect(toStoredEvent({ type: 'FULLSCREEN_EXIT', msAgo: 0 }, now, roundStart).meta).toBeNull();
  });
});

describe('formatting', () => {
  it('formats the time into the round', () => {
    expect(formatOffset(0)).toBe('+0:00');
    expect(formatOffset(723)).toBe('+12:03');
    expect(formatOffset(3723)).toBe('+1:02:03');
    expect(formatOffset(-5)).toBe('+0:00');
  });

  it('formats durations in plain words', () => {
    expect(formatDuration(8_000)).toBe('8 s');
    expect(formatDuration(65_000)).toBe('1 min 5 s');
    expect(formatDuration(120_000)).toBe('2 min');
    expect(formatDuration(3_720_000)).toBe('1 h 2 min');
  });
});

describe('descriptions', () => {
  it('describes each event in a plain line', () => {
    expect(describeEvent('TAB_SWITCH', { awayMs: 12_000, source: 'hidden' }).text).toBe('Switched to another tab or window for 12 s');
    expect(describeEvent('TAB_SWITCH', { awayMs: 2_000, source: 'blur' }).text).toContain('lost focus for 2 s');
    expect(describeEvent('PASTE', { chars: 1, target: 'editor' }).text).toBe('Pasted 1 character into the code editor');
    expect(describeEvent('PASTE', { chars: 1200, target: 'answer' }).text).toBe('Pasted 1,200 characters into an answer box');
    expect(describeEvent('FULLSCREEN_EXIT', null).text).toBe('Left full-screen');
    expect(describeEvent('FULLSCREEN_EXIT', { refused: true }).text).toContain('refused full-screen');
  });

  it('does not crash on missing or odd meta, or on event types added later', () => {
    expect(() => describeEvent('TAB_SWITCH', null)).not.toThrow();
    expect(() => describeEvent('PASTE', ['x'])).not.toThrow();
    expect(describeEvent('NO_FACE', null).text).toBe('No face');
  });

  it('flags long absences and big pastes more strongly', () => {
    expect(describeEvent('TAB_SWITCH', { awayMs: 5_000, source: 'hidden' }).tone).toBe('warn');
    expect(describeEvent('TAB_SWITCH', { awayMs: 90_000, source: 'hidden' }).tone).toBe('bad');
    expect(describeEvent('PASTE', { chars: 50, target: 'answer' }).tone).toBe('warn');
    expect(describeEvent('PASTE', { chars: 400, target: 'answer' }).tone).toBe('bad');
  });
});

describe('round summary', () => {
  const at = (s: number) => new Date(roundStart.getTime() + s * 1000);
  const events: RawEvent[] = [
    { id: 'c', type: 'FULLSCREEN_EXIT', occurredAt: at(300), meta: null },
    { id: 'a', type: 'TAB_SWITCH', occurredAt: at(100), meta: { awayMs: 12_000, source: 'hidden' } },
    { id: 'b', type: 'PASTE', occurredAt: at(200), meta: { chars: 340, target: 'answer' } },
    { id: 'd', type: 'TAB_SWITCH', occurredAt: at(400), meta: { awayMs: 3_000, source: 'blur' } },
    { id: 'e', type: 'PASTE', occurredAt: at(500), meta: { chars: 60, target: 'editor' } },
    { id: 'f', type: 'FULLSCREEN_EXIT', occurredAt: at(5), meta: { refused: true } },
  ];

  it('counts events, time away and characters pasted', () => {
    const { counts } = summarizeEvents(events, roundStart);
    expect(counts).toEqual({ tabSwitches: 2, pastes: 2, blockedPastes: 0, fullscreenExits: 1, fullscreenRefused: true, limitReached: false, awayMs: 15_000, pastedChars: 400 });
  });

  it('orders the timeline and shows the time into the round', () => {
    const { events: rows } = summarizeEvents(events, roundStart);
    expect(rows.map((r) => r.id)).toEqual(['f', 'a', 'b', 'c', 'd', 'e']);
    expect(rows[1].offsetLabel).toBe('+1:40');
    expect(rows[1].atIso).toBe(at(100).toISOString());
  });

  it('shows a dash when the round start is unknown, and handles an empty round', () => {
    expect(summarizeEvents(events, null).events[0].offsetLabel).toBe('—');
    expect(summarizeEvents([], roundStart)).toEqual({
      counts: { tabSwitches: 0, pastes: 0, blockedPastes: 0, fullscreenExits: 0, fullscreenRefused: false, limitReached: false, awayMs: 0, pastedChars: 0 },
      events: [],
    });
  });
});

describe('tab-switch limit', () => {
  it('has no limit when max is 0', () => {
    expect(tabSwitchStatus(7, 0)).toEqual({ used: 7, max: 0, remaining: null, reached: false });
    expect(tabSwitchMessage(tabSwitchStatus(7, 0))).toBeNull();
  });

  it('counts down and reaches the limit on the last allowed switch', () => {
    expect(tabSwitchStatus(1, 3)).toEqual({ used: 1, max: 3, remaining: 2, reached: false });
    expect(tabSwitchStatus(2, 3)).toEqual({ used: 2, max: 3, remaining: 1, reached: false });
    expect(tabSwitchStatus(3, 3)).toEqual({ used: 3, max: 3, remaining: 0, reached: true });
    expect(tabSwitchStatus(5, 3).reached).toBe(true);
  });

  it('never shows negative or fractional counts', () => {
    expect(tabSwitchStatus(-2, 3).used).toBe(0);
    expect(tabSwitchStatus(1.9, 3).used).toBe(1);
  });

  it('finds the event that uses up the last switch', () => {
    expect(limitReachedAt(['TAB_SWITCH', 'PASTE', 'TAB_SWITCH'], 1, 3)).toBe(2);
    expect(limitReachedAt(['TAB_SWITCH'], 0, 3)).toBe(-1);
    expect(limitReachedAt(['PASTE', 'FULLSCREEN_EXIT'], 2, 3)).toBe(-1);
    expect(limitReachedAt(['TAB_SWITCH', 'TAB_SWITCH', 'TAB_SWITCH'], 0, 2)).toBe(1);
    expect(limitReachedAt(['TAB_SWITCH'], 9, 0)).toBe(-1);
  });

  it('warns before the limit and says the round ended at it', () => {
    expect(tabSwitchMessage(tabSwitchStatus(1, 3))).toContain('2 more');
    expect(tabSwitchMessage(tabSwitchStatus(2, 3))).toContain('One more');
    expect(tabSwitchMessage(tabSwitchStatus(3, 3))).toContain('submitted automatically');
    expect(tabSwitchMessage(tabSwitchStatus(0, 3))).toBeNull();
  });

  it('shows the ending switch to the admin and counts it', () => {
    const e = describeEvent('TAB_SWITCH', { awayMs: 8000, source: 'hidden', limitReached: true });
    expect(e.text).toContain('submitted automatically');
    expect(e.tone).toBe('bad');
    const { counts } = summarizeEvents(
      [{ id: 'a', type: 'TAB_SWITCH', occurredAt: new Date('2026-09-30T10:05:00Z'), meta: { awayMs: 8000, source: 'hidden', limitReached: true } }],
      roundStart,
    );
    expect(counts.limitReached).toBe(true);
  });
});

describe('blocked paste', () => {
  it('accepts a blocked paste or drop and keeps only labels and a length', () => {
    const parsed = proctorBatchSchema.safeParse({
      events: [{ type: 'PASTE', msAgo: 10, chars: 120, target: 'editor', blocked: true, via: 'drop', text: 'secret' }],
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const stored = toStoredEvent(parsed.data.events[0], now, roundStart);
    expect(stored.meta).toEqual({ chars: 120, target: 'editor', blocked: true, via: 'drop' });
  });

  it('rejects blocked: false and unknown ways of getting text in', () => {
    expect(proctorBatchSchema.safeParse({ events: [{ type: 'PASTE', msAgo: 0, chars: 1, target: 'answer', blocked: false }] }).success).toBe(false);
    expect(proctorBatchSchema.safeParse({ events: [{ type: 'PASTE', msAgo: 0, chars: 1, target: 'answer', blocked: true, via: 'magic' }] }).success).toBe(false);
  });

  it('a normal paste keeps its old shape', () => {
    const stored = toStoredEvent({ type: 'PASTE', msAgo: 0, chars: 40, target: 'answer' }, now, roundStart);
    expect(stored.meta).toEqual({ chars: 40, target: 'answer' });
  });

  it('describes a blocked attempt in plain words', () => {
    expect(describeEvent('PASTE', { chars: 340, target: 'answer', blocked: true, via: 'paste' }).text).toBe('Tried to paste 340 characters into an answer box. Blocked, nothing was added');
    expect(describeEvent('PASTE', { chars: 0, target: 'editor', blocked: true, via: 'drop' }).text).toBe('Tried to drop content into the code editor. Blocked, nothing was added');
    expect(describeEvent('PASTE', { chars: 340, target: 'answer', blocked: true }).tone).toBe('warn');
  });

  it('counts blocked attempts apart from real pastes and characters', () => {
    const at = new Date('2026-09-30T10:05:00Z');
    const { counts } = summarizeEvents(
      [
        { id: 'a', type: 'PASTE', occurredAt: at, meta: { chars: 500, target: 'answer', blocked: true, via: 'paste' } },
        { id: 'b', type: 'PASTE', occurredAt: at, meta: { chars: 30, target: 'answer' } },
      ],
      roundStart,
    );
    expect(counts.pastes).toBe(1);
    expect(counts.blockedPastes).toBe(1);
    expect(counts.pastedChars).toBe(30);
  });
});
