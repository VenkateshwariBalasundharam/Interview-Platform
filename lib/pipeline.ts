// Pipeline definitions, presets and validation. Pure and client-safe (no server imports) so the
// admin editor and the API run exactly the same rules.
import { z } from 'zod';

export const ROUND_TYPES = ['ASSESSMENT', 'TECHNICAL', 'CODING', 'SYSTEM_DESIGN', 'SCENARIO', 'HR', 'MANAGER'] as const;
export const DIFFICULTIES = ['EASY', 'MEDIUM', 'HARD'] as const;
export const CUTOFF_MODES = ['DISQUALIFY', 'FLAG_FOR_REVIEW'] as const;
/** New jobs end a proctored round at this many tab switches. Admins can change or clear it per round. */
export const DEFAULT_MAX_TAB_SWITCHES = 3;

export const PROCTORING_LEVELS = ['OFF', 'PRESENCE', 'IDENTITY'] as const;
export const RESULT_MODES = ['AUTO_SUGGEST', 'ALWAYS_HUMAN_REVIEW'] as const;
export const RETAKE_POLICIES = ['NONE', 'ADMIN_GRANTED'] as const;
export const TIERS = ['FRESHER', 'MID', 'SENIOR'] as const;

export type RoundType = (typeof ROUND_TYPES)[number];
export type Difficulty = (typeof DIFFICULTIES)[number];
export type CutoffMode = (typeof CUTOFF_MODES)[number];
export type ProctoringLevel = (typeof PROCTORING_LEVELS)[number];
export type ResultMode = (typeof RESULT_MODES)[number];
export type RetakePolicy = (typeof RETAKE_POLICIES)[number];
export type Tier = (typeof TIERS)[number];

export const MAX_STEPS = 7;

export const ROUND_LIBRARY: Record<RoundType, { label: string; description: string; gradedBy: string; humanScored: boolean }> = {
  ASSESSMENT: { label: 'Assessment', description: 'MCQs from the JD and required skills (aptitude, concepts, domain basics)', gradedBy: 'Auto', humanScored: false },
  TECHNICAL: { label: 'Technical', description: 'MCQs and short answers built from the candidate’s resume skills', gradedBy: 'MCQ auto, short answers by AI', humanScored: false },
  CODING: { label: 'Coding', description: 'Problems from the curated bank, run and submitted through Judge0', gradedBy: 'Hidden tests passed / total', humanScored: false },
  SYSTEM_DESIGN: { label: 'System design', description: 'Written architecture and design questions', gradedBy: 'AI rubric', humanScored: false },
  SCENARIO: { label: 'Scenario', description: 'Written case, leadership and decision scenarios', gradedBy: 'AI rubric', humanScored: false },
  HR: { label: 'HR', description: 'Questions from resume projects and the JD, with a job-fit summary', gradedBy: 'AI rubric', humanScored: false },
  MANAGER: { label: 'Manager', description: 'Live interview outside the platform', gradedBy: 'Admin enters score and notes', humanScored: true },
};

// ───────────────────────── Schemas ─────────────────────────

export const pipelineStepSchema = z.object({
  roundType: z.enum(ROUND_TYPES),
  position: z.number().int().min(1).max(MAX_STEPS),
  enabled: z.boolean(),
  cutoffPercent: z.number().int().min(0).max(100),
  weight: z.number().int().min(0).max(100),
  durationMinutes: z.number().int().min(1).max(240),
  questionCount: z.number().int().min(0).max(60),
  difficulty: z.enum(DIFFICULTIES),
  cutoffMode: z.enum(CUTOFF_MODES),
  proctoringLevel: z.enum(PROCTORING_LEVELS),
  /** Tab switches allowed before the round ends automatically. 0 = no limit. */
  maxTabSwitches: z.number().int().min(0).max(20).default(0),
  /** Block pasting into the exam. Attempts are still recorded for the admin. */
  blockPaste: z.boolean().default(false),
  required: z.boolean(),
  humanScored: z.boolean(),
});

export type PipelineStep = z.infer<typeof pipelineStepSchema>;

