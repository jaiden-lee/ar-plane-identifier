// Text-to-speech via the browser's speechSynthesis. Simplest possible thing.

export function isSpeechSynthesisSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

let preferredVoice: SpeechSynthesisVoice | null = null;

function pickVoice(lang: string): SpeechSynthesisVoice | null {
  if (preferredVoice) return preferredVoice;
  const voices = speechSynthesis.getVoices();
  if (!voices.length) return null;
  const base = lang.split('-')[0];
  preferredVoice =
    voices.find((v) => v.lang === lang && /google/i.test(v.name)) ??
    voices.find((v) => v.lang === lang) ??
    voices.find((v) => v.lang.startsWith(base)) ??
    voices[0];
  return preferredVoice;
}

/**
 * Must be called from a user gesture (the Start tap) so Android Chrome lets us
 * speak later without one. Speaks an empty utterance.
 */
export function unlockSpeech(): void {
  if (!isSpeechSynthesisSupported()) return;
  try {
    speechSynthesis.cancel();
    speechSynthesis.speak(new SpeechSynthesisUtterance(''));
    speechSynthesis.getVoices(); // triggers async voice loading on Chrome
  } catch {
    // ignore
  }
}

/** Speak `text`; resolves when done (or immediately if unsupported). */
export function speak(text: string, lang = 'en-US'): Promise<void> {
  if (!isSpeechSynthesisSupported() || !text) return Promise.resolve();
  return new Promise((resolve) => {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang;
    u.rate = 1.05;
    const v = pickVoice(lang);
    if (v) u.voice = v;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(guard);
      resolve();
    };
    u.onend = finish;
    u.onerror = finish;
    // Chrome sometimes never fires onend; don't let the state machine hang.
    const guard = window.setTimeout(finish, 1500 + text.length * 90);
    speechSynthesis.speak(u);
  });
}

export function stopSpeaking(): void {
  if (isSpeechSynthesisSupported()) speechSynthesis.cancel();
}
