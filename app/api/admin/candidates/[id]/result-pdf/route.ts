import { requireAdmin } from '@/lib/auth';
import { route } from '@/lib/http';
import { exportCandidateResultPdf } from '@/lib/results';

export const runtime = 'nodejs';

/** One candidate's result sheet as a PDF. Admin only. */
export const GET = route<{ id: string }>(async (_req, { params }) => {
  const admin = await requireAdmin();
  const { id } = await params;
  const { pdf, candidateCode } = await exportCandidateResultPdf(id, admin.id);
  const safeName = candidateCode.replace(/[^A-Za-z0-9_-]/g, '');
  return new Response(new Uint8Array(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="result-${safeName || 'candidate'}.pdf"`,
      'Cache-Control': 'no-store',
    },
  });
});
