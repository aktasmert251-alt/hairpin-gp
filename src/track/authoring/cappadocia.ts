// Sim layer: Cappadocia Valley authoring table (docs/design/tracks-cappadocia.md). Every s is on the authored
// turtle-path basis (cappadocia-ctrl.ts) and is rescaled to the built length. Clockwise; pit and pole on the left. A
// short, relentless, technical lap through a tuff valley: 21 corners, walls close behind thin verges almost everywhere,
// narrow walled sections (the rock chicane, the village street, the gorge hairpin), off-camber, crests and a bumpy
// village street; gravel traps only where a mistake should cost time. Corners are derived from the path arcs.

import { GORGES, cappCorners, cappPath, tagS } from './cappadocia-ctrl';
import type { CornerDef, TrackAuthoring } from './types';

const P = cappPath();
/** Authoring basis length, rounded like the other tracks' OSM_LENGTH (the path closes exactly). */
export const CAPP_BASE_LENGTH = Math.round(P.length);
const L = CAPP_BASE_LENGTH;
const T = (tag: string, off = 0): number => Math.round(tagS(tag, off));

/** Per-corner character keyed by the arc tag (apex speed is only a run-off sizing hint). */
const STYLE: Readonly<Record<string, Partial<CornerDef>>> = {
  // T1: the downhill hairpin at the end of the S/F straight (overtaking spot 1): painted run-off, then gravel.
  hairpin: { vApex: 70, runoff: 'painted', runoffW: 14, outsideWall: 'tecpro', cutZone: true },
  // T2: double apex round the castle foot.
  double: { vApex: 115, runoff: 'gravel', runoffW: 12, outsideWall: 'tyres' },
  // T3–T6: fast esses through the vineyards: a short gravel bed, armco behind.
  esses: { vApex: 210, runoff: 'gravel', runoffW: 9, outsideWall: 'armco' },
  '': { vApex: 210, runoff: 'gravel', runoffW: 9, outsideWall: 'armco' },
  // T7: blind uphill crest into a left: armco close on the outside.
  blind: { vApex: 135, runoff: 'asphalt', runoffW: 0, outsideWall: 'armco', wallD: 4 },
  // T8: decreasing-radius right: the gravel catches the late brakers.
  decr: { vApex: 110, runoff: 'gravel', runoffW: 12, outsideWall: 'tyres' },
  // T9–T10: the chicane carved between rocks (overtaking spot 3): narrow, sausage kerbs, rock walls close.
  chicane: { vApex: 75, runoff: 'painted', runoffW: 2.5, outsideWall: 'concrete', sausage: true, cutZone: true, wallD: 5 },
  chicane2: { vApex: 80, runoff: 'painted', runoffW: 2.5, outsideWall: 'concrete', sausage: true, cutZone: true, wallD: 5 },
  // T11: off-camber downhill right, gravel on the outside.
  offcamber: { vApex: 125, bankDeg: -4, runoff: 'gravel', runoffW: 13, outsideWall: 'tecpro' },
  // T12–T13: the village street: house walls at the kerb.
  village: { vApex: 80, runoff: 'asphalt', runoffW: 0, outsideWall: 'concrete', wallD: 3 },
  v2: { vApex: 85, runoff: 'asphalt', runoffW: 0, outsideWall: 'concrete', wallD: 3 },
  // T14: the long-radius carousel at the end of the back straight (overtaking spot 2).
  carousel: { vApex: 150, runoff: 'gravel', runoffW: 16, outsideWall: 'tyres', gravelFrom: 0 },
  k: { vApex: 120, runoff: 'gravel', runoffW: 9, outsideWall: 'armco' },
  fin1: { vApex: 120, runoff: 'asphalt', runoffW: 0, outsideWall: 'armco', wallD: 4 },
  // T17: the blind uphill hairpin in the rock gorge.
  hairpin2: { vApex: 65, runoff: 'painted', runoffW: 4, outsideWall: 'tecpro', cutZone: true, wallD: 6 },
  fin3: { vApex: 90, runoff: 'asphalt', runoffW: 0, outsideWall: 'concrete', wallD: 3.5 },
  fin4: { vApex: 140, runoff: 'gravel', runoffW: 8, outsideWall: 'armco' },
  fin5: { vApex: 140, runoff: 'gravel', runoffW: 8, outsideWall: 'armco' },
  // T21: the crest onto the S/F straight.
  fixH: { vApex: 100, runoff: 'painted', runoffW: 12, outsideWall: 'tecpro', cutZone: true },
};

const CORNERS: readonly CornerDef[] = cappCorners(P).map((a, k): CornerDef => {
  const st = STYLE[a.tag] ?? STYLE['']!;
  const c: CornerDef = {
    n: k + 1, dir: a.turn > 0 ? 'L' : 'R', entry: Math.round(a.s0), apexes: a.apexes.map(Math.round), exit: Math.round(a.s1),
    vApex: 120, bankDeg: 0, runoff: 'gravel', outsideWall: 'armco', sausage: false, minClear: 0, cutZone: false, ...st,
  };
  // Gravel after a short painted band (hairpins, final corner).
  if (st.runoff === 'painted' && (a.tag === 'hairpin' || a.tag === 'fixH')) c.gravelFrom = Math.round(a.s1);
  if (st.gravelFrom === 0) c.gravelFrom = Math.round(a.s0);
  return c;
});

