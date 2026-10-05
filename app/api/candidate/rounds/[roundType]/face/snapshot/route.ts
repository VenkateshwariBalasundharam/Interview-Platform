import { requireCandidate } from '@/lib/auth';
import { saveSnapshot } from '@/lib/face';
import { MAX_SNAPSHOT_BYTES } from '@/lib/face-core';
import { err, json, route } from '@/lib/http';
import { parseRoundType } from '@/lib/rounds';

export const runtime = 'nodejs';

/** Candidate only. Query: ?eventId=... Body: the raw JPEG bytes (Content-Type: image/jpeg), 150 KB at most. */
export const POST = route<{ roundType: string }>(async (req, { params }) => {
  const candidate = await requireCandidate();
  const { roundType } = await params;
  const type = parseRoundType(roundType);
  const eventId = new URL(req.url).searchParams.get('eventId');
  if (!eventId) throw err.badRequest('eventId is required.', 'EVENT_ID_MISSING');
  const declared = Number(req.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_SNAPSHOT_BYTES) throw err.tooLarge('The photo is too large.', 'SNAPSHOT_TOO_LARGE');
  const data = Buffer.from(await req.arrayBuffer());
  return json(await saveSnapshot(candidate, type, eventId, data), 201);
});
