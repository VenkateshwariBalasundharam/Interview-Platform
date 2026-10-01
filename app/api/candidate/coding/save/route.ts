import { requireCandidate } from '@/lib/auth';
import { codeBodySchema, saveDraft } from '@/lib/coding-rounds';
import { json, parseJson, route } from '@/lib/http';

export const runtime = 'nodejs';

export const PATCH = route(async (req) => {
  const candidate = await requireCandidate();
  return json(await saveDraft(candidate, await parseJson(req, codeBodySchema)));
});
