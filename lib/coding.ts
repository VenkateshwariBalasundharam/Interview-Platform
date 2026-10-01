// Coding-round rules shared by the API and the editor screen. Pure and client-safe (no server imports).
import type { RoundInfo } from '@/lib/round-engine';

// ───────────────────────── Languages ─────────────────────────

export const CODING_LANGUAGE_IDS = ['python', 'javascript', 'java', 'cpp', 'c', 'go'] as const;
export type CodingLanguageId = (typeof CODING_LANGUAGE_IDS)[number];

export interface CodingLanguage {
  id: CodingLanguageId;
  label: string;
  /** Monaco editor language id. */
  monaco: string;
  /** Judge0 CE language id (v1.13). Override with JUDGE0_LANGUAGE_IDS if your Judge0 build differs. */
  judge0Id: number;
  starter: string;
}

export const CODING_LANGUAGES: readonly CodingLanguage[] = [
  { id: 'python', label: 'Python 3', monaco: 'python', judge0Id: 71, starter: 'import sys\n\n\ndef main():\n    data = sys.stdin.read().split()\n    # Write your solution here\n\n\nmain()\n' },
  { id: 'javascript', label: 'JavaScript (Node.js)', monaco: 'javascript', judge0Id: 63, starter: "const lines = require('fs').readFileSync(0, 'utf8').split('\\n');\n\n// Write your solution here\n" },
  { id: 'java', label: 'Java', monaco: 'java', judge0Id: 62, starter: 'import java.util.*;\n\npublic class Main {\n    public static void main(String[] args) {\n        Scanner in = new Scanner(System.in);\n        // Write your solution here\n    }\n}\n' },
  { id: 'cpp', label: 'C++', monaco: 'cpp', judge0Id: 54, starter: '#include <bits/stdc++.h>\nusing namespace std;\n\nint main() {\n    ios::sync_with_stdio(false);\n    cin.tie(nullptr);\n    // Write your solution here\n    return 0;\n}\n' },
  { id: 'c', label: 'C', monaco: 'c', judge0Id: 50, starter: '#include <stdio.h>\n\nint main(void) {\n    /* Write your solution here */\n    return 0;\n}\n' },
  { id: 'go', label: 'Go', monaco: 'go', judge0Id: 60, starter: 'package main\n\nimport (\n\t"bufio"\n\t"fmt"\n\t"os"\n)\n\nfunc main() {\n\treader := bufio.NewReader(os.Stdin)\n\t_ = reader\n\t_ = fmt.Sprint()\n\t// Write your solution here\n}\n' },
];

export function getLanguage(id: string): CodingLanguage {
  const lang = CODING_LANGUAGES.find((l) => l.id === id);
  if (!lang) throw new Error(`Unknown language: ${id}`);
  return lang;
}

/** The code a candidate starts from: the problem's own starter for that language, else the generic template. */
export function starterFor(problemStarter: unknown, language: CodingLanguageId): string {
  if (problemStarter && typeof problemStarter === 'object' && !Array.isArray(problemStarter)) {
    const own = (problemStarter as Record<string, unknown>)[language];
    if (typeof own === 'string' && own.trim() !== '') return own;
  }
  return getLanguage(language).starter;
}

// ───────────────────────── Limits ─────────────────────────

export const MAX_CODE_CHARS = 50_000;
export const MAX_CUSTOM_INPUT_CHARS = 10_000;
export const MAX_SHOWN_OUTPUT_CHARS = 2_000;
/** Each problem is worth this many points, so a round of N problems is out of N × 10. */
export const CODING_POINTS_PER_PROBLEM = 10;

// ───────────────────────── Verdicts ─────────────────────────

export type TestVerdict = 'PASSED' | 'WRONG_ANSWER' | 'TIME_LIMIT' | 'RUNTIME_ERROR' | 'COMPILE_ERROR' | 'ERROR';

/** Judge0 status ids: 3 accepted, 4 wrong answer, 5 time limit, 6 compile error, 7–12 runtime errors, 13/14 internal. */
export function verdictFromStatus(statusId: number): TestVerdict {
  if (statusId === 3) return 'PASSED'; // Judge0 says "accepted" when there is no expected output; we compare ourselves
  if (statusId === 4) return 'WRONG_ANSWER';
  if (statusId === 5) return 'TIME_LIMIT';
  if (statusId === 6) return 'COMPILE_ERROR';
  if (statusId >= 7 && statusId <= 12) return 'RUNTIME_ERROR';
  return 'ERROR';
}

export function verdictLabel(v: TestVerdict): string {
  switch (v) {
    case 'PASSED': return 'Passed';
    case 'WRONG_ANSWER': return 'Wrong answer';
    case 'TIME_LIMIT': return 'Time limit exceeded';
    case 'RUNTIME_ERROR': return 'Runtime error';
    case 'COMPILE_ERROR': return 'Compilation error';
    case 'ERROR': return 'Runner error';
  }
}

