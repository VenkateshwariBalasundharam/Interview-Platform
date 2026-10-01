import Link from 'next/link';
import { LogoutButton } from '@/components/LogoutButton';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { requireCandidatePage } from '@/lib/auth';
import { getCandidatePipeline } from '@/lib/candidate-view';
import { ROUND_LIBRARY, type RoundType } from '@/lib/pipeline';
import { getCandidateRounds } from '@/lib/rounds';

const STATE_LABEL: Record<string, { text: string; tone: 'neutral' | 'good' | 'warn' | 'bad' }> = {
  DONE: { text: 'Completed', tone: 'good' },
  IN_PROGRESS: { text: 'In progress', tone: 'warn' },
  GRADING: { text: 'Grading', tone: 'warn' },
  AVAILABLE: { text: 'Ready', tone: 'good' },
  LOCKED: { text: 'Locked', tone: 'neutral' },
  CLOSED: { text: 'Closed', tone: 'bad' },
  SCHEDULED: { text: 'Live interview', tone: 'neutral' },
  COMING_SOON: { text: 'Coming soon', tone: 'neutral' },
};

export default async function CandidateDashboard() {
  const session = await requireCandidatePage();
  const [{ job }, { status, rounds }] = await Promise.all([getCandidatePipeline(session.jobId), getCandidateRounds(session)]);

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-8">
      <header className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold">Hello, {session.name}</h1>
          <p className="text-sm text-muted-foreground">Candidate ID {session.candidateCode} · {job.title}</p>
        </div>
        <LogoutButton endpoint="/api/candidate/auth/logout" redirectTo="/login" />
      </header>

      {status === 'DISQUALIFIED' && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="pt-5 text-sm text-red-900">
            Your results did not meet the requirement to continue in this interview. Thank you for your time.
          </CardContent>
        </Card>
      )}
      {status === 'PENDING_REVIEW' && (
        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="pt-5 text-sm text-amber-900">
            One of your rounds is being reviewed by the hiring team. You can still take any rounds that are ready below.
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Your interview rounds</CardTitle>
          <CardDescription>Rounds are taken in this order. Each one unlocks after the previous one is complete.</CardDescription>
        </CardHeader>
        <CardContent>
          <ol className="divide-y">
            {rounds.map((r, i) => {
              const lib = ROUND_LIBRARY[r.roundType as RoundType];
              const label = STATE_LABEL[r.state] ?? STATE_LABEL.LOCKED;
              return (
                <li key={r.roundType} className="flex items-center gap-4 py-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold">{i + 1}</span>
                  <div className="flex-1">
                    <div className="font-medium">{lib.label}</div>
                    <div className="text-xs text-muted-foreground">
                      {r.humanScored ? 'Live interview, scheduled by the hiring team' : `${r.durationMinutes} minutes · ${r.questionCount} question(s)`}
                    </div>
                    {r.result && (
                      <div className="mt-1 text-xs text-muted-foreground">
                        Score: {r.result.score} / {r.result.maxScore} ({r.result.percent}%)
                      </div>
                    )}
                  </div>
                  <Badge tone={label.tone}>{label.text}</Badge>
                  {(r.state === 'AVAILABLE' || r.state === 'IN_PROGRESS') && (
                    <Link href={`/round/${r.roundType}`} className="text-sm font-medium underline">
                      {r.state === 'IN_PROGRESS' ? 'Resume' : 'Start'}
                    </Link>
                  )}
                  {r.state === 'GRADING' && (
                    <Link href={`/round/${r.roundType}`} className="text-sm font-medium underline">
                      View
                    </Link>
                  )}
                  {r.state === 'DONE' && r.result && (
                    <Link href={`/round/${r.roundType}`} className="text-sm font-medium underline">
                      View result
                    </Link>
                  )}
                </li>
              );
            })}
          </ol>
        </CardContent>
      </Card>
    </main>
  );
}
