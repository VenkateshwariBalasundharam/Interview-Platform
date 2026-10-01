import { NextResponse } from 'next/server';
import { clearSessionCookie } from '@/lib/auth';
import { route } from '@/lib/http';
import { ADMIN_COOKIE } from '@/lib/session';

export const POST = route(async () => {
  const res = NextResponse.json({ ok: true });
  clearSessionCookie(res, ADMIN_COOKIE);
  return res;
});
