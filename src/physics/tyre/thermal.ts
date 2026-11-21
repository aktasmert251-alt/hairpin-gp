// Tyre thermal and wear model (planner-report §5.4), run at 60 Hz by the VehicleSystem. Sim layer.
//
// Two lumps per tyre: surface (fast) and core (slow).
//   dTs/dt = axle·heatRate·(A_SLIP·P̄slip + A_ROLL·Fz·v) − (H0 + H1·V_REF·(v/V_REF)^COOL_EXP)(1 + 2W)(Ts − Ttrack) − K_SC·(Ts − Tc)
//   dTc/dt = K_CS·(Ts − Tc) + heatRate·B_ROLL·Fz·v − H_CORE·(Tc − Tair)
// P̄slip = mean slip power since the last update (|Fx·vsx| + |Fy·vsy|, accumulated per tick in aux.heatJ).
// Grip uses Teff = 0.65·Ts + 0.35·Tc. Wear grows with slip energy × wearRate × wearScale × overheat factor.
// Calibration notes (targets (a)–(e) of §5.4) are in src/physics/__tests__/tyre.test.ts.

import type { Compound } from '../../contracts/common';
import type { TyreCompoundParams, TyreState } from '../../contracts/vehicle';
import { tempGrip, wearGrip } from './grip';

/**
 * Fitted (S2-S4) on recorded İstanbul push / slow / wet laps of the perfect AI to targets (a)–(e). The cooling
 * speed exponent > 1 is what lets one model warm a Medium from the blanket in one lap and still lose only 10–15 °C
 * on a 0.6-pace slow lap (with linear cooling the best fit was 95 °C / 15.3 °C). The wider rear tyres take
 * REAR_HEAT of the surface heating per unit load (more rubber): without it the rears ran 20 °C over the fronts and a
 * hot Soft rear (130 °C, −17 % grip) spun the car at T4 every lap.
 */
export const THERMAL = {
  A_SLIP: 2.0e-5,
  A_ROLL: 6.93e-5,
  H0: 0.00027,
  H1: 0.00436,
  /** Convective cooling ∝ (v / V_REF)^COOL_EXP, V_REF in m/s. */
  V_REF: 50,
  COOL_EXP: 1.41,
  K_SC: 2.78,
  K_CS: 0.194,
  H_CORE: 1.0e-5,
  /** Direct carcass (core) heating per N·m/s of load × speed. */
  B_ROLL: 3.8e-8,
  REAR_HEAT: 0.8,
  /** Wear per joule of slip energy at wearRate 1, wearScale 1 (S2-S4: 0.7 at Soft 18 / Medium 28 / Hard 38 laps, d 100). */
  K_WEAR: 9.27e-9,
};

export function effectiveTemp(t: TyreState): number {
  return 0.65 * t.surfC + 0.35 * t.coreC;
}

/** Dry-running wear multiplier for wet-weather compounds (§5.3: inters ×3 below W 0.15, wets ×4 below W 0.25). */
function dryWearMul(c: Compound, w: number): number {
  if (c === 'inter') return w < 0.15 ? 3 : 1;
  if (c === 'wet') return w < 0.25 ? 4 : 1;
  return 1;
}

/**
 * Advances one tyre by dt (s). `slipPowerW` = mean slip power, `fz` = load (N), `v` = speed (m/s),
 * `wet` = local wetness 0..1, `extraHeat` = additional surface heating in K/s (dirty air while cornering),
 * `rear` = rear axle (REAR_HEAT).
 */
export function stepTyre(
  t: TyreState, cp: TyreCompoundParams, compound: Compound, slipPowerW: number, fz: number, v: number,
  wet: number, trackC: number, airC: number, wearScale: number, extraHeat: number, rear: boolean, dt: number,
): void {
  const heat = (rear ? THERMAL.REAR_HEAT : 1) * cp.heatRate * (THERMAL.A_SLIP * slipPowerW + THERMAL.A_ROLL * fz * v) + extraHeat;
  const cool = (THERMAL.H0 + THERMAL.H1 * THERMAL.V_REF * Math.pow(v / THERMAL.V_REF, THERMAL.COOL_EXP)) * (1 + 2 * wet) * (t.surfC - trackC);
  const toCore = THERMAL.K_SC * (t.surfC - t.coreC);
  const ts = t.surfC + (heat - cool - toCore) * dt;
  const tc = t.coreC + (THERMAL.K_CS * (t.surfC - t.coreC) + cp.heatRate * THERMAL.B_ROLL * fz * v - THERMAL.H_CORE * (t.coreC - airC)) * dt;
  t.surfC = ts;
  t.coreC = tc;
  const teff = effectiveTemp(t);
  const over = teff - cp.tOptC;
  const overMul = over > 0 ? 1 + over / 15 : 1;
  const w = t.wear + THERMAL.K_WEAR * slipPowerW * dt * cp.wearRate * wearScale * overMul * dryWearMul(compound, wet);
  t.wear = w < 1 ? w : 1;
  t.gripMul = tempGrip(cp, teff) * wearGrip(t.wear);
}
