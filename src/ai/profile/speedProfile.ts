// Speed profile (planner-report §6.2) and difficulty scaling (§6.4). Sim layer; buildSpeedProfile allocates
// only when no `out` is given (setup), rebuilds in place otherwise.
//
// Corner limit v = √(μ·g_eff/(|κ| − μ·k)), k = ½ρClA/m, iterated 3× with the load-sensitive car μ and the
// vertical curvature/grade; forward pass a = min(P/(m·v) − drag/m − rr, traction)·√(1 − (aLat/aLatMax)²); backward
// pass a = brakeLimit·brakeEff·√(1 − (aLat/aLatMax)²) (tyres or brake torque, whichever limits); both looped
// twice around the closed circuit. Zones: accel < −3 → brake, −3…0.5 → lift, else throttle.

import type { RacingLine, SpeedProfile } from '../../contracts/ai';
import type { Compound } from '../../contracts/common';
import type { GroundHit, TrackFrame, TrackHint, TrackQuery } from '../../contracts/track';
import type { VehicleParams } from '../../contracts/vehicle';
import { airDensity, G } from '../../physics/constants';
import { peakPowerW } from '../../physics/powertrain/powertrain';
import { wetGripFor } from '../../physics/tyre/grip';
import { brakeDecelLimit, effectiveMu } from '../../physics/vehicle/estimates';
import { aeroCdA, aeroClA } from '../../physics/params';

/** Share of the theoretical car μ the physics car actually reaches at the limit (front-axle limited, measured 0.93). */
export const ACHIEVABLE_MU = 0.97;
/** Extra AI margin on cornering speed (d = 100 still leaves 3 % of grip unused). */
export const AI_MARGIN = 0.98;
/** Share of the MGU-K 120 kW the forward pass counts on. Over-estimating the straight-line speed is harmless (the
 * braking curve comes from the backward pass and the controller keeps full throttle until the car reaches it); under-
 * estimating it caps the car below its real top speed (S1: 311 km/h at the end of the back straight). */
const ERS_SHARE = 1;
const V_MAX = 100;

/** Difficulty ladder knots (user 2026-10-25: d0 +9–10 %, d55 +4 %, d70 +2.5–3 %, d85 +1.2 %, d100 = calibrated, d110 −0.8 %
 * lap time vs the d = 100 perfect driver, for a pace-1.0 driver). The old ladder (grip 0.86–1.0 only) spanned 0.6 % between
 * d55 and d70 and 1.5 % between d55 and d100: changing the setting was hard to feel. */
const LADDER_D = [0, 55, 70, 85, 100, 110];
/** Corner grip used (× the profile's own margins). Above 1 at d ≥ 100: the non-perfect driver's line noise and form cost
 * ~0.4 % that the perfect driver does not pay. */
const LADDER_GRIP = [0.83, 0.9, 0.93, 0.97, 1.02, 1.04];
/** Share of the engine + ERS power used (throttle cap): corners alone could not slow a d0 car by 9 % on power tracks. */
const LADDER_POWER = [0.94, 0.97, 0.98, 0.993, 1, 1];
const LADDER_BRAKE = [0.85, 0.93, 0.95, 0.975, 1, 1];
/** Scale of the corner-commitment noise (line/variety.ts vMul): its mean is below 1 (options that cost speed, the +0.5 %
 * cap) and cost a d100 driver ~0.5 % a lap; the best drivers are also the most consistent. */
const LADDER_VAR = [1.3, 1.15, 1, 0.75, 0.4, 0.05];

function ladder(t: readonly number[], d: number): number {
  if (d <= 0) return t[0]!;
  for (let k = 1; k < LADDER_D.length; k++) {
    const d1 = LADDER_D[k]!;
    if (d <= d1) {
      const d0 = LADDER_D[k - 1]!;
      return t[k - 1]! + ((t[k]! - t[k - 1]!) * (d - d0)) / (d1 - d0);
    }
  }
  return t[t.length - 1]!;
}
export function gripScaleFor(d: number): number {
  return ladder(LADDER_GRIP, d);
}
export function brakeEffFor(d: number): number {
  return ladder(LADDER_BRAKE, d);
}
export function powerScaleFor(d: number): number {
  return ladder(LADDER_POWER, d);
}
export function varietyScaleFor(d: number): number {
  return ladder(LADDER_VAR, d);
}
export function mistakeChanceFor(d: number): number {
  const x = 1 - Math.min(d, 100) / 100;
  return 0.002 + 0.02 * x * x;
}
export function startReactionFor(d: number): number {
  return 0.4 - (0.18 * Math.min(d, 110)) / 110;
}

