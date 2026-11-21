// Tyre grip and force model (planner-report §5.2 step 7, §5.3, §5.4). Sim layer, allocation-free.

import type { Compound } from '../../contracts/common';
import type { TyreCompoundParams, VehicleParams } from '../../contracts/vehicle';
import { interpTable } from '../../core/math/scalar';

/** Wet-grip multiplier on the compound's own μ at wetness W (linear interpolation of the §5.3 table). */
export function wetGrip(c: TyreCompoundParams, w: number): number {
  return interpTable(c.wetTable, w);
}

export function wetGripFor(p: VehicleParams, compound: Compound, w: number): number {
  return interpTable(p.compounds[compound].wetTable, w);
}

/**
 * Per-wheel wetness W_local (pit-weather §4.4): `wetLocal` ≤ 1 blends the racing-line wetness `lw` (0) into the
 * track wetness `w` (1); a puddle (`wetLocal` 2) is fully wet only once W > 0.65, below that it is plain track.
 */
export function localWetness(w: number, lw: number, wetLocal: number): number {
  if (wetLocal > 1) return w > 0.65 ? 1 : w;
  return lw + (w - lw) * wetLocal;
}

/** `loadSens = clamp(1 − k·(Fz/Fref − 1), 0.80, 1.10)`. */
export function loadSens(p: VehicleParams, fz: number): number {
  const v = 1 - p.loadSensitivity * (fz / p.loadRefN - 1);
  return v < 0.8 ? 0.8 : v > 1.1 ? 1.1 : v;
}

/** Temperature grip gT (§5.4). `t` = effective tyre temperature (°C). */
export function tempGrip(c: TyreCompoundParams, t: number): number {
  const dt = t - c.tOptC;
  if (dt < 0) {
    const x = dt / 45;
    const q = x * x;
    return 1 - 0.25 * (q < 1 ? q : 1);
  }
  const x = dt / 40;
  const q = x * x;
  return 1 - 0.3 * (q < 1 ? q : 1);
}

/** Wear grip gWear (§5.4): −10 % linear up to w = 0.7, then a cliff of a further −35 % at w = 1. */
export function wearGrip(w: number): number {
  const lin = 1 - (0.1 * (w < 0.7 ? w : 0.7)) / 0.7;
  return w > 0.7 ? lin - (0.35 * (w - 0.7)) / 0.3 : lin;
}

export interface TyreForceOut {
  fx: number;
  fy: number;
  /** Combined normalised slip σ (1 = peak). */
  sigma: number;
  /** ∂Fx/∂κ at the operating point (for the implicit wheel-spin update). */
  dfxdk: number;
}

/** 2.3: σ = 1 maps to the peak of sin(C·atan(2.3σ)) for C ≈ 1.35. */
const B = 2.3;

const HALF_PI = Math.PI / 2;

/**
 * Combined-slip force: σx = κ/κpk, σy = tanα/tanαpk, σ = |(σx, σy)|, F = D·sin(C·atan(2.3σ)),
 * Fx = F·σx/σ, Fy = −F·σy/σ (Fy opposes the contact patch's lateral velocity).
 * `drop` (D-040) scales the force lost past the peak: F = D·(1 − drop·(1 − sin(C·atan(2.3σ)))), 1 = §5.2 curve;
 * a wet contact patch is less peaky (vehicleSystem passes 1 − 0.6·W_local).
 */
export function tyreForce(kappa: number, tanA: number, d: number, kpk: number, tanApk: number, c: number, out: TyreForceOut, drop = 1): TyreForceOut {
  const sx = kappa / kpk;
  const sy = tanA / tanApk;
  const s = Math.sqrt(sx * sx + sy * sy);
  const k0 = (d * c * B) / kpk;
  if (s < 1e-6) {
    out.fx = 0;
    out.fy = 0;
    out.sigma = s;
    out.dfxdk = k0;
    return out;
  }
  const at = Math.atan(B * s);
  const ca = c * at;
  // drop = 1 keeps the exact §5.2 arithmetic (dry runs stay bit-identical).
  const past = drop !== 1 && ca > HALF_PI;
  const f = past ? d * (1 - drop * (1 - Math.sin(ca))) : d * Math.sin(ca);
  const inv = 1 / s;
  out.fx = f * sx * inv;
  out.fy = -f * sy * inv;
  out.sigma = s;
  // ∂Fx/∂σx = F'(σ)·(σx/σ)² + (F/σ)·(1 − (σx/σ)²)
  const fp = ((past ? drop : 1) * d * Math.cos(ca) * c * B) / (1 + B * B * s * s);
  const ux = sx * inv;
  const u2 = ux * ux;
  out.dfxdk = (fp * u2 + f * inv * (1 - u2)) / kpk;
  return out;
}

/** Magnitude of the longitudinal force the tyre makes at slip ratio `kappa` with the current lateral slip. */
export function tyreFxAt(kappa: number, tanA: number, d: number, kpk: number, tanApk: number, c: number): number {
  const sx = kappa / kpk;
  const sy = tanA / tanApk;
  const s = Math.sqrt(sx * sx + sy * sy);
  if (s < 1e-6) return 0;
  const f = d * Math.sin(c * Math.atan(B * s));
  const v = (f * sx) / s;
  return v < 0 ? -v : v;
}
