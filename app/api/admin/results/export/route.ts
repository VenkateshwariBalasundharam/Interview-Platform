import { requireAdmin } from '@/lib/auth';
import { AppError, route } from '@/lib/http';
import { exportQuerySchema, exportResultsCsv } from '@/lib/results';

export const runtime = 'nodejs';

export const GET = route(async (req) => {
  const admin = await requireAdmin();
  const parsed = exportQuerySchema.safeParse({ jobId: req.nextUrl.searchParams.get('jobId') ?? undefined });
  if (!parsed.success) throw new AppError(400, 'VALIDATION_ERROR', 'jobId is not valid');
  const csv = await exportResultsCsv(parsed.data.jobId, admin.id);
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="interview-results.csv"',
      'Cache-Control': 'no-store',
    },
  });
});
