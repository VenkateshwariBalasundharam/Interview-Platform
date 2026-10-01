import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { err, json, route } from '@/lib/http';
import { MAX_RESUME_BYTES } from '@/lib/resume-file';
import { deleteResume, readResumeFile, uploadResume } from '@/lib/resumes';

export const runtime = 'nodejs';
// Parsing calls the AI model, which can take a while.
export const maxDuration = 60;

/** Upload or replace the resume: multipart form with a single "file" field. */
export const POST = route<{ id: string }>(async (req, { params }) => {
  const admin = await requireAdmin();
  const { id } = await params;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw err.badRequest('Send the resume as multipart form data with a "file" field.', 'INVALID_FORM');
  }
  const file = form.get('file');
  if (!(file instanceof File)) throw err.badRequest('Choose a resume file to upload.', 'RESUME_MISSING');
  if (file.size > MAX_RESUME_BYTES) throw err.tooLarge('The resume must be 4 MB or smaller.', 'RESUME_TOO_LARGE');

  const resume = await uploadResume({ candidateId: id, data: Buffer.from(await file.arrayBuffer()), adminId: admin.id });
  return json({ resume }, 201);
});

/** Download the original file. Admin only; never cached. */
export const GET = route<{ id: string }>(async (_req, { params }) => {
  const admin = await requireAdmin();
  const { id } = await params;
  const file = await readResumeFile({ candidateId: id, adminId: admin.id });
  return new NextResponse(new Uint8Array(file.data), {
    headers: {
      'Content-Type': file.contentType,
      'Content-Disposition': `attachment; filename="${file.filename}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
});

export const DELETE = route<{ id: string }>(async (_req, { params }) => {
  const admin = await requireAdmin();
  const { id } = await params;
  return json({ resume: await deleteResume({ candidateId: id, adminId: admin.id }) });
});
