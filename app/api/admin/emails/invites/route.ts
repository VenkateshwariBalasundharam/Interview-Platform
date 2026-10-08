import { z } from 'zod';
import { requireAdmin } from '@/lib/auth';
import { queueMissingInvites } from '@/lib/email';
import { json, parseJson, route } from '@/lib/http';

export const runtime = 'nodejs';

const bodySchema = z.object({ jobId: z.string().min(1).optional() });

/** Admin only. Queues an invitation for every active candidate who has not started and has no invitation queued or sent. */
export const POST = route(async (req) => {
  const admin = await requireAdmin();
  const { jobId } = await parseJson(req, bodySchema);
  return json(await queueMissingInvites(jobId, admin.id));
});
