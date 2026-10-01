import { prisma } from '@/lib/db';

/**
 * What a candidate may see about their pipeline. Cutoffs, weights, difficulty and rubrics are
 * deliberately not included.
 */
export async function getCandidatePipeline(jobId: string) {
  const job = await prisma.job.findUniqueOrThrow({
    where: { id: jobId },
    select: {
      title: true,
      rounds: {
        where: { enabled: true },
        orderBy: { position: 'asc' },
        select: { roundType: true, position: true, durationMinutes: true, questionCount: true, required: true, humanScored: true, proctoringLevel: true },
      },
    },
  });
  return { job: { title: job.title, rounds: job.rounds } };
}
