'use client';
import { useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/lib/api-client';
import type { ResumeSummary } from '@/lib/resumes';

const TIER_LABEL = { FRESHER: 'Fresher', MID: 'Mid-level', SENIOR: 'Senior' } as const;

export function ResumeCell({ candidateId, initial }: { candidateId: string; initial: ResumeSummary }) {
  const [resume, setResume] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const base = `/api/admin/candidates/${candidateId}/resume`;

  async function run(label: string, fn: () => Promise<{ resume: ResumeSummary }>) {
    setBusy(label);
    setError(null);
    try {
      setResume((await fn()).resume);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusy(null);
      if (input.current) input.current.value = '';
    }
  }

  const upload = (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return run('Uploading and parsing…', () => apiFetch(base, { method: 'POST', body: form }));
  };

  return (
    <div className="min-w-[15rem] space-y-2">
      <input ref={input} type="file" accept=".pdf,.docx" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />

      {resume.hasResume ? (
        <div className="flex flex-wrap items-center gap-1">
          {resume.parsed ? (
            <>
              <Badge tone="good">Parsed</Badge>
              <Badge>{TIER_LABEL[resume.parsed.tier]}</Badge>
              <span className="text-xs text-muted-foreground">{resume.parsed.experienceYears} yrs · {resume.parsed.skills.length} skills</span>
            </>
          ) : (
            <Badge tone="warn">Uploaded, not parsed</Badge>
          )}
        </div>
      ) : (
        <span className="text-xs text-muted-foreground">No resume</span>
      )}

      <div className="flex flex-wrap gap-1">
        <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => input.current?.click()}>{resume.hasResume ? 'Replace' : 'Upload'}</Button>
        {resume.hasResume && (
          <>
            <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => run('Parsing…', () => apiFetch(`${base}/parse`, { method: 'POST' }))}>Re-parse</Button>
            <Button asChild size="sm" variant="ghost"><a href={base}>Download</a></Button>
            <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => confirm('Remove this resume and its parsed data?') && run('Removing…', () => apiFetch(base, { method: 'DELETE' }))}>Remove</Button>
          </>
        )}
      </div>

      {busy && <p className="text-xs text-muted-foreground">{busy}</p>}
      {error && <p className="text-xs text-red-700" role="alert">{error}</p>}
      {resume.hasResume && !resume.parsed && resume.parseError && !busy && <p className="text-xs text-amber-800">{resume.parseError}</p>}

      {resume.parsed && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground">View parsed data</summary>
          <div className="mt-2 space-y-2">
            <div className="flex flex-wrap gap-1">{resume.parsed.skills.map((s) => <Badge key={s}>{s}</Badge>)}</div>
            <ul className="space-y-1">
              {resume.parsed.projects.map((p) => (
                <li key={p.name}><span className="font-medium">{p.name}</span>{p.summary ? ` — ${p.summary}` : ''}{p.technologies.length ? ` (${p.technologies.join(', ')})` : ''}</li>
              ))}
            </ul>
            <p className="text-muted-foreground">Read by AI, so check it against the original before relying on it.</p>
          </div>
        </details>
      )}
    </div>
  );
}
