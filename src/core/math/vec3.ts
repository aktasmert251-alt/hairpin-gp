// Allocation-free Vec3 helpers on plain {x,y,z} objects (sim-safe). Every op writes into `out` and returns it.

import type { Vec3 } from '../../contracts/common';

/** Allocating constructor: use at setup time only, never in hot loops. */
export function vec3(x = 0, y = 0, z = 0): Vec3 {
  return { x, y, z };
}

export function v3set(out: Vec3, x: number, y: number, z: number): Vec3 {
  out.x = x; out.y = y; out.z = z;
  return out;
}

export function v3copy(out: Vec3, a: Vec3): Vec3 {
  out.x = a.x; out.y = a.y; out.z = a.z;
  return out;
}

export function v3add(out: Vec3, a: Vec3, b: Vec3): Vec3 {
  out.x = a.x + b.x; out.y = a.y + b.y; out.z = a.z + b.z;
  return out;
}

export function v3sub(out: Vec3, a: Vec3, b: Vec3): Vec3 {
  out.x = a.x - b.x; out.y = a.y - b.y; out.z = a.z - b.z;
  return out;
}

export function v3scale(out: Vec3, a: Vec3, s: number): Vec3 {
  out.x = a.x * s; out.y = a.y * s; out.z = a.z * s;
  return out;
}

/** out = a + b * s */
export function v3addScaled(out: Vec3, a: Vec3, b: Vec3, s: number): Vec3 {
  out.x = a.x + b.x * s; out.y = a.y + b.y * s; out.z = a.z + b.z * s;
  return out;
}

export function v3dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function v3cross(out: Vec3, a: Vec3, b: Vec3): Vec3 {
  const x = a.y * b.z - a.z * b.y;
  const y = a.z * b.x - a.x * b.z;
  const z = a.x * b.y - a.y * b.x;
  out.x = x; out.y = y; out.z = z;
  return out;
}

export function v3lengthSq(a: Vec3): number {
  return a.x * a.x + a.y * a.y + a.z * a.z;
}

export function v3length(a: Vec3): number {
  return Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
}

/** Normalises in place semantics via `out`; zero vectors stay zero. */
export function v3normalize(out: Vec3, a: Vec3): Vec3 {
  const l = Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
  if (l > 0) {
    const inv = 1 / l;
    out.x = a.x * inv; out.y = a.y * inv; out.z = a.z * inv;
  } else {
    out.x = 0; out.y = 0; out.z = 0;
  }
  return out;
}

export function v3distanceSq(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

export function v3distance(a: Vec3, b: Vec3): number {
  return Math.sqrt(v3distanceSq(a, b));
}

export function v3lerp(out: Vec3, a: Vec3, b: Vec3, t: number): Vec3 {
  out.x = a.x + (b.x - a.x) * t;
  out.y = a.y + (b.y - a.y) * t;
  out.z = a.z + (b.z - a.z) * t;
  return out;
}
