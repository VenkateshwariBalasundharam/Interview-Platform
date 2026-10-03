import { z } from 'zod';
import { requireAdmin } from '@/lib/auth';
import { json, parseJson, route } from '@/lib/http';
import { PERSONALISED_ROUNDS } from '@/lib/personalisation';
import { discardCandidateSet, generateCandidateSet } from '@/lib/personalised-sets';

// One candidate's questions are one model call chain, the same size as a job-wide set.
export const maxDuration = 120;

const bodySchema = z.object({ roundType: z.enum(PERSONALISED_ROUNDS) });

/** Generates (or regenerates a draft of) this candidate's questions from their parsed resume. */
export const POST = route<{ id: string }>(async (req, { params }) => {
  const admin = await requireAdmin();
  const { id } = await params;
  const { roundType } = await parseJson(req, bodySchema);
  return json(await generateCandidateSet(id, roundType, admin.id), 201);
});

/** Removes this candidate's draft, so they use the job-wide questions again. */
export const DELETE = route<{ id: string }>(async (req, { params }) => {
  const admin = await requireAdmin();
  const { id } = await params;
  const { roundType } = await parseJson(req, bodySchema);
  return json(await discardCandidateSet(id, roundType, admin.id));
});
