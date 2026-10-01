'use client';
import { useState, type FormEvent } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input, Select, Textarea } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DIFFICULTIES, type Difficulty } from '@/lib/pipeline';
import { DEFAULT_POINTS, KIND_LABEL, MCQ_OPTION_COUNT, type AdminQuestion, type QuestionKind } from '@/lib/questions';

/** Edits one question, or creates one when `initial` is omitted. The parent sends the body and closes the editor on success. */
export function QuestionEditor({
  kind,
  initial,
  defaultDifficulty,
  onSubmit,
  onCancel,
}: {
  kind: QuestionKind;
  initial?: AdminQuestion;
  defaultDifficulty: Difficulty;
  onSubmit: (body: Record<string, unknown>) => Promise<void>;
  onCancel: () => void;
}) {
  const [prompt, setPrompt] = useState(initial?.prompt ?? '');
  const [options, setOptions] = useState<string[]>(initial?.options ?? Array<string>(MCQ_OPTION_COUNT).fill(''));
  const [correctIndex, setCorrectIndex] = useState(initial?.correctIndex ?? 0);
  const [keyPoints, setKeyPoints] = useState((initial?.rubric?.keyPoints ?? []).join('\n'));
  const [sampleAnswer, setSampleAnswer] = useState(initial?.rubric?.sampleAnswer ?? '');
  const [points, setPoints] = useState(initial?.points ?? DEFAULT_POINTS[kind]);
  const [difficulty, setDifficulty] = useState<Difficulty>(initial?.difficulty ?? defaultDifficulty);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const common = { prompt, points, difficulty };
    const body =
      kind === 'MCQ'
        ? { ...common, options, correctIndex }
        : { ...common, rubric: { keyPoints: keyPoints.split('\n').map((l) => l.trim()).filter(Boolean), sampleAnswer } };
    try {
      await onSubmit(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the question');
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-md border bg-muted/40 p-4">
      <p className="text-sm font-medium">{initial ? 'Edit question' : `New ${KIND_LABEL[kind].toLowerCase()} question`}</p>
      <div className="space-y-1.5">
        <Label htmlFor="q-prompt">Question</Label>
        <Textarea id="q-prompt" value={prompt} onChange={(e) => setPrompt(e.target.value)} required />
      </div>

      {kind === 'MCQ' ? (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Options (select the correct one)</legend>
          {options.map((option, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                type="radio"
                name="correct"
                checked={correctIndex === i}
                onChange={() => setCorrectIndex(i)}
                aria-label={`Option ${i + 1} is correct`}
              />
              <Input
                value={option}
                onChange={(e) => setOptions(options.map((o, idx) => (idx === i ? e.target.value : o)))}
                aria-label={`Option ${i + 1}`}
                required
              />
            </div>
          ))}
        </fieldset>
      ) : (
        <>
          <div className="space-y-1.5">
            <Label htmlFor="q-points">Key points a good answer covers (one per line)</Label>
            <Textarea id="q-points" value={keyPoints} onChange={(e) => setKeyPoints(e.target.value)} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="q-sample">Sample answer</Label>
            <Textarea id="q-sample" value={sampleAnswer} onChange={(e) => setSampleAnswer(e.target.value)} required />
          </div>
        </>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="q-score">Points</Label>
          <Input id="q-score" type="number" min={1} max={20} value={points} onChange={(e) => setPoints(Number(e.target.value))} required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="q-difficulty">Difficulty</Label>
          <Select id="q-difficulty" value={difficulty} onChange={(e) => setDifficulty(e.target.value as Difficulty)}>
            {DIFFICULTIES.map((d) => <option key={d} value={d}>{d.charAt(0) + d.slice(1).toLowerCase()}</option>)}
          </Select>
        </div>
      </div>

      {error && <Alert tone="error">{error}</Alert>}
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save question'}</Button>
        <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>Cancel</Button>
      </div>
    </form>
  );
}
