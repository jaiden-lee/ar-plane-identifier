// Browser voice module (owner: Allison). See root CLAUDE.md for the contract.
//
//   const voice = startVoice({ getCurrentPlane, getNearbyPlanes, onStateChange, onAnswer });
//   ...
//   voice.stop();
//
// Call startVoice() from inside the Start tap handler: mic + speech playback
// both need a user gesture on Android Chrome.

import { matchWake } from './wake';
import { createBrowserRecognizer, isSpeechRecognitionSupported } from './recognition';
import { speak, stopSpeaking, unlockSpeech } from './tts';
import type { Plane, Recognizer, StartVoiceOptions, VoiceHandle, VoiceState } from './types';

export type { Plane, Recognizer, StartVoiceOptions, VoiceHandle, VoiceState } from './types';
export { matchWake } from './wake';
export { isSpeechRecognitionSupported } from './recognition';

const OFFLINE_ANSWER = "Sorry, I can't reach the voice service right now.";

export function startVoice(opts: StartVoiceOptions): VoiceHandle {
  const endpoint = opts.endpoint ?? '/api/voice/ask';
  const lang = opts.lang ?? 'en-US';
  const questionTimeoutMs = opts.questionTimeoutMs ?? 8000;
  const shouldSpeak = opts.speak ?? true;

  let state: VoiceState = 'idle';
  let stopped = false;
  let awaitingQuestion = false;
  let questionTimer = 0;
  let recognizer: Recognizer | null = null;

  function setState(s: VoiceState) {
    if (state === s) return;
    state = s;
    opts.onStateChange(s);
  }

  // ---- Wake phrase / question handling ------------------------------------

  function onResult(text: string, isFinal: boolean) {
    if (stopped || state === 'thinking' || state === 'speaking') return;

    const afterWake = matchWake(text);

    if (!isFinal) {
      // Early feedback: flip to "listening" as soon as the wake phrase shows up.
      if (afterWake !== null && state === 'idle') setState('listening');
      return;
    }

    if (afterWake !== null) {
      if (afterWake) {
        void ask(afterWake);
      } else {
        // "hey grok" ... (pause) ... question comes in the next result.
        armQuestionWindow();
      }
      return;
    }

    if (awaitingQuestion) {
      const q = text.trim();
      if (q) void ask(q);
    }
  }

  function armQuestionWindow() {
    awaitingQuestion = true;
    setState('listening');
    clearTimeout(questionTimer);
    questionTimer = window.setTimeout(() => {
      awaitingQuestion = false;
      if (state === 'listening') setState('idle');
    }, questionTimeoutMs);
  }

  // ---- Ask the service and speak the answer --------------------------------

  async function ask(question: string): Promise<void> {
    if (stopped) return;
    awaitingQuestion = false;
    clearTimeout(questionTimer);
    opts.onTranscript?.(question);
    setState('thinking');

    const answer = await fetchAnswer(question, opts.getCurrentPlane(), opts.getNearbyPlanes());
    if (stopped) return;
    opts.onAnswer(answer);

    if (shouldSpeak) {
      setState('speaking');
      // Don't let the mic hear the phone talking to itself.
      recognizer?.stop();
      await speak(answer, lang);
      if (stopped) return;
      recognizer?.start();
    }
    setState('idle');
  }

  async function fetchAnswer(question: string, plane: Plane | null, nearbyPlanes: Plane[]): Promise<string> {
    const ctrl = new AbortController();
    const t = window.setTimeout(() => ctrl.abort(), 15000);
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question, plane, nearbyPlanes }),
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`voice service returned ${res.status}`);
      const data = (await res.json()) as { answer?: string };
      if (!data.answer) throw new Error('empty answer');
      return data.answer;
    } catch (e) {
      opts.onError?.(`Voice service unavailable: ${(e as Error).message}`);
      return OFFLINE_ANSWER;
    } finally {
      clearTimeout(t);
    }
  }

  // ---- Start ---------------------------------------------------------------

  unlockSpeech();

  if (opts.recognizer) {
    recognizer = opts.recognizer;
  } else if (isSpeechRecognitionSupported()) {
    recognizer = createBrowserRecognizer(lang);
  } else {
    opts.onError?.('Speech recognition not supported in this browser (use Android Chrome)');
  }

  if (recognizer) {
    recognizer.onResult = onResult;
    recognizer.onError = (message, fatal) => {
      opts.onError?.(message);
      if (fatal) setState('idle');
    };
    recognizer.start();
  }

  return {
    stop() {
      stopped = true;
      clearTimeout(questionTimer);
      recognizer?.stop();
      stopSpeaking();
      setState('idle');
    },
    ask,
    listen() {
      if (!stopped && state === 'idle') armQuestionWindow();
    },
    getState: () => state,
  };
}
