'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { apiFetch } from '@/lib/api-client';

/** The admin enters the score (0 to 100) and private notes from the live Manager interview. */
export function ManagerScoreForm({ candidateId, initialScore, initialNotes, canScore, blockedReason }: { candidateId: string; initialScore: number | null; initialNotes: string | null; canScore: boolean; blockedReason: string | null }) {
  const router = useRouter();
  const [score, setScore] = useState(initialScore === null ? '' : String(initialScore));
  const [notes, setNotes] = useState(initialNotes ?? '');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function save() {
    const n = Number(score);
    if (score.trim() === '' || !Number.isInteger(n) || n < 0 || n > 100) {
      setMessage({ ok: false, text: 'Enter a whole number from 0 to 100.' });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      await apiFetch(`/api/admin/candidates/${candidateId}/manager-score`, { method: 'PUT', json: { score: n, notes: notes.trim() || undefined } });
      setMessage({ ok: true, text: 'Saved.' });
      router.refresh();
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : 'Something went wrong.' });
    } finally {
      setBusy(false);
    }
  }

  if (!canScore && initialScore === null) return <p className="text-sm text-muted-foreground">{blockedReason ?? 'The interview cannot be scored yet.'}</p>;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="manager-score">Score (0 to 100)</Label>
          <Input id="manager-score" type="number" inputMode="numeric" min={0} max={100} step={1} className="w-28" value={score} onChange={(e) => setScore(e.target.value)} disabled={!canScore || busy} />
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor="manager-notes">Private notes (the candidate never sees these)</Label>
        <textarea
          id="manager-notes"
          rows={3}
          maxLength={2000}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          disabled={!canScore || busy}
          className="flex w-full rounded-md border border-input bg-card px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
        />
      </div>
      <div className="flex items-center gap-3">
        <Button onClick={save} disabled={!canScore || busy}>
          {busy ? 'Saving…' : initialScore === null ? 'Save score' : 'Update score'}
        </Button>
        {message && <span className={`text-xs ${message.ok ? 'text-emerald-700' : 'text-red-700'}`}>{message.text}</span>}
      </div>
      {!canScore && blockedReason && <p className="text-xs text-muted-foreground">{blockedReason}</p>}
    </div>
  );
}
