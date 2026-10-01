import { requireCandidate } from '@/lib/auth';
import { json, route } from '@/lib/http';
import { getRoundPage, parseRoundType } from '@/lib/rounds';

export const GET = route<{ roundType: string }>(async (_req, { params }) => {
  const candidate = await requireCandidate();
  const { roundType } = await params;
  return json({ state: await getRoundPage(candidate, parseRoundType(roundType)) });
});
