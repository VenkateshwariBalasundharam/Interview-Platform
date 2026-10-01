import { describe, expect, it } from 'vitest';
import {
  GENERATED_ROUNDS, ROUND_KINDS, assignFocus, dedupeQuestions, extractJson, fieldsSchemaFor, isGeneratedRound,
  mcqFieldsSchema, parseGeneratedQuestions, planKinds, shuffleMcq, splitBatches, validateSetForApproval,
  type StoredQuestion,
} from '@/lib/questions';

const mcq = (over: Record<string, unknown> = {}) => ({
  prompt: 'Which HTTP method is idempotent?',
  options: ['POST', 'PUT', 'PATCH', 'CONNECT'],
  correctIndex: 1,
  difficulty: 'EASY',
  ...over,
});
const open = (over: Record<string, unknown> = {}) => ({
  prompt: 'Design a URL shortener for a small team.',
  rubric: { keyPoints: ['Key generation', 'Storage choice'], sampleAnswer: 'Use a counter with base62 encoding and a key-value store.' },
  difficulty: 'MEDIUM',
  ...over,
});

describe('round rules', () => {
  it('only the five content rounds are generated; coding and manager are not', () => {
    expect([...GENERATED_ROUNDS]).toEqual(['ASSESSMENT', 'TECHNICAL', 'SYSTEM_DESIGN', 'SCENARIO', 'HR']);
    expect(isGeneratedRound('CODING')).toBe(false);
    expect(isGeneratedRound('MANAGER')).toBe(false);
    expect(isGeneratedRound('HR')).toBe(true);
  });

  it('assessment is MCQ only, technical mixes MCQ and short answer, the rest are written', () => {
    expect(ROUND_KINDS.ASSESSMENT).toEqual(['MCQ']);
    expect(ROUND_KINDS.TECHNICAL).toEqual(['MCQ', 'SHORT_ANSWER']);
    expect(ROUND_KINDS.SYSTEM_DESIGN).toEqual(['WRITTEN']);
    expect(ROUND_KINDS.SCENARIO).toEqual(['WRITTEN']);
    expect(ROUND_KINDS.HR).toEqual(['WRITTEN']);
  });

  it('planKinds gives the requested number of questions in the right mix', () => {
    expect(planKinds('ASSESSMENT', 25)).toHaveLength(25);
    expect(new Set(planKinds('ASSESSMENT', 25))).toEqual(new Set(['MCQ']));
    const tech = planKinds('TECHNICAL', 15);
    expect(tech.filter((k) => k === 'MCQ')).toHaveLength(9);
    expect(tech.filter((k) => k === 'SHORT_ANSWER')).toHaveLength(6);
    expect(planKinds('TECHNICAL', 10).filter((k) => k === 'MCQ')).toHaveLength(6);
    expect(planKinds('HR', 6)).toEqual(Array(6).fill('WRITTEN'));
    expect(planKinds('HR', 0)).toEqual([]);
  });
});

describe('question schemas', () => {
  it('accepts a valid MCQ and defaults points to 1', () => {
    const parsed = mcqFieldsSchema.parse(mcq());
    expect(parsed.points).toBe(1);
  });

  it.each([
    ['three options', mcq({ options: ['a', 'b', 'c'] })],
    ['duplicate options', mcq({ options: ['Same', 'same', 'x', 'y'] })],
    ['an empty option', mcq({ options: ['a', '', 'c', 'd'] })],
    ['correctIndex out of range', mcq({ correctIndex: 4 })],
    ['a too-short prompt', mcq({ prompt: 'Short?' })],
  ])('rejects an MCQ with %s', (_label, value) => {
    expect(mcqFieldsSchema.safeParse(value).success).toBe(false);
  });

  it('written and short-answer questions need a rubric with at least two key points', () => {
    expect(fieldsSchemaFor('WRITTEN').safeParse(open()).success).toBe(true);
    expect(fieldsSchemaFor('WRITTEN').safeParse(open({ rubric: { keyPoints: ['Only one'], sampleAnswer: 'A sample answer here.' } })).success).toBe(false);
    expect(fieldsSchemaFor('WRITTEN').safeParse({ prompt: 'A long enough prompt here', difficulty: 'EASY' }).success).toBe(false);
  });

  it('default points depend on the kind', () => {
    expect(fieldsSchemaFor('SHORT_ANSWER').parse(open()).points).toBe(2);
    expect(fieldsSchemaFor('WRITTEN').parse(open()).points).toBe(5);
  });
});

describe('extractJson', () => {
  it('reads plain JSON, fenced JSON and JSON after a preamble', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('Here you go:\n{"questions":[]}\nHope that helps.')).toEqual({ questions: [] });
  });
  it('throws when there is no JSON object or it is malformed', () => {
    expect(() => extractJson('no json here')).toThrow();
    expect(() => extractJson('{"a":')).toThrow();
  });
});

