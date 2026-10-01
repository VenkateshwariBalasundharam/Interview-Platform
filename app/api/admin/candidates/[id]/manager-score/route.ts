import { requireAdmin } from '@/lib/auth';
import { json, parseJson, route } from '@/lib/http';
import { managerScoreSchema, saveManagerScore } from '@/lib/results';

export const runtime = 'nodejs';

/** Saves (or replaces) the admin's score for the live Manager interview. */
export const PUT = route<{ id: string }>(async (req, { params }) => {
  const admin = await requireAdmin();
  const { id } = await params;
  const body = await parseJson(req, managerScoreSchema);
  return json(await saveManagerScore(id, body, admin.id));
});
