// Alpine Pass authored geometry (docs/design/tracks-alpine.md §2–§5): the fillet-polygon centreline in map metres
// (E east, N north; world x = E, z = −N), the pit lane as main-frame (s, d) control points, the authored elevation
// profile y(s) and the procedural terrain field. Pure data + functions (geometry helpers in fillet.ts).

import { filletBuild, pitPolyline as pitPolylineSD, xzFromSD, type FilletArc } from './fillet';

/** Fillet-polygon vertices (E, N, corner radius), driving order (clockwise). S/F at (0, 0) heading west. */
export const CTRL: readonly (readonly [number, number, number])[] = [
  [-560, 0, 30], [-560, 250, 70], [-774, 430, 160], [-797, 689, 170], [-981, 873, 160], [-981, 1113, 36],
  [-95, 957, 240], [181, 1005, 220], [477, 653, 130], [1214, 583, 24], [1211, 533, 24], [961, 533, 50],
  [879, 308, 45], [682, 273, 60], [572, 82, 90], [347, 0, 160],
];

/** Tangent arcs at each vertex joined by straights, sampled every `step` m from (0, 0) (closing point omitted).
 *  Returns world (x, z) = (E, −N). */
export function filletPolygon(step = 1): [number, number][] {
  return filletBuild_(step).pts;
}

/** Arc (corner) ranges on the polygon basis: start / end s (m), signed turn (deg, + left in map view), radius. */
export function filletArcs(): { s0: number; s1: number; turn: number; r: number }[] {
  return filletBuild_(1).arcs;
}

function filletBuild_(step: number): { pts: [number, number][]; arcs: FilletArc[] } {
  return filletBuild(CTRL, step);
}

/** Polygon-basis loop length (m), rounded; the authoring table's OSM_LENGTH. */
export const BASE_LENGTH = 5649;

/** Pit lane control points (main s on the polygon basis, d +left; the pit is on the right), Catmull–Rom at 1 m. */
export const PIT_SD: readonly (readonly [number, number])[] = [
  [5150, -7.5], [5205, -11], [5270, -15.5], [5340, -17.25], [5600, -17.25], [150, -17.25], [245, -14.5], [300, -10.5], [345, -7.5],
];

/** The bored tunnel (polygon-basis s range) on the straight between T6 and T7. */
export const TUNNEL = { from: 2020, to: 2230 } as const;

/** Authored centreline elevation (s, y) on the polygon basis, linear between rows (smoothed by the build). */
export const ELEV: readonly (readonly [number, number])[] = [
  [0, 0], [480, 0], [600, 1.5], [830, 13], [1640, 57], [1834, 63], [2649, 86], [2732, 86], [3073, 68], [3353, 40],
  [3454, 31], [4118, 13], [4196, 12], [4873, 6], [5096, 3], [5330, 0.3], [5649, 0],
];

/** Lake surface y (relative to S/F) and the lake's map extent (E0, E1, N1 = north shore line, N0 = south shore). */
export const LAKE = { y: -2.6, e0: -2600, e1: 2600, nNorth: -55, nSouth: -1500 } as const;

/** Villages: centre (E, N), radius, chalet count. Cable car: valley station (E, N) → mountain station (E, N, height). */
export const VILLAGES: readonly { e: number; n: number; r: number; count: number }[] = [
  { e: -150, n: 420, r: 170, count: 38 },
  { e: -880, n: 60, r: 120, count: 18 },
  { e: 1180, n: 190, r: 140, count: 22 },
];
export const CABLE = { from: [-60, 360], to: [-520, 2350] } as const;

const sst = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Smooth deterministic value noise (no Math.random). */
function vnoise(x: number, y: number): number {
  const h = (i: number, j: number): number => {
    const s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453;
    return s - Math.floor(s);
  };
  const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  return (h(i, j) * (1 - u) + h(i + 1, j) * u) * (1 - v) + (h(i, j + 1) * (1 - u) + h(i + 1, j + 1) * u) * v;
}

/** Ridged fbm 0..1 (sharp crests) for the mountain massifs. */
function ridged(x: number, y: number): number {
  let s = 0, a = 0.5, f = 1;
  for (let k = 0; k < 5; k++) {
    s += a * (1 - Math.abs(2 * vnoise(x * f + k * 17.3, y * f - k * 9.1) - 1)) ** 2;
    f *= 2.03;
    a *= 0.5;
  }
  return s;
}

/** Valley / mountain field (m, relative to S/F) at map (E, N), without the track corridor: the lake basin in the
 *  south, the valley floor rising north to the pass, the massif behind it and the far shore mountains. */
export function mountainField(e: number, n: number): number {
  const valley = 78 * sst(-60, 1150, n) + 0.32 * Math.max(0, n - 1100) + 520 * sst(1600, 3400, n) * (0.55 + 0.6 * ridged(e / 900, n / 900));
  const lake = -16 * sst(-50, -200, n) * (1 - sst(1700, 2600, Math.abs(e)));
  const farShore = 650 * sst(-1500, -2900, n) * (0.5 + 0.7 * ridged(e / 800 + 7, n / 800));
  const flanks = 560 * sst(1400, 3000, Math.abs(e)) * (0.45 + 0.75 * ridged(e / 700 - 3, n / 700));
  const rough = 22 * (vnoise(e / 260, n / 260) - 0.5) + 8 * (vnoise(e / 90 + 3, n / 90) - 0.5);
  return valley + lake + farShore + flanks + rough * sst(-40, 300, n);
}

/** The rock spur the tunnel is bored through (added on top of the corridor-relative terrain). */
export function tunnelRidge(e: number, n: number): number {
  return 46 * Math.exp(-(((e + 660) / 105) ** 2)) * sst(880, 1010, n) * (1 - sst(1250, 1500, n));
}

/** Pit polyline in world (x, z): Catmull–Rom through PIT_SD at about 1 m. */
export function pitPolyline(poly: readonly (readonly [number, number])[]): [number, number][] {
  return pitPolylineSD(poly, PIT_SD);
}

export { xzFromSD };

/** TrackData.attribution. */
export const ATTRIBUTION: readonly string[] = [
  'Alpine Pass Circuit: original fictional layout, terrain and scenery by the HAIRPIN GP team (procedural, no map data).',
];
