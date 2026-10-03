import { z } from 'zod';
import { requireAdmin } from '@/lib/auth';
import { json, parseJson, route } from '@/lib/http';
import { PERSONALISED_ROUNDS } from '@/lib/personalisation';
import { bulkTransition } from '@/lib/personalised-sets';

const bodySchema = z.object({ roundType: z.enum(PERSONALISED_ROUNDS), action: z.enum(['approve', 'lock']) });

/** Approves every valid draft, or locks every approved set, for one personalised round of this job. */
export const POST = route<{ id: string }>(async (req, { params }) => {
  const admin = await requireAdmin();
  const { id } = await params;
  const { roundType, action } = await parseJson(req, bodySchema);
  return json(await bulkTransition(id, roundType, action, admin.id));
});
