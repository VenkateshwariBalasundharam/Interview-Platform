'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Mic, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { describeSpeechError, getSpeechRecognition, mergeSpeech, type SpeechRecognitionLike } from '@/lib/voice-input-core';

/**
 * "Speak your answer" button for a text answer box. The browser turns speech into text and the text is added to
 * the answer, so it is saved and graded like typed text. No audio is recorded or uploaded by this app.
 */
export function VoiceInputButton({
  value,
  maxChars,
  onChange,
  label,
}: {
  /** The answer as it is right now. */
  value: string;
  maxChars: number | null;
  /** Called with the full new answer text as words are recognised. */
  onChange: (next: string) => void;
  /** Used for the accessible name, e.g. "question 2". */
  label: string;
}) {
  const [supported, setSupported] = useState(true);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [error, setError] = useState<string | null>(null);

  const recognition = useRef<SpeechRecognitionLike | null>(null);
  const wantListening = useRef(false); // true until the candidate presses Stop (the browser may end a session by itself)
  const base = useRef(''); // the answer text before the current spoken part
  const valueRef = useRef(value);
  valueRef.current = value;

  useEffect(() => {
    setSupported(getSpeechRecognition(window) !== null);
  }, []);

  const stop = useCallback(() => {
    wantListening.current = false;
    recognition.current?.stop();
    setInterim('');
    setListening(false);
  }, []);

  // Never leave the microphone on after the question leaves the screen (submit, auto-submit, navigation).
  useEffect(() => {
    return () => {
      wantListening.current = false;
      recognition.current?.abort();
    };
  }, []);

  // Turn the microphone off when the tab is hidden, so it does not keep listening in the background.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') stop();
    };
    document.addEventListener('visibilitychange', onHide);
    return () => document.removeEventListener('visibilitychange', onHide);
  }, [stop]);

  function start() {
    const Ctor = getSpeechRecognition(window);
    if (!Ctor) return;
    setError(null);
    base.current = valueRef.current;
    const rec = new Ctor();
    rec.lang = navigator.language || 'en-US';
    rec.continuous = true;
    rec.interimResults = true;

    rec.onresult = (event) => {
      let finalText = '';
      let interimText = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const r = event.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else interimText += r[0].transcript;
      }
      if (finalText) {
        const merged = mergeSpeech(base.current, finalText, maxChars);
        base.current = merged;
        onChange(merged);
      }
      setInterim(interimText.trim());
    };
    rec.onerror = (event) => {
      const message = describeSpeechError(event.error);
      if (message) setError(message);
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed' || event.error === 'audio-capture') {
        wantListening.current = false;
      }
    };
    rec.onend = () => {
      // Browsers end a session after a pause. Carry on until the candidate presses Stop.
      if (wantListening.current) {
        base.current = valueRef.current;
        try {
          rec.start();
          return;
        } catch {
          // fall through and stop
        }
      }
      wantListening.current = false;
      setInterim('');
      setListening(false);
    };

    recognition.current = rec;
    wantListening.current = true;
    try {
      rec.start();
      setListening(true);
    } catch {
      wantListening.current = false;
      setError('Could not start the microphone. Please try again.');
    }
  }

  if (!supported) {
    return <p className="text-xs text-muted-foreground">Voice typing is not available in this browser. Use Chrome or Edge to speak your answers, or type them.</p>;
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant={listening ? 'destructive' : 'outline'}
          onClick={listening ? stop : start}
          aria-pressed={listening}
          aria-label={listening ? `Stop voice typing for ${label}` : `Start voice typing for ${label}`}
        >
          {listening ? <Square className="mr-1.5 h-3.5 w-3.5" /> : <Mic className="mr-1.5 h-3.5 w-3.5" />}
          {listening ? 'Stop' : 'Speak answer'}
        </Button>
        {listening && (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground" role="status">
            <span className="h-2 w-2 animate-pulse rounded-full bg-red-600" />
            Listening…
          </span>
        )}
      </div>
      {listening && interim && <p className="text-xs italic text-muted-foreground">{interim}</p>}
      {error && (
        <p className="text-xs text-red-700" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
