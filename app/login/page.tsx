import { redirect } from 'next/navigation';
import { CandidateLoginForm } from '@/components/CandidateLoginForm';
import { AuthShell } from '@/components/AuthShell';
import { getCandidateSession } from '@/lib/auth';
import { CANDIDATE_CODE_REGEX } from '@/lib/candidate-code';

// Reads the session cookie and the database on every request; never prerender.
export const dynamic = 'force-dynamic';

export default async function CandidateLoginPage({ searchParams }: { searchParams: Promise<{ code?: string }> }) {
  // The invitation email links here with the Candidate ID filled in. Anything that is not a valid ID is ignored.
  const { code } = await searchParams;
  const initialCode = code && CANDIDATE_CODE_REGEX.test(code) ? code : '';
  if (await getCandidateSession()) redirect('/dashboard');
  return (
    <AuthShell title="Candidate login" description="Use the Candidate ID from your invitation. Your password is your date of birth." note="Having trouble signing in? Contact the hiring team that invited you.">
      <CandidateLoginForm initialCode={initialCode} />
    </AuthShell>
  );
}
