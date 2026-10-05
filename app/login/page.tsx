import { redirect } from 'next/navigation';
import { CandidateLoginForm } from '@/components/CandidateLoginForm';
import { AuthShell } from '@/components/AuthShell';
import { getCandidateSession } from '@/lib/auth';

// Reads the session cookie and the database on every request; never prerender.
export const dynamic = 'force-dynamic';

export default async function CandidateLoginPage() {
  if (await getCandidateSession()) redirect('/dashboard');
  return (
    <AuthShell title="Candidate login" description="Use the Candidate ID from your invitation. Your password is your date of birth." note="Having trouble signing in? Contact the hiring team that invited you.">
      <CandidateLoginForm />
    </AuthShell>
  );
}
