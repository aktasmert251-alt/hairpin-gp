// Sim layer: Bosphorus authoring table (tracks.md §3). Every s is on the authored fillet-polygon basis of 4,978.2 m
// (bosphorus-ctrl.ts) and is rescaled to the built length. Anti-clockwise street circuit; the pit and the pole are on
// the left (inland). Walls everywhere: concrete blocks + debris fence, tecpro on the impact faces, two escape pockets.

import type { CornerDef, TrackAuthoring } from './types';

const C = (n: number, dir: 'L' | 'R', entry: number, apex: number, exit: number, vApex: number, wall: 'concrete' | 'tecpro', wallD: number, cutZone = false): CornerDef =>
  ({ n, dir, entry, apexes: [apex], exit, vApex, bankDeg: 0, runoff: 'asphalt', outsideWall: wall, sausage: false, minClear: 0, cutZone, runoffW: 0, wallD });

const CORNERS: readonly CornerDef[] = [
  C(1, 'L', 928, 945, 963, 85, 'tecpro', 2.5),
  C(2, 'R', 1071, 1094, 1118, 100, 'concrete', 2.5),
  C(3, 'L', 1263, 1282, 1302, 90, 'tecpro', 2.5),
  C(4, 'L', 1477, 1508, 1540, 120, 'tecpro', 3),
  C(5, 'L', 1769, 1799, 1828, 200, 'concrete', 3),
  C(6, 'R', 1931, 1960, 1990, 200, 'concrete', 3),
  C(7, 'L', 3179, 3198, 3218, 140, 'tecpro', 2.5),
  C(8, 'R', 3496, 3508, 3520, 150, 'tecpro', 2.5),
  // Waterfront hairpin: 25 m asphalt run-off to a tecpro face.
  { ...C(9, 'L', 3834, 3873, 3913, 70, 'tecpro', 25, true), runoffW: 23 },
  C(10, 'L', 4255, 4267, 4279, 155, 'concrete', 2.5, true),
  C(11, 'R', 4327, 4339, 4350, 155, 'concrete', 2.5, true),
];

export const BOSPHORUS: TrackAuthoring = {
  id: 'bosphorus',
  name: { tr: 'Boğaz Sahil Circuit', en: 'Bosphorus Shore Circuit' },
  OSM_LENGTH: 4978.2,
  CORNERS,
  WIDTHS: [
    { from: 0, to: 4978.2, hw: 6.5 },
    { from: 4350, to: 760, hw: 7.5 },
    { from: 760, to: 930, hw: 8.5 },
    { from: 1540, to: 3180, hw: 7 },
    { from: 3780, to: 3960, hw: 8 },
  ],
  WIDTH_BLEND: 40,
  // Authored y(v) (§3.5) is a 340 m smoothstep: unsmoothed it peaks at 8.8 % on the T3→T4 climb; σ 80 m gives 5.8 %.
  ELEVATION_SIGMA: 80,
  ELEVATION_MEDIAN: 0,
  SECTOR2_S: 1700,
  SECTOR3_S: 3300,
  SPEED_TRAP_S: 800,
  DRS_ZONES: [
    { id: 0, detect: 4300, activate: 4420, end: 780 },
    { id: 1, detect: 1900, activate: 2050, end: 3120 },
  ],
  PIT: {
    limitStartSp: 100,
    limitEndSp: 800,
    speedLimitKmh: 80,
    firstBoxSp: 300,
    boxSpacing: 28,
    fastLaneMainD: 13.5,
    workingLaneMainD: 18.5,
    garageFrontMainD: 23,
    pitWallFaceMainD: 9.5,
    pitWallThickness: 0.5,
    wideHalfWidth: 6,
    narrowHalfWidth: 3.5,
    straightFrom: 4720,
    straightTo: 380,
    endBlend: 60,
    minWallGap: 1.5,
    side: 1,
  },
  GRID: { first: 12, spacing: 8, d: 2.4, slots: 20, poleSide: 1 },
  VERGE: { straight: 2, mainStraightOpp: 2, mainStraightFrom: 4350, mainStraightTo: 760, inside: 1, base: 'concrete' },
  KERB: { inside: 1, exit: 1, astroturf: 0, sausage: 0.4, sausageGap: 2.5, gravelAsphalt: 3 },
  SPECTATOR_WALLS: [],
  DEFAULT_WALL: 'concrete',
  // Escape roads straight on at T1 (along the shore) and T7 (along the ridge): closed asphalt pockets, tecpro ends.
  ESCAPES: [
    { from: 912, to: 975, side: -1, depth: 40, kind: 'tecpro' },
    { from: 3165, to: 3215, side: -1, depth: 34, kind: 'tecpro' },
  ],
  // Pier grandstand on the sea side of the main straight; temporary bleachers after T1, at the T4 crest, before T9.
  STANDS: [
    { from: 4700, to: 200, side: -1, setback: 12, depth: 22, kind: 'grandstand' },
    { from: 985, to: 1050, side: -1, setback: 6, depth: 12, kind: 'bleachers' },
    { from: 1550, to: 1640, side: -1, setback: 6, depth: 12, kind: 'bleachers' },
    { from: 3700, to: 3800, side: -1, setback: 6, depth: 12, kind: 'bleachers' },
  ],
  PUDDLES: [
    { s: 3870, d: -4, len: 14, width: 2.2 },
    { s: 4050, d: 3, len: 16, width: 2.4 },
    { s: 880, d: -4, len: 14, width: 2.2 },
    { s: 1290, d: 3, len: 12, width: 2.0 },
  ],
  EXTRA_WALLS: [],
  TRACKSIDE: {
    boardStraights: [
      { from: 4420, to: 860, side: -1 },
      { from: 2060, to: 3140, side: 1 },
      { from: 2060, to: 3140, side: -1 },
    ],
    gantries: [600, 2600],
    distanceBoardCorners: [{ n: 1, side: -1 }, { n: 7, side: -1 }, { n: 9, side: -1 }],
    wordmarkCorners: [],
  },
  HIDE_FEATURES: [],
  THEME: {
    ground: 'urban',
    forestMix: [0.2, 0.1, 0, 0.7],
    forestSpacing: 8,
    openTreeSpacing: 0,
    openMix: [0, 0, 0, 1],
    treeSetback: 4,
    maxTrees: 4000,
    lights: { height: 10, spacing: 25, bothSides: true, head: 'street' },
    backdrop: 'city',
    sea: { y: -2 },
    // Plane trees every 12 m along the ridge boulevard (both sides) and the promenade (sea side of the main straight).
    streetTrees: [
      { from: 2000, to: 3150, side: 1, d: 5, spacing: 12 },
      { from: 2000, to: 3150, side: -1, d: 5, spacing: 12 },
      { from: 4380, to: 900, side: -1, d: 6, spacing: 12 },
    ],
  },
};
