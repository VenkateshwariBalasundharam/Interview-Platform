'use client';
import { useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { apiFetch } from '@/lib/api-client';
import type { CandidateSetState } from '@/lib/personalisation';
import type { PersonalisedOverview, PersonalisedRow } from '@/lib/personalised-sets';

const STATE_BADGE: Record<CandidateSetState, { label: string; tone: 'neutral' | 'warn' | 'good' }> = {
  NO_RESUME: { label: 'Uses job-wide questions', tone: 'neutral' },
  NOT_GENERATED: { label: 'Not generated', tone: 'neutral' },
  DRAFT: { label: 'Draft', tone: 'warn' },
  APPROVED: { label: 'Approved', tone: 'good' },
  LOCKED: { label: 'Locked', tone: 'neutral' },
};

const PARALLEL = 2; // candidates generated at once: each one is already several model calls

export function PersonalisedSets({ jobId, overview, jobWideReady }: { jobId: string; overview: PersonalisedOverview; jobWideReady: boolean }) {
  const router = useRouter();
  const { roundType, rows, counts } = overview;
  const [busy, setBusy] = useState<'bulk' | 'row' | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const stop = useRef(false);

  const generatable = rows.filter((r) => r.state === 'NOT_GENERATED' && !r.started);
  const working = busy !== null;

  async function generateOne(row: PersonalisedRow) {
    await apiFetch(`/api/admin/candidates/${row.candidateId}/questions`, { method: 'POST', json: { roundType } });
  }

  async function generateMany(targets: PersonalisedRow[]) {
    setBusy('bulk');
    setError(null);
    setNotice(null);
    stop.current = false;
    const queue = [...targets];
    const failed: string[] = [];
    let done = 0;
    setProgress({ done, total: targets.length });
    const worker = async () => {
      while (queue.length > 0 && !stop.current) {
        const row = queue.shift() as PersonalisedRow;
        try {
          await generateOne(row);
        } catch (e) {
          failed.push(`${row.candidateCode}: ${e instanceof Error ? e.message : 'failed'}`);
        }
        setProgress({ done: ++done, total: targets.length });
      }
    };
    await Promise.all(Array.from({ length: PARALLEL }, worker));
    setProgress(null);
    setBusy(null);
    if (failed.length > 0) setError(`${failed.length} candidate(s) failed. Run it again to retry them. ${failed.slice(0, 3).join(' · ')}`);
    else if (stop.current) setNotice(`Stopped after ${done} of ${targets.length}.`);
    router.refresh();
  }

  async function single(row: PersonalisedRow) {
    if (row.state === 'DRAFT' && !window.confirm(`Replace ${row.name}'s draft with newly generated questions? Any edits will be lost.`)) return;
    setBusy('row');
    setError(null);
    setNotice(null);
    try {
      await generateOne(row);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setBusy(null);
    }
  }

  async function discard(row: PersonalisedRow) {
    if (!window.confirm(`Remove ${row.name}'s draft? They will use the job-wide questions again.`)) return;
    setBusy('row');
    setError(null);
    try {
      await apiFetch(`/api/admin/candidates/${row.candidateId}/questions`, { method: 'DELETE', json: { roundType } });
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setBusy(null);
    }
  }

  async function bulk(action: 'approve' | 'lock') {
    if (action === 'lock' && !window.confirm('Lock every approved set? A locked set can never be edited, reopened or regenerated.')) return;
    setBusy('bulk');
    setError(null);
    setNotice(null);
    try {
      const res = await apiFetch<{ changed: number; skipped: { candidateCode: string; reason: string }[] }>(`/api/admin/jobs/${jobId}/questions/personalised`, {
        method: 'POST',
        json: { roundType, action },
      });
      const verb = action === 'approve' ? 'Approved' : 'Locked';
      if (res.skipped.length > 0) {
        setNotice(`${verb} ${res.changed}. Skipped ${res.skipped.length}: ${res.skipped.slice(0, 3).map((s) => `${s.candidateCode} (${s.reason})`).join(', ')}${res.skipped.length > 3 ? ', …' : ''}`);
      } else setNotice(`${verb} ${res.changed} question set(s).`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex flex-wrap items-center gap-2">
            {overview.label}: personalised per candidate
            {counts.draft > 0 && <Badge tone="warn">{counts.draft} draft</Badge>}
            {counts.approved > 0 && <Badge tone="good">{counts.approved} approved</Badge>}
            {counts.locked > 0 && <Badge>{counts.locked} locked</Badge>}
          </CardTitle>
          <div className="flex flex-wrap gap-2">
            {progress && <Button variant="outline" onClick={() => { stop.current = true; }}>Stop</Button>}
            <Button variant="outline" onClick={() => generateMany(generatable)} disabled={working || generatable.length === 0}>
              {progress ? `Generating ${Math.min(progress.done + 1, progress.total)} of ${progress.total}…` : `Generate for ${generatable.length} candidate(s)`}
            </Button>
            <Button onClick={() => bulk('approve')} disabled={working || counts.draft === 0}>Approve all drafts</Button>
            <Button variant="outline" onClick={() => bulk('lock')} disabled={working || counts.approved === 0}>Lock all approved</Button>
          </div>
        </div>
        <CardDescription>
          Each candidate gets {overview.requiredQuestions} questions written from their own parsed resume. A candidate whose resume has no {roundType === 'TECHNICAL' ? 'skills' : 'projects'} (or no resume) gets the job-wide questions above
          {jobWideReady ? '' : ', which are not approved yet'}. A candidate with a draft cannot start the round until it is approved or removed.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && <Alert tone="error">{error}</Alert>}
        {notice && <Alert tone="warn">{notice}</Alert>}
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No candidates are registered for this job yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted text-left">
                <tr><th className="p-3">Candidate ID</th><th className="p-3">Name</th><th className="p-3">Questions</th><th className="p-3">Actions</th></tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const badge = STATE_BADGE[r.state];
                  return (
                    <tr key={r.candidateId} className="border-t align-top">
                      <td className="p-3 font-mono">{r.candidateCode}</td>
                      <td className="p-3">{r.name}</td>
                      <td className="p-3">
                        <Badge tone={badge.tone}>{badge.label}</Badge>
                        {r.setId && <span className="ml-2 text-xs text-muted-foreground">{r.questionCount} of {overview.requiredQuestions} · v{r.version}</span>}
                        {r.started && <span className="ml-2 text-xs text-muted-foreground">started</span>}
                        {r.reason && <p className="mt-1 text-xs text-muted-foreground">{r.reason}</p>}
                      </td>
                      <td className="p-3">
                        <div className="flex flex-wrap gap-2">
                          {r.setId && <Button asChild variant="outline" size="sm"><Link href={`/admin/candidates/${r.candidateId}/questions/${roundType}`}>Review</Link></Button>}
                          {(r.state === 'NOT_GENERATED' || r.state === 'DRAFT') && !r.started && (
                            <Button variant="outline" size="sm" onClick={() => single(r)} disabled={working}>{r.state === 'DRAFT' ? 'Regenerate' : 'Generate'}</Button>
                          )}
                          {r.state === 'DRAFT' && <Button variant="ghost" size="sm" onClick={() => discard(r)} disabled={working}>Remove draft</Button>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
