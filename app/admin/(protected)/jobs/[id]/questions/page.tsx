import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PersonalisedSets } from '@/components/PersonalisedSets';
import { RoundQuestions } from '@/components/RoundQuestions';
import { Alert } from '@/components/ui/alert';
import { AppError } from '@/lib/http';
import { isPersonalisedRound } from '@/lib/personalisation';
import { getPersonalisedOverview } from '@/lib/personalised-sets';
import { getQuestionOverview } from '@/lib/question-sets';

export default async function JobQuestionsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const overview = await getQuestionOverview(id).catch((e) => {
    if (e instanceof AppError && e.status === 404) notFound();
    throw e;
  });

  // Technical and HR can also be personalised per candidate, from each candidate's parsed resume.
  const personalised = await Promise.all(
    overview.rounds.filter((r) => isPersonalisedRound(r.roundType)).map((r) => getPersonalisedOverview(id, r.roundType as 'TECHNICAL' | 'HR')),
  );

  return (
    <>
      <div>
        <Link href={`/admin/jobs/${overview.job.id}`} className="text-sm text-muted-foreground hover:underline">{overview.job.title}</Link>
        <h1 className="text-xl font-semibold">Question sets</h1>
        <p className="text-sm text-muted-foreground">
          Generate questions from the job description, review and edit them, then approve. Approved sets can be locked so they never change.
        </p>
      </div>

      {overview.rounds.length === 0 && <Alert>The pipeline for this job has no rounds that use generated questions.</Alert>}
      {overview.rounds.map((round) => (
        <div key={round.roundType} className="space-y-4">
          <RoundQuestions jobId={overview.job.id} round={round} jobStarted={overview.started} />
          {personalised
            .filter((p) => p.roundType === round.roundType)
            .map((p) => (
              <PersonalisedSets key={p.roundType} jobId={overview.job.id} overview={p} jobWideReady={round.set?.status === 'APPROVED' || round.set?.status === 'LOCKED'} />
            ))}
        </div>
      ))}
      {overview.notGenerated.length > 0 && (
        <p className="text-sm text-muted-foreground">
          {overview.notGenerated.join(', ')} {overview.notGenerated.length === 1 ? 'does' : 'do'} not use generated questions here (coding problems and the manager interview are handled separately).
        </p>
      )}
    </>
  );
}
