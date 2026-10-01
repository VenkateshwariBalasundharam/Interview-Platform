import { z } from 'zod';
import { requireAdmin } from '@/lib/auth';
import { json, parseJson, route } from '@/lib/http';
import { deleteQuestion, updateQuestion } from '@/lib/question-sets';

// The fields are validated against the stored question's kind inside updateQuestion.
const bodySchema = z.object({}).passthrough();

export const PATCH = route<{ id: string }>(async (req, { params }) => {
  const admin = await requireAdmin();
  const { id } = await params;
  const body = await parseJson(req, bodySchema);
  await updateQuestion(id, body, admin.id);
  return json({ ok: true });
});

export const DELETE = route<{ id: string }>(async (_req, { params }) => {
  const admin = await requireAdmin();
  const { id } = await params;
  await deleteQuestion(id, admin.id);
  return json({ ok: true });
});
