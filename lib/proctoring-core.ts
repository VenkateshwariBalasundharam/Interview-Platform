// Pure proctoring rules: what a request may contain, how times are worked out, and how events are described.
// No database and no browser APIs here, so everything in this file is unit tested.
import { z } from 'zod';

/** The only event types a browser may send. Face events (NO_FACE and so on) are refused. */
export const CLIENT_EVENT_TYPES = ['TAB_SWITCH', 'PASTE', 'FULLSCREEN_EXIT'] as const;
export type ClientEventType = (typeof CLIENT_EVENT_TYPES)[number];

export const MAX_EVENTS_PER_REQUEST = 20;
/** Safety cap per attempt. Events beyond it are dropped, never an error. */
export const MAX_EVENTS_PER_ATTEMPT = 500;
/** A window that loses focus counts as a tab switch only after this long. A hidden tab always counts. */
export const BLUR_MIN_AWAY_MS = 1500;

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
const MAX_PASTE_CHARS = 10_000_000;

const msAgo = z.number().finite().min(0).max(SIX_HOURS_MS);

// z.object() drops unknown keys, so nothing the browser adds ever reaches the database.
const tabSwitch = z.object({
  type: z.literal('TAB_SWITCH'),
  msAgo,
  awayMs: z.number().finite().min(0).max(SIX_HOURS_MS),
  source: z.enum(['hidden', 'blur']),
});
const paste = z.object({
  type: z.literal('PASTE'),
  msAgo,
  chars: z.number().finite().min(0).max(MAX_PASTE_CHARS),
  target: z.enum(['answer', 'editor', 'other']),
  /** The browser stopped this paste or drop. Nothing reached the answer. */
  blocked: z.literal(true).optional(),
  /** How it arrived. Only sent for blocked attempts. */
  via: z.enum(['paste', 'drop']).optional(),
});
const fullscreenExit = z.object({
  type: z.literal('FULLSCREEN_EXIT'),
  msAgo,
  refused: z.literal(true).optional(),
});

export const proctorBatchSchema = z.object({
  events: z.array(z.discriminatedUnion('type', [tabSwitch, paste, fullscreenExit])).min(1).max(MAX_EVENTS_PER_REQUEST),
});
export type ProctorBatch = z.infer<typeof proctorBatchSchema>;
export type ClientEvent = ProctorBatch['events'][number];

// ───────────────────────── Tab-switch limit ─────────────────────────

export interface TabSwitchStatus {
  used: number;
  /** 0 means the round has no limit. */
  max: number;
  /** Switches left before the round ends. null when there is no limit. */
  remaining: number | null;
  /** The limit is on and has been used up: the round must end. */
  reached: boolean;
}

/** `max` is the round's setting (0 = no limit). The round ends on the switch that uses the last one up. */
export function tabSwitchStatus(used: number, max: number): TabSwitchStatus {
  const safeUsed = Math.max(0, Math.floor(used));
  if (!Number.isFinite(max) || max <= 0) return { used: safeUsed, max: 0, remaining: null, reached: false };
  return { used: safeUsed, max, remaining: Math.max(0, max - safeUsed), reached: safeUsed >= max };
}

/**
 * Index (within `types`) of the event that uses up the last allowed tab switch, or -1.
 * `alreadyUsed` is how many were stored before this batch. Used to mark that event for the admin.
 */
export function limitReachedAt(types: readonly string[], alreadyUsed: number, max: number): number {
  if (max <= 0) return -1;
  let used = alreadyUsed;
  for (let i = 0; i < types.length; i++) {
    if (types[i] !== 'TAB_SWITCH') continue;
    used += 1;
    if (used >= max) return i;
  }
  return -1;
}

/** What the candidate's screen shows after each batch. Plain words, no scores. */
export function tabSwitchMessage(status: TabSwitchStatus): string | null {
  if (status.max <= 0 || status.used === 0) return null;
  if (status.reached) return `That was switch ${status.used} of ${status.max}. Your round has been submitted automatically.`;
  const left = status.remaining ?? 0;
  return `Warning: you left the exam tab (switch ${status.used} of ${status.max}). ${
    left === 1 ? 'One more and your round will be submitted automatically.' : `${left} more and your round will be submitted automatically.`
  }`;
}

// ───────────────────────── Turning a request into rows ─────────────────────────

/**
 * The server clock decides when something happened: now minus how long ago the browser says it was.
 * It is never earlier than the round start and never in the future, so a wrong clock on the
 * candidate's computer (or a made-up msAgo) cannot place an event outside the round.
 */
export function occurredAtFor(now: Date, msAgoValue: number, roundStart: Date): Date {
  const t = Math.min(now.getTime() - Math.round(msAgoValue), now.getTime());
  return new Date(Math.max(roundStart.getTime(), t));
}

export interface StoredEvent {
  type: ClientEventType;
  occurredAt: Date;
  /** Never contains pasted text. Only lengths, durations and short labels. */
  meta: Record<string, string | number | boolean> | null;
}

export function toStoredEvent(event: ClientEvent, now: Date, roundStart: Date): StoredEvent {
  const occurredAt = occurredAtFor(now, event.msAgo, roundStart);
  switch (event.type) {
    case 'TAB_SWITCH':
      return { type: event.type, occurredAt, meta: { awayMs: Math.round(event.awayMs), source: event.source } };
    case 'PASTE':
      return {
        type: event.type,
        occurredAt,
        meta: {
          chars: Math.round(event.chars),
          target: event.target,
          ...(event.blocked ? { blocked: true, via: event.via ?? 'paste' } : {}),
        },
      };
    case 'FULLSCREEN_EXIT':
      return { type: event.type, occurredAt, meta: event.refused ? { refused: true } : null };
  }
}

