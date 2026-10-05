import { ADMIN_LOGIN_PATH } from '@/lib/admin-paths';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { err } from '@/lib/http';
import { ADMIN_COOKIE, CANDIDATE_COOKIE, verifySession } from '@/lib/session';

export function attachSessionCookie(res: NextResponse, name: string, token: string, maxAgeSec: number) {
  res.cookies.set(name, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: maxAgeSec,
  });
}

export function clearSessionCookie(res: NextResponse, name: string) {
  res.cookies.set(name, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: 0,
  });
}

export interface AdminSession {
  id: string;
  email: string;
  name: string;
}

export interface CandidateSession {
  id: string;
  candidateCode: string;
  name: string;
  status: 'ACTIVE' | 'DISQUALIFIED' | 'PENDING_REVIEW' | 'COMPLETED';
  jobId: string;
}

// Wrapped in React's cache(): the layout and the page both ask for the session while one page is rendering, and this
// makes them share one database lookup instead of paying for two round trips. The cache lasts for that one request only.
export const getAdminSession = cache(async (): Promise<AdminSession | null> => {
  const store = await cookies();
  const claims = await verifySession(store.get(ADMIN_COOKIE)?.value, 'admin');
  if (!claims) return null;
  return prisma.adminUser.findUnique({ where: { id: claims.sub }, select: { id: true, email: true, name: true } });
});

/** Valid only while the token's sid matches the candidate's current DB sessionId (single active session). */
export const getCandidateSession = cache(async (): Promise<CandidateSession | null> => {
  const store = await cookies();
  const claims = await verifySession(store.get(CANDIDATE_COOKIE)?.value, 'candidate');
  if (!claims || !claims.sid) return null;
  const candidate = await prisma.candidate.findUnique({
    where: { id: claims.sub },
    select: { id: true, candidateCode: true, name: true, status: true, jobId: true, sessionId: true },
  });
  if (!candidate || candidate.sessionId !== claims.sid) return null;
  const { sessionId: _omit, ...session } = candidate;
  return session;
});

export async function requireAdmin(): Promise<AdminSession> {
  const admin = await getAdminSession();
  if (!admin) throw err.unauthorized();
  return admin;
}

export async function requireCandidate(): Promise<CandidateSession> {
  const candidate = await getCandidateSession();
  if (!candidate) throw err.unauthorized('Your session has ended. Please log in again.', 'SESSION_INVALID');
  return candidate;
}

export async function requireAdminPage(): Promise<AdminSession> {
  const admin = await getAdminSession();
  if (!admin) redirect(ADMIN_LOGIN_PATH);
  return admin;
}

export async function requireCandidatePage(): Promise<CandidateSession> {
  const candidate = await getCandidateSession();
  if (!candidate) redirect('/login');
  return candidate;
}
