import { describe, expect, it } from 'vitest';
import {
  defaultStep, getPreset, pipelineSchema, validatePipelineSteps, withSequentialPositions,
  TIERS, type PipelineStep,
} from '@/lib/pipeline';

const fresher = () => getPreset('FRESHER').steps;
const senior = () => getPreset('SENIOR').steps;
const messages = (steps: PipelineStep[]) => validatePipelineSteps(steps).map((i) => i.message);

describe('tier presets', () => {
  it.each(TIERS)('%s preset passes full validation', (tier) => {
    expect(pipelineSchema.safeParse({ steps: getPreset(tier).steps }).success).toBe(true);
  });

  it('FRESHER: Assessment → Coding → Technical → HR with the default cutoffs', () => {
    const steps = fresher();
    expect(steps.map((s) => s.roundType)).toEqual(['ASSESSMENT', 'CODING', 'TECHNICAL', 'HR']);
    expect(steps.map((s) => s.cutoffPercent)).toEqual([60, 50, 60, 50]);
    expect(steps.every((s) => s.cutoffMode === 'DISQUALIFY')).toBe(true);
    expect(getPreset('FRESHER').resultMode).toBe('AUTO_SUGGEST');
  });

  it('MID has the same rounds as FRESHER with harder difficulty', () => {
    const mid = getPreset('MID').steps;
    expect(mid.map((s) => s.roundType)).toEqual(fresher().map((s) => s.roundType));
    expect(mid.find((s) => s.roundType === 'CODING')?.difficulty).toBe('MEDIUM');
    expect(fresher().find((s) => s.roundType === 'CODING')?.difficulty).toBe('EASY');
  });

  it('SENIOR: no assessment, manager last and human scored, review mode, identity proctoring', () => {
    const steps = senior();
    expect(steps.map((s) => s.roundType)).toEqual(['TECHNICAL', 'CODING', 'SYSTEM_DESIGN', 'SCENARIO', 'HR', 'MANAGER']);
    expect(steps.at(-1)?.humanScored).toBe(true);
    expect(steps.find((s) => s.roundType === 'CODING')).toMatchObject({ cutoffPercent: 55, difficulty: 'HARD' });
    expect(steps.find((s) => s.roundType === 'SYSTEM_DESIGN')?.cutoffPercent).toBe(55);
    expect(steps.find((s) => s.roundType === 'SCENARIO')?.cutoffPercent).toBe(55);
    expect(steps.filter((s) => ['TECHNICAL', 'SYSTEM_DESIGN', 'SCENARIO', 'HR'].includes(s.roundType)).every((s) => s.cutoffMode === 'FLAG_FOR_REVIEW')).toBe(true);
    expect(steps.filter((s) => s.roundType !== 'MANAGER').every((s) => s.proctoringLevel === 'IDENTITY')).toBe(true);
    expect(getPreset('SENIOR').resultMode).toBe('ALWAYS_HUMAN_REVIEW');
  });

  it('every preset weights enabled rounds to exactly 100', () => {
    for (const tier of TIERS) {
      expect(getPreset(tier).steps.reduce((sum, s) => sum + s.weight, 0)).toBe(100);
    }
  });
});

describe('pipeline validation', () => {
  it('rejects weights that do not total 100', () => {
    const steps = fresher();
    steps[0].weight = 25;
    expect(messages(steps).some((m) => m.includes('total 100'))).toBe(true);
  });

  it('counts only enabled steps toward the weight total', () => {
    const steps = fresher();
    steps[3] = { ...steps[3], enabled: false, weight: 0 };
    steps[0].weight = 40; // 40 + 30 + 30
    expect(validatePipelineSteps(steps)).toEqual([]);

    const disabledWithWeight = fresher();
    disabledWithWeight[3] = { ...disabledWithWeight[3], enabled: false }; // still weight 20, ignored
    expect(messages(disabledWithWeight).some((m) => m.includes('currently 80'))).toBe(true);
  });

  it('rejects a duplicate round type', () => {
    const steps = fresher();
    steps[3] = { ...steps[3], roundType: 'CODING' };
    expect(messages(steps).some((m) => m.includes('more than once'))).toBe(true);
  });

  it('rejects positions that are not contiguous from 1', () => {
    const gap = fresher().map((s, i) => ({ ...s, position: i === 3 ? 5 : s.position }));
    expect(messages(gap).some((m) => m.includes('contiguous'))).toBe(true);
    const offset = fresher().map((s) => ({ ...s, position: s.position + 1 }));
    expect(messages(offset).some((m) => m.includes('contiguous'))).toBe(true);
    const dup = fresher().map((s) => ({ ...s, position: Math.min(s.position, 2) }));
    expect(messages(dup).some((m) => m.includes('contiguous'))).toBe(true);
  });

  it('requires the Manager round to be last', () => {
    const steps = senior();
    const reordered = withSequentialPositions([steps[5], ...steps.slice(0, 5)]);
    expect(messages(reordered).some((m) => m.includes('Manager round must be last'))).toBe(true);
    expect(validatePipelineSteps(steps)).toEqual([]);
  });

  it('keeps humanScored true only for Manager', () => {
    const steps = senior();
    steps[5].humanScored = false;
    expect(messages(steps).some((m) => m.includes('human scored'))).toBe(true);
    const other = fresher();
    other[0].humanScored = true;
    expect(messages(other).some((m) => m.includes('cannot be human scored'))).toBe(true);
  });

  it('needs at least one enabled round and one enabled required round', () => {
    const none = fresher().map((s) => ({ ...s, enabled: false }));
    expect(messages(none).some((m) => m.includes('At least one round must be enabled'))).toBe(true);
    const optional = fresher().map((s) => ({ ...s, required: false }));
    expect(messages(optional).some((m) => m.includes('must be required'))).toBe(true);
  });

  it('allows at most 7 rounds and at least 1', () => {
    expect(pipelineSchema.safeParse({ steps: [] }).success).toBe(false);
    const eight = [...senior(), ...fresher().slice(0, 2)].map((s, i) => ({ ...s, position: i + 1 }));
    expect(pipelineSchema.safeParse({ steps: eight }).success).toBe(false);
  });

  it('requires a question count of at least 1 except for Manager', () => {
    const steps = fresher();
    steps[1].questionCount = 0;
    expect(messages(steps).some((m) => m.includes('at least 1'))).toBe(true);
    expect(validatePipelineSteps(senior())).toEqual([]); // Manager has 0 questions
  });

  it('rejects out-of-range numbers at the schema level', () => {
    const steps = fresher();
    steps[0].cutoffPercent = 120;
    expect(pipelineSchema.safeParse({ steps }).success).toBe(false);
  });
});

describe('helpers', () => {
  it('withSequentialPositions renumbers in array order', () => {
    const reordered = withSequentialPositions([fresher()[2], fresher()[0]]);
    expect(reordered.map((s) => s.position)).toEqual([1, 2]);
  });

  it('defaultStep uses the documented default cutoffs', () => {
    expect(defaultStep('ASSESSMENT', 1).cutoffPercent).toBe(60);
    expect(defaultStep('CODING', 1).cutoffPercent).toBe(50);
    expect(defaultStep('SYSTEM_DESIGN', 1).cutoffPercent).toBe(55);
    expect(defaultStep('MANAGER', 1)).toMatchObject({ humanScored: true, proctoringLevel: 'OFF' });
  });
});
