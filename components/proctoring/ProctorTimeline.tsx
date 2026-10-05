import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { SnapshotViewer } from '@/components/proctoring/SnapshotViewer';
import { formatDuration, type EventTone } from '@/lib/proctoring-core';
import type { ProctorRoundReport } from '@/lib/proctoring';

const DOT: Record<EventTone, string> = {
  neutral: 'bg-muted-foreground/50',
  warn: 'bg-amber-500',
  bad: 'bg-red-500',
};

const LEVEL_LABEL = { OFF: 'Off', PRESENCE: 'Presence', IDENTITY: 'Presence + identity' } as const;

function clock(atIso: string): string {
  return `${atIso.slice(0, 19).replace('T', ' ')} UTC`;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-sm font-semibold">{value}</div>
    </div>
  );
}

export function ProctorTimeline({ reports }: { reports: ProctorRoundReport[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Proctoring</CardTitle>
        <CardDescription>
          Signals recorded while proctored rounds were running. Nothing here changes a score or a decision; use it as context when you review the answers.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {reports.length === 0 && <p className="text-sm text-muted-foreground">No proctored round has been started yet.</p>}

        {reports.map((report) => {
          const { counts } = report;
          return (
            <section key={report.roundType} className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-semibold">{report.label}</h3>
                <Badge tone={report.level === 'OFF' ? 'neutral' : 'good'}>{LEVEL_LABEL[report.level]}</Badge>
                {report.events.length === 0 && <span className="text-xs text-muted-foreground">No events recorded</span>}
              </div>

              {report.events.length > 0 && (
                <>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                    <Stat label="Tab switches" value={String(counts.tabSwitches)} />
                    <Stat label="Time away" value={counts.awayMs > 0 ? formatDuration(counts.awayMs) : '0 s'} />
                    <Stat label="Pastes" value={counts.blockedPastes > 0 ? `${counts.pastes} (${counts.blockedPastes} blocked)` : String(counts.pastes)} />
                    <Stat label="Characters pasted" value={counts.pastedChars.toLocaleString('en-US')} />
                    <Stat label="Full-screen exits" value={counts.fullscreenRefused ? `${counts.fullscreenExits} (refused once)` : String(counts.fullscreenExits)} />
                  </div>
                  {report.level !== 'OFF' && (
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      <Stat label="No face seen" value={String(counts.noFace)} />
                      <Stat label="Several faces" value={String(counts.multipleFaces)} />
                      <Stat label="Head turned away" value={String(counts.lookingAway)} />
                      {report.level === 'IDENTITY' && <Stat label="Identity mismatches" value={String(counts.identityMismatches)} />}
                    </div>
                  )}

                  <ol className="space-y-1.5 text-sm">
                    {report.events.map((event) => (
                      <li key={event.id} className="flex items-start gap-3">
                        <span className="w-16 shrink-0 text-right font-mono text-xs leading-5 text-muted-foreground" title={clock(event.atIso)}>
                          {event.offsetLabel}
                        </span>
                        <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${DOT[event.tone]}`} aria-hidden />
                        <span className="leading-5">
                          {event.text}
                          {event.hasSnapshot && <SnapshotViewer eventId={event.id} />}
                        </span>
                      </li>
                    ))}
                  </ol>
                </>
              )}
            </section>
          );
        })}
      </CardContent>
    </Card>
  );
}
