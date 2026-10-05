import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AdminLoginForm } from '@/components/AdminLoginForm';
import { AuthShell } from '@/components/AuthShell';
import { getAdminSession } from '@/lib/auth';

// Not meant to be found: keep it out of search engines. Admins open /staff-login directly.
export const metadata: Metadata = { title: 'Sign in', robots: { index: false, follow: false } };

// Reads the session cookie and the database on every request; never prerender.
export const dynamic = 'force-dynamic';

export default async function AdminLoginPage() {
  if (await getAdminSession()) redirect('/admin');
  return (
    <AuthShell title="Admin login" description="Manage jobs, pipelines and candidates.">
      <AdminLoginForm />
    </AuthShell>
  );
}
