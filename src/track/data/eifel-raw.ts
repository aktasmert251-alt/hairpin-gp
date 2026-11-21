// Sim layer: the Eifel Forest Ring raw track (docs/design/tracks-eifel.md), generated from the authored geometry in
// authoring/eifel-ctrl.ts (no map data). Built lazily on first use (≈ 10 × 10 km terrain): importing the registry stays
// cheap for every other track and for the server. Deterministic, no three/DOM.

import { ATTRIBUTION, SITES, eifelPath, elevationAt, hillRelief, pitPolyline, tagS, vnoise, xzFromSD } from '../authoring/eifel-ctrl';
import type { RawFeature, RawTrack } from './raw';

const sst = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const r2 = (v: number): number => Math.round(v * 100) / 100;

/** DEM: 50 m grid, 10.2 km square around the layout. */
export const EIFEL_DEM = { step: 50, size: 10200 } as const;

/** Irregular closed ring (raw x, z) around (cx, cz): radius r · (0.75…1.25), `n` vertices. */
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

/** World (x, z) of a SITES entry. */
export function siteXZ(tag: string, off: number, d: number): [number, number] {
  return xzFromSD(eifelPath().pts, tagS(tag, off), d);
}

function buildEifelRaw(): RawTrack {
  const b = eifelPath();
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

  const es: number[] = [];
  const ey: number[] = [];
  for (let s = 0; s < L; s += 10) {
    es.push(s);
    ey.push(r2(elevationAt(b, s)));
  }

  // ---- terrain: a surface that follows the road (inverse-distance weighted road heights) plus rolling hills away from
  // it, eased exactly onto the road level near the track; the castle hill on top ----
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [x, z] of poly) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
  }
  const { step: STEP, size: SIZE } = EIFEL_DEM;
  const n = SIZE / STEP + 1;
  const x0 = Math.round(((minX + maxX) / 2 - SIZE / 2) / STEP) * STEP;
  const z0 = Math.round(((minZ + maxZ) / 2 - SIZE / 2) / STEP) * STEP;
  const tx: number[] = [], tz: number[] = [], ty: number[] = [];
  for (let s = 0; s < L; s += 20) {
    tx.push(poly[s]![0]);
    tz.push(poly[s]![1]);
    ty.push(elevationAt(b, s));
  }
  const M = tx.length;
  const [cX, cZ] = siteXZ(SITES.castle.tag, SITES.castle.off, SITES.castle.d);
  const vill = siteXZ(SITES.village.tag, SITES.village.off, SITES.village.d);
  const y: number[] = new Array<number>(n * n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = x0 + i * STEP, z = z0 + j * STEP;
      let ws = 0, wy = 0, d2min = Infinity, yNear = 0;
      for (let k = 0; k < M; k++) {
        const d2 = (tx[k]! - x) ** 2 + (tz[k]! - z) ** 2;
        if (d2 < d2min) { d2min = d2; yNear = ty[k]!; }
        const u = d2 + 3600;
        const w = 1 / (u * Math.sqrt(u));
        ws += w;
        wy += w * ty[k]!;
      }
      const d = Math.sqrt(d2min);
      const field = wy / ws + hillRelief(x, z) * sst(60, 700, d);
      let yy = yNear + (field - yNear) * sst(25, 220, d);
      // The castle hill (a rounded knoll with a flat top) and a level village green.
      const dc = Math.hypot(x - cX, z - cZ);
      yy += SITES.castle.hill * Math.exp(-((dc / 260) ** 2)) * sst(40, 160, d);
      const dv = Math.hypot(x - vill[0], z - vill[1]);
      yy += (yNear - yy) * (1 - sst(SITES.village.r, SITES.village.r + 200, dv)) * 0.6;
      y[j * n + i] = Math.round(yy * 10) / 10;
    }
  }

  // ---- features: forest blobs everywhere except meadows, the village, the castle hill top and the camp clearings ----
  const features: RawFeature[] = [];
  let id = 1;
  const clear: [number, number, number][] = [
    [vill[0], vill[1], SITES.village.r + 40],
    [cX, cZ, SITES.castle.r + 40],
    ...SITES.camps.map((c): [number, number, number] => [...siteXZ(c.tag, c.off, c.d), c.r]),
  ];
  const G = 170;
  for (let gz = z0 + 400; gz <= z0 + SIZE - 400; gz += G) {
    for (let gx = x0 + 400; gx <= x0 + SIZE - 400; gx += G) {
      const h = Math.sin(gx * 0.0123 + gz * 0.0371) * 43758.5453;
      const jit = h - Math.floor(h);
      const cx = gx + (jit - 0.5) * 90, cz = gz + (0.5 - jit) * 70;
      if (clear.some(([ax, az, r]) => Math.hypot(ax - cx, az - cz) < r + 90)) continue;
      // Meadows: low-frequency noise leaves ≈ 25 % open; the GP loop's paddock side stays open.
      const m = vnoise(cx / 900 + 11.3, cz / 900 - 4.1) * 0.7 + vnoise(cx / 300 - 2.2, cz / 300 + 7.7) * 0.3;
      if (m < 0.36) continue;
      if (cx > -300 && cx < 1400 && cz > -300 && cz < 1300) continue;
      features.push({ kind: 'forest', id: id++, xz: blobRing(cx, cz, 115 + 40 * jit, 10, id) });
    }
  }

  return {
    version: 1,
    source: 'authored',
    attribution: ATTRIBUTION.slice(),
    origin: { nodeId: 0, lat: 50.3, lon: 6.9 },
    projection: { phiDeg: 50.3, mLat: 111132, mLon: 71240 },
    main: { closed: true, length: r2(mainLen), xz: main.map(([a, c]) => [a, c]) },
    pit: { length: r2(pitLen), xz: pit.map(([a, c]) => [r2(a), r2(c)]) },
    elevation: { ref: 0, step: 10, s: es, y: ey },
    pitElevation: null,
    terrain: { x0, z0, step: STEP, nx: n, nz: n, y },
    features,
  };
}

let raw: RawTrack | null = null;
/** The raw track, built on first use. */
export function eifelRaw(): RawTrack {
  return (raw ??= buildEifelRaw());
}
