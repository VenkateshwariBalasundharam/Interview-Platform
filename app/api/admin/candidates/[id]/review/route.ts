import { reviewBodySchema, reviewCandidate } from '@/lib/attempt-review';
import { requireAdmin } from '@/lib/auth';
import { json, parseJson, route } from '@/lib/http';

export const POST = route<{ id: string }>(async (req, { params }) => {
  const admin = await requireAdmin();
  const { id } = await params;
  const { decision } = await parseJson(req, reviewBodySchema);
  return json(await reviewCandidate(id, decision, admin.id));
});
