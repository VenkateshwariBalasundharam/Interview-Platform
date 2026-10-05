// Everything the admin dashboard shows, read in one go (server only). The arithmetic lives in admin-dashboard-core.ts.
import { prisma } from '@/lib/db';
import { averageByRound, funnel, outcomeCounts, roundCompletion, type DashCandidate } from '@/lib/admin-dashboard-core';
import { listJobs } from '@/lib/jobs';
import { ROUND_LIBRARY, type RoundType } from '@/lib/pipeline';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export async function loadDashboard(now = new Date()) {
  const [jobs, candidateRows, attemptRows, recent, top] = await Promise.all([
    listJobs(),
    prisma.candidate.findMany({ select: { status: true, createdAt: true, result: { select: { finalDecision: true } }, _count: { select: { attempts: true } } } }),
    prisma.attempt.findMany({ select: { roundType: true, status: true, percent: true, candidate: { select: { jobId: true } } } }),
    prisma.attempt.findMany({
      orderBy: { startedAt: 'desc' },
      take: 6,
      select: { id: true, roundType: true, status: true, percent: true, startedAt: true, candidate: { select: { id: true, name: true, job: { select: { title: true } } } } },
    }),
    prisma.result.findMany({
      orderBy: { weightedScore: 'desc' },
      take: 3,
      select: { weightedScore: true, suggestedDecision: true, finalDecision: true, candidate: { select: { id: true, name: true, job: { select: { title: true } } } } },
    }),
  ]);

  const candidates: DashCandidate[] = candidateRows.map((c) => ({ status: c.status, finalDecision: c.result?.finalDecision ?? null, hasAttempt: c._count.attempts > 0 }));
  const outcomes = outcomeCounts(candidates);

  // Average graded percent per job, for the jobs table.
  const perJob = new Map<string, { sum: number; n: number }>();
  for (const a of attemptRows) {
    if (a.status !== 'GRADED' || a.percent === null) continue;
    const cur = perJob.get(a.candidate.jobId) ?? { sum: 0, n: 0 };
    cur.sum += a.percent;
    cur.n += 1;
    perJob.set(a.candidate.jobId, cur);
  }

  return {
    totals: {
      jobs: jobs.length,
      candidates: candidates.length,
      newCandidatesThisWeek: candidateRows.filter((c) => now.getTime() - c.createdAt.getTime() < WEEK_MS).length,
      roundsInProgress: attemptRows.filter((a) => a.status === 'IN_PROGRESS').length,
      roundsBeingGraded: attemptRows.filter((a) => a.status === 'SUBMITTED' || a.status === 'AUTO_SUBMITTED').length,
      completed: candidates.filter((c) => c.status === 'COMPLETED' || c.finalDecision !== null).length,
    },
    outcomes,
    funnel: funnel(candidates),
    roundCompletion: roundCompletion<RoundType>(attemptRows, candidates.length, Object.keys(ROUND_LIBRARY) as RoundType[]),
    roundAverages: averageByRound<RoundType>(attemptRows),
    recent: recent.map((r) => ({ id: r.id, candidateId: r.candidate.id, name: r.candidate.name, job: r.candidate.job.title, roundType: r.roundType, status: r.status, percent: r.percent, startedAt: r.startedAt })),
    jobs: jobs.slice(0, 5).map((j) => {
      const p = perJob.get(j.id);
      return { id: j.id, title: j.title, candidateCount: j.candidateCount, started: j.started, rounds: j.enabledRounds, average: p ? Math.round(p.sum / p.n) : null };
    }),
    top: top.map((t) => ({ candidateId: t.candidate.id, name: t.candidate.name, job: t.candidate.job.title, score: Math.round(t.weightedScore), suggested: t.suggestedDecision, decided: t.finalDecision })),
  };
}
