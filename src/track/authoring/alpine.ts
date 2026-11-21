// Sim layer: Alpine Pass authoring table (docs/design/tracks-alpine.md). Every s is on the authored fillet-polygon basis
// of 5,649 m (alpine-ctrl.ts) and is rescaled to the built length. Clockwise; the pit and the pole are on the right
// (inside of the loop, away from the lake). Mountain circuit: lake straight, climbing esses, a bored tunnel, the summit
// crest, a blind descent, the valley hairpin and a technical section back to the lake.

import { TUNNEL } from './alpine-ctrl';
import type { CornerDef, TrackAuthoring } from './types';

type Wall = CornerDef['outsideWall'];
const C = (n: number, dir: 'L' | 'R', entry: number, apex: number, exit: number, vApex: number, runoff: CornerDef['runoff'], outsideWall: Wall,
  o: Partial<CornerDef> = {}): CornerDef =>
  ({ n, dir, entry, apexes: [apex], exit, vApex, bankDeg: 0, runoff, outsideWall, sausage: false, minClear: 0, cutZone: false, ...o });

const CORNERS: readonly CornerDef[] = [
  // End of the lake straight: heavy stop, the first overtaking spot.
  C(1, 'R', 505, 553, 600, 95, 'painted', 'tecpro', { gravelFrom: 600, minClear: 18, cutZone: true }),
  C(2, 'L', 745, 795, 845, 150, 'gravel', 'armco', { runoffW: 14 }),
  // Climbing esses: fast, armco close behind a short asphalt apron.
  C(3, 'R', 990, 1070, 1150, 230, 'asphalt', 'armco', { runoffW: 12 }),
  C(4, 'L', 1250, 1323, 1395, 235, 'asphalt', 'armco', { runoffW: 12 }),
  C(5, 'R', 1500, 1578, 1655, 225, 'gravel', 'armco', { runoffW: 14 }),
  // Uphill switchback under the cliff.
  C(6, 'R', 1750, 1802, 1850, 100, 'gravel', 'tyres', { bankDeg: 2, runoffW: 14 }),
  // Blind summit crest after the tunnel, the long downhill right, the compression at the foot of the descent.
  C(7, 'L', 2635, 2690, 2745, 285, 'asphalt', 'armco', { runoffW: 10 }),
  C(8, 'R', 2830, 2958, 3085, 250, 'gravel', 'tecpro', { bankDeg: 1.5, runoffW: 30 }),
  C(9, 'L', 3335, 3403, 3470, 190, 'gravel', 'tyres', { runoffW: 18 }),
  // Valley hairpin: heaviest braking of the lap.
  C(10, 'R', 4095, 4157, 4220, 70, 'painted', 'tecpro', { gravelFrom: 4230, bankDeg: 2, minClear: 20, cutZone: true }),
  // Technical section back down to the lake.
  C(11, 'L', 4370, 4418, 4465, 120, 'gravel', 'tyres'),
  C(12, 'R', 4610, 4651, 4690, 115, 'gravel', 'tyres', { cutZone: true }),
  C(13, 'L', 4805, 4847, 4890, 135, 'gravel', 'tyres', { cutZone: true }),
  C(14, 'R', 5015, 5064, 5110, 165, 'gravel', 'armco'),
  // Fast kink onto the lake straight (the pit lane cuts inside it).
  C(15, 'R', 5260, 5302, 5345, 260, 'asphalt', 'armco', { runoffW: 10 }),
];

