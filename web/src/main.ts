import { DEFAULT_IPD_MM, DEFAULT_SETTINGS, PRESETS, detectPreset, getPreset, loadSettings, pxPerMm, saveSettings } from './config';
import type { DataMode, Settings } from './config';
import { describeStream, getZoom, getZoomRange, listCameras, setZoom, startCamera } from './camera';
import { halfFovDeg, normalizeDeg, visibleHalfTan } from './geo';
import { drawHud } from './hud';
import type { HudResult, VoiceHud } from './hud';
import { requestOrientationPermission, startOrientation } from './orientation';
import type { OrientationTracker } from './orientation';
import { startFixtureFeed, startLiveFeed, watchPosition } from './planes';
import type { PlaneFeed } from './planes';
import { createStereoView } from './stereo';
import type { StereoView } from './stereo';
import { startVoice } from './voice';
import type { VoiceHandle } from './voice';

// URL options:
//   ?dev=1          desktop dev mode: arrow keys set the heading, camera optional, no fullscreen
//   ?data=demo|live|fixture   override the start screen's Data setting
//   ?orient=event   force deviceorientation events instead of AbsoluteOrientationSensor
const params = new URLSearchParams(location.search);
const DEV = params.has('dev');
const DATA_OVERRIDE = params.get('data') as DataMode | null;
const FORCE_ORIENT_EVENTS = params.get('orient') === 'event';

const startScreen = document.getElementById('start-screen')!;
const presetSelect = document.getElementById('preset-select') as HTMLSelectElement;
const ipdInput = document.getElementById('ipd-input') as HTMLInputElement;
const cameraSelect = document.getElementById('camera-select') as HTMLSelectElement;
const dataSelect = document.getElementById('data-select') as HTMLSelectElement;
const voiceCheck = document.getElementById('voice-check') as HTMLInputElement;
const radiusInput = document.getElementById('radius-input') as HTMLInputElement;
const startBtn = document.getElementById('start-btn') as HTMLButtonElement;
const startStatus = document.getElementById('start-status')!;
const stereoEl = document.getElementById('stereo')!;

let settings: Settings = { ...DEFAULT_SETTINGS };
let view: StereoView | null = null;
let stream: MediaStream | null = null;
let orientation: OrientationTracker | null = null;
let feed: PlaneFeed | null = null;
let gps: ReturnType<typeof watchPosition> | null = null;
let voice: VoiceHandle | null = null;
let voiceHud: VoiceHud | null = null;
let answerTimer = 0;
let voiceErrorTimer = 0;
/** What the viewer was looking at last frame; the voice module reads this when asked. */
let lastView: HudResult = { focus: null, inView: [] };
/** How long an answer stays on screen after Grok finishes speaking. */
const ANSWER_LINGER_MS = 7000;
let rafId = 0;
let devHeading = 0;
/** Latest computed half-FOV, for the calibration toast and debug line. */
let lastHalfFovDeg = 0;
let hudError = '';
let toast = '';
let toastTimer = 0;

// In-headset calibration. Locked by default so stray touches (cheek, headset edge) do nothing.
// Double-tap the middle to unlock; then middle tap = next setting, left/right = adjust.
// Re-locks after LOCK_AFTER_MS without a tap (except in 'info', which stays up).
type Mode = 'zoom' | 'tilt' | 'spacing' | 'shift' | 'size' | 'fov' | 'info';
const MODES: Mode[] = ['zoom', 'tilt', 'spacing', 'shift', 'size', 'fov', 'info'];
let mode: Mode | null = null;
let lockTimer = 0;
let lastMiddleTap = 0;
const LOCK_AFTER_MS = 6000;
const DOUBLE_TAP_MS = 400;
const LONG_PRESS_MS = 1500;
let longPressTimer = 0;
let longPressFired = false;

