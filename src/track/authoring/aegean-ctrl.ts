// Aegean Islands authored geometry (docs/design/tracks-aegean.md §2–§5): the fillet-polygon centreline in map metres
// (E east, N north; world x = E, z = −N), the pit lane as main-frame (s, d) control points, the authored elevation
// profile y(s), the island / sea-floor field, and the over-sea spans that become bridge decks.

import { filletBuild, pitPolyline as pitPolylineSD, type FilletArc } from './fillet';

/** Fillet-polygon vertices (E, N, corner radius), driving order (clockwise). S/F at (0, 0) heading north. */
export const CTRL: readonly (readonly [number, number, number])[] = [
  [0, 720, 54], [216, 880, 81], [342, 1116, 63], [1035, 1089, 144], [1179, 954, 63], [1323, 999, 54], [1422, 882, 54],
  [1557, 864, 63], [1720, 300, 600], [1700, -80, 70], [1590, -250, 60], [1660, -500, 32], [810, -560, 810], [324, -387, 63],
  [207, -470, 40], [18, -470, 40],
];

export function filletPolygon(step = 1): [number, number][] {
  return filletBuild(CTRL, step).pts;
}

export function filletArcs(): FilletArc[] {
  return filletBuild(CTRL, 1).arcs;
}

/** Polygon-basis loop length (m), rounded; the authoring table's OSM_LENGTH. */
export const BASE_LENGTH = 6089;

/** Sea level (m, relative to the S/F on the main island). */
export const SEA_Y = -4;

/** Pit lane (right, inland on the main island): leaves the right edge 90 m after T16 (a straight run-in), beside the start straight, rejoins
 *  before the causeway. Main-frame (s, d), d +left. */
export const PIT_SD: readonly (readonly [number, number])[] = [
  [5760, -7.5], [5805, -11], [5855, -15], [5910, -17.25], [6050, -17.25], [110, -17.25], [160, -14], [195, -10.5], [225, -7.5],
];

export function pitPolyline(poly: readonly (readonly [number, number])[]): [number, number][] {
  return pitPolylineSD(poly, PIT_SD);
}

/** Feature ranges on the polygon basis: the cable-stayed bridge (pylons at s), the floating pontoon along the
 *  breakwater, the tunnel through the island headland, the long sweeping bridge. */
export const CABLE_BRIDGE = { from: 1330, to: 1850, pylons: [1500, 1680] } as const;
export const PONTOON = { from: 2700, to: 3380 } as const;
export const TUNNEL = { from: 3775, to: 3895 } as const;
export const LONG_BRIDGE = { from: 4040, to: 5230 } as const;

/** Authored centreline elevation (s, y) on the polygon basis, linear between rows (smoothed by the build). */
export const ELEV: readonly (readonly [number, number])[] = [
  [0, 0], [240, 0], [330, -1], [600, -1], [700, 1], [1000, 7], [1250, 6], [1340, 7], [1590, 19], [1840, 6], [1990, 5],
  [2150, 6], [2300, 3], [2420, 6], [2600, 4], [2700, 0], [2760, -1.8], [3330, -1.8], [3430, 1], [3550, 8], [3740, 11],
  [3900, 10], [3970, 6], [4060, 4], [4600, 8], [5200, 4], [5300, 2], [6089, 0],
];

/** Islands: centre (E, N), radii, summit height above the S/F, ruggedness 0..1 (rocky headlands). */
export const ISLANDS: readonly { e: number; n: number; re: number; rn: number; h: number; rock: number }[] = [
  { e: 160, n: -100, re: 340, rn: 420, h: 24, rock: 0.2 }, // main island: paddock, harbour, village on the hill
  { e: 180, n: 930, re: 330, rn: 330, h: 48, rock: 0.3 }, // windmill island
  { e: 1110, n: 1015, re: 150, rn: 115, h: 12, rock: 0.4 }, // islet C
  { e: 1480, n: 900, re: 140, rn: 95, h: 14, rock: 0.4 }, // islet D
  { e: 1675, n: -300, re: 240, rn: 260, h: 40, rock: 0.8 }, // rocky headland island (tunnel)
  { e: 880, n: 260, re: 150, rn: 120, h: 26, rock: 0.5 }, // chapel islet inside the loop
  { e: -900, n: 350, re: 420, rn: 520, h: 120, rock: 0.6 }, // far islands on the horizon
  { e: 2700, n: 900, re: 520, rn: 420, h: 150, rock: 0.6 },
  { e: 600, n: -1700, re: 700, rn: 380, h: 170, rock: 0.6 },
  { e: -300, n: 2100, re: 600, rn: 400, h: 140, rock: 0.6 },
];

