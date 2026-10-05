import { describe, expect, it } from 'vitest';
import {
  approvedNextRound,
  candidateOutcome,
  isSelectedNotice,
  type RoundState,
  blockedReason,
  computeDeadline,
  computeRoundStates,
  decideOutcome,
  effectiveCutoffMode,
  gradeMcqAttempt,
  isAiGradedRound,
  isRunnableRound,
  isPastDeadline,
  isPastGrace,
  orderQuestions,
  readChoice,
  readText,
  scoreWithoutAi,
  secondsLeft,
  seededShuffle,
  toCandidateQuestion,
  totalScores,
} from '@/lib/round-engine';

describe('seededShuffle', () => {
  it('is deterministic for the same seed', () => {
    const items = ['a', 'b', 'c', 'd', 'e'];
    expect(seededShuffle(items, 'seed-1')).toEqual(seededShuffle(items, 'seed-1'));
  });

  it('is a permutation of the input', () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8];
    const out = seededShuffle(items, 'candidate-42');
    expect([...out].sort((a, b) => a - b)).toEqual(items);
  });

  it('generally differs across seeds', () => {
    const items = Array.from({ length: 10 }, (_, i) => i);
    const a = seededShuffle(items, 'candidate-1');
    const b = seededShuffle(items, 'candidate-2');
    expect(a).not.toEqual(b);
  });

  it('does not mutate the input array', () => {
    const items = [1, 2, 3];
    const copy = [...items];
    seededShuffle(items, 'x');
    expect(items).toEqual(copy);
  });
});

describe('orderQuestions', () => {
  it('shuffles ASSESSMENT with a seed', () => {
    const items = ['q1', 'q2', 'q3', 'q4', 'q5'];
    const out = orderQuestions('ASSESSMENT', items, 'seed-a');
    expect([...out].sort()).toEqual([...items].sort());
  });

  it('keeps position order when there is no seed', () => {
    const items = ['q1', 'q2', 'q3'];
    expect(orderQuestions('ASSESSMENT', items, null)).toEqual(items);
  });

  it('shuffles TECHNICAL with a seed (same questions, different order per candidate)', () => {
    const items = Array.from({ length: 12 }, (_, i) => `q${i}`);
    const out = orderQuestions('TECHNICAL', items, 'seed-a');
    expect([...out].sort()).toEqual([...items].sort());
    expect(out).not.toEqual(items);
  });

  it('keeps position order for a round that is not in SHUFFLED_ROUNDS', () => {
    const items = ['q1', 'q2', 'q3'];
    expect(orderQuestions('SYSTEM_DESIGN', items, 'seed-a')).toEqual(items);
    expect(orderQuestions('HR', items, 'seed-a')).toEqual(items);
  });
});

describe('timer', () => {
  it('computes the deadline from start time plus duration', () => {
    const start = new Date('2026-01-01T00:00:00.000Z');
    expect(computeDeadline(start, 30)).toEqual(new Date('2026-01-01T00:30:00.000Z'));
  });

  it('secondsLeft rounds up and never goes below zero', () => {
    const deadline = new Date('2026-01-01T00:00:10.000Z');
    expect(secondsLeft(deadline, new Date('2026-01-01T00:00:00.000Z'))).toBe(10);
    expect(secondsLeft(deadline, new Date('2026-01-01T00:00:09.200Z'))).toBe(1);
    expect(secondsLeft(deadline, new Date('2026-01-01T00:00:15.000Z'))).toBe(0);
  });

  it('isPastDeadline is true only strictly after the deadline', () => {
    const deadline = new Date('2026-01-01T00:00:00.000Z');
    expect(isPastDeadline(deadline, deadline)).toBe(false);
    expect(isPastDeadline(deadline, new Date(deadline.getTime() + 1))).toBe(true);
  });

  it('isPastGrace allows the configured grace window past the deadline', () => {
    const deadline = new Date('2026-01-01T00:00:00.000Z');
    expect(isPastGrace(deadline, new Date(deadline.getTime() + 15_000), 15)).toBe(false);
    expect(isPastGrace(deadline, new Date(deadline.getTime() + 15_001), 15)).toBe(true);
  });
});

