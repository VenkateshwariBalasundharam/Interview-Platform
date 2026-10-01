'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/lib/api-client';
import { SUGGESTION_LABEL, type Decision, type Suggestion } from '@/lib/final-result';

/** Confirm the suggestion or override it. The result stays "pending" until a person presses one of these. */
export function ResultDecision({ candidateId, suggestion, finalDecision }: { candidateId: string; suggestion: Suggestion; finalDecision: Decision | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState<Decision | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(decision: Decision) {
    const overriding = suggestion !== 'REVIEW' && suggestion !== decision;
    const text = overriding
      ? `The suggestion was "${SUGGESTION_LABEL[suggestion]}". Record "${SUGGESTION_LABEL[decision]}" instead?`
      : decision === 'REJECT'
        ? 'Record this candidate as rejected?'
        : 'Record this candidate as shortlisted?';
    if (!window.confirm(text)) return;
    setBusy(decision);
    setError(null);
    try {
      await apiFetch(`/api/admin/candidates/${candidateId}/decision`, { method: 'POST', json: { decision } });
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusy(null);
    }
  }

  const label = (d: Decision) => {
    if (busy === d) return 'Saving…';
    if (finalDecision === d) return `${SUGGESTION_LABEL[d]} (current)`;
    if (suggestion === d) return `Confirm: ${SUGGESTION_LABEL[d].toLowerCase()}`;
    return suggestion === 'REVIEW' ? SUGGESTION_LABEL[d] : `Override: ${SUGGESTION_LABEL[d].toLowerCase()}`;
  };

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => decide('SHORTLIST')} disabled={busy !== null || finalDecision === 'SHORTLIST'} variant={suggestion === 'SHORTLIST' ? 'default' : 'outline'}>
          {label('SHORTLIST')}
        </Button>
        <Button onClick={() => decide('REJECT')} disabled={busy !== null || finalDecision === 'REJECT'} variant={suggestion === 'REJECT' ? 'default' : 'outline'}>
          {label('REJECT')}
        </Button>
      </div>
      {error && <p className="text-xs text-red-700">{error}</p>}
    </div>
  );
}
