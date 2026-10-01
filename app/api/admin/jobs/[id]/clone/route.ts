import { requireAdmin } from '@/lib/auth';
import { json, route } from '@/lib/http';
import { cloneJob } from '@/lib/jobs';

export const POST = route<{ id: string }>(async (_req, { params }) => {
  const admin = await requireAdmin();
  const { id } = await params;
  const job = await cloneJob(id, admin.id);
  return json({ job }, 201);
});
