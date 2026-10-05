'use client';
// Camera side of face checks.
//  - <FaceSetup>   consent, camera permission and (for identity rounds) face registration. Used before a round starts
//                  ("preflight", so setup time never eats the exam timer) and again, quickly, when the exam opens ("live").
//  - <FaceMonitor> during the round: a small self-view and a reading every few seconds. Video is never recorded or sent;
//                  only a face count, a head-turn flag and (identity rounds) a numeric descriptor leave the browser.
//                  A photo is sent only when the server asks for one (several faces, or a mismatch).
import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, CameraOff, Loader2, ShieldCheck } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { apiFetch } from '@/lib/api-client';
import {
  BACKOFF_MS,
  DETECT_EVERY_MS,
  ENROLL_MESSAGES,
  ENROLL_SAMPLES,
  ENROLL_SAMPLE_GAP_MS,
  enrollmentVerdict,
  isFinalStatus,
  type FaceReading,
} from '@/lib/face-client-core';
import {
  CAMERA_ERROR_TEXT,
  cameraErrorKind,
  frameToJpeg,
  loadFaceApi,
  openCamera,
  readFrame,
  stopStream,
  videoReady,
  type CameraErrorKind,
} from '@/lib/face-client';

export type FaceLevel = 'OFF' | 'PRESENCE' | 'IDENTITY';

