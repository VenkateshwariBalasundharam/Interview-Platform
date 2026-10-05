// Pure numbers for the admin dashboard and the candidate filter tabs. No database in here, so it is unit tested.

export type Outcome = 'shortlisted' | 'rejected' | 'awaiting' | 'pending' | 'disqualified' | 'in_progress' | 'not_started';

export const OUTCOME_LABEL: Record<Outcome, string> = {
  shortlisted: 'Shortlisted',
  rejected: 'Rejected',
  awaiting: 'Awaiting decision',
  pending: 'Pending review',
  disqualified: 'Disqualified',
  in_progress: 'In progress',
  not_started: 'Not started',
};

export interface DashCandidate {
  status: string;
  finalDecision: string | null;
  hasAttempt: boolean;
}

/** Each candidate lands in exactly one outcome, so the pieces of the chart add up to the total. */
export function outcomeOf(c: DashCandidate): Outcome {
  if (c.status === 'DISQUALIFIED') return 'disqualified';
  if (c.finalDecision === 'SHORTLIST') return 'shortlisted';
  if (c.finalDecision === 'REJECT') return 'rejected';
  if (c.status === 'PENDING_REVIEW') return 'pending';
  if (c.status === 'COMPLETED') return 'awaiting';
  return c.hasAttempt ? 'in_progress' : 'not_started';
}

export function outcomeCounts(candidates: DashCandidate[]): Record<Outcome, number> {
  const counts: Record<Outcome, number> = { shortlisted: 0, rejected: 0, awaiting: 0, pending: 0, disqualified: 0, in_progress: 0, not_started: 0 };
  for (const c of candidates) counts[outcomeOf(c)] += 1;
  return counts;
}

export interface FunnelStep {
  label: string;
  value: number;
  /** Share of everyone registered, 0 to 100. */
  percent: number;
}

/** Registered, started a round, finished every round, shortlisted. */
export function funnel(candidates: DashCandidate[]): FunnelStep[] {
  const total = candidates.length;
  const steps = [
    { label: 'Registered', value: total },
    { label: 'Started a round', value: candidates.filter((c) => c.hasAttempt).length },
    { label: 'Finished every round', value: candidates.filter((c) => c.status === 'COMPLETED' || c.finalDecision !== null).length },
    { label: 'Shortlisted', value: candidates.filter((c) => c.finalDecision === 'SHORTLIST').length },
  ];
  return steps.map((s) => ({ ...s, percent: total === 0 ? 0 : Math.round((s.value / total) * 100) }));
}

/** Average percent per round over graded attempts, in the order the rounds first appear. */
export function averageByRound<T extends string>(attempts: { roundType: T; status: string; percent: number | null }[]): { roundType: T; average: number; count: number }[] {
  const map = new Map<T, { sum: number; count: number }>();
  for (const a of attempts) {
    if (a.status !== 'GRADED' || a.percent === null || !Number.isFinite(a.percent)) continue;
    const cur = map.get(a.roundType) ?? { sum: 0, count: 0 };
    cur.sum += a.percent;
    cur.count += 1;
    map.set(a.roundType, cur);
  }
  return [...map.entries()].map(([roundType, v]) => ({ roundType, average: Math.round(v.sum / v.count), count: v.count }));
}

/** How many candidates have handed in each round (anything past In progress), as a share of everyone registered. */
export function roundCompletion<T extends string>(attempts: { roundType: T; status: string }[], total: number, order: readonly T[]): { roundType: T; value: number; percent: number }[] {
  const counts = new Map<T, number>();
  for (const a of attempts) if (a.status !== 'IN_PROGRESS') counts.set(a.roundType, (counts.get(a.roundType) ?? 0) + 1);
  return order.filter((r) => counts.has(r)).map((roundType) => {
    const value = counts.get(roundType) ?? 0;
    return { roundType, value, percent: total === 0 ? 0 : Math.min(100, Math.round((value / total) * 100)) };
  });
}

/** "74%" of candidates, or a dash when there are none. */
export function share(part: number, total: number): string {
  return total === 0 ? '–' : `${Math.round((part / total) * 100)}%`;
}

// ───────────────────────── Candidate filter tabs ─────────────────────────

export const CANDIDATE_TABS = ['all', 'pending', 'awaiting', 'shortlisted', 'rejected', 'disqualified'] as const;
export type CandidateTab = (typeof CANDIDATE_TABS)[number];

export const TAB_LABEL: Record<CandidateTab, string> = {
  all: 'All',
  pending: 'Pending review',
  awaiting: 'Awaiting decision',
  shortlisted: 'Shortlisted',
  rejected: 'Rejected',
  disqualified: 'Disqualified',
};

export function parseTab(raw: string | undefined): CandidateTab {
  return (CANDIDATE_TABS as readonly string[]).includes(raw ?? '') ? (raw as CandidateTab) : 'all';
}

export function matchesTab(tab: CandidateTab, c: { status: string; finalDecision: string | null }): boolean {
  if (tab === 'all') return true;
  const o = outcomeOf({ ...c, hasAttempt: true });
  return o === tab;
}

export function tabCounts(candidates: { status: string; finalDecision: string | null }[]): Record<CandidateTab, number> {
  const counts = { all: candidates.length, pending: 0, awaiting: 0, shortlisted: 0, rejected: 0, disqualified: 0 } as Record<CandidateTab, number>;
  for (const c of candidates) {
    const o = outcomeOf({ ...c, hasAttempt: true });
    if (o in counts) counts[o as CandidateTab] += 1;
  }
  return counts;
}

// ───────────────────────── Notification bell ─────────────────────────

export interface BellItem {
  text: string;
  href: string;
}

/** What the top-bar bell lists: candidates waiting for the admin. Empty when nothing needs doing. */
export function bellItems(pending: number, awaiting: number): BellItem[] {
  const items: BellItem[] = [];
  if (pending > 0) items.push({ text: `${pending} candidate${pending === 1 ? ' needs' : 's need'} your review`, href: '/admin/candidates?tab=pending' });
  if (awaiting > 0) items.push({ text: `${awaiting} candidate${awaiting === 1 ? ' is' : 's are'} waiting for a final decision`, href: '/admin/candidates?tab=awaiting' });
  return items;
}

/** The red number on the bell. Large numbers are shortened so the badge stays small. */
export function bellBadge(count: number): string | null {
  if (!Number.isFinite(count) || count <= 0) return null;
  return count > 9 ? '9+' : String(Math.floor(count));
}
