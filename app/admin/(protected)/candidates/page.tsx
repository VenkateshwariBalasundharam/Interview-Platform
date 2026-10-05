import Link from 'next/link';
import { CandidateEditButton } from '@/components/CandidateEditButton';
import { CandidateImport } from '@/components/CandidateImport';
import { CandidateReviewActions } from '@/components/CandidateReviewActions';
import { DeleteButton } from '@/components/DeleteButton';
import { ResumeCell } from '@/components/ResumeCell';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { listCandidates } from '@/lib/candidates';
import { CANDIDATE_TABS, TAB_LABEL, matchesTab, parseTab, tabCounts } from '@/lib/admin-dashboard-core';
import { decisionBadge } from '@/lib/final-result';
import { listJobs } from '@/lib/jobs';

export default async function CandidatesPage({ searchParams }: { searchParams: Promise<{ jobId?: string; tab?: string }> }) {
  const { jobId, tab: rawTab } = await searchParams;
  const tab = parseTab(rawTab);
  const [jobs, everyone] = await Promise.all([listJobs(), listCandidates(jobId)]);
  const counts = tabCounts(everyone);
  const candidates = everyone.filter((c) => matchesTab(tab, c));
  const tabHref = (t: string) => `/admin/candidates?${new URLSearchParams({ ...(jobId ? { jobId } : {}), ...(t === 'all' ? {} : { tab: t }) }).toString()}`;
  const now = Date.now();

  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {CANDIDATE_TABS.map((t) => (
          <Link
            key={t}
            href={tabHref(t)}
            aria-current={tab === t ? 'page' : undefined}
            className={`rounded-xl border p-4 shadow-sm transition-colors ${tab === t ? 'border-blue-600 bg-blue-50' : 'bg-card hover:bg-slate-50'}`}
          >
            <p className="text-xs text-muted-foreground">{TAB_LABEL[t]}</p>
            <p className="text-2xl font-semibold tabular-nums">{counts[t]}</p>
          </Link>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Bulk register from a file</CardTitle>
          <CardDescription>Each row creates a Candidate ID. Use “Validate only” first to check every row without saving.</CardDescription>
        </CardHeader>
        <CardContent>
          <CandidateImport jobs={jobs.map((j) => ({ id: j.id, title: j.title }))} defaultJobId={jobId} />
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">Filter by job:</span>
        <Link href={tab === 'all' ? '/admin/candidates' : `/admin/candidates?tab=${tab}`} className={jobId ? 'underline' : 'font-medium'}>All</Link>
        {jobs.map((j) => <Link key={j.id} href={`/admin/candidates?${new URLSearchParams({ jobId: j.id, ...(tab === 'all' ? {} : { tab }) }).toString()}`} className={jobId === j.id ? 'font-medium' : 'underline'}>{j.title}</Link>)}
      </div>

      {candidates.length === 0 ? (
        <p className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">{everyone.length === 0 ? 'No candidates yet.' : `No candidates in “${TAB_LABEL[tab]}”.`}</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="p-3">Candidate ID</th><th className="p-3">Name</th><th className="p-3">Email</th><th className="p-3">Job</th><th className="p-3">Status</th><th className="p-3">Resume</th><th className="p-3">Review</th></tr></thead>
            <tbody>
              {candidates.map((c) => (
                <tr key={c.id} className="border-t">
                  <td className="p-3 font-mono">{c.candidateCode}</td>
                  <td className="p-3">{c.name}</td>
                  <td className="p-3">{c.email}</td>
                  <td className="p-3">{c.job.title}</td>
                  <td className="p-3">
                    <Badge tone={c.status === 'DISQUALIFIED' ? 'bad' : c.status === 'PENDING_REVIEW' ? 'warn' : 'neutral'}>{c.status.replace('_', ' ').toLowerCase()}</Badge>
                    {decisionBadge(c.finalDecision) && <Badge tone={decisionBadge(c.finalDecision)!.tone} className="ml-1">{decisionBadge(c.finalDecision)!.label}</Badge>}
                    {c.lockedUntil && c.lockedUntil.getTime() > now && <Badge tone="warn" className="ml-1">login locked</Badge>}
                  </td>
                  <td className="p-3 align-top"><ResumeCell candidateId={c.id} initial={c.resume} /></td>
                  <td className="p-3 align-top">
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-3">
                        <Link href={`/admin/candidates/${c.id}`} className="text-xs underline">Answers &amp; scores</Link>
                        <CandidateEditButton candidate={{ id: c.id, candidateCode: c.candidateCode, name: c.name, email: c.email }} />
                        <DeleteButton endpoint={`/api/admin/candidates/${c.id}`} dialogTitle={`Delete ${c.name}?`}>
                          <p>
                            This permanently deletes <strong className="text-foreground">{c.name}</strong> (<span className="font-mono">{c.candidateCode}</span>) with their answers, scores, results and resume file. Their Candidate ID stops working.
                          </p>
                          <p>This cannot be undone.</p>
                        </DeleteButton>
                      </div>
                      {(c.status === 'PENDING_REVIEW' || c.ungradedRounds.length > 0) && (
                        <CandidateReviewActions candidateId={c.id} canReview={c.status === 'PENDING_REVIEW'} ungradedRounds={c.ungradedRounds} compact />
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-muted-foreground">Showing up to 500 candidates.</p>
    </>
  );
}