// ───────────────────────── Reading events back (admin) ─────────────────────────

export interface RawEvent {
  id: string;
  type: string;
  occurredAt: Date;
  meta: unknown;
}

export type EventTone = 'neutral' | 'warn' | 'bad';

export interface ReportEvent {
  id: string;
  type: string;
  /** Seconds since the round started, never negative. null if the start time is unknown. */
  offsetSec: number | null;
  offsetLabel: string;
  atIso: string;
  text: string;
  tone: EventTone;
}

export interface EventCounts {
  tabSwitches: number;
  /** Pastes that went through. Blocked attempts are counted in blockedPastes. */
  pastes: number;
  blockedPastes: number;
  /** Real exits only. A refused full-screen request is counted separately. */
  fullscreenExits: number;
  fullscreenRefused: boolean;
  /** A tab-switch limit ended this round. */
  limitReached: boolean;
  awayMs: number;
  pastedChars: number;
}

function readNumber(meta: unknown, key: string): number {
  if (meta && typeof meta === 'object' && !Array.isArray(meta)) {
    const v = (meta as Record<string, unknown>)[key];
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return v;
  }
  return 0;
}

function readString(meta: unknown, key: string): string | null {
  if (meta && typeof meta === 'object' && !Array.isArray(meta)) {
    const v = (meta as Record<string, unknown>)[key];
    if (typeof v === 'string') return v;
  }
  return null;
}

function readFlag(meta: unknown, key: string): boolean {
  return !!meta && typeof meta === 'object' && !Array.isArray(meta) && (meta as Record<string, unknown>)[key] === true;
}

/** "+12:03", or "+1:02:03" once a round passes an hour. */
export function formatOffset(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `+${h}:${pad(m)}:${pad(sec)}` : `+${m}:${pad(sec)}`;
}

/** "8 s", "1 min 5 s", "1 h 2 min". */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  if (total < 60) return `${total} s`;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return m > 0 ? `${h} h ${m} min` : `${h} h`;
  return s > 0 ? `${m} min ${s} s` : `${m} min`;
}

const PASTE_TARGET_TEXT: Record<string, string> = {
  answer: 'into an answer box',
  editor: 'into the code editor',
  other: 'somewhere else on the page',
};

export function describeEvent(type: string, meta: unknown): { text: string; tone: EventTone } {
  switch (type) {
    case 'TAB_SWITCH': {
      const away = formatDuration(readNumber(meta, 'awayMs'));
      const long = readNumber(meta, 'awayMs') >= 60_000;
      const base =
        readString(meta, 'source') === 'blur'
          ? `Window lost focus for ${away} (another window or app was in front)`
          : `Switched to another tab or window for ${away}`;
      const ended = readFlag(meta, 'limitReached');
      return { text: ended ? `${base}. Tab-switch limit reached: the round was submitted automatically` : base, tone: long || ended ? 'bad' : 'warn' };
    }
    case 'PASTE': {
      const chars = readNumber(meta, 'chars');
      const where = PASTE_TARGET_TEXT[readString(meta, 'target') ?? ''] ?? PASTE_TARGET_TEXT.other;
      if (readFlag(meta, 'blocked')) {
        const how = readString(meta, 'via') === 'drop' ? 'Tried to drop' : 'Tried to paste';
        const size = chars > 0 ? `${chars.toLocaleString('en-US')} character${chars === 1 ? '' : 's'}` : 'content';
        return { text: `${how} ${size} ${where}. Blocked, nothing was added`, tone: 'warn' };
      }
      return { text: `Pasted ${chars.toLocaleString('en-US')} character${chars === 1 ? '' : 's'} ${where}`, tone: chars >= 300 ? 'bad' : 'warn' };
    }
    case 'FULLSCREEN_EXIT':
      return readFlag(meta, 'refused')
        ? { text: 'The browser refused full-screen; the candidate continued without it', tone: 'warn' }
        : { text: 'Left full-screen', tone: 'warn' };
    default:
      // Face-check events arrive in a later step. Show them in plain words rather than hiding them.
      return { text: type.replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase()), tone: 'warn' };
  }
}

export function summarizeEvents(events: RawEvent[], roundStart: Date | null): { counts: EventCounts; events: ReportEvent[] } {
  const counts: EventCounts = { tabSwitches: 0, pastes: 0, blockedPastes: 0, fullscreenExits: 0, fullscreenRefused: false, limitReached: false, awayMs: 0, pastedChars: 0 };
  const sorted = [...events].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime() || a.id.localeCompare(b.id));

  const rows = sorted.map((e): ReportEvent => {
    if (e.type === 'TAB_SWITCH') {
      counts.tabSwitches += 1;
      if (readFlag(e.meta, 'limitReached')) counts.limitReached = true;
      counts.awayMs += readNumber(e.meta, 'awayMs');
    } else if (e.type === 'PASTE') {
      if (readFlag(e.meta, 'blocked')) counts.blockedPastes += 1;
      else {
        counts.pastes += 1;
        counts.pastedChars += readNumber(e.meta, 'chars');
      }
    } else if (e.type === 'FULLSCREEN_EXIT') {
      if (readFlag(e.meta, 'refused')) counts.fullscreenRefused = true;
      else counts.fullscreenExits += 1;
    }
    const offsetSec = roundStart ? Math.max(0, Math.floor((e.occurredAt.getTime() - roundStart.getTime()) / 1000)) : null;
    const { text, tone } = describeEvent(e.type, e.meta);
    return {
      id: e.id,
      type: e.type,
      offsetSec,
      offsetLabel: offsetSec === null ? '—' : formatOffset(offsetSec),
      atIso: e.occurredAt.toISOString(),
      text,
      tone,
    };
  });

  return { counts, events: rows };
}