/** Island villages (white cubic houses, blue domes): centre (E, N), radius, house count. Windmills on the ridge. */
export const VILLAGES: readonly { e: number; n: number; r: number; count: number }[] = [
  { e: 260, n: -160, r: 150, count: 60 },
  { e: 230, n: 1000, r: 130, count: 45 },
  { e: 870, n: 260, r: 70, count: 10 },
];
export const WINDMILLS: readonly (readonly [number, number])[] = [[120, 1040], [190, 1075], [260, 1100], [330, 1110]];
/** Harbour on the main island's south shore below T15–T16: quay from E e0…e1 (coast found scanning south from N
 *  nFrom), the mole round to the lighthouse. */
export const HARBOUR = { e0: -100, e1: 280, nFrom: -490, lighthouse: [240, -690] } as const;

const ss = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function vnoise(x: number, y: number): number {
  const h = (i: number, j: number): number => {
    const v = Math.sin(i * 127.1 + j * 311.7) * 43758.5453;
    return v - Math.floor(v);
  };
  const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  return (h(i, j) * (1 - u) + h(i + 1, j) * u) * (1 - v) + (h(i, j + 1) * (1 - u) + h(i + 1, j + 1) * u) * v;
}

/** Normalised island distance (< 1 on land) of the nearest island, with a ragged coastline, and that island. */
function islandAt(e: number, n: number): { t: number; k: number } {
  let best = Infinity, bk = 0;
  ISLANDS.forEach((I, k) => {
    const ang = Math.atan2(n - I.n, e - I.e);
    const rag = 1 + 0.09 * (vnoise(Math.cos(ang) * 3 + k * 7, Math.sin(ang) * 3) - 0.5) * 2 + 0.05 * Math.sin(ang * 5 + k);
    const t = Math.hypot((e - I.e) / I.re, (n - I.n) / I.rn) / rag;
    if (t < best) { best = t; bk = k; }
  });
  return { t: best, k: bk };
}

/** Terrain field (m, relative to the S/F): islands rising from sandy coves, a shallow shelf around them falling to
 *  the deep sea floor. */
export function islandField(e: number, n: number): number {
  const { t, k } = islandAt(e, n);
  const I = ISLANDS[k]!;
  if (t < 1) {
    const u = 1 - t; // 0 at the coast, 1 at the summit
    const prof = Math.pow(ss(0, 1, u), 0.8 + 0.6 * I.rock);
    const rough = I.rock * 6 * (vnoise(e / 40, n / 40) - 0.5) * ss(0, 0.3, u);
    return SEA_Y + 0.6 + (I.h - SEA_Y) * prof + rough;
  }
  // Shallow turquoise shelf up to ≈ 150 m off the coast, then the deep sea floor.
  const off = (t - 1) * Math.min(I.re, I.rn);
  return SEA_Y - 0.6 - 7 * ss(0, 60, off) - 30 * ss(80, 400, off);
}

/** The rock above the tunnel (added to the corridor-relative terrain over the bore). */
export function tunnelRidge(e: number, n: number): number {
  return 32 * Math.exp(-(((e - 1630) / 90) ** 2) - (((n + 400) / 150) ** 2));
}

/** Polygon-basis s ranges over the sea (the build turns them into bridge decks), merged, ≥ 40 m, padded 15 m. */
export function seaSpans(): { from: number; to: number }[] {
  const poly = filletPolygon(1);
  const out: { from: number; to: number }[] = [];
  let a = -1;
  for (let s = 0; s <= poly.length; s += 2) {
    const p = poly[s % poly.length]!;
    const sea = s < poly.length && islandField(p[0], -p[1]) < SEA_Y + 0.5;
    if (sea && a < 0) a = s;
    if (!sea && a >= 0) {
      if (s - a >= 40) {
        const prev = out[out.length - 1];
        if (prev && a - 15 - prev.to < 60) prev.to = s + 15;
        else out.push({ from: Math.max(0, a - 15), to: s + 15 });
      }
      a = -1;
    }
  }
  return out;
}

/** TrackData.attribution. */
export const ATTRIBUTION: readonly string[] = [
  'Aegean Islands Circuit: original fictional layout, islands and scenery by the HAIRPIN GP team (procedural, no map data).',
];