export interface ProfileOpts {
  gripScale: number;
  brakeEff: number;
  /** Share of the power the car uses (difficulty throttle cap; 1 = all). */
  powerScale: number;
  wetness: number;
  compound: Compound;
  massKg: number;
  airC: number;
}

/**
 * Per-sample vertical curvature and grade along the line (cached once per track). Bank term per sample: +g·sinθ
 * helps cornering when the outside of the turn is higher. `drs` = 1 inside a DRS activation zone.
 */
/** `grip`: surface μ factor at each line sample (1 on asphalt; volcanic ash ≈ 0.85), so the AI brakes earlier and corners
 *  slower over low-grip surfaces. */
export interface LineTrackCache { vCurv: Float32Array; grade: Float32Array; bank: Float32Array; drs: Uint8Array; grip: Float32Array }

function inDrsZone(q: TrackQuery, s: number): boolean {
  const zones = q.data.drsZones;
  for (let z = 0; z < zones.length; z++) {
    const a = zones[z]!.activateS;
    const e = zones[z]!.endS;
    if (a <= e ? s >= a && s < e : s >= a || s < e) return true;
  }
  return false;
}

export function buildLineTrackCache(q: TrackQuery, line: RacingLine): LineTrackCache {
  const vCurv = new Float32Array(line.count);
  const grade = new Float32Array(line.count);
  const bank = new Float32Array(line.count);
  const drs = new Uint8Array(line.count);
  const grip = new Float32Array(line.count).fill(1);
  const hit: GroundHit = { y: 0, nx: 0, ny: 1, nz: 0, surface: 'asphalt', ribbon: 'main', s: 0, d: 0, sp: NaN, inLimits: true, wetLocal: 1 };
  const hint: TrackHint = { s: 0, ribbon: 'main', sp: NaN };
  const f: TrackFrame = {
    s: 0, px: 0, py: 0, pz: 0, tx: 1, tz: 0, lx: 0, lz: -1, halfWidthL: 0, halfWidthR: 0, crossSlope: 0, curvature: 0, vCurvature: 0, grade: 0, sector: 0,
  };
  for (let i = 0; i < line.count; i++) {
    q.frameAt(line.s[i]!, f);
    vCurv[i] = f.vCurvature;
    grade[i] = f.grade;
    // crossSlope = dy/dd (+ = left side higher). For a left turn (κ > 0) the outside is the right side.
    const k = line.curvature[i]!;
    bank[i] = k > 0 ? -f.crossSlope : k < 0 ? f.crossSlope : 0;
    drs[i] = inDrsZone(q, line.s[i]!) ? 1 : 0;
    hint.s = line.s[i]!;
    q.ground(line.x[i]!, line.z[i]!, hint, hit);
    // Only the ash surface lowers it (kerbs / lines on the line stay at 1 so every other track's profile is unchanged).
    if (hit.surface === 'ash') grip[i] = q.surfaceProps('ash').mu;
  }
  return { vCurv, grade, bank, drs, grip };
}

