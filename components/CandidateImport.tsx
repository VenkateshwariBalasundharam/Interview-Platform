'use client';
import { useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { JobPicker } from '@/components/JobPicker';
import { Input, Select, Textarea } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { apiFetch } from '@/lib/api-client';
import { csvSafeCell } from '@/lib/csv-export';
import type { ImportResult } from '@/lib/candidates';
import { TIER_PRESETS, TIERS, type Tier } from '@/lib/pipeline';

const MAX_FILE_BYTES = 2 * 1024 * 1024;

export function CandidateImport({ jobs, defaultJobId }: { jobs: { id: string; title: string }[]; defaultJobId?: string }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [jobId, setJobId] = useState(defaultJobId ?? jobs[0]?.id ?? '');
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // A job typed by the admin that does not exist yet. It is created when the import runs, never on "Validate only".
  const [newTitle, setNewTitle] = useState<string | null>(null);
  const [jd, setJd] = useState('');
  const [skills, setSkills] = useState('');
  const [tier, setTier] = useState<Tier>('FRESHER');
  const creating = newTitle !== null;

  async function run(dryRun: boolean) {
    const file = fileRef.current?.files?.[0];
    if (!file) { setError('Choose a file first.'); return; }
    if (file.size > MAX_FILE_BYTES) { setError('The file must be smaller than 2 MB.'); return; }
    const requiredSkills = skills.split(',').map((x) => x.trim()).filter(Boolean);
    if (creating) {
      if (jd.trim().length < 20) { setError('Describe the job in at least 20 characters.'); return; }
      if (requiredSkills.length === 0) { setError('Add at least one required skill.'); return; }
    }
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const form = new FormData();
      if (creating) form.set('newJob', JSON.stringify({ title: newTitle, jdText: jd.trim(), requiredSkills, tier }));
      else form.set('jobId', jobId);
      form.set('dryRun', String(dryRun));
      form.set('file', file);
      const res = await apiFetch<ImportResult>('/api/admin/candidates/import', { method: 'POST', body: form });
      setResult(res);
      if (!dryRun) {
        if (res.createdJob) { setJobId(res.createdJob.id); setNewTitle(null); setJd(''); setSkills(''); }
        router.refresh();
        if (fileRef.current) fileRef.current.value = '';
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed');
    }
    setBusy(false);
  }

  function downloadCredentials() {
    if (!result) return;
    const lines = ['candidate_id,name,email', ...result.created.map((c) => [c.candidateCode, c.name, c.email].map(csvSafeCell).join(','))];
    const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'candidate-ids.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      <form onSubmit={(e: FormEvent) => e.preventDefault()} className="grid items-end gap-4 md:grid-cols-[1fr_1fr_auto]">
        <div className="space-y-1.5">
          <Label htmlFor="importJob">Job</Label>
          <JobPicker
            id="importJob"
            jobs={jobs}
            value={jobId}
            onChange={(id) => { setJobId(id); setNewTitle(null); }}
            onCreateNew={(title) => { setJobId(''); setNewTitle(title); }}
            creating={creating}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="csv">Candidate list (columns: name, email, dob)</Label>
          <Input id="csv" type="file" ref={fileRef} />
        </div>
        <div className="flex gap-2">
          <Button variant="outline" disabled={busy || (!jobId && !creating)} onClick={() => run(true)}>Validate only</Button>
          <Button disabled={busy || (!jobId && !creating)} onClick={() => run(false)}>{busy ? 'Working…' : 'Import'}</Button>
        </div>
      </form>
      <p className="text-xs text-muted-foreground">
        Excel (.xlsx), CSV, TSV, TXT or JSON with the columns name, email and dob. Up to 200 rows and 2 MB.
      </p>

      {creating && (
        <div className="space-y-3 rounded-md border bg-muted/40 p-4">
          <div>
            <h3 className="text-sm font-medium">New job: {newTitle}</h3>
            <p className="text-xs text-muted-foreground">The job is created when you press Import, with the standard rounds for the level you choose. You can edit its rounds later on the Jobs page. “Validate only” creates nothing.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="newJobJd">Job description (what the company needs for this role)</Label>
            <Textarea id="newJobJd" className="min-h-[100px]" value={jd} onChange={(e) => setJd(e.target.value)} />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="newJobSkills">Required skills (comma separated)</Label>
              <Input id="newJobSkills" value={skills} onChange={(e) => setSkills(e.target.value)} placeholder="SQL, Excel, Power BI" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="newJobTier">Level</Label>
              <Select id="newJobTier" value={tier} onChange={(e) => setTier(e.target.value as Tier)}>
                {TIERS.map((t) => <option key={t} value={t}>{TIER_PRESETS[t].label}</option>)}
              </Select>
            </div>
          </div>
        </div>
      )}

      {error && <Alert tone="error">{error}</Alert>}

      {result && (
        <div className="space-y-3">
          <Alert tone={result.rejected.length ? 'warn' : 'success'}>
            {result.dryRun
              ? `${result.validCount} row(s) are valid and ready to import; ${result.rejected.length} rejected. Nothing has been saved.`
              : `${result.created.length} candidate(s) created${result.createdJob ? ` under the new job “${result.createdJob.title}”` : ''}; ${result.rejected.length} rejected.`}
          </Alert>

          {!result.dryRun && result.created.length > 0 && result.emails && (
            <Alert tone={result.emails.disabledReason ? 'warn' : 'success'}>
              {result.emails.disabledReason
                ? `No invitation emails were queued. ${result.emails.disabledReason} You can share the IDs below by hand.`
                : `${result.emails.queued} invitation email(s) queued with each candidate's login link. They go out within a minute. The password is never in the email: candidates use their date of birth.`}
            </Alert>
          )}

          {result.created.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium">New Candidate IDs</h3>
                <Button variant="outline" size="sm" onClick={downloadCredentials}>Download IDs (CSV)</Button>
              </div>
              <p className="text-xs text-muted-foreground">Share each ID with its candidate. Their password is their date of birth (DDMMYYYY).</p>
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead className="bg-muted text-left"><tr><th className="p-2">Row</th><th className="p-2">Candidate ID</th><th className="p-2">Name</th><th className="p-2">Email</th></tr></thead>
                  <tbody>{result.created.map((c) => (
                    <tr key={c.candidateCode} className="border-t"><td className="p-2">{c.row}</td><td className="p-2 font-mono">{c.candidateCode}</td><td className="p-2">{c.name}</td><td className="p-2">{c.email}</td></tr>
                  ))}</tbody>
                </table>
              </div>
            </div>
          )}

          {result.rejected.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-medium">Rejected rows</h3>
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead className="bg-muted text-left"><tr><th className="p-2">Row</th><th className="p-2">Name</th><th className="p-2">Email</th><th className="p-2">Problems</th></tr></thead>
                  <tbody>{result.rejected.map((r) => (
                    <tr key={r.row} className="border-t align-top"><td className="p-2">{r.row}</td><td className="p-2">{r.name ?? '—'}</td><td className="p-2">{r.email ?? '—'}</td><td className="p-2">{r.errors.join('; ')}</td></tr>
                  ))}</tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