export const ALPINE: TrackAuthoring = {
  id: 'alpine',
  name: { tr: 'Alp Dağ Geçidi', en: 'Alpine Pass Circuit' },
  OSM_LENGTH: 5649,
  CORNERS,
  WIDTHS: [
    { from: 0, to: 5649, hw: 7 },
    { from: 5330, to: 480, hw: 8 },
    { from: 480, to: 640, hw: 8 },
    { from: 1990, to: 2260, hw: 6.5 },
    { from: 4040, to: 4260, hw: 8.5 },
  ],
  WIDTH_BLEND: 40,
  ELEVATION_SIGMA: 40,
  ELEVATION_MEDIAN: 0,
  SECTOR2_S: 1834,
  SECTOR3_S: 3454,
  SPEED_TRAP_S: 450,
  DRS_ZONES: [
    { id: 0, detect: 5150, activate: 5360, end: 480 },
    { id: 1, detect: 3300, activate: 3480, end: 4080 },
  ],
  PIT: {
    limitStartSp: 170,
    limitEndSp: 680,
    speedLimitKmh: 80,
    firstBoxSp: 270,
    boxSpacing: 32,
    fastLaneMainD: 14.5,
    workingLaneMainD: 20,
    garageFrontMainD: 24.5,
    pitWallFaceMainD: 11.5,
    pitWallThickness: 0.5,
    wideHalfWidth: 5.25,
    narrowHalfWidth: 3.5,
    straightFrom: 5340,
    straightTo: 150,
    endBlend: 30,
    side: -1,
  },
  GRID: { first: 12, spacing: 8, d: 2.4, slots: 20, poleSide: -1 },
  VERGE: { straight: 4, mainStraightOpp: 6, mainStraightFrom: 5330, mainStraightTo: 480, inside: 3 },
  KERB: { inside: 1.2, exit: 1.8, astroturf: 2, sausage: 0.4, sausageGap: 2.5, gravelAsphalt: 3 },
  TUNNELS: [{ from: TUNNEL.from, to: TUNNEL.to, wallD: 1.5, kind: 'concrete' }],
  SPECTATOR_WALLS: [
    { from: 5330, to: 530, side: 1 },
    { from: 480, to: 650, side: 1 },
    { from: 3980, to: 4260, side: 1 },
  ],
  // Lakeside grandstands along the straight, bleachers outside T1, a grandstand over the hairpin braking zone.
  STANDS: [
    { from: 5420, to: 5600, side: 1, setback: 14, depth: 20, kind: 'grandstand' },
    { from: 40, to: 230, side: 1, setback: 14, depth: 20, kind: 'grandstand' },
    { from: 575, to: 640, side: 1, setback: 30, depth: 14, kind: 'bleachers' },
    { from: 3990, to: 4090, side: 1, setback: 22, depth: 16, kind: 'grandstand' },
  ],
  PUDDLES: [
    { s: 560, d: -4, len: 14, width: 2.2 },
    { s: 3420, d: 4, len: 16, width: 2.4 },
    { s: 4160, d: -5, len: 14, width: 2.2 },
    { s: 4850, d: 4, len: 12, width: 2.0 },
  ],
  EXTRA_WALLS: [],
  TRACKSIDE: {
    boardStraights: [
      { from: 5360, to: 470, side: 1 },
      { from: 2270, to: 2620, side: -1 },
      { from: 3480, to: 4060, side: 1 },
      { from: 3480, to: 4060, side: -1 },
      { from: 5110, to: 5250, side: 1 },
    ],
    gantries: [2450, 3750],
    distanceBoardCorners: [{ n: 1, side: 1 }, { n: 6, side: 1 }, { n: 10, side: 1 }],
    wordmarkCorners: [1, 10],
  },
  HIDE_FEATURES: [],
  THEME: {
    ground: 'alpine',
    forestMix: [0, 0, 0, 0.12, 0.88],
    forestSpacing: 8,
    openTreeSpacing: 18,
    openMix: [0, 0, 0.05, 0.35, 0.6],
    treeSetback: 10,
    maxTrees: 50000,
    lights: { height: 18, spacing: 30, bothSides: false, head: 'flood', skip: [{ from: TUNNEL.from - 25, to: TUNNEL.to + 25 }] },
    backdrop: 'alpine',
    sea: null,
  },
};
