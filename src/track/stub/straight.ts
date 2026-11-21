// STUB (Sprint 0, Yönetici): replaced by Çevre in Sprint 1
// Flat straight test track for physics benches: starts at the origin heading +X (east), half-width 12 m,
// walls at ±30 m. Open line: project()/ground() extrapolate s beyond both ends (s < 0 or s > length);
// wrapS/deltaS still work modulo the length. No pit lane, no DRS zones.

import type { TrackBundle, TrackData } from '../../contracts/track';
import { buildSegmentTrack } from './segmentTrack';

export function createStraightTrack(lengthM: number): TrackBundle {
  const L = Math.max(100, lengthM);
  const base = Math.min(200, L * 0.25);
  const grid: TrackData['grid'] = [];
  for (let k = 0; k < 20; k++) grid.push({ s: Math.max(1, base - 8 * k), d: k % 2 === 0 ? 2.4 : -2.4 });
  return buildSegmentTrack({
    id: 'straight',
    name: { tr: 'Düz test pisti', en: 'Straight test track' },
    segments: [{ kind: 'straight', len: L }],
    closed: false,
    halfWidth: 12,
    lineWidth: 0.12,
    wallOffset: 30,
    sectors: [L / 3, (2 * L) / 3],
    timingLines: [
      { kind: 'finish', s: 0, ref: 0 },
      { kind: 'sector2', s: L / 3, ref: 0 },
      { kind: 'sector3', s: (2 * L) / 3, ref: 0 },
    ],
    drsZones: [],
    corners: [],
    grid,
    startGantryS: 0,
  });
}
