// Keyboard input filter (planner-report §5.7): the single most important piece for keyboard driving feel.
// Pure, allocation-free functions over KeyboardFilterState (car.kb, D-012). Sim layer.
//
// Steering: the target u* = left − right is approached at a speed-dependent ramp-in rate
// lerp(4.0, 1.6, clamp(v/80, 0, 1)) per second × sensitivity (full lock in 0.25 s at rest, 0.625 s at ≥ 288 km/h);
// releasing and centring run at 6.0/s; a reversal first releases to exactly 0, then ramps in the other way.
// Output shaping: δ = sign(u)·|u|^1.4·δmax(v), so holding a key settles near peak cornering, never an instant spin.
// Pedals: throttle in 6/s out 10/s, brake in 8/s out 12/s.

import type { KeyboardFilterState } from '../../contracts/vehicle';

export const STEER_RAMP_SLOW = 4.0;
export const STEER_RAMP_FAST = 1.6;
export const STEER_RAMP_FULL_SPEED = 80;
export const STEER_RELEASE = 6.0;
export const STEER_SHAPE_EXP = 1.4;
export const THROTTLE_IN = 6;
export const THROTTLE_OUT = 10;
export const BRAKE_IN = 8;
export const BRAKE_OUT = 12;
/** Keyboard brake limiter: full key = this × the estimated lock threshold. */
export const KB_BRAKE_LIMIT = 1.05;

function approach(cur: number, target: number, maxDelta: number): number {
  if (cur < target) return cur + maxDelta >= target ? target : cur + maxDelta;
  return cur - maxDelta <= target ? target : cur - maxDelta;
}

/** Ramp-in rate (1/s) at speed v (m/s). */
export function steerRampRate(v: number, sensitivity: number): number {
  const t = v <= 0 ? 0 : v >= STEER_RAMP_FULL_SPEED ? 1 : v / STEER_RAMP_FULL_SPEED;
  return (STEER_RAMP_SLOW + (STEER_RAMP_FAST - STEER_RAMP_SLOW) * t) * sensitivity;
}

/** Advances kb.steerU toward left − right; returns the new unshaped value in [−1, 1]. */
export function filterSteer(kb: KeyboardFilterState, left: boolean, right: boolean, v: number, sensitivity: number, dt: number): number {
  const target = (left ? 1 : 0) - (right ? 1 : 0);
  let u = kb.steerU;
  if (target === 0 || (u > 0 && target < 0) || (u < 0 && target > 0)) u = approach(u, 0, STEER_RELEASE * dt);
  else u = approach(u, target, steerRampRate(v, sensitivity) * dt);
  kb.steerU = u;
  return u;
}

/** δ/δmax for an unshaped value u: sign(u)·|u|^1.4. */
export function shapeSteer(u: number): number {
  if (u === 0) return 0;
  return u > 0 ? Math.pow(u, STEER_SHAPE_EXP) : -Math.pow(-u, STEER_SHAPE_EXP);
}

export function filterThrottle(kb: KeyboardFilterState, held: boolean, dt: number): number {
  kb.throttle = approach(kb.throttle, held ? 1 : 0, (held ? THROTTLE_IN : THROTTLE_OUT) * dt);
  return kb.throttle;
}

export function filterBrake(kb: KeyboardFilterState, held: boolean, dt: number): number {
  kb.brake = approach(kb.brake, held ? 1 : 0, (held ? BRAKE_IN : BRAKE_OUT) * dt);
  return kb.brake;
}

/** Pedal scale of the keyboard brake limiter: min(1, 1.05 × lock threshold). */
export function brakeLimiterScale(lockPedal: number): number {
  const s = KB_BRAKE_LIMIT * lockPedal;
  return s < 1 ? (s > 0 ? s : 0) : 1;
}
