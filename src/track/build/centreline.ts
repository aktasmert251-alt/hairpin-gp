// Sim layer: main-loop and pit-lane centrelines from the raw OSM polylines (report §7.2 runtime build).
// Main: centripetal Catmull-Rom → 0.5 m uniform → Gaussian σ = 3 m → curvature-spike limiter → uniform 1 m samples
// with an integral loop length (the loop is scaled by ≈1e-4 so that ds = 1 exactly) and s = 0 at the S/F node.

import { catmullRomDense, clamp, cumulative, gaussianSmooth, polyLength, resampleUniform, wrapAngle, type Poly } from './geometry';

export interface Line {
  count: number;
  /** Loop length (closed) or polyline length (open), metres. */
  length: number;
  x: Float64Array; z: Float64Array; tx: Float64Array; tz: Float64Array; kappa: Float64Array;
}

/** Similarity applied to every raw coordinate so pit lane and scenery stay registered with the main loop. */
export interface Registration { cx: number; cz: number; k: number }

export const applyReg = (r: Registration, x: number, z: number): [number, number] => [(x - r.cx) * r.k, (z - r.cz) * r.k];

const H = 0.5; // dense spacing (m)
const SIGMA_M = 3;
/** Minimum centreline radius 19.5 m (report 7.3: tightest corners T4/T14 = 19 m; keeps |d| <= hw + 10 m unambiguous). */
const KAPPA_MAX = 1 / 19.5;

function toPoly(xz: readonly (readonly [number, number])[]): Poly {
  return { x: xz.map((p) => p[0]), z: xz.map((p) => p[1]) };
}

/** Turning-angle curvature at each vertex of a uniformly spaced polyline. */
function curvatureOf(x: ArrayLike<number>, z: ArrayLike<number>, h: number, closed: boolean): number[] {
  const n = x.length;
  const k = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    const a = closed ? (i - 1 + n) % n : Math.max(0, i - 1);
    const b = closed ? (i + 1) % n : Math.min(n - 1, i + 1);
    if (a === i || b === i) continue;
    const h0 = Math.atan2(-(z[i]! - z[a]!), x[i]! - x[a]!);
    const h1 = Math.atan2(-(z[b]! - z[i]!), x[b]! - x[i]!);
    k[i] = wrapAngle(h1 - h0) / h;
  }
  return k;
}

/** |Menger curvature| over a ±`w`-sample stencil (cheap, no trig). */
function absCurv(x: readonly number[], z: readonly number[], i: number, w: number, n: number, closed: boolean): number {
  const a = closed ? (i - w + n) % n : i - w;
  const c = closed ? (i + w) % n : i + w;
  if (a < 0 || c >= n) return 0;
  const ux = x[i]! - x[a]!;
  const uz = z[i]! - z[a]!;
  const vx = x[c]! - x[i]!;
  const vz = z[c]! - z[i]!;
  const cr = Math.abs(ux * vz - uz * vx);
  const den = Math.hypot(ux, uz) * Math.hypot(vx, vz) * Math.hypot(x[c]! - x[a]!, z[c]! - z[a]!);
  return den > 1e-12 ? (2 * cr) / den : 0;
}

/**
 * Curvature limiter: wherever |κ| (measured over a 2 m stencil) exceeds KAPPA_MAX, the surrounding ±10 m are relaxed
 * with a [¼ ½ ¼] filter until the whole loop satisfies the limit. Local and deterministic.
 */
