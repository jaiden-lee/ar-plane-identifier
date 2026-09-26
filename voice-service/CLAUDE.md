# voice-service — Allison's workstream notes

Read the root `CLAUDE.md` first for contracts and ownership rules. This file holds
voice-specific decisions, status, and gotchas. Allison's agent owns `voice-service/`
and `web/src/voice/` only; do not edit other paths.

## Status (updated 2026-09-25)

| Priority | Item | State |
|---|---|---|
| 1 | `POST /api/voice/ask` with plane context, curl-testable | ✅ Done, verified live |
| 2 | Browser module `web/src/voice/` (wake phrase, STT, TTS) | 🟡 Built + tested with fake mic; needs a real-phone test |
| 3 | Head-tilt fallback trigger | 🟡 `voice.listen()` hook exists; tilt detection not wired |
| 4 | Prompt tuning for short, fun, accurate spoken answers | 🟡 Flight phase + helicopters fixed; tune tone on the phone |
| 5 | Grok "Leo" voice for answers (stretch) | 🟡 Built + tested via curl/Node; needs a phone test |

## Decisions

- **LLM is Gemini, not Grok.** Root `CLAUDE.md` says Grok/xAI; nobody on the team has an
  xAI account and a Claude Max plan does not include API access. Gemini's free tier works
  with no billing. Free tier caveat: Google may use prompts to improve products (fine for
  public flight data).
- **Model: `gemini-3.5-flash-lite`.** Benchmarked 2026-09-25: ~0.6 s per answer, no errors.
  `gemini-3.8-flash` is smarter but 3–5 s per answer with intermittent 503 "high demand"
  errors on the free tier. Spoken latency matters more than smarts here.
- **Provider is swappable via env, no code change.** The service calls the LLM through the
  OpenAI-compatible chat endpoint. `.env.example` documents xAI, OpenRouter, and Gemini.
  Env vars are still named `XAI_*` (historical; renaming is cosmetic).
- **Persona is still "Grok"** in the system prompt because the wake phrase is "hey grok".
- **Never 500.** If no key is set, or the LLM errors or times out (8 s, one retry), the
  service returns a canned sentence built from the plane data. The demo must survive a
  flaky free-tier API.
- **`planeId` shortcut** on the request resolves an id/callsign from
  `shared/fixtures/demo-planes.json`. Additive only, for curl testing; the web app sends
  the full `plane` object per the contract.

## How it works (`main.py`)

1. `AskRequest` mirrors the contract: `question`, `plane`, `nearbyPlanes`, plus `planeId`.
   All plane fields are optional on our side so a partial plane never 422s.
2. `describe_plane()` renders the plane into a labeled text block; nearby planes get one
   line each (max 8). Missing fields render as "unknown" so the model doesn't invent them.
3. `SYSTEM_PROMPT` asks for 1–3 spoken sentences, no markdown, airport codes spoken as
   city names, general aviation knowledge allowed for questions the data can't answer.
4. `ask_grok()` calls the model with `max_tokens=512` (thinking models count reasoning
   tokens against this; 200 truncated an answer to "I don'"). Markdown characters are
   stripped from the reply as a safety net before TTS.
5. `GET /api/voice/health` reports the model and whether a key is loaded.

Run and curl instructions are in `README.md`. The key lives in `.env` (gitignored).

## Grok voice (added 2026-09-26)

- `POST /api/voice/speak` `{text}` → `audio/mpeg` from xAI TTS (`https://api.x.ai/v1/tts`,
  `voice_id` = `XAI_TTS_VOICE`, default **leo**; `optimize_streaming_latency: 2`). Non-200 on
  any failure so the browser falls back to `speechSynthesis`. $15 / 1M chars.
- Browser: `tts.ts` `speakRemote()` fetches the MP3 and plays it through one `<audio>` element
  created in `unlockSpeech()` during the Start tap. `index.ts` tries remote, then browser.
- Measured: 1.3–2.0 s per sentence from the service. Total ask → first sound is ~2.5–3 s.
  If that feels slow on stage, the xAI WebSocket TTS streams audio as it's generated.
- **Not yet tested on the Pixel** (audio unlock + playback need the real gesture path).

## Known gaps / TODO

- Free-tier tail latency (Gemini): one request in five stalled to ~9 s (timeout + retry).
  Not seen on Grok. If it shows up in the demo, drop the timeout to ~5 s.
- Head-tilt trigger: `voice.listen()` exists; roll detection is not wired to it.
- Grok with `XAI_REASONING_EFFORT=none` is terse. If answers feel thin on stage, ask the
  prompt for one extra detail (type or altitude) or try `low`.

## Fixed 2026-09-26

- Plane model now carries the full contract: `offsetDeg`, `category`, `kind`, `onGround`,
  `emergency`, `military`, `medical`. `describe_plane()` renders kind, ground state, flags,
  and position in view. A medical helicopter with no type is now "a medical helicopter".
- Prompt knows the user is at Georgia Tech near ATL and reasons about flight phase:
  destination ATL + low altitude = landing; origin ATL = climbing; on ground = at the gate.
  Verified on six fixture cases through Grok.
- Fixture read passes `encoding="utf-8"` (team rule).
- Fallback answer handles helicopters and on-ground aircraft.

## Browser module (`web/src/voice/`)

Built 2026-09-25. See `web/src/voice/README.md` for usage and gotchas.

- `startVoice(opts)` per the root contract, plus extras: `onError`, `endpoint`, `lang`,
  `questionTimeoutMs`, `speak`, and an injectable `recognizer` for tests. Returns
  `{ stop, ask, listen, getState }` (`ask`/`listen` are additive: direct question, and
  head-tilt entry into "listening").
- State machine: idle → listening (wake heard, or `listen()`) → thinking (POST) →
  speaking (TTS; mic paused so it doesn't hear itself) → idle. "hey grok" alone opens an
  8 s window for the question.
- Wake matcher (`wake.ts`) is a pure function; 13-case check in this session all pass.
- Verified in Node with a fake recognizer against the live service: all 6 flows correct
  (one-breath, two-step, timeout, ignore, tilt, offline). **Not yet run on the Pixel.**
- Dev page: `web/src/voice/dev.html` (fake mic via text box, or real mic).
- Web app is plain TS + Vite; Vite proxies `/api/voice` → :8002. Jaiden has not mounted the
  module yet; nothing outside `web/src/voice/` was touched.
