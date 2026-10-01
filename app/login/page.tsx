import { redirect } from 'next/navigation';
import { CandidateLoginForm } from '@/components/CandidateLoginForm';
import { BackButton } from '@/components/BackButton';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getCandidateSession } from '@/lib/auth';

// Reads the session cookie and the database on every request; never prerender.
export const dynamic = 'force-dynamic';

export default async function CandidateLoginPage() {
  if (await getCandidateSession()) redirect('/dashboard');
  return (
    <main className="mx-auto flex min-h-screen max-w-md items-center p-6">
      <div className="fixed left-4 top-4"><BackButton href="/" /></div>
      <Card className="w-full">
        <CardHeader>
          <CardTitle>Candidate login</CardTitle>
          <CardDescription>Use the Candidate ID from your invitation. Your password is your date of birth.</CardDescription>
        </CardHeader>
        <CardContent><CandidateLoginForm /></CardContent>
      </Card>
    </main>
  );
}
