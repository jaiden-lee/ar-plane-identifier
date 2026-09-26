# web/src/voice/ — owner: Allison

Browser-side voice module: wake phrase, speech-to-text, text-to-speech, calls `/api/voice/ask`.
Exports `startVoice(...)` per the contract in root `CLAUDE.md`.

## Use (Jaiden's app)

```ts
import { startVoice } from './voice';
import type { Plane, VoiceState } from './voice';

// Inside the Start tap handler (mic + audio need a user gesture):
const voice = startVoice({
  getCurrentPlane: () => centeredPlane,          // Plane | null
  getNearbyPlanes: () => planesInView,           // Plane[]
  onStateChange: (s: VoiceState) => hud.voiceState = s,   // idle | listening | thinking | speaking
  onTranscript: (t) => hud.lastQuestion = t,     // optional
  onAnswer: (a) => hud.lastAnswer = a,           // show for a few seconds
  onError: (m) => console.warn(m),               // optional; mic denied, service offline...
});

voice.listen();   // optional: enter "listening" without the wake phrase (head-tilt trigger)
voice.stop();     // on exit
```

The user says **"hey grok, &lt;question&gt;"** (or "hey grok", pause, question). Fuzzy matching
covers "grock", "rock", "croc", "a grok", etc. The answer is spoken with `speechSynthesis`
and passed to `onAnswer` for the HUD. While the phone is speaking, the mic is paused so it
doesn't hear itself. If the voice service is down, the module speaks a short offline line
and keeps running.

## Files

- `index.ts` — `startVoice()`: state machine, wake handling, fetch, TTS orchestration
- `wake.ts` — fuzzy "hey grok" matcher (pure function, `matchWake(text)`)
- `recognition.ts` — Chrome `SpeechRecognition` wrapper with auto-restart
- `tts.ts` — `speechSynthesis` wrapper (`unlockSpeech`, `speak`)
- `types.ts` — `Plane`, `VoiceState`, options, `Recognizer` interface
- `dev.html` / `dev.ts` — desktop test page, not part of the app

## Dev page (no phone needed)

```sh
cd web && npm run dev            # plus voice-service on :8002 for real answers
open http://localhost:5173/src/voice/dev.html
```

"Start (fake mic)" lets you type transcripts. "Start (real mic)" uses the browser's
speech recognition (desktop Chrome works for a smoke test; Android Chrome is the target).

## Gotchas

- Android Chrome only. `SpeechRecognition` is webkit-prefixed and absent on Firefox; iOS
  Safari needs extra permission handling we haven't done.
- Chrome stops continuous recognition after a few seconds of silence; the wrapper restarts
  it ~150 ms later. Expect a small gap where a wake phrase can be missed.
- Recognition needs network (Google's servers), so it fails on ngrok if the phone's data is off.
- Must be started from a user gesture. Jaiden's Start tap is that gesture.
