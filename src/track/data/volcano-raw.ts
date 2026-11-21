// Sim layer: the Volcano Rim raw track (docs/design/tracks-volcano.md), generated from the authored geometry in
// authoring/volcano-ctrl.ts (no map data). Built lazily on first use. Deterministic, no three/DOM.

import { ATTRIBUTION, BRIDGE, elevTable, elevationAt, pitPolyline, riverNear, sst, tagS, vnoise, volcPath, volcanoSites } from '../authoring/volcano-ctrl';
import type { RawTrack } from './raw';

const r2 = (v: number): number => Math.round(v * 100) / 100;

/** DEM: 20 m grid, 5.2 km square around the layout. */
export const VOLC_DEM = { step: 20, size: 5200 } as const;

/** Volcano relief (m) away from the road: the cone rising toward the crater, the crater bowl with its lava lake, the
 *  lava-river channel, the small lava cone, scoria mounds and the far ring of older volcanic hills. `base` is the
 *  road-following surface at the point, `dist` the distance to the nearest road sample. */
export function volcanoRelief(x: number, z: number, base: number, dist: number): number {
  const S = volcanoSites();
  const C = S.crater;
  const rc = Math.hypot(x - C.x, z - C.z);
  // The cone: the ground rises toward the crater ridge (stronger away from the road), lumpy lava flows on the flanks.
  const ridge = C.rimY + 12;
  const cone = ridge - Math.max(0, rc - C.rimR) * 0.16;
  let y = base + (Math.max(base, cone) - base) * sst(30, 160, dist) * sst(C.rimR + 900, C.rimR + 150, rc);
  y += (16 * (vnoise(x / 110, z / 110) - 0.5) + 8 * (vnoise(x / 37 + 3, z / 37) - 0.5)) * sst(18, 70, dist);
  // Far ring: older volcanic hills, higher away from the circuit.
  const far = sst(500, 1600, dist);
  y += far * (60 + 140 * vnoise(x / 900 + 7, z / 900 - 2) + 60 * (1 - Math.abs(Math.sin(x / 420 + z / 610))) ** 3);
  return y;
}

/** Crater bowl, lava-river channel: carved after the road blend (they reach close to the road at the rim and under the
 *  bridge), never within 14 m of a road sample. */
export function volcanoCarve(x: number, z: number, y0: number, dist: number): number {
  if (dist < 14) return y0;
  const S = volcanoSites();
  const C = S.crater;
  const rc = Math.hypot(x - C.x, z - C.z);
  const ridge = C.rimY + 12;
  let y = y0;
  // Crater: a steep inner wall from the ridge down to the lava lake (flat at lakeY).
  if (rc < C.rimR + 30) {
    const wall = C.lakeY + (ridge - C.lakeY) * sst(C.lake - 5, C.rimR - 8, rc) ** 0.6;
    const k = (1 - sst(C.rimR - 10, C.rimR + 30, rc)) * sst(14, 24, dist);
    y = y + (Math.min(y, wall) - y) * k;
    if (rc < C.lake) y = C.lakeY - 2;
  }
  // The small lava cone beside the hairpin descent (a crater of its own, lava inside).
  const O = S.cone;
  const ro = Math.hypot(x - O.x, z - O.z);
  if (ro < O.r * 2.2) {
    const h = O.y + O.h * (1 - sst(O.r * 0.55, O.r * 2.2, ro)) - O.h * 0.55 * (1 - sst(O.r * 0.2, O.r * 0.5, ro));
    y = Math.max(y, h);
  }
  // Lava-river channel: banks drop to the lava level.
  const rv = riverNear(x, z);
  if (rv.d < 90) {
    const bank = rv.y - 1.5 + Math.max(0, rv.d - 12) * 0.9;
    y = Math.min(y, bank);
  }
  return y;
}

function buildVolcanoRaw(): RawTrack {
  const b = volcPath();
  const poly = b.pts;
  const L = poly.length;
  const main = poly.filter((_, i) => i % 4 === 0);
  const pit1 = pitPolyline(poly);
  const pit = pit1.filter((_, i) => i % 4 === 0 || i === pit1.length - 1);
  let mainLen = 0;
  for (let i = 0; i < main.length; i++) {
    const a = main[i]!, c = main[(i + 1) % main.length]!;
    mainLen += Math.hypot(c[0] - a[0], c[1] - a[1]);
  }
  let pitLen = 0;
  for (let i = 1; i < pit.length; i++) pitLen += Math.hypot(pit[i]![0] - pit[i - 1]![0], pit[i]![1] - pit[i - 1]![1]);

  const et = elevTable(b);
  const es: number[] = [];
  const ey: number[] = [];
  for (let s = 0; s < L; s += 5) {
    es.push(s);
    ey.push(r2(elevationAt(b, s, et)));
  }

  // ---- terrain: road-following surface (inverse-distance weighted road heights, the bridge left out so the ground
  // stays in the river valley under the deck) + the volcano relief ----
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [x, z] of poly) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
  }
  const { step: STEP, size: SIZE } = VOLC_DEM;
  const n = SIZE / STEP + 1;
  const x0 = Math.round(((minX + maxX) / 2 - SIZE / 2) / STEP) * STEP;
  const z0 = Math.round(((minZ + maxZ) / 2 - SIZE / 2) / STEP) * STEP;
  const bf = tagS(BRIDGE[0], BRIDGE[1], b) + 25, bt = tagS(BRIDGE[2], BRIDGE[3], b) - 25;
  const tx: number[] = [], tz: number[] = [], ty: number[] = [];
  for (let s = 0; s < L; s += 15) {
    if (s > bf && s < bt) continue;
    tx.push(poly[s]![0]);
    tz.push(poly[s]![1]);
    ty.push(elevationAt(b, s, et));
  }
  const M = tx.length;
  const y: number[] = new Array<number>(n * n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = x0 + i * STEP, z = z0 + j * STEP;
      let ws = 0, wy = 0, d2min = Infinity, yNear = 0;
      for (let k = 0; k < M; k++) {
        const d2 = (tx[k]! - x) ** 2 + (tz[k]! - z) ** 2;
        if (d2 < d2min) { d2min = d2; yNear = ty[k]!; }
        const u = d2 + 2500;
        const w = 1 / (u * Math.sqrt(u));
        ws += w;
        wy += w * ty[k]!;
      }
      const d = Math.sqrt(d2min);
      const field = volcanoRelief(x, z, wy / ws, d);
      const yy = volcanoCarve(x, z, yNear + (field - yNear) * sst(16, 90, d), d);
      y[j * n + i] = Math.round(yy * 10) / 10;
    }
  }

  return {
    version: 1,
    source: 'authored',
    attribution: ATTRIBUTION.slice(),
    origin: { nodeId: 0, lat: 38.4, lon: 15.0 },
    projection: { phiDeg: 38.4, mLat: 111030, mLon: 87250 },
    main: { closed: true, length: r2(mainLen), xz: main.map(([a, c]) => [a, c]) },
    pit: { length: r2(pitLen), xz: pit.map(([a, c]) => [r2(a), r2(c)]) },
    elevation: { ref: 0, step: 5, s: es, y: ey },
    pitElevation: null,
    terrain: { x0, z0, step: STEP, nx: n, nz: n, y },
    features: [],
  };
}

let raw: RawTrack | null = null;
/** The raw track, built on first use. */
export function volcanoRaw(): RawTrack {
  return (raw ??= buildVolcanoRaw());
}
