import { NextResponse } from 'next/server';
import { clearSessionCookie, getCandidateSession } from '@/lib/auth';
import { logoutCandidate } from '@/lib/candidate-auth';
import { route } from '@/lib/http';
import { CANDIDATE_COOKIE } from '@/lib/session';

export const POST = route(async () => {
  const session = await getCandidateSession();
  if (session) await logoutCandidate(session.id);
  const res = NextResponse.json({ ok: true });
  clearSessionCookie(res, CANDIDATE_COOKIE);
  return res;
});
