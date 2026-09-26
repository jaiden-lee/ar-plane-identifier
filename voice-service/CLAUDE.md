# voice-service — Allison's workstream notes

Read the root `CLAUDE.md` first for contracts and ownership rules. This file holds
voice-specific decisions, status, and gotchas. Allison's agent owns `voice-service/`
and `web/src/voice/` only; do not edit other paths.

## Status (updated 2026-09-25)

| Priority | Item | State |
|---|---|---|
| 1 | `POST /api/voice/ask` with plane context, curl-testable | ✅ Done, verified live |
| 2 | Browser module `web/src/voice/` (wake phrase, STT, TTS) | ⬜ Not started |
| 3 | Head-tilt fallback trigger | ⬜ Not started |
| 4 | Prompt tuning for short, fun, accurate spoken answers | 🟡 First pass done |

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

## Known gaps / TODO

- Root `CLAUDE.md` still says Grok and "xAI API key lives only in voice-service". Propose
  changing it to Gemini (everyone-owned file, needs team OK).
- `Plane.offsetDeg` (new optional contract field, signed angle off-center) is accepted but
  dropped by the Pydantic model. Add it and use it for a spoken "slightly to your left".
- Fixture read in `main.py` uses default encoding; root rule says pass `encoding="utf-8"`
  (Windows teammate got bitten). Fix before Wesley's real snapshot lands.
- Prompt: the model guesses flight phase (said a plane at 4,200 ft on final into ATL was
  "cleaning up the gear"). Either teach it climb vs descend from route + altitude, or
  tell it not to speculate about flight phase.
- Free-tier tail latency: one request in five stalled to ~9 s (timeout + retry). If that
  shows up in the demo, drop the timeout to ~5 s so the fallback fires sooner.

## Browser module plan (`web/src/voice/`, not started)

- Web app is plain TypeScript + Vite, no framework. Jaiden has not referenced the module
  yet; `startVoice(opts)` per the root contract is the whole interface.
- Vite dev server already proxies `/api/voice` → `localhost:8002`.
- Continuous `SpeechRecognition` (Android Chrome), auto-restart on end, fuzzy "hey grok"
  match, POST to `/api/voice/ask`, `speechSynthesis` for the reply, state callbacks
  idle → listening → thinking → speaking.
- Must degrade gracefully: if the service is down, speak a short "voice is offline" line
  and keep the HUD working.