const gz = GORGES.map((g) => ({ from: T(g.from[0], g.from[1]), to: T(g.to[0], g.to[1]), kind: g.kind }));
/** End of T21 (start of the S/F straight) and the T1 braking zone. */
const SF_FROM = Math.round(P.arcs.find((a) => a.tag === 'fixH')!.s1);
const T1 = T('hairpin');

export const CAPPADOCIA: TrackAuthoring = {
  id: 'cappadocia',
  name: { tr: 'Kapadokya Vadisi Circuit', en: 'Cappadocia Valley Circuit' },
  OSM_LENGTH: L,
  CORNERS,
  WIDTHS: [
    { from: 0, to: L, hw: 6.25 },
    // S/F straight, widening into the T1 braking zone (two lines for the lap-1 pile-up and the late pass).
    { from: SF_FROM - 20, to: T1 - 120, hw: 6.75 },
    { from: T1 - 120, to: T1 + 40, hw: 7.25 },
    // Back straight: room to pull out before the carousel.
    { from: T('back', 60), to: T('carousel', 40), hw: 6.75 },
    // Narrow walled sections: 10.5–11 m.
    ...gz.map((g) => ({ from: g.from, to: g.to, hw: g.kind === 'village' ? 5.25 : 5.5 })),
  ],
  WIDTH_BLEND: 40,
  ELEVATION_SIGMA: 12,
  ELEVATION_MEDIAN: 0,
  // The bumpy village street, T12 through the T13 exit: a gentle long-wave undulation (±1 cm, 24 m). A 9 m wave fed the
  // bump slope into the ground normal at ≈ 5 Hz and the cars visibly porpoised down the hill before DRS 2 (user bug).
  BUMPS: [{ from: T('village', -40), to: T('back', 60), amp: 0.01, wave: 24 }],
  SECTOR2_S: T('crest'),
  SECTOR3_S: T('carousel'),
  SPEED_TRAP_S: T('sf', 260),
  DRS_ZONES: [
    { id: 0, detect: T('fixB', 120), activate: SF_FROM + 25, end: T1 - 110 },
    { id: 1, detect: T('v2', 60), activate: T('back', 50), end: T('carousel', -100) },
  ],
  PIT: {
    limitStartSp: 230,
    limitEndSp: 620,
    speedLimitKmh: 80,
    firstBoxSp: 300,
    boxSpacing: 26,
    fastLaneMainD: 14.5,
    workingLaneMainD: 20,
    garageFrontMainD: 24.5,
    pitWallFaceMainD: 11.5,
    pitWallThickness: 0.5,
    wideHalfWidth: 5.25,
    narrowHalfWidth: 3.5,
    straightFrom: SF_FROM,
    straightTo: 60,
    endBlend: 30,
    side: 1,
  },
  GRID: { first: 12, spacing: 8, d: 2.4, slots: 20, poleSide: 1 },
  VERGE: { straight: 3.5, mainStraightOpp: 6, mainStraightFrom: SF_FROM, mainStraightTo: T1 - 60, inside: 2, base: 'grass' },
  DEFAULT_WALL: 'armco',
  KERB: { inside: 1.2, exit: 1.6, astroturf: 0, sausage: 0.5, sausageGap: 1.0, gravelAsphalt: 2 },
  SPECTATOR_WALLS: [
    { from: SF_FROM, to: T1 - 40, side: -1 },
    { from: T1 - 120, to: T('h-exit', 40), side: 1 },
    ...gz.flatMap((g) => [{ from: g.from, to: g.to, side: 1 as const }, { from: g.from, to: g.to, side: -1 as const }]),
  ],
  // Stands carved into the slope: outside T1, the T21 / S/F straight (infield side), the carousel braking zone.
  STANDS: [
    { from: T1 - 170, to: T1 - 40, side: 1, setback: 18, depth: 22, kind: 'grandstand' },
    { from: SF_FROM + 30, to: T('sf', 120), side: -1, setback: 12, depth: 20, kind: 'grandstand' },
    { from: T('carousel', -150), to: T('carousel', -40), side: 1, setback: 24, depth: 14, kind: 'bleachers' },
  ],
  PUDDLES: [
    { s: T('village', 20), d: 2, len: 12, width: 2.0 },
    { s: T('hairpin', 30), d: -3, len: 12, width: 2.0 },
    { s: T('carousel', 120), d: 3, len: 14, width: 2.2 },
  ],
  EXTRA_WALLS: gz.flatMap((g) => [
    { from: g.from, to: g.to, kind: 'concrete' as const, side: 1 as const },
    { from: g.from, to: g.to, kind: 'concrete' as const, side: -1 as const },
  ]),
  TRACKSIDE: {
    boardStraights: [
      { from: SF_FROM + 20, to: T1 - 30, side: -1 },
      { from: T('back', 40), to: T('carousel', -30), side: -1 },
    ],
    gantries: [T('back', 200)],
    distanceBoardCorners: [{ n: 1, side: -1 }, { n: 9, side: 1 }, { n: 14, side: -1 }, { n: 17, side: 1 }],
    wordmarkCorners: [1, 14],
  },
  HIDE_FEATURES: [],
  THEME: {
    ground: 'valley',
    forestMix: [0, 0, 0, 1, 0],
    forestSpacing: 14,
    openTreeSpacing: 0,
    openMix: [0, 1, 0, 0, 0],
    treeSetback: 8,
    maxTrees: 2000,
    // Full floodlighting: poles on both sides every 30 m (no dark sections at night).
    lights: { height: 18, spacing: 30, bothSides: true, head: 'flood' },
    backdrop: 'valley',
    sea: null,
  },
};
