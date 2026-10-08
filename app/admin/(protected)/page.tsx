import Link from 'next/link';
import { ArrowRight, Briefcase, CheckCircle2, ClipboardList, FilePlus2, PlayCircle, Sparkles, Users } from 'lucide-react';
import { AutoRefresh } from '@/components/admin/AutoRefresh';
import { BackgroundJobsBanner } from '@/components/admin/BackgroundJobsBanner';
import { Donut } from '@/components/admin/Donut';
import { StatCard } from '@/components/admin/StatCard';
import { Badge } from '@/components/ui/badge';
import { requireAdminPage } from '@/lib/auth';
import { loadDashboard } from '@/lib/admin-dashboard';
import { OUTCOME_LABEL, share, type Outcome } from '@/lib/admin-dashboard-core';
import { SUGGESTION_LABEL } from '@/lib/final-result';
import { ROUND_LIBRARY } from '@/lib/pipeline';

const OUTCOME_COLOR: Record<Outcome, string> = {
  shortlisted: '#10b981',
  rejected: '#ef4444',
  awaiting: '#f59e0b',
  pending: '#8b5cf6',
  disqualified: '#64748b',
  in_progress: '#3b82f6',
  not_started: '#cbd5e1',
};
const FUNNEL_COLORS = ['from-blue-500 to-blue-600', 'from-teal-400 to-teal-500', 'from-violet-500 to-violet-600', 'from-emerald-400 to-emerald-500'];
const BAR_COLORS = ['bg-blue-500', 'bg-violet-500', 'bg-emerald-400', 'bg-teal-400'];
const ATTEMPT_BADGE: Record<string, { text: string; tone: 'good' | 'warn' | 'neutral' }> = {
  GRADED: { text: 'Done', tone: 'good' },
  IN_PROGRESS: { text: 'In progress', tone: 'warn' },
  SUBMITTED: { text: 'Grading', tone: 'neutral' },
  AUTO_SUBMITTED: { text: 'Grading', tone: 'neutral' },
};

