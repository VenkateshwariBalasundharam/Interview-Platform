'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { apiFetch } from '@/lib/api-client';
import type { CandidateQuestion, ExamView } from '@/lib/round-engine';

function formatTime(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error';
type Payload = { choice: number | null } | { text: string };

/** Typed answers are saved this long after the last keystroke, and immediately on leaving the box or submitting. */
const TEXT_SAVE_DELAY_MS = 1200;

export function RoundExam({ roundType, exam }: { roundType: string; exam: ExamView }) {
  const router = useRouter();
  const [choices, setChoices] = useState<Record<string, number>>(exam.choices);
  const [texts, setTexts] = useState<Record<string, string>>(exam.texts);
  const [secondsLeft, setSecondsLeft] = useState(exam.secondsLeft);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submittedRef = useRef(false);
  const textsRef = useRef<Record<string, string>>(exam.texts); // latest text, readable from timers
  const dirty = useRef<Set<string>>(new Set()); // typed answers not yet sent
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const chains = useRef<Record<string, Promise<void>>>({}); // saves for one question go out in order
  const pending = useRef(0);
  const failed = useRef<Set<string>>(new Set());

  const enqueueSave = useCallback(
    (questionId: string, payload: Payload): Promise<void> => {
      pending.current += 1;
      setSaveState('saving');
      const previous = chains.current[questionId] ?? Promise.resolve();
      const run = previous.then(async () => {
        try {
          await apiFetch(`/api/candidate/rounds/${roundType}/answer`, { method: 'PATCH', json: { questionId, ...payload } });
          failed.current.delete(questionId);
          if (failed.current.size === 0) setError(null);
        } catch (e) {
          failed.current.add(questionId);
          setError(e instanceof Error ? e.message : 'Could not save that answer.');
        } finally {
          pending.current -= 1;
          setSaveState(pending.current > 0 ? 'saving' : failed.current.size > 0 ? 'error' : 'saved');
        }
      });
      chains.current[questionId] = run;
      return run;
    },
    [roundType],
  );

  const flushOne = useCallback(
    (questionId: string): Promise<void> => {
      clearTimeout(timers.current[questionId]);
      if (!dirty.current.has(questionId)) return Promise.resolve();
      dirty.current.delete(questionId);
      return enqueueSave(questionId, { text: textsRef.current[questionId] ?? '' });
    },
    [enqueueSave],
  );

  const flushAll = useCallback(async () => {
    await Promise.all([...dirty.current].map(flushOne));
    await Promise.all(Object.values(chains.current));
  }, [flushOne]);

  const submit = useCallback(async () => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    setSubmitting(true);
    try {
      await flushAll(); // make sure the last thing typed is saved before the round closes
      await apiFetch(`/api/candidate/rounds/${roundType}/submit`, { method: 'POST' });
    } catch {
      // Even if this call fails (e.g. time already expired server-side), the server has its own
      // grace-window enforcement, so refreshing always lands on the right phase.
    } finally {
      router.refresh();
    }
  }, [flushAll, roundType, router]);

  // Countdown, ticking once a second; auto-submits the moment it hits zero.
  useEffect(() => {
    if (secondsLeft <= 0) {
      submit();
      return;
    }
    const id = setTimeout(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearTimeout(id);
  }, [secondsLeft, submit]);

  // Send anything unsaved when the tab is hidden or the page is closed.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') void flushAll();
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onHide);
    const pendingTimers = timers.current;
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onHide);
      Object.values(pendingTimers).forEach(clearTimeout);
    };
  }, [flushAll]);

  function choose(questionId: string, choice: number) {
    setChoices((prev) => ({ ...prev, [questionId]: choice }));
    void enqueueSave(questionId, { choice });
  }

  function type(question: CandidateQuestion, value: string) {
    const text = question.maxChars ? value.slice(0, question.maxChars) : value;
    textsRef.current[question.id] = text;
    setTexts((prev) => ({ ...prev, [question.id]: text }));
    dirty.current.add(question.id);
    clearTimeout(timers.current[question.id]);
    timers.current[question.id] = setTimeout(() => void flushOne(question.id), TEXT_SAVE_DELAY_MS);
  }

  const isAnswered = (q: CandidateQuestion) => (q.kind === 'MCQ' ? choices[q.id] !== undefined : (texts[q.id] ?? '').trim().length > 0);
  const answeredCount = exam.questions.filter(isAnswered).length;
  const unanswered = exam.questions.length - answeredCount;
  const low = secondsLeft <= 60;

  function confirmSubmit() {
    const message = unanswered > 0 ? `You have ${unanswered} unanswered question(s). Submit anyway? You cannot change your answers afterwards.` : 'Submit this round? You cannot change your answers afterwards.';
    if (window.confirm(message)) void submit();
  }

  return (
    <div className="space-y-4">
      <div
        className={`sticky top-0 z-10 -mx-8 flex items-center justify-between border-b px-8 py-3 backdrop-blur ${
          low ? 'bg-red-50/95' : 'bg-background/95'
        }`}
      >
        <div>
          <div className="text-sm font-semibold">{exam.round.label}</div>
          <div className="text-xs text-muted-foreground">
            {answeredCount} of {exam.questions.length} answered
            {saveState === 'saving' && ' · Saving…'}
            {saveState === 'saved' && ' · Saved'}
            {saveState === 'error' && ' · Save failed'}
          </div>
        </div>
        <div className={`text-lg font-mono font-semibold ${low ? 'text-red-700' : ''}`}>{formatTime(secondsLeft)}</div>
      </div>

      {error && <Alert tone="error">{error}</Alert>}

      {exam.questions.map((q, i) => (
        <Card key={q.id}>
          <CardHeader>
            <CardDescription>
              Question {i + 1} of {exam.questions.length} · {q.points} {q.points === 1 ? 'point' : 'points'}
            </CardDescription>
            <CardTitle className="whitespace-pre-line text-base font-medium leading-snug">{q.prompt}</CardTitle>
          </CardHeader>
          <CardContent>
            {q.kind === 'MCQ' ? (
              <fieldset className="space-y-2">
                {q.options.map((option, idx) => (
                  <label
                    key={idx}
                    className={`flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2 text-sm hover:bg-muted ${
                      choices[q.id] === idx ? 'border-ring bg-accent' : 'border-input'
                    }`}
                  >
                    <input type="radio" name={q.id} checked={choices[q.id] === idx} onChange={() => choose(q.id, idx)} className="h-4 w-4" />
                    {option}
                  </label>
                ))}
              </fieldset>
            ) : (
              <div className="space-y-1">
                <textarea
                  value={texts[q.id] ?? ''}
                  onChange={(e) => type(q, e.target.value)}
                  onBlur={() => void flushOne(q.id)}
                  rows={q.kind === 'WRITTEN' ? 10 : 5}
                  maxLength={q.maxChars ?? undefined}
                  placeholder={q.kind === 'WRITTEN' ? 'Write your answer here. Structure it and explain your reasoning.' : 'Write a short answer (2 to 4 sentences).'}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-ring"
                  aria-label={`Answer to question ${i + 1}`}
                />
                {q.maxChars && (
                  <div className="text-right text-xs text-muted-foreground">
                    {(texts[q.id] ?? '').length} / {q.maxChars}
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      ))}

      <div className="flex justify-end pb-8">
        <Button onClick={confirmSubmit} disabled={submitting}>
          {submitting ? 'Submitting…' : 'Submit round'}
        </Button>
      </div>
    </div>
  );
}
