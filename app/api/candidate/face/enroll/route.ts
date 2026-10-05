import { requireCandidate } from '@/lib/auth';
import { enrollFaceReference } from '@/lib/face';
import { enrollSchema } from '@/lib/face-core';
import { json, parseJson, route } from '@/lib/http';

/** Candidate only, after consent. Body: { embedding: number[128] }. Stored encrypted; never returned. */
export const POST = route(async (req) => {
  const candidate = await requireCandidate();
  const body = await parseJson(req, enrollSchema);
  return json(await enrollFaceReference(candidate, body.embedding));
});
