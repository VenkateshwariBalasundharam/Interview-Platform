import { requireAdmin } from '@/lib/auth';
import { json, parseJson, route } from '@/lib/http';
import { decideResult, decisionBodySchema } from '@/lib/results';

export const runtime = 'nodejs';

/** Confirms or overrides the suggested decision. Only an admin can make a result final. */
export const POST = route<{ id: string }>(async (req, { params }) => {
  const admin = await requireAdmin();
  const { id } = await params;
  const body = await parseJson(req, decisionBodySchema);
  return json(await decideResult(id, body, admin.id));
});
