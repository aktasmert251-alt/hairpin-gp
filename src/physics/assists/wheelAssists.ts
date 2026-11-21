// Wheel-level assists run inside the VehicleSystem's wheel substeps (planner-report §5.8). Sim layer.
//
// ABS: per-wheel slip-ratio target −0.10 (§5.8), reduced with the lateral slip (combined-slip ABS, see absTarget).
//      Brake + engine-braking torque are capped together at the torque the tyre reacts at the target slip (plus the
//      inertia term that keeps the wheel decelerating with the car); a wheel past the target gets ×0.6 (§5.2 step 8).
// TC:  rear slip-ratio target 0.16 (Medium) / 0.05 (Full; 0.10 before the S2-S1 grip ×1.13, which made the TC Full
//      launch 0–100 in 2.25 s, below the 2.5–2.9 s band), scaled down with the rear lateral slip (combined-slip
//      TC). Drive torque per rear wheel is capped at what the tyre reacts at the target slip, then cut (Kp 6) on any
//      excess slip. The §5.8 integral term (Ki 20) is replaced by this feed-forward cap: no per-car controller state.

import type { AssistSettings } from '../../contracts/race';
import { tyreFxAt } from '../tyre/grip';

export const ABS_TARGET = -0.1;
/** TC slide cut: drive torque is zero at |σy| = tanα/tanαpk ≥ this. */
const SLIDE_CUT_END = 1.6;
export const TC_TARGET: Readonly<Record<AssistSettings['tc'], number>> = { off: 0, medium: 0.16, full: 0.05 };
/** Assists the AI always drives with (§6.3): ABS on, TC Medium, automatic gearbox. */
export const AI_ASSISTS = { abs: true, tc: 'medium' as const, auto: true };

/**
 * Slip-ratio target of the combined-slip ABS: −0.10 on a straight, reduced to −0.10·√(1 − σy²) (never below
 * 30 %) when the tyre is also cornering, so braking never uses up the lateral grip (keeps the car steerable and
 * the rear planted when a keyboard player brakes while turning).
 */
export function absTarget(tanA: number, tanApk: number, rear = false): number {
  const sy = tanA / tanApk;
  const r = 1 - sy * sy;
  // S2-S2: the rear target shrinks linearly in (1 − σy²) (front: √), floor 15 %: trail-braking a hot-rear car into
  // T4 at 89 % of the rear's lateral peak kept −0.046 slip on the outer rear (−4.3 kN) and snapped it round.
  if (rear) return ABS_TARGET * (r > 0.15 ? r : 0.15);
  const f = r > 0.09 ? Math.sqrt(r) : 0.3;
  return ABS_TARGET * f;
}

/**
 * Decelerating torque budget (N·m) for one wheel under ABS: the brake torque plus engine braking (`coast` ≥ 0)
 * are capped together at what the tyre reacts at the ABS target (plus the inertia term). Returns the allowed
 * brake torque; `out.coast` receives the allowed engine-braking torque (engine braking is cut first by brake-by-
 * wire; the friction brake gives way first, engine braking is limited by absCoastTorque).
 */
export function absBrakeTorque(tb: number, kappa: number, tanA: number, d: number, kpk: number, tanApk: number, c: number, inertia: number, decel: number, radius: number, coast = 0, rear = false): number {
  const target = absTarget(tanA, tanApk, rear);
  let cap = tyreFxAt(target, tanA, d, kpk, tanApk, c) * radius + (inertia * (decel > 0 ? decel : 0)) / radius - coast;
  if (cap < 0) cap = 0;
  let t = tb < cap ? tb : cap;
  if (kappa < target) t *= 0.6;
  return t;
}

/**
 * Engine-braking torque (N·m, ≥ 0) one rear wheel may take under ABS (engine-braking control). S2-S1: the cap also
 * fades with the rear's cornering load, (1 − σy²)² → 0 at the peak slip angle, so a mid-corner lift (a keyboard
 * throttle is binary) never turns into lift-off oversteer; the friction brakes are unaffected.
 */
export function absCoastTorque(coast: number, tanA: number, d: number, kpk: number, tanApk: number, c: number, inertia: number, decel: number, radius: number): number {
  const sy = tanA / tanApk;
  const r = 1 - sy * sy;
  const fade = r > 0 ? r * r : 0;
  const cap = tyreFxAt(absTarget(tanA, tanApk), tanA, d, kpk, tanApk, c) * radius * fade + (inertia * (decel > 0 ? decel : 0)) / radius;
  return coast < cap ? coast : cap > 0 ? cap : 0;
}

/** D-040 wet TC: on a wet patch the rear's combined slip σ is held ≤ this (friction circle), so a keyboard throttle at
 * the wet cornering limit pushes wide instead of snapping into power oversteer. Full effect from W_local 0.3. */
const TC_WET_SIGMA = 0.9;

/** Drive torque (N·m) for one rear wheel after TC (`target` > 0). The slip target shrinks with the lateral slip
 * like the ABS target (combined-slip TC), so power on a loaded rear tyre never costs its cornering grip.
 * `wet` = the wheel's W_local (0 = dry: unchanged §5.8 behaviour). */
export function tcDriveTorque(td: number, target0: number, kappa: number, tanA: number, d: number, kpk: number, tanApk: number, c: number, inertia: number, accel: number, rollTorque: number, radius: number, wet = 0): number {
  if (td <= 0) return td;
  const sy = tanA / tanApk;
  const r = 1 - sy * sy;
  let target = target0 * (r > 0.01 ? Math.sqrt(r) : 0.1);
  if (wet > 0) {
    const b = TC_WET_SIGMA * TC_WET_SIGMA - sy * sy;
    const kw = b > 0 ? kpk * Math.sqrt(b) : 0;
    if (kw < target) target += (kw - target) * (wet < 0.3 ? wet / 0.3 : 1);
  }
  let cap = tyreFxAt(target, tanA, d, kpk, tanApk, c) * radius + rollTorque + (inertia * (accel > 0 ? accel : 0)) / radius;
  // Slide cut (S2-S1): once the rear runs past its peak slip angle (|σy| > 1, power oversteer, typically on cold
  // tyres at a slow-corner exit) the drive torque fades to zero by |σy| = 1.6, so the rear regains lateral grip.
  const ay = sy < 0 ? -sy : sy;
  if (ay > 1) cap *= ay >= SLIDE_CUT_END ? 0 : 1 - (ay - 1) / (SLIDE_CUT_END - 1);
  let t = td < cap ? td : cap;
  if (kappa > target) {
    const cut = target > 0 ? 1 - (6 * (kappa - target)) / target : 0;
    t *= cut > 0 ? cut : 0;
  }
  return t;
}
