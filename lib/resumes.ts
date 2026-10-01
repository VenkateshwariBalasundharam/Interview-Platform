// Resume upload, parsing, download and removal for one candidate (server only). Never logs resume text.
import { Prisma } from '@prisma/client';
import { audit } from '@/lib/audit';
import { prisma } from '@/lib/db';
import { AppError, err } from '@/lib/http';
import type { Complete } from '@/lib/llm';
import { RESUME_CONTENT_TYPE, detectResumeFormat, extractResumeText, validateResumeUpload } from '@/lib/resume-file';
import { parseResumeText, parsedResumeSchema, type ParsedResume } from '@/lib/resume-parse';
import { deletePrivate, getPrivate, putPrivate } from '@/lib/storage';

const BUCKET = 'resumes';

/** Safe to send to the browser: never includes the storage key. */
export interface ResumeSummary {
  hasResume: boolean;
  uploadedAt: string | null;
  parsedAt: string | null;
  parseError: string | null;
  parsed: ParsedResume | null;
}

interface ResumeRow {
  resumePath: string | null;
  resumeUploadedAt: Date | null;
  resumeParsed: Prisma.JsonValue | null;
  resumeParsedAt: Date | null;
  resumeParseError: string | null;
}

export const RESUME_SELECT = {
  resumePath: true,
  resumeUploadedAt: true,
  resumeParsed: true,
  resumeParsedAt: true,
  resumeParseError: true,
} as const;

export function toResumeSummary(row: ResumeRow): ResumeSummary {
  const parsed = parsedResumeSchema.safeParse(row.resumeParsed);
  return {
    hasResume: row.resumePath !== null,
    uploadedAt: row.resumeUploadedAt?.toISOString() ?? null,
    parsedAt: row.resumeParsedAt?.toISOString() ?? null,
    parseError: row.resumeParseError,
    parsed: parsed.success ? parsed.data : null,
  };
}

async function findCandidate(candidateId: string) {
  const candidate = await prisma.candidate.findUnique({ where: { id: candidateId }, select: { id: true, candidateCode: true, ...RESUME_SELECT } });
  if (!candidate) throw err.notFound('Candidate not found', 'CANDIDATE_NOT_FOUND');
  return candidate;
}

/** Runs the model on already-extracted text. A model failure is recorded on the candidate instead of thrown. */
async function tryParse(text: string, complete?: Complete): Promise<{ parsed: ParsedResume | null; error: string | null }> {
  try {
    return { parsed: await parseResumeText(text, complete), error: null };
  } catch (e) {
    if (e instanceof AppError) return { parsed: null, error: e.message };
    throw e;
  }
}

const parseFields = (result: { parsed: ParsedResume | null; error: string | null }) => ({
  resumeParsed: result.parsed ?? Prisma.DbNull,
  resumeParsedAt: result.parsed ? new Date() : null,
  resumeParseError: result.error,
});

/**
 * Stores the file (replacing any earlier one) and parses it. If the AI step fails the file is still saved and the
 * reason is kept, so the admin can retry with "Re-parse" once the problem is fixed.
 */
export async function uploadResume(input: { candidateId: string; data: Buffer; adminId: string; complete?: Complete }): Promise<ResumeSummary> {
  const candidate = await findCandidate(input.candidateId);
  const format = validateResumeUpload(input.data);
  const text = await extractResumeText(input.data, format);
  const result = await tryParse(text, input.complete);

  const key = await putPrivate(BUCKET, input.data, format);
  let row: ResumeRow;
  try {
    row = await prisma.candidate.update({
      where: { id: candidate.id },
      data: { resumePath: key, resumeUploadedAt: new Date(), ...parseFields(result) },
      select: RESUME_SELECT,
    });
  } catch (e) {
    await deletePrivate(key).catch(() => undefined);
    throw e;
  }
  if (candidate.resumePath) await deletePrivate(candidate.resumePath).catch(() => undefined);

  await audit({ actorType: 'ADMIN', actorId: input.adminId, action: 'RESUME_UPLOADED', entity: 'Candidate', entityId: candidate.id, meta: { format, parsed: result.parsed !== null } });
  return toResumeSummary(row);
}

/** Reads the stored file again and re-runs the AI step (for example after fixing the API key). */
export async function reparseResume(input: { candidateId: string; adminId: string; complete?: Complete }): Promise<ResumeSummary> {
  const candidate = await findCandidate(input.candidateId);
  if (!candidate.resumePath) throw err.notFound('This candidate has no resume', 'RESUME_NOT_FOUND');

  const data = await getPrivate(candidate.resumePath).catch(() => {
    throw err.notFound('The stored resume file is missing. Upload it again.', 'RESUME_FILE_MISSING');
  });
  const format = detectResumeFormat(data);
  if (!format) throw err.badRequest('The stored file is not a PDF or Word document. Upload it again.', 'RESUME_UNSUPPORTED_TYPE');

  const text = await extractResumeText(data, format);
  const result = await tryParse(text, input.complete);
  const row = await prisma.candidate.update({ where: { id: candidate.id }, data: parseFields(result), select: RESUME_SELECT });
  await audit({ actorType: 'ADMIN', actorId: input.adminId, action: 'RESUME_REPARSED', entity: 'Candidate', entityId: candidate.id, meta: { parsed: result.parsed !== null } });
  return toResumeSummary(row);
}

/** Returns the original file for an admin download. The file name uses the candidate code, not the person's name. */
export async function readResumeFile(input: { candidateId: string; adminId: string }) {
  const candidate = await findCandidate(input.candidateId);
  if (!candidate.resumePath) throw err.notFound('This candidate has no resume', 'RESUME_NOT_FOUND');
  const data = await getPrivate(candidate.resumePath).catch(() => {
    throw err.notFound('The stored resume file is missing. Upload it again.', 'RESUME_FILE_MISSING');
  });
  const format = detectResumeFormat(data);
  if (!format) throw err.notFound('The stored file could not be identified.', 'RESUME_FILE_MISSING');
  await audit({ actorType: 'ADMIN', actorId: input.adminId, action: 'RESUME_DOWNLOADED', entity: 'Candidate', entityId: candidate.id });
  return { data, contentType: RESUME_CONTENT_TYPE[format], filename: `resume-${candidate.candidateCode}.${format}` };
}

export async function deleteResume(input: { candidateId: string; adminId: string }): Promise<ResumeSummary> {
  const candidate = await findCandidate(input.candidateId);
  if (!candidate.resumePath) return toResumeSummary(candidate);
  const row = await prisma.candidate.update({
    where: { id: candidate.id },
    data: { resumePath: null, resumeUploadedAt: null, resumeParsed: Prisma.DbNull, resumeParsedAt: null, resumeParseError: null },
    select: RESUME_SELECT,
  });
  await deletePrivate(candidate.resumePath).catch(() => undefined);
  await audit({ actorType: 'ADMIN', actorId: input.adminId, action: 'RESUME_DELETED', entity: 'Candidate', entityId: candidate.id });
  return toResumeSummary(row);
}
