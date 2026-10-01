import { requireCandidate } from '@/lib/auth';
import { json, parseJson, route } from '@/lib/http';
import { answerBodySchema, parseRoundType, saveAnswer } from '@/lib/rounds';

export const PATCH = route<{ roundType: string }>(async (req, { params }) => {
  const candidate = await requireCandidate();
  const { roundType } = await params;
  const body = await parseJson(req, answerBodySchema);
  return json(await saveAnswer(candidate, parseRoundType(roundType), body));
});
