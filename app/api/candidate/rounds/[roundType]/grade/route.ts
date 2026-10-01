import { requireCandidate } from '@/lib/auth';
import { json, route } from '@/lib/http';
import { gradeRound, parseRoundType } from '@/lib/rounds';

export const runtime = 'nodejs';
// Grading typed answers makes one or two AI calls; allow long-running requests where the host supports it.
export const maxDuration = 120;

export const POST = route<{ roundType: string }>(async (_req, { params }) => {
  const candidate = await requireCandidate();
  const { roundType } = await params;
  return json({ state: await gradeRound(candidate, parseRoundType(roundType)) });
});
