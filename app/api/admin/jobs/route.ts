import { requireAdmin } from '@/lib/auth';
import { json, parseJson, route } from '@/lib/http';
import { createJob, createJobSchema, listJobs } from '@/lib/jobs';

export const GET = route(async () => {
  await requireAdmin();
  return json({ jobs: await listJobs() });
});

export const POST = route(async (req) => {
  const admin = await requireAdmin();
  const input = await parseJson(req, createJobSchema);
  const job = await createJob(input, admin.id);
  return json({ job }, 201);
});
