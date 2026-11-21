// Desert Cliff authored geometry (docs/design/tracks-cliff.md §2–§5): the fillet-polygon centreline in map metres
// (E east, N north; world x = E, z = −N), the pit lane as main-frame (s, d) control points, the authored elevation
// profile y(s) (the T1 ramp, the plunge, the canyon descent) and the procedural escarpment / canyon terrain field.

import { filletBuild, pitPolyline as pitPolylineSD, type FilletArc } from './fillet';

/** Fillet-polygon vertices (E, N, corner radius), driving order (anti-clockwise). S/F at (0, 0) heading east. */
export const CTRL: readonly (readonly [number, number, number])[] = [
  [1000, 0, 45], [1100, -180, 26], [1350, 380, 150], [1220, 860, 60], [1020, 880, 50], [900, 1000, 45], [860, 1110, 45],
  [450, 1180, 140], [100, 1060, 140], [-280, 1180, 140], [-900, 1150, 40], [-950, 850, 70], [-800, 650, 70], [-950, 420, 55],
  [-860, 220, 45], [-1060, 40, 35], [-1000, -220, 28], [-650, -180, 110], [-480, -280, 90], [-360, -180, 50], [-320, -10, 40],
];

export function filletPolygon(step = 1): [number, number][] {
  return filletBuild(CTRL, step).pts;
}

export function filletArcs(): FilletArc[] {
  return filletBuild(CTRL, 1).arcs;
}

/** Polygon-basis loop length (m), rounded; the authoring table's OSM_LENGTH. */
export const BASE_LENGTH = 7233;

/** Pit lane control points (main s on the polygon basis, d +left; the pit is on the left, inland): the lane leaves
 *  the left edge after T20, swings round the outside of T21 and runs beside the start straight to before the ramp. */
export const PIT_SD: readonly (readonly [number, number])[] = [
  [6790, 7.5], [6835, 11], [6885, 15], [6960, 17.25], [7150, 17.25], [120, 17.25], [190, 14], [235, 10.5], [270, 7.5],
];

export function pitPolyline(poly: readonly (readonly [number, number])[]): [number, number][] {
  return pitPolylineSD(poly, PIT_SD);
}

/** Elevated structure (polygon basis): the ramp up to T1, the cantilevered T1–T2 platform over the escarpment, the
 *  plunge back down. Close concrete walls with catch fences on the ramp legs (`walls`), run-off on the platform. */
export const RAMP = { from: 300, up: 960, platformTo: 1230, to: 1940 } as const;

const ss = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Authored centreline elevation y(s) on the polygon basis (smooth by construction; the build adds σ 15 m). The
 *  smoothsteps keep the vertical curvature ≤ 1/1,300 m (the ramp crest is taken under braking, not flat out). */
export function cliffElevation(s: number): number {
  if (s < 1100) return 70 * ss(250, 960, s);
  if (s < 2100) return 70 * (1 - ss(1230, 1950, s));
  if (s < 4500) return 8 * ss(2300, 3300, s);
  if (s < 6100) return 8 - 46 * ss(4600, 5900, s);
  return -38 + 38 * ss(6150, 7000, s);
}

/** Smooth deterministic value noise (no Math.random). */
function vnoise(x: number, y: number): number {
  const h = (i: number, j: number): number => {
    const v = Math.sin(i * 127.1 + j * 311.7) * 43758.5453;
    return v - Math.floor(v);
  };
  const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  return (h(i, j) * (1 - u) + h(i + 1, j) * u) * (1 - v) + (h(i, j + 1) * (1 - u) + h(i + 1, j + 1) * u) * v;
}

/** Signed distance-like plateau membership (m, > 0 on the plateau): the main mesa (start straight, paddock, the
 *  east and north loops) and its sheer escarpment to the south and west; ragged by noise. */
export function plateauInside(e: number, n: number): number {
  const a = Math.min(e + 350, n + 70);
  const b = Math.min(e + 780, n - 620);
  return Math.max(a, b) + 18 * (vnoise(e / 120, n / 120) - 0.5) + 8 * (vnoise(e / 40 + 7, n / 40) - 0.5);
}

/** Terrain field (m, relative to S/F) without the track corridor: the plateau with low dunes, a sheer ≈ 110 m
 *  limestone escarpment, the canyon floor below it and far mesas. */
export function desertField(e: number, n: number): number {
  const inside = plateauInside(e, n);
  // Low sand ripples everywhere; tall crescent dune ridges well away from the circuit (> 700 m from the loop centre).
  const far = ss(700, 1400, Math.hypot(e - 200, n - 550));
  const ridge = (1 - Math.abs(Math.sin(e / 160 + n / 420 + 3 * vnoise(e / 500, n / 500)))) ** 2;
  const dunes = 5 * (vnoise(e / 180 + 3, n / 90) - 0.5) + 2.5 * (vnoise(e / 45, n / 30 + 5) - 0.5) + 16 * far * ridge;
  const plateau = dunes + 10 * ss(1400, 3000, Math.hypot(e - 200, n - 600));
  const canyon = -112 + 6 * (vnoise(e / 150, n / 150) - 0.5);
  const y = canyon + (plateau - canyon) * ss(-35, 0, inside);
  // Far mesas rising out of the canyon 1.5–3 km south and west.
  const mesa = 150 * ss(1500, 3000, Math.max(-n, -e - 1500)) * ss(0.45, 0.6, vnoise(e / 700, n / 700));
  return Math.max(y, canyon + mesa);
}

/** TrackData.attribution. */
export const ATTRIBUTION: readonly string[] = [
  'Desert Cliff Circuit: original fictional layout, terrain and scenery by the HAIRPIN GP team (procedural, no map data).',
];