function limitCurvature(p: { x: number[]; z: number[] }, closed: boolean): void {
  const n = p.x.length;
  const W = Math.round(2 / H);
  const mark = new Uint8Array(n);
  let check: number[] = [];
  for (let i = 0; i < n; i++) check.push(i);
  const x = p.x;
  const z = p.z;
  for (let pass = 0; pass < 400; pass++) {
    const marked: number[] = [];
    for (const i of check) {
      if (absCurv(x, z, i, W, n, closed) <= KAPPA_MAX) continue;
      for (let j = -20; j <= 20; j++) {
        const idx = closed ? (i + j + n) % n : i + j;
        if (idx > 0 && idx < n - 1 && !mark[idx]) {
          mark[idx] = 1;
          marked.push(idx);
        }
      }
    }
    if (marked.length === 0) return;
    marked.sort((a, b) => a - b);
    for (const i of marked) mark[i] = 0;
    // Symmetric Gauss-Seidel [¼ ½ ¼] sweeps over the marked samples only.
    for (let it = 0; it < 24; it++) {
      const fwd = (it & 1) === 0;
      for (let k = 0; k < marked.length; k++) {
        const i = marked[fwd ? k : marked.length - 1 - k]!;
        const a = closed ? (i - 1 + n) % n : i - 1;
        const b = closed ? (i + 1) % n : i + 1;
        x[i] = 0.25 * x[a]! + 0.5 * x[i]! + 0.25 * x[b]!;
        z[i] = 0.25 * z[a]! + 0.5 * z[i]! + 0.25 * z[b]!;
      }
    }
    // Re-check the smoothed windows plus a margin (smoothing can kink the curve just outside the window).
    const next: number[] = [];
    for (const i of marked) for (let j = -24; j <= 24; j++) {
      const idx = closed ? (i + j + n) % n : i + j;
      if (idx >= 0 && idx < n && !mark[idx]) {
        mark[idx] = 1;
        next.push(idx);
      }
    }
    for (const i of next) mark[i] = 0;
    check = next;
  }
}

function finishLine(x: number[], z: number[], closed: boolean, length: number): Line {
  const n = x.length;
  const line: Line = {
    count: n, length,
    x: Float64Array.from(x), z: Float64Array.from(z),
    tx: new Float64Array(n), tz: new Float64Array(n), kappa: new Float64Array(n),
  };
  for (let i = 0; i < n; i++) {
    const a = closed ? (i - 1 + n) % n : Math.max(0, i - 1);
    const b = closed ? (i + 1) % n : Math.min(n - 1, i + 1);
    const dx = x[b]! - x[a]!;
    const dz = z[b]! - z[a]!;
    const l = Math.hypot(dx, dz) || 1;
    line.tx[i] = dx / l;
    line.tz[i] = dz / l;
  }
  const k = curvatureOf(x, z, 1, closed);
  // Curvature from 1 m turning angles is noisy at float precision; light smoothing (σ = 2 m) for the stored value.
  const ks = gaussianSmooth(k, 2, closed);
  for (let i = 0; i < n; i++) line.kappa[i] = ks[i]!;
  return line;
}

export function buildMainLine(rawXZ: readonly (readonly [number, number])[]): { line: Line; reg: Registration } {
  const dense = catmullRomDense(toPoly(rawXZ), true, H);
  const Ld = polyLength(dense, true);
  const M = Math.round(Ld / H);
  const u = resampleUniform(dense, true, M, Ld / M);
  const sm = { x: gaussianSmooth(u.x, SIGMA_M / H, true), z: gaussianSmooth(u.z, SIGMA_M / H, true) };
  limitCurvature(sm, true);
  const Ls = polyLength(sm, true);
  // s = 0 at the projection of the S/F node (world origin) onto the smoothed loop.
  const cum = cumulative(sm, true);
  let best = Infinity;
  let s0 = 0;
  for (let i = 0; i < M; i++) {
    const j = (i + 1) % M;
    const ax = sm.x[i]!;
    const az = sm.z[i]!;
    const dx = sm.x[j]! - ax;
    const dz = sm.z[j]! - az;
    const l2 = dx * dx + dz * dz;
    const t = l2 > 0 ? clamp(-(ax * dx + az * dz) / l2, 0, 1) : 0;
    const ex = ax + dx * t;
    const ez = az + dz * t;
    const d2 = ex * ex + ez * ez;
    if (d2 < best) {
      best = d2;
      s0 = cum[i]! + t * (cum[i + 1]! - cum[i]!);
    }
  }
  const N = Math.round(Ls);
  const res = resampleUniform(sm, true, N, Ls / N, s0);
  const reg: Registration = { cx: res.x[0]!, cz: res.z[0]!, k: N / Ls };
  const x = res.x.map((v) => (v - reg.cx) * reg.k);
  const z = res.z.map((v) => (v - reg.cz) * reg.k);
  return { line: finishLine(x, z, true, N), reg };
}

