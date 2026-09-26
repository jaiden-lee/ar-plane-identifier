// Plane data: the shared fixture (works with no backend) or Wesley's flight-service.

import fixture from '../../shared/fixtures/demo-planes.json';

/** Mirrors the `Plane` contract in CLAUDE.md. */
export type Plane = {
  id: string;
  callsign: string | null;
  registration: string | null;
  typeCode: string | null;
  typeName: string | null;
  airline: string | null;
  origin: string | null;
  destination: string | null;
  lat: number;
  lon: number;
  altitudeFt: number | null;
  groundSpeedKt: number | null;
  trackDeg: number | null;
  distanceKm: number;
  bearingDeg: number;
  offsetDeg?: number;
};

export type LatLon = { lat: number; lon: number };

export type FlightsResponse = {
  center: LatLon;
  demo: boolean;
  fetchedAt: string;
  planes: Plane[];
};

export type FeedState = {
  planes: Plane[];
  /** Short human-readable status for the debug line, e.g. "fixture" or "live · offline". */
  status: string;
};

export type PlaneFeed = {
  get: () => FeedState;
  stop: () => void;
};

const FIXTURE = fixture as unknown as FlightsResponse;
export const FIXTURE_CENTER: LatLon = FIXTURE.center;

/** Static planes from shared/fixtures/demo-planes.json. Bearings are relative to the fixture center. */
export function startFixtureFeed(): PlaneFeed {
  const state: FeedState = { planes: FIXTURE.planes, status: 'fixture' };
  return { get: () => state, stop: () => {} };
}

const POLL_MS = 2000;

/**
 * Polls GET /api/flights/nearby. Always asks for fovDeg=360: the web app does the per-frame
 * cone filter itself (labels, off-screen arrows), so it needs every plane in range.
 * On failure it keeps showing the last good data.
 */
export function startLiveFeed(opts: {
  demo: boolean;
  radiusKm: number;
  getPosition: () => LatLon | null;
  getHeading: () => number | null;
}): PlaneFeed {
  const state: FeedState = { planes: [], status: 'live · connecting' };
  let stopped = false;
  let timer = 0;

  async function poll() {
    const pos = opts.demo ? FIXTURE_CENTER : opts.getPosition();
    if (!pos) {
      state.status = 'live · waiting for GPS';
    } else {
      const params = new URLSearchParams({
        lat: pos.lat.toFixed(5),
        lon: pos.lon.toFixed(5),
        fovDeg: '360',
        radiusKm: String(opts.radiusKm),
        demo: opts.demo ? '1' : '0',
      });
      const heading = opts.getHeading();
      if (heading != null) params.set('heading', heading.toFixed(1));
      try {
        const res = await fetch(`/api/flights/nearby?${params}`);
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as FlightsResponse;
        state.planes = data.planes;
        state.status = `live${data.demo ? ' demo' : ''} · ${data.planes.length} planes`;
      } catch {
        state.status = `live · offline (${state.planes.length} cached)`;
      }
    }
    if (!stopped) timer = window.setTimeout(poll, POLL_MS);
  }

  poll();
  return {
    get: () => state,
    stop: () => {
      stopped = true;
      clearTimeout(timer);
    },
  };
}

/** Continuous GPS position, or null until the first fix. */
export function watchPosition(): { get: () => LatLon | null; stop: () => void } {
  let pos: LatLon | null = null;
  if (!navigator.geolocation) return { get: () => null, stop: () => {} };
  const id = navigator.geolocation.watchPosition(
    (p) => (pos = { lat: p.coords.latitude, lon: p.coords.longitude }),
    () => {},
    { enableHighAccuracy: true, maximumAge: 10_000 },
  );
  return { get: () => pos, stop: () => navigator.geolocation.clearWatch(id) };
}
