import { DEFAULT_IPD_MM, DEFAULT_SETTINGS, PRESETS, detectPreset, getPreset, loadSettings, pxPerMm, saveSettings } from './config';
import type { Settings } from './config';
import { describeStream, getZoom, getZoomRange, listCameras, setZoom, startCamera } from './camera';
import { createStereoView } from './stereo';
import type { StereoView } from './stereo';

const startScreen = document.getElementById('start-screen')!;
const presetSelect = document.getElementById('preset-select') as HTMLSelectElement;
const ipdInput = document.getElementById('ipd-input') as HTMLInputElement;
const cameraSelect = document.getElementById('camera-select') as HTMLSelectElement;
const startBtn = document.getElementById('start-btn') as HTMLButtonElement;
const startStatus = document.getElementById('start-status')!;
const stereoEl = document.getElementById('stereo')!;

let settings: Settings = { ...DEFAULT_SETTINGS };
let view: StereoView | null = null;
let stream: MediaStream | null = null;
let hudError = '';
let toast = '';
let toastTimer = 0;

// In-headset calibration: middle tap cycles the mode, left/right taps adjust it.
type Mode = 'zoom' | 'tilt' | 'spacing' | 'shift' | 'size' | 'info';
const MODES: Mode[] = ['zoom', 'tilt', 'spacing', 'shift', 'size', 'info'];
let mode: Mode = 'zoom';

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
  await refreshCameraList();

  if (!window.isSecureContext) {
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

function readSettingsFromForm() {
  const ipd = Number(ipdInput.value);
  settings = {
    ...settings,
    presetId: presetSelect.value,
    ipdMm: Number.isFinite(ipd) && ipd > 0 ? ipd : DEFAULT_IPD_MM,
    cameraId: cameraSelect.value,
  };
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
  renderHud();
}

/** Draws identical overlay content into both eyes. */
function renderHud() {
  if (!view || !stream) return;
  const debug =
    mode === 'info'
      ? `<div class="debug">tilt ${settings.tiltDeg}° · ${settings.ipdMm}mm · shift ${settings.offsetMm}mm · ${Math.round(settings.viewScale * 100)}% · ${describeStream(stream)}</div>`
      : '';
  const error = hudError ? `<div class="hud-error">${hudError}</div>` : '';
  const toastHtml = toast ? `<div class="toast">${toast}</div>` : '';
  const html = `<div class="crosshair"></div>${error}${toastHtml}${debug}`;
  for (const eye of view.eyes) eye.overlay.innerHTML = html;
}

async function start() {
  readSettingsFromForm();
  const immersive = enterImmersive();
  startBtn.disabled = true;
  startStatus.textContent = 'Starting camera…';

  try {
    stream = await startCamera(settings.cameraId || undefined);
    startStatus.textContent = 'Camera open, entering view…';
    await Promise.race([immersive, new Promise((r) => setTimeout(r, 1500))]);
    keepScreenOn();

    view = createStereoView(stereoEl, stream);
    startScreen.hidden = true;
    stereoEl.hidden = false;
    startStatus.textContent = '';
    hudError = '';
    relayout();
    watchForFrames(stream);
    applySavedZoom(stream);
  } catch (err) {
    startStatus.textContent = `Could not start: ${(err as Error).message}`;
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
  renderHud();
}

/** Surface a stuck camera instead of showing a silent black screen. */
function watchForFrames(s: MediaStream) {
  setTimeout(() => {
    if (!view || stream !== s) return;
    const video = view.eyes[0].video;
    if (video.videoWidth === 0) {
      const track = s.getVideoTracks()[0];
      hudError = `No camera frames (track ${track?.readyState ?? 'missing'}, video paused=${video.paused}). Swipe back and retry.`;
      renderHud();
    }
  }, 3000);
}

/** Back to the start screen (e.g. after the Android back gesture exits fullscreen). */
function stop() {
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
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
    case 'info':
      return 'info';
  }
}

async function adjust(direction: -1 | 1) {
  if (!stream) return;
  switch (mode) {
    case 'zoom': {
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
    case 'info':
      return;
  }
  saveSettings(settings);
  if (mode !== 'zoom') showToast(modeLabel());
  relayout();
}

function cycleMode() {
  mode = MODES[(MODES.indexOf(mode) + 1) % MODES.length];
  showToast(mode === 'info' ? 'info' : `◀ ▶ ${modeLabel()}`);
}

function showToast(text: string) {
  toast = text;
  renderHud();
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toast = '';
    renderHud();
  }, 1500);
}

startBtn.addEventListener('click', start);
stereoEl.addEventListener('click', (e) => {
  const x = e.clientX / window.innerWidth;
  if (x < 1 / 3) adjust(-1);
  else if (x > 2 / 3) adjust(1);
  else cycleMode();
});
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement && view) stop();
});
window.addEventListener('resize', relayout);
screen.orientation?.addEventListener('change', relayout);
document.addEventListener('visibilitychange', () => {
  // Wake lock is released when the tab is hidden; re-acquire on return.
  if (document.visibilityState === 'visible' && view) keepScreenOn();
});

initStartScreen();
