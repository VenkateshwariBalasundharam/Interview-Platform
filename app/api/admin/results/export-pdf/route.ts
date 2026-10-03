import { requireAdmin } from '@/lib/auth';
import { AppError, route } from '@/lib/http';
import { exportQuerySchema, exportResultsPdf } from '@/lib/results';

export const runtime = 'nodejs';

/** Results table as a PDF (all jobs, or one with ?jobId=). Admin only. */
export const GET = route(async (req) => {
  const admin = await requireAdmin();
  const parsed = exportQuerySchema.safeParse({ jobId: req.nextUrl.searchParams.get('jobId') ?? undefined });
  if (!parsed.success) throw new AppError(400, 'VALIDATION_ERROR', 'jobId is not valid');
  const pdf = await exportResultsPdf(parsed.data.jobId, admin.id);
  return new Response(new Uint8Array(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'attachment; filename="interview-results.pdf"',
      'Cache-Control': 'no-store',
    },
  });
});