describe('readChoice', () => {
  it('reads a valid choice', () => {
    expect(readChoice({ choice: 2 })).toBe(2);
  });
  it('rejects null, missing, negative or non-integer values', () => {
    expect(readChoice(null)).toBeNull();
    expect(readChoice({})).toBeNull();
    expect(readChoice({ choice: -1 })).toBeNull();
    expect(readChoice({ choice: 1.5 })).toBeNull();
    expect(readChoice({ choice: 'a' })).toBeNull();
  });
});

describe('gradeMcqAttempt', () => {
  const q = (id: string, points: number, correctIndex: number) => ({ id, kind: 'MCQ' as const, points, correctIndex });

  it('scores correct and incorrect answers', () => {
    const result = gradeMcqAttempt([
      { question: q('q1', 1, 0), response: { choice: 0 } },
      { question: q('q2', 1, 2), response: { choice: 1 } },
      { question: q('q3', 1, 1), response: null },
    ]);
    expect(result.score).toBe(1);
    expect(result.maxScore).toBe(3);
    expect(result.percent).toBeCloseTo(33.33, 2);
    expect(result.perQuestion).toEqual([
      { questionId: 'q1', score: 1 },
      { questionId: 'q2', score: 0 },
      { questionId: 'q3', score: 0 },
    ]);
  });

  it('returns 0 percent for an empty set rather than dividing by zero', () => {
    expect(gradeMcqAttempt([]).percent).toBe(0);
  });

  it('throws on a non-MCQ question so nothing is silently scored as zero', () => {
    expect(() =>
      gradeMcqAttempt([{ question: { id: 'q1', kind: 'WRITTEN', points: 5, correctIndex: null }, response: null }]),
    ).toThrow();
  });
});

describe('decideOutcome', () => {
  it('passes when the score meets the cutoff exactly', () => {
    expect(decideOutcome({ score: 60, maxScore: 100, cutoffPercent: 60, cutoffMode: 'DISQUALIFY' })).toBe('PASSED');
  });

  it('never rounds a near-miss up to the cutoff', () => {
    // 59.996% must not become 60%.
    expect(decideOutcome({ score: 14999, maxScore: 25000, cutoffPercent: 60, cutoffMode: 'DISQUALIFY' })).toBe('DISQUALIFIED');
  });

  it('disqualifies below cutoff under DISQUALIFY mode', () => {
    expect(decideOutcome({ score: 40, maxScore: 100, cutoffPercent: 60, cutoffMode: 'DISQUALIFY' })).toBe('DISQUALIFIED');
  });

  it('flags below cutoff under FLAG_FOR_REVIEW mode', () => {
    expect(decideOutcome({ score: 40, maxScore: 100, cutoffPercent: 60, cutoffMode: 'FLAG_FOR_REVIEW' })).toBe('FLAGGED');
  });

  it('a zero-question round with a zero cutoff always passes', () => {
    expect(decideOutcome({ score: 0, maxScore: 0, cutoffPercent: 0, cutoffMode: 'DISQUALIFY' })).toBe('PASSED');
  });

  it('a zero-question round with a positive cutoff cannot pass', () => {
    expect(decideOutcome({ score: 0, maxScore: 0, cutoffPercent: 50, cutoffMode: 'FLAG_FOR_REVIEW' })).toBe('FLAGGED');
  });
});

