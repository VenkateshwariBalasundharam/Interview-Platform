'use client';
import { useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/lib/api-client';

/** A Delete button that opens a confirmation, calls DELETE on `endpoint`, then refreshes (or goes to `redirectTo`). */
export function DeleteButton({
  endpoint,
  dialogTitle,
  children,
  phrase,
  redirectTo,
  size = 'sm',
  label = 'Delete',
}: {
  endpoint: string;
  dialogTitle: string;
  /** What will be lost, in plain words. */
  children: ReactNode;
  /** Text the admin must type to confirm. Leave out for a plain confirmation. */
  phrase?: string;
  redirectTo?: string;
  size?: 'sm' | 'default';
  label?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(endpoint, { method: 'DELETE' });
      setOpen(false);
      if (redirectTo) router.push(redirectTo);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete.');
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant="destructive" size={size} onClick={() => { setError(null); setOpen(true); }}>{label}</Button>
      {open && (
        <ConfirmDialog title={dialogTitle} phrase={phrase} busy={busy} error={error} onConfirm={confirm} onCancel={() => setOpen(false)}>
          {children}
        </ConfirmDialog>
      )}
    </>
  );
}
