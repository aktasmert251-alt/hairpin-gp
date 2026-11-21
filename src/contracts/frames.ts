// Contract: world/car coordinate frames + pure helpers (the only runtime code in contracts). Implemented by: Yönetici.
//
// World: right-handed, +Y up, +X east, +Z south (north = -Z). Units m, s, kg, rad, N.
// Origin = S/F line centre at ground.
// yaw ψ: CCW seen from above. forward f = (cos ψ, 0, -sin ψ); left l = (-sin ψ, 0, -cos ψ).
// Car MODEL space: +Z forward (nose), +Y up, +X left -> matrix.makeBasis(leftW, upW, fwdW).setPosition(p)

import type { Vec3 } from './common';

const TWO_PI = Math.PI * 2;

/** Horizontal unit forward vector for a yaw angle. Writes into `out` and returns it. */
export function forwardFromYaw(yaw: number, out: Vec3): Vec3 {
  out.x = Math.cos(yaw);
  out.y = 0;
  out.z = -Math.sin(yaw);
  return out;
}

/** Horizontal unit LEFT vector for a yaw angle. Writes into `out` and returns it. */
export function leftFromYaw(yaw: number, out: Vec3): Vec3 {
  out.x = -Math.sin(yaw);
  out.y = 0;
  out.z = -Math.cos(yaw);
  return out;
}

/** Wraps an angle into (-π, π]. */
export function wrapAngle(a: number): number {
  let r = a % TWO_PI;
  if (r <= -Math.PI) r += TWO_PI;
  else if (r > Math.PI) r -= TWO_PI;
  return r;
}

/** Yaw of a horizontal direction (x, z) under the convention above (inverse of forwardFromYaw). */
export function yawFromDir(x: number, z: number): number {
  return Math.atan2(-z, x);
}
