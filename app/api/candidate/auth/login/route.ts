import { NextResponse } from 'next/server';
import { attachSessionCookie } from '@/lib/auth';
import { candidateLoginSchema, loginCandidate } from '@/lib/candidate-auth';
import { clientIp, parseJson, route } from '@/lib/http';
import { CANDIDATE_COOKIE } from '@/lib/session';

export const POST = route(async (req) => {
  const input = await parseJson(req, candidateLoginSchema);
  const { token, maxAge, candidate } = await loginCandidate({ ...input, ip: clientIp(req.headers) });
  const res = NextResponse.json({ candidate });
  attachSessionCookie(res, CANDIDATE_COOKIE, token, maxAge);
  return res;
});
