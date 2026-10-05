'use client';
import { usePathname } from 'next/navigation';
import { adminPageHeading } from '@/lib/admin-page-title';

/** The page title and description on the left of the admin top bar. It changes with the page. */
export function AdminPageHeader({ adminName }: { adminName: string }) {
  const pathname = usePathname();
  const { title, subtitle } = adminPageHeading(pathname, adminName);
  return (
    <div className="min-w-0 leading-tight">
      <p className="truncate text-lg font-semibold">{title}</p>
      {subtitle && <p className="hidden truncate text-xs text-muted-foreground sm:block">{subtitle}</p>}
    </div>
  );
}
