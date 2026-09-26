// Device presets and user settings for the Cardboard stereo layout.

export type DevicePreset = {
  id: string;
  label: string;
  /** Physical length of the screen's long edge (landscape width), in mm. */
  screenWidthMm: number;
  /** Matched against the device model (userAgentData) or the user agent string. */
  match?: RegExp;
};

// Long-edge lengths derived from diagonal + resolution:
//   Pixel 10:       6.3", 1080x2424 -> ~146 mm
//   Galaxy S22+:    6.6", 1080x2340 -> ~152 mm
//   iPhone 13 mini: 5.4", 1080x2340 -> ~125 mm
export const PRESETS: DevicePreset[] = [
  { id: 'pixel10', label: 'Pixel 10', screenWidthMm: 146, match: /Pixel 10/i },
  { id: 's22plus', label: 'Galaxy S22+', screenWidthMm: 152, match: /SM-S906/i },
  { id: 'iphone13mini', label: 'iPhone 13 mini', screenWidthMm: 125, match: /iPhone/i },
  { id: 'generic', label: 'Other (~6.3" phone)', screenWidthMm: 146 },
];

/** Typical Cardboard lens center-to-center distance. */
export const DEFAULT_IPD_MM = 64;

export type Settings = {
  presetId: string;
  ipdMm: number;
  /** Horizontal shift of both eyes (+ = right), for a phone that isn't centered in the headset. */
  offsetMm: number;
  /** Fraction of the available eye area the image fills. */
  viewScale: number;
  /** Rotation compensating for a phone sitting crooked in the headset (+ = clockwise). */
  tiltDeg: number;
  /** Hardware camera zoom; null = widest available (ultrawide on most phones). */
  cameraZoom: number | null;
  /** '' = auto (rear-facing). */
  cameraId: string;
};

export const DEFAULT_SETTINGS: Settings = {
  presetId: 'generic',
  ipdMm: DEFAULT_IPD_MM,
  offsetMm: 0,
  viewScale: 0.95,
  tiltDeg: 0,
  cameraZoom: null,
  cameraId: '',
};

const STORAGE_KEY = 'ar-plane-settings-v4';

export function loadSettings(): Partial<Settings> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
  } catch {
    return {};
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // Storage unavailable; settings just won't persist.
  }
}

export function getPreset(id: string): DevicePreset {
  return PRESETS.find((p) => p.id === id) ?? PRESETS[PRESETS.length - 1];
}

/** Best-effort model detection. Android Chrome hides the model in the UA string, so ask userAgentData. */
export async function detectPreset(): Promise<DevicePreset> {
  let model = navigator.userAgent;
  const uad = (navigator as any).userAgentData;
  if (uad?.getHighEntropyValues) {
    try {
      const v = await uad.getHighEntropyValues(['model']);
      if (v.model) model = v.model;
    } catch {
      // Fall back to the UA string.
    }
  }
  return PRESETS.find((p) => p.match?.test(model)) ?? getPreset('generic');
}

/** CSS pixels per physical millimeter, using the screen's long edge. */
export function pxPerMm(preset: DevicePreset): number {
  const longEdgeCssPx = Math.max(screen.width, screen.height);
  return longEdgeCssPx / preset.screenWidthMm;
}
