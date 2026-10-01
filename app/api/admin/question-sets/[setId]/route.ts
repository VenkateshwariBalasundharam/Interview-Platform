import { z } from 'zod';
import { requireAdmin } from '@/lib/auth';
import { json, parseJson, route } from '@/lib/http';
import { transitionSet } from '@/lib/question-sets';
import { SET_ACTIONS } from '@/lib/questions';

const bodySchema = z.object({ action: z.enum(SET_ACTIONS) });

export const PATCH = route<{ setId: string }>(async (req, { params }) => {
  const admin = await requireAdmin();
  const { setId } = await params;
  const { action } = await parseJson(req, bodySchema);
  return json({ set: await transitionSet(setId, action, admin.id) });
});
