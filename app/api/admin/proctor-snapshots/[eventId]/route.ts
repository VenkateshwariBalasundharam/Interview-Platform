import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { readSnapshot } from '@/lib/face';
import { route } from '@/lib/http';

export const runtime = 'nodejs';

/** Admin only. The photo kept for one proctoring event. Never cached; every view is audited. */
export const GET = route<{ eventId: string }>(async (_req, { params }) => {
  const admin = await requireAdmin();
  const { eventId } = await params;
  const data = await readSnapshot(eventId, admin.id);
  return new NextResponse(new Uint8Array(data), {
    headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' },
  });
});