async function initStartScreen() {
  for (const p of PRESETS) presetSelect.add(new Option(p.label, p.id));
  const saved = loadSettings();
  settings = {
    ...DEFAULT_SETTINGS,
    ...saved,
    presetId: saved.presetId ?? (await detectPreset()).id,
  };
  presetSelect.value = settings.presetId;
  ipdInput.value = String(settings.ipdMm);
  dataSelect.value = DATA_OVERRIDE ?? settings.dataMode;
  voiceCheck.checked = settings.voiceEnabled;
  radiusInput.value = settings.radiusKm == null ? '' : String(settings.radiusKm);
  await refreshCameraList();

  if (DEV) startStatus.textContent = 'Dev mode: ← → turn (hold Shift for 10°).';
  else if (!window.isSecureContext) {
    startStatus.textContent = 'Not a secure context: camera and sensors need HTTPS (use ngrok) or localhost.';
  }
}

/** Camera labels are only available after permission has been granted once. */
async function refreshCameraList() {
  const cams = await listCameras();
  cameraSelect.replaceChildren(new Option('Auto (rear)', ''));
  cams.forEach((c, i) => cameraSelect.add(new Option(c.label || `Camera ${i + 1}`, c.deviceId)));
  cameraSelect.value = cams.some((c) => c.deviceId === settings.cameraId) ? settings.cameraId : '';
}

/** Blank or invalid = null (use flight-service's default radius). Clamped to what the service accepts. */
function parseRadius(value: string): number | null {
  const r = Number(value);
  if (!value.trim() || !Number.isFinite(r) || r <= 0) return null;
  return Math.min(400, Math.round(r));
}

function readSettingsFromForm() {
  const ipd = Number(ipdInput.value);
  settings = {
    ...settings,
    presetId: presetSelect.value,
    ipdMm: Number.isFinite(ipd) && ipd > 0 ? ipd : DEFAULT_IPD_MM,
    cameraId: cameraSelect.value,
    dataMode: dataSelect.value as DataMode,
    voiceEnabled: voiceCheck.checked,
    radiusKm: parseRadius(radiusInput.value),
  };
  radiusInput.value = settings.radiusKm == null ? '' : String(settings.radiusKm);
  saveSettings(settings);
}

/** Fullscreen + landscape lock. Must be kicked off synchronously from the tap. */
async function enterImmersive() {
  try {
    await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    await (screen.orientation as any).lock?.('landscape');
  } catch {
    // iOS and desktop don't support these; the view still works.
  }
}

async function keepScreenOn() {
  try {
    await navigator.wakeLock?.request('screen');
  } catch {
    // Not fatal.
  }
}

function relayout() {
  if (!view) return;
  view.layout({
    pxPerMm: pxPerMm(getPreset(settings.presetId)),
    ipdMm: settings.ipdMm,
    offsetMm: settings.offsetMm,
    viewScale: settings.viewScale,
    tiltDeg: settings.tiltDeg,
  });
  renderOverlay();
}

function currentHeading(): number | null {
  if (DEV) return devHeading;
  return orientation?.get()?.headingDeg ?? null;
}

/** Per-frame: compute the visible FOV and draw the HUD canvas in both eyes. */
function frame() {
  if (!view) return;
  rafId = requestAnimationFrame(frame);

  const { width, height } = view.eyeSize();
  if (!width || !height) return;
  const video = view.eyes[0].video;
  const streamAspect = video.videoWidth && video.videoHeight ? video.videoWidth / video.videoHeight : 4 / 3;
  const zoom = (stream && getZoom(stream)) || 1;
  const halfTan = visibleHalfTan(
    getPreset(settings.presetId).cameraHalfTan1x,
    zoom,
    width / height,
    streamAspect,
    settings.fovScale,
  );
  lastHalfFovDeg = halfFovDeg(halfTan);

  const feedState = feed?.get();
  const hud = {
    headingDeg: currentHeading(),
    halfTan,
    planes: feedState?.planes ?? [],
    status: feedState?.status ?? '',
    timeMs: performance.now(),
    voice: voiceHud,
  };
  // Both eyes get identical input, so either result works; keep the first.
  const [left, right] = view.eyes;
  lastView = drawHud(left.ctx, width, height, hud);
  drawHud(right.ctx, width, height, hud);
}

