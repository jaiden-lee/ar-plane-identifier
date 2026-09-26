// Per-frame HUD drawn on a canvas. The same draw call runs once per eye so both eyes
// always show identical content (required for the two images to fuse in the headset).
//
// Everything hangs off one "headband" compass bar near the top of the view:
//   on the bar:    a diamond per plane at its bearing, center mark
//   below the bar: degree ticks/labels, current heading
//   right under that: info card for the focused plane, attached to the compass
//                  (drops down like a notification)
// The middle of the view stays clear.

import { cardLines, flightLabel } from './format';
import { halfFovDeg, normalizeDeg, projectX, signedDiffDeg } from './geo';
import type { Plane } from './planes';

export type HudState = {
  headingDeg: number | null;
  /** tan(half horizontal FOV) of what one eye shows. */
  halfTan: number;
  planes: Plane[];
  /** Data feed status, shown when there are no planes at all (e.g. "live · waiting for GPS"). */
  status: string;
  /** Frame timestamp (same for both eyes) for animations. */
  timeMs: number;
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

export function drawHud(ctx: CanvasRenderingContext2D, w: number, h: number, s: HudState): void {
  ctx.clearRect(0, 0, w, h);
  ctx.textBaseline = 'middle';
  const barY = h * COMPASS_Y;
  const x0 = (w * (1 - COMPASS_WIDTH)) / 2;
  const x1 = w - x0;

  if (s.headingDeg == null) {
    label(ctx, w / 2, barY, 'Waiting for compass…', fs(14), COLORS.text, 'center', true);
    return;
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
    return;
  }

  if (onBar.length === 0) {
    focusAnim = null;
    const nearest = withOffset.sort((a, b) => Math.abs(a.off) - Math.abs(b.off))[0];
    if (nearest) drawEdgeArrow(ctx, barY, x0, x1, nearest.p, nearest.off);
    return;
  }

  const closest = onBar.reduce((a, b) => (Math.abs(b.off) < Math.abs(a.off) ? b : a));
  const focus = Math.abs(closest.off) <= FOCUS_HALF_DEG ? closest : null;
  for (const m of onBar) if (m !== focus) drawDiamond(ctx, m.x, barY, false);

  if (!focus) {
    focusAnim = null;
    return;
  }
  if (focusAnim?.id !== focus.p.id) focusAnim = { id: focus.p.id, since: s.timeMs };
  const t = Math.min(1, (s.timeMs - focusAnim.since) / CARD_ANIM_MS);
  drawDiamond(ctx, focus.x, barY, true);
  drawCard(ctx, w, focus.x, barY, cardLines(focus.p), t);
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
