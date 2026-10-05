'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/lib/api-client';

/** Runs one background sweep now and shows what it did. */
export function SweepNowButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await apiFetch<{ message: string }>('/api/admin/sweep', { method: 'POST' });
      setMessage(res.message);
      router.refresh();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'The sweep failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void run()}>
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <RefreshCw className="h-3.5 w-3.5" aria-hidden />}
        Run now
      </Button>
      {message && <span role="status" className="text-xs text-muted-foreground">{message}</span>}
    </span>
  );
}
