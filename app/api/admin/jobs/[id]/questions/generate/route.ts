import { z } from 'zod';
import { requireAdmin } from '@/lib/auth';
import { json, parseJson, route } from '@/lib/http';
import { generateSet } from '@/lib/question-sets';
import { GENERATED_ROUNDS } from '@/lib/questions';

// Generation can take a while (parallel model calls); allow long-running requests where the host supports it.
export const maxDuration = 120;

const bodySchema = z.object({ roundType: z.enum(GENERATED_ROUNDS) });

export const POST = route<{ id: string }>(async (req, { params }) => {
  const admin = await requireAdmin();
  const { id } = await params;
  const { roundType } = await parseJson(req, bodySchema);
  const result = await generateSet(id, roundType, admin.id);
  return json(result, 201);
});