/** Starts Allison's voice module. Must run synchronously inside the Start tap (mic + speech need a gesture). */
function startVoiceAssistant() {
  voiceHud = { state: 'idle', transcript: null, answer: null, error: null };
  const hud = voiceHud;
  voice = startVoice({
    getCurrentPlane: () => lastView.focus,
    getNearbyPlanes: () => lastView.inView,
    onStateChange: (s) => {
      hud.state = s;
      if (s === 'listening') {
        // New question: clear the previous exchange.
        clearTimeout(answerTimer);
        hud.transcript = null;
        hud.answer = null;
      } else if (s === 'idle' && hud.answer) {
        clearTimeout(answerTimer);
        answerTimer = window.setTimeout(() => {
          hud.transcript = null;
          hud.answer = null;
        }, ANSWER_LINGER_MS);
      }
    },
    onTranscript: (t) => (hud.transcript = t),
    onAnswer: (a) => (hud.answer = a),
    onError: (m) => {
      hud.error = m;
      clearTimeout(voiceErrorTimer);
      voiceErrorTimer = window.setTimeout(() => (hud.error = null), 4000);
    },
  });
}

/** DOM overlay: crosshair, calibration toast, errors, debug line. Redrawn on events, not per frame. */
function renderOverlay() {
  if (!view) return;
  let debug = '';
  if (mode === 'info') {
    const o = orientation?.get();
    const hdg = DEV ? `dev ${Math.round(devHeading)}°` : o ? `${Math.round(o.headingDeg)}° ${o.source}` : 'no compass';
    debug = `<div class="debug">${hdg} · fov ${Math.round(lastHalfFovDeg * 2)}° · ${feed?.get().status ?? ''}<br>
      tilt ${settings.tiltDeg}° · ${settings.ipdMm}mm · shift ${settings.offsetMm}mm · ${Math.round(settings.viewScale * 100)}% · ${stream ? describeStream(stream) : 'no camera'}</div>`;
  }
  const error = hudError ? `<div class="hud-error">${hudError}</div>` : '';
  const resume =
    !DEV && !document.fullscreenElement ? '<div class="hud-hint">Tap to resume fullscreen · long-press for settings</div>' : '';
  const toastHtml = toast ? `<div class="toast">${toast}</div>` : '';
  const html = `<div class="crosshair"></div>${error}${resume}${toastHtml}${debug}`;
  for (const eye of view.eyes) eye.overlay.innerHTML = html;
}

async function start() {
  readSettingsFromForm();
  // Both must start synchronously inside the tap (user-gesture requirements).
  const immersive = DEV ? Promise.resolve() : enterImmersive();
  const orientPermission = DEV ? Promise.resolve() : requestOrientationPermission();
  if (settings.voiceEnabled) startVoiceAssistant();
  startBtn.disabled = true;
  startStatus.textContent = 'Starting camera…';

  try {
    try {
      stream = await startCamera(settings.cameraId || undefined);
    } catch (err) {
      if (!DEV) throw err;
      stream = null; // Dev mode works without a camera.
    }
    startStatus.textContent = 'Camera open, entering view…';
    await Promise.race([immersive, new Promise((r) => setTimeout(r, 1500))]);
    await orientPermission;
    keepScreenOn();

    if (!DEV) orientation = startOrientation(FORCE_ORIENT_EVENTS);
    if (settings.dataMode !== 'fixture') {
      const demo = settings.dataMode === 'demo';
      if (!demo) gps = watchPosition();
      feed = startLiveFeed({
        demo,
        getPosition: () => gps?.get() ?? null,
        radiusKm: settings.radiusKm,
        getHeading: currentHeading,
      });
    } else {
      feed = startFixtureFeed(settings.radiusKm);
    }

    view = createStereoView(stereoEl, stream);
    mode = null;
    longPressFired = false;
    // Swallow the Android back gesture while in the view (see popstate handler).
    history.pushState({ arView: true }, '');
    startScreen.hidden = true;
    stereoEl.hidden = false;
    startStatus.textContent = '';
    hudError = '';
    relayout();
    rafId = requestAnimationFrame(frame);
    if (stream) {
      watchForFrames(stream);
      applySavedZoom(stream);
    }
  } catch (err) {
    startStatus.textContent = `Could not start: ${(err as Error).message}`;
    stopVoiceAssistant();
  } finally {
    startBtn.disabled = false;
  }
}

