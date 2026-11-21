// Sim layer: İstanbul authoring table (planner-report §7.3–§7.9). Every s is on the OSM basis of 5,351.5 m and is
// rescaled proportionally to the built length (s_final = s · L / OSM_LENGTH), as testing-qc.md §3 does.

import type { WallKind } from '../../contracts/track';
import type { CornerDef, TrackAuthoring } from './types';

export const OSM_LENGTH = 5351.5;

export const CORNERS: readonly CornerDef[] = [
  { n: 1, dir: 'L', entry: 191, apexes: [235], exit: 283, vApex: 150, bankDeg: 2, runoff: 'painted', outsideWall: 'tecpro', sausage: true, minClear: 18, cutZone: true },
  { n: 2, dir: 'R', entry: 307, apexes: [420], exit: 520, vApex: 190, bankDeg: 0.8, runoff: 'asphalt', outsideWall: 'armco', sausage: false, minClear: 20, cutZone: false },
  { n: 3, dir: 'L', entry: 881, apexes: [965], exit: 1049, vApex: 210, bankDeg: 1, runoff: 'painted', outsideWall: 'armco', sausage: false, minClear: 25, cutZone: false },
  { n: 4, dir: 'R', entry: 1077, apexes: [1115], exit: 1153, vApex: 110, bankDeg: -2, runoff: 'gravel', outsideWall: 'tyres', sausage: false, minClear: 16, cutZone: false },
  { n: 5, dir: 'L', entry: 1203, apexes: [1262], exit: 1321, vApex: 125, bankDeg: 0.6, runoff: 'asphalt', outsideWall: 'armco', sausage: false, minClear: 16, cutZone: false },
  { n: 6, dir: 'L', entry: 1341, apexes: [1381], exit: 1421, vApex: 175, bankDeg: 0.6, runoff: 'asphalt', outsideWall: 'armco', sausage: false, minClear: 20, cutZone: false },
  { n: 7, dir: 'R', entry: 1797, apexes: [1900], exit: 2033, vApex: 105, bankDeg: 3, runoff: 'gravel', outsideWall: 'armco', sausage: false, minClear: 16, cutZone: false },
  { n: 8, dir: 'L', entry: 2200, apexes: [2280, 2392, 2597], exit: 2760, vApex: 270, bankDeg: 1.5, runoff: 'painted', gravelFrom: 2480, outsideWall: 'armco', sausage: false, minClear: 45, cutZone: false },
  { n: 9, dir: 'L', entry: 3227, apexes: [3266], exit: 3305, vApex: 95, bankDeg: 0.6, runoff: 'gravel', outsideWall: 'tecpro', sausage: true, minClear: 16, cutZone: true },
  { n: 10, dir: 'R', entry: 3309, apexes: [3355], exit: 3401, vApex: 140, bankDeg: 0.6, runoff: 'asphalt', outsideWall: 'armco', sausage: true, minClear: 16, cutZone: true },
  { n: 11, dir: 'R', entry: 3819, apexes: [3885], exit: 3951, vApex: 300, bankDeg: 0, runoff: 'asphalt', outsideWall: 'armco', sausage: false, minClear: 25, cutZone: false },
  { n: 12, dir: 'L', entry: 4607, apexes: [4666], exit: 4725, vApex: 85, bankDeg: 0.6, runoff: 'painted', outsideWall: 'tecpro', sausage: true, minClear: 18, cutZone: true },
  { n: 13, dir: 'R', entry: 4731, apexes: [4767], exit: 4803, vApex: 90, bankDeg: 0.6, runoff: 'asphalt', outsideWall: 'armco', sausage: false, minClear: 12, cutZone: true },
  { n: 14, dir: 'L', entry: 4843, apexes: [4881], exit: 4919, vApex: 85, bankDeg: 0.6, runoff: 'painted', outsideWall: 'armco', sausage: true, minClear: 12, cutZone: true },
];

/** Exit-kerb barrier kind for T8 (impact zone at its exit). */
export const T8_EXIT_WALL: { from: number; to: number; kind: WallKind } = { from: 2600, to: 2800, kind: 'tyres' };

/** Half-widths (L, R) per s range (§7.5); `from > to` wraps through S/F. Later rows win; transitions smoothstep over 40 m. */
export const WIDTHS: readonly { from: number; to: number; hw: number }[] = [
  { from: 0, to: 5351.5, hw: 7.5 },
  { from: 4919, to: 120, hw: 8 },
  { from: 120, to: 230, hw: 10 },
  { from: 230, to: 320, hw: 8 },
  { from: 881, to: 1421, hw: 7 },
  { from: 3150, to: 3230, hw: 8 },
  { from: 4450, to: 4610, hw: 9 },
];

export const WIDTH_BLEND = 40;
export const LINE_WIDTH = 0.12;

/** Timing (§7.6). */
export const SECTOR2_S = 1650;
export const SECTOR3_S = 3480;
export const SPEED_TRAP_S = 4500;
export const DRS_ZONES: readonly { id: number; detect: number; activate: number; end: number }[] = [
  { id: 0, detect: 4840, activate: 4990, end: 150 },
  { id: 1, detect: 3200, activate: 3480, end: 4560 },
];

