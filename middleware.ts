import { NextResponse, type NextRequest } from 'next/server';
import { ADMIN_COOKIE, CANDIDATE_COOKIE, verifySession } from '@/lib/session';

// Fast signature check for page routes. The DB-backed checks (admin exists, candidate sessionId
// still current) run in lib/auth.ts on every page and API call.
export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (pathname.startsWith('/admin') && pathname !== '/admin/login') {
    const claims = await verifySession(req.cookies.get(ADMIN_COOKIE)?.value, 'admin');
    if (!claims) return NextResponse.redirect(new URL('/admin/login', req.url));
  }

  if (pathname.startsWith('/dashboard')) {
    const claims = await verifySession(req.cookies.get(CANDIDATE_COOKIE)?.value, 'candidate');
    if (!claims) return NextResponse.redirect(new URL('/login', req.url));
  }

  return NextResponse.next();
}

export const config = { matcher: ['/admin/:path*', '/dashboard/:path*'] };
