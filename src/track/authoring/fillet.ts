// Sim layer: authored-circuit geometry helpers shared by the procedural tracks (alpine, cliff): the fillet polygon
// (tangent arcs at each vertex joined by straights, map metres E/N → world x = E, z = −N), main-frame (s, d) → world and
// the Catmull–Rom pit polyline. Pure functions, no imports.

export interface FilletArc { s0: number; s1: number; turn: number; r: number }

/** Tangent arcs at each vertex (E, N, r) joined by straights, sampled every `step` m from (0, 0) (closing point
 *  omitted); world (x, z) = (E, −N). Arcs: start / end s, signed turn (deg, + left in map view), radius. */
export function filletBuild(ctrl: readonly (readonly [number, number, number])[], step: number): { pts: [number, number][]; arcs: FilletArc[] } {
  const n = ctrl.length;
  const arcs = ctrl.map((p, i) => {
    const a = ctrl[(i - 1 + n) % n]!;
    const b = ctrl[(i + 1) % n]!;
    const ix = p[0] - a[0], iz = p[1] - a[1];
    const ox = b[0] - p[0], oz = b[1] - p[1];
    const li = Math.hypot(ix, iz), lo = Math.hypot(ox, oz);
    const dix = ix / li, diz = iz / li, dox = ox / lo, doz = oz / lo;
    const turn = Math.atan2(dix * doz - diz * dox, dix * dox + diz * doz); // + = left in (E, N)
    const t = p[2] * Math.tan(Math.abs(turn) / 2);
    const sx = p[0] - dix * t, sz = p[1] - diz * t;
    const sgn = Math.sign(turn);
    const cx = sx - diz * p[2] * sgn, cz = sz + dix * p[2] * sgn;
    return { sx, sz, ex: p[0] + dox * t, ez: p[1] + doz * t, cx, cz, r: p[2], turn };
  });
  const out: [number, number][] = [];
  const arcOut: { s0: number; s1: number; turn: number; r: number }[] = [];
  let carry = 0;
  let sAcc = 0;
  const line = (x0: number, z0: number, x1: number, z1: number): void => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    sAcc += len;
    let s = carry;
    for (; s < len; s += step) out.push([x0 + ((x1 - x0) * s) / len, z0 + ((z1 - z0) * s) / len]);
    carry = s - len;
  };
  const arc = (k: number): void => {
    const A = arcs[k]!;
    const a0 = Math.atan2(A.sz - A.cz, A.sx - A.cx);
    const len = Math.abs(A.turn) * A.r;
    arcOut.push({ s0: Math.round(sAcc), s1: Math.round(sAcc + len), turn: Math.round((A.turn * 180) / Math.PI), r: A.r });
    sAcc += len;
    let s = carry;
    for (; s < len; s += step) {
      const a = a0 + Math.sign(A.turn) * (s / A.r);
      out.push([A.cx + A.r * Math.cos(a), A.cz + A.r * Math.sin(a)]);
    }
    carry = s - len;
  };
  let x = 0, z = 0;
  for (let k = 0; k < n; k++) {
    line(x, z, arcs[k]!.sx, arcs[k]!.sz);
    arc(k);
    x = arcs[k]!.ex;
    z = arcs[k]!.ez;
  }
  line(x, z, 0, 0);
  return { pts: out.map(([e, nn]) => [Math.round(e * 100) / 100, Math.round(-nn * 100) / 100]), arcs: arcOut };
}

/** Catmull-Rom of PIT_SD in world (x, z) needs the main polyline; uvFromSD-style helper (d > 0 = left). */
export function xzFromSD(poly: readonly (readonly [number, number])[], s: number, d: number): [number, number] {
  const L = poly.length; // 1 m samples
  const sw = ((s % L) + L) % L;
  const i = Math.floor(sw), t = sw - i;
  const a = poly[i]!, b = poly[(i + 1) % L]!;
  const tx = b[0] - a[0], tz = b[1] - a[1];
  const l = Math.hypot(tx, tz) || 1;
  // World left normal of heading (tx, tz) with z south: (tz, −tx).
  return [a[0] + tx * t + (tz / l) * d, a[1] + tz * t - (tx / l) * d];
}

/** Pit polyline in world (x, z): Catmull–Rom through main-frame (s, d) control points at about 1 m. */
export function pitPolyline(poly: readonly (readonly [number, number])[], sd: readonly (readonly [number, number])[]): [number, number][] {
  const P = sd.map(([s, d]) => xzFromSD(poly, s, d));
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
