import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { audit } from '@/lib/audit';
import { normalizeCandidateCode } from '@/lib/candidate-code';
import { prisma } from '@/lib/db';
import { normalizeLoginDob } from '@/lib/dob';
import { getEnv } from '@/lib/env';
import { err } from '@/lib/http';
import { evaluateLock, lockUntilAfterFailure, LOCK_MINUTES, MAX_FAILED_ATTEMPTS } from '@/lib/lockout';
import { consumeRateLimit } from '@/lib/ratelimit';
import { signSession } from '@/lib/session';

export const candidateLoginSchema = z.object({
  candidateCode: z.string().min(1).max(64),
  dob: z.string().min(1).max(32),
});

export const INVALID_CREDENTIALS_MESSAGE = 'Invalid Candidate ID or date of birth.';
const LOCKED_MESSAGE = `Too many failed attempts. Try again in ${LOCK_MINUTES} minutes.`;
const WINDOW_MS = LOCK_MINUTES * 60 * 1000;
const PER_IP_LIMIT = 30;

let dummyHash: string | null = null;
function getDummyHash() {
  dummyHash ??= bcrypt.hashSync('00000000', 10);
  return dummyHash;
}

/**
 * Wrong ID and wrong DOB return the same 401 message. Unknown IDs are throttled with the same
 * threshold and window as real accounts, so a lockout response does not reveal that an ID exists.
 */
export async function loginCandidate(input: { candidateCode: string; dob: string; ip: string }) {
  const now = new Date();
  const code = normalizeCandidateCode(input.candidateCode);
  const dob = normalizeLoginDob(input.dob);

  const perIp = await consumeRateLimit(`candidate-login:ip:${input.ip}`, PER_IP_LIMIT, WINDOW_MS);
  if (!perIp.allowed) throw err.tooMany(perIp.retryAfterSec, 'Too many login attempts. Try again later.');

  let candidate = await prisma.candidate.findUnique({ where: { candidateCode: code } });

  if (!candidate) {
    await bcrypt.compare(dob ?? '00000000', getDummyHash());
    const unknown = await consumeRateLimit(`candidate-login:unknown:${code}`, MAX_FAILED_ATTEMPTS, WINDOW_MS);
    if (!unknown.allowed) throw err.tooMany(unknown.retryAfterSec, LOCKED_MESSAGE, 'ACCOUNT_LOCKED');
    throw err.unauthorized(INVALID_CREDENTIALS_MESSAGE, 'INVALID_CREDENTIALS');
  }

  const lock = evaluateLock(candidate, now);
  if (lock.locked) throw err.tooMany(lock.retryAfterSec, LOCKED_MESSAGE, 'ACCOUNT_LOCKED');
  if (lock.expired) {
    candidate = await prisma.candidate.update({ where: { id: candidate.id }, data: { failedLoginCount: 0, lockedUntil: null } });
  }

  const matches = dob !== null && (await bcrypt.compare(dob, candidate.dobHash));
  if (!matches) {
    const updated = await prisma.candidate.update({
      where: { id: candidate.id },
      data: { failedLoginCount: { increment: 1 } },
      select: { failedLoginCount: true },
    });
    const lockedUntil = lockUntilAfterFailure(updated.failedLoginCount, now);
    if (lockedUntil) {
      await prisma.candidate.update({ where: { id: candidate.id }, data: { lockedUntil, failedLoginCount: 0 } });
      await audit({ actorType: 'SYSTEM', action: 'CANDIDATE_LOCKED', entity: 'Candidate', entityId: candidate.id });
    }
    throw err.unauthorized(INVALID_CREDENTIALS_MESSAGE, 'INVALID_CREDENTIALS');
  }

  // New sessionId replaces the old one, which invalidates any other active session for this candidate.
  const sessionId = randomUUID();
  await prisma.candidate.update({
    where: { id: candidate.id },
    data: { failedLoginCount: 0, lockedUntil: null, sessionId, lastLoginAt: now },
  });

  const maxAge = getEnv().CANDIDATE_SESSION_HOURS * 3600;
  const token = await signSession({ role: 'candidate', sub: candidate.id, sid: sessionId }, maxAge);
  await audit({ actorType: 'CANDIDATE', actorId: candidate.id, action: 'CANDIDATE_LOGIN', entity: 'Candidate', entityId: candidate.id });
  return { token, maxAge, candidate: { candidateCode: candidate.candidateCode, name: candidate.name } };
}

export async function logoutCandidate(candidateId: string) {
  await prisma.candidate.update({ where: { id: candidateId }, data: { sessionId: null } });
}
