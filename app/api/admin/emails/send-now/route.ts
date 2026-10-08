import { requireAdmin } from '@/lib/auth';
import { sendDueEmails } from '@/lib/email';
import { json, route } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Admin only. Sends whatever is waiting in the email outbox now instead of at the next sweep. */
export const POST = route(async () => {
  await requireAdmin();
  const started = Date.now();
  const report = await sendDueEmails({ hasTimeLeft: () => Date.now() - started < 45_000 });
  return json({ report });
});
