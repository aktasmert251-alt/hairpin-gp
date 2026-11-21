// Sim layer: build-time projection onto a sampled line (brute-force window + exact segment solve). Not for hot paths.

import type { Line } from './centreline';

export interface SD { s: number; d: number; i: number }

/**
 * Nearest point of (x, z) on the line, searching samples within ±win of i0 (i0 < 0: whole line).
 * s is fractional (sample units: s = i for the 1 m main line), d is signed (+left).
 */
export function projectOnLine(line: Line, closed: boolean, x: number, z: number, i0: number, win: number, out: SD): SD {
  const n = line.count;
  let best = Infinity;
  let bi = 0;
  const from = i0 < 0 ? 0 : i0 - win;
  const to = i0 < 0 ? n - 1 : i0 + win;
  for (let k = from; k <= to; k++) {
    let i = k;
    if (closed) i = ((i % n) + n) % n;
    else if (i < 0 || i >= n) continue;
    const dx = x - line.x[i]!;
    const dz = z - line.z[i]!;
    const d2 = dx * dx + dz * dz;
    if (d2 < best) {
      best = d2;
      bi = i;
    }
  }
  // Refine on the two adjacent segments with interpolated normals (same model as the runtime query).
  let bestS = bi;
  let bestD = (x - line.x[bi]!) * line.tz[bi]! - (z - line.z[bi]!) * line.tx[bi]!;
  let bestE = Infinity;
  for (const a0 of [bi - 1, bi]) {
    let a = a0;
    let b = a0 + 1;
    if (closed) {
      a = ((a % n) + n) % n;
      b = ((b % n) + n) % n;
    } else if (a < 0 || b >= n) continue;
    const t = solveSegment(line, a, b, x, z);
    const tc = t < 0 ? 0 : t > 1 ? 1 : t;
    const px = line.x[a]! + (line.x[b]! - line.x[a]!) * tc;
    const pz = line.z[a]! + (line.z[b]! - line.z[a]!) * tc;
    const lx = line.tz[a]! + (line.tz[b]! - line.tz[a]!) * tc;
    const lz = -(line.tx[a]! + (line.tx[b]! - line.tx[a]!) * tc);
    const ll = Math.hypot(lx, lz) || 1;
    const d = ((x - px) * lx + (z - pz) * lz) / ll;
    // Residual along the tangent (0 for an exact foot point inside the segment).
    const e = Math.abs((x - px) * (-lz / ll) - (z - pz) * (-lx / ll)) + (t < 0 ? -t : t > 1 ? t - 1 : 0);
    if (e < bestE) {
      bestE = e;
      bestS = a0 + tc;
      bestD = d;
    }
  }
  out.s = closed ? ((bestS % n) + n) % n : bestS;
  out.d = bestD;
  out.i = bi;
  return out;
}

/** Parameter t of the foot point on segment a→b where (p − P(t)) ∥ N(t) (N = lerp of left normals). */
export function solveSegment(line: Line, a: number, b: number, x: number, z: number): number {
  const Ax = x - line.x[a]!;
  const Az = z - line.z[a]!;
  const Dx = line.x[b]! - line.x[a]!;
  const Dz = line.z[b]! - line.z[a]!;
  const L0x = line.tz[a]!;
  const L0z = -line.tx[a]!;
  const DLx = line.tz[b]! - L0x;
  const DLz = -line.tx[b]! - L0z;
  const cr = (ux: number, uz: number, vx: number, vz: number): number => ux * vz - uz * vx;
  const qa = -cr(Dx, Dz, DLx, DLz);
  const qb = cr(Ax, Az, DLx, DLz) - cr(Dx, Dz, L0x, L0z);
  const qc = cr(Ax, Az, L0x, L0z);
  if (Math.abs(qa) < 1e-12) return qb !== 0 ? -qc / qb : 0;
  const disc = qb * qb - 4 * qa * qc;
  if (disc < 0) return qb !== 0 ? -qc / qb : 0;
  const q = -0.5 * (qb + (qb >= 0 ? 1 : -1) * Math.sqrt(disc));
  return q !== 0 ? qc / q : 0;
}