function Panel({ title, action, children, className = '' }: { title: string; action?: { href: string; label: string }; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border bg-card p-5 shadow-sm ${className}`}>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold">{title}</h2>
        {action && <Link href={action.href} className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline">{action.label}<ArrowRight className="h-3 w-3" aria-hidden /></Link>}
      </div>
      {children}
    </section>
  );
}

export default async function AdminHome() {
  const admin = await requireAdminPage();
  const d = await loadDashboard();
  const t = d.totals;
  const overall = d.roundAverages.length === 0 ? null : Math.round(d.roundAverages.reduce((s, r) => s + r.average, 0) / d.roundAverages.length);

  const notifications = [
    { n: d.outcomes.pending, text: (n: number) => `${n} candidate${n === 1 ? '' : 's'} need${n === 1 ? 's' : ''} your review`, href: '/admin/candidates?tab=pending', color: 'bg-violet-500' },
    { n: d.outcomes.awaiting, text: (n: number) => `${n} candidate${n === 1 ? ' is' : 's are'} waiting for a final decision`, href: '/admin/candidates?tab=awaiting', color: 'bg-amber-500' },
    { n: t.roundsInProgress, text: (n: number) => `${n} round${n === 1 ? ' is' : 's are'} being taken right now`, href: '/admin/candidates', color: 'bg-blue-500' },
    { n: t.roundsBeingGraded, text: (n: number) => `${n} round${n === 1 ? ' is' : 's are'} waiting to be graded`, href: '/admin/candidates', color: 'bg-pink-500' },
    { n: t.newCandidatesThisWeek, text: (n: number) => `${n} new candidate${n === 1 ? '' : 's'} registered this week`, href: '/admin/candidates', color: 'bg-emerald-500' },
  ].filter((x) => x.n > 0);

  const quick = [
    { href: '/admin/jobs/new', icon: FilePlus2, title: 'Create job', note: 'Set up a new pipeline', cls: 'border-blue-100 bg-blue-50/60 text-blue-700' },
    { href: '/admin/jobs', icon: Sparkles, title: 'Generate questions', note: 'Open a job, then its questions', cls: 'border-emerald-100 bg-emerald-50/60 text-emerald-700' },
    { href: '/admin/results', icon: ClipboardList, title: 'View results', note: 'Scores and final decisions', cls: 'border-violet-100 bg-violet-50/60 text-violet-700' },
    { href: '/admin/candidates', icon: Users, title: 'Manage candidates', note: 'Register, review, decide', cls: 'border-amber-100 bg-amber-50/60 text-amber-700' },
  ];

  return (
    <>
      <BackgroundJobsBanner />
      <AutoRefresh seconds={15} />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={Briefcase} tone="blue" label="Jobs" value={t.jobs} />
        <StatCard icon={Users} tone="green" label="Total candidates" value={t.candidates} note={t.newCandidatesThisWeek > 0 ? `${t.newCandidatesThisWeek} new this week` : 'None new this week'} />
        <StatCard icon={PlayCircle} tone="purple" label="Rounds in progress" value={t.roundsInProgress} note={t.roundsBeingGraded > 0 ? `${t.roundsBeingGraded} waiting to be graded` : undefined} />
        <StatCard icon={CheckCircle2} tone="orange" label="Finished all rounds" value={t.completed} note={`${share(t.completed, t.candidates)} of candidates`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Interview pipeline">
          {(() => {
            const steps = [{ key: 'registered', label: 'Registered', value: t.candidates, percent: t.candidates === 0 ? 0 : 100 }, ...d.roundCompletion.map((r) => ({ key: r.roundType, label: ROUND_LIBRARY[r.roundType].label, value: r.value, percent: r.percent }))];
            return (
              <ul className="space-y-3">
                {steps.map((s, i) => (
                  <li key={s.key} className="flex items-center gap-3 text-sm">
                    <div className="h-8 flex-1 rounded-md bg-slate-100">
                      <div className={`flex h-8 items-center rounded-md bg-gradient-to-r px-3 text-xs font-medium text-white ${FUNNEL_COLORS[i % FUNNEL_COLORS.length]}`} style={{ width: `${Math.max(s.percent, 22)}%` }}>{s.label}</div>
                    </div>
                    <span className="w-8 text-right font-semibold tabular-nums">{s.value}</span>
                    <span className="w-10 text-right text-xs text-muted-foreground tabular-nums">{s.percent}%</span>
                  </li>
                ))}
              </ul>
            );
          })()}
        </Panel>

        <Panel title="Candidate outcomes">
          <Donut
            caption="candidates"
            centre={String(t.candidates)}
            parts={(Object.keys(OUTCOME_LABEL) as Outcome[]).map((o) => ({ label: OUTCOME_LABEL[o], value: d.outcomes[o], color: OUTCOME_COLOR[o] }))}
          />
        </Panel>

        <Panel title="Average score by round" action={{ href: '/admin/results', label: 'View results' }}>
          {d.roundAverages.length === 0 ? (
            <p className="text-sm text-muted-foreground">No graded rounds yet.</p>
          ) : (
            <>
              <p className="mb-3 text-3xl font-semibold">{overall}%<span className="ml-2 text-xs font-normal text-muted-foreground">across graded rounds</span></p>
              <ul className="space-y-3">
                {d.roundAverages.map((r, i) => (
                  <li key={r.roundType} className="text-sm">
                    <div className="mb-1 flex justify-between"><span>{ROUND_LIBRARY[r.roundType].label}</span><span className="font-medium tabular-nums">{r.average}%</span></div>
                    <div className="h-2 rounded-full bg-slate-100"><div className={`h-2 rounded-full ${BAR_COLORS[i % BAR_COLORS.length]}`} style={{ width: `${r.average}%` }} /></div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Recent rounds" action={{ href: '/admin/candidates', label: 'View all' }} className="lg:col-span-2">
          {d.recent.length === 0 ? (
            <p className="text-sm text-muted-foreground">No one has started a round yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase text-slate-500"><tr><th className="py-2 pr-3 font-medium">Candidate</th><th className="py-2 pr-3 font-medium">Job</th><th className="py-2 pr-3 font-medium">Round</th><th className="py-2 pr-3 font-medium">Score</th><th className="py-2 font-medium">Status</th></tr></thead>
                <tbody>
                  {d.recent.map((r) => {
                    const b = ATTEMPT_BADGE[r.status] ?? { text: r.status, tone: 'neutral' as const };
                    return (
                      <tr key={r.id} className="border-t">
                        <td className="py-2.5 pr-3 font-medium"><Link href={`/admin/candidates/${r.candidateId}`} className="hover:underline">{r.name}</Link></td>
                        <td className="py-2.5 pr-3 text-muted-foreground">{r.job}</td>
                        <td className="py-2.5 pr-3">{ROUND_LIBRARY[r.roundType].label}</td>
                        <td className="py-2.5 pr-3 tabular-nums">{r.percent === null ? '–' : `${Math.round(r.percent)}%`}</td>
                        <td className="py-2.5"><Badge tone={b.tone}>{b.text}</Badge></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel title="Quick actions">
          <div className="grid grid-cols-2 gap-3">
            {quick.map((q) => (
              <Link key={q.title} href={q.href} className={`rounded-lg border p-3 transition-shadow hover:shadow-md ${q.cls}`}>
                <q.icon className="mb-2 h-4 w-4" aria-hidden />
                <p className="text-sm font-semibold">{q.title}</p>
                <p className="text-xs opacity-80">{q.note}</p>
              </Link>
            ))}
          </div>
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Jobs overview" action={{ href: '/admin/jobs', label: 'View all' }} className="lg:col-span-2">
          {d.jobs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No jobs yet. Create one to set up its interview pipeline.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase text-slate-500"><tr><th className="py-2 pr-3 font-medium">Title</th><th className="py-2 pr-3 font-medium">Status</th><th className="py-2 pr-3 font-medium">Rounds</th><th className="py-2 pr-3 font-medium">Candidates</th><th className="py-2 pr-3 font-medium">Avg. score</th><th className="py-2"><span className="sr-only">Open</span></th></tr></thead>
                <tbody>
                  {d.jobs.map((j) => (
                    <tr key={j.id} className="border-t">
                      <td className="py-2.5 pr-3 font-medium">{j.title}</td>
                      <td className="py-2.5 pr-3"><Badge tone={j.started ? 'good' : 'neutral'}>{j.started ? 'Interviewing' : 'Not started'}</Badge></td>
                      <td className="py-2.5 pr-3 tabular-nums">{j.rounds}</td>
                      <td className="py-2.5 pr-3 tabular-nums">{j.candidateCount}</td>
                      <td className="py-2.5 pr-3 tabular-nums">{j.average === null ? '–' : `${j.average}%`}</td>
                      <td className="py-2.5 text-right"><Link href={`/admin/jobs/${j.id}`} className="rounded-md bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100">View</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel title="Hiring funnel">
          <div className="flex items-stretch">
            {d.funnel.map((s, i) => (
              <div
                key={s.label}
                className={`-ml-2 flex-1 bg-gradient-to-r px-4 py-4 text-center text-white first:ml-0 ${FUNNEL_COLORS[i]}`}
                style={{ clipPath: 'polygon(0 0, calc(100% - 14px) 0, 100% 50%, calc(100% - 14px) 100%, 0 100%, 14px 50%)' }}
              >
                <p className="text-[11px] leading-tight opacity-90">{s.label}</p>
                <p className="text-lg font-semibold">{s.value}</p>
              </div>
            ))}
          </div>
          <p className="mt-4 text-xs text-muted-foreground">{share(d.funnel[3].value, d.funnel[0].value)} of registered candidates were shortlisted</p>
          <div className="mt-1 h-2 rounded-full bg-slate-100"><div className="h-2 rounded-full bg-blue-600" style={{ width: `${d.funnel[3].percent}%` }} /></div>
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Needs your attention">
          {notifications.length === 0 ? (
            <p className="text-sm text-muted-foreground">You are all caught up.</p>
          ) : (
            <ul className="space-y-2.5 text-sm">
              {notifications.map((n) => (
                <li key={n.href + n.n}>
                  <Link href={n.href} className="flex items-start gap-2 hover:underline">
                    <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.color}`} aria-hidden />
                    {n.text(n.n)}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Top scoring candidates" action={{ href: '/admin/results', label: 'View all' }}>
          {d.top.length === 0 ? (
            <p className="text-sm text-muted-foreground">Scores appear here once candidates finish rounds.</p>
          ) : (
            <ul className="space-y-3">
              {d.top.map((c) => {
                const final = c.decided ?? c.suggested;
                const tone = final === 'SHORTLIST' ? 'good' : final === 'REJECT' ? 'bad' : 'warn';
                return (
                  <li key={c.candidateId} className="flex items-center gap-3 text-sm">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-semibold text-blue-700" aria-hidden>{c.name.charAt(0).toUpperCase()}</span>
                    <div className="min-w-0 flex-1">
                      <Link href={`/admin/candidates/${c.candidateId}`} className="block truncate font-medium hover:underline">{c.name}</Link>
                      <p className="truncate text-xs text-muted-foreground">{c.job}</p>
                    </div>
                    <span className="tabular-nums text-xs text-muted-foreground">{c.score}/100</span>
                    <Badge tone={tone}>{c.decided ? (c.decided === 'SHORTLIST' ? 'Shortlisted' : 'Rejected') : SUGGESTION_LABEL[c.suggested as keyof typeof SUGGESTION_LABEL] ?? c.suggested}</Badge>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
}
