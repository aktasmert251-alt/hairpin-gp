// Sim layer: Ardennes authoring table (docs/design/tracks-spa.md). Every s is on the OSM basis of 7,003.5 m and is
// rescaled to the built length. Clockwise; the pit and the pole are on the right (PIT.side = −1, GRID.poleSide = −1).
// Hilly forest circuit: the start-straight descent into the valley dip and the steep climb after it (T2–T4).

import type { CornerDef, TrackAuthoring } from './types';

const CORNERS: readonly CornerDef[] = [
  // Downhill hairpin straight after the line: heaviest braking of the lap.
  { n: 1, dir: 'R', entry: 225, apexes: [270], exit: 310, vApex: 65, bankDeg: 0, runoff: 'painted', gravelFrom: 330, outsideWall: 'tecpro', sausage: false, minClear: 22, cutZone: false },
  // Valley dip: flat-out left at the bottom, the steep right-hand climb, the blind left crest.
  { n: 2, dir: 'L', entry: 890, apexes: [940], exit: 965, vApex: 290, bankDeg: 0, runoff: 'asphalt', outsideWall: 'armco', sausage: false, minClear: 18, cutZone: false },
  { n: 3, dir: 'R', entry: 975, apexes: [1030], exit: 1120, vApex: 290, bankDeg: 2, runoff: 'asphalt', outsideWall: 'tecpro', sausage: false, minClear: 30, cutZone: false },
  { n: 4, dir: 'L', entry: 1135, apexes: [1170], exit: 1200, vApex: 295, bankDeg: 0, runoff: 'asphalt', outsideWall: 'armco', sausage: false, minClear: 20, cutZone: false },
  // Top of the hill: right-left chicane at the end of the long uphill straight, then a downhill right.
  { n: 5, dir: 'R', entry: 2255, apexes: [2300], exit: 2342, vApex: 130, bankDeg: 0, runoff: 'painted', gravelFrom: 2350, outsideWall: 'tecpro', sausage: true, minClear: 22, cutZone: true },
  { n: 6, dir: 'L', entry: 2342, apexes: [2385], exit: 2430, vApex: 120, bankDeg: 0, runoff: 'painted', outsideWall: 'tyres', sausage: true, minClear: 18, cutZone: true },
  { n: 7, dir: 'R', entry: 2495, apexes: [2535], exit: 2585, vApex: 145, bankDeg: 0, runoff: 'gravel', outsideWall: 'tyres', sausage: false, minClear: 20, cutZone: false },
  // Downhill second hairpin and the left out of it.
  { n: 8, dir: 'R', entry: 2850, apexes: [2945], exit: 3040, vApex: 75, bankDeg: 1, runoff: 'gravel', outsideWall: 'tyres', sausage: false, minClear: 25, cutZone: false },
  { n: 9, dir: 'L', entry: 3135, apexes: [3170], exit: 3230, vApex: 120, bankDeg: 0, runoff: 'gravel', outsideWall: 'tyres', sausage: false, minClear: 20, cutZone: false },
  // The fast double-apex downhill left (two corners).
  { n: 10, dir: 'L', entry: 3650, apexes: [3755], exit: 3795, vApex: 240, bankDeg: 1, runoff: 'gravel', outsideWall: 'armco', sausage: false, minClear: 40, cutZone: false },
  { n: 11, dir: 'L', entry: 3830, apexes: [3990], exit: 4025, vApex: 230, bankDeg: 1, runoff: 'gravel', outsideWall: 'armco', sausage: false, minClear: 40, cutZone: false },
  // Forest right-left in the valley, the low point right and the long fast right.
  { n: 12, dir: 'R', entry: 4315, apexes: [4385], exit: 4475, vApex: 160, bankDeg: 0, runoff: 'gravel', outsideWall: 'tyres', sausage: false, minClear: 22, cutZone: false },
  { n: 13, dir: 'L', entry: 4480, apexes: [4580], exit: 4615, vApex: 170, bankDeg: 0, runoff: 'gravel', outsideWall: 'tyres', sausage: false, minClear: 22, cutZone: false },
  { n: 14, dir: 'R', entry: 4780, apexes: [4850], exit: 4895, vApex: 145, bankDeg: 0, runoff: 'gravel', outsideWall: 'tyres', sausage: false, minClear: 22, cutZone: false },
  { n: 15, dir: 'R', entry: 4980, apexes: [5055], exit: 5135, vApex: 210, bankDeg: 0.5, runoff: 'gravel', outsideWall: 'armco', sausage: false, minClear: 28, cutZone: false },
  // Flat-out uphill lefts through the forest back towards the paddock.
  { n: 16, dir: 'L', entry: 5680, apexes: [5720, 5815], exit: 5830, vApex: 300, bankDeg: 0, runoff: 'asphalt', outsideWall: 'armco', sausage: false, minClear: 20, cutZone: false },
  { n: 17, dir: 'L', entry: 6020, apexes: [6055], exit: 6135, vApex: 300, bankDeg: 0, runoff: 'gravel', outsideWall: 'tecpro', sausage: false, minClear: 35, cutZone: false },
  // Final right-left chicane (the obvious cut) before the start straight.
  { n: 18, dir: 'R', entry: 6595, apexes: [6625], exit: 6652, vApex: 80, bankDeg: 0, runoff: 'painted', gravelFrom: 6640, outsideWall: 'tecpro', sausage: true, minClear: 18, cutZone: true },
  { n: 19, dir: 'L', entry: 6652, apexes: [6685], exit: 6725, vApex: 75, bankDeg: 0, runoff: 'painted', outsideWall: 'armco', sausage: true, minClear: 16, cutZone: true },
];

