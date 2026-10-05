// Face-check database operations (server only). Pure rules live in lib/face-core.ts.
// Photos are only taken for the two event types that need evidence, are stored privately, and expire.
// The face reference is stored encrypted and only ever compared on the server.
import type { CandidateSession } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { prisma } from '@/lib/db';
import { getEnv } from '@/lib/env';
import { err } from '@/lib/http';
import type { RoundType } from '@/lib/pipeline';
import { occurredAtFor } from '@/lib/proctoring-core';
import { consumeRateLimit } from '@/lib/ratelimit';
import { SUBMIT_GRACE_SECONDS, isPastGrace } from '@/lib/round-engine';
import { deletePrivate, getPrivate, putPrivate } from '@/lib/storage';
import {
  FACE_CONSENT_VERSION,
  MAX_FACE_EVENTS_PER_ATTEMPT,
  MAX_SNAPSHOT_BYTES,
  SNAPSHOT_EVENT_TYPES,
  SNAPSHOT_WINDOW_MS,
  decryptEmbedding,
  encryptEmbedding,
  euclideanDistance,
  eventsFromReading,
  expiryFor,
  isJpeg,
  matchThreshold,
  parseFaceKey,
  retentionDays,
  withinCooldown,
  type FaceCheck,
  type FaceEventType,
} from '@/lib/face-core';
import { Prisma } from '@prisma/client';

type Candidate = Pick<CandidateSession, 'id' | 'jobId'>;

function faceKey(): Buffer {
  const key = parseFaceKey(getEnv().FACE_ENCRYPTION_KEY);
  if (!key) throw err.conflict('Face checks are not set up on this server (FACE_ENCRYPTION_KEY is missing or not 32 bytes).', 'FACE_NOT_CONFIGURED');
  return key;
}

export async function hasFaceConsent(candidateId: string): Promise<boolean> {
  return (await prisma.consentRecord.count({ where: { candidateId, version: FACE_CONSENT_VERSION } })) > 0;
}

/** The candidate agreed to camera checks. Recorded once per consent version. */
export async function recordFaceConsent(candidate: Candidate): Promise<{ consented: true }> {
  if (!(await hasFaceConsent(candidate.id))) {
    await prisma.consentRecord.create({ data: { candidateId: candidate.id, version: FACE_CONSENT_VERSION } });
    await audit({ actorType: 'CANDIDATE', actorId: candidate.id, action: 'FACE_CONSENT_GIVEN', entity: 'Candidate', entityId: candidate.id, meta: { version: FACE_CONSENT_VERSION } });
  }
  return { consented: true };
}

/** Stores (or replaces) the encrypted face reference. Needs consent first. The raw descriptor is never logged. */
export async function enrollFaceReference(candidate: Candidate, embedding: number[], now = new Date()): Promise<{ enrolled: true }> {
  const limit = await consumeRateLimit(`face-enroll:${candidate.id}`, 10, 60 * 60_000);
  if (!limit.allowed) throw err.tooMany(limit.retryAfterSec);
  if (!(await hasFaceConsent(candidate.id))) throw err.forbidden('Agree to the camera checks before registering your face.', 'FACE_CONSENT_REQUIRED');
  const encrypted = encryptEmbedding(embedding, faceKey());
  // Prisma's Bytes type wants Uint8Array<ArrayBuffer>; a Buffer is typed as ArrayBufferLike, so copy into plain Uint8Arrays.
  const enc = { embeddingEnc: new Uint8Array(encrypted.embeddingEnc), iv: new Uint8Array(encrypted.iv), authTag: new Uint8Array(encrypted.authTag) };
  const expiresAt = expiryFor(now, retentionDays(getEnv().RETENTION_DAYS));
  await prisma.faceReference.upsert({
    where: { candidateId: candidate.id },
    create: { candidateId: candidate.id, ...enc, expiresAt },
    update: { ...enc, createdAt: now, expiresAt },
  });
  await audit({ actorType: 'CANDIDATE', actorId: candidate.id, action: 'FACE_REFERENCE_SAVED', entity: 'Candidate', entityId: candidate.id });
  return { enrolled: true };
}

export async function hasFaceReference(candidateId: string): Promise<boolean> {
  return (await prisma.faceReference.count({ where: { candidateId, expiresAt: { gt: new Date() } } })) > 0;
}

