// Angle helpers and the camera projection used to place labels.
// Conventions (see CLAUDE.md): degrees, clockwise from true north, [0, 360).

export const toRad = (d: number) => (d * Math.PI) / 180;
export const toDeg = (r: number) => (r * 180) / Math.PI;

export const normalizeDeg = (d: number) => ((d % 360) + 360) % 360;

/** Signed angle from `from` to `target` in (-180, 180]. Negative = target is to the left. */
export const signedDiffDeg = (target: number, from: number) => ((((target - from + 540) % 360) + 360) % 360) - 180;

/**
 * tan(horizontal half-FOV) of what one eye actually shows.
 * Starts from the phone's main camera at 1x, divides by hardware zoom, then accounts for
 * `object-fit: cover` cropping the sides when the eye is narrower than the stream.
 */
export function visibleHalfTan(
  baseHalfTan1x: number,
  zoom: number,
  eyeAspect: number,
  streamAspect: number,
  fovScale: number,
): number {
  const crop = Math.min(1, eyeAspect / streamAspect);
  return (baseHalfTan1x / zoom) * crop * fovScale;
}

export const halfFovDeg = (halfTan: number) => toDeg(Math.atan(halfTan));

/** Pinhole projection of a horizontal angle off-center to an x coordinate in an eye of `width`. */
export function projectX(offsetDeg: number, halfTan: number, width: number): number | null {
  if (Math.abs(offsetDeg) >= 89) return null;
  return width / 2 + (Math.tan(toRad(offsetDeg)) / halfTan) * (width / 2);
}
