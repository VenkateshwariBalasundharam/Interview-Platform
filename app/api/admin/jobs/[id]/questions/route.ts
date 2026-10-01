import { requireAdmin } from '@/lib/auth';
import { json, route } from '@/lib/http';
import { getQuestionOverview } from '@/lib/question-sets';

export const GET = route<{ id: string }>(async (_req, { params }) => {
  await requireAdmin();
  const { id } = await params;
  return json(await getQuestionOverview(id));
});