/** Open polyline (pit lane): same smoothing, uniform 1 m samples (last sample at the true end). */
export function buildOpenLine(xz: readonly (readonly [number, number])[]): Line {
  const dense = catmullRomDense(toPoly(xz), false, H);
  const Ld = polyLength(dense, false);
  const M = Math.round(Ld / H) + 1;
  const u = resampleUniform(dense, false, M, Ld / (M - 1));
  const sm = { x: gaussianSmooth(u.x, SIGMA_M / H, false), z: gaussianSmooth(u.z, SIGMA_M / H, false) };
  limitCurvature(sm, false);
  const Ls = polyLength(sm, false);
  const N = Math.max(2, Math.round(Ls) + 1);
  const res = resampleUniform(sm, false, N, Ls / (N - 1));
  return finishLine(res.x, res.z, false, Ls);
}

/**
 * Replaces the raw polyline between arc lengths `from` and `to` (raw metres) by its two end tangents joined with a
 * circular arc of radius `r` (TrackAuthoring.CENTRE_FILLETS): OSM hairpins tighter than the 19.5 m limiter can open.
 * Throws when the tangents are too short for the radius (the authoring range must be widened).
 */
export function filletRaw(xz: readonly (readonly [number, number])[], fillets: readonly { from: number; to: number; r: number }[]): [number, number][] {
  let pts: [number, number][] = xz.map((p) => [p[0], p[1]]);
  for (const f of fillets) {
    const n = pts.length;
    const cum = [0];
    for (let i = 0; i < n; i++) {
      const a = pts[i]!, b = pts[(i + 1) % n]!;
      cum.push(cum[i]! + Math.hypot(b[0] - a[0], b[1] - a[1]));
    }
    const at = (s: number): { i: number; p: [number, number]; t: [number, number] } => {
      let i = 0;
      while (cum[i + 1]! < s) i++;
      const a = pts[i]!, b = pts[(i + 1) % n]!;
      const l = cum[i + 1]! - cum[i]!;
      const u = (s - cum[i]!) / l;
      return { i, p: [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u], t: [(b[0] - a[0]) / l, (b[1] - a[1]) / l] };
    };
    const A = at(f.from), B = at(f.to);
    // A + a·tA = B − b·tB
    const det = A.t[0] * -B.t[1] + B.t[0] * A.t[1];
    const rx = B.p[0] - A.p[0], rz = B.p[1] - A.p[1];
    const a = (rx * -B.t[1] + B.t[0] * rz) / det;
    const b = (A.t[1] * rx - A.t[0] * rz) / det;
    const V: [number, number] = [A.p[0] + A.t[0] * a, A.p[1] + A.t[1] * a];
    const theta = Math.acos(clamp(A.t[0] * B.t[0] + A.t[1] * B.t[1], -1, 1));
    const tl = f.r * Math.tan(theta / 2);
    if (!(a >= tl && b >= tl)) throw new Error(`fillet ${f.from}–${f.to}: tangents ${a.toFixed(0)}/${b.toFixed(0)} m < ${tl.toFixed(0)} m`);
    const T1: [number, number] = [V[0] - A.t[0] * tl, V[1] - A.t[1] * tl];
    const side = A.t[0] * B.t[1] - A.t[1] * B.t[0] > 0 ? 1 : -1;
    const C: [number, number] = [T1[0] - side * A.t[1] * f.r, T1[1] + side * A.t[0] * f.r];
    const a0 = Math.atan2(T1[1] - C[1], T1[0] - C[0]);
    const m = Math.max(2, Math.ceil((theta * f.r) / 2));
    const arc: [number, number][] = [];
    for (let k = 0; k <= m; k++) {
      const ang = a0 + (side * theta * k) / m;
      arc.push([C[0] + Math.cos(ang) * f.r, C[1] + Math.sin(ang) * f.r]);
    }
    pts = [...pts.slice(0, A.i + 1), A.p, ...arc, B.p, ...pts.slice(B.i + 1)];
  }
  return pts;
}