describe('parseGeneratedQuestions', () => {
  it('keeps valid questions and counts the rest as rejected', () => {
    const raw = { questions: [{ kind: 'MCQ', ...mcq() }, { kind: 'MCQ', ...mcq({ options: ['a'] }) }, 'nonsense', { kind: 'MCQ' }] };
    const { valid, rejected } = parseGeneratedQuestions(raw, 'ASSESSMENT', 'EASY');
    expect(valid).toHaveLength(1);
    expect(rejected).toBe(3);
  });

  it('rejects kinds the round does not allow', () => {
    const raw = { questions: [{ kind: 'WRITTEN', ...open() }] };
    expect(parseGeneratedQuestions(raw, 'ASSESSMENT', 'EASY').valid).toHaveLength(0);
    expect(parseGeneratedQuestions(raw, 'SCENARIO', 'EASY').valid).toHaveLength(1);
  });

  it('takes difficulty and points from us, not the model', () => {
    const raw = { questions: [{ kind: 'MCQ', ...mcq({ difficulty: 'HARD', points: 20 }) }] };
    const { valid } = parseGeneratedQuestions(raw, 'ASSESSMENT', 'EASY');
    expect(valid[0]).toMatchObject({ difficulty: 'EASY', points: 1 });
  });

  it('throws when the reply has no questions array', () => {
    expect(() => parseGeneratedQuestions({ foo: 1 }, 'HR', 'EASY')).toThrow();
    expect(() => parseGeneratedQuestions(null, 'HR', 'EASY')).toThrow();
  });
});

describe('dedupeQuestions', () => {
  it('ignores case and punctuation, and honours existing prompts', () => {
    const items = [{ prompt: 'What is a closure?' }, { prompt: 'what is a CLOSURE' }, { prompt: 'Explain hoisting.' }];
    expect(dedupeQuestions(items)).toHaveLength(2);
    expect(dedupeQuestions(items, ['Explain hoisting'])).toHaveLength(1);
  });
});

describe('shuffleMcq', () => {
  const base = { options: ['a', 'b', 'c', 'd'], correctIndex: 0 };

  it('is deterministic for a given rng and remaps the answer key', () => {
    expect(shuffleMcq(base, () => 0)).toEqual({ options: ['b', 'c', 'd', 'a'], correctIndex: 3 });
  });

  it('always keeps the same option marked correct', () => {
    let seed = 7;
    const rng = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    for (let i = 0; i < 200; i++) {
      const correctIndex = i % 4;
      const out = shuffleMcq({ options: ['a', 'b', 'c', 'd'], correctIndex }, rng);
      expect(out.options[out.correctIndex]).toBe(['a', 'b', 'c', 'd'][correctIndex]);
      expect([...out.options].sort()).toEqual(['a', 'b', 'c', 'd']);
    }
  });

  it('does not mutate its input', () => {
    shuffleMcq(base, () => 0);
    expect(base.options).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('batching', () => {
  it('splits into the fewest even batches', () => {
    expect(splitBatches(25, 10)).toEqual([9, 8, 8]);
    expect(splitBatches(10, 10)).toEqual([10]);
    expect(splitBatches(11, 10)).toEqual([6, 5]);
    expect(splitBatches(1, 10)).toEqual([1]);
    expect(splitBatches(0, 10)).toEqual([]);
    for (const n of [7, 25, 33, 60]) expect(splitBatches(n, 10).reduce((a, b) => a + b, 0)).toBe(n);
  });

  it('spreads skills across batches and falls back to all skills', () => {
    expect(assignFocus(['s0', 's1', 's2'], 2)).toEqual([['s0', 's2'], ['s1']]);
    expect(assignFocus(['s0'], 3)).toEqual([['s0'], ['s0'], ['s0']]);
  });
});

describe('validateSetForApproval', () => {
  const stored = (over: Partial<StoredQuestion> = {}): StoredQuestion => ({
    kind: 'MCQ', prompt: 'Which HTTP method is idempotent?', options: ['POST', 'PUT', 'PATCH', 'CONNECT'],
    correctIndex: 1, rubric: null, points: 1, difficulty: 'EASY', ...over,
  });

  it('passes when there are enough valid questions', () => {
    expect(validateSetForApproval([stored(), stored({ prompt: 'Another valid question here?' })], 2)).toEqual([]);
  });

  it('reports a shortfall', () => {
    expect(validateSetForApproval([stored()], 3)[0]).toMatch(/at least 3 questions \(currently 1\)/);
  });

  it('flags a broken question by its number', () => {
    const issues = validateSetForApproval([stored(), stored({ options: ['only', 'two'] })], 2);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatch(/^Question 2:/);
  });

  it('validates written questions against their rubric', () => {
    const written = stored({ kind: 'WRITTEN', options: null, correctIndex: null, rubric: null, points: 5 });
    expect(validateSetForApproval([written], 1)[0]).toMatch(/^Question 1:/);
  });
});
