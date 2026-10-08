import { requireAdmin } from '@/lib/auth';
import { retryFailedEmails } from '@/lib/email';
import { json, route } from '@/lib/http';

export const runtime = 'nodejs';

/** Admin only. Puts every failed email back in the outbox. */
export const POST = route(async () => {
  const admin = await requireAdmin();
  return json({ requeued: await retryFailedEmails(admin.id) });
});
