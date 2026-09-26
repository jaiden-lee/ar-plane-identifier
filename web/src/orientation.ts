// Which way the rear camera is pointing: compass heading (true north) + pitch.
//
// The rear camera looks along the device's -Z axis. Given the rotation R that maps
// device coordinates to earth coordinates (East, North, Up), the camera direction in
// earth coordinates is -(third column of R). Heading = atan2(East, North).
// This works in any phone orientation (portrait, landscape, crooked in a headset),
// unlike the raw `alpha` value, which follows the top edge of the phone.

import { normalizeDeg, toDeg, toRad } from './geo';

/** Atlanta magnetic declination (~5.3° W). true heading = magnetic heading + declination. */
export const MAG_DECLINATION_DEG = -5.3;

/** Per-sample smoothing factor (0..1). Lower = smoother but laggier. */
const SMOOTHING = 0.2;

export type OrientationSource = 'sensor' | 'absolute-event' | 'relative-event' | 'none';

export type OrientationReading = {
  headingDeg: number;
  pitchDeg: number;
  source: OrientationSource;
};

export type OrientationTracker = {
  get: () => OrientationReading | null;
  stop: () => void;
};

type Vec3 = [number, number, number];

/** Quaternion [x, y, z, w] (device -> earth) to camera direction. */
function cameraVectorFromQuaternion([x, y, z, w]: number[]): Vec3 {
  return [-2 * (x * z + w * y), -2 * (y * z - w * x), -(1 - 2 * (x * x + y * y))];
}

/** W3C DeviceOrientation Euler angles (R = Rz(alpha) Rx(beta) Ry(gamma)) to camera direction. */
function cameraVectorFromEuler(alpha: number, beta: number, gamma: number): Vec3 {
  const [sA, cA] = [Math.sin(toRad(alpha)), Math.cos(toRad(alpha))];
  const [sB, cB] = [Math.sin(toRad(beta)), Math.cos(toRad(beta))];
  const [sG, cG] = [Math.sin(toRad(gamma)), Math.cos(toRad(gamma))];
  return [-(cA * sG + sA * sB * cG), -(sA * sG - cA * sB * cG), -(cB * cG)];
}

/** iOS only: motion access must be requested from a user gesture. Call first thing in the tap handler. */
export async function requestOrientationPermission(): Promise<void> {
  const DOE = (window as any).DeviceOrientationEvent;
  if (typeof DOE?.requestPermission === 'function') {
    try {
      await DOE.requestPermission();
    } catch {
      // Denied; the tracker will just report no data.
    }
  }
}

/**
 * Prefers the AbsoluteOrientationSensor (quaternion, Android Chrome), falls back to
 * `deviceorientationabsolute` events. `?orient=event` forces the event path for debugging.
 */
export function startOrientation(forceEvents = false): OrientationTracker {
  let smoothed: Vec3 | null = null;
  let source: OrientationSource = 'none';
  let stopFn = () => {};

  const push = (v: Vec3, src: OrientationSource) => {
    source = src;
    // Smooth the direction vector (not the angle) so 359° -> 0° doesn't jump.
    smoothed = smoothed
      ? [
          smoothed[0] + (v[0] - smoothed[0]) * SMOOTHING,
          smoothed[1] + (v[1] - smoothed[1]) * SMOOTHING,
          smoothed[2] + (v[2] - smoothed[2]) * SMOOTHING,
        ]
      : v;
  };

  const useEvents = () => {
    const type = 'ondeviceorientationabsolute' in window ? 'deviceorientationabsolute' : 'deviceorientation';
    const handler = (e: DeviceOrientationEvent) => {
      if (e.alpha == null || e.beta == null || e.gamma == null) return;
      push(cameraVectorFromEuler(e.alpha, e.beta, e.gamma), e.absolute ? 'absolute-event' : 'relative-event');
    };
    window.addEventListener(type, handler as EventListener);
    stopFn = () => window.removeEventListener(type, handler as EventListener);
  };

  const Sensor = (window as any).AbsoluteOrientationSensor;
  if (Sensor && !forceEvents) {
    try {
      const sensor = new Sensor({ frequency: 60, referenceFrame: 'device' });
      sensor.addEventListener('reading', () => push(cameraVectorFromQuaternion(sensor.quaternion), 'sensor'));
      sensor.addEventListener('error', () => {
        sensor.stop();
        useEvents();
      });
      sensor.start();
      stopFn = () => sensor.stop();
    } catch {
      useEvents();
    }
  } else {
    useEvents();
  }

  return {
    get() {
      if (!smoothed) return null;
      const [e, n, u] = smoothed;
      const len = Math.hypot(e, n, u) || 1;
      return {
        headingDeg: normalizeDeg(toDeg(Math.atan2(e, n)) + MAG_DECLINATION_DEG),
        pitchDeg: toDeg(Math.asin(Math.max(-1, Math.min(1, u / len)))),
        source,
      };
    },
    stop: () => stopFn(),
  };
}