export interface FaceCheckResult {
  recorded: { id: string; type: FaceEventType }[];
  /** Event ids the browser may attach a photo to (see saveSnapshot). */
  snapshotEventIds: string[];
  /** The round needs IDENTITY checks but no face reference is on file, so no comparison was made. */
  needsEnrollment: boolean;
}

/**
 * One camera reading from a running round. The server derives the events.
 * Never changes a score or a decision, and never ends a round: face events are signals for the admin.
 * A round whose face monitoring is Off stores nothing.
 */
export async function recordFaceCheck(candidate: Candidate, roundType: RoundType, check: FaceCheck, now = new Date()): Promise<FaceCheckResult> {
  const limit = await consumeRateLimit(`face-check:${candidate.id}`, 30, 60_000);
  if (!limit.allowed) throw err.tooMany(limit.retryAfterSec);

  const attempt = await prisma.attempt.findUnique({
    where: { candidateId_roundType: { candidateId: candidate.id, roundType } },
    select: { id: true, status: true, startedAt: true, deadlineAt: true },
  });
  if (!attempt) throw err.notFound('You have not started this round.', 'ATTEMPT_NOT_FOUND');
  if (attempt.status !== 'IN_PROGRESS' || isPastGrace(attempt.deadlineAt, now, SUBMIT_GRACE_SECONDS)) {
    throw err.conflict('This round has already ended.', 'ATTEMPT_ENDED');
  }

  const config = await prisma.roundConfig.findUnique({
    where: { jobId_roundType: { jobId: candidate.jobId, roundType } },
    select: { proctoringLevel: true },
  });
  const empty: FaceCheckResult = { recorded: [], snapshotEventIds: [], needsEnrollment: false };
  if (!config || config.proctoringLevel === 'OFF') return empty;
  if (!(await hasFaceConsent(candidate.id))) throw err.forbidden('Camera checks need your agreement first.', 'FACE_CONSENT_REQUIRED');

  // Identity: compare on the server. Only with exactly one face and only at IDENTITY level.
  let distance: number | null = null;
  let needsEnrollment = false;
  if (config.proctoringLevel === 'IDENTITY' && check.faces === 1 && check.embedding) {
    const ref = await prisma.faceReference.findUnique({ where: { candidateId: candidate.id } });
    if (!ref || ref.expiresAt <= now) needsEnrollment = true;
    else {
      try {
        distance = euclideanDistance(decryptEmbedding({ embeddingEnc: Buffer.from(ref.embeddingEnc), iv: Buffer.from(ref.iv), authTag: Buffer.from(ref.authTag) }, faceKey()), check.embedding);
      } catch {
        // A reference that cannot be decrypted (key changed) is treated as missing; the candidate registers again.
        needsEnrollment = true;
      }
    }
  }

  const derived = eventsFromReading(check, distance, matchThreshold(getEnv().FACE_MATCH_THRESHOLD));
  const stored = await prisma.proctorEvent.count({ where: { attemptId: attempt.id, type: { in: ['NO_FACE', 'MULTIPLE_FACES', 'LOOKING_AWAY', 'IDENTITY_MISMATCH'] } } });
  let room = Math.max(0, MAX_FACE_EVENTS_PER_ATTEMPT - stored);

  const occurredAt = occurredAtFor(now, check.msAgo, attempt.startedAt);
  const recorded: FaceCheckResult['recorded'] = [];
  for (const event of derived) {
    if (room <= 0) break;
    const last = await prisma.proctorEvent.findFirst({ where: { attemptId: attempt.id, type: event.type }, orderBy: { occurredAt: 'desc' }, select: { occurredAt: true } });
    if (withinCooldown(last?.occurredAt ?? null, now)) continue;
    const row = await prisma.proctorEvent.create({
      data: { candidateId: candidate.id, attemptId: attempt.id, roundType, type: event.type, occurredAt, meta: event.meta === null ? Prisma.DbNull : event.meta },
      select: { id: true, type: true },
    });
    room -= 1;
    recorded.push({ id: row.id, type: row.type as FaceEventType });
  }
  return { recorded, snapshotEventIds: recorded.filter((r) => SNAPSHOT_EVENT_TYPES.includes(r.type)).map((r) => r.id), needsEnrollment };
}

