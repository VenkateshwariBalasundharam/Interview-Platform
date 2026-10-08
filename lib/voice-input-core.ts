// Pure helpers for voice dictation (no browser or server imports, so they can be unit tested).

/** The slice of the browser's speech-recognition API that the dictation button uses. */
export interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}
export type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

/** Finds the browser's speech-recognition constructor (Chrome, Edge and Safari have it; Firefox does not). */
export function getSpeechRecognition(win: unknown): SpeechRecognitionCtor | null {
  const w = win as { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor } | undefined;
  return w?.SpeechRecognition ?? w?.webkitSpeechRecognition ?? null;
}

/**
 * Joins what was already in the answer box with the spoken text, adding one space between them only when needed,
 * and cuts the result to the question's character limit.
 */
export function mergeSpeech(base: string, spoken: string, maxChars: number | null): string {
  const said = spoken.replace(/\s+/g, ' ').trim();
  if (!said) return maxChars ? base.slice(0, maxChars) : base;
  const needsSpace = base.length > 0 && !/\s$/.test(base);
  const merged = base + (needsSpace ? ' ' : '') + said;
  return maxChars ? merged.slice(0, maxChars) : merged;
}

/** Plain-language text for each error the speech service can report. null means stay quiet (not an error). */
export function describeSpeechError(code: string): string | null {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'Microphone access is blocked. Allow the microphone in your browser\'s address bar, then try again.';
    case 'audio-capture':
      return 'No microphone was found. Plug one in or check your system sound settings.';
    case 'network':
      return 'Voice typing needs an internet connection and could not reach the speech service.';
    case 'language-not-supported':
      return 'This browser does not support voice typing in that language.';
    case 'no-speech':
      return 'No speech was heard. Speak closer to the microphone and try again.';
    case 'aborted':
    case 'canceled':
      return null;
    default:
      return 'Voice typing stopped unexpectedly. You can keep typing, or try the microphone again.';
  }
}

/** Plain-language text for why opening the microphone failed (getUserMedia errors). */
export function describeMicOpenError(error: unknown): string {
  const name = error && typeof error === 'object' && 'name' in error ? String((error as { name: unknown }).name) : '';
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Microphone access is blocked. Click the lock or camera icon in the address bar, allow the microphone, then press Test microphone again.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No microphone was found. Plug one in or check your system sound settings, then try again.';
    case 'NotReadableError':
    case 'AbortError':
      return 'Your microphone is being used by another app. Close it and try again.';
    case 'TypeError':
      return 'This browser cannot use the microphone on this page. Use a current Chrome or Edge, on a secure (https) address.';
    default:
      return 'The microphone could not be started. Please try again.';
  }
}

/** Loudness from 0 to 1, from the time-domain bytes an AnalyserNode gives (128 is silence). */
export function micLevel(samples: ArrayLike<number>): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = (samples[i] - 128) / 128;
    sum += v * v;
  }
  const rms = Math.sqrt(sum / samples.length);
  // Speech is usually quiet in raw RMS terms, so scale it up so a normal voice moves the bar clearly.
  return Math.min(1, rms * 4);
}

/** Heard = the level went above this at some point during the test. */
export const MIC_HEARD_LEVEL = 0.12;
