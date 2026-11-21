// Sim layer: Volcano Rim authoring table (docs/design/tracks-volcano.md). Every s is on the authored turtle-path basis
// (volcano-ctrl.ts) and is rescaled to the built length. Clockwise; pit and pole on the left (the ash plain north of
// the S/F straight). The climb of the east flank with two switchback hairpins, the blind crest onto the bridge over
// the lava river, the tunnel through the crater wall, the south rim with two barrier-less fall zones and ash drifts,
// the hairpin descent past the lava cone and the long downhill sweepers. Corners are derived from the path arcs.

import { ASH_TAGS, BRIDGE, FALL_TAGS, TUNNEL_TAGS, volcCorners, volcPath, tagS } from './volcano-ctrl';
import type { CornerDef, TrackAuthoring } from './types';

const P = volcPath();
/** Authoring basis length, rounded like the other tracks' OSM_LENGTH (the path closes exactly). */
export const VOLC_BASE_LENGTH = Math.round(P.length);
const L = VOLC_BASE_LENGTH;
const T = (tag: string, off = 0): number => Math.round(tagS(tag, off));

/** Per-corner character keyed by the arc tag (apex speed is a run-off sizing hint). */
const STYLE: Readonly<Record<string, Partial<CornerDef>>> = {
  // T1: hard braking at the end of the S/F straight (overtaking spot 1).
  t1: { vApex: 110, runoff: 'painted', runoffW: 16, outsideWall: 'tecpro', cutZone: true },
  sw1: { vApex: 210, runoff: 'gravel', runoffW: 12, outsideWall: 'tyres' },
  sw2: { vApex: 210, runoff: 'gravel', runoffW: 12, outsideWall: 'tyres' },
  sw3: { vApex: 220, runoff: 'gravel', runoffW: 12, outsideWall: 'tyres' },
  // T5 / T6: the switchback hairpins, rock close behind a short gravel bed.
  hp1: { vApex: 65, runoff: 'gravel', runoffW: 8, outsideWall: 'tecpro', cutZone: true },
  hp2: { vApex: 70, runoff: 'gravel', runoffW: 8, outsideWall: 'tecpro', cutZone: true },
  t7: { vApex: 200, runoff: 'gravel', runoffW: 10, outsideWall: 'armco' },
  // T8: the blind crest kink onto the bridge (flat out for the brave).
  t8: { vApex: 250, runoff: 'asphalt', runoffW: 0, outsideWall: 'concrete', wallD: 3 },
  // T9: off the bridge, hard on the brakes into the tunnel (overtaking spot 2).
  t9: { vApex: 100, runoff: 'painted', runoffW: 10, outsideWall: 'tecpro', cutZone: true },
  // The rim: a basalt lip close to the edge; T11 and T12 have the fall zones on the outside.
  rim1: { vApex: 190, runoff: 'asphalt', runoffW: 0, outsideWall: 'concrete', wallD: 3 },
  rim2: { vApex: 170, runoff: 'asphalt', runoffW: 0, outsideWall: 'concrete', wallD: 3 },
  rim3: { vApex: 160, runoff: 'asphalt', runoffW: 0, outsideWall: 'concrete', wallD: 3 },
  // T13: the hairpin at the end of the rim straight (overtaking spot 3, the main one).
  hp3: { vApex: 65, runoff: 'painted', runoffW: 14, outsideWall: 'tecpro', cutZone: true },
  sp1: { vApex: 70, runoff: 'gravel', runoffW: 8, outsideWall: 'tecpro', cutZone: true },
  sp2: { vApex: 100, runoff: 'gravel', runoffW: 9, outsideWall: 'tyres' },
  // The downhill sweepers: short gravel, armco.
  sw4: { vApex: 240, runoff: 'gravel', runoffW: 10, outsideWall: 'armco' },
  sw5: { vApex: 240, runoff: 'gravel', runoffW: 10, outsideWall: 'armco' },
  sw6: { vApex: 230, runoff: 'gravel', runoffW: 10, outsideWall: 'armco' },
  sw7: { vApex: 250, runoff: 'gravel', runoffW: 10, outsideWall: 'armco' },
  sw8: { vApex: 260, runoff: 'gravel', runoffW: 10, outsideWall: 'armco' },
  sw9: { vApex: 260, runoff: 'gravel', runoffW: 10, outsideWall: 'armco' },
  // T22: slow right onto the S/F straight.
  fixH: { vApex: 95, runoff: 'painted', runoffW: 14, outsideWall: 'tecpro', cutZone: true },
};

const CORNERS: readonly CornerDef[] = volcCorners(P).map((a, k): CornerDef => {
  const st = STYLE[a.tag] ?? {};
  const c: CornerDef = {
    n: k + 1, dir: a.turn > 0 ? 'L' : 'R', entry: Math.round(a.s0), apexes: a.apexes.map(Math.round), exit: Math.round(a.s1),
    vApex: 150, bankDeg: 0, runoff: 'gravel', outsideWall: 'armco', sausage: false, minClear: 0, cutZone: false, ...st,
  };
  if (st.runoff === 'painted') c.gravelFrom = Math.round(a.s1);
  return c;
});