/** Attaches one JPEG to a face event the candidate just caused. Anything else is refused, and nothing is stored. */
export async function saveSnapshot(candidate: Candidate, roundType: RoundType, eventId: string, data: Buffer, now = new Date()): Promise<{ saved: true }> {
  const limit = await consumeRateLimit(`face-snapshot:${candidate.id}`, 20, 60_000);
  if (!limit.allowed) throw err.tooMany(limit.retryAfterSec);
  if (data.length > MAX_SNAPSHOT_BYTES) throw err.tooLarge('The photo is too large.', 'SNAPSHOT_TOO_LARGE');
  if (!isJpeg(data)) throw err.badRequest('The photo must be a JPEG image.', 'SNAPSHOT_NOT_JPEG');

  const event = await prisma.proctorEvent.findUnique({
    where: { id: eventId },
    select: { id: true, candidateId: true, roundType: true, type: true, attemptId: true, occurredAt: true, snapshot: { select: { id: true } } },
  });
  // The same answer for "not yours" and "does not exist", so ids cannot be probed.
  if (!event || event.candidateId !== candidate.id || event.roundType !== roundType) throw err.notFound('Event not found.', 'EVENT_NOT_FOUND');
  if (!SNAPSHOT_EVENT_TYPES.includes(event.type as FaceEventType)) throw err.badRequest('No photo is kept for this kind of event.', 'SNAPSHOT_NOT_ALLOWED');
  if (event.snapshot) throw err.conflict('A photo is already stored for this event.', 'SNAPSHOT_EXISTS');

  const attempt = event.attemptId ? await prisma.attempt.findUnique({ where: { id: event.attemptId }, select: { status: true, deadlineAt: true } }) : null;
  if (!attempt || attempt.status !== 'IN_PROGRESS' || isPastGrace(attempt.deadlineAt, now, SUBMIT_GRACE_SECONDS)) throw err.conflict('This round has already ended.', 'ATTEMPT_ENDED');
  if (now.getTime() - event.occurredAt.getTime() > SNAPSHOT_WINDOW_MS) throw err.conflict('That event is too old for a photo.', 'SNAPSHOT_TOO_LATE');

  const storageKey = await putPrivate('proctor', data, 'jpg');
  try {
    await prisma.proctorSnapshot.create({ data: { eventId, candidateId: candidate.id, storageKey, expiresAt: expiryFor(now, retentionDays(getEnv().RETENTION_DAYS)) } });
  } catch (e) {
    await deletePrivate(storageKey).catch(() => undefined);
    throw e;
  }
  return { saved: true };
}

/** Admin only. Every view is written to the audit log. Expired photos are not served. */
export async function readSnapshot(eventId: string, adminId: string, now = new Date()): Promise<Buffer> {
  const snap = await prisma.proctorSnapshot.findUnique({ where: { eventId }, select: { storageKey: true, expiresAt: true, candidateId: true } });
  if (!snap || snap.expiresAt <= now) throw err.notFound('No photo is available for this event.', 'SNAPSHOT_NOT_FOUND');
  let data: Buffer;
  try {
    data = await getPrivate(snap.storageKey);
  } catch {
    throw err.notFound('No photo is available for this event.', 'SNAPSHOT_NOT_FOUND');
  }
  await audit({ actorType: 'ADMIN', actorId: adminId, action: 'SNAPSHOT_VIEWED', entity: 'Candidate', entityId: snap.candidateId, meta: { eventId } });
  return data;
}

/** Removes snapshots and face references past their expiry. Safe to run repeatedly. */
export async function purgeExpired(now = new Date()): Promise<{ snapshots: number; faceReferences: number }> {
  const old = await prisma.proctorSnapshot.findMany({ where: { expiresAt: { lte: now } }, select: { id: true, storageKey: true } });
  for (const s of old) {
    await deletePrivate(s.storageKey).catch(() => undefined);
    await prisma.proctorSnapshot.deleteMany({ where: { id: s.id } });
  }
  const refs = await prisma.faceReference.deleteMany({ where: { expiresAt: { lte: now } } });
  if (old.length > 0 || refs.count > 0) await audit({ actorType: 'SYSTEM', action: 'RETENTION_PURGE', entity: 'Proctoring', entityId: 'purge', meta: { snapshots: old.length, faceReferences: refs.count } });
  return { snapshots: old.length, faceReferences: refs.count };
}
