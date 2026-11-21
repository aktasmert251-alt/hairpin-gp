// Sim layer: the Alpine Pass raw track (docs/design/tracks-alpine.md §2–§4), generated from the authored geometry in
// authoring/alpine-ctrl.ts instead of a baked <id>.raw.json (no map data). Deterministic, no three/DOM, built once.

import { ELEV, LAKE, VILLAGES, ATTRIBUTION, filletPolygon, mountainField, pitPolyline, tunnelRidge } from '../authoring/alpine-ctrl';
import type { RawFeature, RawTrack } from './raw';

const sst = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const r2 = (v: number): number => Math.round(v * 100) / 100;

/** Authored centreline elevation at polygon-basis s (linear between ELEV rows). */
export function alpineElevation(s: number): number {
  for (let k = 0; k + 1 < ELEV.length; k++) {
    const a = ELEV[k]!, b = ELEV[k + 1]!;
    if (s <= b[0]) return a[1] + ((b[1] - a[1]) * (s - a[0])) / (b[0] - a[0]);
  }
  return ELEV[ELEV.length - 1]![1];
}

/** Irregular closed ring (raw x, z) around (cx, cz): radius r · (1 ± 0.25 noise), `n` vertices. */
function blobRing(cx: number, cz: number, r: number, n: number, seed: number): [number, number][] {
  const out: [number, number][] = [];
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2;
    const h = Math.sin(seed * 12.9898 + k * 78.233) * 43758.5453;
    const f = 0.75 + 0.5 * (h - Math.floor(h));
    out.push([Math.round(cx + Math.cos(a) * r * f), Math.round(cz + Math.sin(a) * r * f)]);
  }
  out.push(out[0]!);
  return out;
}

function buildAlpineRaw(): RawTrack {
  const poly = filletPolygon(1);
  const L = poly.length;
  const main = poly.filter((_, i) => i % 4 === 0);
  const pit1 = pitPolyline(poly);
  const pit = pit1.filter((_, i) => i % 4 === 0 || i === pit1.length - 1);
  let mainLen = 0;
  for (let i = 0; i < main.length; i++) {
    const a = main[i]!, b = main[(i + 1) % main.length]!;
    mainLen += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  let pitLen = 0;
  for (let i = 1; i < pit.length; i++) pitLen += Math.hypot(pit[i]![0] - pit[i - 1]![0], pit[i]![1] - pit[i - 1]![1]);

  const es: number[] = [];
  const ey: number[] = [];
  for (let s = 0; s < L; s += 10) {
    es.push(s);
    ey.push(r2(alpineElevation(s)));
  }

  // ---- terrain: valley field, eased onto the road level near the track, the rock spur over the tunnel ----
  const STEP = 50, SIZE = 6400;
  const n = SIZE / STEP + 1;
  const x0 = Math.round((120 - SIZE / 2) / STEP) * STEP;
  const z0 = Math.round((-560 - SIZE / 2) / STEP) * STEP;
  // Coarse track samples (x, z, y) every 5 m for the corridor blend.
  const tx: number[] = [], tz: number[] = [], ty: number[] = [];
  for (let s = 0; s < L; s += 5) {
    tx.push(poly[s]![0]);
    tz.push(poly[s]![1]);
    ty.push(alpineElevation(s));
  }
  const CELL = 100;
  const grid = new Map<number, number[]>();
  const key = (i: number, j: number): number => i * 4096 + j;
  tx.forEach((x, k) => {
    const kk = key(Math.floor(x / CELL) + 2000, Math.floor(tz[k]! / CELL) + 2000);
    let a = grid.get(kk);
    if (!a) grid.set(kk, (a = []));
    a.push(k);
  });
  const nearestTrack = (x: number, z: number): { d: number; y: number } => {
    const ci = Math.floor(x / CELL) + 2000, cj = Math.floor(z / CELL) + 2000;
    let best = Infinity, by = 0;
    for (let r = 0; r <= 3; r++) {
      for (let oj = -r; oj <= r; oj++) for (let oi = -r; oi <= r; oi++) {
        if (Math.max(Math.abs(oi), Math.abs(oj)) !== r) continue;
        for (const k of grid.get(key(ci + oi, cj + oj)) ?? []) {
          const d2 = (tx[k]! - x) ** 2 + (tz[k]! - z) ** 2;
          if (d2 < best) { best = d2; by = ty[k]!; }
        }
      }
      if (best < (r * CELL) ** 2) break;
    }
    return { d: Math.sqrt(best), y: by };
  };
  const y: number[] = new Array<number>(n * n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = x0 + i * STEP, z = z0 + j * STEP;
      const e = x, nn = -z;
      const field = mountainField(e, nn);
      const t = nearestTrack(x, z);
      const yy = t.d < Infinity ? t.y + (field - t.y) * sst(30, 230, t.d) : field;
      // The spur is cut back near the road (the 10 m terrain mesh cannot hold a wall at the edge); scenery/alpine.ts
      // closes the cut with the tunnel's rock overburden.
      y[j * n + i] = Math.round((yy + tunnelRidge(e, nn) * sst(20, 70, t.d)) * 10) / 10;
    }
  }

  // ---- features: spruce forests on the valley sides (the chalet villages are scenery/alpine.ts) ----
  const features: RawFeature[] = [];
  let id = 1;
  for (let gz = -2300; gz <= 700; gz += 170) {
    for (let gx = -2100; gx <= 2300; gx += 170) {
      const h = Math.sin(gx * 0.0123 + gz * 0.0371) * 43758.5453;
      const jit = h - Math.floor(h);
      const cx = gx + (jit - 0.5) * 90, cz = gz + (0.5 - jit) * 70;
      const e = cx, nn = -cz;
      if (nn < LAKE.nNorth + 40) continue; // the lake
      const alt = mountainField(e, nn);
      if (alt > 420) continue; // tree line
      if (VILLAGES.some((v) => Math.hypot(v.e - e, v.n - nn) < v.r + 60)) continue;
      // Clumped: low-frequency noise; denser on the slopes north of the valley floor.
      const m = Math.sin(e * 0.0042 + 1.1) * Math.cos(nn * 0.0037 - 0.4) + 0.6 * Math.sin(e * 0.0101 - nn * 0.0077) + (nn > 1150 ? 0.6 : 0);
      if (m < 0.15) continue;
      features.push({ kind: 'forest', id: id++, xz: blobRing(cx, cz, 120 + 40 * jit, 10, id) });
    }
  }

  return {
    version: 1,
    source: 'authored',
    attribution: ATTRIBUTION.slice(),
    origin: { nodeId: 0, lat: 46.5, lon: 9.0 },
    projection: { phiDeg: 46.5, mLat: 111132, mLon: 76612 },
    main: { closed: true, length: r2(mainLen), xz: main.map(([a, b]) => [a, b]) },
    pit: { length: r2(pitLen), xz: pit.map(([a, b]) => [r2(a), r2(b)]) },
    elevation: { ref: 0, step: 10, s: es, y: ey },
    pitElevation: null,
    terrain: { x0, z0, step: STEP, nx: n, nz: n, y },
    features,
  };
}

export const ALPINE_RAW: RawTrack = buildAlpineRaw();
