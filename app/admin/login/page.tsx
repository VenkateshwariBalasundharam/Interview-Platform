import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AdminLoginForm } from '@/components/AdminLoginForm';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getAdminSession } from '@/lib/auth';

// Not meant to be found: keep it out of search engines. Admins open /admin/login directly.
export const metadata: Metadata = { title: 'Sign in', robots: { index: false, follow: false } };

// Reads the session cookie and the database on every request; never prerender.
export const dynamic = 'force-dynamic';

export default async function AdminLoginPage() {
  if (await getAdminSession()) redirect('/admin');
  return (
    <main className="mx-auto flex min-h-screen max-w-md items-center p-6">
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
