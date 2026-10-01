'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { apiFetch } from '@/lib/api-client';
import type { RoundInfo, RoundPageState } from '@/lib/round-engine';

const POLL_MS = 3000;
const RETRY_MS = 8000;
const MAX_POLLS = 40; // about two minutes of waiting on a grading run that another tab or request started
const MAX_ERRORS = 4;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Shown while a submitted round's typed answers are being scored. It asks the server to grade (safe to repeat),
 * then reloads the page when the result is ready. If grading keeps failing it stops and offers a manual retry.
 */
export function GradingPending({ round }: { round: RoundInfo }) {
  const router = useRouter();
  const [attempt, setAttempt] = useState(0); // bumped by "Try again"
  const [stalled, setStalled] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setStalled(false);
    setMessage(null);

    async function run() {
      let errors = 0;
      for (let polls = 0; polls < MAX_POLLS && !cancelled; polls++) {
        try {
          const { state } = await apiFetch<{ state: RoundPageState }>(`/api/candidate/rounds/${round.roundType}/grade`, { method: 'POST' });
          if (cancelled) return;
          if (state.phase !== 'grading') {
            router.refresh();
            return;
          }
          await sleep(POLL_MS); // another request is grading it: check again shortly
        } catch (e) {
          if (cancelled) return;
          errors++;
          setMessage(e instanceof Error ? e.message : 'Grading is taking longer than expected.');
          if (errors >= MAX_ERRORS) break;
          await sleep(RETRY_MS);
        }
      }
      if (!cancelled) setStalled(true);
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [round.roundType, router, attempt]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{round.label} submitted</CardTitle>
        <CardDescription>Your answers were received and are being graded.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!stalled ? (
          <p className="text-sm text-muted-foreground" role="status">
            This usually takes under a minute. Keep this page open; it updates by itself.
          </p>
        ) : (
          <>
            <Alert tone="warn">Grading is taking longer than expected. Your answers are safe. You can try again, or come back later and the hiring team can grade them.</Alert>
            <Button onClick={() => setAttempt((n) => n + 1)}>Try again</Button>
          </>
        )}
        {message && !stalled && <p className="text-xs text-muted-foreground">{message}</p>}
      </CardContent>
    </Card>
  );
}
