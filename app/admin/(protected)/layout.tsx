import Link from 'next/link';
import { BackButton } from '@/components/BackButton';
import { LogoutButton } from '@/components/LogoutButton';
import { requireAdminPage } from '@/lib/auth';

// Reads the session cookie and the database on every request; never prerender.
export const dynamic = 'force-dynamic';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireAdminPage();
  return (
    <div className="min-h-screen">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-6xl items-center gap-6 px-6 py-3">
          <Link href="/admin" className="font-semibold">Interview Platform</Link>
          <nav className="flex gap-4 text-sm">
            <Link href="/admin/jobs" className="hover:underline">Jobs</Link>
            <Link href="/admin/candidates" className="hover:underline">Candidates</Link>
            <Link href="/admin/results" className="hover:underline">Results</Link>
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm text-muted-foreground">
            <span>{admin.name}</span>
            <LogoutButton endpoint="/api/admin/auth/logout" redirectTo="/admin/login" />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl space-y-6 p-6">
        <BackButton hideOn={['/admin']} fallback="/admin" />
        {children}
      </main>
    </div>
  );
}
