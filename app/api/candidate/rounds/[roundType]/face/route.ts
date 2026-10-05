import { requireCandidate } from '@/lib/auth';
import { recordFaceCheck } from '@/lib/face';
import { faceCheckSchema } from '@/lib/face-core';
import { json, parseJson, route } from '@/lib/http';
import { parseRoundType } from '@/lib/rounds';

/** Candidate only. Body: { faces, lookingAway?, embedding?, msAgo? }. Answers { recorded, snapshotEventIds, needsEnrollment }. */
export const POST = route<{ roundType: string }>(async (req, { params }) => {
  const candidate = await requireCandidate();
  const { roundType } = await params;
  const type = parseRoundType(roundType);
  const body = await parseJson(req, faceCheckSchema);
  return json(await recordFaceCheck(candidate, type, body));
});
