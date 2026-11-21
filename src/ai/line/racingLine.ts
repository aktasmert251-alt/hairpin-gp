// Racing line (planner-report §6.1): centreline resampled at ~2 m, lateral offsets bounded by the track edges
// minus 1.3 m, multigrid elastic relaxation (coarse-to-fine spacings, ω = 0.5), then 3 Laplacian passes.
// Deviation: each relaxation step moves a point along its normal until its Menger curvature equals the
// distance-weighted mean curvature of its two neighbours (curvature smoothing, as in Coulom's K1999 line). The
// report's midpoint target is curve-shortening (the line hugs the inside of every corner), and a Σ|Δ²P|² target
// rewards curvature where points bunch on the inside of centreline kinks; this rule converges to the
// minimum-curvature line. Setup code (allocates once); budget ≤ 60 ms. Sim layer.

import type { RacingLine } from '../../contracts/ai';
import type { TrackFrame, TrackQuery } from '../../contracts/track';

export const LINE_DS = 2;
export const EDGE_MARGIN = 1.3;
export const LEVELS: (readonly [number, number])[] = [[64, 80], [32, 80], [16, 100], [8, 80], [4, 40], [2, 20]];
const OMEGA = 0.5;

export interface LineBuild { line: RacingLine; dMin: Float32Array; dMax: Float32Array }

