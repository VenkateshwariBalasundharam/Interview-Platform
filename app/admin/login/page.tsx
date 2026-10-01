import { redirect } from 'next/navigation';
import { AdminLoginForm } from '@/components/AdminLoginForm';
import { BackButton } from '@/components/BackButton';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getAdminSession } from '@/lib/auth';

// Reads the session cookie and the database on every request; never prerender.
export const dynamic = 'force-dynamic';

export default async function AdminLoginPage() {
  if (await getAdminSession()) redirect('/admin');
  return (
    <main className="mx-auto flex min-h-screen max-w-md items-center p-6">
      <div className="fixed left-4 top-4"><BackButton href="/" /></div>
      <Card className="w-full">
        <CardHeader>
          <CardTitle>Admin login</CardTitle>
          <CardDescription>Manage jobs, pipelines and candidates.</CardDescription>
        </CardHeader>
        <CardContent><AdminLoginForm /></CardContent>
      </Card>
    </main>
  );
}
