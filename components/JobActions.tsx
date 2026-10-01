'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { DeleteButton } from '@/components/DeleteButton';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/lib/api-client';
import { jobDeleteEndpoint } from '@/lib/delete-job-ui';

export function JobActions({ jobId, jobTitle, candidateCount }: { jobId: string; jobTitle: string; candidateCount: number }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function clone() {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch<{ job: { id: string } }>(`/api/admin/jobs/${jobId}/clone`, { method: 'POST' });
      router.push(`/admin/jobs/${res.job.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not clone the job');
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Button variant="outline" onClick={clone} disabled={busy}>Clone job</Button>
        <DeleteButton endpoint={jobDeleteEndpoint(jobId, candidateCount)} dialogTitle="Delete this job?" phrase={candidateCount > 0 ? jobTitle : undefined} redirectTo="/admin/jobs" size="default" label="Delete job">
          <JobDeleteWarning candidateCount={candidateCount} />
        </DeleteButton>
      </div>
      {error && <Alert tone="error">{error}</Alert>}
    </div>
  );
}

export function JobDeleteWarning({ candidateCount }: { candidateCount: number }) {
  return candidateCount > 0 ? (
    <>
      <p>
        This job has <strong className="text-foreground">{candidateCount} registered candidate(s)</strong>. Deleting it also permanently deletes those candidates with their answers, scores, results and resume files.
      </p>
      <p>The job, its pipeline and its question sets are removed. This cannot be undone.</p>
    </>
  ) : (
    <p>The job, its pipeline and its question sets are removed. This cannot be undone.</p>
  );
}
