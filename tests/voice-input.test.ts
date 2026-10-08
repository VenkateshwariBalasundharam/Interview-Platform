import { describe, expect, it } from 'vitest';
import { describeSpeechError, getSpeechRecognition, mergeSpeech } from '@/lib/voice-input-core';

describe('mergeSpeech', () => {
  it('adds a space between existing text and spoken text', () => {
    expect(mergeSpeech('I would use a cache', 'because reads dominate', null)).toBe('I would use a cache because reads dominate');
  });
  it('does not double the space or add a leading one', () => {
    expect(mergeSpeech('Hello ', 'world', null)).toBe('Hello world');
    expect(mergeSpeech('', '  hello   world ', null)).toBe('hello world');
    expect(mergeSpeech('Line one\n', 'line two', null)).toBe('Line one\nline two');
  });
  it('keeps the base when nothing was said', () => {
    expect(mergeSpeech('keep me', '   ', null)).toBe('keep me');
  });
  it('cuts to the character limit', () => {
    expect(mergeSpeech('abc', 'defghi', 6)).toBe('abc de');
    expect(mergeSpeech('abc', 'defghi', 6).length).toBeLessThanOrEqual(6);
  });
});

describe('getSpeechRecognition', () => {
  it('prefers the standard name, falls back to the webkit one, else null', () => {
    class A {}
    class B {}
    expect(getSpeechRecognition({ SpeechRecognition: A, webkitSpeechRecognition: B })).toBe(A);
    expect(getSpeechRecognition({ webkitSpeechRecognition: B })).toBe(B);
    expect(getSpeechRecognition({})).toBeNull();
    expect(getSpeechRecognition(undefined)).toBeNull();
  });
});

describe('describeSpeechError', () => {
  it('explains blocked and missing microphones', () => {
    expect(describeSpeechError('not-allowed')).toMatch(/blocked/i);
    expect(describeSpeechError('audio-capture')).toMatch(/no microphone/i);
  });
  it('stays quiet when the candidate stops on purpose', () => {
    expect(describeSpeechError('aborted')).toBeNull();
  });
  it('has a fallback for unknown errors', () => {
    expect(describeSpeechError('something-new')).toMatch(/stopped unexpectedly/i);
  });
});

import { MIC_HEARD_LEVEL, describeMicOpenError, micLevel } from '@/lib/voice-input-core';

describe('micLevel', () => {
  it('is 0 for silence and for no samples', () => {
    expect(micLevel(new Uint8Array(512).fill(128))).toBe(0);
    expect(micLevel([])).toBe(0);
  });
  it('rises with louder sound and never goes above 1', () => {
    const quiet = Uint8Array.from({ length: 512 }, (_, i) => 128 + (i % 2 ? 6 : -6));
    const loud = Uint8Array.from({ length: 512 }, (_, i) => 128 + (i % 2 ? 120 : -120));
    expect(micLevel(quiet)).toBeGreaterThan(0);
    expect(micLevel(loud)).toBeGreaterThan(micLevel(quiet));
    expect(micLevel(loud)).toBeLessThanOrEqual(1);
  });
  it('counts normal speech as heard and a faint hiss as not heard', () => {
    const speech = Uint8Array.from({ length: 512 }, (_, i) => 128 + (i % 2 ? 20 : -20));
    const hiss = Uint8Array.from({ length: 512 }, (_, i) => 128 + (i % 2 ? 2 : -2));
    expect(micLevel(speech)).toBeGreaterThanOrEqual(MIC_HEARD_LEVEL);
    expect(micLevel(hiss)).toBeLessThan(MIC_HEARD_LEVEL);
  });
});

describe('describeMicOpenError', () => {
  it('explains blocked, missing and busy microphones', () => {
    expect(describeMicOpenError({ name: 'NotAllowedError' })).toMatch(/blocked/i);
    expect(describeMicOpenError({ name: 'NotFoundError' })).toMatch(/no microphone/i);
    expect(describeMicOpenError({ name: 'NotReadableError' })).toMatch(/another app/i);
    expect(describeMicOpenError(new TypeError('x'))).toMatch(/cannot use the microphone/i);
    expect(describeMicOpenError(null)).toMatch(/could not be started/i);
  });
});
