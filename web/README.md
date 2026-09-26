# web/ — owner: Jaiden

Vite + TypeScript web app (camera, stereo view, heading, HUD, cone filter, integration).
`web/src/voice/` is owned by **Allison**. See root `CLAUDE.md` for contracts and rules.

## Run

```sh
npm install
npm run dev              # http://localhost:5173
ngrok http 5173          # HTTPS URL to open on the phone (needs ngrok >= 3.20)
```

`/api/flights` and `/api/voice` are proxied to ports 8001 / 8002, so one tunnel covers everything.

## Stereo layout

Each eye's image is centered under its Cardboard lens (default 64 mm apart), not at 1/4 and 3/4 of the screen.
That needs CSS px per mm, which comes from a per-phone preset in `src/config.ts` (auto-detected, overridable on the start screen).

| Phone | Screen long edge | Landscape viewport (approx) |
|---|---|---|
| Pixel 10 | ~146 mm | ~924 × 412 |
| Galaxy S22+ | ~152 mm | ~832 × 384 |
| iPhone 13 mini | ~125 mm | — (iOS: no fullscreen/orientation lock) |

## In-headset calibration

Calibration is locked by default. **Double-tap the middle** to unlock; then tap the **middle** to cycle settings, **left/right** to adjust. Re-locks after 6 s idle. Saved per browser. **Long-press** returns to the start screen.

| Setting | What it fixes |
|---|---|
| zoom | Hardware camera zoom (starts at widest). Tune until things look life-size. |
| tilt | Phone sitting crooked in the headset → double crosshair. Rotates the layout. |
| spacing | Lens center distance (default 64 mm). Crosshairs side by side → adjust. |
| shift | Phone off-center horizontally in the headset. |
| size | Shrinks the image if the edges look warped. |
| fov | Field of view used to place planes. Tune until diamonds line up with real objects as you turn. |
| info | Shows all current values. |
