import Link from 'next/link';
import { CandidateEditButton } from '@/components/CandidateEditButton';
import { CandidateImport } from '@/components/CandidateImport';
import { CandidateReviewActions } from '@/components/CandidateReviewActions';
import { DeleteButton } from '@/components/DeleteButton';
import { ResumeCell } from '@/components/ResumeCell';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { listCandidates } from '@/lib/candidates';
import { listJobs } from '@/lib/jobs';

export default async function CandidatesPage({ searchParams }: { searchParams: Promise<{ jobId?: string }> }) {
  const { jobId } = await searchParams;
  const [jobs, candidates] = await Promise.all([listJobs(), listCandidates(jobId)]);
  const now = Date.now();

  return (
    <>
      <h1 className="text-xl font-semibold">Candidates</h1>

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
        <Link href="/admin/candidates" className={jobId ? 'underline' : 'font-medium'}>All</Link>
        {jobs.map((j) => <Link key={j.id} href={`/admin/candidates?jobId=${j.id}`} className={jobId === j.id ? 'font-medium' : 'underline'}>{j.title}</Link>)}
      </div>

      {candidates.length === 0 ? (
        <p className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">No candidates yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted text-left"><tr><th className="p-3">Candidate ID</th><th className="p-3">Name</th><th className="p-3">Email</th><th className="p-3">Job</th><th className="p-3">Status</th><th className="p-3">Resume</th><th className="p-3">Review</th></tr></thead>
            <tbody>
              {candidates.map((c) => (
                <tr key={c.id} className="border-t">
                  <td className="p-3 font-mono">{c.candidateCode}</td>
                  <td className="p-3">{c.name}</td>
                  <td className="p-3">{c.email}</td>
                  <td className="p-3">{c.job.title}</td>
                  <td className="p-3">
                    <Badge tone={c.status === 'DISQUALIFIED' ? 'bad' : c.status === 'PENDING_REVIEW' ? 'warn' : 'neutral'}>{c.status.replace('_', ' ').toLowerCase()}</Badge>
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