interface FaceStatus {
  configured: boolean;
  consented: boolean;
  enrolled: boolean;
  retentionDays: number;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

type Phase = 'checking' | 'consent' | 'starting' | 'enroll' | 'ready' | 'error';

/**
 * `mode="preflight"`: does the one-time steps, shows the result, then stops the camera and calls onReady(null).
 * `mode="live"`: starts the camera as soon as consent and registration are on file and calls onReady(stream).
 * `level` is the round's level; if identity checks cannot run on this server the candidate continues with presence only.
 */
export function FaceSetup({
  level,
  mode,
  onReady,
}: {
  level: Exclude<FaceLevel, 'OFF'>;
  mode: 'preflight' | 'live';
  onReady: (result: { stream: MediaStream | null; level: Exclude<FaceLevel, 'OFF'> }) => void;
}) {
  const [phase, setPhase] = useState<Phase>('checking');
  const [status, setStatus] = useState<FaceStatus | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [errorKind, setErrorKind] = useState<CameraErrorKind | null>(null);
  const [progress, setProgress] = useState(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const handedOver = useRef(false);
  // The parent passes a new function every render; keep the latest one without restarting the camera.
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  // Identity needs a key on the server to store the registered face. Without it the round still runs with presence checks.
  const effective: Exclude<FaceLevel, 'OFF'> = level === 'IDENTITY' && status && !status.configured ? 'PRESENCE' : level;

  const release = useCallback(() => {
    if (!handedOver.current) stopStream(streamRef.current);
    streamRef.current = null;
  }, []);

  useEffect(() => () => release(), [release]);

  const finish = useCallback(
    (lvl: Exclude<FaceLevel, 'OFF'>) => {
      setPhase('ready');
      if (mode === 'preflight') {
        stopStream(streamRef.current);
        streamRef.current = null;
        onReadyRef.current({ stream: null, level: lvl });
      } else {
        handedOver.current = true;
        onReadyRef.current({ stream: streamRef.current, level: lvl });
      }
    },
    [mode],
  );

  const startCamera = useCallback(
    async (st: FaceStatus) => {
      setPhase('starting');
      setMessage(null);
      setErrorKind(null);
      const lvl: Exclude<FaceLevel, 'OFF'> = level === 'IDENTITY' && !st.configured ? 'PRESENCE' : level;
      try {
        stopStream(streamRef.current);
        const stream = await openCamera();
        streamRef.current = stream;
        // Models load while the candidate reads the screen; a failure here is reported like a camera failure.
        await loadFaceApi(lvl === 'IDENTITY');
        if (lvl === 'IDENTITY' && !st.enrolled) {
          setPhase('enroll');
        } else {
          finish(lvl);
        }
      } catch (e) {
        stopStream(streamRef.current);
        streamRef.current = null;
        const kind = cameraErrorKind(e);
        setErrorKind(kind);
        setMessage(kind === 'other' && e instanceof Error && /model|fetch|load/i.test(e.message) ? 'The face-check files could not be loaded. Check your internet connection and try again.' : CAMERA_ERROR_TEXT[kind]);
        setPhase('error');
      }
    },
    [finish, level],
  );

  // First look at what is already agreed and registered.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const st = await apiFetch<FaceStatus>('/api/candidate/face/status');
        if (!alive) return;
        setStatus(st);
        if (st.consented) void startCamera(st);
        else setPhase('consent');
      } catch (e) {
        if (!alive) return;
        setMessage(e instanceof Error ? e.message : 'Could not check your camera settings.');
        setPhase('error');
      }
    })();
    return () => {
      alive = false;
    };
  }, [startCamera]);

  // Show the camera in the preview while registering.
  useEffect(() => {
    const video = videoRef.current;
    if (video && streamRef.current && (phase === 'enroll' || phase === 'starting')) {
      video.srcObject = streamRef.current;
      void video.play().catch(() => undefined);
    }
  }, [phase]);

  async function agree() {
    if (!status) return;
    setBusy(true);
    setMessage(null);
    try {
      await apiFetch('/api/candidate/face/consent', { method: 'POST' });
      const next = { ...status, consented: true };
      setStatus(next);
      await startCamera(next);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Could not save your agreement.');
    } finally {
      setBusy(false);
    }
  }

  async function register() {
    const video = videoRef.current;
    if (!video || !status) return;
    setBusy(true);
    setMessage(null);
    setProgress(0);
    try {
      const samples: number[][] = [];
      for (let attempt = 0; attempt < ENROLL_SAMPLES * 3 && samples.length < ENROLL_SAMPLES; attempt++) {
        if (!videoReady(video)) {
          await sleep(300);
          continue;
        }
        const { reading } = await readFrame(video, true);
        if (reading.faces === 1 && reading.embedding) {
          samples.push(reading.embedding);
          setProgress(samples.length);
        }
        await sleep(ENROLL_SAMPLE_GAP_MS);
      }
      const verdict = enrollmentVerdict(samples);
      if (!verdict.ok) {
        setMessage(ENROLL_MESSAGES[verdict.reason]);
        return;
      }
      await apiFetch('/api/candidate/face/enroll', { method: 'POST', json: { embedding: verdict.descriptor } });
      finish('IDENTITY');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Registration failed. Please try again.');
    } finally {
      setBusy(false);
      setProgress(0);
    }
  }

  if (phase === 'ready' && mode === 'preflight') {
    return (
      <Alert tone="success">
        <span className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4" aria-hidden />
          Camera check complete{effective === 'IDENTITY' ? ' and your face is registered' : ''}. The camera turns on again when the round opens.
        </span>
      </Alert>
    );
  }

  return (
    <Card className="w-full max-w-lg">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Camera className="h-5 w-5" aria-hidden />
          <CardTitle>Camera check</CardTitle>
        </div>
        <CardDescription>
          {phase === 'consent' && 'This round uses your camera to confirm that you are the person taking it.'}
          {phase === 'checking' && 'Checking your camera settings…'}
          {phase === 'starting' && 'Starting the camera and loading the face check…'}
          {phase === 'enroll' && 'Register your face once. Sit alone, face the camera, in good light.'}
          {phase === 'ready' && 'Camera is on.'}
          {phase === 'error' && 'The camera check could not finish.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {message && <Alert tone="error">{message}</Alert>}

        {phase === 'consent' && (
          <>
            <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
              <li>Your video is never recorded and never leaves your computer.</li>
              <li>Every few seconds your browser checks how many faces it sees and whether your head is turned away, and sends only that.</li>
              {level === 'IDENTITY' && <li>You register your face once. Your browser sends a set of numbers (not a photo) that is stored encrypted and compared during the round.</li>}
              <li>A single photo is kept only if several faces are seen{level === 'IDENTITY' ? ' or the face does not match your registration' : ''}. Photos and registered faces are deleted after {status?.retentionDays ?? 30} days.</li>
              <li>The hiring team sees these signals as context. They never change your score by themselves.</li>
            </ul>
            <label className="flex items-start gap-2">
              <input type="checkbox" className="mt-1" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
              <span>I understand and agree to these camera checks for this interview.</span>
            </label>
            <Button className="w-full" disabled={!agreed || busy} onClick={() => void agree()}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Camera className="h-4 w-4" aria-hidden />}
              Agree and turn on camera
            </Button>
          </>
        )}

        {(phase === 'checking' || phase === 'starting') && (
          <p className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Please wait…
          </p>
        )}

        {(phase === 'starting' || phase === 'enroll') && (
          <video ref={videoRef} muted playsInline className="aspect-[4/3] w-full -scale-x-100 rounded-md bg-black object-cover" aria-label="Your camera preview" />
        )}

        {phase === 'enroll' && (
          <>
            <Button className="w-full" disabled={busy} onClick={() => void register()}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <ShieldCheck className="h-4 w-4" aria-hidden />}
              {busy ? `Reading your face… ${progress} of ${ENROLL_SAMPLES}` : 'Register my face'}
            </Button>
            <p className="text-xs text-muted-foreground">Look straight at the camera and keep still for a few seconds.</p>
          </>
        )}

        {phase === 'error' && (
          <Button
            className="w-full"
            onClick={() => (status ? void startCamera(status) : window.location.reload())}
            variant={errorKind === 'denied' ? 'default' : 'outline'}
          >
            Try again
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Runs while the exam is open. Never blocks the exam: a lost camera shows a banner and is reported as "no face".
 * Stops for good when the server says the round is over or consent is missing.
 */
export function FaceMonitor({ roundType, level, stream: initial }: { roundType: string; level: Exclude<FaceLevel, 'OFF'>; stream: MediaStream }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream>(initial);
  const [lost, setLost] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const lostRef = useRef(false);
  const stopped = useRef(false);

  const attach = useCallback((stream: MediaStream) => {
    streamRef.current = stream;
    const video = videoRef.current;
    if (video) {
      video.srcObject = stream;
      void video.play().catch(() => undefined);
    }
    const track = stream.getVideoTracks()[0];
    const onEnded = () => {
      lostRef.current = true;
      setLost(true);
    };
    track?.addEventListener('ended', onEnded);
    lostRef.current = !track || track.readyState === 'ended';
    setLost(lostRef.current);
  }, []);

  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    attach(initial);
    return () => {
      mounted.current = false;
      // Deferred so React's dev-mode mount/unmount/mount does not switch the camera off.
      setTimeout(() => {
        if (!mounted.current) stopStream(streamRef.current);
      }, 0);
    };
  }, [attach, initial]);

  useEffect(() => {
    stopped.current = false;
    const base = `/api/candidate/rounds/${roundType}/face`;

    async function post(path: string, init: RequestInit): Promise<{ status: number; body: unknown }> {
      try {
        const res = await fetch(path, { ...init, credentials: 'same-origin' });
        return { status: res.status, body: res.ok ? await res.json().catch(() => null) : null };
      } catch {
        return { status: 0, body: null };
      }
    }

    async function tick(): Promise<number> {
      const video = videoRef.current;
      // A hidden tab gets no camera frames; the tab switch itself is already recorded, so no reading is sent.
      if (document.visibilityState === 'hidden') return DETECT_EVERY_MS;

      let reading: FaceReading = { faces: 0, msAgo: 0 };
      let canvas: HTMLCanvasElement | null = null;
      if (!lostRef.current && videoReady(video)) {
        try {
          const frame = await readFrame(video, level === 'IDENTITY');
          reading = frame.reading;
          canvas = frame.canvas;
        } catch {
          return DETECT_EVERY_MS; // the detector hiccupped; try again next time rather than report "no face"
        }
      } else if (!lostRef.current) {
        return DETECT_EVERY_MS; // video not ready yet
      }

      const res = await post(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(reading) });
      if (res.status === 429) return BACKOFF_MS;
      if (isFinalStatus(res.status)) {
        stopped.current = true;
        if (res.status === 403) setNotice('Camera checks need your agreement. Please contact the hiring team if this message stays.');
        return DETECT_EVERY_MS;
      }
      const ids = (res.body as { snapshotEventIds?: string[] } | null)?.snapshotEventIds ?? [];
      if (ids.length > 0 && canvas) {
        const jpeg = await frameToJpeg(canvas);
        if (jpeg) {
          for (const id of ids) {
            await post(`${base}/snapshot?eventId=${encodeURIComponent(id)}`, { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: jpeg });
          }
        }
      }
      return DETECT_EVERY_MS;
    }

    let timer: ReturnType<typeof setTimeout> | null = null;
    const loop = async () => {
      if (stopped.current) return;
      const wait = await tick().catch(() => DETECT_EVERY_MS);
      if (!stopped.current) timer = setTimeout(() => void loop(), wait);
    };
    timer = setTimeout(() => void loop(), 1500);
    return () => {
      stopped.current = true;
      if (timer) clearTimeout(timer);
    };
  }, [roundType, level]);

  async function reconnect() {
    setReconnecting(true);
    try {
      stopStream(streamRef.current);
      attach(await openCamera());
    } catch {
      /* the banner stays; the candidate can try again */
    } finally {
      setReconnecting(false);
    }
  }

  return (
    <>
      <div className="pointer-events-none fixed bottom-4 left-4 z-[80] overflow-hidden rounded-md border bg-black shadow-md" aria-hidden={lost}>
        <video ref={videoRef} muted playsInline className="h-24 w-32 -scale-x-100 object-cover" aria-label="Your camera" />
        <span className="absolute left-1 top-1 flex items-center gap-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">
          <span className={`h-1.5 w-1.5 rounded-full ${lost ? 'bg-red-500' : 'bg-green-500'}`} /> {lost ? 'Camera off' : 'Camera on'}
        </span>
      </div>
      {(lost || notice) && (
        <div role="alert" className="fixed bottom-4 left-40 z-[85] flex max-w-sm items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 shadow-md">
          <CameraOff className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <div className="space-y-2">
            <p>{notice ?? 'Your camera stopped. Reconnect it to keep going. The hiring team can see that it was off.'}</p>
            {lost && (
              <Button size="sm" variant="outline" disabled={reconnecting} onClick={() => void reconnect()}>
                {reconnecting ? 'Reconnecting…' : 'Reconnect camera'}
              </Button>
            )}
          </div>
        </div>
      )}
    </>
  );
}
