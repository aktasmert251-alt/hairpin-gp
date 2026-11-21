// STUB (Sprint 0, Yönetici): replaced by Çevre in Sprint 1
// Placeholder oval, anti-clockwise like İstanbul: two 400 m straights joined by two semicircles.
// R = 597 / 2π ≈ 95.02 m so the lap is exactly 1397 m (ds = 1 holds exactly). Flat, half-width 7 m,
// walls at ±18 m. S/F (s = 0) is mid-way along the main straight, heading +X (east); left = infield.
// No pit lane: PitLaneData is empty (count 0, no boxes, split/merge = -1) and pitWorldFromSD maps onto
// the main ribbon. Sectors start at L/3 and 2L/3; one DRS zone on the main straight; 20 grid slots.

import type { TrackBundle, TrackData } from '../../contracts/track';
import { buildSegmentTrack } from './segmentTrack';

export const OVAL_LENGTH = 1397;
export const OVAL_RADIUS = (OVAL_LENGTH - 800) / (2 * Math.PI);
export const OVAL_HALF_WIDTH = 7;
export const OVAL_WALL_OFFSET = 18;

export function createOvalTrack(): TrackBundle {
  const L = OVAL_LENGTH;
  const R = OVAL_RADIUS;
  const half = Math.PI * R;
  const grid: TrackData['grid'] = [];
  for (let k = 0; k < 20; k++) grid.push({ s: L - 12 - 8 * k, d: k % 2 === 0 ? 2.4 : -2.4 });
  return buildSegmentTrack({
    id: 'oval',
    name: { tr: 'Test Ovali (yer tutucu)', en: 'Test Oval (placeholder)' },
    segments: [
      { kind: 'straight', len: 200 },
      { kind: 'arc', radius: R, angle: Math.PI, dir: 1 },
      { kind: 'straight', len: 400 },
      { kind: 'arc', radius: R, angle: Math.PI, dir: 1 },
      { kind: 'straight', len: 200 },
    ],
    closed: true,
    halfWidth: OVAL_HALF_WIDTH,
    lineWidth: 0.12,
    wallOffset: OVAL_WALL_OFFSET,
    sectors: [L / 3, (2 * L) / 3],
    timingLines: [
      { kind: 'finish', s: 0, ref: 0 },
      { kind: 'sector2', s: L / 3, ref: 0 },
      { kind: 'sector3', s: (2 * L) / 3, ref: 0 },
      { kind: 'speedTrap', s: 160, ref: 0 },
      { kind: 'drsDetect', s: L - 300, ref: 0 },
      { kind: 'drsActivate', s: L - 180, ref: 0 },
      { kind: 'drsEnd', s: 170, ref: 0 },
    ],
    drsZones: [{ id: 0, detectS: L - 300, activateS: L - 180, endS: 170 }],
    corners: [
      { n: 1, dir: 'L', entryS: 200, apexS: 200 + half / 2, exitS: 200 + half, minRadius: R },
      { n: 2, dir: 'L', entryS: 600 + half, apexS: 600 + 1.5 * half, exitS: 600 + 2 * half, minRadius: R },
    ],
    grid,
    startGantryS: 0,
  });
}
