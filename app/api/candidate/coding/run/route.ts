import { requireCandidate } from '@/lib/auth';
import { runBodySchema, runCode } from '@/lib/coding-rounds';
import { json, parseJson, route } from '@/lib/http';

export const runtime = 'nodejs';
export const maxDuration = 60;

export const POST = route(async (req) => {
  const candidate = await requireCandidate();
  return json(await runCode(candidate, await parseJson(req, runBodySchema)));
});
