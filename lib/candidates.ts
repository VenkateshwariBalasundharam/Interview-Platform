import bcrypt from 'bcryptjs';
import { Prisma } from '@prisma/client';
import { audit } from '@/lib/audit';
import { FIRST_CANDIDATE_NUMBER, numberCodes } from '@/lib/candidate-code';
import { candidateFileToCsv } from '@/lib/candidate-file';
import type { UpdateCandidateInput } from '@/lib/candidate-edit';
import { CsvFormatError, parseCandidateCsv, type RejectedRow } from '@/lib/csv';
import { prisma } from '@/lib/db';
import { err } from '@/lib/http';
import { parseDob } from '@/lib/dob';
import { createJob } from '@/lib/jobs';
import { getPreset, type JobFields } from '@/lib/pipeline';
import { RESUME_SELECT, toResumeSummary } from '@/lib/resumes';

export interface ImportResult {
  dryRun: boolean;
  /** Rows that passed validation. On a real import these were created. */
  validCount: number;
  created: { row: number; candidateCode: string; name: string; email: string }[];
  rejected: RejectedRow[];
  /** Set when the import created a new job from a typed title (a real import only). */
  createdJob: { id: string; title: string } | null;
}

/** A job typed on the import form: the title plus what the role needs. Rounds come from the level's preset. */
export type NewJobInput = Pick<JobFields, 'title' | 'jdText' | 'requiredSkills' | 'tier'>;

/** Reserves the next `count` running numbers (1001, 1002, ...). One atomic database update, so two imports can never get the same number. */
async function allocateCodes(count: number): Promise<string[]> {
  const counter = await prisma.counter.upsert({
    where: { key: 'candidateNumber' },
    update: { value: { increment: count } },
    create: { key: 'candidateNumber', value: FIRST_CANDIDATE_NUMBER - 1 + count },
    select: { value: true },
  });
  return numberCodes(counter.value, count);
}

export async function importCandidates(input: { jobId?: string; newJob?: NewJobInput; file: Buffer; dryRun: boolean; adminId: string }): Promise<ImportResult> {
  if (Boolean(input.jobId) === Boolean(input.newJob)) throw err.badRequest('Pick an existing job or enter a new one.', 'JOB_REQUIRED');
  if (input.jobId) {
    const job = await prisma.job.findUnique({ where: { id: input.jobId }, select: { id: true } });
    if (!job) throw err.notFound('Job not found', 'JOB_NOT_FOUND');
  }

  let parsed;
  try {
    parsed = parseCandidateCsv(await candidateFileToCsv(input.file));
  } catch (e) {
    if (e instanceof CsvFormatError) throw err.badRequest(e.message, e.code);
    throw e;
  }

  const rejected: RejectedRow[] = [...parsed.rejected];
  // A job that is about to be created has no candidates yet, so there is nothing to clash with.
  const existing = input.jobId
    ? await prisma.candidate.findMany({ where: { jobId: input.jobId, email: { in: parsed.valid.map((r) => r.email) } }, select: { email: true } })
    : [];
  const taken = new Set(existing.map((c) => c.email));
  const rows = parsed.valid.filter((r) => {
    if (!taken.has(r.email)) return true;
    rejected.push({ row: r.row, name: r.name, email: r.email, errors: ['A candidate with this email already exists for this job'] });
    return false;
  });
  rejected.sort((a, b) => a.row - b.row);

  if (input.dryRun || rows.length === 0) {
    return { dryRun: input.dryRun, validCount: rows.length, created: [], rejected, createdJob: null };
  }

  const codes = await allocateCodes(rows.length);
  const hashes: string[] = [];
  for (const r of rows) hashes.push(await bcrypt.hash(r.dobPassword, 10));

  let jobId = input.jobId;
  let createdJob: ImportResult['createdJob'] = null;
  if (!jobId && input.newJob) {
    const preset = getPreset(input.newJob.tier);
    const job = await createJob({ ...input.newJob, resultMode: preset.resultMode, retakePolicy: 'NONE' }, input.adminId);
    jobId = job.id;
    createdJob = { id: job.id, title: input.newJob.title };
  }

  try {
    await prisma.candidate.createMany({
      data: rows.map((r, i) => ({
        candidateCode: codes[i],
        name: r.name,
        email: r.email,
        dobHash: hashes[i],
        jobId: jobId as string,
      })),
    });
  } catch (e) {
    if (createdJob) await prisma.job.delete({ where: { id: createdJob.id } }).catch(() => undefined); // do not leave an empty job behind
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      throw err.conflict('Another import added the same candidates at the same time. Try again.', 'IMPORT_CONFLICT');
    }
    throw e;
  }

  await audit({
    actorType: 'ADMIN',
    actorId: input.adminId,
    action: 'CANDIDATES_IMPORTED',
    entity: 'Job',
    entityId: jobId as string,
    meta: { created: rows.length, rejected: rejected.length, newJob: Boolean(createdJob) },
  });

  return {
    dryRun: false,
    validCount: rows.length,
    created: rows.map((r, i) => ({ row: r.row, candidateCode: codes[i], name: r.name, email: r.email })),
    rejected,
    createdJob,
  };
}

