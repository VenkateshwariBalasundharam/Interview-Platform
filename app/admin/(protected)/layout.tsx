import { ADMIN_LOGIN_PATH } from '@/lib/admin-paths';
import Link from 'next/link';
import { ClipboardCheck } from 'lucide-react';
import { AdminNav } from '@/components/admin/AdminNav';
import { AdminPageHeader } from '@/components/admin/AdminPageHeader';
import { BackButton } from '@/components/BackButton';
import { AdminTopbarActions } from '@/components/admin/AdminTopbarActions';
import { requireAdminPage } from '@/lib/auth';
import { bellItems } from '@/lib/admin-dashboard-core';
import { prisma } from '@/lib/db';

// Reads the session cookie and the database on every request; never prerender.
export const dynamic = 'force-dynamic';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // The session check and the bell counts do not depend on each other, so they run at the same time: each database
  // round trip costs real time, and the bell needs only two cheap counts.
  const [admin, pending, awaiting] = await Promise.all([
    requireAdminPage(),
    prisma.candidate.count({ where: { status: 'PENDING_REVIEW' } }),
    prisma.candidate.count({ where: { status: 'COMPLETED', OR: [{ result: { is: null } }, { result: { is: { finalDecision: null } } }] } }),
  ]);
  return (
    <div className="min-h-screen bg-[#f4f6fb] md:pl-60">
      <aside className="fixed inset-y-0 left-0 hidden w-60 flex-col bg-[#0b1530] md:flex">
        <Link href="/admin" className="flex items-center gap-3 px-5 py-6 text-white">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-600"><ClipboardCheck className="h-5 w-5" aria-hidden /></span>
          <span className="text-sm font-semibold leading-tight">Interview Platform</span>
        </Link>
        <AdminNav variant="side" />
      </aside>

      <header className="sticky top-0 z-10 border-b bg-card">
        <div className="flex items-center gap-3 px-6 py-3">
          <AdminPageHeader adminName={admin.name} />
          <div className="ml-auto shrink-0">
            <AdminTopbarActions name={admin.name} bell={bellItems(pending, awaiting)} bellCount={pending + awaiting} logoutEndpoint="/api/admin/auth/logout" loginPath={ADMIN_LOGIN_PATH} />
          </div>
        </div>
        <div className="border-t md:hidden"><AdminNav variant="top" /></div>
      </header>

      <main className="mx-auto max-w-7xl space-y-6 p-6">
        <BackButton hideOn={['/admin']} fallback="/admin" />
        {children}
      </main>
    </div>
  );
}
