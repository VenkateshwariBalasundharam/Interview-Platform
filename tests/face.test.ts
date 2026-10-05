import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  EMBEDDING_DIM,
  FACE_EVENT_COOLDOWN_MS,
  SNAPSHOT_EVENT_TYPES,
  decryptEmbedding,
  encryptEmbedding,
  enrollSchema,
  euclideanDistance,
  eventsFromReading,
  expiryFor,
  faceCheckSchema,
  isJpeg,
  matchThreshold,
  parseFaceKey,
  retentionDays,
  withinCooldown,
} from '@/lib/face-core';
import { describeEvent, proctorBatchSchema, summarizeEvents } from '@/lib/proctoring-core';

const vec = (n = 0.1) => Array.from({ length: EMBEDDING_DIM }, (_, i) => n + i / 1000);

describe('face check validation', () => {
  it('accepts a reading with a face count only', () => {
    expect(faceCheckSchema.safeParse({ faces: 0 }).success).toBe(true);
  });
  it('rejects bad counts and wrong descriptor sizes', () => {
    expect(faceCheckSchema.safeParse({ faces: -1 }).success).toBe(false);
    expect(faceCheckSchema.safeParse({ faces: 11 }).success).toBe(false);
    expect(faceCheckSchema.safeParse({ faces: 1, embedding: [1, 2, 3] }).success).toBe(false);
    expect(enrollSchema.safeParse({ embedding: vec().map(() => Number.NaN) }).success).toBe(false);
  });
  it('the browser cannot send face events directly', () => {
    expect(proctorBatchSchema.safeParse({ events: [{ type: 'IDENTITY_MISMATCH', msAgo: 0 }] }).success).toBe(false);
  });
});

describe('events from a reading', () => {
  it('no face and many faces', () => {
    expect(eventsFromReading({ faces: 0 }, null, 0.6)).toEqual([{ type: 'NO_FACE', meta: null }]);
    expect(eventsFromReading({ faces: 3 }, null, 0.6)).toEqual([{ type: 'MULTIPLE_FACES', meta: { faces: 3 } }]);
  });
  it('one face, same person: nothing', () => {
    expect(eventsFromReading({ faces: 1 }, 0.3, 0.6)).toEqual([]);
  });
  it('one face looking away', () => {
    expect(eventsFromReading({ faces: 1, lookingAway: true }, null, 0.6).map((e) => e.type)).toEqual(['LOOKING_AWAY']);
  });
  it('one face farther than the threshold is a mismatch; exactly at it is not', () => {
    expect(eventsFromReading({ faces: 1 }, 0.61, 0.6).map((e) => e.type)).toEqual(['IDENTITY_MISMATCH']);
    expect(eventsFromReading({ faces: 1 }, 0.6, 0.6)).toEqual([]);
  });
  it('lookingAway is ignored when several faces are seen, and no comparison means no mismatch', () => {
    expect(eventsFromReading({ faces: 2, lookingAway: true }, 0.9, 0.6).map((e) => e.type)).toEqual(['MULTIPLE_FACES']);
    expect(eventsFromReading({ faces: 1 }, null, 0.6)).toEqual([]);
  });
  it('only evidence-worthy events get a photo', () => {
    expect([...SNAPSHOT_EVENT_TYPES].sort()).toEqual(['IDENTITY_MISMATCH', 'MULTIPLE_FACES']);
  });
});

