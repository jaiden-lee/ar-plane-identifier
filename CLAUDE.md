# AR Plane Identifier

Hackathon project (built Fri 2026-09-25 → Sat 2026-09-26). Team: **Jaiden, Wesley, Allison**.

**Guiding principle:** maximize demo "wow" for minimum effort. Prefer the simplest thing that works on stage over the "correct" thing. Mock data and hardcoded fallbacks are fine if they keep the demo reliable.

**How we work:** all code is written by AI agents (one per teammate), supervised by that teammate. This file is the shared source of truth. Each agent stays inside its own workstream (see [Ownership rules](#ownership-rules-for-agents)).

## The idea

Point your phone (in a Google Cardboard headset) at a plane in the sky, and see a label telling you what it is: flight number, aircraft model, origin → destination, etc.

- The phone shows a **stereo view**: two identical side-by-side camera previews, one per eye, so it works in Cardboard.
- A label is drawn identically in both halves, **positioned horizontally where the plane is** within the view (not just fixed HUD text).
- Only the **plane closest to the center of view** gets the full info card. Other in-view planes may get a small marker if it's easy.
- Flight data comes from **adsb.lol** (free ADS-B API).

**Stretch goal:** a voice agent (Grok). Say "hey Grok, ..." and ask about the plane you're looking at. Grok gets the plane's data as context and can also answer from general knowledge ("how many seats does an A321 have?").

## How "looking at a plane" works

We don't do any computer vision. We use the phone's sensors plus geometry:

1. **Inputs:** user's GPS position (lat/lon) and the compass heading the camera is pointing (degrees clockwise from north).
2. **View cone:** two rays from the user at `heading − fov/2` and `heading + fov/2`, where `fov` is the **horizontal field of view of what's shown in each eye** (so labels line up with the camera image). The browser can't report camera FOV, so it's a calibrated config constant.
3. **Nearby planes:** fetch all aircraft within a radius of the user (default ~15 mi / 25 km).
4. **Filter:** for each plane, take the bearing from the user to the plane. If it falls between the two rays, the plane is "in view".
5. **Display:** full card for the plane closest to center. Label x-position = `eyeCenterX + (angleDiff / (fov/2)) * (eyeWidth/2)`.

### 2D simplification

We flatten 3D to 2D: **altitude is ignored** for detection. We only care about horizontal direction (azimuth), not how far up you tilt the phone. Everything is a point on a flat map, and the cone is a 2D wedge.

### Math conventions (keep consistent across the team)

- Angles in **degrees**, bearings **clockwise from true north**, normalized to `[0, 360)`.
- Signed angle difference (handles 0°/360° wraparound): `diff = ((bearing − heading + 540) % 360) − 180`. In view if `abs(diff) <= fov/2`. Negative = left of center.
- Units: distance **km**, altitude **feet**, speed **knots** (aviation convention, matches ADS-B data).

### Known gotchas

- **Heading ≠ where the camera points.** In a Cardboard, the phone is landscape and the rear camera points out the back. Raw compass alpha refers to the top edge of the phone, so the camera direction must be derived from full device orientation (alpha/beta/gamma).
- **Android:** use the `deviceorientationabsolute` event (north-referenced). iOS uses `webkitCompassHeading` and needs a permission prompt. **Android is the primary target**; iOS is nice-to-have.
- **Magnetic vs true north.** Compass is magnetic; flight data is true north. Apply declination (a constant for the demo location is fine).
- **Indoor compass is unreliable** (steel, electronics). Another reason demo mode matters.
- **Compass noise.** Smooth the heading (e.g. exponential moving average) so labels don't jitter.
- **One tap to start.** Camera, mic, orientation, and audio playback all need a user gesture. A single "Start" button (tapped before the phone goes into the Cardboard) unlocks everything.
- **HTTPS required** for camera/geolocation/sensors → we test via **ngrok**.

## Demo mode (required — the demo is indoors)

- **Fixed location:** GPS is ignored; the user is pinned to a fixed lat/lon (Georgia Tech, near ATL — see [Decisions made](#decisions-made)).
- **Frozen dataset:** a snapshot of real adsb.lol data around that location (captured once, saved as a fixture), so the demo doesn't depend on live traffic or network. Planes should be spread around 360° so turning around in the room reveals different planes.
- **Heading is still live** from the phone sensors. That is the part judges experience.
- **Desktop dev mode** (for agents/devs without a phone): fixed location + heading controlled by keyboard arrows or a slider.

## Voice activation (stretch; no button available)

There's no Cardboard button and the phone is inside the headset, so activation must be hands-free:

- **Primary: always-on wake phrase.** Browser `SpeechRecognition` in continuous mode (works in Android Chrome) listens constantly; when the transcript contains "hey grok" (fuzzy match: "hey grock", "a grok", "hey rock", ...), the rest of the utterance (or the next one) is the question. Recognition stops after silence, so it must auto-restart.
- **Fallback: head gesture.** e.g. tilt head sideways (roll > ~30° for ~1s) to start listening. Robust in a noisy hackathon room.
- Answers spoken back via browser `speechSynthesis` (simplest), and shown briefly as text in the HUD.

## Architecture

```
Phone browser (web app, via ngrok HTTPS)
  │
  ├─ GET  /api/flights/nearby ──► flight-service (Wesley)  ──► adsb.lol
  └─ POST /api/voice/ask ───────► voice-service  (Allison) ──► Grok (xAI API)
```

- The web app's dev server **proxies** `/api/flights/*` and `/api/voice/*` to the two services. Result: **one ngrok tunnel**, no CORS issues.
- **Division of math:** the flight service computes each plane's `bearingDeg` and `distanceKm` from the user. The web app does the per-frame cone filter and label placement (a few lines) using the live heading. Heading changes every frame; sending it to a server each frame would be laggy.
- The web app polls `/api/flights/nearby` every ~3–5 s.
- The xAI API key lives **only** in voice-service (never in the browser).

### Repo layout and ownership

| Path | Owner | What |
|---|---|---|
| `web/` | **Jaiden** | Web app: camera, stereo view, orientation/heading, HUD + labels, cone filter, demo/dev mode UI, dev proxy, integration |
| `web/src/voice/` | **Allison** | Browser-side voice: mic, wake phrase / gesture trigger, speech-to-text, text-to-speech, calls `/api/voice/ask` |
| `voice-service/` | **Allison** | Backend: builds the Grok prompt from question + plane context, calls Grok, returns answer |
| `flight-service/` | **Wesley** | Backend: adsb.lol fetching, normalization to `Plane`, bearing/distance math, aircraft type names, origin/destination lookup, demo snapshot |
| `shared/` | **Everyone** (change only with team agreement) | `fixtures/demo-planes.json` (sample response for the web app to develop against before the service is ready) |
| `CLAUDE.md` | **Everyone** | This file. Contract changes go here first. |

### Local ports

| Service | Port | Routes mounted at |
|---|---|---|
| web (dev server) | 5173 | `/` |
| flight-service | 8001 | `/api/flights/...` |
| voice-service | 8002 | `/api/voice/...` |

Services mount routes under their full `/api/...` prefix so the proxy needs no path rewriting.

## Contracts (the interfaces between workstreams)

### `Plane`

```ts
type Plane = {
  id: string;                  // ICAO 24-bit hex, stable key (e.g. "a1b2c3")
  callsign: string | null;     // e.g. "UAL123" (trimmed)
  registration: string | null; // e.g. "N12345"
  typeCode: string | null;     // ICAO type designator, e.g. "B738"
  typeName: string | null;     // human-readable, e.g. "Boeing 737-800"
  airline: string | null;      // e.g. "United Airlines", if derivable from callsign
  origin: string | null;       // airport code (IATA preferred), if available
  destination: string | null;
  lat: number;
  lon: number;
  altitudeFt: number | null;
  groundSpeedKt: number | null;
  trackDeg: number | null;     // direction the plane is moving
  distanceKm: number;          // from the query position
  bearingDeg: number;          // from the query position, [0, 360), true north
};
```

Any field may be `null` except position/distance/bearing. The UI must handle missing data gracefully.

### Flight service

`GET /api/flights/nearby?lat={lat}&lon={lon}&radiusKm={r}&demo={0|1}`

```json
{
  "center": { "lat": 37.62, "lon": -122.38 },
  "demo": false,
  "fetchedAt": "2026-09-25T20:00:00Z",
  "planes": [ /* Plane[] sorted by distanceKm */ ]
}
```

- `demo=1`: ignore `lat`/`lon`, use the fixed demo location + frozen snapshot. `center` tells the client where it "is".
- Should never 500 on adsb.lol failures. Return last cached result (or empty list) instead.
- adsb.lol notes (verify against their docs): nearby-aircraft endpoint is along the lines of `https://api.adsb.lol/v2/point/{lat}/{lon}/{radius_nm}` (radius in **nautical miles**), readsb-style fields (`hex`, `flight`, `r`, `t`, `lat`, `lon`, `alt_baro`, `gs`, `track`). Origin/destination is **not** in the position data; adsb.lol has a separate route lookup by callsign (`routeset`). Treat routes as best-effort.

### Voice service

`POST /api/voice/ask`

```json
// request
{ "question": "what kind of plane is that?", "plane": { /* Plane */ } | null, "nearbyPlanes": [ /* Plane[], optional */ ] }
// response
{ "answer": "That's United 123, a Boeing 737-800 heading to Denver..." }
```

- Answers should be **short and spoken-friendly** (1–3 sentences, no markdown). They are read aloud.
- If `plane` is null, answer generally or say no plane is in view.

### Browser voice module (Allison's `web/src/voice/` ↔ Jaiden's app)

```ts
startVoice(opts: {
  getCurrentPlane: () => Plane | null;    // app provides current centered plane
  getNearbyPlanes: () => Plane[];
  onStateChange: (s: "idle" | "listening" | "thinking" | "speaking") => void;
  onTranscript?: (text: string) => void;   // what the user said
  onAnswer: (text: string) => void;        // app shows it in HUD
}): { stop: () => void };
```

Jaiden's app calls `startVoice` after the Start tap and renders the state indicator + answer text. Allison's module owns everything about audio.

## Ownership rules for agents

1. **Only edit files in your owner's paths** (table above). If you need something from another workstream, stub/mock it on your side and tell your human.
2. **Contracts are frozen unless the team agrees.** If a contract must change, stop and tell your human. Don't silently change request/response shapes.
3. **Develop against mocks.** Web uses `shared/fixtures/demo-planes.json` until flight-service is up; voice-service can be tested with curl; flight-service can be tested with a script/curl.
4. **Every workstream must run standalone** and degrade gracefully if the others are down (e.g. web still shows labels if voice-service is offline).
5. Keep it simple. It's a hackathon. No auth, no database, no tests beyond what helps you move faster.

## Workstream priorities

**Jaiden — web app + integration**
1. Start button → rear camera → side-by-side stereo view on Android Chrome over ngrok.
2. Camera heading from device orientation (+ smoothing, declination); desktop dev mode with arrow-key heading.
3. Cone filter + positioned label + info card for the centered plane, using the fixture.
4. Hook up live flight-service (polling, demo toggle).
5. Mount voice module; show listening/thinking state and answers.
6. Polish: FOV calibration, visuals (reticle, markers for other in-view planes).

**Wesley — flight service**
1. `/api/flights/nearby` returning the contract shape from adsb.lol with correct bearing/distance.
2. Demo mode: pick location, capture snapshot, commit fixture (also copy a sample into `shared/fixtures/demo-planes.json` early so Jaiden can build against it).
3. Enrichment: `typeName` from type code, `airline` from callsign prefix, origin/destination via route lookup.
4. Caching/rate-limit safety.

**Allison — voice**
1. `voice-service` `/api/voice/ask` calling Grok with plane context, testable by curl.
2. Browser module: continuous speech recognition + "hey grok" detection + TTS.
3. Head-tilt fallback trigger.
4. Prompt tuning for short, fun, accurate spoken answers.

## Decisions made

- **Stack:** `web/` = Vite + TypeScript (Jaiden's agent picks plain TS or React). `flight-service/` and `voice-service/` = Python + FastAPI (each with its own `requirements.txt` and `.venv`). The only coupling between them is the HTTP/JSON contracts above.
- **Demo location:** user pinned to **Georgia Tech campus (33.7756, -84.3963)**, with Atlanta Hartsfield-Jackson (ATL, ~15 km south) traffic around it. Demo radius may be raised (e.g. ~30–40 km) to get enough planes spread around 360°. Wesley may adjust if the real snapshot is lopsided.
- **Declination** for Atlanta is roughly 5–6° W (verify with NOAA's calculator; hardcode it).
- **Fixture:** `shared/fixtures/demo-planes.json` currently holds **synthetic** planes (correct bearings/distances from GT) so web work can start now. Wesley replaces it with a real adsb.lol snapshot of the same shape.

## Decisions still open

- Exact info-card fields (limited screen space)
- Camera FOV calibration value for the demo phone
