import { requireCandidate } from '@/lib/auth';
import { getFaceStatus } from '@/lib/face';
import { json, route } from '@/lib/http';

/** Candidate only. { configured, consented, enrolled, retentionDays }. Never returns the face reference itself. */
export const GET = route(async () => {
  const candidate = await requireCandidate();
  return json(await getFaceStatus(candidate.id));
});
