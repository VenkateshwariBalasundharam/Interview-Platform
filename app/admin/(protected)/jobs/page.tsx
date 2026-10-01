import Link from 'next/link';
import { DeleteButton } from '@/components/DeleteButton';
import { JobEditButton } from '@/components/JobEditButton';
import { JobDeleteWarning } from '@/components/JobActions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { jobDeleteEndpoint } from '@/lib/delete-job-ui';
import { listJobs } from '@/lib/jobs';
import { TIER_PRESETS } from '@/lib/pipeline';

export default async function JobsPage() {
  const jobs = await listJobs();
  return (
    <>
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Jobs</h1>
        <Button asChild><Link href="/admin/jobs/new">New job</Link></Button>
      </div>
      {jobs.length === 0 ? (
        <p className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">No jobs yet. Create one to set up its interview pipeline.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted text-left"><tr><th className="p-3">Title</th><th className="p-3">Tier</th><th className="p-3">Rounds</th><th className="p-3">Candidates</th><th className="p-3">Final result</th><th className="p-3"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id} className="border-t">
                  <td className="p-3"><Link href={`/admin/jobs/${j.id}`} className="font-medium underline-offset-2 hover:underline">{j.title}</Link></td>
                  <td className="p-3">{TIER_PRESETS[j.tier].label}</td>
                  <td className="p-3">{j.enabledRounds}</td>
                  <td className="p-3">{j.candidateCount}</td>
                  <td className="p-3"><Badge>{j.resultMode === 'AUTO_SUGGEST' ? 'Auto-suggest' : 'Human review'}</Badge></td>
                  <td className="p-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                    <JobEditButton job={{ id: j.id, title: j.title, jdText: j.jdText, requiredSkills: j.requiredSkills, tier: j.tier, resultMode: j.resultMode, retakePolicy: j.retakePolicy, started: j.started }} />
                    <DeleteButton endpoint={jobDeleteEndpoint(j.id, j.candidateCount)} dialogTitle={`Delete “${j.title}”?`} phrase={j.candidateCount > 0 ? j.title : undefined}>
                      <JobDeleteWarning candidateCount={j.candidateCount} />
                    </DeleteButton>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