describe('computeRoundStates', () => {
  const rounds = [
    { roundType: 'ASSESSMENT' as const, humanScored: false },
    { roundType: 'TECHNICAL' as const, humanScored: false },
    { roundType: 'MANAGER' as const, humanScored: true },
  ];

  it('only the first round is available when nothing has started', () => {
    const states = computeRoundStates({ rounds, attempts: [], candidateStatus: 'ACTIVE' });
    expect(states.map((s) => s.state)).toEqual(['AVAILABLE', 'LOCKED', 'LOCKED']);
  });

  it('unlocks the next round once the previous one is graded', () => {
    const states = computeRoundStates({
      rounds,
      attempts: [{ roundType: 'ASSESSMENT', status: 'GRADED' }],
      candidateStatus: 'ACTIVE',
    });
    expect(states.map((s) => s.state)).toEqual(['DONE', 'AVAILABLE', 'LOCKED']);
  });

  it('an in-progress attempt reports IN_PROGRESS regardless of round order', () => {
    const states = computeRoundStates({
      rounds,
      attempts: [{ roundType: 'ASSESSMENT', status: 'IN_PROGRESS' }],
      candidateStatus: 'ACTIVE',
    });
    expect(states[0].state).toBe('IN_PROGRESS');
  });

  it('closes every remaining round once disqualified', () => {
    const states = computeRoundStates({
      rounds,
      attempts: [{ roundType: 'ASSESSMENT', status: 'GRADED' }],
      candidateStatus: 'DISQUALIFIED',
    });
    expect(states.map((s) => s.state)).toEqual(['DONE', 'CLOSED', 'CLOSED']);
  });

  it('a flagged (PENDING_REVIEW) candidate still proceeds to later rounds', () => {
    const states = computeRoundStates({
      rounds,
      attempts: [{ roundType: 'ASSESSMENT', status: 'GRADED' }],
      candidateStatus: 'PENDING_REVIEW',
    });
    expect(states.map((s) => s.state)).toEqual(['DONE', 'AVAILABLE', 'LOCKED']);
  });

  it('a submitted round that is still being graded blocks the next round', () => {
    for (const status of ['SUBMITTED', 'AUTO_SUBMITTED'] as const) {
      const states = computeRoundStates({ rounds, attempts: [{ roundType: 'ASSESSMENT', status }], candidateStatus: 'ACTIVE' });
      expect(states.map((s) => s.state)).toEqual(['GRADING', 'LOCKED', 'LOCKED']);
    }
  });

  it('Coding is runnable: it opens after Technical, and HR stays locked until it is done', () => {
    const states = computeRoundStates({
      rounds: [
        { roundType: 'TECHNICAL', humanScored: false },
        { roundType: 'CODING', humanScored: false },
        { roundType: 'HR', humanScored: false },
      ],
      attempts: [{ roundType: 'TECHNICAL', status: 'GRADED' }],
      candidateStatus: 'ACTIVE',
    });
    expect(states.map((s) => s.state)).toEqual(['DONE', 'AVAILABLE', 'LOCKED']);
  });

  it('a round the platform cannot run yet shows COMING_SOON and holds back everything after it', () => {
    const states = computeRoundStates({
      rounds: [
        { roundType: 'TECHNICAL', humanScored: false },
        { roundType: 'MANAGER', humanScored: false }, // not marked human-scored, and not runnable
        { roundType: 'HR', humanScored: false },
      ],
      attempts: [{ roundType: 'TECHNICAL', status: 'GRADED' }],
      candidateStatus: 'ACTIVE',
    });
    expect(states.map((s) => s.state)).toEqual(['DONE', 'COMING_SOON', 'LOCKED']);
  });

  it('a human-scored round is SCHEDULED once reached', () => {
    const states = computeRoundStates({
      rounds: [{ roundType: 'MANAGER', humanScored: true }],
      attempts: [],
      candidateStatus: 'ACTIVE',
    });
    expect(states[0].state).toBe('SCHEDULED');
  });
});

describe('blockedReason', () => {
  it('is null exactly for the states a candidate can act on', () => {
    expect(blockedReason('AVAILABLE')).toBeNull();
    expect(blockedReason('IN_PROGRESS')).toBeNull();
    expect(blockedReason('DONE')).toBeNull();
  });

  it('explains every blocked state', () => {
    for (const state of ['LOCKED', 'CLOSED', 'SCHEDULED', 'COMING_SOON', 'GRADING'] as const) {
      expect(blockedReason(state)).toBeTruthy();
    }
  });
});

