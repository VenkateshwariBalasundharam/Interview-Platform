// Edge-safe: imported by middleware.ts, so it may only depend on `jose`.
import { SignJWT, jwtVerify } from 'jose';

export type SessionRole = 'admin' | 'candidate';

export interface SessionClaims {
  role: SessionRole;
  sub: string;
  /** Candidate sessions carry the DB sessionId; a newer login invalidates older tokens. */
  sid?: string;
}

export const ADMIN_COOKIE = 'admin_session';
export const CANDIDATE_COOKIE = 'candidate_session';

const ISSUER = 'interview-platform';

function secretKey(secret?: string): Uint8Array {
  const value = secret ?? process.env.JWT_SECRET;
  if (!value || value.length < 32) {
    throw new Error('JWT_SECRET must be set and at least 32 characters');
  }
  return new TextEncoder().encode(value);
}

export async function signSession(claims: SessionClaims, ttlSeconds: number, secret?: string): Promise<string> {
  const builder = new SignJWT({ role: claims.role, ...(claims.sid ? { sid: claims.sid } : {}) })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.sub)
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`);
  return builder.sign(secretKey(secret));
}

/** Returns the claims, or null when the token is missing, invalid, expired or of the wrong role. */
export async function verifySession(
  token: string | undefined,
  expectedRole: SessionRole,
  secret?: string,
): Promise<SessionClaims | null> {
  if (!token) return null;
  const key = secretKey(secret); // config errors must surface, not look like "logged out"
  try {
    const { payload } = await jwtVerify(token, key, { issuer: ISSUER, algorithms: ['HS256'] });
    if (payload.role !== expectedRole || typeof payload.sub !== 'string') return null;
    return {
      role: expectedRole,
      sub: payload.sub,
      sid: typeof payload.sid === 'string' ? payload.sid : undefined,
    };
  } catch {
    return null;
  }
}
