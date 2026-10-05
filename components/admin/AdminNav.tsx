'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BarChart3, Briefcase, LayoutDashboard, Users } from 'lucide-react';
import { cn } from '@/lib/utils';

const ITEMS = [
  { href: '/admin', label: 'Dashboard', icon: LayoutDashboard, exact: true },
  { href: '/admin/jobs', label: 'Jobs', icon: Briefcase },
  { href: '/admin/candidates', label: 'Candidates', icon: Users },
  { href: '/admin/results', label: 'Results', icon: BarChart3 },
];

/** The admin menu. `side` is the dark sidebar on large screens; `top` is the compact row shown on small screens. */
export function AdminNav({ variant }: { variant: 'side' | 'top' }) {
  const pathname = usePathname();
  return (
    <nav className={variant === 'side' ? 'flex flex-col gap-1 px-3' : 'flex gap-1 overflow-x-auto px-3 py-2'}>
      {ITEMS.map(({ href, label, icon: Icon, exact }) => {
        const active = exact ? pathname === href : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
              variant === 'top' && 'shrink-0',
              active ? 'bg-blue-600 text-white shadow-sm' : variant === 'side' ? 'text-slate-300 hover:bg-white/10 hover:text-white' : 'text-slate-600 hover:bg-slate-100',
            )}
          >
            <Icon className="h-[18px] w-[18px]" aria-hidden />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
