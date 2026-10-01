'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Pencil, Plus, Trash2 } from 'lucide-react';
import { QuestionEditor } from '@/components/QuestionEditor';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select } from '@/components/ui/input';
import { apiFetch } from '@/lib/api-client';
import type { Difficulty } from '@/lib/pipeline';
import { KIND_LABEL, ROUND_KINDS, type AdminQuestion, type GeneratedRound, type QuestionKind, type SetAction, type SetStatus } from '@/lib/questions';

export interface RoundPanelData {
  roundType: GeneratedRound;
  label: string;
  enabled: boolean;
  questionCount: number;
  difficulty: Difficulty;
  set: null | { id: string; status: SetStatus; version: number; lockedAt: string | null; questions: AdminQuestion[] };
}

const STATUS_BADGE: Record<SetStatus, { label: string; tone: 'neutral' | 'warn' | 'good' }> = {
  DRAFT: { label: 'Draft', tone: 'warn' },
  APPROVED: { label: 'Approved', tone: 'good' },
  LOCKED: { label: 'Locked', tone: 'neutral' },
};

const cap = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();

export function RoundQuestions({ jobId, round, jobStarted }: { jobId: string; round: RoundPanelData; jobStarted: boolean }) {
  const router = useRouter();
  const { set } = round;
  const kinds = ROUND_KINDS[round.roundType];
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [newKind, setNewKind] = useState<QuestionKind>(kinds[0]);
  const [busy, setBusy] = useState<'generate' | 'status' | 'delete' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const editable = set?.status === 'DRAFT' && !jobStarted;
  const count = set?.questions.length ?? 0;
  const shortBy = Math.max(0, round.questionCount - count);

  async function run<T>(kind: 'generate' | 'status' | 'delete', fn: () => Promise<T>): Promise<T | undefined> {
    setBusy(kind);
    setError(null);
    setNotice(null);
    try {
      const result = await fn();
      router.refresh();
      return result;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setBusy(null);
    }
  }

  async function generate() {
    if (set && !window.confirm('Replace this draft with newly generated questions? Any edits you made to it will be lost.')) return;
    setEditing(null);
    const res = await run('generate', () =>
      apiFetch<{ requested: number; created: number }>(`/api/admin/jobs/${jobId}/questions/generate`, { method: 'POST', json: { roundType: round.roundType } }),
    );
    if (res && res.created < res.requested) {
      setNotice(`Only ${res.created} of ${res.requested} questions could be generated. Add the rest manually or generate again.`);
    }
  }

  async function transition(action: SetAction) {
    if (action === 'lock' && !window.confirm('Lock this question set? A locked set can never be edited, reopened or regenerated.')) return;
    if (!set) return;
    await run('status', () => apiFetch(`/api/admin/question-sets/${set.id}`, { method: 'PATCH', json: { action } }));
  }

  async function remove(id: string) {
    if (!window.confirm('Delete this question?')) return;
    await run('delete', () => apiFetch(`/api/admin/questions/${id}`, { method: 'DELETE' }));
  }

  async function save(id: string | 'new', body: Record<string, unknown>) {
    if (!set) return;
    if (id === 'new') await apiFetch(`/api/admin/question-sets/${set.id}/questions`, { method: 'POST', json: { kind: newKind, ...body } });
    else await apiFetch(`/api/admin/questions/${id}`, { method: 'PATCH', json: body });
    setEditing(null);
    router.refresh();
  }

  const badge = set ? STATUS_BADGE[set.status] : null;
  const working = busy !== null;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2">
            {round.label}
            {badge ? <Badge tone={badge.tone}>{badge.label}</Badge> : <Badge>No questions yet</Badge>}
            {!round.enabled && <Badge>Round disabled</Badge>}
          </CardTitle>
          <div className="flex flex-wrap gap-2">
            {(!set || set.status === 'DRAFT') && (
              <Button variant="outline" onClick={generate} disabled={working || jobStarted}>
                {busy === 'generate' ? 'Generating…' : set ? 'Regenerate' : 'Generate questions'}
              </Button>
            )}
            {set?.status === 'DRAFT' && (
              <Button onClick={() => transition('approve')} disabled={working || jobStarted || shortBy > 0} title={shortBy > 0 ? `Needs ${shortBy} more question(s)` : undefined}>
                Approve
              </Button>
            )}
            {set?.status === 'APPROVED' && (
              <>
                <Button variant="outline" onClick={() => transition('reopen')} disabled={working || jobStarted}>Reopen to edit</Button>
                <Button onClick={() => transition('lock')} disabled={working}>Lock</Button>
              </>
            )}
          </div>
        </div>
        <CardDescription>
          {count} of {round.questionCount} question(s) · {cap(round.difficulty)}
          {set ? ` · version ${set.version}` : ''}
          {busy === 'generate' ? ' · this can take up to a minute' : ''}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && <Alert tone="error">{error}</Alert>}
        {notice && <Alert tone="warn">{notice}</Alert>}
        {!set && <p className="text-sm text-muted-foreground">Generate a draft from the job description and required skills, then review it before approving.</p>}
        {set?.status === 'DRAFT' && shortBy > 0 && count > 0 && (
          <Alert tone="warn">This round asks for {round.questionCount} questions. Add {shortBy} more or regenerate before approving.</Alert>
        )}

        {set && (
          <ol className="space-y-3">
            {set.questions.map((q) =>
              editing === q.id ? (
                <li key={q.id}>
                  <QuestionEditor kind={q.kind} initial={q} defaultDifficulty={round.difficulty} onSubmit={(body) => save(q.id, body)} onCancel={() => setEditing(null)} />
                </li>
              ) : (
                <li key={q.id} className="space-y-2 rounded-md border p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                      <p className="text-xs text-muted-foreground">
                        Q{q.position} · {KIND_LABEL[q.kind]} · {q.points} pt · {cap(q.difficulty)}
                      </p>
                      <p className="whitespace-pre-wrap text-sm">{q.prompt}</p>
                    </div>
                    {editable && (
                      <div className="flex shrink-0 gap-1">
                        <Button variant="ghost" size="icon" onClick={() => setEditing(q.id)} disabled={working} aria-label={`Edit question ${q.position}`}><Pencil className="h-4 w-4" /></Button>
                        <Button variant="ghost" size="icon" onClick={() => remove(q.id)} disabled={working} aria-label={`Delete question ${q.position}`}><Trash2 className="h-4 w-4" /></Button>
                      </div>
                    )}
                  </div>
                  {q.options && (
                    <ul className="space-y-1 text-sm">
                      {q.options.map((option, i) => (
                        <li key={i} className={i === q.correctIndex ? 'flex items-start gap-1.5 font-medium' : 'flex items-start gap-1.5 text-muted-foreground'}>
                          {i === q.correctIndex ? <Check className="mt-0.5 h-4 w-4 shrink-0" aria-label="Correct answer" /> : <span className="w-4 shrink-0" />}
                          <span>{option}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {q.rubric && (
                    <details className="text-sm">
                      <summary className="cursor-pointer text-muted-foreground">Key points and sample answer</summary>
                      <ul className="mt-2 list-disc space-y-1 pl-5">{q.rubric.keyPoints.map((p, i) => <li key={i}>{p}</li>)}</ul>
                      <p className="mt-2 whitespace-pre-wrap text-muted-foreground">{q.rubric.sampleAnswer}</p>
                    </details>
                  )}
                </li>
              ),
            )}
          </ol>
        )}

        {editable && (
          editing === 'new' ? (
            <QuestionEditor kind={newKind} defaultDifficulty={round.difficulty} onSubmit={(body) => save('new', body)} onCancel={() => setEditing(null)} />
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              {kinds.length > 1 && (
                <Select className="w-44" value={newKind} onChange={(e) => setNewKind(e.target.value as QuestionKind)} aria-label="New question type">
                  {kinds.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
                </Select>
              )}
              <Button variant="outline" onClick={() => setEditing('new')} disabled={working}><Plus className="h-4 w-4" /> Add question</Button>
            </div>
          )
        )}
        {set?.status === 'LOCKED' && <p className="text-sm text-muted-foreground">Locked. This set can no longer be edited.</p>}
        {jobStarted && <p className="text-sm text-muted-foreground">Candidates have started this job, so its questions can no longer be changed. Clone the job to make changes.</p>}
      </CardContent>
    </Card>
  );
}
