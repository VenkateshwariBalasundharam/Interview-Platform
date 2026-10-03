'use client';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowDown, ArrowUp, Trash2 } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { apiFetch } from '@/lib/api-client';
import {
  CUTOFF_MODES, DIFFICULTIES, PROCTORING_LEVELS, ROUND_LIBRARY, ROUND_TYPES, TIER_PRESETS, TIERS,
  defaultStep, getPreset, pipelineSchema, withSequentialPositions,
  type PipelineStep, type RoundType, type Tier,
} from '@/lib/pipeline';

const CUTOFF_LABEL = { DISQUALIFY: 'Disqualify below cutoff', FLAG_FOR_REVIEW: 'Pause for admin review' } as const;
const PROCTOR_LABEL = { OFF: 'Off', PRESENCE: 'Presence', IDENTITY: 'Presence + identity' } as const;

export function PipelineEditor({ jobId, initialSteps, locked }: { jobId: string; initialSteps: PipelineStep[]; locked: boolean }) {
  const router = useRouter();
  const [steps, setSteps] = useState<PipelineStep[]>(withSequentialPositions(initialSteps));
  const [presetTier, setPresetTier] = useState<Tier>('FRESHER');
  const [addType, setAddType] = useState<RoundType | ''>('');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const issues = useMemo(() => {
    const parsed = pipelineSchema.safeParse({ steps: withSequentialPositions(steps) });
    return parsed.success ? [] : [...new Set(parsed.error.issues.map((i) => i.message))];
  }, [steps]);

  const weightTotal = steps.filter((s) => s.enabled).reduce((sum, s) => sum + s.weight, 0);
  const unused = ROUND_TYPES.filter((t) => !steps.some((s) => s.roundType === t));

  const change = (next: PipelineStep[]) => { setSaved(false); setSteps(next); };
  const patch = (i: number, p: Partial<PipelineStep>) => change(steps.map((s, idx) => (idx === i ? { ...s, ...p } : s)));
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= steps.length) return;
    const next = [...steps];
    [next[i], next[j]] = [next[j], next[i]];
    change(next);
  };
  const num = (v: string) => (Number.isFinite(Number(v)) && v !== '' ? Math.trunc(Number(v)) : 0);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/admin/jobs/${jobId}/pipeline`, { method: 'PUT', json: { steps: withSequentialPositions(steps) } });
      setSaved(true);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the pipeline');
    }
    setBusy(false);
  }

  return (
    <div className="space-y-4">
      {locked && (
        <Alert tone="warn">
          Candidates have started this job, so the pipeline is read-only. Clone the job to make changes.
        </Alert>
      )}

      {!locked && (
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="preset">Load a tier preset</Label>
            <div className="flex gap-2">
              <Select id="preset" className="w-52" value={presetTier} onChange={(e) => setPresetTier(e.target.value as Tier)}>
                {TIERS.map((t) => <option key={t} value={t}>{TIER_PRESETS[t].label}</option>)}
              </Select>
              <Button variant="outline" onClick={() => change(getPreset(presetTier).steps)}>Replace pipeline</Button>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="add">Add a round</Label>
            <div className="flex gap-2">
              <Select id="add" className="w-44" value={addType} onChange={(e) => setAddType(e.target.value as RoundType | '')} disabled={unused.length === 0}>
                <option value="">Choose…</option>
                {unused.map((t) => <option key={t} value={t}>{ROUND_LIBRARY[t].label}</option>)}
              </Select>
              <Button
                variant="outline"
                disabled={!addType}
                onClick={() => {
                  if (!addType) return;
                  change([...steps, defaultStep(addType, steps.length + 1)]);
                  setAddType('');
                }}
              >
                Add
              </Button>
            </div>
          </div>
        </div>
      )}

      <ol className="space-y-3">
        {steps.map((s, i) => {
          const lib = ROUND_LIBRARY[s.roundType];
          const off = locked;
          return (
            <li key={s.roundType}>
              <Card className={s.enabled ? '' : 'opacity-60'}>
                <div className="flex flex-wrap items-center gap-3 border-b px-4 py-3">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{lib.label}</div>
                    <div className="text-xs text-muted-foreground">{lib.description}</div>
                  </div>
                  <Badge>{lib.gradedBy}</Badge>
                  <label className="flex items-center gap-1.5 text-sm">
                    <input type="checkbox" checked={s.enabled} disabled={off} onChange={(e) => patch(i, { enabled: e.target.checked })} />
                    Enabled
                  </label>
                  {!off && (
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon" aria-label={`Move ${lib.label} up`} disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp className="h-4 w-4" /></Button>
                      <Button variant="ghost" size="icon" aria-label={`Move ${lib.label} down`} disabled={i === steps.length - 1} onClick={() => move(i, 1)}><ArrowDown className="h-4 w-4" /></Button>
                      <Button variant="ghost" size="icon" aria-label={`Remove ${lib.label}`} onClick={() => change(steps.filter((_, idx) => idx !== i))}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  )}
                </div>
                <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
                  <Field label="Cutoff (%)"><Input type="number" min={0} max={100} value={s.cutoffPercent} disabled={off} onChange={(e) => patch(i, { cutoffPercent: num(e.target.value) })} /></Field>
                  <Field label="Weight (%)"><Input type="number" min={0} max={100} value={s.weight} disabled={off} onChange={(e) => patch(i, { weight: num(e.target.value) })} /></Field>
                  <Field label="Duration (minutes)"><Input type="number" min={1} max={240} value={s.durationMinutes} disabled={off} onChange={(e) => patch(i, { durationMinutes: num(e.target.value) })} /></Field>
                  <Field label={s.roundType === 'CODING' ? 'Problems' : 'Questions'}><Input type="number" min={0} max={60} value={s.questionCount} disabled={off || s.roundType === 'MANAGER'} onChange={(e) => patch(i, { questionCount: num(e.target.value) })} /></Field>
                  <Field label="Difficulty">
                    <Select value={s.difficulty} disabled={off} onChange={(e) => patch(i, { difficulty: e.target.value as PipelineStep['difficulty'] })}>
                      {DIFFICULTIES.map((d) => <option key={d} value={d}>{d.charAt(0) + d.slice(1).toLowerCase()}</option>)}
                    </Select>
                  </Field>
                  <Field label="Below cutoff">
                    <Select value={s.cutoffMode} disabled={off} onChange={(e) => patch(i, { cutoffMode: e.target.value as PipelineStep['cutoffMode'] })}>
                      {CUTOFF_MODES.map((m) => <option key={m} value={m}>{CUTOFF_LABEL[m]}</option>)}
                    </Select>
                  </Field>
                  <Field label="Face monitoring">
                    <Select value={s.proctoringLevel} disabled={off} onChange={(e) => patch(i, { proctoringLevel: e.target.value as PipelineStep['proctoringLevel'] })}>
                      {PROCTORING_LEVELS.map((p) => <option key={p} value={p}>{PROCTOR_LABEL[p]}</option>)}
                    </Select>
                  </Field>
                  <Field label="Tab-switch limit (0 = none)">
                    <Input type="number" min={0} max={20} value={s.maxTabSwitches} disabled={off || s.proctoringLevel === 'OFF'} onChange={(e) => patch(i, { maxTabSwitches: num(e.target.value) })} />
                  </Field>
                  <div className="flex items-end pb-2">
                    <label className="flex items-center gap-1.5 text-sm">
                      <input type="checkbox" checked={s.blockPaste} disabled={off || s.proctoringLevel === 'OFF'} onChange={(e) => patch(i, { blockPaste: e.target.checked })} />
                      Block pasting
                    </label>
                  </div>
                  <div className="flex items-end pb-2">
                    <label className="flex items-center gap-1.5 text-sm">
                      <input type="checkbox" checked={s.required} disabled={off} onChange={(e) => patch(i, { required: e.target.checked })} />
                      Required
                    </label>
                  </div>
                </div>
              </Card>
            </li>
          );
        })}
      </ol>

      <div className="flex flex-wrap items-center gap-3">
        <Badge tone={weightTotal === 100 ? 'good' : 'bad'}>Enabled weights: {weightTotal} / 100</Badge>
        {!locked && (
          <Button onClick={save} disabled={busy || issues.length > 0}>{busy ? 'Saving…' : 'Save pipeline'}</Button>
        )}
      </div>

      {issues.length > 0 && !locked && (
        <Alert tone="warn">
          <ul className="list-disc space-y-0.5 pl-4">{issues.map((m) => <li key={m}>{m}</li>)}</ul>
        </Alert>
      )}
      {error && <Alert tone="error">{error}</Alert>}
      {saved && <Alert tone="success">Pipeline saved.</Alert>}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
