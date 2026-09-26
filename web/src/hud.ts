// Per-frame HUD drawn on a canvas. The same draw call runs once per eye so both eyes
// always show identical content (required for the two images to fuse in the headset).
//
// Everything hangs off one "headband" compass bar near the top of the view:
//   on the bar:    a diamond per plane at its bearing, center mark
//   below the bar: degree ticks/labels, current heading
//   right under that: info card for the focused plane, attached to the compass
//                  (drops down like a notification)
// Voice ("hey grok") status and answers show as subtitles near the bottom.
// The middle of the view stays clear.

import { cardLines, flightLabel } from './format';
import { halfFovDeg, normalizeDeg, projectX, signedDiffDeg } from './geo';
import type { Plane } from './planes';
import type { VoiceState } from './voice';

/** What the voice subtitles show. Timing (when to clear the answer) is handled by main.ts. */
export type VoiceHud = {
  state: VoiceState;
  transcript: string | null;
  answer: string | null;
  error: string | null;
};

/** Planes the viewer is looking at this frame (offsetDeg filled in), for voice context. */
export type HudResult = {
  focus: Plane | null;
  inView: Plane[];
};

const NO_PLANES: HudResult = { focus: null, inView: [] };

export type HudState = {
  headingDeg: number | null;
  /** tan(half horizontal FOV) of what one eye shows. */
  halfTan: number;
  planes: Plane[];
  /** Data feed status, shown when there are no planes at all (e.g. "live · waiting for GPS"). */
  status: string;
  /** Frame timestamp (same for both eyes) for animations. */
  timeMs: number;
  /** null = voice disabled. */
  voice: VoiceHud | null;
};

const COLORS = {
  hud: 'rgba(79, 195, 247, 0.95)',
  hudDim: 'rgba(79, 195, 247, 0.55)',
  focus: '#ffc94d',
  text: '#ffffff',
  panel: 'rgba(0, 0, 0, 0.62)',
  shadow: 'rgba(0, 0, 0, 0.8)',
};

const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

/** Global text size multiplier; tune here if text is too big/small in the headset. */
const TEXT_SCALE = 0.8;
const fs = (px: number) => Math.round(px * TEXT_SCALE * 10) / 10;

/** Vertical position of the compass bar (fraction of eye height). The lenses hide the very top. */
const COMPASS_Y = 0.24;
/** Compass bar spans this fraction of the eye width, centered (the lenses hide the edges). */
const COMPASS_WIDTH = 0.7;
/** A plane gets the info card only when it's within this angle of center (15° total cone). */
export const FOCUS_HALF_DEG = 7.5;
/** Card pop-up animation length. */
const CARD_ANIM_MS = 180;

// Tracks when the current focus plane became focused, for the pop-up animation.
let focusAnim: { id: string; since: number } | null = null;

/** Subtitle area for voice: bottom edge of the answer panel (fraction of eye height). */
const VOICE_Y = 0.84;
/** How long the idle "Say Hey Grok" hint stays after start (ms). */
const HINT_MS = 15000;

export function drawHud(ctx: CanvasRenderingContext2D, w: number, h: number, s: HudState): HudResult {
  ctx.clearRect(0, 0, w, h);
  ctx.textBaseline = 'middle';
  const result = drawPlanes(ctx, w, h, s);
  if (s.voice) drawVoice(ctx, w, h, s.voice, s.timeMs);
  return result;
}

