// Sim layer: Desert Cliff authoring table (docs/design/tracks-cliff.md). Every s is on the authored fillet-polygon basis
// of 7,233 m (cliff-ctrl.ts) and is rescaled to the built length. Anti-clockwise; the pit and the pole are on the left
// (inland, away from the escarpment). Signature: the start straight climbs a 70 m ramp to T1, the T1–T2 platform hangs
// over the cliff edge, the plunge drops back to the plateau; later the lap descends into the canyon and climbs out.

import { RAMP } from './cliff-ctrl';
import type { CornerDef, TrackAuthoring } from './types';

type Wall = CornerDef['outsideWall'];
const C = (n: number, dir: 'L' | 'R', entry: number, apex: number, exit: number, vApex: number, runoff: CornerDef['runoff'], outsideWall: Wall,
  o: Partial<CornerDef> = {}): CornerDef =>
  ({ n, dir, entry, apexes: [apex], exit, vApex, bankDeg: 0, runoff, outsideWall, sausage: false, minClear: 0, cutZone: false, ...o });

const CORNERS: readonly CornerDef[] = [
  // The ramp: T1 at the 70 m crest (braking uphill), the T2 hairpin on the cantilevered platform over the escarpment.
  C(1, 'R', 958, 997, 1036, 110, 'asphalt', 'tecpro', { runoffW: 12, cutZone: true }),
  C(2, 'L', 1134, 1178, 1221, 65, 'asphalt', 'tecpro', { runoffW: 12 }),
  // The plunge: a fast downhill left at 14 %.
  C(3, 'L', 1699, 1766, 1832, 210, 'gravel', 'tecpro', { runoffW: 30 }),
  // Plateau infield: the left onto the entertainment boulevard, the right-right-left complex.
  C(4, 'L', 2204, 2256, 2307, 130, 'gravel', 'tyres'),
  C(5, 'R', 2418, 2450, 2483, 135, 'painted', 'tyres', { sausage: true, cutZone: true }),
  C(6, 'R', 2595, 2620, 2644, 150, 'painted', 'tyres', { sausage: true, cutZone: true }),
  C(7, 'L', 2695, 2734, 2773, 120, 'gravel', 'tyres'),
  // Northern sweepers.
  C(8, 'L', 3097, 3147, 3197, 220, 'asphalt', 'armco', { runoffW: 18 }),
  C(9, 'R', 3455, 3515, 3574, 215, 'asphalt', 'armco', { runoffW: 18 }),
  C(10, 'L', 3871, 3911, 3951, 250, 'asphalt', 'armco', { runoffW: 14 }),
  // End of the back straight: heavy braking into the canyon descent.
  C(11, 'L', 4484, 4526, 4568, 105, 'painted', 'tecpro', { gravelFrom: 4580, minClear: 18, cutZone: true }),
  C(12, 'L', 4780, 4824, 4867, 150, 'gravel', 'tyres'),
  C(13, 'R', 5008, 5066, 5124, 135, 'gravel', 'tyres'),
  C(14, 'L', 5289, 5332, 5374, 125, 'gravel', 'tyres'),
  C(15, 'R', 5501, 5544, 5587, 110, 'gravel', 'tyres'),
  C(16, 'L', 5773, 5807, 5840, 100, 'gravel', 'tyres'),
  // Canyon floor: the tight left at −38 m, then the climb out.
  C(17, 'L', 6031, 6067, 6102, 85, 'painted', 'tecpro', { gravelFrom: 6110, minClear: 16, cutZone: true }),
  C(18, 'R', 6363, 6414, 6464, 180, 'gravel', 'armco'),
  C(19, 'L', 6531, 6601, 6671, 150, 'gravel', 'armco'),
  C(20, 'L', 6717, 6749, 6780, 150, 'gravel', 'tyres'),
  C(21, 'R', 6876, 6918, 6959, 105, 'painted', 'tecpro', { gravelFrom: 6965, cutZone: true }),
];

