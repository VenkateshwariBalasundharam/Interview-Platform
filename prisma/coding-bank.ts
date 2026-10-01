/* Starter bank of coding problems for the Coding round. Shared by every job (no job, no tier).
 * Each problem has a reference solution that produces its expected outputs, so tests can never drift from the statement.
 * Hidden tests are generated from a fixed seed: the same data every time the seed runs. Idempotent: run `npm run db:seed`. */
import type { PrismaClient } from '@prisma/client';

export interface BankTest {
  input: string;
  output: string;
}
export interface BankProblem {
  title: string;
  difficulty: 'EASY' | 'MEDIUM' | 'HARD';
  timeLimitSec: number;
  statement: string;
  samples: BankTest[];
  hidden: () => BankTest[];
}

// ───────────────────────── helpers ─────────────────────────

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const randInt = (r: () => number, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
const letters = (r: () => number, n: number, alphabet = 'abcdefghijklmnopqrstuvwxyz') => Array.from({ length: n }, () => alphabet[randInt(r, 0, alphabet.length - 1)]).join('');

// ───────────────────────── reference solutions ─────────────────────────

export const solve = {
  reverseWords: (line: string) => line.trim().split(/\s+/).reverse().join(' '),

  palindrome: (line: string) => {
    const s = line.toLowerCase().replace(/[^a-z0-9]/g, '');
    return s === [...s].reverse().join('') ? 'YES' : 'NO';
  },

  twoSum: (input: string) => {
    const [head, rest] = input.trim().split('\n');
    const target = Number(head.split(' ')[1]);
    const a = rest.split(' ').map(Number);
    const seen = new Map<number, number>();
    for (let j = 0; j < a.length; j++) {
      const i = seen.get(target - a[j]);
      if (i !== undefined) return `${i + 1} ${j + 1}`;
      seen.set(a[j], j);
    }
    throw new Error('no pair');
  },

  brackets: (s: string) => {
    const pairs: Record<string, string> = { ')': '(', ']': '[', '}': '{' };
    const stack: string[] = [];
    for (const c of s.trim()) {
      if (c === '(' || c === '[' || c === '{') stack.push(c);
      else if (stack.pop() !== pairs[c]) return 'NO';
    }
    return stack.length === 0 ? 'YES' : 'NO';
  },

  mergeIntervals: (input: string) => {
    const lines = input.trim().split('\n');
    const iv = lines.slice(1).map((l) => l.split(' ').map(Number) as [number, number]);
    iv.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
    const out: [number, number][] = [];
    for (const [a, b] of iv) {
      const last = out[out.length - 1];
      if (last && a <= last[1]) last[1] = Math.max(last[1], b);
      else out.push([a, b]);
    }
    return out.map((p) => p.join(' ')).join('\n');
  },

  longestUnique: (s: string) => {
    const last = new Map<string, number>();
    let best = 0;
    let start = 0;
    const t = s.trim();
    for (let i = 0; i < t.length; i++) {
      const p = last.get(t[i]);
      if (p !== undefined && p >= start) start = p + 1;
      last.set(t[i], i);
      best = Math.max(best, i - start + 1);
    }
    return String(best);
  },

  lis: (input: string) => {
    const a = input.trim().split('\n')[1].split(' ').map(Number);
    const tails: number[] = [];
    for (const x of a) {
      let lo = 0;
      let hi = tails.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (tails[mid] < x) lo = mid + 1;
        else hi = mid;
      }
      tails[lo] = x;
    }
    return String(tails.length);
  },

  coinChange: (input: string) => {
    const [head, rest] = input.trim().split('\n');
    const amount = Number(head.split(' ')[1]);
    const coins = rest.split(' ').map(Number);
    const dp = new Array<number>(amount + 1).fill(Infinity);
    dp[0] = 0;
    for (let v = 1; v <= amount; v++) for (const c of coins) if (c <= v && dp[v - c] + 1 < dp[v]) dp[v] = dp[v - c] + 1;
    return dp[amount] === Infinity ? '-1' : String(dp[amount]);
  },
};

// ───────────────────────── problems ─────────────────────────

const t = (input: string, output: string): BankTest => ({ input: input.endsWith('\n') ? input : `${input}\n`, output });

