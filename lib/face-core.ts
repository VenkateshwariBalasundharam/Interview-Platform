// Pure face-check rules: what a request may contain, how observations become events, and how the face reference is
// protected. No database and no browser APIs here, so everything in this file is unit tested.
//
// The browser only reports what it saw (how many faces, a face descriptor, whether the head was turned away). The
// server decides which events that is worth and does the identity comparison itself, so a tampered browser cannot
// claim "same person".
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { z } from 'zod';

export const FACE_EVENT_TYPES = ['NO_FACE', 'MULTIPLE_FACES', 'LOOKING_AWAY', 'IDENTITY_MISMATCH'] as const;
export type FaceEventType = (typeof FACE_EVENT_TYPES)[number];

/** Length of a face-api.js descriptor. */
export const EMBEDDING_DIM = 128;
/** face-api.js treats a distance above 0.6 as a different person. */
export const DEFAULT_MATCH_THRESHOLD = 0.6;
/** The same kind of event is stored at most once per this long, so a long absence is one entry, not hundreds. */
export const FACE_EVENT_COOLDOWN_MS = 15_000;
export const MAX_FACE_EVENTS_PER_ATTEMPT = 200;
export const MAX_SNAPSHOT_BYTES = 150 * 1024;
/** A snapshot must arrive soon after the event it belongs to. */
export const SNAPSHOT_WINDOW_MS = 2 * 60 * 1000;
export const FACE_CONSENT_VERSION = 'face-v1';
export const DEFAULT_RETENTION_DAYS = 30;

/** Events worth keeping a photo for. An empty chair or a turned head is not worth a picture. */
export const SNAPSHOT_EVENT_TYPES: readonly FaceEventType[] = ['MULTIPLE_FACES', 'IDENTITY_MISMATCH'];

const embedding = z.array(z.number().finite().min(-5).max(5)).length(EMBEDDING_DIM);

export const enrollSchema = z.object({ embedding });

export const faceCheckSchema = z.object({
  /** How long ago the browser took this reading. */
  msAgo: z.number().finite().min(0).max(60_000).default(0),
  faces: z.number().int().min(0).max(10),
  /** The browser judged the head turned away from the screen. Only meaningful when exactly one face is seen. */
  lookingAway: z.boolean().optional(),
  /** Descriptor of the face seen. Only used when exactly one face is seen. */
  embedding: embedding.optional(),
});
export type FaceCheck = z.infer<typeof faceCheckSchema>;

export function euclideanDistance(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length || a.length === 0) return Number.POSITIVE_INFINITY;
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += (a[i] - b[i]) ** 2;
  return Math.sqrt(sum);
}

export function matchThreshold(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0.3 && n <= 0.9 ? n : DEFAULT_MATCH_THRESHOLD;
}

export interface FaceObservationResult {
  type: FaceEventType;
  meta: Record<string, string | number | boolean> | null;
}

/**
 * Which events one reading produces.
 *  - 0 faces: NO_FACE. 2 or more: MULTIPLE_FACES (with the count).
 *  - Exactly 1 face: LOOKING_AWAY if the browser said so; at IDENTITY level with a reference on file, IDENTITY_MISMATCH
 *    when the descriptor is farther from the reference than the threshold.
 *  - `referenceDistance` is null when no comparison was possible (no reference, no descriptor, or PRESENCE level).
 */
export function eventsFromReading(
  check: Pick<FaceCheck, 'faces' | 'lookingAway'>,
  referenceDistance: number | null,
  threshold: number,
): FaceObservationResult[] {
  if (check.faces === 0) return [{ type: 'NO_FACE', meta: null }];
  if (check.faces > 1) return [{ type: 'MULTIPLE_FACES', meta: { faces: check.faces } }];
  const out: FaceObservationResult[] = [];
  if (check.lookingAway) out.push({ type: 'LOOKING_AWAY', meta: null });
  if (referenceDistance !== null && referenceDistance > threshold) {
    // Rounded so the stored value is a hint for the admin, not a precise biometric measurement.
    out.push({ type: 'IDENTITY_MISMATCH', meta: { distance: Math.round(referenceDistance * 100) / 100, threshold } });
  }
  return out;
}

/** True when an event of this type was stored too recently to store another. */
export function withinCooldown(lastAt: Date | null, now: Date, cooldownMs = FACE_EVENT_COOLDOWN_MS): boolean {
  return lastAt !== null && now.getTime() - lastAt.getTime() < cooldownMs;
}

export function retentionDays(raw: string | undefined): number {
  const n = Math.floor(Number(raw));
  return Number.isFinite(n) && n >= 1 && n <= 365 ? n : DEFAULT_RETENTION_DAYS;
}

export function expiryFor(now: Date, days: number): Date {
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
}

/** A real JPEG starts FF D8 FF. Anything else (or anything too big) is not stored. */
export function isJpeg(data: Uint8Array): boolean {
  return data.length > 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
}

// ───────────────────────── Face reference encryption ─────────────────────────

export function parseFaceKey(base64: string | undefined): Buffer | null {
  if (!base64) return null;
  const key = Buffer.from(base64, 'base64');
  return key.length === 32 ? key : null;
}

export interface EncryptedEmbedding {
  embeddingEnc: Buffer;
  iv: Buffer;
  authTag: Buffer;
}

export function encryptEmbedding(vector: readonly number[], key: Buffer): EncryptedEmbedding {
  if (vector.length !== EMBEDDING_DIM) throw new Error('Unexpected embedding length');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const plain = Buffer.from(new Float32Array(vector).buffer);
  const embeddingEnc = Buffer.concat([cipher.update(plain), cipher.final()]);
  return { embeddingEnc, iv, authTag: cipher.getAuthTag() };
}

/** Throws if the key is wrong or the stored bytes were changed. */
export function decryptEmbedding(stored: EncryptedEmbedding, key: Buffer): number[] {
  const decipher = createDecipheriv('aes-256-gcm', key, stored.iv);
  decipher.setAuthTag(stored.authTag);
  const plain = Buffer.concat([decipher.update(stored.embeddingEnc), decipher.final()]);
  const floats = new Float32Array(plain.buffer, plain.byteOffset, plain.byteLength / 4);
  return Array.from(floats);
}