export const ARDENNES: TrackAuthoring = {
  id: 'ardennes',
  name: { tr: 'Ardenler Orman Circuit', en: 'Ardennes Forest Circuit' },
  OSM_LENGTH: 7003.5,
  CORNERS,
  WIDTHS: [
    { from: 0, to: 7003.5, hw: 7 },
    { from: 6740, to: 225, hw: 8 },
    { from: 225, to: 320, hw: 7 },
    { from: 880, to: 1210, hw: 7.5 },
    { from: 2150, to: 2440, hw: 8 },
    { from: 6540, to: 6740, hw: 7 },
  ],
  WIDTH_BLEND: 40,
  // The OSM hairpin after the line is ≈ 14 m radius: re-drawn as a 22 m arc between its approach and exit tangents
  // (tracks-spa.md §3), so the 19.5 m centreline limiter leaves it alone.
  CENTRE_FILLETS: [{ from: 170, to: 370, r: 22 }, { from: 6560, to: 6652, r: 21 }],
  // EU-DEM over a dense spruce canopy: a ±125 m running median, then σ 50 m. Built: 100.6 m range, the climb after the
  // valley dip peaks at 12 %, the descent after T9 at 15.8 % (σ 35 gives 18.6 % there; tracks-spa.md §5).
  ELEVATION_SIGMA: 50,
  ELEVATION_MEDIAN: 5,
  SECTOR2_S: 2200,
  SECTOR3_S: 5150,
  SPEED_TRAP_S: 2150,
  DRS_ZONES: [
    { id: 0, detect: 6560, activate: 6800, end: 200 },
    { id: 1, detect: 700, activate: 1320, end: 2200 },
  ],
  PIT: {
    // Lane positions (sp) include the re-drawn entry below (+116 m over the OSM pit way).
    limitStartSp: 236,
    limitEndSp: 756,
    speedLimitKmh: 80,
    firstBoxSp: 406,
    boxSpacing: 26,
    fastLaneMainD: 14.5,
    workingLaneMainD: 20,
    garageFrontMainD: 24.5,
    pitWallFaceMainD: 11.5,
    pitWallThickness: 0.5,
    wideHalfWidth: 5.25,
    narrowHalfWidth: 3.5,
    straightFrom: 6860,
    straightTo: 175,
    endBlend: 30,
    // The pit exit cuts behind the T1 hairpin (nearest main s jumps ≈ 120 m there).
    projectWindow: 160,
    // The OSM pit way branches off between the two halves of the final chicane (T18 exit, a 21 m right-hander):
    // unreachable for a car braking from 300 km/h (pitAuto ran wide at the T18 exit and hit the lane nose). The entry
    // now leaves the right edge on the straight 75 m before the chicane and joins the OSM way 40 m in.
    entryRedraw: { fromS: 6520, joinSp: 40 },
    // The exit hairpin behind T1 (R ≈ 21 m): no pit wall 2 m off its outside edge (cars leaving the pits scraped it).
    wallClearOfBends: true,
    side: -1,
  },
  GRID: { first: 12, spacing: 8, d: 2.4, slots: 20, poleSide: -1 },
  VERGE: { straight: 8, mainStraightOpp: 6, mainStraightFrom: 6740, mainStraightTo: 225, inside: 6 },
  KERB: { inside: 1.2, exit: 1.8, astroturf: 2, sausage: 0.4, sausageGap: 2.5, gravelAsphalt: 3 },
  SPECTATOR_WALLS: [
    { from: 6560, to: 330, side: 1 },
    { from: 520, to: 1180, side: 1 },
    { from: 2240, to: 2440, side: 1 },
    { from: 6560, to: 6700, side: -1 },
  ],
  // Authored stands where OSM has none: the hill-top chicane, the double left and the final chicane.
  STANDS: [
    { from: 180, to: 255, side: 1, setback: 55, depth: 18, kind: 'grandstand' },
    { from: 2830, to: 2920, side: 1, setback: 38, depth: 18, kind: 'grandstand' },
    { from: 2250, to: 2330, side: 1, setback: 28, depth: 16, kind: 'bleachers' },
    { from: 3700, to: 3800, side: -1, setback: 45, depth: 14, kind: 'bleachers' },
    { from: 6580, to: 6650, side: 1, setback: 26, depth: 16, kind: 'grandstand' },
  ],
  // Rain collects in the valley dip, the second hairpin, the low point and the final chicane.
  PUDDLES: [
    { s: 905, d: 4, len: 18, width: 2.6 },
    { s: 2950, d: -5, len: 14, width: 2.2 },
    { s: 4850, d: 5, len: 16, width: 2.4 },
    { s: 6620, d: -4, len: 12, width: 2.0 },
    { s: 4400, d: -4, len: 12, width: 2.0 },
  ],
  EXTRA_WALLS: [],
  TRACKSIDE: {
    boardStraights: [
      { from: 6740, to: 215, side: 1 },
      { from: 1250, to: 2200, side: 1 },
      { from: 1250, to: 2200, side: -1 },
      { from: 3250, to: 3600, side: -1 },
      { from: 5200, to: 5650, side: 1 },
      { from: 6150, to: 6560, side: 1 },
      { from: 6150, to: 6560, side: -1 },
    ],
    gantries: [1750, 5450],
    distanceBoardCorners: [{ n: 1, side: 1 }, { n: 5, side: 1 }, { n: 8, side: 1 }, { n: 18, side: 1 }],
    wordmarkCorners: [1, 18],
  },
  // The real pit building and the 200 m paddock block beside the descent (blank walls; the procedural pit building and
  // paddock replace them).
  HIDE_FEATURES: [77352246, 77352249],
  THEME: {
    ground: 'green',
    forestMix: [0, 0, 0.1, 0.35, 0.55],
    forestSpacing: 6.5,
    openTreeSpacing: 12,
    openMix: [0, 0, 0.15, 0.5, 0.35],
    treeSetback: 14,
    maxTrees: 60000,
    lights: { height: 18, spacing: 30, bothSides: false, head: 'flood' },
    backdrop: 'residential',
    sea: null,
  },
};
