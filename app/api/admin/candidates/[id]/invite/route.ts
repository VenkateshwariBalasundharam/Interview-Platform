import { requireAdmin } from '@/lib/auth';
import { queueInviteResend } from '@/lib/email';
import { err, json, route } from '@/lib/http';

export const runtime = 'nodejs';

/** Admin only. Emails this candidate their login link (again). */
export const POST = route<{ id: string }>(async (_req, { params }) => {
  const admin = await requireAdmin();
  const { id } = await params;
  const res = await queueInviteResend(id, admin.id);
  if (res.disabledReason) throw err.conflict(res.disabledReason, 'EMAIL_NOT_SET_UP');
  return json(res);
});
