import Link from 'next/link';
import { notFound } from 'next/navigation';
import { JobActions } from '@/components/JobActions';
import { JobEditButton } from '@/components/JobEditButton';
import { JobForm } from '@/components/JobForm';
import { PipelineEditor } from '@/components/PipelineEditor';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { AppError } from '@/lib/http';
import { getJob } from '@/lib/jobs';
import type { PipelineStep } from '@/lib/pipeline';

export default async function JobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = await getJob(id).catch((e) => {
    if (e instanceof AppError && e.status === 404) notFound();
    throw e;
  });

  const steps: PipelineStep[] = job.rounds.map((r) => ({
    roundType: r.roundType,
    position: r.position,
    enabled: r.enabled,
    cutoffPercent: r.cutoffPercent,
    weight: r.weight,
    durationMinutes: r.durationMinutes,
    questionCount: r.questionCount,
    difficulty: r.difficulty,
    cutoffMode: r.cutoffMode,
    proctoringLevel: r.proctoringLevel,
    required: r.required,
    humanScored: r.humanScored,
  }));

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/admin/jobs" className="text-sm text-muted-foreground hover:underline">Jobs</Link>
          <h1 className="text-xl font-semibold">{job.title}</h1>
          <p className="text-sm text-muted-foreground">{job.candidateCount} registered candidate(s)</p>
        </div>
        <div className="flex flex-wrap items-start gap-2">
          <JobEditButton
            size="default"
            label="Edit job"
            job={{ id: job.id, title: job.title, jdText: job.jdText, requiredSkills: job.requiredSkills, tier: job.tier, resultMode: job.resultMode, retakePolicy: job.retakePolicy, started: job.started }}
          />
          <JobActions jobId={job.id} jobTitle={job.title} candidateCount={job.candidateCount} />
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Job details</CardTitle>
          {job.started && <CardDescription>Candidates have started, so only the title and retake policy can be changed.</CardDescription>}
        </CardHeader>
        <CardContent>
          <JobForm
            jobId={job.id}
            locked={job.started}
            initial={{ title: job.title, jdText: job.jdText, requiredSkills: job.requiredSkills, tier: job.tier, resultMode: job.resultMode, retakePolicy: job.retakePolicy }}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Interview pipeline</CardTitle>
          <CardDescription>Rounds run in this order. Weights of enabled rounds must total 100.</CardDescription>
        </CardHeader>
        <CardContent><PipelineEditor jobId={job.id} initialSteps={steps} locked={job.started} /></CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Question sets</CardTitle>
          <CardDescription>Generate, review and approve the questions candidates will see in each round.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline"><Link href={`/admin/jobs/${job.id}/questions`}>Manage questions</Link></Button>
        </CardContent>
      </Card>
    </>
  );
}