export async function listCandidates(jobId?: string) {
  const rows = await prisma.candidate.findMany({
    where: jobId ? { jobId } : undefined,
    orderBy: { createdAt: 'desc' },
    take: 500,
    select: {
      id: true,
      candidateCode: true,
      name: true,
      email: true,
      status: true,
      lockedUntil: true,
      lastLoginAt: true,
      createdAt: true,
      job: { select: { id: true, title: true } },
      result: { select: { finalDecision: true } },
      // Rounds submitted but not fully graded yet (typed answers waiting for the AI).
      attempts: { where: { status: { in: ['SUBMITTED', 'AUTO_SUBMITTED'] } }, select: { roundType: true } },
      ...RESUME_SELECT,
    },
  });
  // The storage key stays on the server; the browser only gets a summary.
  return rows.map(({ resumePath, resumeUploadedAt, resumeParsed, resumeParsedAt, resumeParseError, attempts, result, ...rest }) => ({
    ...rest,
    finalDecision: result?.finalDecision ?? null,
    ungradedRounds: attempts.map((a) => a.roundType),
    resume: toResumeSummary({ resumePath, resumeUploadedAt, resumeParsed, resumeParsedAt, resumeParseError }),
  }));
}

/**
 * Edits a candidate. A new date of birth replaces the password hash, clears any lock and signs the candidate out
 * (their old session stops working). The audit log records which fields changed, never the values.
 */
export async function updateCandidate(id: string, patch: UpdateCandidateInput, adminId: string) {
  const existing = await prisma.candidate.findUnique({ where: { id }, select: { id: true, candidateCode: true } });
  if (!existing) throw err.notFound('Candidate not found', 'CANDIDATE_NOT_FOUND');

  const data: Prisma.CandidateUpdateInput = {};
  const fields: string[] = [];
  if (patch.name !== undefined) {
    data.name = patch.name;
    fields.push('name');
  }
  if (patch.email !== undefined) {
    data.email = patch.email;
    fields.push('email');
  }
  if (patch.dob) {
    const dob = parseDob(patch.dob);
    if (!dob.ok) throw err.badRequest(dob.reason, 'INVALID_DOB');
    data.dobHash = await bcrypt.hash(dob.password, 10);
    data.sessionId = null;
    data.failedLoginCount = 0;
    data.lockedUntil = null;
    fields.push('dob');
  }
  if (patch.unlock) {
    data.failedLoginCount = 0;
    data.lockedUntil = null;
    fields.push('unlock');
  }
  if (fields.length === 0) throw err.badRequest('Nothing to change', 'NOTHING_TO_CHANGE');

  let updated;
  try {
    updated = await prisma.candidate.update({ where: { id }, data, select: { id: true, name: true, email: true, candidateCode: true } });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      throw err.conflict('Another candidate for this job already uses that email.', 'EMAIL_TAKEN');
    }
    throw e;
  }

  await audit({ actorType: 'ADMIN', actorId: adminId, action: 'CANDIDATE_UPDATED', entity: 'Candidate', entityId: id, meta: { candidateCode: existing.candidateCode, fields } });
  return updated;
}