export function buildSpeedProfile(line: RacingLine, cache: LineTrackCache, p: VehicleParams, o: ProfileOpts, out?: SpeedProfile): SpeedProfile {
  const n = line.count;
  const m = o.massKg;
  const rho = airDensity(p.airDensity, o.airC);
  const comp = p.compounds[o.compound];
  const wet = o.wetness;
  const muBase = comp.mu * wetGripFor(p, o.compound, wet) * (1 - 0.03 * wet) * o.gripScale * ACHIEVABLE_MU * AI_MARGIN;
  const kAero = (0.5 * rho * aeroClA(p) * (1 + p.teamPerf)) / m;
  const kDrag = (0.5 * rho * aeroCdA(p)) / m;
  const power = (peakPowerW(p) * 0.97 + p.ers.maxKw * 1000 * ERS_SHARE) * p.drivetrainEff * o.powerScale;
  const v = out?.v ?? new Float32Array(n);
  const accel = out?.accel ?? new Float32Array(n);
  const zone = out?.zone ?? new Uint8Array(n);
  const ds = line.ds;

  // Speed-indexed tables (1 m/s steps): effective μ, lateral limit, braking limit.
  const NT = V_MAX + 2;
  const muT = new Float64Array(NT);
  const aLatT = new Float64Array(NT);
  const aBrkT = new Float64Array(NT);
  const tracT = new Float64Array(NT);
  for (let k = 0; k < NT; k++) {
    const mu = effectiveMu(p, muBase, k, m, rho);
    muT[k] = mu;
    aLatT[k] = mu * (G + kAero * k * k);
    aBrkT[k] = brakeDecelLimit(p, muBase, k, m, rho) * o.brakeEff * 0.96;
    tracT[k] = mu * (G * 0.545 + kAero * k * k * (1 - p.aeroFrontShare)) * 0.95;
  }
  const tab = (t: Float64Array, x: number): number => {
    const xi = x < 0 ? 0 : x > NT - 1.001 ? NT - 1.001 : x;
    const i = xi | 0;
    return t[i]! + (t[i + 1]! - t[i]!) * (xi - i);
  };

  // Corner limits.
  for (let i = 0; i < n; i++) {
    const kap = Math.abs(line.curvature[i]!);
    let vi = V_MAX;
    for (let it = 0; it < 3; it++) {
      const mu = tab(muT, vi) * cache.grip[i]!;
      const gEff = G + vi * vi * cache.vCurv[i]!;
      const den = kap - mu * kAero;
      const num = mu * (gEff > 1 ? gEff : 1) + G * cache.bank[i]!;
      vi = den > 1e-6 ? Math.sqrt((num > 1 ? num : 1) / den) : V_MAX;
      if (vi > V_MAX) vi = V_MAX;
    }
    v[i] = vi;
  }
  // Vertical curvature changes the normal load (QC2-07: on the T3 crest, vc ≈ −0.001/m at 45 m/s takes ~10 % of the
  // load away; the corner limit counted it but the braking / lateral budget did not, so cars trail-braked into T3
  // with ~10 % more grip than they had and slid wide, worst on cold tyres on lap 1).
  const loadF = (i: number, vi: number): number => {
    const g0 = G + kAero * vi * vi;
    const f = (g0 + vi * vi * cache.vCurv[i]!) / g0;
    return f < 0.5 ? 0.5 : f > 1.5 ? 1.5 : f;
  };
  const latFactor = (i: number, vi: number): number => {
    const aLat = vi * vi * Math.abs(line.curvature[i]!);
    const r = aLat / (tab(aLatT, vi) * cache.grip[i]! * loadF(i, vi));
    return r >= 1 ? 0 : Math.sqrt(1 - r * r);
  };
  for (let pass = 0; pass < 2; pass++) {
    // Backward (braking) pass.
    for (let j = 2 * n - 1; j >= 0; j--) {
      const i = j % n;
      const nx = (i + 1) % n;
      const vn = v[nx]!;
      const aB = tab(aBrkT, vn) * cache.grip[nx]! * loadF(nx, vn) * latFactor(nx, vn) + G * cache.grade[nx]!;
      const lim = Math.sqrt(vn * vn + 2 * (aB > 0.5 ? aB : 0.5) * ds);
      if (v[i]! > lim) v[i] = lim;
    }
    // Forward (power / traction) pass.
    for (let j = 0; j < 2 * n; j++) {
      const i = j % n;
      const vi = v[i]!;
      const vv = vi > 5 ? vi : 5;
      const traction = tab(tracT, vi) * cache.grip[i]!;
      const kd = cache.drs[i] === 1 ? kDrag * p.drsDragFactor : kDrag;
      const aP = power / (m * vv) - kd * vi * vi - p.rollingResistance * G;
      let a = (aP < traction ? aP : traction) * latFactor(i, vi) - G * cache.grade[i]!;
      if (a < 0) a = 0;
      const lim = Math.sqrt(vi * vi + 2 * a * ds);
      const nx = (i + 1) % n;
      if (v[nx]! > lim) v[nx] = lim;
    }
  }
  for (let i = 0; i < n; i++) {
    const vn = v[(i + 1) % n]!;
    const a = (vn * vn - v[i]! * v[i]!) / (2 * ds);
    accel[i] = a;
    zone[i] = a < -3 ? 2 : a < 0.5 ? 1 : 0;
  }
  if (out) {
    out.gripScale = o.gripScale;
    out.wetness = wet;
    return out;
  }
  return { line, v, accel, zone, gripScale: o.gripScale, wetness: wet };
}
