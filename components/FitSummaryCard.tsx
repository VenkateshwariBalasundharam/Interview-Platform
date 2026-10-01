'use client';
import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { apiFetch } from '@/lib/api-client';
import type { FitSummaryState } from '@/lib/fit-summaries';

const FIT_LABEL = { STRONG: 'Strong fit', GOOD: 'Good fit', PARTIAL: 'Partial fit', WEAK: 'Weak fit' } as const;
const FIT_TONE = { STRONG: 'good', GOOD: 'good', PARTIAL: 'warn', WEAK: 'bad' } as const;
const EVIDENCE_TONE = { strong: 'good', some: 'warn', none: 'bad', unknown: 'neutral' } as const;

export function FitSummaryCard({ candidateId, initial }: { candidateId: string; initial: FitSummaryState }) {
  const [state, setState] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      setState(await apiFetch<FitSummaryState>(`/api/admin/candidates/${candidateId}/fit-summary`, { method: 'POST' }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not write the summary.');
    } finally {
      setBusy(false);
    }
  }

  const s = state.summary;
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <CardTitle>Job-fit summary</CardTitle>
            {s && <Badge tone={FIT_TONE[s.fit]}>{FIT_LABEL[s.fit]}</Badge>}
          </div>
          {state.canGenerate && (
            <Button size="sm" variant="outline" onClick={generate} disabled={busy}>
              {busy ? 'Writing…' : s ? 'Regenerate' : 'Generate summary'}
            </Button>
          )}
        </div>
        <CardDescription>
          Written by the AI from the job description, the parsed resume and the HR answers. It is advice for the hiring team and does not change any score or decision.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {error && <Alert tone="error">{error}</Alert>}
        {!state.canGenerate && !s && <p className="text-muted-foreground">{state.reason}</p>}
        {state.canGenerate && !s && !busy && <p className="text-muted-foreground">No summary yet. Generating one sends the job description, the parsed resume (skills and projects) and the HR answers to the AI provider.</p>}

        {s && (
          <>
            {s.answersFlagged && <Alert tone="warn">An HR answer contains text aimed at the AI (for example asking for a high rating). Read the answers yourself before relying on this summary.</Alert>}
            {!s.hadResume && <Alert tone="info">No parsed resume was available, so this summary is based on the HR answers only.</Alert>}
            <p>{s.summary}</p>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <div className="text-xs font-medium text-muted-foreground">Strengths</div>
                {s.strengths.length ? <ul className="mt-1 list-disc space-y-0.5 pl-5">{s.strengths.map((t, i) => <li key={i}>{t}</li>)}</ul> : <p className="text-muted-foreground">None noted.</p>}
              </div>
              <div>
                <div className="text-xs font-medium text-muted-foreground">Gaps</div>
                {s.gaps.length ? <ul className="mt-1 list-disc space-y-0.5 pl-5">{s.gaps.map((t, i) => <li key={i}>{t}</li>)}</ul> : <p className="text-muted-foreground">None noted.</p>}
              </div>
            </div>

            {s.skills.length > 0 && (
              <div>
                <div className="text-xs font-medium text-muted-foreground">Required skills: evidence found</div>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {s.skills.map((k) => (
                    <Badge key={k.skill} tone={EVIDENCE_TONE[k.evidence]}>
                      {k.skill} · {k.evidence}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {s.followUps.length > 0 && (
              <div>
                <div className="text-xs font-medium text-muted-foreground">Questions for the live interview</div>
                <ul className="mt-1 list-disc space-y-0.5 pl-5">{s.followUps.map((t, i) => <li key={i}>{t}</li>)}</ul>
              </div>
            )}
            <p className="text-xs text-muted-foreground">Written {new Date(s.generatedAt).toLocaleString()}</p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
