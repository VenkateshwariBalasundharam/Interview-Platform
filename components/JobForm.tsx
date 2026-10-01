'use client';
import { useId, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input, Select, Textarea } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { apiFetch } from '@/lib/api-client';
import { getPreset, RESULT_MODES, RETAKE_POLICIES, TIER_PRESETS, TIERS, type ResultMode, type RetakePolicy, type Tier } from '@/lib/pipeline';

export interface JobFormValues {
  title: string;
  jdText: string;
  requiredSkills: string[];
  tier: Tier;
  resultMode: ResultMode;
  retakePolicy: RetakePolicy;
}

const RESULT_LABEL: Record<ResultMode, string> = {
  AUTO_SUGGEST: 'Suggest a decision automatically',
  ALWAYS_HUMAN_REVIEW: 'Always require human review',
};
const RETAKE_LABEL: Record<RetakePolicy, string> = { NONE: 'No retakes', ADMIN_GRANTED: 'Admin can grant retakes' };

export function JobForm({
  jobId,
  initial,
  locked = false,
  onSaved,
  onCancel,
}: {
  jobId?: string;
  initial?: JobFormValues;
  locked?: boolean;
  /** Called after a successful save of an existing job (the edit dialog closes itself here). */
  onSaved?: () => void;
  /** When given, a Cancel button is shown (the edit dialog). */
  onCancel?: () => void;
}) {
  const router = useRouter();
  const uid = useId();
  const editing = Boolean(jobId);
  const [values, setValues] = useState<JobFormValues>(
    initial ?? { title: '', jdText: '', requiredSkills: [], tier: 'FRESHER', resultMode: getPreset('FRESHER').resultMode, retakePolicy: 'NONE' },
  );
  const [skills, setSkills] = useState((initial?.requiredSkills ?? []).join(', '));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const set = <K extends keyof JobFormValues>(key: K, value: JobFormValues[K]) => {
    setSaved(false);
    setValues((v) => ({ ...v, [key]: value }));
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    const requiredSkills = skills.split(',').map((s) => s.trim()).filter(Boolean);
    try {
      if (editing) {
        const body = locked
          ? { title: values.title, retakePolicy: values.retakePolicy }
          : { ...values, requiredSkills };
        await apiFetch(`/api/admin/jobs/${jobId}`, { method: 'PATCH', json: body });
        setSaved(true);
        router.refresh();
        onSaved?.();
      } else {
        const res = await apiFetch<{ job: { id: string } }>('/api/admin/jobs', { method: 'POST', json: { ...values, requiredSkills } });
        router.push(`/admin/jobs/${res.job.id}`);
        return;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the job');
    }
    setBusy(false);
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor={`${uid}-title`}>Job title</Label>
        <Input id={`${uid}-title`} value={values.title} onChange={(e) => set('title', e.target.value)} required minLength={3} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${uid}-jd`}>Job description</Label>
        <Textarea id={`${uid}-jd`} className="min-h-[160px]" value={values.jdText} onChange={(e) => set('jdText', e.target.value)} disabled={locked} required />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${uid}-skills`}>Required skills (comma separated)</Label>
        <Input id={`${uid}-skills`} value={skills} onChange={(e) => { setSaved(false); setSkills(e.target.value); }} disabled={locked} placeholder="React, TypeScript, SQL" required />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor={`${uid}-tier`}>Experience tier</Label>
          <Select
            id={`${uid}-tier`}
            value={values.tier}
            disabled={locked}
            onChange={(e) => {
              const tier = e.target.value as Tier;
              setSaved(false);
              // Creating: follow the tier preset's result mode. Editing: leave the admin's choice alone.
              setValues((v) => ({ ...v, tier, resultMode: editing ? v.resultMode : getPreset(tier).resultMode }));
            }}
          >
            {TIERS.map((t) => <option key={t} value={t}>{TIER_PRESETS[t].label}</option>)}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${uid}-resultMode`}>Final result</Label>
          <Select id={`${uid}-resultMode`} value={values.resultMode} disabled={locked} onChange={(e) => set('resultMode', e.target.value as ResultMode)}>
            {RESULT_MODES.map((m) => <option key={m} value={m}>{RESULT_LABEL[m]}</option>)}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${uid}-retake`}>Retakes</Label>
          <Select id={`${uid}-retake`} value={values.retakePolicy} onChange={(e) => set('retakePolicy', e.target.value as RetakePolicy)}>
            {RETAKE_POLICIES.map((p) => <option key={p} value={p}>{RETAKE_LABEL[p]}</option>)}
          </Select>
        </div>
      </div>
      {!editing && <p className="text-sm text-muted-foreground">The pipeline starts from the tier preset. You can edit it on the next screen.</p>}
      {error && <Alert tone="error">{error}</Alert>}
      {saved && <Alert tone="success">Job details saved.</Alert>}
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>{busy ? 'Saving…' : editing ? 'Save job details' : 'Create job'}</Button>
        {onCancel && <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>Cancel</Button>}
      </div>
    </form>
  );
}
