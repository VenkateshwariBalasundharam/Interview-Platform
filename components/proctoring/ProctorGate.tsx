'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, Maximize, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { BLUR_MIN_AWAY_MS, MAX_EVENTS_PER_REQUEST, formatAway } from '@/lib/proctoring-core';
import { FaceMonitor, FaceSetup, type FaceLevel } from '@/components/proctoring/FaceMonitor';
import { cameraSkipKey, parseSkipReason, type CameraSkipReason } from '@/lib/face-client-core';

const SEND_EVERY_MS = 5000;
/** Events kept in memory while the network is down. The oldest are dropped past this. */
const MAX_QUEUE = 200;
/** After a confirm box closes, the window's focus events can arrive late; ignore them for this long. */
const CONFIRM_TAIL_MS = 1000;
/** The most a submit waits for the last proctoring events to go out. */
const FLUSH_WAIT_MS = 3000;

type QueuedEvent =
  | { type: 'TAB_SWITCH'; at: number; awayMs: number; source: 'hidden' | 'blur' }
  | { type: 'PASTE'; at: number; chars: number; target: 'answer' | 'editor' | 'other'; blocked?: true; via?: 'paste' | 'drop' }
  | { type: 'FULLSCREEN_EXIT'; at: number; refused?: true }
  | { type: 'CAMERA_UNAVAILABLE'; at: number; reason: CameraSkipReason };

/** The browser sends "how long ago" instead of a clock time, so a wrong clock on the candidate's computer changes nothing. */
function toWire(event: QueuedEvent, sentAt: number) {
  const { at, ...rest } = event;
  const msAgo = Math.max(0, Math.round(sentAt - at));
  if (rest.type === 'TAB_SWITCH') return { ...rest, awayMs: Math.max(0, Math.round(rest.awayMs)), msAgo };
  if (rest.type === 'PASTE') return { ...rest, chars: Math.max(0, Math.round(rest.chars)), msAgo };
  return { ...rest, msAgo };
}

interface ProctorApi {
  /** Same as window.confirm, but the box is not counted as leaving the exam. */
  confirm: (message: string) => boolean;
  /** Sends any waiting events now. Safe to call at any time. */
  flush: () => Promise<void>;
  /** Pasting is blocked in this round. The code editor uses this to turn off its own paste routes. */
  blockPaste: boolean;
  /** For paste routes the page cannot see (the editor's own menu). Records the attempt and shows the notice. */
  reportBlockedPaste: (target: 'answer' | 'editor' | 'other') => void;
}

const fallback: ProctorApi = { confirm: (message) => window.confirm(message), flush: async () => {}, blockPaste: false, reportBlockedPaste: () => {} };
const ProctorContext = createContext<ProctorApi>(fallback);

/** Screens inside a gate use this for their Submit / Finish confirm boxes. Outside a gate it is plain window.confirm. */
export function useProctor(): ProctorApi {
  return useContext(ProctorContext);
}

/**
 * Wraps a running round. When `enabled` is false (proctoring Off) it renders the children untouched.
 * Otherwise it hides the exam behind a notice until the candidate enters full-screen, and records
 * tab switches, pastes (length only) and full-screen exits. Nothing is blocked and nothing fails automatically.
 */
export function ProctorGate({
  enabled,
  faceLevel = 'OFF',
  cameraRequired = true,
  roundType,
  maxTabSwitches = 0,
  tabSwitchesUsed = 0,
  blockPaste = false,
  children,
}: {
  enabled: boolean;
  /** Camera checks. Anything but OFF adds the camera step and the live face monitor. */
  faceLevel?: FaceLevel;
  /** false = a candidate whose camera does not work may continue without it. The hiring team sees that they did. */
  cameraRequired?: boolean;
  roundType: string;
  /** Tab switches allowed before the round is submitted automatically. 0 means no limit. */
  maxTabSwitches?: number;
  /** Switches already used when the page loaded, so a refresh keeps the counter. */
  tabSwitchesUsed?: number;
  /** Pasting (and dropping text) into the exam is blocked and each attempt is recorded. */
  blockPaste?: boolean;
  children: ReactNode;
}) {
  if (!enabled) return <>{children}</>;
  return (
    <ActiveGate roundType={roundType} faceLevel={faceLevel} cameraRequired={cameraRequired} maxTabSwitches={maxTabSwitches} initialUsed={tabSwitchesUsed} blockPaste={blockPaste}>
      {children}
    </ActiveGate>
  );
}