export const CLIFF: TrackAuthoring = {
  id: 'cliff',
  name: { tr: 'Çöl Uçurumu Circuit', en: 'Desert Cliff Circuit' },
  OSM_LENGTH: 7233,
  CORNERS,
  WIDTHS: [
    { from: 0, to: 7233, hw: 7.5 },
    { from: 6960, to: 300, hw: 8.5 },
    { from: 900, to: 1260, hw: 9 },
    // T11 (end of the back straight): room for two lines through the lap-1 braking zone.
    { from: 4420, to: 4650, hw: 9 },
  ],
  WIDTH_BLEND: 40,
  ELEVATION_SIGMA: 15,
  ELEVATION_MEDIAN: 0,
  SECTOR2_S: 2300,
  SECTOR3_S: 4900,
  SPEED_TRAP_S: 850,
  DRS_ZONES: [
    { id: 0, detect: 6700, activate: 7000, end: 900 },
    { id: 1, detect: 1100, activate: 1300, end: 1640 },
    { id: 2, detect: 3850, activate: 4000, end: 4430 },
  ],
  PIT: {
    limitStartSp: 150,
    limitEndSp: 620,
    speedLimitKmh: 80,
    // All ten boxes before the S/F line (the last one 30 m short of it).
    firstBoxSp: 200,
    boxSpacing: 26,
    fastLaneMainD: 14.5,
    workingLaneMainD: 20,
    garageFrontMainD: 24.5,
    pitWallFaceMainD: 11.5,
    pitWallThickness: 0.5,
    wideHalfWidth: 5.25,
    narrowHalfWidth: 3.5,
    straightFrom: 6960,
    straightTo: 120,
    endBlend: 30,
    side: 1,
  },
  GRID: { first: 12, spacing: 8, d: 2.4, slots: 20, poleSide: 1 },
  VERGE: { straight: 4, mainStraightOpp: 8, mainStraightFrom: 6960, mainStraightTo: 300, inside: 3, base: 'concrete' },
  KERB: { inside: 1.2, exit: 1.8, astroturf: 0, sausage: 0.4, sausageGap: 2.5, gravelAsphalt: 3 },
  DECKS: [
    { from: RAMP.from + 40, to: RAMP.up - 30, wallD: 2.5, kind: 'concrete' },
    { from: RAMP.up - 30, to: RAMP.platformTo + 30 },
    { from: RAMP.platformTo + 30, to: RAMP.to - 40, wallD: 2.5, kind: 'concrete' },
  ],
  SPECTATOR_WALLS: [
    { from: 6960, to: 300, side: -1 },
    { from: 900, to: 1260, side: 1 },
    { from: 900, to: 1260, side: -1 },
    { from: 4440, to: 4600, side: -1 },
    { from: 5990, to: 6120, side: -1 },
  ],
  // Glass grandstands on the cliff side of the start straight, over the T11 braking zone and the canyon hairpin.
  STANDS: [
    { from: 7000, to: 7200, side: -1, setback: 12, depth: 22, kind: 'grandstand' },
    { from: 30, to: 230, side: -1, setback: 12, depth: 22, kind: 'grandstand' },
    // The big glass grandstand facing the ramp foot (cliff side).
    { from: 250, to: 450, side: -1, setback: 14, depth: 26, kind: 'grandstand' },
    { from: 4380, to: 4480, side: -1, setback: 26, depth: 16, kind: 'grandstand' },
    { from: 5960, to: 6040, side: -1, setback: 24, depth: 14, kind: 'bleachers' },
  ],
  PUDDLES: [
    { s: 4520, d: -4, len: 14, width: 2.2 },
    { s: 6060, d: 4, len: 12, width: 2.0 },
    { s: 6915, d: 4, len: 12, width: 2.0 },
  ],
  EXTRA_WALLS: [],
  TRACKSIDE: {
    boardStraights: [
      { from: 6990, to: 280, side: -1 },
      { from: 3990, to: 4440, side: 1 },
      { from: 3990, to: 4440, side: -1 },
      { from: 2800, to: 3080, side: 1 },
    ],
    gantries: [3700, 5200],
    distanceBoardCorners: [{ n: 11, side: -1 }, { n: 17, side: -1 }, { n: 21, side: 1 }],
    wordmarkCorners: [11, 17],
  },
  HIDE_FEATURES: [],
  THEME: {
    ground: 'desert',
    forestMix: [1, 0, 0, 0, 0],
    forestSpacing: 10,
    openTreeSpacing: 26,
    openMix: [1, 0, 0, 0, 0],
    treeSetback: 14,
    maxTrees: 6000,
    // Floods on both sides every 28 m, including the ramp (poles stand on the deck edge there; floodlights.ts).
    lights: { height: 22, spacing: 28, bothSides: true, head: 'flood' },
    backdrop: 'desert',
    sea: null,
  },
};
