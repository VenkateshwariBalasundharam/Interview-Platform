import Link from 'next/link';
import { notFound } from 'next/navigation';
import { RoundQuestions } from '@/components/RoundQuestions';
import { AppError } from '@/lib/http';
import { isPersonalisedRound } from '@/lib/personalisation';
import { getCandidateSetView } from '@/lib/personalised-sets';

export default async function CandidateQuestionsPage({ params }: { params: Promise<{ id: string; roundType: string }> }) {
  const { id, roundType: raw } = await params;
  const roundType = raw.toUpperCase();
  if (!isPersonalisedRound(roundType)) notFound();

  const view = await getCandidateSetView(id, roundType).catch((e) => {
    if (e instanceof AppError && e.status === 404) notFound();
    throw e;
  });

  return (
    <>
      <div>
        <Link href={`/admin/jobs/${view.candidate.jobId}/questions`} className="text-sm text-muted-foreground hover:underline">{view.candidate.jobTitle} · question sets</Link>
        <h1 className="text-xl font-semibold">{view.round.label} questions for {view.candidate.name}</h1>
        <p className="text-sm text-muted-foreground">
          <span className="font-mono">{view.candidate.code}</span> · Written from this candidate&apos;s parsed resume and the job description. Only this candidate sees these questions.
        </p>
      </div>
      <RoundQuestions jobId={view.candidate.jobId} candidateId={view.candidate.id} round={view.round} jobStarted={view.started} />
    </>
  );
}
