import { NextResponse, type NextRequest } from 'next/server';
import { ADMIN_LOGIN_PATH } from '@/lib/admin-paths';
import { ADMIN_COOKIE, CANDIDATE_COOKIE, verifySession } from '@/lib/session';

// Fast signature check for page routes. The DB-backed checks (admin exists, candidate sessionId
// still current) run in lib/auth.ts on every page and API call.
export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (pathname.startsWith('/admin')) {
    const claims = await verifySession(req.cookies.get(ADMIN_COOKIE)?.value, 'admin');
    // Signed-out visitors get a plain 404, so /admin does not reveal where the admin login lives.
    if (!claims) return NextResponse.rewrite(new URL('/__not-found', req.url), { status: 404 });
  }

  if (pathname.startsWith('/dashboard')) {
    const claims = await verifySession(req.cookies.get(CANDIDATE_COOKIE)?.value, 'candidate');
    if (!claims) return NextResponse.redirect(new URL('/login', req.url));
  }

  return NextResponse.next();
}

export const config = { matcher: ['/admin/:path*', '/dashboard/:path*'] };
