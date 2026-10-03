import { requireCandidate } from '@/lib/auth';
import { json, parseJson, route } from '@/lib/http';
import { proctorBatchSchema, recordProctorEvents } from '@/lib/proctoring';
import { parseRoundType } from '@/lib/rounds';

/** Candidate only. Body: { events: [{ type, msAgo, ... }] }, 1 to 20 events. Answers { recorded, dropped }. */
export const POST = route<{ roundType: string }>(async (req, { params }) => {
  const candidate = await requireCandidate();
  const { roundType } = await params;
  const type = parseRoundType(roundType);
  const body = await parseJson(req, proctorBatchSchema);
  return json(await recordProctorEvents(candidate, type, body));
});
