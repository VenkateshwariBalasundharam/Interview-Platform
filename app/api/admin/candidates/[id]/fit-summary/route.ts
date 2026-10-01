import { requireAdmin } from '@/lib/auth';
import { generateFitSummaryFor, getFitSummaryState } from '@/lib/fit-summaries';
import { json, route } from '@/lib/http';

export const maxDuration = 120;

export const GET = route<{ id: string }>(async (_req, { params }) => {
  await requireAdmin();
  const { id } = await params;
  return json(await getFitSummaryState(id));
});

export const POST = route<{ id: string }>(async (_req, { params }) => {
  const admin = await requireAdmin();
  const { id } = await params;
  return json(await generateFitSummaryFor(id, admin.id));
});
