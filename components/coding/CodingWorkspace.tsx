'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CodeEditor } from '@/components/coding/CodeEditor';
import { useProctor } from '@/components/proctoring/ProctorGate';
import { apiFetch } from '@/lib/api-client';
import {
  CODING_LANGUAGES,
  getLanguage,
  verdictLabel,
  type CandidateProblem,
  type CodingLanguageId,
  type CodingView,
  type CustomRunReport,
  type ProblemProgress,
  type RunReport,
  type TestReport,
} from '@/lib/coding';

const AUTOSAVE_MS = 1500;
const DIFFICULTY_TONE = { EASY: 'good', MEDIUM: 'warn', HARD: 'bad' } as const;

function formatTime(total: number): string {
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

type Busy = 'run' | 'submit' | 'custom' | null;
type ConsoleTab = 'cases' | 'custom' | 'result';
type Report = RunReport | CustomRunReport;

export function CodingWorkspace({ coding }: { coding: CodingView }) {
  const router = useRouter();
  const proctor = useProctor();
  const [activeId, setActiveId] = useState(coding.problems[0]?.id ?? '');
  const [languages, setLanguages] = useState<Record<string, CodingLanguageId>>(() => Object.fromEntries(Object.entries(coding.drafts).map(([id, d]) => [id, d.language])));
  // One working copy per problem and language, so switching language never loses what was typed.
  const [codes, setCodes] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const p of coding.problems) for (const l of CODING_LANGUAGES) out[`${p.id}:${l.id}`] = p.starter[l.id];
    for (const [id, d] of Object.entries(coding.drafts)) out[`${id}:${d.language}`] = d.code;
    return out;
  });
  const [progress, setProgress] = useState<Record<string, ProblemProgress>>(coding.progress);
  const [reports, setReports] = useState<Record<string, Report | null>>({});
  const [customInputs, setCustomInputs] = useState<Record<string, string>>({});
  const [tab, setTab] = useState<ConsoleTab>('cases');
  const [picked, setPicked] = useState(0);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [secondsLeft, setSecondsLeft] = useState(coding.secondsLeft);
  const [finishing, setFinishing] = useState(false);

  const problem: CandidateProblem | undefined = coding.problems.find((p) => p.id === activeId);
  const language = languages[activeId] ?? 'python';
  const code = codes[`${activeId}:${language}`] ?? '';

  const latest = useRef({ languages, codes });
  latest.current = { languages, codes };
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const dirty = useRef<Set<string>>(new Set());
  const finishedRef = useRef(false);

  const saveNow = useCallback(async (problemId: string) => {
    dirty.current.delete(problemId);
    const lang = latest.current.languages[problemId] ?? 'python';
    setSaveState('saving');
    try {
      await apiFetch('/api/candidate/coding/save', { method: 'PATCH', json: { problemId, language: lang, code: latest.current.codes[`${problemId}:${lang}`] ?? '' } });
      setSaveState(dirty.current.size > 0 ? 'saving' : 'saved');
    } catch {
      dirty.current.add(problemId);
      setSaveState('error');
    }
  }, []);

  const flushAll = useCallback(async () => {
    clearTimeout(saveTimer.current);
    await Promise.all([...dirty.current].map((id) => saveNow(id)));
  }, [saveNow]);

  function edit(value: string) {
    setCodes((prev) => ({ ...prev, [`${activeId}:${language}`]: value }));
    latest.current = { languages: latest.current.languages, codes: { ...latest.current.codes, [`${activeId}:${language}`]: value } };
    dirty.current.add(activeId);
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void flushAll(), AUTOSAVE_MS);
  }

  function changeLanguage(next: CodingLanguageId) {
    setLanguages((prev) => ({ ...prev, [activeId]: next }));
    latest.current = { ...latest.current, languages: { ...latest.current.languages, [activeId]: next } };
    dirty.current.add(activeId);
    void flushAll();
  }

  function openProblem(id: string) {
    void flushAll();
    setActiveId(id);
    setPicked(0);
    setError(null);
    setTab('cases');
  }

  async function execute(kind: 'run' | 'submit' | 'custom') {
    if (!problem || busy) return;
    setBusy(kind);
    setError(null);
    clearTimeout(saveTimer.current);
    dirty.current.delete(activeId);
    try {
      const base = { problemId: activeId, language, code };
      const url = kind === 'submit' ? '/api/candidate/coding/submit' : '/api/candidate/coding/run';
      const body = kind === 'custom' ? { ...base, customInput: customInputs[activeId] ?? '' } : base;
      const report = await apiFetch<Report>(url, { method: 'POST', json: body });
      setReports((prev) => ({ ...prev, [activeId]: report }));
      setPicked(0);
      setTab(kind === 'custom' ? 'custom' : 'result');
      setSaveState('saved');
      if (report.mode === 'submit' && report.best) {
        const best = report.best;
        setProgress((prev) => ({ ...prev, [activeId]: { passed: best.passed, total: best.total, submissions: (prev[activeId]?.submissions ?? 0) + 1, verdict: report.overall } }));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(null);
    }
  }

  const finishRound = useCallback(async () => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    setFinishing(true);
    try {
      await flushAll();
      await proctor.flush(); // last proctoring events go out before the round ends
      await apiFetch('/api/candidate/rounds/CODING/submit', { method: 'POST' });
    } catch {
      // The server enforces the deadline itself, so a refresh always lands on the right screen.
    } finally {
      router.refresh();
    }
  }, [flushAll, proctor, router]);

  useEffect(() => {
    if (secondsLeft <= 0) {
      void finishRound();
      return;
    }
    const id = setTimeout(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearTimeout(id);
  }, [secondsLeft, finishRound]);

  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') void flushAll();
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onHide);
    };
  }, [flushAll]);

  function confirmFinish() {
    const unsolved = coding.problems.filter((p) => !(progress[p.id]?.total && progress[p.id].passed === progress[p.id].total)).length;
    const msg = unsolved > 0 ? `${unsolved} problem(s) are not fully solved. Only your best submission for each problem counts. Finish the round anyway?` : 'Finish the round? You cannot change anything afterwards.';
    if (proctor.confirm(msg)) void finishRound();
  }

  const report = reports[activeId] ?? null;
  const low = secondsLeft <= 300;
  const solvedCount = useMemo(() => coding.problems.filter((p) => progress[p.id]?.total && progress[p.id].passed === progress[p.id].total).length, [coding.problems, progress]);
  if (!problem) return <div className="p-8 text-sm">No problems are set up for this round.</div>;

  return (
    <div className="flex h-screen flex-col bg-background">
      <header className={`flex items-center justify-between gap-4 border-b px-4 py-2 ${low ? 'bg-red-50' : ''}`}>
        <div className="flex items-center gap-2 overflow-x-auto">
          <span className="mr-2 text-sm font-semibold">{coding.round.label}</span>
          {coding.problems.map((p, i) => {
            const pr = progress[p.id];
            const solved = !!pr?.total && pr.passed === pr.total;
            const dot = solved ? 'bg-green-500' : pr && pr.submissions > 0 ? 'bg-amber-500' : 'bg-muted-foreground/40';
            return (
              <button key={p.id} onClick={() => openProblem(p.id)} className={`flex items-center gap-2 rounded-md border px-3 py-1 text-sm ${p.id === activeId ? 'border-ring bg-accent' : 'border-input hover:bg-muted'}`}>
                <span className={`h-2 w-2 rounded-full ${dot}`} />
                {i + 1}. {p.title}
              </button>
            );
          })}
        </div>
        <div className="flex shrink-0 items-center gap-4">
          <span className="text-xs text-muted-foreground">
            {solvedCount}/{coding.problems.length} solved
            {saveState === 'saving' && ' · Saving…'}
            {saveState === 'saved' && ' · Saved'}
            {saveState === 'error' && ' · Save failed'}
          </span>
          <span className={`font-mono text-lg font-semibold ${low ? 'text-red-700' : ''}`}>{formatTime(secondsLeft)}</span>
          <Button variant="outline" size="sm" onClick={confirmFinish} disabled={finishing}>
            {finishing ? 'Finishing…' : 'Finish round'}
          </Button>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(320px,40%)_1fr]">
        <section className="overflow-y-auto border-r p-5">
          <div className="mb-3 flex items-center gap-2">
            <h1 className="text-lg font-semibold">{problem.title}</h1>
            <Badge tone={DIFFICULTY_TONE[problem.difficulty]}>{problem.difficulty.toLowerCase()}</Badge>
          </div>
          <p className="mb-4 text-xs text-muted-foreground">
            Time limit {problem.timeLimitSec}s per test · {problem.samples.length} sample and {problem.hiddenCount} hidden test{problem.hiddenCount === 1 ? '' : 's'}. Read from standard input, write to standard output.
          </p>
          <div className="whitespace-pre-wrap text-sm leading-relaxed">{problem.statement}</div>
          {problem.samples.map((s, i) => (
            <div key={i} className="mt-5 space-y-2">
              <div className="text-sm font-semibold">Sample {i + 1}</div>
              <IoBlock label="Input" text={s.input} />
              <IoBlock label="Output" text={s.expectedOutput} />
            </div>
          ))}
        </section>

        <section className="flex min-h-0 flex-col">
          <div className="flex items-center justify-between border-b px-3 py-2">
            <select value={language} onChange={(e) => changeLanguage(e.target.value as CodingLanguageId)} className="rounded-md border border-input bg-background px-2 py-1 text-sm" aria-label="Language">
              {CODING_LANGUAGES.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.label}
                </option>
              ))}
            </select>
            <button className="text-xs text-muted-foreground underline" onClick={() => proctor.confirm('Replace your code with the starting template?') && edit(problem.starter[language])}>
              Reset code
            </button>
          </div>

          <div className="min-h-0 flex-1">
            <CodeEditor key={`${activeId}:${language}`} language={getLanguage(language).monaco} value={code} onChange={edit} onRun={() => void execute('run')} />
          </div>

          <div className="flex h-64 shrink-0 flex-col border-t">
            <div className="flex items-center justify-between border-b px-3 py-1">
              <div className="flex gap-1 text-sm">
                {(['cases', 'custom', 'result'] as const).map((t) => (
                  <button key={t} onClick={() => setTab(t)} className={`rounded px-3 py-1 ${tab === t ? 'bg-accent font-medium' : 'hover:bg-muted'}`}>
                    {t === 'cases' ? 'Sample tests' : t === 'custom' ? 'Custom input' : 'Result'}
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => void execute(tab === 'custom' ? 'custom' : 'run')} disabled={busy !== null} title="Ctrl/Cmd + Enter">
                  {busy === 'run' || busy === 'custom' ? 'Running…' : 'Run code'}
                </Button>
                <Button size="sm" onClick={() => void execute('submit')} disabled={busy !== null}>
                  {busy === 'submit' ? 'Submitting…' : 'Submit code'}
                </Button>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-3 text-sm">
              {error && <div className="mb-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-red-800">{error}</div>}
              {tab === 'cases' && (
                <div className="space-y-2">
                  {problem.samples.map((s, i) => (
                    <div key={i} className="grid grid-cols-2 gap-2">
                      <IoBlock label={`Sample ${i + 1} input`} text={s.input} />
                      <IoBlock label="Expected output" text={s.expectedOutput} />
                    </div>
                  ))}
                  <p className="text-xs text-muted-foreground">Run code checks the samples. Submit code also runs the {problem.hiddenCount} hidden test(s) and counts towards your score.</p>
                </div>
              )}
              {tab === 'custom' && (
                <div className="space-y-2">
                  <textarea
                    value={customInputs[activeId] ?? ''}
                    onChange={(e) => setCustomInputs((prev) => ({ ...prev, [activeId]: e.target.value }))}
                    rows={4}
                    placeholder="Type your own input, then press Run code"
                    className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs"
                    aria-label="Custom input"
                  />
                  {report?.mode === 'custom' && <CustomOutput report={report} />}
                </div>
              )}
              {tab === 'result' && (report && report.mode !== 'custom' ? <Results report={report} picked={picked} onPick={setPicked} /> : <p className="text-muted-foreground">Run or submit your code to see results here.</p>)}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function IoBlock({ label, text }: { label: string; text: string }) {
  return (
    <div>
      <div className="mb-1 text-xs font-medium text-muted-foreground">{label}</div>
      <pre className="overflow-x-auto whitespace-pre rounded-md bg-muted px-3 py-2 font-mono text-xs">{text === '' ? ' ' : text}</pre>
    </div>
  );
}

function CustomOutput({ report }: { report: CustomRunReport }) {
  return (
    <div className="space-y-2">
      <div className={`text-sm font-medium ${report.verdict === 'PASSED' ? 'text-green-700' : 'text-red-700'}`}>
        {report.verdict === 'PASSED' ? 'Ran successfully' : verdictLabel(report.verdict)}
        {report.timeMs !== null && <span className="ml-2 font-normal text-muted-foreground">{report.timeMs} ms</span>}
      </div>
      <IoBlock label="Output" text={report.stdout} />
      {report.message && <IoBlock label="Messages" text={report.message} />}
    </div>
  );
}

function Results({ report, picked, onPick }: { report: RunReport; picked: number; onPick: (i: number) => void }) {
  const ok = report.overall === 'PASSED';
  const test: TestReport | undefined = report.tests[picked];
  return (
    <div className="space-y-3">
      <div className={`text-sm font-semibold ${ok ? 'text-green-700' : 'text-red-700'}`}>
        {ok ? (report.mode === 'submit' ? 'All tests passed' : 'All sample tests passed') : verdictLabel(report.overall)}
        <span className="ml-2 font-normal text-muted-foreground">
          {report.passed} of {report.total} {report.mode === 'submit' ? 'tests' : 'sample tests'} passed
          {report.best && report.mode === 'submit' && ` · your best: ${report.best.passed}/${report.best.total}`}
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        {report.tests.map((t, i) => (
          <button key={i} onClick={() => onPick(i)} className={`rounded-md border px-2 py-1 text-xs ${i === picked ? 'border-ring bg-accent' : 'border-input hover:bg-muted'}`}>
            <span className={t.verdict === 'PASSED' ? 'text-green-700' : 'text-red-700'}>{t.verdict === 'PASSED' ? '✓' : '✗'}</span> {t.isSample ? `Sample ${t.index + 1}` : `Hidden ${t.index + 1 - report.tests.filter((x) => x.isSample).length}`}
          </button>
        ))}
      </div>
      {test && (
        <div className="space-y-2">
          <div className="text-xs">
            {verdictLabel(test.verdict)}
            {test.timeMs !== undefined && <span className="text-muted-foreground"> · {test.timeMs} ms</span>}
          </div>
          {test.isSample ? (
            <div className="grid grid-cols-3 gap-2">
              <IoBlock label="Input" text={test.input ?? ''} />
              <IoBlock label="Expected output" text={test.expected ?? ''} />
              <IoBlock label="Your output" text={test.actual ?? ''} />
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">The input and expected output of hidden tests are not shown.</p>
          )}
          {test.message && <IoBlock label="Messages" text={test.message} />}
        </div>
      )}
    </div>
  );
}
