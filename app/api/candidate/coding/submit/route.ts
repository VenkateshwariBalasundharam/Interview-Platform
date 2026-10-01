import { requireCandidate } from '@/lib/auth';
import { codeBodySchema, submitCode } from '@/lib/coding-rounds';
import { json, parseJson, route } from '@/lib/http';

export const runtime = 'nodejs';
export const maxDuration = 60;

export const POST = route(async (req) => {
  const candidate = await requireCandidate();
  return json(await submitCode(candidate, await parseJson(req, codeBodySchema)));
});
