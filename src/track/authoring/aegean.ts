// Sim layer: Aegean Islands authoring table (docs/design/tracks-aegean.md). Every s is on the authored fillet-polygon
// basis of 6,089 m (aegean-ctrl.ts) and is rescaled to the built length. Clockwise; the pit and the pole are on the
// right (inland on the main island). Most of the lap is on the sea: a causeway, a cable-stayed bridge with a gentle
// crest, the esses between two islets, a floating pontoon along a breakwater, a tunnel through a rocky headland and a
// long sweeping bridge back to the harbour. Every over-sea span is a bridge deck with walls (DECKS from seaSpans()).

import { TUNNEL, seaSpans } from './aegean-ctrl';
import type { CornerDef, TrackAuthoring } from './types';

type Wall = CornerDef['outsideWall'];
const C = (n: number, dir: 'L' | 'R', entry: number, apex: number, exit: number, vApex: number, runoff: CornerDef['runoff'], outsideWall: Wall,
  o: Partial<CornerDef> = {}): CornerDef =>
  ({ n, dir, entry, apexes: [apex], exit, vApex, bankDeg: 0, runoff, outsideWall, sausage: false, minClear: 0, cutZone: false, ...o });

const CORNERS: readonly CornerDef[] = [
  // Windmill island: heavy stop off the causeway, then a flowing left-right up the hill.
  C(1, 'R', 677, 718, 759, 120, 'painted', 'tecpro', { gravelFrom: 760, minClear: 16, cutZone: true }),
  C(2, 'L', 951, 984, 1017, 190, 'asphalt', 'armco', { runoffW: 12 }),
  C(3, 'R', 1197, 1248, 1298, 140, 'gravel', 'tyres', { runoffW: 14 }),
  // Off the cable-stayed bridge onto islet C, the esses across the gap to islet D (T6 on the bridge between them).
  C(4, 'R', 1868, 1935, 2001, 210, 'asphalt', 'armco', { runoffW: 14 }),
  C(5, 'L', 2078, 2126, 2174, 150, 'gravel', 'tyres', { runoffW: 12 }),
  C(6, 'R', 2222, 2269, 2316, 140, 'asphalt', 'concrete'),
  C(7, 'L', 2382, 2417, 2452, 160, 'gravel', 'tyres', { runoffW: 12, cutZone: true }),
  C(8, 'R', 2496, 2548, 2599, 140, 'asphalt', 'concrete'),
  // The pontoon sweep, flat out along the breakwater.
  C(9, 'R', 3014, 3129, 3244, 280, 'asphalt', 'concrete'),
  // Headland island: the right-left onto the climb, the tunnel, the hairpin at its exit.
  C(10, 'R', 3475, 3508, 3542, 200, 'asphalt', 'armco', { runoffW: 12 }),
  C(11, 'L', 3668, 3708, 3749, 160, 'gravel', 'tyres', { runoffW: 12 }),
  C(12, 'R', 3913, 3956, 3999, 80, 'painted', 'tecpro', { gravelFrom: 4005, minClear: 18, cutZone: true }),
  // The long sweeping bridge back to the main island.
  C(13, 'R', 4613, 4795, 4977, 300, 'asphalt', 'concrete'),
  // Harbour: left-right-right onto the start straight.
  C(14, 'L', 5260, 5305, 5351, 150, 'gravel', 'tyres', { runoffW: 12 }),
  C(15, 'R', 5419, 5446, 5474, 130, 'painted', 'tyres', { sausage: true, cutZone: true }),
  C(16, 'R', 5580, 5626, 5673, 100, 'painted', 'tecpro', { gravelFrom: 5680, minClear: 14 }),
];

