import { NextResponse } from 'next/server';
import { adminLoginSchema, loginAdmin } from '@/lib/admin-auth';
import { attachSessionCookie } from '@/lib/auth';
import { clientIp, parseJson, route } from '@/lib/http';
import { ADMIN_COOKIE } from '@/lib/session';

export const POST = route(async (req) => {
  const input = await parseJson(req, adminLoginSchema);
  const { token, maxAge, admin } = await loginAdmin({ ...input, ip: clientIp(req.headers) });
  const res = NextResponse.json({ admin: { name: admin.name, email: admin.email } });
  attachSessionCookie(res, ADMIN_COOKIE, token, maxAge);
  return res;
});