function drawPlanes(ctx: CanvasRenderingContext2D, w: number, h: number, s: HudState): HudResult {
  const barY = h * COMPASS_Y;
  const x0 = (w * (1 - COMPASS_WIDTH)) / 2;
  const x1 = w - x0;

  if (s.headingDeg == null) {
    label(ctx, w / 2, barY, 'Waiting for compass…', fs(14), COLORS.text, 'center', true);
    return NO_PLANES;
  }
  const heading = s.headingDeg;
  drawCompass(ctx, w, barY, x0, x1, heading, s.halfTan);

  const half = halfFovDeg(s.halfTan);
  const withOffset = s.planes.map((p) => ({ p, off: signedDiffDeg(p.bearingDeg, heading) }));
  const onBar = withOffset
    .filter((x) => Math.abs(x.off) <= half)
    .map((x) => ({ ...x, x: projectX(x.off, s.halfTan, w) }))
    .filter((x): x is typeof x & { x: number } => x.x != null && x.x >= x0 && x.x <= x1);

  if (s.planes.length === 0) {
    focusAnim = null;
    label(ctx, w / 2, labelRowY(barY) + fs(18), `No planes · ${s.status}`, fs(11), COLORS.text, 'center');
    return NO_PLANES;
  }

  if (onBar.length === 0) {
    focusAnim = null;
    const nearest = withOffset.sort((a, b) => Math.abs(a.off) - Math.abs(b.off))[0];
    if (nearest) drawEdgeArrow(ctx, barY, x0, x1, nearest.p, nearest.off);
    return NO_PLANES;
  }

  const closest = onBar.reduce((a, b) => (Math.abs(b.off) < Math.abs(a.off) ? b : a));
  const focus = Math.abs(closest.off) <= FOCUS_HALF_DEG ? closest : null;
  for (const m of onBar) if (m !== focus) drawDiamond(ctx, m.x, barY, false);
  const inView = onBar.map((m) => ({ ...m.p, offsetDeg: m.off }));

  if (!focus) {
    focusAnim = null;
    return { focus: null, inView };
  }
  if (focusAnim?.id !== focus.p.id) focusAnim = { id: focus.p.id, since: s.timeMs };
  const t = Math.min(1, (s.timeMs - focusAnim.since) / CARD_ANIM_MS);
  drawDiamond(ctx, focus.x, barY, true);
  drawCard(ctx, w, focus.x, barY, cardLines(focus.p), t);
  return { focus: { ...focus.p, offsetDeg: focus.off }, inView };
}

let voiceStartMs: number | null = null;

/** Voice subtitles: status pill, the question, and the answer, stacked up from VOICE_Y. */
function drawVoice(ctx: CanvasRenderingContext2D, w: number, h: number, v: VoiceHud, timeMs: number) {
  voiceStartMs ??= timeMs;
  const maxW = w * 0.78;
  let bottom = h * VOICE_Y;

  if (v.error) {
    label(ctx, w / 2, bottom, v.error, fs(10), '#ff8a80', 'center');
    bottom -= fs(16);
  }

  if (v.answer) {
    ctx.save();
    ctx.font = `500 ${fs(12)}px ${FONT}`;
    const lines = wrapLines(ctx, v.answer, maxW - 16).slice(0, 4);
    const lineH = fs(12) + 4;
    const panelW = Math.min(maxW, Math.max(...lines.map((l) => ctx.measureText(l).width)) + 16);
    const panelH = lines.length * lineH + 10;
    const x = (w - panelW) / 2;
    const y = bottom - panelH;
    ctx.fillStyle = COLORS.panel;
    roundRect(ctx, x, y, panelW, panelH, 6);
    ctx.fill();
    ctx.fillStyle = COLORS.text;
    ctx.textAlign = 'left';
    lines.forEach((l, i) => ctx.fillText(l, x + 8, y + 5 + lineH * (i + 0.5)));
    ctx.restore();
    bottom = y - fs(10);
  }

  if (v.transcript && (v.answer || v.state === 'thinking')) {
    ctx.save();
    ctx.font = `italic 500 ${fs(11)}px ${FONT}`;
    const q = wrapLines(ctx, `“${v.transcript}”`, maxW)[0];
    ctx.restore();
    label(ctx, w / 2, bottom, q, fs(11), 'rgba(255,255,255,0.75)', 'center');
    bottom -= fs(18);
  }

  const pulse = 0.5 + 0.5 * Math.sin(timeMs / 180);
  if (v.state === 'listening') pill(ctx, w / 2, bottom, 'Listening…', `rgba(255, 82, 82, ${0.5 + 0.5 * pulse})`);
  else if (v.state === 'thinking') pill(ctx, w / 2, bottom, `Thinking${'.'.repeat(1 + (Math.floor(timeMs / 300) % 3))}`, COLORS.hud);
  else if (v.state === 'speaking') pill(ctx, w / 2, bottom, 'Grok', COLORS.focus);
  else if (!v.answer && !v.error && timeMs - voiceStartMs < HINT_MS) {
    label(ctx, w / 2, bottom, 'Say “Hey Grok…”', fs(10), 'rgba(255,255,255,0.6)', 'center');
  }
}

