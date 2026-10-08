'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, Mic, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { MIC_HEARD_LEVEL, describeMicOpenError, getSpeechRecognition, micLevel } from '@/lib/voice-input-core';

type Phase = 'idle' | 'starting' | 'listening' | 'heard' | 'passed' | 'error';

/**
 * Microphone check for the round intro. The candidate allows the microphone, speaks, and sees a live level bar.
 * Nothing is recorded or sent anywhere: the sound is only measured on this computer, and the microphone is released
 * as soon as the test ends. Passing is not required to start the round (typing always works); it only makes sure
 * the Speak answer button works later.
 */
export function MicCheck({ onResult, embedded = false }: { onResult?: (heard: boolean) => void; embedded?: boolean }) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [level, setLevel] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [voiceTyping, setVoiceTyping] = useState(true);

  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const heardRef = useRef(false);
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;

  useEffect(() => {
    setVoiceTyping(getSpeechRecognition(window) !== null);
  }, []);

  const release = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    void ctxRef.current?.close().catch(() => undefined);
    ctxRef.current = null;
  }, []);

  // Never leave the microphone on if the candidate starts the round or leaves the page mid-test.
  useEffect(() => () => release(), [release]);

  const stop = useCallback(() => {
    release();
    setLevel(0);
    setPhase(heardRef.current ? 'passed' : 'idle');
    if (!heardRef.current) setMessage('We did not hear anything yet. Check that the right microphone is selected, speak, and try again.');
    onResultRef.current?.(heardRef.current);
  }, [release]);

  async function start() {
    setMessage(null);
    setPhase('starting');
    heardRef.current = false;
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new TypeError('getUserMedia is not available');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      streamRef.current = stream;
      const AudioCtx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) throw new TypeError('AudioContext is not available');
      const ctx = new AudioCtx();
      ctxRef.current = ctx;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const data = new Uint8Array(analyser.fftSize);
      setPhase('listening');

      const tick = () => {
        analyser.getByteTimeDomainData(data);
        const l = micLevel(data);
        setLevel(l);
        if (l >= MIC_HEARD_LEVEL && !heardRef.current) {
          heardRef.current = true;
          setPhase('heard');
          onResultRef.current?.(true);
        }
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch (e) {
      release();
      setMessage(describeMicOpenError(e));
      setPhase('error');
      onResultRef.current?.(false);
    }
  }

  const running = phase === 'listening' || phase === 'heard';

  const intro = 'Typed answers in this round can also be spoken. Test your microphone now so voice typing works when the timer is running.';

  const body = (
    <>
      <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
        <li>Your voice is not recorded or saved by this app. The check only measures the volume on your computer.</li>
        <li>For voice typing, your browser sends your speech to its own speech service to turn it into text. Only the text becomes your answer.</li>
        <li>The microphone is used only when you press Speak answer, and you can always type instead.</li>
      </ul>

      {!voiceTyping && <p className="text-amber-700">Voice typing is not available in this browser. Use Chrome or Edge to speak your answers, or type them as usual.</p>}

      {running && (
        <div className="space-y-1">
          <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted" role="meter" aria-label="Microphone volume" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(level * 100)}>
            <div className={`h-full rounded-full transition-[width] duration-75 ${phase === 'heard' ? 'bg-green-600' : 'bg-primary'}`} style={{ width: `${Math.round(level * 100)}%` }} />
          </div>
          <p className="text-xs text-muted-foreground">{phase === 'heard' ? 'We can hear you.' : 'Say a few words, such as "testing, one two three".'}</p>
        </div>
      )}

      {(phase === 'heard' || phase === 'passed') && (
        <p className="flex items-center gap-1.5 text-green-700" role="status">
          <CheckCircle2 className="h-4 w-4" aria-hidden />
          Your microphone works.
        </p>
      )}
      {message && (
        <p className="text-red-700" role="alert">
          {message}
        </p>
      )}

      {running ? (
        <Button type="button" className="w-full" variant="outline" onClick={stop}>
          <Square className="mr-1.5 h-3.5 w-3.5" />
          {phase === 'heard' ? 'Done' : 'Stop test'}
        </Button>
      ) : (
        <Button type="button" className="w-full" variant="outline" onClick={() => void start()} disabled={phase === 'starting'}>
          <Mic className="mr-1.5 h-4 w-4" />
          {phase === 'starting' ? 'Waiting for permission…' : phase === 'passed' || phase === 'error' ? 'Test again' : 'Test microphone'}
        </Button>
      )}
    </>
  );

  // Same header and body spacing as the camera card, so the two columns line up.
  return (
    <div className={embedded ? 'h-full' : 'rounded-lg border border-input'}>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Mic className="h-5 w-5" aria-hidden />
          <CardTitle>Microphone check</CardTitle>
        </div>
        <CardDescription>{intro}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">{body}</CardContent>
    </div>
  );
}