export interface PipelineIssue {
  path: (string | number)[];
  message: string;
}

/** Cross-step rules. Returns an empty array when the pipeline is valid. */
export function validatePipelineSteps(steps: PipelineStep[]): PipelineIssue[] {
  const issues: PipelineIssue[] = [];

  if (steps.length < 1) issues.push({ path: ['steps'], message: 'Add at least one round' });
  if (steps.length > MAX_STEPS) issues.push({ path: ['steps'], message: `A pipeline can have at most ${MAX_STEPS} rounds` });

  const enabled = steps.filter((s) => s.enabled);
  if (enabled.length < 1) issues.push({ path: ['steps'], message: 'At least one round must be enabled' });

  const sorted = [...steps].sort((a, b) => a.position - b.position);
  sorted.forEach((s, i) => {
    if (s.position !== i + 1) {
      issues.push({ path: ['steps', i, 'position'], message: 'Positions must be contiguous, starting at 1, with no duplicates' });
    }
  });

  const seen = new Set<RoundType>();
  steps.forEach((s, i) => {
    if (seen.has(s.roundType)) {
      issues.push({ path: ['steps', i, 'roundType'], message: `${ROUND_LIBRARY[s.roundType].label} appears more than once` });
    }
    seen.add(s.roundType);

    const shouldBeHuman = ROUND_LIBRARY[s.roundType].humanScored;
    if (s.humanScored !== shouldBeHuman) {
      issues.push({
        path: ['steps', i, 'humanScored'],
        message: shouldBeHuman ? 'Manager rounds are human scored' : `${ROUND_LIBRARY[s.roundType].label} cannot be human scored`,
      });
    }
    if (s.roundType !== 'MANAGER' && s.questionCount < 1) {
      issues.push({ path: ['steps', i, 'questionCount'], message: 'Question count must be at least 1' });
    }
  });

  const total = enabled.reduce((sum, s) => sum + s.weight, 0);
  if (enabled.length > 0 && total !== 100) {
    issues.push({ path: ['steps'], message: `Weights of enabled rounds must total 100 (currently ${total})` });
  }

  if (enabled.length > 0 && !enabled.some((s) => s.required)) {
    issues.push({ path: ['steps'], message: 'At least one enabled round must be required' });
  }

  const manager = sorted.findIndex((s) => s.roundType === 'MANAGER');
  if (manager !== -1 && manager !== sorted.length - 1) {
    issues.push({ path: ['steps', manager, 'roundType'], message: 'The Manager round must be last' });
  }

  return issues;
}

export const pipelineSchema = z
  .object({ steps: z.array(pipelineStepSchema).min(1, 'Add at least one round').max(MAX_STEPS) })
  .superRefine((value, ctx) => {
    for (const issue of validatePipelineSteps(value.steps)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: issue.path, message: issue.message });
    }
  });

export const jobFieldsSchema = z.object({
  title: z.string().trim().min(3).max(140),
  jdText: z.string().trim().min(20, 'Paste the job description (at least 20 characters)').max(20000),
  requiredSkills: z.array(z.string().trim().min(1).max(60)).min(1, 'Add at least one required skill').max(30),
  tier: z.enum(TIERS),
  resultMode: z.enum(RESULT_MODES),
  retakePolicy: z.enum(RETAKE_POLICIES),
});

export type JobFields = z.infer<typeof jobFieldsSchema>;

// ───────────────────────── Defaults & presets ─────────────────────────

export const DEFAULT_CUTOFFS: Record<RoundType, number> = {
  ASSESSMENT: 60,
  TECHNICAL: 60,
  CODING: 50,
  SYSTEM_DESIGN: 55,
  SCENARIO: 55,
  HR: 50,
  MANAGER: 0,
};

const DEFAULT_DURATION: Record<RoundType, number> = {
  ASSESSMENT: 30, TECHNICAL: 40, CODING: 60, SYSTEM_DESIGN: 60, SCENARIO: 45, HR: 30, MANAGER: 30,
};
const DEFAULT_QUESTIONS: Record<RoundType, number> = {
  ASSESSMENT: 25, TECHNICAL: 15, CODING: 2, SYSTEM_DESIGN: 2, SCENARIO: 3, HR: 6, MANAGER: 0,
};

