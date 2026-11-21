// defaultVehicleParams (planner-report §5.3). Sim layer.
// Tuned deviations from the §5.3 table (needed to meet the §5.11 benches; see docs in the S1 report):
//  - brakeTorqueTotal 12,600 N·m (table 17,800): with 17,800 the car brakes at 6.3 g at 300 km/h; the §5.11
//    peak-decel target is 4.5–5.5 g, so the brakes saturate above ~240 km/h (below that the tyres limit).
//  - ClA 5.0 (4.4), aeroFrontShare 0.43 (0.42), lltdFront 0.54 (0.52), loadSensitivity 0.05 (0.075): with the table
//    values the car reaches only 4.0 g at 250 km/h (target 4.3–5.2); this set gives 4.4 g while the front axle
//    still saturates first (stable understeer at the limit, which matters most for keyboard driving).
//  - drivetrainEff 0.98 (0.95): ERS top speed 321 → 324 km/h (target 322–332), ES-empty 300 → 303 (300–310).
//  - Sprint 2 (S2-S1, AI pace): compound μ × MU_SCALE 1.13 and CdA 1.42 (1.48), so the d = 100 AI laps İstanbul
//    in 1:24–1:27 with every §5.11 bench still inside its band (lateral g mid-band, top speed ≈ 328 km/h).
//  - Rear tyres peak at 0.9·αpk (VehicleParams.tuning.rearAlphaFactor): wider rears, extra linear-range yaw stability.
//  - S2-S4 wear life: wearRate Soft 0.92 / Medium 1.03 / Hard 0.877 (table 1.6 / 1.0 / 0.65; measured on the L9 conditions, track 37 °C). The §5.4 overheat factor
//    (1 + ΔT/15) already makes a Soft at its +15 °C wear ≈ 2× faster, so with the table rates it lasted 10, not 18, laps.

import type { Compound } from '../contracts/common';
import type { TeamTraits } from '../contracts/data';
import type { TyreCompoundParams, VehicleParams, VehicleTuningParams } from '../contracts/vehicle';

const SLICK_WET: readonly [number, number][] = [[0, 1.0], [0.1, 0.84], [0.2, 0.7], [0.35, 0.58], [0.5, 0.5], [0.75, 0.42], [1.0, 0.36]];
// S2-S6 (S-SM-07): Inters hold 0.94 to W 0.5 (table 0.88 gave +14.2 % at W 0.5, target +8–13 %) and fall to the Wets
// at the 0.62 crossover; Wets 0.89 at W 1 (table 0.86 gave +22.5 %, target +15–22 %). Crossovers unchanged: slick/inter
// ≈ 0.11, inter/wet ≈ 0.62 (pit-weather §4.6).
// D-040 (user: "too slippery in the rain"): Inters +4 % from W 0.35 (0.98 at W 0.5), Wets +4–5 % (0.93 at W 1);
// slick/inter crossover still ≈ 0.11, inter/wet ≈ 0.62.
const INTER_WET: readonly [number, number][] = [[0, 0.95], [0.1, 0.95], [0.2, 0.97], [0.35, 0.98], [0.5, 0.98], [0.62, 0.864], [0.75, 0.79], [1.0, 0.67]];
const WET_WET: readonly [number, number][] = [[0, 0.95], [0.1, 0.95], [0.2, 0.95], [0.35, 0.95], [0.5, 0.945], [0.75, 0.93], [1.0, 0.93]];

function compound(
  mu: number, tOptC: number, windowC: number, wearRate: number, heatRate: number,
  slipAnglePeak: number, slipRatioPeak: number, shapeC: number, blanketC: number, wetTable: readonly [number, number][],
): TyreCompoundParams {
  return { mu, tOptC, windowC, wearRate, heatRate, slipAnglePeak, slipRatioPeak, shapeC, blanketC, wetTable: wetTable.map(([w, m]) => [w, m]) };
}

/**
 * Sprint 2 (S2-S1) grip calibration: every compound's μ (§5.3 table) × 1.13. With the table μ the AI's
 * theoretical best on İstanbul (point-mass profile at 100 % of the car μ) is 90 s; the 1:24–1:27 target needs the
 * car in the middle of the §5.11 lateral bands (2.1 g at 80 km/h, 4.7 g at 250 km/h). Uniform, so compound and
 * wet ratios (S-SM-07) are unchanged.
 */
export const MU_SCALE = 1.13;

export function defaultCompounds(): Record<Compound, TyreCompoundParams> {
  return {
    soft: compound(1.82 * MU_SCALE, 100, 18, 0.92, 1.15, 0.095, 0.11, 1.38, 70, SLICK_WET),
    // Medium wear 1.03 -> 1.045 (2026-10-24): the charge-sustaining medium ERS strategy changed the d = 100 stint pace;
    // keeps 0.7 wear at 28 laps (S2 wear-life targets).
    medium: compound(1.75 * MU_SCALE, 105, 20, 1.045, 1.0, 0.1, 0.11, 1.35, 70, SLICK_WET),
    hard: compound(1.68 * MU_SCALE, 110, 22, 0.877, 0.9, 0.105, 0.11, 1.33, 70, SLICK_WET),
    // Inter/wet wear ×3 below W 0.15 / ×4 below W 0.25 is applied by the thermal/wear model.
    inter: compound(1.52 * MU_SCALE, 75, 20, 1.2, 0.95, 0.12, 0.12, 1.3, 60, INTER_WET),
    wet: compound(1.4 * MU_SCALE, 65, 20, 1.2, 0.85, 0.13, 0.13, 1.3, 60, WET_WET),
  };
}

