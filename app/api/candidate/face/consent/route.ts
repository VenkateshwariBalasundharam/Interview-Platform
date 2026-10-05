import { requireCandidate } from '@/lib/auth';
import { recordFaceConsent } from '@/lib/face';
import { json, route } from '@/lib/http';

/** Candidate only. The candidate agreed to camera checks. No body. */
export const POST = route(async () => {
  const candidate = await requireCandidate();
  return json(await recordFaceConsent(candidate));
});
