import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { SUGGESTION_LABEL } from '@/lib/final-result';
import { listJobs } from '@/lib/jobs';
import { ROUND_LIBRARY, ROUND_TYPES } from '@/lib/pipeline';
import { listResults } from '@/lib/results';

const STATUS_TONE = { ACTIVE: 'neutral', COMPLETED: 'good', PENDING_REVIEW: 'warn', DISQUALIFIED: 'bad' } as const;
const SUGGESTION_TONE = { SHORTLIST: 'good', REJECT: 'bad', REVIEW: 'warn' } as const;

export default async function ResultsPage({ searchParams }: { searchParams: Promise<{ jobId?: string }> }) {
  const { jobId } = await searchParams;
  const [jobs, rows] = await Promise.all([listJobs(), listResults(jobId)]);
  const types = ROUND_TYPES.filter((t) => rows.some((r) => r.roundPercents[t] !== undefined));
  const pending = rows.filter((r) => r.suggestion !== null && r.finalDecision === null).length;

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Results</h1>
          <p className="text-sm text-muted-foreground">
            Weighted scores and suggested decisions. A suggestion is never final until an admin confirms it. {pending > 0 && <span className="font-medium text-foreground">{pending} waiting for a decision.</span>}
          </p>
        </div>
        <a href={`/api/admin/results/export${jobId ? `?jobId=${encodeURIComponent(jobId)}` : ''}`} className="rounded-md border bg-card px-3 py-1.5 text-sm hover:bg-muted">
          Download CSV
        </a>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">Filter by job:</span>
        <Link href="/admin/results" className={jobId ? 'underline' : 'font-medium'}>All</Link>
        {jobs.map((j) => (
          <Link key={j.id} href={`/admin/results?jobId=${j.id}`} className={jobId === j.id ? 'font-medium' : 'underline'}>
            {j.title}
          </Link>
        ))}
      </div>

      {rows.length === 0 ? (
        <p className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">No candidates yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted text-left">
              <tr>
                <th className="p-3">Candidate</th>
                <th className="p-3">Job</th>
                <th className="p-3">Status</th>
                {types.map((t) => (
                  <th key={t} className="p-3">{ROUND_LIBRARY[t].label}</th>
                ))}
                <th className="p-3">Weighted</th>
                <th className="p-3">Suggested</th>
                <th className="p-3">Decision</th>
                <th className="p-3">Proctoring</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="p-3">
                    <Link href={`/admin/candidates/${r.id}`} className="underline">{r.name}</Link>
                    <div className="font-mono text-xs text-muted-foreground">{r.candidateCode}</div>
                  </td>
                  <td className="p-3">{r.jobTitle}</td>
                  <td className="p-3"><Badge tone={STATUS_TONE[r.status as keyof typeof STATUS_TONE] ?? 'neutral'}>{r.status.replace('_', ' ').toLowerCase()}</Badge></td>
                  {types.map((t) => (
                    <td key={t} className="p-3">{r.roundPercents[t] === undefined ? '' : r.roundPercents[t] === null ? <span className="text-muted-foreground">—</span> : `${r.roundPercents[t]}%`}</td>
                  ))}
                  <td className="p-3 font-medium">{r.weightedScore === null ? '—' : r.weightedScore}</td>
                  <td className="p-3">
                    {r.suggestion ? <Badge tone={SUGGESTION_TONE[r.suggestion]}>{SUGGESTION_LABEL[r.suggestion].toLowerCase()}</Badge> : <span className="text-muted-foreground">in progress</span>}
                    {r.suggestion === 'REJECT' && r.rejectionRestsOnAi && <div className="mt-1 text-xs text-amber-800">rests on AI-graded answers</div>}
                  </td>
                  <td className="p-3">
                    {r.finalDecision ? <Badge tone={r.finalDecision === 'SHORTLIST' ? 'good' : 'bad'}>{SUGGESTION_LABEL[r.finalDecision].toLowerCase()}</Badge> : r.suggestion ? <span className="text-amber-800">pending</span> : ''}
                  </td>
                  <td className="p-3">{r.proctorEvents === 0 ? <span className="text-muted-foreground">none</span> : `${r.proctorEvents} event${r.proctorEvents === 1 ? '' : 's'}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-muted-foreground">Showing up to 500 candidates. Rounds a candidate has not finished count as 0 in the weighted score.</p>
    </>
  );
}
