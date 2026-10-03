'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/lib/api-client';
import type { RoundType } from '@/lib/pipeline';

/** Lets an admin reset one round for this candidate so they can retake it. Asks for a reason, which goes to the audit log. */
export function ResetRoundButton({ candidateId, roundType, label, inProgress }: { candidateId: string; roundType: RoundType; label: string; inProgress: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/admin/candidates/${candidateId}/rounds/${roundType}/reset`, { method: 'POST', json: { reason } });
      setOpen(false);
      setReason('');
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        Reset {label.toLowerCase()} round
      </Button>
    );
  }
  return (
    <div className="w-full max-w-md space-y-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
      <p className="font-medium">Reset the {label} round for this candidate?</p>
      <p>
        {inProgress ? 'Their round in progress ends now. ' : ''}Their answers and score for this round, its proctoring log, their final result and job-fit summary are deleted, and they can start the round again with a fresh timer. This cannot be undone.
      </p>
      <label className="block text-xs font-medium" htmlFor={`reset-reason-${roundType}`}>
        Reason (saved in the audit log)
      </label>
      <textarea
        id={`reset-reason-${roundType}`}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        maxLength={500}
        rows={2}
        placeholder="For example: power cut at minute 12, confirmed by phone"
        className="w-full rounded-md border border-amber-300 bg-white p-2 text-sm text-foreground"
      />
      {error && <p role="alert" className="text-red-700">{error}</p>}
      <div className="flex gap-2">
        <Button size="sm" onClick={submit} disabled={busy || reason.trim().length < 5}>
          {busy ? 'Resetting…' : 'Reset round'}
        </Button>
        <Button size="sm" variant="outline" onClick={() => { setOpen(false); setError(null); }} disabled={busy}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
