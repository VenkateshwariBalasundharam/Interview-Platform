import Link from 'next/link';
import { ChevronDown } from 'lucide-react';
import { notFound } from 'next/navigation';
import { CandidateEditButton } from '@/components/CandidateEditButton';
import { CandidateReviewActions } from '@/components/CandidateReviewActions';
import { DeleteButton } from '@/components/DeleteButton';
import { FinalResultCard } from '@/components/FinalResultCard';
import { FitSummaryCard } from '@/components/FitSummaryCard';
import { AnswerFeedback, HrRubricHelp } from '@/components/HrRubricBreakdown';
import { ResetRoundButton } from '@/components/ResetRoundButton';
import { ProctorTimeline } from '@/components/proctoring/ProctorTimeline';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getCandidateReview, type ReviewAttempt } from '@/lib/attempt-review';
import { getFitSummaryState } from '@/lib/fit-summaries';
import { getProctoringReport } from '@/lib/proctoring';
import { decisionBadge } from '@/lib/final-result';
import { getCandidateResult } from '@/lib/results';
import { AppError } from '@/lib/http';
import { CODING_POINTS_PER_PROBLEM, verdictLabel } from '@/lib/coding';
import { KIND_LABEL } from '@/lib/questions';

const VERDICT_TONE = { PASSED: 'good', FLAGGED: 'warn', DISQUALIFIED: 'bad' } as const;
const STATUS_TONE = { ACTIVE: 'neutral', COMPLETED: 'good', PENDING_REVIEW: 'warn', DISQUALIFIED: 'bad' } as const;

function attemptSummary(a: ReviewAttempt): string {
  if (a.status === 'IN_PROGRESS') return 'In progress';
  if (a.status !== 'GRADED') return a.ungraded > 0 ? `Submitted, ${a.ungraded} answer(s) not graded yet` : 'Submitted, finishing';
  return `${a.score} / ${a.maxScore} (${a.percent}%) · cutoff ${a.cutoffPercent}%`;
}