/** A sensible starting step for a round type when the admin adds it manually. Weight starts at 0. */
export function defaultStep(roundType: RoundType, position: number): PipelineStep {
  return {
    roundType,
    position,
    enabled: true,
    cutoffPercent: DEFAULT_CUTOFFS[roundType],
    weight: 0,
    durationMinutes: DEFAULT_DURATION[roundType],
    questionCount: DEFAULT_QUESTIONS[roundType],
    difficulty: 'MEDIUM',
    cutoffMode: roundType === 'MANAGER' ? 'FLAG_FOR_REVIEW' : 'DISQUALIFY',
    proctoringLevel: roundType === 'MANAGER' ? 'OFF' : 'PRESENCE',
    maxTabSwitches: roundType === 'MANAGER' ? 0 : DEFAULT_MAX_TAB_SWITCHES,
    blockPaste: roundType !== 'MANAGER',
    required: true,
    humanScored: ROUND_LIBRARY[roundType].humanScored,
  };
}

type StepOverride = Partial<Omit<PipelineStep, 'roundType' | 'position'>>;

function build(specs: [RoundType, StepOverride][]): PipelineStep[] {
  return specs.map(([roundType, override], i) => ({ ...defaultStep(roundType, i + 1), ...override }));
}

const AUTO_FOUR = (difficulty: Difficulty, hrDifficulty: Difficulty): [RoundType, StepOverride][] => [
  ['ASSESSMENT', { weight: 20, difficulty }],
  ['CODING', { weight: 30, difficulty }],
  ['TECHNICAL', { weight: 30, difficulty }],
  ['HR', { weight: 20, difficulty: hrDifficulty }],
];

export const TIER_PRESETS: Record<Tier, { label: string; resultMode: ResultMode; steps: () => PipelineStep[] }> = {
  FRESHER: {
    label: 'Fresher (0–2 yrs)',
    resultMode: 'AUTO_SUGGEST',
    steps: () => build(AUTO_FOUR('EASY', 'MEDIUM')),
  },
  MID: {
    label: 'Mid (2–4 yrs)',
    resultMode: 'AUTO_SUGGEST',
    steps: () => build(AUTO_FOUR('MEDIUM', 'MEDIUM')),
  },
  SENIOR: {
    label: 'Senior (5+ yrs)',
    resultMode: 'ALWAYS_HUMAN_REVIEW',
    steps: () =>
      build([
        ['TECHNICAL', { weight: 20, difficulty: 'HARD', cutoffMode: 'FLAG_FOR_REVIEW', proctoringLevel: 'IDENTITY' }],
        ['CODING', { weight: 25, difficulty: 'HARD', cutoffPercent: 55, cutoffMode: 'DISQUALIFY', proctoringLevel: 'IDENTITY', durationMinutes: 90, questionCount: 3 }],
        ['SYSTEM_DESIGN', { weight: 20, difficulty: 'HARD', cutoffMode: 'FLAG_FOR_REVIEW', proctoringLevel: 'IDENTITY' }],
        ['SCENARIO', { weight: 10, cutoffMode: 'FLAG_FOR_REVIEW', proctoringLevel: 'IDENTITY' }],
        ['HR', { weight: 10, cutoffMode: 'FLAG_FOR_REVIEW', proctoringLevel: 'IDENTITY' }],
        ['MANAGER', { weight: 15, cutoffMode: 'FLAG_FOR_REVIEW', proctoringLevel: 'OFF' }],
      ]),
  },
};

export function getPreset(tier: Tier): { resultMode: ResultMode; steps: PipelineStep[] } {
  const preset = TIER_PRESETS[tier];
  return { resultMode: preset.resultMode, steps: preset.steps() };
}

/** Renumbers positions 1..n in array order; the editor calls this before saving. */
export function withSequentialPositions(steps: PipelineStep[]): PipelineStep[] {
  return steps.map((s, i) => ({ ...s, position: i + 1 }));
}
