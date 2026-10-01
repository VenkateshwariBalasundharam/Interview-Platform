import { requireAdmin } from '@/lib/auth';
import { updateCandidateSchema } from '@/lib/candidate-edit';
import { updateCandidate } from '@/lib/candidates';
import { deleteCandidate } from '@/lib/delete-data';
import { json, parseJson, route } from '@/lib/http';

export const PATCH = route<{ id: string }>(async (req, { params }) => {
  const admin = await requireAdmin();
  const { id } = await params;
  const patch = await parseJson(req, updateCandidateSchema);
  return json({ candidate: await updateCandidate(id, patch, admin.id) });
});

export const DELETE = route<{ id: string }>(async (_req, { params }) => {
  const admin = await requireAdmin();
  const { id } = await params;
  await deleteCandidate(id, admin.id);
  return json({ ok: true });
});