/**
 * D-023 `VehicleParams.tuning`: `rearAlphaFactor` = the rear tyres reach peak slip at αpk × factor (wider
 * rears = stiffer), which keeps the car understeering in the linear range at every speed (cornering stiffness ∝ load
 * would make a statically balanced car neutral and unstable at high speed). Optional in the contract until L12.
 */
const DEFAULT_TUNING: VehicleTuningParams = { rearAlphaFactor: 0.9 };

export function tuning(p: VehicleParams): VehicleTuningParams {
  return p.tuning ?? DEFAULT_TUNING;
}

/**
 * D-036 team car character: trait ratings −1..+1 (higher = better) as small parameter deltas. `perf` stays the overall
 * level; traits move where a car is fast. Omitted (Time Trial, benches) = neutral.
 *   power ±2 % engine torque · lowDrag ∓3 % CdA · downforce ±4 % ClA · mechGrip ±1.5 % tyre μ
 *   tyreCare ∓15 % wear, ∓8 % heat-up · ers ±10 % deploy and harvest limits
 */
export const TRAIT_SCALE = { power: 0.02, lowDrag: 0.03, downforce: 0.04, mechGrip: 0.015, tyreWear: 0.15, tyreHeat: 0.08, ers: 0.1 } as const;

function applyTraits(p: VehicleParams, t: TeamTraits): void {
  const k = TRAIT_SCALE;
  const tq = 1 + k.power * t.power;
  p.torqueCurve = p.torqueCurve.map(([rpm, nm]) => [rpm, nm * tq]);
  p.CdA *= 1 - k.lowDrag * t.lowDrag;
  p.ClA *= 1 + k.downforce * t.downforce;
  for (const c of Object.values(p.compounds)) {
    c.mu *= 1 + k.mechGrip * t.mechGrip;
    c.wearRate *= 1 - k.tyreWear * t.tyreCare;
    c.heatRate *= 1 - k.tyreHeat * t.tyreCare;
  }
  p.ers.deployLimitMJ *= 1 + k.ers * t.ers;
  p.ers.harvestKLimitMJ *= 1 + k.ers * t.ers;
}

/**
 * D-037 per-track aero trim (−1..+1, negative = low downforce / low drag): trim −1 = ClA −15 %, CdA −12 % (a
 * low-downforce package for a power track). Every ClA / CdA reader goes through these two.
 */
export function aeroClA(p: VehicleParams): number {
  return p.aeroTrim ? p.ClA * (1 + 0.15 * p.aeroTrim) : p.ClA;
}
export function aeroCdA(p: VehicleParams): number {
  return p.aeroTrim ? p.CdA * (1 + 0.12 * p.aeroTrim) : p.CdA;
}

/** `teamPerf` (±0.015) scales power and ClA by (1 + perf) inside the vehicle model; `traits` per D-036. */
export function defaultVehicleParams(teamPerf: number, traits?: TeamTraits): VehicleParams {
  const p: VehicleParams = {
    massDryKg: 798,
    cgHeight: 0.28,
    frontWeightFrac: 0.455,
    wheelbase: 3.6,
    trackFront: 1.6,
    trackRear: 1.55,
    yawInertiaPerKg: 1.4,
    wheelRadius: 0.36,
    wheelInertiaFront: 1.1,
    wheelInertiaRear: 1.4,
    engineInertia: 0.06,
    maxSteerRad: 0.384,
    ackermann: 0.3,
    steeringWheelRatio: 8,
    lltdFront: 0.54,
    ClA: 5.0,
    CdA: 1.42,
    aeroFrontShare: 0.43,
    airDensity: 1.2,
    drsDragFactor: 0.885,
    drsDownforceFactor: 0.92,
    drsOpenTime: 0.25,
    drsCloseTime: 0.15,
    torqueCurve: [[4000, 330], [6000, 400], [8000, 460], [9000, 485], [10000, 505], [10500, 505], [11000, 486], [12000, 445], [12500, 410]],
    engineBrakeCurve: [[4000, -30], [8000, -70], [12000, -110]],
    idleRpm: 4000,
    limiterRpm: 12500,
    launchRpm: 9500,
    gearRatios: [2.95, 2.32, 1.9, 1.62, 1.4, 1.22, 1.067, 0.933],
    finalDrive: 5.25,
    drivetrainEff: 0.98,
    upshiftTime: 0.035,
    downshiftTime: 0.06,
    shiftTorqueFactor: 0.25,
    diffLockPower: 0.35,
    diffLockCoast: 0.15,
    brakeTorqueTotal: 12600,
    brakeBiasDefault: 0.575,
    ers: { maxKw: 120, capacityMJ: 4.0, deployLimitMJ: 4.0, harvestKLimitMJ: 2.0, maxHarvestKkW: 120, maxHarvestHkW: 40, maxTorqueNm: 240 },
    rollingResistance: 0.012,
    loadSensitivity: 0.05,
    loadRefN: 4000,
    fuelKgPerLap: 1.75,
    compounds: defaultCompounds(),
    bodyLength: 5.6,
    bodyWidth: 2.0,
    teamPerf,
    tuning: { ...DEFAULT_TUNING },
  };
  if (traits) applyTraits(p, traits);
  return p;
}
