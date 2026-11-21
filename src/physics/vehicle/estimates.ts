// Closed-form vehicle estimates shared by the keyboard filter (§5.7), the assists (§5.8) and the AI speed
// profile (§6.2). Sim layer, allocation-free.

import type { Compound } from '../../contracts/common';
import type { VehicleParams } from '../../contracts/vehicle';
import { G } from '../constants';
import { loadSens, wetGripFor } from '../tyre/grip';
import { aeroCdA, aeroClA } from '../params';

/** μest of §5.7: 1.6 × wetTable(compound, W). */
export const MU_EST = 1.6;

/** Lateral acceleration limit aLat(v) = μ·(g + ½ρClA·v²/m), m/s². */
export function lateralLimit(p: VehicleParams, mu: number, v: number, massKg: number, rho: number): number {
  return mu * (G + (0.5 * rho * aeroClA(p) * (1 + p.teamPerf) * v * v) / massKg);
}

/** §5.7 steering limit δmax(v) = min(maxSteer, atan(L·aLat(v)/max(v², 1)) + αpk·k), k = 0.9 (assist) / 1.25. */
export function steerLimit(p: VehicleParams, c: Compound, wetness: number, v: number, massKg: number, rho: number, assist: boolean): number {
  const mu = MU_EST * wetGripFor(p, c, wetness);
  const aLat = lateralLimit(p, mu, v, massKg, rho);
  const k = assist ? 0.9 : 1.25;
  const d = Math.atan((p.wheelbase * aLat) / Math.max(v * v, 1)) + p.compounds[c].slipAnglePeak * k;
  return d < p.maxSteerRad ? d : p.maxSteerRad;
}

/**
 * Effective friction coefficient of the whole car at speed v, with each wheel at its share of the static +
 * aero load (load sensitivity applied). `muBase` = compound μ × wet × temperature/wear × surface.
 */
export function effectiveMu(p: VehicleParams, muBase: number, v: number, massKg: number, rho: number): number {
  const fdf = 0.5 * rho * aeroClA(p) * (1 + p.teamPerf) * v * v;
  const n = massKg * G + fdf;
  const front = (massKg * G * p.frontWeightFrac + fdf * p.aeroFrontShare) * 0.5;
  const rear = n * 0.5 - front;
  return (muBase * (front * loadSens(p, front) + rear * loadSens(p, rear)) * 2) / n;
}

/**
 * Brake pedal fraction (0..∞) at which the first axle locks when braking at the limit on a straight at speed v
 * (keyboard brake limiter, §5.7). `muBase` as for effectiveMu.
 */
export function brakeLockPedal(p: VehicleParams, muBase: number, v: number, massKg: number, rho: number, bias: number): number {
  const L = p.wheelbase;
  const a = L * (1 - p.frontWeightFrac);
  const b = L - a;
  const q = 0.5 * rho * v * v;
  const fdf = q * aeroClA(p) * (1 + p.teamPerf);
  const drag = q * aeroCdA(p);
  const n = massKg * G + fdf;
  const mu = effectiveMu(p, muBase, v, massKg, rho);
  const dec = (mu * n + drag) / massKg;
  const ff = (massKg * G * b) / L + fdf * p.aeroFrontShare + (massKg * dec * p.cgHeight) / L;
  const fr = n - ff > 50 ? n - ff : 50;
  const R = p.wheelRadius;
  const tf = muBase * ff * loadSens(p, ff * 0.5) * R;
  const tr = muBase * fr * loadSens(p, fr * 0.5) * R;
  const pf = tf / (p.brakeTorqueTotal * bias);
  const pr = tr / (p.brakeTorqueTotal * (1 - bias));
  return pf < pr ? pf : pr;
}

/** Maximum straight-line braking deceleration (tyres or brake torque, whichever limits), m/s². */
export function brakeDecelLimit(p: VehicleParams, muBase: number, v: number, massKg: number, rho: number): number {
  const q = 0.5 * rho * v * v;
  const fdf = q * aeroClA(p) * (1 + p.teamPerf);
  const drag = q * aeroCdA(p);
  const mu = effectiveMu(p, muBase, v, massKg, rho);
  const tyre = mu * (massKg * G + fdf);
  const brake = p.brakeTorqueTotal / p.wheelRadius;
  return ((tyre < brake ? tyre : brake) + drag) / massKg;
}
