import { requireAdmin } from '@/lib/auth';
import { listCandidates } from '@/lib/candidates';
import { json, route } from '@/lib/http';

export const GET = route(async (req) => {
  await requireAdmin();
  const jobId = req.nextUrl.searchParams.get('jobId') ?? undefined;
  return json({ candidates: await listCandidates(jobId) });
});
