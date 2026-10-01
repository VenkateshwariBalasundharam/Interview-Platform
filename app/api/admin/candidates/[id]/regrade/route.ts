import { regradeBodySchema, regradeCandidateRound } from '@/lib/attempt-review';
import { requireAdmin } from '@/lib/auth';
import { json, parseJson, route } from '@/lib/http';

export const runtime = 'nodejs';
// Grading makes one or two AI calls; allow long-running requests where the host supports it.
export const maxDuration = 120;

export const POST = route<{ id: string }>(async (req, { params }) => {
  const admin = await requireAdmin();
  const { id } = await params;
  const { roundType } = await parseJson(req, regradeBodySchema);
  return json(await regradeCandidateRound(id, roundType, admin.id));
});
