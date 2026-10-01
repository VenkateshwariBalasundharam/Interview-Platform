import { requireAdmin } from '@/lib/auth';
import { json, parseJson, route } from '@/lib/http';
import { getJob, savePipeline, savePipelineSchema } from '@/lib/jobs';

export const PUT = route<{ id: string }>(async (req, { params }) => {
  const admin = await requireAdmin();
  const { id } = await params;
  const { steps } = await parseJson(req, savePipelineSchema);
  await savePipeline(id, steps, admin.id);
  return json({ job: await getJob(id) });
});