export function buildRacingLine(q: TrackQuery, margin = EDGE_MARGIN): LineBuild {
  const L = q.length;
  const n = Math.max(16, Math.round(L / LINE_DS));
  const ds = L / n;
  const cx = new Float64Array(n);
  const cz = new Float64Array(n);
  const nx = new Float64Array(n);
  const nz = new Float64Array(n);
  const dMin = new Float32Array(n);
  const dMax = new Float32Array(n);
  const d = new Float64Array(n);
  const f: TrackFrame = {
    s: 0, px: 0, py: 0, pz: 0, tx: 1, tz: 0, lx: 0, lz: -1, halfWidthL: 0, halfWidthR: 0, crossSlope: 0, curvature: 0, vCurvature: 0, grade: 0, sector: 0,
  };
  for (let i = 0; i < n; i++) {
    q.frameAt(i * ds, f);
    cx[i] = f.px;
    cz[i] = f.pz;
    nx[i] = f.lx;
    nz[i] = f.lz;
    const lo = -(f.halfWidthR - margin);
    const hi = f.halfWidthL - margin;
    dMin[i] = lo < hi ? lo : 0;
    dMax[i] = lo < hi ? hi : 0;
  }

  const idx = new Int32Array(n);
  for (const [spacing, iters] of LEVELS) {
    const k = Math.max(1, Math.round(spacing / ds));
    let m = 0;
    for (let i = 0; i < n; i += k) idx[m++] = i;
    if (m < 4) continue;
    for (let it = 0; it < iters; it++) {
      for (let j = 0; j < m; j++) {
        const i = idx[j]!;
        const i1 = idx[j >= 1 ? j - 1 : j - 1 + m]!;
        const i2 = idx[j >= 2 ? j - 2 : j - 2 + m]!;
        const k1 = idx[j + 1 < m ? j + 1 : j + 1 - m]!;
        const k2 = idx[j + 2 < m ? j + 2 : j + 2 - m]!;
        const ax = cx[i2]! + nx[i2]! * d[i2]!, az = cz[i2]! + nz[i2]! * d[i2]!;
        const bx = cx[i1]! + nx[i1]! * d[i1]!, bz = cz[i1]! + nz[i1]! * d[i1]!;
        const px = cx[i]! + nx[i]! * d[i]!, pz = cz[i]! + nz[i]! * d[i]!;
        const ex = cx[k1]! + nx[k1]! * d[k1]!, ez = cz[k1]! + nz[k1]! * d[k1]!;
        const fx = cx[k2]! + nx[k2]! * d[k2]!, fz = cz[k2]! + nz[k2]! * d[k2]!;
        const kPrev = menger(ax, az, bx, bz, px, pz);
        const kNext = menger(px, pz, ex, ez, fx, fz);
        const dp = Math.sqrt((px - bx) * (px - bx) + (pz - bz) * (pz - bz));
        const dn = Math.sqrt((ex - px) * (ex - px) + (ez - pz) * (ez - pz));
        const target = (kPrev * dn + kNext * dp) / (dp + dn);
        const k0 = menger(bx, bz, px, pz, ex, ez);
        const eps = 0.01;
        const k1v = menger(bx, bz, px + nx[i]! * eps, pz + nz[i]! * eps, ex, ez);
        const slope = (k1v - k0) / eps;
        if (slope > 1e-9 || slope < -1e-9) {
          let v = d[i]! + (OMEGA * (target - k0)) / slope;
          if (v < dMin[i]!) v = dMin[i]!;
          else if (v > dMax[i]!) v = dMax[i]!;
          d[i] = v;
        }
      }
    }
    // Interpolate the fine samples between coarse points for the next level.
    for (let j = 0; j < m; j++) {
      const a = idx[j]!;
      const b = idx[(j + 1) % m]!;
      const gap = (b - a + n) % n;
      for (let u = 1; u < gap; u++) {
        const t = u / gap;
        d[(a + u) % n] = d[a]! + (d[b]! - d[a]!) * t;
      }
    }
  }
  // 3 Laplacian smoothing passes, then clamp.
  const tmp = new Float64Array(n);
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 0; i < n; i++) tmp[i] = 0.25 * d[(i - 1 + n) % n]! + 0.5 * d[i]! + 0.25 * d[(i + 1) % n]!;
    for (let i = 0; i < n; i++) d[i] = tmp[i]! < dMin[i]! ? dMin[i]! : tmp[i]! > dMax[i]! ? dMax[i]! : tmp[i]!;
  }

  const line: RacingLine = {
    count: n, ds,
    s: new Float32Array(n), d: new Float32Array(n), x: new Float32Array(n), y: new Float32Array(n), z: new Float32Array(n),
    curvature: new Float32Array(n),
  };
  const p = { x: 0, y: 0, z: 0 };
  for (let i = 0; i < n; i++) {
    const s = i * ds;
    q.worldFromSD(s, d[i]!, p);
    line.s[i] = s;
    line.d[i] = d[i]!;
    line.x[i] = p.x;
    line.y[i] = p.y;
    line.z[i] = p.z;
  }
  // Signed curvature (+ left) from three points 2 samples apart, then a 5-tap smooth.
  const raw = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = (i - 2 + n) % n;
    const c = (i + 2) % n;
    const ax = line.x[i]! - line.x[a]!;
    const az = line.z[i]! - line.z[a]!;
    const bx = line.x[c]! - line.x[i]!;
    const bz = line.z[c]! - line.z[i]!;
    const cxx = line.x[c]! - line.x[a]!;
    const czz = line.z[c]! - line.z[a]!;
    const la = Math.hypot(ax, az);
    const lb = Math.hypot(bx, bz);
    const lc = Math.hypot(cxx, czz);
    const cross = bx * az - bz * ax;
    raw[i] = la > 1e-6 && lb > 1e-6 && lc > 1e-6 ? (2 * cross) / (la * lb * lc) : 0;
  }
  for (let i = 0; i < n; i++) {
    line.curvature[i] = (raw[(i - 2 + n) % n]! + 2 * raw[(i - 1 + n) % n]! + 3 * raw[i]! + 2 * raw[(i + 1) % n]! + raw[(i + 2) % n]!) / 9;
  }
  return { line, dMin, dMax };
}

/** Signed Menger curvature (+ left) of three points in the x-z plane. */
function menger(ax: number, az: number, bx: number, bz: number, cx: number, cz: number): number {
  const ux = bx - ax, uz = bz - az, vx = cx - bx, vz = cz - bz;
  const la = Math.sqrt(ux * ux + uz * uz), lb = Math.sqrt(vx * vx + vz * vz);
  const wx = cx - ax, wz = cz - az;
  const lc = Math.sqrt(wx * wx + wz * wz);
  const den = la * lb * lc;
  return den > 1e-9 ? (2 * (vx * uz - vz * ux)) / den : 0;
}

/** Linear interpolation of a per-sample line array at main-track s (wraps). */
export function lineAt(arr: Float32Array, line: RacingLine, s: number, length: number): number {
  let sw = s % length;
  if (sw < 0) sw += length;
  const fIdx = sw / line.ds;
  const i0 = Math.floor(fIdx);
  const t = fIdx - i0;
  const n = line.count;
  const i = i0 >= n ? i0 - n : i0;
  const j = i + 1 >= n ? 0 : i + 1;
  return arr[i]! + (arr[j]! - arr[i]!) * t;
}
