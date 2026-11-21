// Power unit, gearbox and ERS (planner-report §5.2 step 9, §5.3, §5.6, §5.8 auto gearbox). Sim layer,
// allocation-free.

import type { VehicleInput, VehicleParams, VehicleState } from '../../contracts/vehicle';
import { interpTable } from '../../core/math/scalar';
import { AUTO_DOWN_BRAKE_MAX_RPM, AUTO_DOWN_RPM, AUTO_UP_RPM, RPM_PER_RADS } from '../constants';

/** Full-throttle crank torque (N·m) at rpm. */
export function maxTorque(p: VehicleParams, rpm: number): number {
  return interpTable(p.torqueCurve, rpm);
}

/** Engine-braking crank torque (N·m, negative) at rpm. */
export function engineBrake(p: VehicleParams, rpm: number): number {
  return interpTable(p.engineBrakeCurve, rpm);
}

/** Te = thr·Tmax(rpm)·(1 + perf) + (1 − thr)·Teb(rpm). */
export function engineTorque(p: VehicleParams, rpm: number, thr: number): number {
  return thr * maxTorque(p, rpm) * (1 + p.teamPerf) + (1 - thr) * engineBrake(p, rpm);
}

/** Overall ratio (gearbox × final drive) of `gear` (1-based). */
export function overallRatio(p: VehicleParams, gear: number): number {
  return p.gearRatios[gear - 1]! * p.finalDrive;
}

/** Engine rpm with the clutch locked at rear-wheel speed `omega` (rad/s) in `gear`. */
export function rpmAtWheel(p: VehicleParams, gear: number, omega: number): number {
  return omega * overallRatio(p, gear) * RPM_PER_RADS;
}

/** Peak power of the ICE (W) across the torque curve. Cached per params object by the callers that need it. */
export function peakPowerW(p: VehicleParams): number {
  let best = 0;
  for (let rpm = p.idleRpm; rpm <= p.limiterRpm; rpm += 50) {
    const w = maxTorque(p, rpm) * (rpm / RPM_PER_RADS);
    if (w > best) best = w;
  }
  return best * (1 + p.teamPerf);
}

/**
 * Gear decision for this tick. Returns the new gear (or the current one). Automatic: up at 11,800 rpm (or the
 * limiter), down below 7,800 rpm, or under braking when the lower gear stays ≤ 11,000 rpm; never above 12,500.
 * Manual: edges from the input; a downshift that would over-rev is refused.
 */
export function chooseGear(p: VehicleParams, v: VehicleState, inp: VehicleInput, auto: boolean, wheelOmega: number): number {
  const gear = v.gear < 1 ? 1 : v.gear;
  if (v.shiftTimer > 0) return gear;
  const top = p.gearRatios.length;
  const rpm = rpmAtWheel(p, gear, wheelOmega);
  if (auto) {
    if (gear < top && (rpm >= AUTO_UP_RPM || v.limiterHit) && v.clutch >= 0.99) return gear + 1;
    if (gear > 1) {
      const lower = rpmAtWheel(p, gear - 1, wheelOmega);
      if (lower <= p.limiterRpm) {
        if (rpm < AUTO_DOWN_RPM) return gear - 1;
        if (inp.brake > 0.1 && lower <= AUTO_DOWN_BRAKE_MAX_RPM) return gear - 1;
      }
    }
    return gear;
  }
  if (inp.gearUp && gear < top) return gear + 1;
  if (inp.gearDown && gear > 1 && rpmAtWheel(p, gear - 1, wheelOmega) <= p.limiterRpm) return gear - 1;
  return gear;
}

/** D-040 reverse gear (player cars only): standstill threshold, brake hold, speed cap and throttle scale. */
export const REVERSE_STANDSTILL_MS = 2 / 3.6;
export const REVERSE_HOLD_S = 0.3;
export const REVERSE_MAX_MS = 25 / 3.6;
export const REVERSE_THROTTLE = 0.35;
/** Medium ERS strategy: state of charge (fraction) below which it does not deploy, and the span to the full budget. */
const MEDIUM_SOC_FLOOR = 0.2;
const MEDIUM_SOC_SPAN = 0.6;

/**
 * D-049 / D-051 #7 reverse-gear selection for a player car (gear −1 = R; R drives through the 1st-gear ratio). Rules:
 * - In 1st at a standstill (< 2 km/h, no shift running): gear-down engages R at once; holding the brake (> 0.1, no
 *   throttle) for 0.3 s engages R. The hold time is kept in `v.shiftTimer` as a negative value (no shift can run then).
 * - In R the VehicleSystem swaps the pedals: the brake drives backwards, the throttle brakes. Gear-up returns to 1st
 *   (any speed); the throttle at a standstill returns to 1st (so W then drives forward). The throttle never reverses.
 * Returns the gear for this tick.
 */
export function reverseGear(v: VehicleState, inp: VehicleInput, speed: number, dt: number): number {
  if (v.gear < 0) return inp.gearUp || (inp.throttle > 0.1 && speed < REVERSE_STANDSTILL_MS) ? 1 : -1;
  if (v.gear !== 1 || v.shiftTimer > 0 || speed >= REVERSE_STANDSTILL_MS) {
    if (v.shiftTimer < 0) v.shiftTimer = 0;
    return v.gear;
  }
  if (inp.gearDown) {
    v.shiftTimer = 0;
    return -1;
  }
  if (inp.brake > 0.1 && inp.throttle < 0.05) {
    v.shiftTimer -= dt;
    if (v.shiftTimer <= -REVERSE_HOLD_S + 1e-9) {
      v.shiftTimer = 0;
      return -1;
    }
  } else v.shiftTimer = 0;
  return 1;
}

/**
 * ERS deploy decision (§5.6) for this tick: true when the MGU-K should deploy. `lapFrac` = lap distance fraction
 * 0..1 (for the `medium` budget pacing).
 */
export function ersDeploys(p: VehicleParams, v: VehicleState, inp: VehicleInput, thr: number, lapFrac: number): boolean {
  const e = v.ers;
  if (e.socJ <= 0) return false;
  const limit = p.ers.deployLimitMJ * 1e6;
  if (e.deployedLapJ >= limit) return false;
  const mode = inp.ersOvertake ? 'overtake' : inp.ersMode;
  switch (mode) {
    case 'none':
      return false;
    case 'overtake':
      return thr >= 0.9;
    case 'hotlap':
      return thr >= 0.95;
    default: {
      // Medium (the default / ERS-assist strategy) is charge-sustaining since 2026-10-24 (user: "once ERS runs out it never
      // fills up again"): the paced per-lap budget scales with the state of charge, 0 below 20 % and full from 80 %. A full
      // budget spends ~4 MJ a lap against ~3 MJ harvested, so the old rule drained the battery in ~3 laps and then spent
      // every joule as it came in (stuck at 0–5 %). Now an empty battery recharges (no deploy below 20 %) and the charge
      // settles around 60–70 %. A flying lap from full is unchanged.
      let k = (e.socJ / (p.ers.capacityMJ * 1e6) - MEDIUM_SOC_FLOOR) / MEDIUM_SOC_SPAN;
      k = k < 0 ? 0 : k > 1 ? 1 : k;
      return thr >= 0.95 && v.speed > 30 && e.deployedLapJ / limit <= k * (lapFrac + 0.1);
    }
  }
}
