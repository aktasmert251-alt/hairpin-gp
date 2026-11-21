// Sim layer: the Desert Cliff raw track (docs/design/tracks-cliff.md §2–§5), generated from the authored geometry in
// authoring/cliff-ctrl.ts (no map data). Deterministic, no three/DOM, built once at import.

import { ATTRIBUTION, RAMP, cliffElevation, desertField, filletPolygon, pitPolyline } from '../authoring/cliff-ctrl';
import type { RawTrack } from './raw';

const sst = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const r2 = (v: number): number => Math.round(v * 100) / 100;

function buildCliffRaw(): RawTrack {
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
  for (let s = 0; s < L; s += 5) {
    es.push(s);
    ey.push(r2(cliffElevation(s)));
  }

  // ---- terrain: escarpment field, eased onto the road level within 18–70 m of the track (a narrow ledge keeps the
  // cliffs sheer) except under the elevated ramp ----
  const STEP = 25, SIZE = 7000;
  const n = SIZE / STEP + 1;
  const x0 = Math.round((145 - SIZE / 2) / STEP) * STEP;
  const z0 = Math.round((-450 - SIZE / 2) / STEP) * STEP;
  const tx: number[] = [], tz: number[] = [], ty: number[] = [];
  for (let s = 0; s < L; s += 5) {
    if (s > RAMP.from + 40 && s < RAMP.to - 40) continue; // the deck floats: no embankment under it
    tx.push(poly[s]![0]);
    tz.push(poly[s]![1]);
    ty.push(cliffElevation(s));
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
  const nearest = (x: number, z: number): { d: number; y: number } => {
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
      const field = desertField(x, -z);
      const t = nearest(x, z);
      const yy = t.d < Infinity ? t.y + (field - t.y) * sst(18, 70, t.d) : field;
      y[j * n + i] = Math.round(yy * 10) / 10;
    }
  }

  return {
    version: 1,
    source: 'authored',
    attribution: ATTRIBUTION.slice(),
    origin: { nodeId: 0, lat: 24.6, lon: 46.2 },
    projection: { phiDeg: 24.6, mLat: 110800, mLon: 101200 },
    main: { closed: true, length: r2(mainLen), xz: main.map(([a, b]) => [a, b]) },
    pit: { length: r2(pitLen), xz: pit.map(([a, b]) => [r2(a), r2(b)]) },
    elevation: { ref: 0, step: 5, s: es, y: ey },
    pitElevation: null,
    terrain: { x0, z0, step: STEP, nx: n, nz: n, y },
    features: [],
  };
}

export const CLIFF_RAW: RawTrack = buildCliffRaw();
