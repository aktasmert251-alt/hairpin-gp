// Sim layer: the Cappadocia Valley raw track (docs/design/tracks-cappadocia.md), generated from the authored geometry
// in authoring/cappadocia-ctrl.ts (no map data). Built lazily on first use. Deterministic, no three/DOM.

import { ATTRIBUTION, SITES, cappPath, elevTable, elevationAt, pitPolyline, tagS, valleyRelief, xzFromSD } from '../authoring/cappadocia-ctrl';
import type { RawTrack } from './raw';

const sst = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const r2 = (v: number): number => Math.round(v * 100) / 100;

/** DEM: 20 m grid, 4.4 km square around the layout. */
export const CAPP_DEM = { step: 20, size: 4400 } as const;

/** World (x, z) of a site given by (tag, off, d). */
export function cappSiteXZ(tag: string, off: number, d: number): [number, number] {
  return xzFromSD(cappPath().pts, tagS(tag, off), d);
}

function buildCappadociaRaw(): RawTrack {
  const b = cappPath();
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

  // ---- terrain: a surface following the road (inverse-distance weighted road heights), eased exactly onto the road
  // near the track, with the terraced tuff valley walls rising away from it and the castle pinnacle on top ----
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [x, z] of poly) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
  }
  const { step: STEP, size: SIZE } = CAPP_DEM;
  const n = SIZE / STEP + 1;
  const x0 = Math.round(((minX + maxX) / 2 - SIZE / 2) / STEP) * STEP;
  const z0 = Math.round(((minZ + maxZ) / 2 - SIZE / 2) / STEP) * STEP;
  const tx: number[] = [], tz: number[] = [], ty: number[] = [];
  for (let s = 0; s < L; s += 15) {
    tx.push(poly[s]![0]);
    tz.push(poly[s]![1]);
    ty.push(elevationAt(b, s, et));
  }
  const M = tx.length;
  const [cX, cZ] = cappSiteXZ(SITES.castle.tag, SITES.castle.off, SITES.castle.d);
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
      const field = wy / ws + valleyRelief(x, z, d);
      let yy = yNear + (field - yNear) * sst(20, 120, d);
      // The castle pinnacle: a steep rounded tuff cone with a flat crown.
      const dc = Math.hypot(x - cX, z - cZ);
      yy += SITES.castle.hill * (1 - sst(25, 150, dc)) * sst(30, 120, d);
      y[j * n + i] = Math.round(yy * 10) / 10;
    }
  }

  return {
    version: 1,
    source: 'authored',
    attribution: ATTRIBUTION.slice(),
    origin: { nodeId: 0, lat: 38.6, lon: 34.8 },
    projection: { phiDeg: 38.6, mLat: 111020, mLon: 86960 },
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
export function cappadociaRaw(): RawTrack {
  return (raw ??= buildCappadociaRaw());
}
