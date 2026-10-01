// Client-safe helper for the delete-job buttons.
/** A job with candidates needs the explicit flag; the confirmation dialog makes the admin type the job title first. */
export function jobDeleteEndpoint(jobId: string, candidateCount: number): string {
  return `/api/admin/jobs/${jobId}${candidateCount > 0 ? '?deleteCandidates=true' : ''}`;
}