export const CODING_BANK: BankProblem[] = [
  {
    title: 'Reverse the Words',
    difficulty: 'EASY',
    timeLimitSec: 2,
    statement: `You are given one line of text made of words separated by single spaces. Print the words in reverse order, separated by single spaces.

Input format
One line with 1 to 1000 words. Each word has 1 to 20 letters or digits.

Output format
One line: the same words in reverse order.`,
    samples: [t('hello world', 'world hello'), t('one two three', 'three two one')],
    hidden: () => {
      const r = rng(101);
      const long = Array.from({ length: 1000 }, () => letters(r, randInt(r, 1, 8))).join(' ');
      const cases = ['single', 'a b', 'The quick brown fox jumps over the lazy dog', 'route66 is 1 road', long];
      return cases.map((c) => t(c, solve.reverseWords(c)));
    },
  },
  {
    title: 'Palindrome Check',
    difficulty: 'EASY',
    timeLimitSec: 2,
    statement: `A phrase is a palindrome if, after removing every character that is not a letter or a digit and ignoring upper and lower case, it reads the same forwards and backwards.

Input format
One line with 1 to 100000 characters (letters, digits, spaces and punctuation).

Output format
Print YES if the phrase is a palindrome, otherwise NO. A line with no letters or digits counts as a palindrome.`,
    samples: [t('A man, a plan, a canal: Panama', 'YES'), t('race a car', 'NO')],
    hidden: () => {
      const r = rng(202);
      const half = letters(r, 50000);
      const pal = half + [...half].reverse().join('');
      const broken = pal.slice(0, 40000) + (pal[40000] === 'a' ? 'b' : 'a') + pal.slice(40001);
      const cases = ['Was it a car or a cat I saw?', 'No lemon, no melon', 'Hello, World!', '0P', '!!!', 'ab_a', pal, broken];
      return cases.map((c) => t(c, solve.palindrome(c)));
    },
  },
  {
    title: 'Two Sum (Indices)',
    difficulty: 'MEDIUM',
    timeLimitSec: 2,
    statement: `Given a list of distinct integers and a target, find the two different positions whose values add up to the target. Exactly one such pair exists.

Input format
Line 1: n and target (2 <= n <= 50000, |target| <= 2000000000).
Line 2: n distinct integers, each between -1000000000 and 1000000000.

Output format
Two 1-based positions i and j with i < j, separated by a space.

Note: a solution that checks every pair is too slow for the largest tests.`,
    samples: [t('4 9\n2 7 11 15', '1 2'), t('3 6\n3 2 4', '2 3')],
    hidden: () => {
      const r = rng(303);
      const make = (n: number) => {
        for (;;) {
          const set = new Set<number>();
          while (set.size < n) set.add(randInt(r, -1_000_000_000, 1_000_000_000));
          const a = [...set];
          const p = randInt(r, 0, n - 1);
          let q = randInt(r, 0, n - 1);
          while (q === p) q = randInt(r, 0, n - 1);
          const target = a[p] + a[q];
          const count = a.filter((x) => set.has(target - x) && target - x !== x).length / 2;
          if (count === 1) return `${n} ${target}\n${a.join(' ')}`;
        }
      };
      const cases = ['4 0\n-3 4 3 90', '2 5\n1 4', make(10), make(1000), make(50000)];
      return cases.map((c) => t(c, solve.twoSum(c)));
    },
  },
  {
    title: 'Balanced Brackets',
    difficulty: 'MEDIUM',
    timeLimitSec: 2,
    statement: `A string made only of the characters ( ) [ ] { } is balanced if every opening bracket is closed by the same kind of bracket, in the correct order.

Input format
One line with 1 to 100000 bracket characters.

Output format
Print YES if the string is balanced, otherwise NO.`,
    samples: [t('()[]{}', 'YES'), t('([)]', 'NO')],
    hidden: () => {
      const r = rng(404);
      const open = '([{';
      const close: Record<string, string> = { '(': ')', '[': ']', '{': '}' };
      const stack: string[] = [];
      const out: string[] = [];
      const total = 100000;
      while (out.length < total) {
        const remaining = total - out.length;
        if (stack.length === remaining || (stack.length > 0 && r() < 0.5)) out.push(close[stack.pop() as string]);
        else stack.push(open[randInt(r, 0, 2)]), out.push(stack[stack.length - 1]);
      }
      const balanced = out.join('');
      const broken = balanced.slice(0, -1) + (balanced.endsWith(')') ? ']' : ')');
      const cases = ['{[]}', '(', ')(', '((()))', '(]', balanced, broken, '['.repeat(50000) + ']'.repeat(50000)];
      return cases.map((c) => t(c, solve.brackets(c)));
    },
  },
  {
    title: 'Longest Substring Without Repeats',
    difficulty: 'MEDIUM',
    timeLimitSec: 2,
    statement: `Find the length of the longest substring (a run of consecutive characters) that contains no character twice.

Input format
One line with 1 to 100000 lowercase letters.

Output format
One integer: the length of that longest substring.`,
    samples: [t('abcabcbb', '3'), t('bbbbb', '1')],
    hidden: () => {
      const r = rng(505);
      const cases = ['pwwkew', 'a', 'abcdefghijklmnopqrstuvwxyz', 'ab'.repeat(50000), letters(r, 100000), 'abcdefghijklmnopqrstuvwxyz'.repeat(3800)];
      return cases.map((c) => t(c, solve.longestUnique(c)));
    },
  },
  {
    title: 'Merge Intervals',
    difficulty: 'MEDIUM',
    timeLimitSec: 2,
    statement: `Merge every group of overlapping intervals. Two intervals overlap if they share at least one point, so [1, 4] and [4, 5] merge into [1, 5].

Input format
Line 1: n, the number of intervals (1 <= n <= 50000).
Next n lines: two integers a and b (0 <= a <= b <= 1000000), one interval per line. They are not sorted.

Output format
The merged intervals sorted by start, one per line, as "a b".`,
    samples: [t('4\n1 3\n2 6\n8 10\n15 18', '1 6\n8 10\n15 18'), t('2\n1 4\n4 5', '1 5')],
    hidden: () => {
      const r = rng(606);
      const random = (n: number, span: number) => {
        const lines = Array.from({ length: n }, () => {
          const a = randInt(r, 0, 1_000_000 - span);
          return `${a} ${a + randInt(r, 0, span)}`;
        });
        return `${n}\n${lines.join('\n')}`;
      };
      const cases = ['1\n5 5', '3\n6 8\n1 9\n2 4', '3\n1 2\n3 4\n5 6', '4\n0 0\n0 0\n1 1\n1 2', random(1000, 500), random(50000, 5)];
      return cases.map((c) => t(c, solve.mergeIntervals(c)));
    },
  },
  {
    title: 'Longest Increasing Subsequence',
    difficulty: 'HARD',
    timeLimitSec: 2,
    statement: `Find the length of the longest strictly increasing subsequence. A subsequence keeps the original order but may skip elements.

Input format
Line 1: n (1 <= n <= 50000).
Line 2: n integers, each between -1000000000 and 1000000000.

Output format
One integer: the length of the longest strictly increasing subsequence.

Note: a solution that compares every pair of elements is too slow for the largest tests.`,
    samples: [t('8\n10 9 2 5 3 7 101 18', '4'), t('6\n0 1 0 3 2 3', '4')],
    hidden: () => {
      const r = rng(707);
      const arr = (n: number, f: (i: number) => number) => `${n}\n${Array.from({ length: n }, (_, i) => f(i)).join(' ')}`;
      const cases = [
        '1\n42',
        '4\n7 7 7 7',
        arr(1000, (i) => 1000 - i),
        arr(2000, () => randInt(r, -1000, 1000)),
        arr(50000, (i) => i),
        arr(50000, () => randInt(r, -1_000_000_000, 1_000_000_000)),
      ];
      return cases.map((c) => t(c, solve.lis(c)));
    },
  },
  {
    title: 'Minimum Coins',
    difficulty: 'HARD',
    timeLimitSec: 2,
    statement: `You have unlimited coins of each given value. Find the fewest coins that add up to exactly the target amount.

Input format
Line 1: n and amount (1 <= n <= 100, 0 <= amount <= 10000).
Line 2: n coin values, each between 1 and 10000.

Output format
The fewest coins needed, or -1 if the amount cannot be made.`,
    samples: [t('3 11\n1 2 5', '3'), t('1 3\n2', '-1')],
    hidden: () => {
      const r = rng(808);
      const random = (n: number, amount: number) => `${n} ${amount}\n${Array.from({ length: n }, () => randInt(r, 2, 500)).join(' ')}`;
      const cases = ['1 0\n1', '3 7\n2 4 6', '4 6249\n186 419 83 408', '2 10000\n9999 1', random(50, 10000), random(100, 9973)];
      return cases.map((c) => t(c, solve.coinChange(c)));
    },
  },
];

// ───────────────────────── seeding ─────────────────────────

/** Adds any bank problem that is not there yet (matched by title, shared bank only). Existing problems are left untouched. */
export async function seedCodingBank(prisma: PrismaClient): Promise<{ added: number; existing: number }> {
  let added = 0;
  let existing = 0;
  for (const p of CODING_BANK) {
    const found = await prisma.codingProblem.findFirst({ where: { title: p.title, jobId: null }, select: { id: true } });
    if (found) {
      existing++;
      continue;
    }
    await prisma.codingProblem.create({
      data: {
        title: p.title,
        statement: p.statement,
        difficulty: p.difficulty,
        timeLimitSec: p.timeLimitSec,
        testCases: {
          create: [
            ...p.samples.map((s) => ({ input: s.input, expectedOutput: s.output, isSample: true })),
            ...p.hidden().map((h) => ({ input: h.input, expectedOutput: h.output, isSample: false })),
          ],
        },
      },
    });
    added++;
  }
  return { added, existing };
}
