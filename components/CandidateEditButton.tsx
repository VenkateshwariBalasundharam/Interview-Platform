'use client';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { JobPicker } from '@/components/JobPicker';
import { Label } from '@/components/ui/label';
import { apiFetch } from '@/lib/api-client';

export interface EditableCandidate {
  id: string;
  candidateCode: string;
  name: string;
  email: string;
  /** The job the candidate is registered for. Needed (with `jobs`) to show the job role picker. */
  jobId?: string;
  /** True once any round has been started: the job can no longer be changed. */
  hasStarted?: boolean;
}

/** An Edit button that opens a form for the candidate's name, email, job role, date of birth (password) and login lock. */
export function CandidateEditButton({ candidate, jobs, size = 'sm', label = 'Edit' }: { candidate: EditableCandidate; jobs?: { id: string; title: string }[]; size?: 'sm' | 'default'; label?: string }) {
  const router = useRouter();
  const titleId = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(candidate.name);
  const [email, setEmail] = useState(candidate.email);
  const [jobId, setJobId] = useState(candidate.jobId ?? '');
  const [dob, setDob] = useState('');
  const [unlock, setUnlock] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function openDialog() {
    setName(candidate.name);
    setEmail(candidate.email);
    setJobId(candidate.jobId ?? '');
    setDob('');
    setUnlock(false);
    setError(null);
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;
    nameRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, busy]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const patch: { name?: string; email?: string; jobId?: string; dob?: string; unlock?: boolean } = {};
    if (name.trim() !== candidate.name) patch.name = name.trim();
    if (email.trim().toLowerCase() !== candidate.email.toLowerCase()) patch.email = email.trim();
    if (canEditJob && jobId && jobId !== candidate.jobId) patch.jobId = jobId;
    if (dob) patch.dob = dob;
    if (unlock) patch.unlock = true;
    if (canEditJob && !jobId) {
      setError('Pick a job from the list.');
      return;
    }
    if (Object.keys(patch).length === 0) {
      setError('Nothing has changed.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/admin/candidates/${candidate.id}`, { method: 'PATCH', json: patch });
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the changes.');
    } finally {
      setBusy(false);
    }
  }

  const today = new Date().toISOString().slice(0, 10);
  const showJob = Boolean(jobs && candidate.jobId);
  const canEditJob = showJob && !candidate.hasStarted;
  const currentJobTitle = jobs?.find((j) => j.id === candidate.jobId)?.title ?? '';

  return (
    <>
      <Button variant="outline" size={size} onClick={openDialog}>{label}</Button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onMouseDown={(e) => e.target === e.currentTarget && !busy && setOpen(false)}>
          <form onSubmit={submit} role="dialog" aria-modal="true" aria-labelledby={titleId} className="w-full max-w-md space-y-4 rounded-lg border bg-card p-5 shadow-lg">
            <div>
              <h2 id={titleId} className="text-base font-semibold">Edit candidate</h2>
              <p className="text-xs text-muted-foreground">Candidate ID <span className="font-mono">{candidate.candidateCode}</span> does not change.</p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor={`${titleId}-name`}>Name</Label>
              <Input id={`${titleId}-name`} ref={nameRef} value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required disabled={busy} />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor={`${titleId}-email`}>Email</Label>
              <Input id={`${titleId}-email`} type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={254} required disabled={busy} />
            </div>

            {showJob && (
              <div className="space-y-1.5">
                <Label htmlFor={`${titleId}-job`}>Job role</Label>
                {canEditJob ? (
                  <>
                    <JobPicker id={`${titleId}-job`} jobs={jobs ?? []} value={jobId} onChange={setJobId} />
                    <p className="text-xs text-muted-foreground">Entered the wrong role? Pick the right job. Their personalised questions and job-fit summary are made again for the new job.</p>
                  </>
                ) : (
                  <>
                    <Input id={`${titleId}-job`} value={currentJobTitle} readOnly disabled />
                    <p className="text-xs text-muted-foreground">This candidate has already started a round, so the job can’t be changed. To move them, reset their rounds first, or delete and register them again under the right job.</p>
                  </>
                )}
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor={`${titleId}-dob`}>New date of birth (optional)</Label>
              <Input id={`${titleId}-dob`} type="date" value={dob} max={today} onChange={(e) => setDob(e.target.value)} disabled={busy} />
              <p className="text-xs text-muted-foreground">Leave blank to keep the current one. A new date becomes the new password, ends the candidate’s current session and clears any login lock.</p>
            </div>

            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-0.5" checked={unlock} onChange={(e) => setUnlock(e.target.checked)} disabled={busy} />
              <span>Unlock login (clear failed attempts)</span>
            </label>

            {error && <Alert tone="error">{error}</Alert>}

            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
              <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</Button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