/** Applied after the view is showing so a slow zoom change can't stall startup. */
async function applySavedZoom(s: MediaStream) {
  const range = getZoomRange(s);
  if (!range) return;
  const target = settings.cameraZoom ?? range.min;
  await setZoom(s, Math.min(range.max, Math.max(range.min, target)));
  renderOverlay();
}

/** Surface a stuck camera instead of showing a silent black screen. */
function watchForFrames(s: MediaStream) {
  setTimeout(() => {
    if (!view || stream !== s) return;
    const video = view.eyes[0].video;
    if (video.videoWidth === 0) {
      const track = s.getVideoTracks()[0];
      hudError = `No camera frames (track ${track?.readyState ?? 'missing'}, video paused=${video.paused}). Swipe back and retry.`;
      renderOverlay();
    }
  }, 3000);
}

function stopVoiceAssistant() {
  voice?.stop();
  voice = null;
  voiceHud = null;
  clearTimeout(answerTimer);
  clearTimeout(voiceErrorTimer);
}

/** Back to the start screen (e.g. after the Android back gesture exits fullscreen). */
function stop() {
  stopVoiceAssistant();
  cancelAnimationFrame(rafId);
  clearTimeout(lockTimer);
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  if (history.state?.arView) history.back();
  stream?.getTracks().forEach((t) => t.stop());
  orientation?.stop();
  feed?.stop();
  gps?.stop();
  stream = null;
  orientation = null;
  feed = null;
  gps = null;
  view = null;
  stereoEl.replaceChildren();
  stereoEl.hidden = true;
  startScreen.hidden = false;
  ipdInput.value = String(settings.ipdMm);
  refreshCameraList();
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round2 = (v: number) => Math.round(v * 100) / 100;

function modeLabel(): string {
  switch (mode) {
    case null:
      return 'locked';
    case 'zoom': {
      const z = stream && getZoom(stream);
      return `zoom ${z != null ? `${z.toFixed(1)}×` : '(n/a)'}`;
    }
    case 'tilt':
      return `tilt ${settings.tiltDeg > 0 ? '+' : ''}${settings.tiltDeg.toFixed(1)}°`;
    case 'size':
      return `size ${Math.round(settings.viewScale * 100)}%`;
    case 'spacing':
      return `spacing ${settings.ipdMm} mm`;
    case 'shift':
      return `shift ${settings.offsetMm > 0 ? '+' : ''}${settings.offsetMm} mm`;
    case 'fov':
      return `fov ${Math.round(lastHalfFovDeg * 2)}°`;
    case 'info':
      return 'info';
  }
}

async function adjust(direction: -1 | 1) {
  switch (mode) {
    case 'zoom': {
      if (!stream) return showToast('no camera');
      const range = getZoomRange(stream);
      if (!range) return showToast('zoom not supported');
      const current = getZoom(stream) ?? range.min;
      const next = clamp(round2(current + direction * Math.max(range.step, 0.1)), range.min, range.max);
      settings.cameraZoom = next;
      showToast(`zoom ${next.toFixed(1)}×`);
      await setZoom(stream, next);
      break;
    }
    case 'tilt':
      settings.tiltDeg = clamp(settings.tiltDeg + direction * 0.5, -15, 15);
      break;
    case 'size':
      settings.viewScale = clamp(round2(settings.viewScale + direction * 0.02), 0.6, 1);
      break;
    case 'spacing':
      settings.ipdMm = clamp(settings.ipdMm + direction, 50, 80);
      break;
    case 'shift':
      settings.offsetMm = clamp(settings.offsetMm + direction, -20, 20);
      break;
    case 'fov':
      settings.fovScale = clamp(round2(settings.fovScale + direction * 0.03), 0.5, 1.5);
      break;
    case 'info':
    case null:
      return;
  }
  saveSettings(settings);
  relayout();
  // The FOV is recomputed in the next frame; show the toast after it.
  if (mode === 'fov') requestAnimationFrame(() => requestAnimationFrame(() => showToast(modeLabel())));
  else if (mode !== 'zoom') showToast(modeLabel());
}

/** Cycles zoom → … → info → locked. */
function cycleMode() {
  const i = mode ? MODES.indexOf(mode) + 1 : 0;
  mode = i < MODES.length ? MODES[i] : null;
  showToast(mode === null ? 'calibration locked' : mode === 'info' ? 'info' : `◀ ▶ ${modeLabel()}`);
}

function armAutoLock() {
  clearTimeout(lockTimer);
  if (!mode || mode === 'info') return;
  lockTimer = window.setTimeout(() => {
    mode = null;
    showToast('calibration locked');
  }, LOCK_AFTER_MS);
}

function onViewTap(e: MouseEvent) {
  if (longPressFired) {
    longPressFired = false;
    return;
  }
  // After an accidental exit from fullscreen, the next tap just goes back in.
  if (!DEV && !document.fullscreenElement) {
    enterImmersive().then(renderOverlay);
    return;
  }
  const x = e.clientX / window.innerWidth;
  const middle = x >= 1 / 3 && x <= 2 / 3;
  if (mode === null) {
    if (!middle) return;
    const now = performance.now();
    if (now - lastMiddleTap < DOUBLE_TAP_MS) {
      lastMiddleTap = 0;
      cycleMode();
      armAutoLock();
    } else {
      lastMiddleTap = now;
    }
    return;
  }
  if (middle) cycleMode();
  else adjust(x < 1 / 3 ? -1 : 1);
  armAutoLock();
}

function showToast(text: string) {
  toast = text;
  renderOverlay();
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toast = '';
    renderOverlay();
  }, 1500);
}

