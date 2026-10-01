'use client';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/**
 * A modal confirmation. When `phrase` is given, the confirm button stays disabled until that exact text is typed
 * (for deletes that remove other people's data).
 */
export function ConfirmDialog({
  title,
  children,
  confirmLabel = 'Delete',
  phrase,
  busy,
  error,
  onConfirm,
  onCancel,
}: {
  title: string;
  children: ReactNode;
  confirmLabel?: string;
  phrase?: string;
  busy: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [typed, setTyped] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const matches = !phrase || typed.trim() === phrase.trim();

  useEffect(() => {
    (phrase ? inputRef.current : cancelRef.current)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [busy, onCancel, phrase]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onMouseDown={(e) => e.target === e.currentTarget && !busy && onCancel()}>
      <div role="dialog" aria-modal="true" aria-labelledby={titleId} className="w-full max-w-md space-y-4 rounded-lg border bg-card p-5 shadow-lg">
        <h2 id={titleId} className="text-base font-semibold">{title}</h2>
        <div className="space-y-2 text-sm text-muted-foreground">{children}</div>
        {phrase && (
          <div className="space-y-1.5">
            <label htmlFor={`${titleId}-confirm`} className="text-sm">
              Type <span className="font-mono font-semibold text-foreground">{phrase}</span> to confirm
            </label>
            <Input id={`${titleId}-confirm`} ref={inputRef} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" disabled={busy} />
          </div>
        )}
        {error && <Alert tone="error">{error}</Alert>}
        <div className="flex justify-end gap-2">
          <Button ref={cancelRef} variant="outline" onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button variant="destructive" onClick={onConfirm} disabled={busy || !matches}>{busy ? 'Deleting…' : confirmLabel}</Button>
        </div>
      </div>
    </div>
  );
}
