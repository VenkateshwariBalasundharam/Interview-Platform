// Database operations for job-level question sets (server only).
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { audit } from '@/lib/audit';
import { prisma } from '@/lib/db';
import { err } from '@/lib/http';
import { jobHasStartedAttempts } from '@/lib/jobs';
import { ROUND_LIBRARY, type Difficulty } from '@/lib/pipeline';
import { generateQuestions } from '@/lib/question-generation';
import {
  MAX_SET_SIZE,
  ROUND_KINDS,
  fieldsSchemaFor,
  isGeneratedRound,
  rubricSchema,
  validateSetForApproval,
  type AdminQuestion,
  type GeneratedRound,
  type NewQuestion,
  type QuestionKind,
  type SetAction,
  type SetStatus,
} from '@/lib/questions';

const optionsSchema = z.array(z.string());

function toAdminQuestion(q: {
  id: string;
  kind: QuestionKind;
  position: number;
  prompt: string;
  options: Prisma.JsonValue | null;
  correctIndex: number | null;
  rubric: Prisma.JsonValue | null;
  points: number;
  difficulty: Difficulty;
}): AdminQuestion {
  const options = optionsSchema.safeParse(q.options);
  const rubric = rubricSchema.safeParse(q.rubric);
  return {
    id: q.id,
    kind: q.kind,
    position: q.position,
    prompt: q.prompt,
    options: options.success ? options.data : null,
    correctIndex: q.correctIndex,
    rubric: rubric.success ? rubric.data : null,
    points: q.points,
    difficulty: q.difficulty,
  };
}

function toRow(q: NewQuestion, position: number) {
  return q.kind === 'MCQ'
    ? { kind: q.kind, position, prompt: q.prompt, options: q.options, correctIndex: q.correctIndex, points: q.points, difficulty: q.difficulty }
    : { kind: q.kind, position, prompt: q.prompt, rubric: q.rubric as Prisma.InputJsonValue, points: q.points, difficulty: q.difficulty };
}

async function assertJobNotStarted(jobId: string) {
  if (await jobHasStartedAttempts(jobId)) {
    throw err.conflict(
      'Candidates have already started this job, so its questions can no longer be changed. Clone the job to make changes.',
      'QUESTIONS_LOCKED',
    );
  }
}

function assertDraft(status: SetStatus) {
  if (status !== 'DRAFT') {
    throw err.conflict(
      status === 'LOCKED' ? 'This question set is locked and cannot be changed.' : 'Reopen the question set to make changes.',
      'SET_NOT_DRAFT',
    );
  }
}

// ───────────────────────── Reading ─────────────────────────

export interface RoundQuestionSet {
  roundType: GeneratedRound;
  label: string;
  enabled: boolean;
  questionCount: number;
  difficulty: Difficulty;
  set: null | { id: string; status: SetStatus; version: number; lockedAt: string | null; questions: AdminQuestion[] };
}

export async function getQuestionOverview(jobId: string) {
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    include: {
      rounds: { orderBy: { position: 'asc' } },
      questionSets: { where: { candidateId: null }, orderBy: { createdAt: 'desc' }, include: { questions: { orderBy: { position: 'asc' } } } },
    },
  });
  if (!job) throw err.notFound('Job not found', 'JOB_NOT_FOUND');

  const rounds: RoundQuestionSet[] = [];
  const notGenerated: string[] = [];
  for (const r of job.rounds) {
    if (!isGeneratedRound(r.roundType)) {
      notGenerated.push(ROUND_LIBRARY[r.roundType].label);
      continue;
    }
    const set = job.questionSets.find((s) => s.roundType === r.roundType) ?? null; // newest first
    rounds.push({
      roundType: r.roundType,
      label: ROUND_LIBRARY[r.roundType].label,
      enabled: r.enabled,
      questionCount: r.questionCount,
      difficulty: r.difficulty,
      set: set && {
        id: set.id,
        status: set.status,
        version: set.version,
        lockedAt: set.lockedAt ? set.lockedAt.toISOString() : null,
        questions: set.questions.map(toAdminQuestion),
      },
    });
  }
  return { job: { id: job.id, title: job.title }, started: await jobHasStartedAttempts(jobId), rounds, notGenerated };
}

