import { z } from 'zod';
import { audit } from '@/lib/audit';
import { prisma } from '@/lib/db';
import { err } from '@/lib/http';
import {
  getPreset,
  jobFieldsSchema,
  pipelineSchema,
  pipelineStepSchema,
  type PipelineStep,
} from '@/lib/pipeline';

export const createJobSchema = jobFieldsSchema.extend({ steps: z.array(pipelineStepSchema).optional() });
export const updateJobSchema = jobFieldsSchema.partial();
export const savePipelineSchema = pipelineSchema;

/** Fields that cannot change once any candidate has started an attempt; clone the job instead. */
const LOCKED_AFTER_START = ['jdText', 'requiredSkills', 'tier', 'resultMode'] as const;

export async function jobHasStartedAttempts(jobId: string): Promise<boolean> {
  return (await prisma.attempt.count({ where: { candidate: { jobId } } })) > 0;
}

export async function listJobs() {
  const [jobs, startedRows] = await Promise.all([
    prisma.job.findMany({
      orderBy: { createdAt: 'desc' },
      include: { rounds: { select: { enabled: true } }, _count: { select: { candidates: true } } },
    }),
    // Jobs where at least one candidate has started a round: their details are partly locked.
    prisma.job.findMany({ where: { candidates: { some: { attempts: { some: {} } } } }, select: { id: true } }),
  ]);
  const started = new Set(startedRows.map((j) => j.id));
  return jobs.map((j) => ({
    id: j.id,
    title: j.title,
    jdText: j.jdText,
    requiredSkills: j.requiredSkills,
    retakePolicy: j.retakePolicy,
    tier: j.tier,
    resultMode: j.resultMode,
    createdAt: j.createdAt,
    enabledRounds: j.rounds.filter((r) => r.enabled).length,
    candidateCount: j._count.candidates,
    started: started.has(j.id),
  }));
}

export async function getJob(id: string) {
  const job = await prisma.job.findUnique({
    where: { id },
    include: { rounds: { orderBy: { position: 'asc' } }, _count: { select: { candidates: true } } },
  });
  if (!job) throw err.notFound('Job not found', 'JOB_NOT_FOUND');
  const started = await jobHasStartedAttempts(id);
  return { ...job, started, candidateCount: job._count.candidates };
}

export type JobDetail = Awaited<ReturnType<typeof getJob>>;

function toRoundData(steps: PipelineStep[]) {
  return steps.map((s) => ({
    roundType: s.roundType,
    position: s.position,
    enabled: s.enabled,
    cutoffPercent: s.cutoffPercent,
    weight: s.weight,
    durationMinutes: s.durationMinutes,
    questionCount: s.questionCount,
    difficulty: s.difficulty,
    cutoffMode: s.cutoffMode,
    proctoringLevel: s.proctoringLevel,
    maxTabSwitches: s.maxTabSwitches,
    blockPaste: s.blockPaste,
    required: s.required,
    humanScored: s.humanScored,
  }));
}

export async function createJob(input: z.infer<typeof createJobSchema>, adminId: string) {
  const { steps: provided, ...fields } = input;
  const steps = provided ?? getPreset(fields.tier).steps;
  const validated = pipelineSchema.parse({ steps }); // same rules as the pipeline endpoint

  const job = await prisma.job.create({
    data: { ...fields, rounds: { create: toRoundData(validated.steps) } },
    select: { id: true },
  });
  await audit({ actorType: 'ADMIN', actorId: adminId, action: 'JOB_CREATED', entity: 'Job', entityId: job.id, meta: { tier: fields.tier } });
  return job;
}

export async function updateJob(id: string, patch: z.infer<typeof updateJobSchema>, adminId: string) {
  const existing = await prisma.job.findUnique({ where: { id } });
  if (!existing) throw err.notFound('Job not found', 'JOB_NOT_FOUND');

  if (await jobHasStartedAttempts(id)) {
    const changed = LOCKED_AFTER_START.filter(
      (k) => patch[k] !== undefined && JSON.stringify(patch[k]) !== JSON.stringify(existing[k]),
    );
    if (changed.length > 0) {
      throw err.conflict(
        `Candidates have already started this job, so ${changed.join(', ')} can no longer be changed. Clone the job to make changes.`,
        'JOB_LOCKED',
      );
    }
  }

  await prisma.job.update({ where: { id }, data: patch });
  await audit({ actorType: 'ADMIN', actorId: adminId, action: 'JOB_UPDATED', entity: 'Job', entityId: id, meta: { fields: Object.keys(patch) } });
}

export async function savePipeline(jobId: string, steps: PipelineStep[], adminId: string) {
  const job = await prisma.job.findUnique({ where: { id: jobId }, select: { id: true } });
  if (!job) throw err.notFound('Job not found', 'JOB_NOT_FOUND');
  if (await jobHasStartedAttempts(jobId)) {
    throw err.conflict('Candidates have already started this job. Clone the job to change its pipeline.', 'PIPELINE_LOCKED');
  }

  await prisma.$transaction([
    prisma.roundConfig.deleteMany({ where: { jobId } }),
    prisma.roundConfig.createMany({ data: toRoundData(steps).map((s) => ({ ...s, jobId })) }),
  ]);
  await audit({
    actorType: 'ADMIN',
    actorId: adminId,
    action: 'PIPELINE_UPDATED',
    entity: 'Job',
    entityId: jobId,
    meta: { rounds: steps.filter((s) => s.enabled).map((s) => s.roundType) },
  });
}

export async function cloneJob(id: string, adminId: string) {
  const source = await prisma.job.findUnique({ where: { id }, include: { rounds: { orderBy: { position: 'asc' } } } });
  if (!source) throw err.notFound('Job not found', 'JOB_NOT_FOUND');

  const copy = await prisma.job.create({
    data: {
      title: `${source.title} (copy)`.slice(0, 140),
      jdText: source.jdText,
      requiredSkills: source.requiredSkills,
      tier: source.tier,
      resultMode: source.resultMode,
      retakePolicy: source.retakePolicy,
      clonedFromId: source.id,
      rounds: {
        create: source.rounds.map((r) => ({
          roundType: r.roundType,
          position: r.position,
          enabled: r.enabled,
          cutoffPercent: r.cutoffPercent,
          weight: r.weight,
          durationMinutes: r.durationMinutes,
          questionCount: r.questionCount,
          difficulty: r.difficulty,
          cutoffMode: r.cutoffMode,
          proctoringLevel: r.proctoringLevel,
          maxTabSwitches: r.maxTabSwitches,
          blockPaste: r.blockPaste,
          required: r.required,
          humanScored: r.humanScored,
        })),
      },
    },
    select: { id: true },
  });
  await audit({ actorType: 'ADMIN', actorId: adminId, action: 'JOB_CLONED', entity: 'Job', entityId: copy.id, meta: { sourceId: id } });
  return copy;
}