/** The part of the server's answer the screen uses. The server's count is the only one that matters. */
interface ServerReply {
  tabSwitches?: { used: number; max: number; remaining: number | null; reached: boolean; message: string | null };
  ended?: boolean;
}

function ActiveGate({ roundType, faceLevel, cameraRequired, maxTabSwitches, initialUsed, blockPaste, children }: { roundType: string; faceLevel: FaceLevel; cameraRequired: boolean; maxTabSwitches: number; initialUsed: number; blockPaste: boolean; children: ReactNode }) {
  const [used, setUsed] = useState(initialUsed);
  const [warning, setWarning] = useState<string | null>(null);
  const [ended, setEnded] = useState(false);
  const [pasteNotice, setPasteNotice] = useState(false);
  // Shown as a popup when the candidate comes back from another tab or window.
  const [awayNotice, setAwayNotice] = useState<{ awayMs: number; source: 'hidden' | 'blur' } | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastBlockedAt = useRef(0);
  // Covered from the first paint, so the questions never flash before the notice.
  const [covered, setCovered] = useState(true);
  const [reason, setReason] = useState<'start' | 'left'>('start');
  const [busy, setBusy] = useState(false);
  // Camera: null until the camera is on. With face checks Off there is no camera step.
  const [camera, setCamera] = useState<{ stream: MediaStream; level: Exclude<FaceLevel, 'OFF'> } | null>(null);
  // The candidate chose to go on without a camera (only possible when the round does not require one).
  const [cameraSkipped, setCameraSkipped] = useState(false);
  const needsCamera = faceLevel !== 'OFF';
  const cameraPending = needsCamera && !camera && !cameraSkipped;

  const queue = useRef<QueuedEvent[]>([]);
  const chain = useRef<Promise<void>>(Promise.resolve());
  const stopped = useRef(false); // the server said the round is over; stop sending
  const disposed = useRef(false);
  const wasFullscreen = useRef(false); // true only after full-screen was actually entered on this page
  const suspendedUntil = useRef(0); // confirm boxes: events before this time are ignored
  const away = useRef<{ since: number; source: 'hidden' | 'blur'; ignored: boolean } | null>(null);

  const url = `/api/candidate/rounds/${roundType}/proctor`;
  const isSuspended = () => Date.now() < suspendedUntil.current;

  const flush = useCallback(
    (keepalive = false): Promise<void> => {
      const run = async () => {
        while (!stopped.current && queue.current.length > 0) {
          const batch = queue.current.slice(0, MAX_EVENTS_PER_REQUEST);
          const sentAt = Date.now();
          let status = 0;
          let reply: ServerReply | null = null;
          try {
            const res = await fetch(url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ events: batch.map((e) => toWire(e, sentAt)) }),
              credentials: 'same-origin',
              keepalive,
            });
            status = res.status;
            if (res.ok) reply = (await res.json().catch(() => null)) as ServerReply | null;
          } catch {
            status = 0; // offline: keep the events and try again on the next tick
          }
          if (status >= 200 && status < 300) {
            queue.current.splice(0, batch.length);
            if (reply?.tabSwitches && reply.tabSwitches.max > 0) {
              setUsed(reply.tabSwitches.used);
              if (reply.tabSwitches.message) setWarning(reply.tabSwitches.message);
            }
            if (reply?.ended) {
              // The server has submitted the round. Nothing more can be sent, and the exam must not stay usable.
              stopped.current = true;
              queue.current = [];
              setEnded(true);
              return;
            }
          } else if (status === 0 || status === 429 || status >= 500) {
            return;
          } else {
            // 4xx: retrying cannot help. 409/404/401/403 mean the round is over or the session ended.
            if ([401, 403, 404, 409].includes(status)) {
              stopped.current = true;
              queue.current = [];
              return;
            }
            queue.current.splice(0, batch.length);
          }
        }
      };
      chain.current = chain.current.then(run, run);
      return chain.current;
    },
    [url],
  );

  const push = useCallback((event: QueuedEvent) => {
    if (stopped.current || disposed.current) return;
    queue.current.push(event);
    if (queue.current.length > MAX_QUEUE) queue.current.splice(0, queue.current.length - MAX_QUEUE);
  }, []);

  /** Records "continued without a camera" for the admin and lets the exam open. Never called when the round requires a camera. */
  const skipCamera = useCallback(
    (reason: CameraSkipReason) => {
      if (cameraRequired) return;
      setCameraSkipped(true);
      push({ type: 'CAMERA_UNAVAILABLE', at: Date.now(), reason });
      void flush();
      try {
        sessionStorage.setItem(`${cameraSkipKey(roundType)}:sent`, '1');
      } catch {
        /* a refresh may record it twice; harmless */
      }
    },
    [cameraRequired, flush, push, roundType],
  );

  // A choice made on the round intro carries over, so the candidate is not asked twice.
  useEffect(() => {
    if (cameraRequired) return;
    try {
      const reason = parseSkipReason(sessionStorage.getItem(cameraSkipKey(roundType)));
      if (!reason) return;
      if (sessionStorage.getItem(`${cameraSkipKey(roundType)}:sent`) === '1') {
        setCameraSkipped(true);
        return;
      }
      skipCamera(reason);
    } catch {
      /* storage blocked: the camera step is shown as usual */
    }
  }, [cameraRequired, roundType, skipCamera]);

  /** Records a blocked paste or drop and tells the candidate. Records at most one per 1.5 s so holding Ctrl+V cannot flood the log. */
  const reportBlocked = useCallback(
    (target: 'answer' | 'editor' | 'other', chars = 0, via: 'paste' | 'drop' = 'paste') => {
      setPasteNotice(true);
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
      noticeTimer.current = setTimeout(() => setPasteNotice(false), 4000);
      const now = Date.now();
      if (now - lastBlockedAt.current < 1500) return;
      lastBlockedAt.current = now;
      push({ type: 'PASTE', at: now, chars, target, blocked: true, via });
      void flush();
    },
    [flush, push],
  );

  useEffect(() => () => { if (noticeTimer.current) clearTimeout(noticeTimer.current); }, []);

  useEffect(() => {
    disposed.current = false;
    stopped.current = false;

    // A refresh lands here with full-screen already lost: the notice shows again, and no exit event is added.
    if (document.fullscreenElement) {
      wasFullscreen.current = true;
      setCovered(false);
    }

    const beginAway = (source: 'hidden' | 'blur') => {
      if (away.current) {
        if (source === 'hidden') away.current.source = 'hidden';
        return;
      }
      away.current = { since: Date.now(), source, ignored: isSuspended() };
    };

    const endAway = () => {
      const a = away.current;
      if (!a) return;
      if (document.visibilityState !== 'visible' || !document.hasFocus()) return; // not really back yet
      away.current = null;
      if (a.ignored || isSuspended()) return;
      const awayMs = Date.now() - a.since;
      // A hidden tab always counts. Merely losing focus counts after BLUR_MIN_AWAY_MS.
      if (a.source === 'hidden' || awayMs >= BLUR_MIN_AWAY_MS) {
        push({ type: 'TAB_SWITCH', at: a.since, awayMs, source: a.source });
        setAwayNotice({ awayMs, source: a.source });
        void flush();
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        beginAway('hidden');
        void flush();
      } else {
        endAway();
      }
    };
    const onBlur = () => beginAway('blur');
    const onFocus = () => endAway();

    const targetOf = (node: EventTarget | null): 'answer' | 'editor' | 'other' => {
      const el = node instanceof Element ? node : null;
      return el?.closest('.monaco-editor')
        ? 'editor'
        : el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement || (el instanceof HTMLElement && el.isContentEditable)
          ? 'answer'
          : 'other';
    };

    const onPaste = (e: ClipboardEvent) => {
      if (isSuspended()) return;
      // Only the length is measured. The pasted text is never kept, sent or stored.
      const chars = e.clipboardData?.getData('text/plain')?.length ?? 0;
      const hasFiles = (e.clipboardData?.files?.length ?? 0) > 0;
      if (chars === 0 && !hasFiles) return;
      if (blockPaste) {
        // Stops the paste before the answer box or the editor sees it.
        e.preventDefault();
        e.stopImmediatePropagation();
        reportBlocked(targetOf(e.target), chars, 'paste');
        return;
      }
      push({ type: 'PASTE', at: Date.now(), chars, target: targetOf(e.target) });
    };

    // Dropping text or a file into an answer is the other way to get outside text in, so it is blocked with pasting.
    const onDragOver = (e: DragEvent) => {
      e.preventDefault(); // without this the browser may open a dropped file and leave the exam
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'none';
    };
    const onDrop = (e: DragEvent) => {
      if (isSuspended()) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      reportBlocked(targetOf(e.target), e.dataTransfer?.getData('text/plain')?.length ?? 0, 'drop');
    };
    // Backstop for routes that skip the paste event (some input methods, "paste" from a browser menu).
    const onBeforeInput = (e: InputEvent) => {
      if (isSuspended()) return;
      if (['insertFromPaste', 'insertFromPasteAsQuotation', 'insertFromDrop', 'insertFromYank'].includes(e.inputType) && e.cancelable) {
        e.preventDefault();
        reportBlocked(targetOf(e.target), 0, e.inputType === 'insertFromDrop' ? 'drop' : 'paste');
      }
    };

    const onFullscreenChange = () => {
      if (disposed.current) return;
      if (document.fullscreenElement) {
        wasFullscreen.current = true;
        setCovered(false);
        return;
      }
      if (!wasFullscreen.current) return;
      wasFullscreen.current = false;
      // A confirm box can drop some browsers out of full-screen; that is not recorded, but the notice still returns.
      if (!isSuspended()) {
        push({ type: 'FULLSCREEN_EXIT', at: Date.now() });
        void flush();
      }
      setReason('left');
      setCovered(true);
    };

    const onPageHide = () => void flush(true);

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);
    document.addEventListener('paste', onPaste, true); // capture, so it is seen even if the editor handles the paste itself
    if (blockPaste) {
      document.addEventListener('dragover', onDragOver, true);
      document.addEventListener('drop', onDrop, true);
      document.addEventListener('beforeinput', onBeforeInput, true);
    }
    document.addEventListener('fullscreenchange', onFullscreenChange);
    window.addEventListener('pagehide', onPageHide);
    const timer = setInterval(() => void flush(), SEND_EVERY_MS);

    return () => {
      disposed.current = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('paste', onPaste, true);
      document.removeEventListener('dragover', onDragOver, true);
      document.removeEventListener('drop', onDrop, true);
      document.removeEventListener('beforeinput', onBeforeInput, true);
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      window.removeEventListener('pagehide', onPageHide);
      // Leaving the round (submit, time up) gives the candidate their normal window back, with no event and no more calls.
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    };
  }, [flush, push, blockPaste, reportBlocked]);

  const api = useMemo<ProctorApi>(
    () => ({
      confirm: (message) => {
        suspendedUntil.current = Number.POSITIVE_INFINITY;
        try {
          return window.confirm(message);
        } finally {
          suspendedUntil.current = Date.now() + CONFIRM_TAIL_MS;
        }
      },
      // Bounded, so a slow or offline server can never hold up a submit.
      flush: () => Promise.race([flush(), new Promise<void>((resolve) => setTimeout(resolve, FLUSH_WAIT_MS))]),
      blockPaste,
      reportBlockedPaste: (target) => reportBlocked(target, 0, 'paste'),
    }),
    [flush, blockPaste, reportBlocked],
  );

  async function enterFullscreen() {
    setBusy(true);
    try {
      if (!document.documentElement.requestFullscreen) throw new Error('Full-screen is not supported');
      await document.documentElement.requestFullscreen();
      wasFullscreen.current = true;
      setAwayNotice(null);
      setCovered(false);
    } catch {
      // The browser refused. The candidate may continue; this is recorded once and shown to the admin.
      push({ type: 'FULLSCREEN_EXIT', at: Date.now(), refused: true });
      void flush();
      setCovered(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <ProctorContext.Provider value={api}>
      {/* The exam stays mounted behind the notice, so its timer keeps running. */}
      <div inert={covered || ended || awayNotice !== null} aria-hidden={covered || ended || awayNotice !== null || undefined}>
        {children}
      </div>

      {(maxTabSwitches > 0 || pasteNotice) && !ended && (
        <div className="pointer-events-none fixed right-4 top-4 z-[90] flex max-w-sm flex-col items-end gap-2">
          {pasteNotice && (
            <div role="status" className="pointer-events-auto rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 shadow-md">
              Pasting is turned off in this round. Please type your answer. This attempt was recorded.
            </div>
          )}
          {maxTabSwitches > 0 && <span
            className={`pointer-events-auto rounded-full border px-3 py-1 text-xs font-medium shadow-sm ${
              used >= maxTabSwitches - 1 && used > 0 ? 'border-red-300 bg-red-50 text-red-800' : 'border-border bg-background text-muted-foreground'
            }`}
            aria-live="polite"
          >
            Tab switches: {used} of {maxTabSwitches}
          </span>}
          {warning && !awayNotice && (
            <div role="alert" className="pointer-events-auto flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 shadow-md">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <p className="flex-1">{warning}</p>
              <button type="button" onClick={() => setWarning(null)} aria-label="Dismiss warning" className="shrink-0 rounded p-0.5 hover:bg-amber-100">
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>
          )}
        </div>
      )}

      {ended && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center overflow-y-auto bg-background p-6" role="alertdialog" aria-modal="true" aria-labelledby="proctor-ended-title">
          <Card className="w-full max-w-lg">
            <CardHeader>
              <CardTitle id="proctor-ended-title">Your round was submitted</CardTitle>
              <CardDescription>You switched away from the exam {maxTabSwitches} times, which is the limit for this round.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <p className="text-muted-foreground">Everything you answered before this point was saved and will be marked as usual. The hiring team can see what happened.</p>
              <Button
                className="w-full"
                onClick={() => {
                  if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
                  window.location.assign(`/round/${roundType}`);
                }}
              >
                Continue
              </Button>
            </CardContent>
          </Card>
        </div>
      )}
      {awayNotice && !covered && !ended && (
        <div className="fixed inset-0 z-[95] flex items-center justify-center overflow-y-auto bg-black/50 p-6" role="alertdialog" aria-modal="true" aria-labelledby="proctor-away-title" aria-describedby="proctor-away-desc">
          <Card className="w-full max-w-md border-amber-300">
            <CardHeader>
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-amber-600" aria-hidden />
                <CardTitle id="proctor-away-title">You left the exam window</CardTitle>
              </div>
              <CardDescription id="proctor-away-desc">
                You were away from this exam for {formatAway(awayNotice.awayMs)}. This was recorded and the hiring team can see it.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              {maxTabSwitches > 0 && (
                <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-900">
                  Tab switches used: <strong>{used} of {maxTabSwitches}</strong>. After {maxTabSwitches} your round is submitted automatically.
                  {warning && <span className="mt-1 block">{warning}</span>}
                </p>
              )}
              <p className="text-muted-foreground">Please stay on this page until you submit. Your timer is still running.</p>
              <Button autoFocus className="w-full" onClick={() => { setAwayNotice(null); setWarning(null); }}>
                I understand, continue
              </Button>
            </CardContent>
          </Card>
        </div>
      )}
      {camera && !ended && <FaceMonitor roundType={roundType} level={camera.level} stream={camera.stream} />}
      {cameraPending && (
        <div className="fixed inset-0 z-[105] flex items-center justify-center overflow-y-auto bg-background p-6" role="dialog" aria-modal="true">
          <FaceSetup
            level={faceLevel === 'IDENTITY' ? 'IDENTITY' : 'PRESENCE'}
            mode="live"
            optional={!cameraRequired}
            onSkip={skipCamera}
            onReady={({ stream, level }) => {
              if (stream) setCamera({ stream, level });
            }}
          />
        </div>
      )}
      {covered && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-background p-6" role="dialog" aria-modal="true" aria-labelledby="proctor-title">
          <Card className="w-full max-w-lg">
            <CardHeader>
              <CardTitle id="proctor-title">{reason === 'left' ? 'Please return to full-screen' : 'This round is proctored'}</CardTitle>
              <CardDescription>
                {reason === 'left'
                  ? 'You left full-screen. This was recorded and the hiring team can see it. Return to full-screen to continue. Your timer is still running.'
                  : 'Your timer is already running. Enter full-screen to see the questions.'}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              {awayNotice && (
                <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-900">You also switched away from this window for {formatAway(awayNotice.awayMs)}. This was recorded.</p>
              )}
              <div>
                <p className="font-medium">While this round is open, the hiring team can see:</p>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
                  <li>When you switch to another tab or window, and for how long.</li>
                  {blockPaste ? (
                    <li>When you try to paste or drop text into an answer. Pasting is turned off in this round, so nothing is added.</li>
                  ) : (
                    <li>When you paste, and how many characters. The pasted text itself is not read or stored.</li>
                  )}
                  <li>When you leave full-screen.</li>
                  {needsCamera && <li>How many faces your camera sees and whether your head is turned away{faceLevel === 'IDENTITY' ? ', and whether the face matches the one you registered' : ''}. Your video is not recorded.</li>}
                </ul>
              </div>
              {maxTabSwitches > 0 ? (
                <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-900">
                  You get a warning each time you leave this tab or window. After {maxTabSwitches} switches your round is submitted automatically, and whatever you have answered by then is marked.
                  {used > 0 && ` You have already used ${used} of ${maxTabSwitches}.`}
                </p>
              ) : (
                <p className="text-muted-foreground">Nothing is blocked and nothing fails automatically. These events are context for the person reviewing your answers.</p>
              )}
              <Button onClick={() => void enterFullscreen()} disabled={busy} className="w-full">
                <Maximize className="h-4 w-4" aria-hidden />
                {reason === 'left' ? 'Return to full-screen' : 'Enter full-screen and continue'}
              </Button>
            </CardContent>
          </Card>
        </div>
      )}
    </ProctorContext.Provider>
  );
}