/** Line endings and trailing spaces or blank lines do not matter; everything else must match exactly. */
export function normalizeOutput(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, ''))
    .join('\n')
    .replace(/\n+$/g, '');
}

export function outputsMatch(actual: string | null | undefined, expected: string): boolean {
  return normalizeOutput(actual ?? '') === normalizeOutput(expected);
}

/** Decides a test's verdict from what the runner returned. The expected output is compared here, never sent to the runner. */
export function judgeTest(run: { statusId: number; stdout: string | null }, expected: string): TestVerdict {
  const base = verdictFromStatus(run.statusId);
  if (base !== 'PASSED') return base;
  return outputsMatch(run.stdout, expected) ? 'PASSED' : 'WRONG_ANSWER';
}

// ───────────────────────── Scoring ─────────────────────────

export function summarize(verdicts: readonly TestVerdict[]): { passed: number; total: number } {
  return { passed: verdicts.filter((v) => v === 'PASSED').length, total: verdicts.length };
}

export function fraction(passed: number, total: number): number {
  return total > 0 ? passed / total : 0;
}

/** The best submission counts, so a later worse attempt never lowers a problem's score. A tie keeps the earlier one. */
export function isBetterSubmission(previous: { passed: number; total: number } | null, next: { passed: number; total: number }): boolean {
  if (!previous || previous.total === 0) return true;
  return fraction(next.passed, next.total) > fraction(previous.passed, previous.total);
}

export function overallVerdict(verdicts: readonly TestVerdict[]): TestVerdict {
  if (verdicts.length > 0 && verdicts.every((v) => v === 'PASSED')) return 'PASSED';
  const order: TestVerdict[] = ['COMPILE_ERROR', 'RUNTIME_ERROR', 'TIME_LIMIT', 'WRONG_ANSWER', 'ERROR'];
  return order.find((v) => verdicts.includes(v)) ?? 'ERROR';
}

// ───────────────────────── Choosing problems ─────────────────────────

export interface PickableProblem {
  id: string;
  jobId: string | null;
  difficulty: 'EASY' | 'MEDIUM' | 'HARD';
  createdAt: Date;
  sampleCount: number;
  testCount: number;
}

const DIFFICULTY_RANK = { EASY: 0, MEDIUM: 1, HARD: 2 } as const;

/**
 * The same problems for every candidate: this job's own problems first, then the shared bank, nearest difficulty first.
 * A problem with no sample or no test is never used, since the candidate could not run it or it could not be graded.
 */
export function pickProblems<T extends PickableProblem>(problems: readonly T[], input: { jobId: string; difficulty: 'EASY' | 'MEDIUM' | 'HARD'; count: number }): T[] {
  const usable = problems.filter((p) => p.sampleCount >= 1 && p.testCount >= 1);
  const distance = (p: T) => Math.abs(DIFFICULTY_RANK[p.difficulty] - DIFFICULTY_RANK[input.difficulty]);
  return [...usable]
    .sort((a, b) => {
      const own = Number(b.jobId === input.jobId) - Number(a.jobId === input.jobId);
      if (own !== 0) return own;
      const d = distance(a) - distance(b);
      if (d !== 0) return d;
      return a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id);
    })
    .slice(0, input.count);
}

// ───────────────────────── What the candidate may see ─────────────────────────

export interface CandidateProblem {
  id: string;
  title: string;
  statement: string;
  difficulty: 'EASY' | 'MEDIUM' | 'HARD';
  samples: { input: string; expectedOutput: string }[];
  /** How many more tests will be run on Submit. Their inputs and outputs are never sent. */
  hiddenCount: number;
  timeLimitSec: number;
  starter: Record<CodingLanguageId, string>;
}

export interface ProblemProgress {
  passed: number;
  total: number;
  submissions: number;
  verdict: TestVerdict | null;
}

export interface CodingView {
  round: RoundInfo;
  secondsLeft: number;
  problems: CandidateProblem[];
  /** problemId → the saved working copy. */
  drafts: Record<string, { language: CodingLanguageId; code: string }>;
  progress: Record<string, ProblemProgress>;
}

/** One line of the console. Sample results carry the data; hidden results carry only the verdict. */
export interface TestReport {
  index: number;
  isSample: boolean;
  verdict: TestVerdict;
  input?: string;
  expected?: string;
  actual?: string;
  message?: string;
  timeMs?: number;
}

export interface RunReport {
  mode: 'run' | 'submit';
  overall: TestVerdict;
  passed: number;
  total: number;
  tests: TestReport[];
  /** Submit only: this problem's best result after the submission. */
  best?: { passed: number; total: number };
}

export interface CustomRunReport {
  mode: 'custom';
  verdict: TestVerdict;
  stdout: string;
  message: string;
  timeMs: number | null;
}

export function clip(text: string | null | undefined, max = MAX_SHOWN_OUTPUT_CHARS): string {
  const t = text ?? '';
  return t.length > max ? `${t.slice(0, max)}\n… (output cut)` : t;
}