describe('toCandidateQuestion', () => {
  it('keeps only the fields a candidate may see for an MCQ', () => {
    const q = { id: 'q1', kind: 'MCQ' as const, prompt: 'What is 2+2?', points: 1, options: ['3', '4'], correctIndex: 1, rubric: { keyPoints: ['x'] } };
    expect(toCandidateQuestion(q)).toEqual({ id: 'q1', kind: 'MCQ', prompt: 'What is 2+2?', points: 1, options: ['3', '4'], maxChars: null });
  });

  it('never exposes the rubric or sample answer of a typed question', () => {
    const q = { id: 'q2', kind: 'WRITTEN' as const, prompt: 'Design a cache.', points: 5, options: null, rubric: { keyPoints: ['eviction'], sampleAnswer: 'LRU' } };
    const out = toCandidateQuestion(q);
    expect(out).toEqual({ id: 'q2', kind: 'WRITTEN', prompt: 'Design a cache.', points: 5, options: [], maxChars: 6000 });
    expect(JSON.stringify(out)).not.toContain('eviction');
    expect(JSON.stringify(out)).not.toContain('LRU');
  });

  it('uses the shorter limit for short answers', () => {
    expect(toCandidateQuestion({ id: 'q3', kind: 'SHORT_ANSWER', prompt: 'Explain X', points: 2, options: null }).maxChars).toBe(1200);
  });

  it('throws when MCQ options are missing or malformed, rather than leaking anything else', () => {
    expect(() => toCandidateQuestion({ id: 'q1', kind: 'MCQ', prompt: 'x', points: 1, options: null })).toThrow();
    expect(() => toCandidateQuestion({ id: 'q1', kind: 'MCQ', prompt: 'x', points: 1, options: [1, 2] })).toThrow();
  });
});

describe('readText', () => {
  it('reads typed text and treats anything else as empty', () => {
    expect(readText({ text: 'hello' })).toBe('hello');
    expect(readText(null)).toBe('');
    expect(readText({})).toBe('');
    expect(readText({ text: 5 })).toBe('');
    expect(readText({ choice: 1 })).toBe('');
  });
});

describe('scoreWithoutAi', () => {
  const mcq = { id: 'a', kind: 'MCQ' as const, points: 1, correctIndex: 2 };
  const open = { id: 'b', kind: 'SHORT_ANSWER' as const, points: 2, correctIndex: null };

  it('scores MCQs immediately', () => {
    expect(scoreWithoutAi(mcq, { choice: 2 })).toEqual({ kind: 'scored', score: 1, feedback: null });
    expect(scoreWithoutAi(mcq, { choice: 0 })).toEqual({ kind: 'scored', score: 0, feedback: null });
    expect(scoreWithoutAi(mcq, null)).toEqual({ kind: 'scored', score: 0, feedback: null });
  });

  it('scores an empty or blank typed answer as 0 without the AI', () => {
    for (const response of [null, {}, { text: '' }, { text: '   \n ' }]) {
      expect(scoreWithoutAi(open, response)).toEqual({ kind: 'scored', score: 0, feedback: 'No answer given.' });
    }
  });

  it('sends a real typed answer to the AI', () => {
    expect(scoreWithoutAi(open, { text: 'An index speeds up reads.' })).toEqual({ kind: 'needs-ai' });
  });
});

describe('totalScores', () => {
  it('adds mixed points and reports a percentage to two decimals', () => {
    expect(totalScores([
      { points: 1, score: 1 },
      { points: 2, score: 1.5 },
      { points: 5, score: 2.5 },
    ])).toEqual({ score: 5, maxScore: 8, percent: 62.5 });
  });

  it('is 0 percent for nothing to score', () => {
    expect(totalScores([]).percent).toBe(0);
  });
});

describe('AI-graded rounds', () => {
  it('knows which rounds are AI graded and runnable', () => {
    for (const r of ['TECHNICAL', 'SYSTEM_DESIGN', 'SCENARIO', 'HR']) {
      expect(isAiGradedRound(r)).toBe(true);
      expect(isRunnableRound(r)).toBe(true);
    }
    expect(isAiGradedRound('ASSESSMENT')).toBe(false);
    expect(isRunnableRound('ASSESSMENT')).toBe(true);
    expect(isRunnableRound('CODING')).toBe(true);
    expect(isAiGradedRound('CODING')).toBe(false); // scored by hidden tests, so a failing score may disqualify
    expect(isRunnableRound('MANAGER')).toBe(false);
  });

  it('an AI score cannot disqualify unless the deployment opts in', () => {
    expect(effectiveCutoffMode('DISQUALIFY', 'TECHNICAL', false)).toBe('FLAG_FOR_REVIEW');
    expect(effectiveCutoffMode('DISQUALIFY', 'HR', false)).toBe('FLAG_FOR_REVIEW');
    expect(effectiveCutoffMode('DISQUALIFY', 'TECHNICAL', true)).toBe('DISQUALIFY');
  });

  it('leaves auto-graded and already-flagging rounds alone', () => {
    expect(effectiveCutoffMode('DISQUALIFY', 'ASSESSMENT', false)).toBe('DISQUALIFY');
    expect(effectiveCutoffMode('DISQUALIFY', 'CODING', false)).toBe('DISQUALIFY');
    expect(effectiveCutoffMode('FLAG_FOR_REVIEW', 'SCENARIO', false)).toBe('FLAG_FOR_REVIEW');
  });

  it('a below-cutoff Technical round flags instead of disqualifying by default', () => {
    const mode = effectiveCutoffMode('DISQUALIFY', 'TECHNICAL', false);
    expect(decideOutcome({ score: 3, maxScore: 10, cutoffPercent: 60, cutoffMode: mode })).toBe('FLAGGED');
  });
});

