'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api-client';

/** Emails one candidate their login link (again). The email is queued and goes out within a minute. */
export function InviteButton({ candidateId, label = 'Email invite' }: { candidateId: string; label?: string }) {
  const router = useRouter();
  const [state, setState] = useState<'idle' | 'busy' | 'queued' | string>('idle');

  async function run() {
    setState('busy');
    try {
      await apiFetch(`/api/admin/candidates/${candidateId}/invite`, { method: 'POST' });
      setState('queued');
      router.refresh();
    } catch (e) {
      setState(e instanceof Error ? e.message : 'Failed');
    }
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <button type="button" className="text-xs underline disabled:opacity-50" disabled={state === 'busy'} onClick={() => void run()}>
        {state === 'busy' ? 'Queuing…' : label}
      </button>
      {state === 'queued' && <span role="status" className="text-xs text-muted-foreground">queued</span>}
      {state !== 'idle' && state !== 'busy' && state !== 'queued' && <span role="alert" className="text-xs text-destructive">{state}</span>}
    </span>
  );
}