startBtn.addEventListener('click', start);
stereoEl.addEventListener('click', onViewTap);
// Long-press anywhere = back to the start screen (the deliberate way out).
stereoEl.addEventListener('pointerdown', () => {
  clearTimeout(longPressTimer);
  longPressTimer = window.setTimeout(() => {
    longPressFired = true;
    stop();
  }, LONG_PRESS_MS);
});
for (const type of ['pointerup', 'pointercancel', 'pointerleave'] as const) {
  stereoEl.addEventListener(type, () => clearTimeout(longPressTimer));
}
window.addEventListener('keydown', (e) => {
  if (!DEV || !view) return;
  const step = e.shiftKey ? 10 : 2;
  if (e.key === 'ArrowLeft') devHeading = normalizeDeg(devHeading - step);
  else if (e.key === 'ArrowRight') devHeading = normalizeDeg(devHeading + step);
  // Skip the wake phrase on desktop: V = start listening for a question.
  else if (e.key === 'v') voice?.listen();
});
// Leaving fullscreen (often an accidental back-swipe from the headset edge) no longer exits the
// view; the overlay shows a "tap to resume" hint instead.
document.addEventListener('fullscreenchange', renderOverlay);
window.addEventListener('popstate', () => {
  if (view) history.pushState({ arView: true }, '');
});
window.addEventListener('resize', relayout);
screen.orientation?.addEventListener('change', relayout);
document.addEventListener('visibilitychange', () => {
  // Wake lock is released when the tab is hidden; re-acquire on return.
  if (document.visibilityState === 'visible' && view) keepScreenOn();
});
// Keep the info line's heading fresh while it's showing.
setInterval(() => {
  if (view && mode === 'info') renderOverlay();
}, 500);

initStartScreen();
