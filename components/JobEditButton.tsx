'use client';
import { useEffect, useId, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { JobForm, type JobFormValues } from '@/components/JobForm';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/lib/api-client';

export interface EditableJob extends JobFormValues {
  id: string;
  /** True once any candidate has started a round: description, skills, tier and result mode are then locked. */
  started: boolean;
}

/** An Edit button that opens the job details in a dialog. Once candidates have started, the locked fields are read-only and a clone is offered. */
export function JobEditButton({ job, size = 'sm', label = 'Edit' }: { job: EditableJob; size?: 'sm' | 'default'; label?: string }) {
  const router = useRouter();
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const [cloning, setCloning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !cloning) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, cloning]);

  async function clone() {
    setCloning(true);
    setError(null);
    try {
      const res = await apiFetch<{ job: { id: string } }>(`/api/admin/jobs/${job.id}/clone`, { method: 'POST' });
      router.push(`/admin/jobs/${res.job.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not clone the job');
      setCloning(false);
    }
  }

  const { id, started, ...initial } = job;

  return (
    <>
      <Button variant="outline" size={size} onClick={() => { setError(null); setOpen(true); }}>{label}</Button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4" onMouseDown={(e) => e.target === e.currentTarget && !cloning && setOpen(false)}>
          <div role="dialog" aria-modal="true" aria-labelledby={titleId} className="my-8 w-full max-w-2xl space-y-4 rounded-lg border bg-card p-5 text-left shadow-lg">
            <div>
              <h2 id={titleId} className="text-base font-semibold">Edit job</h2>
              <p className="text-xs text-muted-foreground">
                Need to change rounds, cutoffs, weights or questions? <Link href={`/admin/jobs/${id}`} className="underline">Open the job page</Link>.
              </p>
            </div>

            {started && (
              <Alert tone="warn">
                Candidates have started this job, so only the title and retake policy can be changed here. To change the description, skills, level or result mode, clone the job.
                <div className="mt-2">
                  <Button type="button" variant="outline" size="sm" onClick={clone} disabled={cloning}>{cloning ? 'Cloning…' : 'Clone job and edit the copy'}</Button>
                </div>
              </Alert>
            )}
            {error && <Alert tone="error">{error}</Alert>}

            <JobForm jobId={id} initial={initial} locked={started} onSaved={() => setOpen(false)} onCancel={() => setOpen(false)} />
          </div>
        </div>
      )}
    </>
  );
}
