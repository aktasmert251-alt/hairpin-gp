// Sim layer: Eifel Forest Ring authoring table (docs/design/tracks-eifel.md). Every s is on the authored turtle-path
// basis (eifel-ctrl.ts, â‰ˆ 20.45 km) and is rescaled to the built length. Clockwise; a short GP-style loop with the pit
// lane and the grid (pit and pole on the right), then a narrow country-road ring through the forest: the downhill rush,
// the valley village, the climb with the banked bowl, the plateau crests and the long straight home.
// The corner list is derived from the path: every arc of â‰¥ 10Â° is a numbered corner (T1â€“T71).

import { eifelCorners, eifelPath, tagS } from './eifel-ctrl';
import type { CornerDef, TrackAuthoring } from './types';

const P = eifelPath();
/** Authoring basis length (the path is closed exactly; rounded like the other tracks' OSM_LENGTH). */
export const EIFEL_BASE_LENGTH = Math.round(P.length);
const L = EIFEL_BASE_LENGTH;
/** Basis s where the ring proper starts (the GP loop is everything before it). */
export const RING_FROM = tagS('esses');
const BOWL = P.arcs.find((a) => a.seg === P.segs.findIndex((g) => g[0] === 'A' && g[3] === 'bowl'))!;

/** Approximate apex speed from the radius (km/h): grip â‰ˆ 2.1 g at medium speed, capped at 300. */
const vOf = (r: number): number => Math.min(300, Math.round(3.6 * Math.sqrt(2.1 * 9.81 * r)));

const CORNERS: readonly CornerDef[] = eifelCorners(P).map((a, k): CornerDef => {
  const n = k + 1;
  const dir: CornerDef['dir'] = a.turn > 0 ? 'L' : 'R';
  const mid = Math.round((a.s0 + a.s1) / 2);
  const v = vOf(a.r);
  const base: Omit<CornerDef, 'runoff' | 'outsideWall' | 'minClear'> = {
    n, dir, entry: Math.round(a.s0), apexes: [mid], exit: Math.round(a.s1), vApex: v, bankDeg: 0, sausage: false, cutZone: false,
  };
  if (a.s0 < RING_FROM) {
    // GP loop: modern run-off (gravel / painted asphalt) and impact barriers.
    if (v < 120) return { ...base, runoff: 'painted', gravelFrom: Math.round(a.s1), outsideWall: 'tecpro', minClear: 16, cutZone: true };
    return { ...base, runoff: 'gravel', outsideWall: 'tyres', minClear: 0 };
  }
  if (a === BOWL) {
    // The banked concrete bowl: steep banking, a concrete wall close behind the high outside edge.
    return { ...base, bankDeg: 14, runoff: 'asphalt', runoffW: 0, outsideWall: 'concrete', minClear: 3 };
  }
  // The ring: grass verge, armco close to the edge (tyres in front of it where the speed is low).
  return { ...base, runoff: 'asphalt', runoffW: 0, outsideWall: v < 110 ? 'tyres' : 'armco', minClear: v > 220 ? 6 : 4 };
});

/** The longest straight (fixA) and the speed trap near its end. */
const STRAIGHT = tagS('fixA');

export const EIFEL: TrackAuthoring = {
  id: 'eifel',
  name: { tr: 'Eifel Orman Ring', en: 'Eifel Forest Ring' },
  OSM_LENGTH: L,
  CORNERS,
  WIDTHS: [
    { from: 0, to: L, hw: 4.75 },
    // GP loop at full circuit width, the pit straight wider still.
    { from: L - 900, to: RING_FROM - 60, hw: 7 },
    { from: L - 650, to: 560, hw: 7.5 },
    // The long straight opens up toward the GP loop; the bowl is a touch wider for two lines.
    { from: STRAIGHT + 300, to: L - 900, hw: 5.5 },
    { from: BOWL.s0 - 40, to: BOWL.s1 + 40, hw: 5.25 },
  ],
  WIDTH_BLEND: 60,
  ELEVATION_SIGMA: 30,
  ELEVATION_MEDIAN: 0,
  SECTOR2_S: Math.round(tagS('valley')),
  SECTOR3_S: Math.round(tagS('crest')),
  SPEED_TRAP_S: Math.round(STRAIGHT + 1650),
  DRS_ZONES: [{ id: 0, detect: Math.round(STRAIGHT + 120), activate: Math.round(STRAIGHT + 300), end: 520 }],
  PIT: {
    limitStartSp: 170,
    limitEndSp: 680,
    speedLimitKmh: 80,
    firstBoxSp: 270,
    boxSpacing: 32,
    fastLaneMainD: 15.5,
    workingLaneMainD: 21,
    garageFrontMainD: 25.5,
    pitWallFaceMainD: 12.5,
    pitWallThickness: 0.5,
    wideHalfWidth: 5.25,
    narrowHalfWidth: 3.5,
    straightFrom: L - 309,
    straightTo: 150,
    endBlend: 30,
    side: -1,
  },
  GRID: { first: 12, spacing: 8, d: 2.4, slots: 20, poleSide: -1 },
  VERGE: { straight: 3, mainStraightOpp: 6, mainStraightFrom: L - 600, mainStraightTo: 560, inside: 2, base: 'grass' },
  DEFAULT_WALL: 'armco',
  KERB: { inside: 1.0, exit: 1.4, astroturf: 1, sausage: 0.4, sausageGap: 2.5, gravelAsphalt: 3 },
  SPECTATOR_WALLS: [
    { from: L - 600, to: 620, side: 1 },
    { from: 560, to: 760, side: 1 },
  ],
  STANDS: [
    { from: L - 420, to: L - 230, side: 1, setback: 14, depth: 20, kind: 'grandstand' },
    { from: 30, to: 220, side: 1, setback: 14, depth: 20, kind: 'grandstand' },
    { from: 600, to: 680, side: 1, setback: 28, depth: 14, kind: 'bleachers' },
  ],
  PUDDLES: [
    { s: 660, d: -3, len: 14, width: 2.2 },
    { s: Math.round(tagS('village', 60)), d: 2, len: 12, width: 2.0 },
    { s: Math.round(tagS('bridge', 120)), d: -2, len: 14, width: 2.0 },
    { s: Math.round(BOWL.s0 + 30), d: -3, len: 12, width: 2.0 },
  ],
  EXTRA_WALLS: [],
  TRACKSIDE: {
    boardStraights: [
      { from: L - 560, to: 520, side: 1 },
      { from: Math.round(STRAIGHT + 200), to: Math.round(STRAIGHT + 900), side: 1 },
    ],
    gantries: [Math.round(STRAIGHT + 1300)],
    distanceBoardCorners: [{ n: 1, side: 1 }],
    wordmarkCorners: [1],
  },
  HIDE_FEATURES: [],
  THEME: {
    ground: 'green',
    // Spruce and beech forest; meadows in the open.
    forestMix: [0, 0, 0, 0.4, 0.6],
    forestSpacing: 9,
    openTreeSpacing: 26,
    openMix: [0, 0, 0.1, 0.55, 0.35],
    treeSetback: 4,
    maxTrees: 200000,
    treeFar: { near: 300, spacing: 19 },
    lights: { height: 16, spacing: 48, bothSides: false, head: 'flood' },
    backdrop: 'residential',
    sea: null,
  },
};