/** Pit lane (§7.7). */
export const PIT = {
  limitStartSp: 115,
  limitEndSp: 705,
  speedLimitKmh: 80 as const,
  firstBoxSp: 300,
  boxSpacing: 28,
  /** Main-centreline offsets along the pit straight. */
  fastLaneMainD: 12,
  workingLaneMainD: 17.5,
  garageFrontMainD: 22,
  pitWallFaceMainD: 9,
  pitWallThickness: 0.5,
  /** Ribbon half-width in the two-lane (box) section and in the single-lane entry/exit. */
  wideHalfWidth: 5.25,
  narrowHalfWidth: 3.5,
  /** Main s range (OSM basis, wraps) where the pit lane runs parallel to the main straight. */
  straightFrom: 4950,
  straightTo: 130,
  endBlend: 60,
} as const;

/** Grid (§7.7): P_k at s = L − 12 − 8k, d = ±2.4, pole on the left. */
export const GRID = { first: 12, spacing: 8, d: 2.4, slots: 20 } as const;

/** Barrier rules (§7.8). Straights: grass verge 6–12 m then the wall. */
export const VERGE = { straight: 9, mainStraightRight: 6, inside: 6 } as const;
export const KERB = { inside: 1.2, exit: 1.8, astroturf: 2, sausage: 0.4, sausageGap: 2.5, gravelAsphalt: 3 } as const;

/** Spectator areas: concrete wall + catch fence on the given side (+1 left, −1 right), s ranges (OSM basis). */
export const SPECTATOR_WALLS: readonly { from: number; to: number; side: 1 | -1 }[] = [
  { from: 4930, to: 300, side: -1 },
  { from: 950, to: 1100, side: -1 },
  { from: 1330, to: 1480, side: -1 },
  { from: 2220, to: 2700, side: -1 },
  { from: 3180, to: 3460, side: -1 },
  { from: 4500, to: 4700, side: -1 },
  { from: 4820, to: 4930, side: -1 },
  { from: 3830, to: 3930, side: 1 },
];

/** Authored puddle spots for GroundHit.wetLocal = 2 (low points / compressions), s on the OSM basis. */
export const PUDDLES: readonly { s: number; d: number; len: number; width: number }[] = [
  { s: 1890, d: -5.2, len: 14, width: 2.6 },
  { s: 3262, d: 5.4, len: 12, width: 2.2 },
  { s: 3700, d: -5.6, len: 18, width: 2.0 },
  { s: 4560, d: 6.4, len: 16, width: 2.4 },
  { s: 520, d: -5.4, len: 12, width: 2.0 },
];

/** Box order = team order of src/data/teams.ts. */
export const BOX_TEAMS: readonly string[] = ['anka', 'aurora', 'vortex', 'solaris', 'kestrel', 'meridian', 'titan', 'zephyr', 'ironclad', 'nova'];

/** The İstanbul table as a TrackAuthoring (G1: buildTrackData(raw, A)). Pit and pole on the left. */
export const ISTANBUL: TrackAuthoring = {
  id: 'istanbul',
  name: { tr: 'İstanbul Circuit', en: 'Istanbul Circuit' },
  OSM_LENGTH, CORNERS, WIDTHS, WIDTH_BLEND,
  ELEVATION_SIGMA: 40,
  ELEVATION_MEDIAN: 0,
  SECTOR2_S, SECTOR3_S, SPEED_TRAP_S, DRS_ZONES,
  PIT: { ...PIT, side: 1 },
  GRID: { ...GRID, poleSide: 1 },
  VERGE: { straight: VERGE.straight, mainStraightOpp: VERGE.mainStraightRight, mainStraightFrom: 4919, mainStraightTo: 120, inside: VERGE.inside },
  KERB, SPECTATOR_WALLS, PUDDLES,
  EXTRA_WALLS: [{ ...T8_EXIT_WALL, side: -1 }],
  TRACKSIDE: {
    boardStraights: [
      { from: 4960, to: 5300, side: -1, sponsors: [0, 4, 6] },
      { from: 30, to: 150, side: -1, sponsors: [9, 1, 9] },
      { from: 560, to: 860, side: -1, sponsors: [3, 7, 3] },
      { from: 560, to: 860, side: 1, sponsors: [5, 2, 5] },
      { from: 1450, to: 1780, side: 1, sponsors: [8, 0, 8] },
      { from: 2790, to: 3150, side: -1, sponsors: [2, 6, 2] },
      { from: 3420, to: 3800, side: -1, sponsors: [1, 4, 1] },
      { from: 3420, to: 3800, side: 1, sponsors: [6, 9, 6] },
      { from: 3960, to: 4520, side: -1, sponsors: [7, 3, 7] },
      { from: 3960, to: 4520, side: 1, sponsors: [0, 5, 0] },
    ],
    gantries: [1600, 4400],
    distanceBoardCorners: [{ n: 1, side: -1 }, { n: 4, side: -1 }, { n: 9, side: -1 }, { n: 12, side: -1 }],
    wordmarkCorners: [1, 12],
  },
  // The real pit building footprint: pitBuilding.ts draws the garages instead.
  HIDE_FEATURES: [295742112],
  THEME: {
    ground: 'golden',
    forestMix: [0.78, 0.11, 0.11, 0],
    forestSpacing: 8.5,
    openTreeSpacing: 22,
    openMix: [0.45, 0.275, 0.275, 0],
    treeSetback: 25,
    maxTrees: 40000,
    lights: { height: 18, spacing: 30, bothSides: false, head: 'flood' },
    backdrop: 'residential',
    sea: null,
    // The city's eastern edge: housing estates on the hills to the west-north-west (visual pass 2026-10).
    outskirts: { bearingDeg: 290, arcDeg: 220, distance: [380, 800], clusters: 10 },
  },
};
