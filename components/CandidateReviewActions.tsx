'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/lib/api-client';
import type { RoundType } from '@/lib/pipeline';

/**
 * Approve / reject a flagged candidate, and grade any typed answers that are still unscored.
 * `compact` is the inline version used in the candidates table.
 */
export function CandidateReviewActions({
  candidateId,
  canReview,
  ungradedRounds,
  compact = false,
}: {
  candidateId: string;
  canReview: boolean;
  /** Rounds that were submitted but still have unscored typed answers. */
  ungradedRounds: RoundType[];
  compact?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(label: string, fn: () => Promise<unknown>, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(label);
    setError(null);
    try {
      await fn();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusy(null);
    }
  }

  const review = (decision: 'APPROVE' | 'REJECT') =>
    run(
      decision,
      () => apiFetch(`/api/admin/candidates/${candidateId}/review`, { method: 'POST', json: { decision } }),
      decision === 'REJECT' ? 'Reject this candidate? Their remaining rounds will be closed.' : undefined,
    );
  const grade = (roundType: RoundType) =>
    run(`grade-${roundType}`, () => apiFetch(`/api/admin/candidates/${candidateId}/regrade`, { method: 'POST', json: { roundType } }));

  const size = compact ? 'sm' : 'default';
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap gap-2">
        {canReview && (
          <>
            <Button size={size} onClick={() => review('APPROVE')} disabled={busy !== null}>
              {busy === 'APPROVE' ? 'Approving…' : 'Approve'}
            </Button>
            <Button size={size} variant="outline" onClick={() => review('REJECT')} disabled={busy !== null}>
              {busy === 'REJECT' ? 'Rejecting…' : 'Reject'}
            </Button>
          </>
        )}
        {ungradedRounds.map((roundType) => (
          <Button key={roundType} size={size} variant="outline" onClick={() => grade(roundType)} disabled={busy !== null}>
            {busy === `grade-${roundType}` ? 'Grading…' : compact ? 'Grade now' : `Grade ${roundType.replace('_', ' ').toLowerCase()} now`}
          </Button>
        ))}
      </div>
      {error && <p className="text-xs text-red-700">{error}</p>}
    </div>
  );
}