describe('approvedNextRound', () => {
  const st = (...states: string[]) => states.map((state, i) => ({ roundType: (['CODING', 'TECHNICAL', 'HR', 'MANAGER'] as const)[i], state })) as { roundType: 'CODING' | 'TECHNICAL' | 'HR' | 'MANAGER'; state: RoundState }[];

  it('names the first round that is ready', () => {
    expect(approvedNextRound('ACTIVE', st('DONE', 'AVAILABLE', 'LOCKED'))).toEqual({ kind: 'next', roundType: 'TECHNICAL', state: 'AVAILABLE' });
  });
  it('names a live interview or a round that opens later', () => {
    expect(approvedNextRound('ACTIVE', st('DONE', 'DONE', 'DONE', 'SCHEDULED'))).toEqual({ kind: 'next', roundType: 'MANAGER', state: 'SCHEDULED' });
    expect(approvedNextRound('ACTIVE', st('DONE', 'COMING_SOON'))).toEqual({ kind: 'next', roundType: 'TECHNICAL', state: 'COMING_SOON' });
  });
  it('says nothing once the next round has been started or is being graded', () => {
    expect(approvedNextRound('ACTIVE', st('DONE', 'IN_PROGRESS'))).toBeNull();
    expect(approvedNextRound('ACTIVE', st('DONE', 'GRADING'))).toBeNull();
  });
  it('when every round is done, selects the candidate to move forward (ACTIVE or COMPLETED)', () => {
    expect(approvedNextRound('COMPLETED', st('DONE', 'DONE', 'DONE', 'DONE'))).toEqual({ kind: 'all_done' });
    expect(approvedNextRound('ACTIVE', st('DONE', 'DONE'))).toEqual({ kind: 'all_done' });
  });
  it('says nothing when the candidate is pending review or disqualified, or there are no rounds', () => {
    expect(approvedNextRound('PENDING_REVIEW', st('DONE', 'AVAILABLE'))).toBeNull();
    expect(approvedNextRound('DISQUALIFIED', st('DONE', 'CLOSED'))).toBeNull();
    expect(approvedNextRound('ACTIVE', [])).toBeNull();
  });
});

describe('isSelectedNotice', () => {
  it('a Shortlist always shows it', () => {
    expect(isSelectedNotice(false, 'SHORTLIST')).toBe(true);
    expect(isSelectedNotice(true, 'SHORTLIST')).toBe(true);
  });
  it('a Reject never shows it, even after an earlier approval', () => {
    expect(isSelectedNotice(true, 'REJECT')).toBe(false);
    expect(isSelectedNotice(false, 'REJECT')).toBe(false);
  });
  it('with no final decision, only a review approval shows it', () => {
    expect(isSelectedNotice(true, null)).toBe(true);
    expect(isSelectedNotice(false, null)).toBe(false);
  });
});

describe('candidateOutcome', () => {
  it('disqualified always wins', () => {
    expect(candidateOutcome('DISQUALIFIED', 'SHORTLIST')).toBe('DISQUALIFIED');
    expect(candidateOutcome('DISQUALIFIED', null)).toBe('DISQUALIFIED');
  });
  it('shows the final decision', () => {
    expect(candidateOutcome('COMPLETED', 'SHORTLIST')).toBe('SHORTLISTED');
    expect(candidateOutcome('COMPLETED', 'REJECT')).toBe('NOT_SELECTED');
  });
  it('nothing while undecided', () => {
    expect(candidateOutcome('ACTIVE', null)).toBeNull();
    expect(candidateOutcome('PENDING_REVIEW', null)).toBeNull();
  });
});