/** Small rounded status label with a colored dot. */
function pill(ctx: CanvasRenderingContext2D, cx: number, cy: number, text: string, dot: string) {
  ctx.save();
  ctx.font = `700 ${fs(11)}px ${FONT}`;
  const tw = ctx.measureText(text).width;
  const pw = tw + 26;
  const ph = fs(11) + 8;
  ctx.fillStyle = COLORS.panel;
  roundRect(ctx, cx - pw / 2, cy - ph / 2, pw, ph, ph / 2);
  ctx.fill();
  ctx.fillStyle = dot;
  ctx.beginPath();
  ctx.arc(cx - pw / 2 + 10, cy, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = COLORS.text;
  ctx.textAlign = 'left';
  ctx.fillText(text, cx - pw / 2 + 18, cy);
  ctx.restore();
}

/** Greedy word wrap using the context's current font. */
function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > maxW) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function drawCompass(
  ctx: CanvasRenderingContext2D,
  w: number,
  barY: number,
  x0: number,
  x1: number,
  heading: number,
  halfTan: number,
) {
  const half = halfFovDeg(halfTan);
  const labelY = labelRowY(barY);
  const headingBoxHalfW = fs(22);

  ctx.save();
  ctx.strokeStyle = COLORS.hudDim;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x0, barY);
  ctx.lineTo(x1, barY);
  ctx.stroke();

  // Ticks hang below the bar; labels below the ticks.
  const start = Math.ceil((heading - half) / 5) * 5;
  for (let d = start; d <= heading + half; d += 5) {
    const x = projectX(signedDiffDeg(d, heading), halfTan, w);
    if (x == null || x < x0 || x > x1) continue;
    const deg = normalizeDeg(d);
    const major = deg % 30 === 0;
    ctx.strokeStyle = major ? COLORS.hud : COLORS.hudDim;
    ctx.lineWidth = major ? 2 : 1;
    ctx.beginPath();
    ctx.moveTo(x, barY);
    ctx.lineTo(x, barY + (major ? 6 : deg % 10 === 0 ? 4 : 2));
    ctx.stroke();
    // Skip labels that would collide with the heading readout in the middle.
    if (major && Math.abs(x - w / 2) > headingBoxHalfW + fs(8)) {
      const name = ({ 0: 'N', 90: 'E', 180: 'S', 270: 'W' } as Record<number, string>)[deg] ?? String(deg);
      label(ctx, x, labelY, name, fs(name.length === 1 ? 12 : 10), COLORS.hud, 'center', true);
    }
  }

  // Center mark across the bar + heading readout below it.
  ctx.strokeStyle = COLORS.focus;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(w / 2, barY - 5);
  ctx.lineTo(w / 2, barY + 7);
  ctx.stroke();
  label(ctx, w / 2, labelY, `${Math.round(normalizeDeg(heading))}°`, fs(12), COLORS.focus, 'center', true);
  ctx.restore();
}

