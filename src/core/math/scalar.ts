// Allocation-free scalar helpers (sim-safe: no three, no DOM).

import { wrapAngle } from '../../contracts/frames';

export const DEG2RAD = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;
export const G = 9.81;
/** Multiply m/s by this to get km/h. */
export const MS_TO_KMH = 3.6;

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function invLerp(a: number, b: number, v: number): number {
  return a === b ? 0 : (v - a) / (b - a);
}

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

/** Moves `cur` toward `target` by at most `maxDelta` (>= 0). */
export function approach(cur: number, target: number, maxDelta: number): number {
  if (cur < target) return cur + maxDelta >= target ? target : cur + maxDelta;
  return cur - maxDelta <= target ? target : cur - maxDelta;
}

/** Frame-rate independent exponential smoothing toward `target` (lambda in 1/s). */
export function damp(cur: number, target: number, lambda: number, dt: number): number {
  return lerp(cur, target, 1 - Math.exp(-lambda * dt));
}

export function sign(v: number): number {
  return v > 0 ? 1 : v < 0 ? -1 : 0;
}

/** Shortest-path angle interpolation. */
export function lerpAngle(a: number, b: number, t: number): number {
  return a + wrapAngle(b - a) * t;
}

/** Piecewise-linear lookup in a table of [x, y] pairs sorted by x; clamps at both ends. */
export function interpTable(table: readonly (readonly [number, number])[], x: number): number {
  const n = table.length;
  if (n === 0) return 0;
  const first = table[0]!;
  if (x <= first[0]) return first[1];
  for (let i = 1; i < n; i++) {
    const b = table[i]!;
    if (x <= b[0]) {
      const a = table[i - 1]!;
      return a[1] + ((b[1] - a[1]) * (x - a[0])) / (b[0] - a[0]);
    }
  }
  return table[n - 1]![1];
}

/** Positive modulo (result in [0, m)). */
export function mod(v: number, m: number): number {
  const r = v % m;
  return r < 0 ? r + m : r;
}

export function isFiniteNumber(v: number): boolean {
  return v === v && v !== Infinity && v !== -Infinity;
}
