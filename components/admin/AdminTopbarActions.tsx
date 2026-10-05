'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Bell, ChevronDown, LogOut, User } from 'lucide-react';
import { apiFetch } from '@/lib/api-client';
import { bellBadge, type BellItem } from '@/lib/admin-dashboard-core';

/** Closes the open menu on a click elsewhere or on Escape. */
function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);
  return ref;
}

/** The bell with a red count, and the account menu (photo circle, name, role, chevron) on the right of the top bar. */
export function AdminTopbarActions({ name, bell, bellCount, logoutEndpoint, loginPath }: { name: string; bell: BellItem[]; bellCount: number; logoutEndpoint: string; loginPath: string }) {
  const router = useRouter();
  const [bellOpen, setBellOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const bellRef = useDismiss(bellOpen, () => setBellOpen(false));
  const menuRef = useDismiss(menuOpen, () => setMenuOpen(false));
  const badge = bellBadge(bellCount);

  async function logout() {
    setBusy(true);
    try {
      await apiFetch(logoutEndpoint, { method: 'POST' });
    } finally {
      router.replace(loginPath);
      router.refresh();
    }
  }

  return (
    <div className="flex items-center gap-2">
      <div ref={bellRef} className="relative">
        <button
          type="button"
          aria-label={badge ? `Notifications, ${badge} waiting` : 'Notifications'}
          aria-expanded={bellOpen}
          onClick={() => {
            setBellOpen((o) => !o);
            setMenuOpen(false);
          }}
          className="relative flex h-10 w-10 items-center justify-center rounded-full text-slate-600 hover:bg-slate-100"
        >
          <Bell className="h-5 w-5" aria-hidden />
          {badge && <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold leading-none text-white">{badge}</span>}
        </button>
        {bellOpen && (
          <div className="absolute right-0 z-20 mt-2 w-72 rounded-xl border bg-card p-3 shadow-lg">
            <p className="mb-2 text-sm font-semibold">Needs your attention</p>
            {bell.length === 0 ? (
              <p className="text-sm text-muted-foreground">You are all caught up.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {bell.map((b) => (
                  <li key={b.href}>
                    <Link href={b.href} onClick={() => setBellOpen(false)} className="block rounded-md px-2 py-1.5 hover:bg-slate-100">{b.text}</Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      <div ref={menuRef} className="relative">
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => {
            setMenuOpen((o) => !o);
            setBellOpen(false);
          }}
          className="flex items-center gap-2.5 rounded-full py-1 pl-1 pr-2 hover:bg-slate-100"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-200 text-slate-500" aria-hidden><User className="h-5 w-5" /></span>
          <span className="hidden text-left leading-tight sm:block">
            <span className="block text-sm font-semibold">{name}</span>
            <span className="block text-xs text-muted-foreground">Admin</span>
          </span>
          <ChevronDown className="h-4 w-4 text-slate-500" aria-hidden />
        </button>
        {menuOpen && (
          <div role="menu" className="absolute right-0 z-20 mt-2 w-48 rounded-xl border bg-card p-1.5 shadow-lg">
            <p className="px-3 py-2 text-xs text-muted-foreground">Signed in as {name}</p>
            <button type="button" role="menuitem" disabled={busy} onClick={logout} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-slate-100 disabled:opacity-50">
              <LogOut className="h-4 w-4" aria-hidden />
              Log out
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