function drawDiamond(ctx: CanvasRenderingContext2D, x: number, y: number, focus: boolean) {
  const r = focus ? 7 : 5;
  ctx.save();
  ctx.lineWidth = 2;
  ctx.strokeStyle = focus ? COLORS.focus : COLORS.hud;
  ctx.fillStyle = focus ? 'rgba(255, 201, 77, 0.35)' : 'rgba(0, 0, 0, 0.45)';
  ctx.shadowColor = COLORS.shadow;
  ctx.shadowBlur = 4;
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.lineTo(x + r, y);
  ctx.lineTo(x, y + r);
  ctx.lineTo(x - r, y);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

/** Row below the bar holding the degree labels and heading readout. */
const labelRowY = (barY: number) => barY + fs(15);

/** Info card attached right under the compass, dropping down from it. `t` is animation progress 0..1. */
function drawCard(ctx: CanvasRenderingContext2D, w: number, mx: number, barY: number, lines: string[], t: number) {
  const pad = 6;
  const titleSize = fs(15);
  const bodySize = fs(13);
  const lineGap = 3;
  const ease = 1 - (1 - t) * (1 - t);

  ctx.save();
  ctx.globalAlpha = ease;
  const widths = lines.map((l, i) => {
    ctx.font = `${i === 0 ? 700 : 500} ${i === 0 ? titleSize : bodySize}px ${FONT}`;
    return ctx.measureText(l).width;
  });
  const cardW = Math.min(w - 12, Math.max(...widths) + pad * 2 + 4);
  const cardH = pad * 2 + titleSize + (lines.length - 1) * (bodySize + lineGap);
  const x = Math.max(6, Math.min(w - cardW - 6, mx - cardW / 2));
  const y = labelRowY(barY) + fs(10) - (1 - ease) * 8;

  ctx.fillStyle = COLORS.panel;
  roundRect(ctx, x, y, cardW, cardH, 6);
  ctx.fill();
  // Notch on the card's top edge pointing up at the plane's diamond.
  const nx = Math.max(x + 8, Math.min(x + cardW - 8, mx));
  ctx.fillStyle = COLORS.focus;
  ctx.beginPath();
  ctx.moveTo(nx, y - 5);
  ctx.lineTo(nx - 5, y);
  ctx.lineTo(nx + 5, y);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = COLORS.focus;
  ctx.fillRect(x, y + 5, 3, cardH - 10);

  let ty = y + pad + titleSize / 2;
  lines.forEach((l, i) => {
    const size = i === 0 ? titleSize : bodySize;
    if (i > 0) ty += (i === 1 ? titleSize / 2 : bodySize / 2) + lineGap + size / 2;
    ctx.font = `${i === 0 ? 700 : 500} ${size}px ${FONT}`;
    ctx.fillStyle = i === 0 ? COLORS.text : 'rgba(255,255,255,0.85)';
    ctx.textAlign = 'left';
    ctx.fillText(l, x + pad + 4, ty, cardW - pad * 2 - 4);
  });
  ctx.restore();
}

/** When nothing is on the bar: arrow at the bar's end toward the plane with the smallest turn. */
function drawEdgeArrow(ctx: CanvasRenderingContext2D, barY: number, x0: number, x1: number, p: Plane, off: number) {
  const left = off < 0;
  const tip = left ? x0 - 4 : x1 + 4;
  const back = left ? tip + 9 : tip - 9;
  ctx.save();
  ctx.fillStyle = COLORS.focus;
  ctx.shadowColor = COLORS.shadow;
  ctx.shadowBlur = 4;
  ctx.beginPath();
  ctx.moveTo(tip, barY);
  ctx.lineTo(back, barY - 6);
  ctx.lineTo(back, barY + 6);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  const text = `${flightLabel(p)} · ${Math.round(Math.abs(off))}°`;
  label(ctx, left ? x0 + 2 : x1 - 2, labelRowY(barY) + fs(16), text, fs(12), COLORS.text, left ? 'left' : 'right', true);
}

function label(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  text: string,
  size: number,
  color: string,
  align: CanvasTextAlign,
  bold = false,
) {
  ctx.save();
  ctx.font = `${bold ? 700 : 600} ${size}px ${FONT}`;
  ctx.textAlign = align;
  ctx.fillStyle = color;
  ctx.shadowColor = COLORS.shadow;
  ctx.shadowBlur = 3;
  ctx.fillText(text, x, y);
  ctx.restore();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
