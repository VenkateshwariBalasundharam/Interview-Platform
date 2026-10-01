import { requireCandidate } from '@/lib/auth';
import { getCandidatePipeline } from '@/lib/candidate-view';
import { json, route } from '@/lib/http';

export const GET = route(async () => {
  const session = await requireCandidate();
  return json({
    candidate: { candidateCode: session.candidateCode, name: session.name, status: session.status },
    ...(await getCandidatePipeline(session.jobId)),
  });
});