// ───────────────────────── Generating ─────────────────────────

export async function generateSet(jobId: string, roundType: GeneratedRound, adminId: string) {
  const job = await prisma.job.findUnique({ where: { id: jobId }, include: { rounds: true } });
  if (!job) throw err.notFound('Job not found', 'JOB_NOT_FOUND');
  const label = ROUND_LIBRARY[roundType].label;
  const round = job.rounds.find((r) => r.roundType === roundType);
  if (!round) throw err.notFound(`This job has no ${label} round. Add it to the pipeline first.`, 'ROUND_NOT_FOUND');
  await assertJobNotStarted(jobId);

  const existing = await prisma.questionSet.findFirst({ where: { jobId, roundType, candidateId: null }, orderBy: { createdAt: 'desc' } });
  if (existing) assertDraft(existing.status);

  // The slow part: runs before any database write so no transaction is held open while waiting on the model.
  const { questions, requested } = await generateQuestions({
    title: job.title,
    tier: job.tier,
    jdText: job.jdText,
    requiredSkills: job.requiredSkills,
    roundType,
    difficulty: round.difficulty,
    count: round.questionCount,
  });
  const rows = questions.map((q, i) => toRow(q, i + 1));

  const { setId, version } = await prisma.$transaction(
    async (tx) => {
      if (existing) {
        // The draft may have been approved while the model was working.
        const fresh = await tx.questionSet.findUnique({ where: { id: existing.id }, select: { status: true } });
        if (!fresh || fresh.status !== 'DRAFT') throw err.conflict('This question set changed while generating. Reload and try again.', 'SET_NOT_DRAFT');
        await tx.question.deleteMany({ where: { setId: existing.id } });
        const updated = await tx.questionSet.update({ where: { id: existing.id }, data: { version: { increment: 1 } }, select: { version: true } });
        await tx.question.createMany({ data: rows.map((r) => ({ ...r, setId: existing.id })) });
        return { setId: existing.id, version: updated.version };
      }
      const created = await tx.questionSet.create({ data: { jobId, roundType, questions: { create: rows } }, select: { id: true, version: true } });
      return { setId: created.id, version: created.version };
    },
    { timeout: 20_000 },
  );

  await audit({
    actorType: 'ADMIN',
    actorId: adminId,
    action: 'QUESTION_SET_GENERATED',
    entity: 'QuestionSet',
    entityId: setId,
    meta: { roundType, requested, created: questions.length, version },
  });
  return { setId, version, requested, created: questions.length };
}

// ───────────────────────── Editing ─────────────────────────

async function loadQuestion(id: string) {
  const question = await prisma.question.findUnique({ where: { id }, include: { set: { select: { id: true, jobId: true, status: true } } } });
  if (!question) throw err.notFound('Question not found', 'QUESTION_NOT_FOUND');
  return question;
}

export async function updateQuestion(id: string, body: unknown, adminId: string) {
  const question = await loadQuestion(id);
  assertDraft(question.set.status);
  await assertJobNotStarted(question.set.jobId);

  const fields = fieldsSchemaFor(question.kind).parse(body);
  const data =
    'options' in fields
      ? { prompt: fields.prompt, points: fields.points, difficulty: fields.difficulty, options: fields.options, correctIndex: fields.correctIndex }
      : { prompt: fields.prompt, points: fields.points, difficulty: fields.difficulty, rubric: fields.rubric as Prisma.InputJsonValue };
  await prisma.question.update({ where: { id }, data });
  await audit({ actorType: 'ADMIN', actorId: adminId, action: 'QUESTION_EDITED', entity: 'Question', entityId: id, meta: { setId: question.set.id } });
}

