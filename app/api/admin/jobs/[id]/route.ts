import { requireAdmin } from '@/lib/auth';
import { deleteJobWithData } from '@/lib/delete-data';
import { json, parseJson, route } from '@/lib/http';
import { getJob, updateJob, updateJobSchema } from '@/lib/jobs';

type Params = { id: string };

export const GET = route<Params>(async (_req, { params }) => {
  await requireAdmin();
  const { id } = await params;
  return json({ job: await getJob(id) });
});

export const PATCH = route<Params>(async (req, { params }) => {
  const admin = await requireAdmin();
  const { id } = await params;
  const patch = await parseJson(req, updateJobSchema);
  await updateJob(id, patch, admin.id);
  return json({ job: await getJob(id) });
});

/** `?deleteCandidates=true` is required to delete a job that has candidates; their data is deleted with it. */
export const DELETE = route<Params>(async (req, { params }) => {
  const admin = await requireAdmin();
  const { id } = await params;
  const deleteCandidates = req.nextUrl.searchParams.get('deleteCandidates') === 'true';
  return json({ ok: true, ...(await deleteJobWithData(id, admin.id, { deleteCandidates })) });
});