const SF_FROM = Math.round(P.arcs.find((a) => a.tag === 'fixH')!.s1);
const T1 = T('t1');
const bridge = { from: T(BRIDGE[0], BRIDGE[1]), to: T(BRIDGE[2], BRIDGE[3]) };
export const VOLC_TUNNEL = { from: T(TUNNEL_TAGS[0], TUNNEL_TAGS[1]), to: T(TUNNEL_TAGS[2], TUNNEL_TAGS[3]) };
export const VOLC_BRIDGE = bridge;
export const VOLC_FALLS = FALL_TAGS.map((f) => ({ from: T(f.from[0], f.from[1]), to: T(f.to[0], f.to[1]), side: f.side, lip: 2.5 }));

export const VOLCANO: TrackAuthoring = {
  id: 'volcano',
  name: { tr: 'Ecelle Dans – Volkan Ağzı', en: 'Dance with Death – Volcano Rim' },
  OSM_LENGTH: L,
  CORNERS,
  WIDTHS: [
    { from: 0, to: L, hw: 6.5 },
    { from: SF_FROM - 20, to: T1 - 100, hw: 7 },
    { from: T1 - 100, to: T1 + 40, hw: 7.5 },
    // Rim straight: room to pull out before the hairpin.
    { from: T('rim', 40), to: T('hp3', 20), hw: 7 },
    { from: VOLC_TUNNEL.from - 30, to: VOLC_TUNNEL.to + 20, hw: 6.25 },
  ],
  WIDTH_BLEND: 40,
  ELEVATION_SIGMA: 12,
  ELEVATION_MEDIAN: 0,
  SECTOR2_S: T('crest'),
  SECTOR3_S: T('rim'),
  SPEED_TRAP_S: T('sf', 330),
  DRS_ZONES: [
    { id: 0, detect: T('fixB', 20), activate: SF_FROM + 30, end: T1 - 110 },
    { id: 1, detect: T('rim3', 50), activate: T('rim', 50), end: T('hp3', -110) },
  ],
  PIT: {
    limitStartSp: 120,
    limitEndSp: 460,
    speedLimitKmh: 80,
    firstBoxSp: 175,
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
  VERGE: { straight: 4, mainStraightOpp: 6, mainStraightFrom: SF_FROM, mainStraightTo: T1 - 60, inside: 2, base: 'concrete' },
  DEFAULT_WALL: 'armco',
  KERB: { inside: 1.2, exit: 1.6, astroturf: 0, sausage: 0.5, sausageGap: 1.5, gravelAsphalt: 2 },
  DECKS: [{ from: bridge.from, to: bridge.to, wallD: 2.5, kind: 'concrete' }],
  TUNNELS: [{ from: VOLC_TUNNEL.from, to: VOLC_TUNNEL.to, wallD: 1.5, kind: 'concrete' }],
  FALLS: VOLC_FALLS,
  ASH: ASH_TAGS.map(([tag, off, len]) => ({ from: T(tag, off), to: T(tag, off + len) })),
  SPECTATOR_WALLS: [
    { from: SF_FROM, to: T1 - 40, side: -1 },
    { from: T1 - 160, to: T1 + 60, side: 1 },
  ],
  STANDS: [
    { from: SF_FROM + 30, to: T('sf', 120), side: -1, setback: 12, depth: 20, kind: 'grandstand' },
    { from: T1 - 170, to: T1 - 40, side: 1, setback: 18, depth: 22, kind: 'grandstand' },
    { from: T('hp3', -150), to: T('hp3', -40), side: 1, setback: 22, depth: 14, kind: 'bleachers' },
  ],
  PUDDLES: [],
  EXTRA_WALLS: [
    // Basalt lip along the rim straight (crater side).
    { from: T('rim'), to: T('hp3', -30), kind: 'concrete', side: -1 },
  ],
  TRACKSIDE: {
    boardStraights: [
      { from: SF_FROM + 20, to: T1 - 30, side: -1 },
      { from: T('rim', 40), to: T('hp3', -30), side: 1 },
    ],
    gantries: [T('rim', 220)],
    distanceBoardCorners: [{ n: 1, side: -1 }, { n: 9, side: 1 }, { n: 12, side: 1 }],
    wordmarkCorners: [1, 12],
  },
  HIDE_FEATURES: [],
  THEME: {
    ground: 'volcanic',
    forestMix: [1, 0, 0, 0, 0],
    forestSpacing: 14,
    openTreeSpacing: 0,
    openMix: [1, 0, 0, 0, 0],
    treeSetback: 8,
    maxTrees: 0,
    // Full floodlighting (the lava adds its own glow); none over the bore (it has its lamps) or the fall zones.
    lights: {
      height: 18, spacing: 30, bothSides: true, head: 'flood', color: 0xffc89a,
      skip: [{ from: VOLC_TUNNEL.from - 10, to: VOLC_TUNNEL.to + 10 }, ...VOLC_FALLS.map((f) => ({ from: f.from - 10, to: f.to + 10 }))],
    },
    backdrop: 'volcanic',
    sea: null,
    cull: { surface: 1000, statics: 650 },
  },
};