describe('distance, thresholds, cooldown, retention', () => {
  it('distance', () => {
    expect(euclideanDistance(vec(), vec())).toBe(0);
    expect(euclideanDistance([0, 0], [3, 4])).toBe(5);
    expect(euclideanDistance([1], [1, 2])).toBe(Number.POSITIVE_INFINITY);
  });
  it('threshold falls back to the default when out of range', () => {
    expect(matchThreshold(undefined)).toBe(0.6);
    expect(matchThreshold('0.5')).toBe(0.5);
    expect(matchThreshold('5')).toBe(0.6);
    expect(matchThreshold('abc')).toBe(0.6);
  });
  it('cooldown', () => {
    const now = new Date('2026-10-03T10:00:00Z');
    expect(withinCooldown(null, now)).toBe(false);
    expect(withinCooldown(new Date(now.getTime() - FACE_EVENT_COOLDOWN_MS + 1), now)).toBe(true);
    expect(withinCooldown(new Date(now.getTime() - FACE_EVENT_COOLDOWN_MS), now)).toBe(false);
  });
  it('retention days and expiry', () => {
    expect(retentionDays(undefined)).toBe(30);
    expect(retentionDays('7')).toBe(7);
    expect(retentionDays('0')).toBe(30);
    expect(retentionDays('999')).toBe(30);
    expect(expiryFor(new Date('2026-10-03T00:00:00Z'), 2).toISOString()).toBe('2026-10-05T00:00:00.000Z');
  });
  it('JPEG check', () => {
    expect(isJpeg(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0]))).toBe(true);
    expect(isJpeg(Buffer.from('<svg></svg>'))).toBe(false);
    expect(isJpeg(Buffer.alloc(0))).toBe(false);
  });
});

describe('face reference encryption', () => {
  const key = randomBytes(32);
  it('round-trips (to float32 precision)', () => {
    const v = vec(0.25);
    const out = decryptEmbedding(encryptEmbedding(v, key), key);
    expect(out).toHaveLength(EMBEDDING_DIM);
    expect(euclideanDistance(v, out)).toBeLessThan(1e-5);
  });
  it('a different key or changed bytes fail to decrypt', () => {
    const enc = encryptEmbedding(vec(), key);
    expect(() => decryptEmbedding(enc, randomBytes(32))).toThrow();
    const tampered = { ...enc, embeddingEnc: Buffer.from(enc.embeddingEnc) };
    tampered.embeddingEnc[0] ^= 1;
    expect(() => decryptEmbedding(tampered, key)).toThrow();
  });
  it('ciphertext does not contain the plain vector and differs each time', () => {
    const a = encryptEmbedding(vec(), key);
    const b = encryptEmbedding(vec(), key);
    expect(a.embeddingEnc.equals(b.embeddingEnc)).toBe(false);
    expect(a.embeddingEnc.equals(Buffer.from(new Float32Array(vec()).buffer))).toBe(false);
  });
  it('key parsing needs exactly 32 bytes', () => {
    expect(parseFaceKey(randomBytes(32).toString('base64'))).not.toBeNull();
    expect(parseFaceKey(randomBytes(16).toString('base64'))).toBeNull();
    expect(parseFaceKey(undefined)).toBeNull();
  });
});

describe('face events in the admin report', () => {
  const start = new Date('2026-10-03T10:00:00Z');
  const at = (s: number) => new Date(start.getTime() + s * 1000);
  it('counts them, words them, and flags photos', () => {
    const r = summarizeEvents(
      [
        { id: 'a', type: 'NO_FACE', occurredAt: at(10), meta: null },
        { id: 'b', type: 'MULTIPLE_FACES', occurredAt: at(20), meta: { faces: 2 }, hasSnapshot: true },
        { id: 'c', type: 'LOOKING_AWAY', occurredAt: at(30), meta: null },
        { id: 'd', type: 'IDENTITY_MISMATCH', occurredAt: at(40), meta: { distance: 0.8, threshold: 0.6 }, hasSnapshot: true },
      ],
      start,
    );
    expect(r.counts).toMatchObject({ noFace: 1, multipleFaces: 1, lookingAway: 1, identityMismatches: 1 });
    expect(r.events.map((e) => e.hasSnapshot)).toEqual([false, true, false, true]);
    expect(describeEvent('MULTIPLE_FACES', { faces: 2 }).text).toBe('2 faces were visible on the camera');
    expect(describeEvent('IDENTITY_MISMATCH', null).tone).toBe('bad');
  });
});
