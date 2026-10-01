import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ManagerScoreForm } from '@/components/ManagerScoreForm';
import { ResultDecision } from '@/components/ResultDecision';
import { SUGGESTION_LABEL } from '@/lib/final-result';
import type { CandidateResultView } from '@/lib/results';

const TONE = { SHORTLIST: 'good', REJECT: 'bad', REVIEW: 'warn' } as const;

/** Admin view: weighted result, the suggested decision, the Manager interview score and the final decision. */
export function FinalResultCard({ candidateId, view }: { candidateId: string; view: CandidateResultView }) {
  const { result, managerRound, finalDecision } = view;
  return (
    <>
      {managerRound.exists && (
        <Card>
          <CardHeader>
            <CardTitle>Manager interview</CardTitle>
            <CardDescription>A live interview outside the platform. Enter the score and your notes here after it.</CardDescription>
          </CardHeader>
          <CardContent>
            <ManagerScoreForm candidateId={candidateId} initialScore={managerRound.score} initialNotes={managerRound.notes} canScore={managerRound.canScore} blockedReason={managerRound.blockedReason} />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle>Final result</CardTitle>
            {finalDecision ? <Badge tone={finalDecision === 'SHORTLIST' ? 'good' : 'bad'}>decided: {SUGGESTION_LABEL[finalDecision].toLowerCase()}</Badge> : result.suggestion && <Badge tone="warn">waiting for your decision</Badge>}
          </div>
          <CardDescription>
            Weighted score <span className="font-medium text-foreground">{result.weightedScore}</span> / 100. Rounds without a score yet count as 0. The decision below is a suggestion; nothing is final until you confirm it.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="py-1 pr-3">Round</th>
                  <th className="py-1 pr-3">Score</th>
                  <th className="py-1 pr-3">Cutoff</th>
                  <th className="py-1 pr-3">Weight</th>
                  <th className="py-1">Adds</th>
                </tr>
              </thead>
              <tbody>
                {result.rounds.map((r) => (
                  <tr key={r.roundType} className="border-t">
                    <td className="py-1.5 pr-3">{r.label}</td>
                    <td className="py-1.5 pr-3">
                      {r.percent === null ? <span className="text-muted-foreground">—</span> : <Badge tone={r.passed ? 'good' : 'warn'}>{r.percent}%</Badge>}
                    </td>
                    <td className="py-1.5 pr-3">{r.cutoffPercent}%</td>
                    <td className="py-1.5 pr-3">{r.counted ? `${r.weightPercent}%` : 'not counted'}</td>
                    <td className="py-1.5 font-mono text-xs">{r.contribution.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {result.suggestion === null ? (
            <p className="text-sm text-muted-foreground">The interview is still running, so there is no suggestion yet.</p>
          ) : (
            <>
              <div className="space-y-1 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-muted-foreground">Suggested:</span>
                  <Badge tone={TONE[result.suggestion]}>{SUGGESTION_LABEL[result.suggestion].toLowerCase()}</Badge>
                </div>
                {result.reasons.map((reason) => (
                  <p key={reason} className="text-muted-foreground">{reason}</p>
                ))}
                {result.suggestion === 'REJECT' && result.rejectionRestsOnAi && (
                  <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">
                    This rejection rests on answers scored by the AI. Read those answers above before you confirm it.
                  </p>
                )}
              </div>
              <ResultDecision candidateId={candidateId} suggestion={result.suggestion} finalDecision={finalDecision} />
              {view.decidedAt && (
                <p className="text-xs text-muted-foreground">
                  Decided {new Date(view.decidedAt).toUTCString()}
                  {view.decidedByName ? ` by ${view.decidedByName}` : ''}.
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </>
  );
}