export const AEGEAN: TrackAuthoring = {
  id: 'aegean',
  name: { tr: 'Ege Adalar Circuit', en: 'Aegean Islands Circuit' },
  OSM_LENGTH: 6089,
  CORNERS,
  WIDTHS: [
    { from: 0, to: 6089, hw: 7.5 },
    { from: 5680, to: 650, hw: 8 },
    { from: 4040, to: 5230, hw: 8 },
    { from: 3880, to: 4020, hw: 8.5 },
  ],
  WIDTH_BLEND: 40,
  ELEVATION_SIGMA: 25,
  ELEVATION_MEDIAN: 0,
  SECTOR2_S: 1986,
  SECTOR3_S: 3984,
  SPEED_TRAP_S: 560,
  DRS_ZONES: [
    { id: 0, detect: 5520, activate: 5720, end: 600 },
    { id: 1, detect: 1240, activate: 1350, end: 1820 },
    { id: 2, detect: 4010, activate: 4090, end: 5180 },
  ],
  PIT: {
    limitStartSp: 120,
    limitEndSp: 540,
    speedLimitKmh: 80,
    firstBoxSp: 170,
    boxSpacing: 26,
    fastLaneMainD: 14.5,
    workingLaneMainD: 20,
    garageFrontMainD: 24.5,
    pitWallFaceMainD: 11.5,
    pitWallThickness: 0.5,
    wideHalfWidth: 5.25,
    narrowHalfWidth: 3.5,
    straightFrom: 5910,
    straightTo: 110,
    endBlend: 30,
    side: -1,
  },
  GRID: { first: 12, spacing: 8, d: 2.4, slots: 20, poleSide: -1 },
  VERGE: { straight: 4, mainStraightOpp: 6, mainStraightFrom: 5680, mainStraightTo: 283, inside: 3 },
  KERB: { inside: 1.2, exit: 1.8, astroturf: 1.5, sausage: 0.4, sausageGap: 2.5, gravelAsphalt: 3 },
  // Every over-sea span: a bridge deck with concrete walls + catch fences at hw + 2.5 (pontoon included).
  DECKS: seaSpans().map((sp) => ({ from: sp.from, to: sp.to, wallD: 2.5, kind: 'concrete' as const })),
  TUNNELS: [{ from: TUNNEL.from, to: TUNNEL.to, wallD: 1.5, kind: 'concrete' }],
  SPECTATOR_WALLS: [
    { from: 5680, to: 283, side: 1 },
    { from: 650, to: 770, side: 1 },
    { from: 3880, to: 4010, side: 1 },
  ],
  // Grandstands on the sea side of the start straight, over the T12 hairpin and at the harbour.
  STANDS: [
    { from: 5900, to: 6080, side: 1, setback: 12, depth: 20, kind: 'grandstand' },
    { from: 20, to: 200, side: 1, setback: 12, depth: 20, kind: 'grandstand' },
    { from: 3920, to: 3990, side: 1, setback: 26, depth: 14, kind: 'bleachers' },
    // T1 (end of the causeway) and the harbour.
    { from: 700, to: 790, side: 1, setback: 24, depth: 18, kind: 'grandstand' },
    { from: 5300, to: 5420, side: 1, setback: 16, depth: 16, kind: 'grandstand' },
    { from: 5545, to: 5625, side: 1, setback: 22, depth: 14, kind: 'bleachers' },
  ],
  PUDDLES: [
    { s: 715, d: -4, len: 14, width: 2.2 },
    { s: 3955, d: -4, len: 14, width: 2.2 },
    { s: 5630, d: -4, len: 12, width: 2.0 },
  ],
  EXTRA_WALLS: [],
  TRACKSIDE: {
    // Boards only where the road is on land (bridge edges have the LED walkway instead).
    boardStraights: [
      { from: 5700, to: 270, side: 1 },
      { from: 780, to: 960, side: -1 },
      { from: 1020, to: 1180, side: 1 },
      { from: 1020, to: 1180, side: -1 },
      { from: 1920, to: 2070, side: 1 },
      { from: 3560, to: 3650, side: -1 },
      { from: 3560, to: 3650, side: 1 },
      { from: 5340, to: 5420, side: -1 },
    ],
    gantries: [150, 3600],
    distanceBoardCorners: [{ n: 16, side: 1 }],
    wordmarkCorners: [12, 16],
  },
  HIDE_FEATURES: [],
  THEME: {
    ground: 'island',
    forestMix: [0.25, 0.25, 0.5, 0, 0],
    forestSpacing: 9,
    // Olive groves and cypresses close to the road on the islands.
    openTreeSpacing: 12,
    openMix: [0.1, 0.25, 0.65, 0, 0],
    treeSetback: 7,
    maxTrees: 9000,
    // Floods on both sides every 30 m, bridges included (poles on the deck walkway, floodlights.ts).
    lights: { height: 16, spacing: 30, bothSides: true, head: 'flood' },
    backdrop: 'islands',
    sea: { y: -4 },
    bridgeRailing: true,
  },
};
