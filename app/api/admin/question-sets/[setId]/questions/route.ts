import { z } from 'zod';
import { requireAdmin } from '@/lib/auth';
import { json, parseJson, route } from '@/lib/http';
import { addQuestion } from '@/lib/question-sets';
import { QUESTION_KINDS } from '@/lib/questions';

// `kind` picks the schema; the remaining fields are validated for that kind inside addQuestion.
const bodySchema = z.object({ kind: z.enum(QUESTION_KINDS) }).passthrough();

export const POST = route<{ setId: string }>(async (req, { params }) => {
  const admin = await requireAdmin();
  const { setId } = await params;
  const { kind, ...fields } = await parseJson(req, bodySchema);
  const question = await addQuestion(setId, kind, fields, admin.id);
  return json({ question }, 201);
});
