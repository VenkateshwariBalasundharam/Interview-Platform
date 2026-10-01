'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { apiFetch } from '@/lib/api-client';
import type { RoundInfo } from '@/lib/round-engine';

export function RoundIntro({ round, canStart, blockedReason }: { round: RoundInfo; canStart: boolean; blockedReason: string | null }) {
  const router = useRouter();
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setStarting(true);
    setError(null);
    try {
      await apiFetch(`/api/candidate/rounds/${round.roundType}/start`, { method: 'POST' });
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start this round.');
      setStarting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{round.label}</CardTitle>
        <CardDescription>
          {round.durationMinutes} minutes · {round.questionCount} {round.roundType === 'CODING' ? 'problem(s)' : 'question(s)'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {blockedReason && <Alert tone="info">{blockedReason}</Alert>}
        {error && <Alert tone="error">{error}</Alert>}
        {canStart && (
          <>
            <p className="text-sm text-muted-foreground">
              Once you start, the timer begins immediately and keeps running even if you close this tab. Answers are saved automatically as you go.
            </p>
            {round.roundType === 'CODING' && (
              <p className="text-sm text-muted-foreground">
                You will solve programming problems in a code editor. Run code checks your program against the sample tests. Submit code also runs hidden tests and counts towards your score, and your best submission for each problem is the one that counts. You can use Python, JavaScript, Java, C++, C or Go.
              </p>
            )}
            {round.aiGraded && (
              <p className="text-sm text-muted-foreground">
                Multiple-choice answers are marked automatically. Typed answers are scored by an AI against a rubric, and the hiring team may review the result.
              </p>
            )}
            <Button onClick={start} disabled={starting}>
              {starting ? 'Starting…' : 'Start round'}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
