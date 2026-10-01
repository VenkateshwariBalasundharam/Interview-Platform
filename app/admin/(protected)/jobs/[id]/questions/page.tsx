import Link from 'next/link';
import { notFound } from 'next/navigation';
import { RoundQuestions } from '@/components/RoundQuestions';
import { Alert } from '@/components/ui/alert';
import { AppError } from '@/lib/http';
import { getQuestionOverview } from '@/lib/question-sets';

export default async function JobQuestionsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const overview = await getQuestionOverview(id).catch((e) => {
    if (e instanceof AppError && e.status === 404) notFound();
    throw e;
  });

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
        <RoundQuestions key={round.roundType} jobId={overview.job.id} round={round} jobStarted={overview.started} />
      ))}
      {overview.notGenerated.length > 0 && (
        <p className="text-sm text-muted-foreground">
          {overview.notGenerated.join(', ')} {overview.notGenerated.length === 1 ? 'does' : 'do'} not use generated questions here (coding problems and the manager interview are handled separately).
        </p>
      )}
    </>
  );
}
