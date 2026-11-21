// Bosphorus authored geometry (tracks.md §3.2–§3.5, §3.8): the fillet-polygon centreline in the local shore frame
// (u along the shore, v inland = left of +u), the pit lane as main-frame (s, d) control points and the elevation y(v).
// Pure data + functions with NO imports: scripts/fetch-track.mjs loads this file directly through Node type stripping.

/** Fillet-polygon vertices (u, v, corner radius), driving order. */
export const CTRL: readonly (readonly [number, number, number])[] = [
  [950, 40, 22], [950, 200, 30], [1150, 200, 25], [1150, 440, 40], [850, 440, 90], [720, 340, 90],
  [-520, 340, 50], [-740, 120, 40], [-1080, 50, 25], [-1080, 0, 25], [-700, 0, 40], [-640, 40, 40],
];

/** S/F in the local frame; the polyline starts here heading +u. */
export const SF_UV: readonly [number, number] = [0, 40];

/** Authored seawall: v = SEAWALL_V for u ∈ [−SEAWALL_U, SEAWALL_U] (track side is v > SEAWALL_V). */
export const SEAWALL_V = -14;
export const SEAWALL_U = 1150;

/** Default coast bearing β (degrees from north) and the anchor of (u, v) = (0, 0) (14 m inland of the coast). */
export const BETA_DEG = 15;
export const ANCHOR = { lat: 41.0553, lon: 29.0355 };

/** Pit lane control points (main s on the fillet polyline, d +left), Catmull–Rom at 1 m (§3.8). */
export const PIT_SD: readonly (readonly [number, number])[] = [[4600, 7.5], [4660, 12], [4720, 16], [380, 16], [450, 12], [520, 7.5]];

/** Street elevation (§3.5): y(v) = 20 · smoothstep(80, 420, v) m; the seawall top is 0, the sea plane −2. */
export function elevationAtV(v: number): number {
  const t = Math.min(1, Math.max(0, (v - 80) / 340));
  return 20 * t * t * (3 - 2 * t);
}

/** Tangent arcs at each vertex joined by straights, sampled every `step` m, starting at SF_UV (closing point omitted). */
export function filletPolygon(ctrl: readonly (readonly [number, number, number])[], step = 1): [number, number][] {
  const n = ctrl.length;
  // Per vertex: arc start/end, centre, radius, signed sweep.
  const arcs = ctrl.map((p, i) => {
    const a = ctrl[(i - 1 + n) % n]!;
    const b = ctrl[(i + 1) % n]!;
    const ix = p[0] - a[0], iz = p[1] - a[1];
    const ox = b[0] - p[0], oz = b[1] - p[1];
    const li = Math.hypot(ix, iz), lo = Math.hypot(ox, oz);
    const dix = ix / li, diz = iz / li, dox = ox / lo, doz = oz / lo;
    const turn = Math.atan2(dix * doz - diz * dox, dix * dox + diz * doz); // + = left (toward +v of the heading)
    const t = p[2] * Math.tan(Math.abs(turn) / 2);
    const sx = p[0] - dix * t, sz = p[1] - diz * t;
    const sgn = Math.sign(turn);
    // Centre: left normal of the incoming direction is (−diz, dix).
    const cx = sx - diz * p[2] * sgn, cz = sz + dix * p[2] * sgn;
    return { sx, sz, ex: p[0] + dox * t, ez: p[1] + doz * t, cx, cz, r: p[2], turn };
  });
  const out: [number, number][] = [];
  let carry = 0;
  const line = (x0: number, z0: number, x1: number, z1: number): void => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    let s = carry;
    for (; s < len; s += step) out.push([x0 + ((x1 - x0) * s) / len, z0 + ((z1 - z0) * s) / len]);
    carry = s - len;
  };
  const arc = (k: number): void => {
    const A = arcs[k]!;
    const a0 = Math.atan2(A.sz - A.cz, A.sx - A.cx);
    const len = Math.abs(A.turn) * A.r;
    let s = carry;
    for (; s < len; s += step) {
      const a = a0 + Math.sign(A.turn) * (s / A.r);
      out.push([A.cx + A.r * Math.cos(a), A.cz + A.r * Math.sin(a)]);
    }
    carry = s - len;
  };
  // S/F lies on the edge from the last vertex to vertex 0.
  let x = SF_UV[0], z = SF_UV[1];
  for (let k = 0; k < n; k++) {
    line(x, z, arcs[k]!.sx, arcs[k]!.sz);
    arc(k);
    x = arcs[k]!.ex;
    z = arcs[k]!.ez;
  }
  line(x, z, SF_UV[0], SF_UV[1]);
  return out;
}

/** (u, v) of main-frame (s, d) on a closed polyline sampled from filletPolygon (d > 0 = left of the driving direction). */
export function uvFromSD(poly: readonly (readonly [number, number])[], s: number, d: number): [number, number] {
  const cum: number[] = [0];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!, b = poly[(i + 1) % poly.length]!;
    cum.push(cum[i]! + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  const L = cum[poly.length]!;
  const sw = ((s % L) + L) % L;
  let i = 0;
  while (cum[i + 1]! < sw) i++;
  const a = poly[i]!, b = poly[(i + 1) % poly.length]!;
  const len = cum[i + 1]! - cum[i]!;
  const t = len > 0 ? (sw - cum[i]!) / len : 0;
  const tx = (b[0] - a[0]) / (len || 1), tz = (b[1] - a[1]) / (len || 1);
  // Left of +u (heading) in the (u, v) frame is +v: left normal = (−tz, tx).
  return [a[0] + (b[0] - a[0]) * t - tz * d, a[1] + (b[1] - a[1]) * t + tx * d];
}

/** Pit polyline in (u, v): Catmull–Rom through PIT_SD at about 1 m. */
export function pitPolyline(poly: readonly (readonly [number, number])[]): [number, number][] {
  const P = PIT_SD.map(([s, d]) => uvFromSD(poly, s, d));
  const out: [number, number][] = [];
  for (let k = 0; k + 1 < P.length; k++) {
    const p0 = P[Math.max(0, k - 1)]!, p1 = P[k]!, p2 = P[k + 1]!, p3 = P[Math.min(P.length - 1, k + 2)]!;
    const m = Math.max(1, Math.round(Math.hypot(p2[0] - p1[0], p2[1] - p1[1])));
    for (let j = 0; j < m; j++) {
      const t = j / m, t2 = t * t, t3 = t2 * t;
      const c = (a: number, b: number, e: number, f: number): number => 0.5 * (2 * b + (-a + e) * t + (2 * a - 5 * b + 4 * e - f) * t2 + (-a + 3 * b - 3 * e + f) * t3);
      out.push([c(p0[0], p1[0], p2[0], p3[0]), c(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push([P[P.length - 1]![0], P[P.length - 1]![1]]);
  return out;
}

/** TrackData.attribution (tracks.md Ek B). */
export const ATTRIBUTION: readonly string[] = [
  'Bosphorus Shore Circuit: original layout by the HAIRPIN GP team. Shoreline, buildings and bridge positions derived from OpenStreetMap data © OpenStreetMap contributors (ODbL 1.0). The derived file bosphorus.raw.json is also provided under ODbL.',
  'Bosphorus Shore Circuit terrain: EU-DEM v1.1, produced using Copernicus data and information funded by the European Union; served via OpenTopoData.',
];
