import type { ReactNode } from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { RoundInfo, RoundResult } from '@/lib/round-engine';
import { verdictMessage } from '@/lib/round-engine';

const VERDICT_TONE = { PASSED: 'good', FLAGGED: 'warn', DISQUALIFIED: 'bad' } as const;

export function RoundResultView({
  round,
  result,
  nextHref,
  children,
}: {
  round: RoundInfo;
  result: RoundResult;
  nextHref: string | null;
  children?: ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{round.label} — result</CardTitle>
        <CardDescription>
          Score: {result.score} / {result.maxScore} ({result.percent}%)
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Badge tone={VERDICT_TONE[result.verdict]}>{result.verdict.replace('_', ' ').toLowerCase()}</Badge>
        <p className="text-sm text-muted-foreground">{verdictMessage(result.verdict)}</p>
        {round.aiGraded && <p className="text-xs text-muted-foreground">Typed answers were scored automatically and may be reviewed by the hiring team.</p>}
        <div className="flex items-center gap-4">
          {nextHref && (
            <Link href={nextHref} className="text-sm font-medium underline">
              Continue to the next round
            </Link>
          )}
          {children}
        </div>
      </CardContent>
    </Card>
  );
}