export async function deleteQuestion(id: string, adminId: string) {
  const question = await loadQuestion(id);
  assertDraft(question.set.status);
  await assertJobNotStarted(question.set.jobId);

  await prisma.question.delete({ where: { id } });
  const remaining = await prisma.question.findMany({ where: { setId: question.set.id }, orderBy: { position: 'asc' }, select: { id: true } });
  await prisma.$transaction(remaining.map((q, i) => prisma.question.update({ where: { id: q.id }, data: { position: i + 1 } })));
  await audit({ actorType: 'ADMIN', actorId: adminId, action: 'QUESTION_DELETED', entity: 'Question', entityId: id, meta: { setId: question.set.id } });
}

export async function addQuestion(setId: string, kind: QuestionKind, body: unknown, adminId: string) {
  const set = await prisma.questionSet.findUnique({ where: { id: setId }, include: { _count: { select: { questions: true } } } });
  if (!set) throw err.notFound('Question set not found', 'SET_NOT_FOUND');
  assertDraft(set.status);
  await assertJobNotStarted(set.jobId);

  if (!isGeneratedRound(set.roundType) || !(ROUND_KINDS[set.roundType] as readonly string[]).includes(kind)) {
    throw err.badRequest(`A ${ROUND_LIBRARY[set.roundType].label} round cannot contain ${kind} questions`, 'KIND_NOT_ALLOWED');
  }
  if (set._count.questions >= MAX_SET_SIZE) throw err.conflict(`A question set can hold at most ${MAX_SET_SIZE} questions`, 'SET_FULL');

  const fields = fieldsSchemaFor(kind).parse(body);
  const last = await prisma.question.aggregate({ where: { setId }, _max: { position: true } });
  const position = (last._max.position ?? 0) + 1;
  const row = toRow({ kind, ...fields } as NewQuestion, position);
  const created = await prisma.question.create({ data: { ...row, setId }, select: { id: true } });
  await audit({ actorType: 'ADMIN', actorId: adminId, action: 'QUESTION_ADDED', entity: 'Question', entityId: created.id, meta: { setId } });
  return created;
}

// ───────────────────────── Status ─────────────────────────

const TRANSITIONS: Record<SetAction, { from: SetStatus; to: SetStatus; audit: string }> = {
  approve: { from: 'DRAFT', to: 'APPROVED', audit: 'QUESTION_SET_APPROVED' },
  reopen: { from: 'APPROVED', to: 'DRAFT', audit: 'QUESTION_SET_REOPENED' },
  lock: { from: 'APPROVED', to: 'LOCKED', audit: 'QUESTION_SET_LOCKED' },
};

export async function transitionSet(setId: string, action: SetAction, adminId: string) {
  const set = await prisma.questionSet.findUnique({ where: { id: setId }, include: { questions: { orderBy: { position: 'asc' } } } });
  if (!set) throw err.notFound('Question set not found', 'SET_NOT_FOUND');
  const t = TRANSITIONS[action];
  if (set.status !== t.from) {
    throw err.conflict(`Only a ${t.from.toLowerCase()} set can be ${action === 'approve' ? 'approved' : action === 'reopen' ? 'reopened' : 'locked'}.`, 'INVALID_TRANSITION');
  }
  // Locking is always allowed (it only freezes things further); every other change needs a job nobody has started.
  if (action !== 'lock') await assertJobNotStarted(set.jobId);

  if (action === 'approve') {
    const round = await prisma.roundConfig.findFirst({ where: { jobId: set.jobId, roundType: set.roundType }, select: { questionCount: true } });
    const issues = validateSetForApproval(set.questions, round?.questionCount ?? 1);
    if (issues.length > 0) throw err.badRequest(issues.slice(0, 3).join('; '), 'SET_NOT_READY');
  }

  const result = await prisma.questionSet.updateMany({
    where: { id: setId, status: t.from },
    data: { status: t.to, lockedAt: action === 'lock' ? new Date() : action === 'reopen' ? null : undefined },
  });
  if (result.count === 0) throw err.conflict('This question set changed. Reload and try again.', 'INVALID_TRANSITION');

  await audit({ actorType: 'ADMIN', actorId: adminId, action: t.audit, entity: 'QuestionSet', entityId: setId, meta: { roundType: set.roundType } });
  return { id: setId, status: t.to };
}
