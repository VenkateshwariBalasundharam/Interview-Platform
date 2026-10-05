import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { SweepNowButton } from '@/components/admin/SweepNowButton';
import { getSweepStatus } from '@/lib/sweeper';
import { agoLabel } from '@/lib/sweeper-core';

/**
 * Health of the background sweep. Quiet when it is running and nothing is stuck; amber when it has not run recently
 * or rounds are waiting, with the one-line fix. Without this a missing scheduler fails silently.
 */
export async function BackgroundJobsBanner() {
  const now = new Date();
  const s = await getSweepStatus(now);
  const problem = s.state !== 'ok' || s.stuckGrading > 0 || s.overdueRounds > 0;

  const lines: string[] = [];
  if (s.state === 'never') lines.push('The background sweep has never run. Until it does, expired rounds are only submitted and graded when a candidate next opens the site.');
  if (s.state === 'late' && s.lastStartedAt) lines.push(`The background sweep last ran ${agoLabel(s.lastStartedAt, now)}. Check that your scheduler is still calling it.`);
  if (s.overdueRounds > 0) lines.push(`${s.overdueRounds} round${s.overdueRounds === 1 ? ' is' : 's are'} still open long after the timer ended.`);
  if (s.stuckGrading > 0) lines.push(`${s.stuckGrading} round${s.stuckGrading === 1 ? ' is' : 's are'} waiting a long time for grading (use Grade now on the candidate page if the AI keeps failing).`);

  return (
    <div className={`flex flex-wrap items-start justify-between gap-3 rounded-xl border px-4 py-3 text-sm ${problem ? 'border-amber-300 bg-amber-50 text-amber-900' : 'bg-card text-muted-foreground'}`}>
      <div className="flex items-start gap-2">
        {problem ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden />}
        <div className="space-y-1">
          {problem ? (
            lines.map((l) => <p key={l}>{l}</p>)
          ) : (
            <p>
              Background sweep is running (last run {s.lastStartedAt ? agoLabel(s.lastStartedAt, now) : 'unknown'}
              {s.lastFinalized + s.lastGraded > 0 ? `: submitted ${s.lastFinalized}, graded ${s.lastGraded}` : ''}).
            </p>
          )}
          {s.state !== 'ok' && <p className="text-xs">Set CRON_SECRET and schedule /api/cron/sweep, or run <code>npm run sweep:watch</code>. See the README, section &quot;Background sweep&quot;.</p>}
        </div>
      </div>
      <SweepNowButton />
    </div>
  );
}
