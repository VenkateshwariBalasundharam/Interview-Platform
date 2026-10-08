'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/lib/api-client';
import type { EmailOverview } from '@/lib/email';

const KIND_LABEL = { INVITE: 'Invitation', SELECTED_NEXT_ROUND: 'Next-round email', RESULT_READY: 'Result email', REMINDER: 'Reminder' } as const;

/** Candidate email status and the buttons that act on it: send now, retry failed, invite everyone not yet invited. */
export function EmailPanel({ overview, jobId }: { overview: EmailOverview; jobId?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: 'success' | 'error' | 'warn'; text: string } | null>(null);

  async function run(name: string, fn: () => Promise<string>) {
    setBusy(name);
    setMessage(null);
    try {
      setMessage({ tone: 'success', text: await fn() });
      router.refresh();
    } catch (e) {
      setMessage({ tone: 'error', text: e instanceof Error ? e.message : 'That did not work.' });
    }
    setBusy(null);
  }

  const sendNow = () =>
    run('send', async () => {
      const { report } = await apiFetch<{ report: { sent: number; failed: number; retrying: number; cancelled: number; skipped: string | null } }>('/api/admin/emails/send-now', { method: 'POST' });
      if (report.skipped) return report.skipped;
      const bits = [`${report.sent} sent`, report.retrying ? `${report.retrying} will be retried` : '', report.failed ? `${report.failed} failed` : '', report.cancelled ? `${report.cancelled} no longer needed` : ''].filter(Boolean);
      return report.sent + report.failed + report.retrying + report.cancelled === 0 ? 'Nothing was waiting to be sent.' : `${bits.join(', ')}.`;
    });
  const retry = () => run('retry', async () => `${(await apiFetch<{ requeued: number }>('/api/admin/emails/retry-failed', { method: 'POST' })).requeued} failed email(s) put back in the queue.`);
  const invite = () =>
    run('invite', async () => {
      const r = await apiFetch<{ queued: number }>('/api/admin/emails/invites', { method: 'POST', json: jobId ? { jobId } : {} });
      return r.queued === 0 ? 'Everyone who has not started already has an invitation.' : `${r.queued} invitation(s) queued. They go out within a minute, or press “Send now”.`;
    });

  if (overview.mode === 'off') {
    return <Alert tone="warn">Candidate emails are off. {overview.note}</Alert>;
  }

  return (
    <div className="space-y-3 rounded-xl border bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium">Candidate emails</h3>
          <p className="text-xs text-muted-foreground">
            {overview.queued} waiting · {overview.sentLast24h} sent in the last 24 hours · {overview.failed} failed
            {overview.note ? ` · ${overview.note}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void invite()}>
            {busy === 'invite' && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
            Email invites to those not yet invited
          </Button>
          <Button size="sm" variant="outline" disabled={busy !== null || overview.failed === 0} onClick={() => void retry()}>
            {busy === 'retry' && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
            Retry failed
          </Button>
          <Button size="sm" disabled={busy !== null} onClick={() => void sendNow()}>
            {busy === 'send' && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
            Send now
          </Button>
        </div>
      </div>
      {message && <Alert tone={message.tone}>{message.text}</Alert>}
      {overview.recentFailures.length > 0 && (
        <ul className="space-y-1 text-xs text-muted-foreground">
          {overview.recentFailures.map((f) => (
            <li key={f.id}>
              <span className="font-mono">{f.candidateCode}</span> {f.name} · {KIND_LABEL[f.kind]}: {f.lastError ?? 'failed'}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
