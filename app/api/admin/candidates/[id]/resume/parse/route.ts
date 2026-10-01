import { requireAdmin } from '@/lib/auth';
import { json, route } from '@/lib/http';
import { reparseResume } from '@/lib/resumes';

export const runtime = 'nodejs';
export const maxDuration = 60;

/** Re-runs the AI parsing step on the stored resume. */
export const POST = route<{ id: string }>(async (_req, { params }) => {
  const admin = await requireAdmin();
  const { id } = await params;
  return json({ resume: await reparseResume({ candidateId: id, adminId: admin.id }) });
});