export default async function CandidateDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let review;
  let fit;
  let proctoring;
  let resultView;
  try {
    [review, fit, proctoring, resultView] = await Promise.all([getCandidateReview(id), getFitSummaryState(id), getProctoringReport(id), getCandidateResult(id)]);
  } catch (e) {
    if (e instanceof AppError && e.status === 404) notFound();
    throw e;
  }

  const ungradedRounds = review.attempts.filter((a) => a.status !== 'IN_PROGRESS' && a.status !== 'GRADED' && a.ungraded > 0).map((a) => a.roundType);

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">{review.name}</h1>
          <p className="text-sm text-muted-foreground">
            <span className="font-mono">{review.candidateCode}</span> · {review.email} · {review.jobTitle}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="flex gap-1">
            <Badge tone={STATUS_TONE[review.status]}>{review.status.replace('_', ' ').toLowerCase()}</Badge>
            {decisionBadge(resultView.finalDecision) && <Badge tone={decisionBadge(resultView.finalDecision)!.tone}>{decisionBadge(resultView.finalDecision)!.label}</Badge>}
          </div>
          <CandidateReviewActions candidateId={review.id} canReview={review.status === 'PENDING_REVIEW'} ungradedRounds={ungradedRounds} />
          <div className="flex gap-2">
            <CandidateEditButton candidate={{ id: review.id, candidateCode: review.candidateCode, name: review.name, email: review.email }} size="default" label="Edit candidate" />
          <DeleteButton endpoint={`/api/admin/candidates/${review.id}`} dialogTitle={`Delete ${review.name}?`} redirectTo="/admin/candidates" size="default" label="Delete candidate">
            <p>
              This permanently deletes <strong className="text-foreground">{review.name}</strong> (<span className="font-mono">{review.candidateCode}</span>) with their answers, scores, results and resume file. Their Candidate ID stops working.
            </p>
            <p>This cannot be undone.</p>
          </DeleteButton>
          </div>
        </div>
      </div>

      {review.status === 'PENDING_REVIEW' && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          This candidate was flagged: a round scored below its cutoff, or an answer was marked for a human look. Read the answers below, then approve or reject.
          Approving lets them continue; rejecting closes their remaining rounds.
        </p>
      )}

      <FinalResultCard candidateId={review.id} view={resultView} />

      <FitSummaryCard candidateId={review.id} initial={fit} />

      {review.attempts.length === 0 && <p className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">This candidate has not started any round.</p>}

      {review.attempts.map((a, index) => (
        <Card key={a.roundType}>
          <CardHeader>
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle>{a.label}</CardTitle>
              {a.verdict && <Badge tone={VERDICT_TONE[a.verdict]}>{a.verdict.toLowerCase()}</Badge>}
              {a.status !== 'GRADED' && <Badge tone="warn">{a.status === 'IN_PROGRESS' ? 'in progress' : 'grading'}</Badge>}
            </div>
            <CardDescription>{attemptSummary(a)}</CardDescription>
            {index === review.attempts.length - 1 ? (
              <div className="pt-2">
                <ResetRoundButton candidateId={review.id} roundType={a.roundType} label={a.label} inProgress={a.status === 'IN_PROGRESS'} />
              </div>
            ) : (
              <p className="pt-1 text-xs text-muted-foreground">To reset this round, reset the later rounds first (latest first).</p>
            )}
          </CardHeader>
          <CardContent>
            <details className="group">
              <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
                <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" aria-hidden />
                <span className="group-open:hidden">Show answers and scores ({a.answers.length + a.coding.length})</span>
                <span className="hidden group-open:inline">Hide answers and scores</span>
              </summary>
              <div className="mt-3 space-y-3">
            {a.coding.map((c) => (
              <div key={c.position} className="rounded-md border p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-medium">
                    {c.position}. {c.title}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge tone={c.total > 0 && c.passed === c.total ? 'good' : c.submissions > 0 ? 'warn' : 'neutral'}>{c.submissions === 0 ? 'not submitted' : `${c.passed}/${c.total} tests`}</Badge>
                    <span className="font-mono text-xs">{c.points.toFixed(1)} / {CODING_POINTS_PER_PROBLEM}</span>
                  </div>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {c.submissions} submission(s){c.lastVerdict && ` · last result: ${verdictLabel(c.lastVerdict as never)}`}
                  {c.language && ` · scored code is ${c.language}`}
                </p>
                {c.code && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs font-medium text-muted-foreground">Scored code</summary>
                    <pre className="mt-1 overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs">{c.code}</pre>
                  </details>
                )}
                {c.draft && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs font-medium text-muted-foreground">Latest unsubmitted draft (not scored)</summary>
                    <pre className="mt-1 overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs">{c.draft}</pre>
                  </details>
                )}
              </div>
            ))}
            {a.answers.map((row) => (
              <div key={row.position} className="rounded-md border p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-medium">
                    {row.position}. <span className="whitespace-pre-line">{row.prompt}</span>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge>{KIND_LABEL[row.kind]}</Badge>
                    {row.needsReview && <Badge tone="warn">needs a look</Badge>}
                    <span className="font-mono text-xs">{row.score === null ? '—' : row.score} / {row.points}</span>
                  </div>
                </div>

                <div className="mt-2">
                  <div className="text-xs font-medium text-muted-foreground">Candidate’s answer</div>
                  {row.candidateAnswer ? <p className="whitespace-pre-wrap">{row.candidateAnswer}</p> : <p className="italic text-muted-foreground">No answer</p>}
                </div>

                {row.kind === 'MCQ' ? (
                  row.correctOption && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      Correct answer: <span className="text-foreground">{row.correctOption}</span>
                    </p>
                  )
                ) : (
                  <>
                    {row.feedback && <AnswerFeedback roundType={a.roundType} feedback={row.feedback} />}
                    {a.roundType === 'HR' && <HrRubricHelp />}
                    {a.roundType !== 'HR' && row.keyPoints.length > 0 && (
                      <details className="mt-2 text-xs text-muted-foreground">
                        <summary className="cursor-pointer">Rubric and sample answer</summary>
                        <ul className="mt-1 list-disc space-y-0.5 pl-5">
                          {row.keyPoints.map((k, i) => (
                            <li key={i}>{k}</li>
                          ))}
                        </ul>
                        {row.sampleAnswer && <p className="mt-2 whitespace-pre-wrap">{row.sampleAnswer}</p>}
                      </details>
                    )}
                  </>
                )}
              </div>
            ))}
          </div>
            </details>
          </CardContent>
        </Card>
      ))}

      <ProctorTimeline reports={proctoring} />

      <Link href="/admin/candidates" className="text-sm underline">
        Back to candidates
      </Link>
    </>
  );
}
