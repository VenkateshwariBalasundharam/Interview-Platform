// Deleting candidates and jobs together with everything that belongs to them (server only).
// Attempts and proctoring rows are protected by foreign keys (ON DELETE RESTRICT), so they are removed explicitly,
// children first. Answers and coding answers go with their attempt; the face reference, consents, human scores,
// result and fit summary go with the candidate.
import { Prisma } from '@prisma/client';
import { audit } from '@/lib/audit';
import { prisma } from '@/lib/db';
import { err } from '@/lib/http';
import { deletePrivate } from '@/lib/storage';

type Tx = Prisma.TransactionClient;

/** Deletes every row for these candidates inside the caller's transaction. Returns the private files to remove afterwards. */
async function removeCandidateRows(tx: Tx, candidateIds: string[]): Promise<string[]> {
  if (candidateIds.length === 0) return [];
  const [resumes, snapshots] = await Promise.all([
    tx.candidate.findMany({ where: { id: { in: candidateIds }, resumePath: { not: null } }, select: { resumePath: true } }),
    tx.proctorSnapshot.findMany({ where: { candidateId: { in: candidateIds } }, select: { storageKey: true } }),
  ]);
  await tx.proctorSnapshot.deleteMany({ where: { candidateId: { in: candidateIds } } });
  await tx.proctorEvent.deleteMany({ where: { candidateId: { in: candidateIds } } });
  await tx.attempt.deleteMany({ where: { candidateId: { in: candidateIds } } });
  await tx.candidate.deleteMany({ where: { id: { in: candidateIds } } });
  return [...resumes.map((r) => r.resumePath as string), ...snapshots.map((s) => s.storageKey)];
}

/** Files are removed after the database commit. A file that cannot be removed is left for a clean-up, never an error. */
async function removeFiles(keys: string[]) {
  await Promise.all(keys.map((k) => deletePrivate(k).catch(() => undefined)));
}

export async function deleteCandidate(candidateId: string, adminId: string) {
  const candidate = await prisma.candidate.findUnique({ where: { id: candidateId }, select: { id: true, candidateCode: true } });
  if (!candidate) throw err.notFound('Candidate not found', 'CANDIDATE_NOT_FOUND');
  const files = await prisma.$transaction((tx) => removeCandidateRows(tx, [candidate.id]), { maxWait: 10_000, timeout: 20_000 });
  await removeFiles(files);
  // The Candidate ID is enough to find the entry later; the name and email are personal data and stay out of the log.
  await audit({ actorType: 'ADMIN', actorId: adminId, action: 'CANDIDATE_DELETED', entity: 'Candidate', entityId: candidate.id, meta: { candidateCode: candidate.candidateCode } });
}

/**
 * A job with no candidates is deleted as before. A job with candidates is only deleted when the caller says so
 * (`deleteCandidates`), and then every one of its candidates and their data goes with it.
 */
export async function deleteJobWithData(jobId: string, adminId: string, options: { deleteCandidates: boolean }) {
  const job = await prisma.job.findUnique({ where: { id: jobId }, select: { id: true, candidates: { select: { id: true } } } });
  if (!job) throw err.notFound('Job not found', 'JOB_NOT_FOUND');
  if (job.candidates.length > 0 && !options.deleteCandidates) {
    throw err.conflict(`This job has ${job.candidates.length} registered candidate(s). Confirm that they should be deleted with it.`, 'JOB_HAS_CANDIDATES');
  }
  const files = await prisma.$transaction(
    async (tx) => {
      // Read again inside the transaction so a candidate imported a moment ago is not left behind (the foreign key would stop the delete).
      const ids = (await tx.candidate.findMany({ where: { jobId }, select: { id: true } })).map((c) => c.id);
      const removed = await removeCandidateRows(tx, ids);
      await tx.job.delete({ where: { id: jobId } });
      return removed;
    },
    { maxWait: 10_000, timeout: 60_000 },
  );
  await removeFiles(files);
  await audit({ actorType: 'ADMIN', actorId: adminId, action: 'JOB_DELETED', entity: 'Job', entityId: jobId, meta: { candidatesDeleted: job.candidates.length } });
  return { candidatesDeleted: job.candidates.length };
}
