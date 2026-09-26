// Text shown for a plane on the HUD.

import type { Plane } from './planes';

/** ICAO airline prefix -> IATA code, so "DAL1234" displays as "DL 1234". Common US carriers only. */
const AIRLINE_IATA: Record<string, string> = {
  DAL: 'DL',
  AAL: 'AA',
  UAL: 'UA',
  SWA: 'WN',
  JBU: 'B6',
  NKS: 'NK',
  FFT: 'F9',
  ASA: 'AS',
  AAY: 'G4',
  SKW: 'OO',
  EDV: '9E',
  ENY: 'MQ',
  RPA: 'YX',
  JIA: 'OH',
  UPS: '5X',
  FDX: 'FX',
  BAW: 'BA',
  AFR: 'AF',
  DLH: 'LH',
  KLM: 'KL',
  VIR: 'VS',
  ACA: 'AC',
};

/** Short identifier: "DL 1234", else raw callsign, else registration, else hex id. */
export function flightLabel(p: Plane): string {
  const cs = p.callsign?.trim();
  if (!cs) return p.registration ?? p.id.toUpperCase();
  const m = /^([A-Z]{3})(\d+[A-Z]?)$/.exec(cs);
  if (m && AIRLINE_IATA[m[1]]) return `${AIRLINE_IATA[m[1]]} ${m[2]}`;
  return cs;
}

/**
 * Info card: a compact 3-line notification attached under the compass bar.
 *   DL 1234 · Delta Air Lines
 *   Airbus A321-200 · LGA → ATL
 *   4,200 ft · 180 kt · 8.4 km
 * Missing fields are dropped.
 */
export function cardLines(p: Plane): string[] {
  const title = [flightLabel(p), p.airline].filter(Boolean).join(' · ');
  const route = p.origin || p.destination ? `${p.origin ?? '?'} → ${p.destination ?? '?'}` : null;
  const type = [p.typeName ?? p.typeCode ?? 'Unknown aircraft', route].filter(Boolean).join(' · ');
  const stats = [
    p.altitudeFt != null ? `${Math.round(p.altitudeFt).toLocaleString('en-US')} ft` : null,
    p.groundSpeedKt != null ? `${Math.round(p.groundSpeedKt)} kt` : null,
    `${p.distanceKm.toFixed(1)} km`,
  ]
    .filter(Boolean)
    .join(' · ');
  return [title, type, stats];
}
