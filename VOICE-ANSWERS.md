# Voice answers (microphone) for candidates

Adds a **Speak answer** button under every written / short-answer question. The candidate speaks, the words
appear in the answer box, and they are autosaved and graded exactly like typed text.

## What changed
- `components/VoiceInputButton.tsx` (new) - the button, live "Listening..." indicator, error messages
- `lib/voice-input-core.ts` (new) - pure helpers (merge text, respect character limit, error text)
- `components/RoundExam.tsx` - button added next to the character counter
- `components/MicCheck.tsx` (new) - **Microphone check** on the round intro screen (permission prompt, live volume bar, plain-language errors)
- `components/RoundIntro.tsx` - camera and microphone checks in ONE card, two equal columns side by side (stacked on narrow screens); mic check in every round except Coding
- `app/round/[type]/page.tsx` - the round intro page is wider (max-w-5xl) so both columns fit; the exam page is unchanged
- `components/proctoring/FaceMonitor.tsx` - FaceSetup gets an `embedded` option (no border of its own) so it can share that card
- `next.config.mjs` - Permissions-Policy now allows `microphone=(self)` (it was `microphone=()`, which blocks it)
- `tests/voice-input.test.ts` (new)

No database change, no new packages, no migration.

## Install
1. Unzip over the project (same paths).
2. Stop `npm run dev`, then `Remove-Item -Recurse -Force .next`
3. `npm run dev`  (next.config.mjs is only read at startup)

## Notes
- Works in Chrome, Edge and Safari. Firefox has no speech recognition, so the button is replaced by a short notice.
- Needs HTTPS in production (localhost is fine for testing), otherwise the browser will not offer the microphone.
- The browser sends the audio to its own speech service (Google in Chrome). This app never records or stores audio.
  Mention that on your candidate instructions page if privacy matters to you.
- Dictated text is inserted by the browser's speech API, not pasted, so "Block paste" does not interfere.
- Microphone turns off when the tab is hidden, on Stop, and when the round ends.
- Not added to the coding round (code is not a good fit for dictation).

## Microphone check (round intro)
- Appears under the camera check. The candidate presses **Test microphone**, allows the browser prompt, says a few words
  and sees the bar move and "Your microphone works."
- It does not block **Start round** (typing always works). To make it mandatory, have `MicCheck` report through `onResult`
  and add the result to the `disabled` condition of the Start button in `RoundIntro.tsx`.
- Allowing the microphone here means the browser usually will not ask again when they press **Speak answer** later.
