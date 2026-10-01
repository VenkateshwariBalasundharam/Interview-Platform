import { requireCandidate } from '@/lib/auth';
import { json, route } from '@/lib/http';
import { parseRoundType, startRound } from '@/lib/rounds';

export const runtime = 'nodejs';

export const POST = route<{ roundType: string }>(async (_req, { params }) => {
  const candidate = await requireCandidate();
  const { roundType } = await params;
  return json({ state: await startRound(candidate, parseRoundType(roundType)) });
});
