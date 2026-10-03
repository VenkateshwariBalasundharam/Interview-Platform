import { requireAdmin } from '@/lib/auth';
import { AppError, json, parseJson, route } from '@/lib/http';
import { ROUND_TYPES, type RoundType } from '@/lib/pipeline';
import { resetRoundBodySchema } from '@/lib/round-reset';
import { resetCandidateRound } from '@/lib/round-reset-server';

export const runtime = 'nodejs';

/** Resets one round for one candidate so they can retake it. Admin only; a reason is required and audited. */
export const POST = route<{ id: string; roundType: string }>(async (req, { params }) => {
  const admin = await requireAdmin();
  const { id, roundType } = await params;
  if (!(ROUND_TYPES as readonly string[]).includes(roundType)) throw new AppError(400, 'VALIDATION_ERROR', 'Unknown round');
  const body = await parseJson(req, resetRoundBodySchema);
  return json(await resetCandidateRound(id, roundType as RoundType, body, admin.id));
});
