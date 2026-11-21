// Player-side assists that shape VehicleInput (planner-report §5.8): steering assist counter-steer, braking
// assist (player SpeedProfile). ABS/TC/auto gearbox act inside the VehicleSystem (assists/wheelAssists.ts).
// Sim layer, allocation-free.

import type { SpeedProfile } from '../../contracts/ai';
import type { AssistSettings } from '../../contracts/race';
import type { VehicleParams, VehicleState } from '../../contracts/vehicle';
import { DEG } from '../constants';
import { tuning } from '../params';

const CS_GAIN = 0.5;
const CS_MAX = 4 * DEG;
/** Dry share of the stability window (the wet share ramps to 1 at W 0.3). */
const DRY_STABILITY = 1;
/** Dry stability onset: body slip (rad) where it starts, and the span to full effect. */
const DRY_BETA_ON = 5 * DEG;
const DRY_BETA_SPAN = 3 * DEG;
/** Braking narrowing of the front window: deceleration (m/s²) where it starts, span to full, and the k drop. */
const BRAKE_K_ON = 15;
const BRAKE_K_SPAN = 25;
const BRAKE_K_DROP = 0.3;
/** Predictive narrowing: rear slip angle / rear peak where it starts, span to full, and the k drop. */
const PRED_ON = 0.85;
const PRED_SPAN = 0.3;
const PRED_DROP = 0.25;

/**
 * Counter-steer correction in rad (to be subtracted from the driver's δ) when the rear slip angle exceeds
 * 0.75·αpk: δcs = 0.5·(r − v·κpath), clamped to ±4°, faded in over 0.75…1.0·αpk. Only acts when the car rotates
 * faster than its path (oversteer).
 */
export function counterSteer(p: VehicleParams, v: VehicleState): number {
  // 2026-10-19: faded in on the REAR peak slip angle (0.9…1.1·αpk,rear). It used the front peak, so it already acted
  // (up to 4°) in ordinary turn-in, where the rear runs well inside its own, larger peak.
  const apk = p.compounds[v.compound].slipAnglePeak * tuning(p).rearAlphaFactor;
  const ar = Math.max(Math.abs(v.wheels[2].slipAngle), Math.abs(v.wheels[3].slipAngle));
  const w = (ar - 0.9 * apk) / (0.2 * apk);
  if (w <= 0 || v.speed < 5 || v.vLong < 0) return 0;
  const sp = v.speed;
  const kPath = v.ayLat / (sp * sp);
  const excess = v.yawRate - sp * kPath;
  if (excess * v.yawRate <= 0) return 0;
  let d = CS_GAIN * excess;
  if (d > CS_MAX) d = CS_MAX;
  else if (d < -CS_MAX) d = -CS_MAX;
  return d * (w < 1 ? w : 1);
}

/**
 * Steering-assist front-slip limit: the front wheel angle is kept within ±k·αpk of the front axle's velocity
 * direction θf = atan2(vLat + a·r, vLong), so a held key can never overload the front tyres (no plough), and in a
 * rear slide (θf swings outward) the clamp itself produces counter-steer. Returns [lo, hi] in rad via `out`.
 */
export function frontSlipWindow(p: VehicleParams, v: VehicleState, k: number, out: Float64Array): void {
  const a = p.wheelbase * (1 - p.frontWeightFrac);
  const vl = v.vLong > 5 ? v.vLong : 5;
  const th = Math.atan2(v.vLat + a * v.yawRate, vl);
  const w = k * p.compounds[v.compound].slipAnglePeak;
  out[0] = th - w;
  out[1] = th + w;
}

/**
 * Stability window (D-040 wet, dry since 2026-10-17, dry only on a real slide since 2026-10-19): the front-slip window
 * factor k (normally 0.9). A rear past its peak slip angle shrinks k to 0.3 by 1.5·αpk(rear) (dry: only while the body
 * slip is past 5° and the car over-rotates), so a held steering key stops feeding yaw into the slide (the
 * front gives up grip first and the rear recovers: the car scrubs speed instead of snapping round) instead of pinning
 * the front at its limit. Steering-assist presets only (Beginner/Intermediate); Expert keeps a lively rear. Before the
 * dry case, arriving ~10 % over the mid-corner speed at İstanbul T1 on Intermediate let the rear slide to 28°.
 * `rearLoose` (0..1, rear wheels on gravel/grass) fades the shrink out so the rear can step out on a loose surface.
 */
export function frontWindowK(p: VehicleParams, v: VehicleState, wet: number, rearLoose = 0): number {
  // Braking load transfer (2026-10-19): under hard braking the front is loaded and the rear light, so the full front
  // window out-turns the rear; it narrows with the deceleration (0.9 → 0.6 from 1.5 g to 4 g).
  let base = 0.9;
  const dec = -v.axLong;
  if (dec > BRAKE_K_ON) {
    const e = (dec - BRAKE_K_ON) / BRAKE_K_SPAN;
    base = 0.9 - BRAKE_K_DROP * (e > 1 ? 1 : e) * (1 - rearLoose);
  }
  const apkR = p.compounds[v.compound].slipAnglePeak * tuning(p).rearAlphaFactor;
  const ar = Math.max(Math.abs(v.wheels[2].slipAngle), Math.abs(v.wheels[3].slipAngle));
  // Predictive (2026-10-19): as the rear approaches its peak slip angle the front window narrows a little, so the front
  // cannot out-turn the rear (the car settles into gentle understeer at the limit instead of the rear stepping out).
  // The steer never reverses for it (the input system floors the lock at straight while a key is held).
  let pr = (ar / apkR - PRED_ON) / PRED_SPAN;
  if (pr > 0) {
    if (pr > 1) pr = 1;
    const kp = 0.9 - PRED_DROP * pr * (1 - rearLoose);
    if (kp < base) base = kp;
  }
  let x = (ar / apkR - 1) / 0.5;
  if (x <= 0) return base;
  if (x > 1) x = 1;
  const wf = wet < 0.3 ? wet / 0.3 : 1;
  // Dry: only a genuine slide counts. In ordinary limit cornering the rear runs 1.1–1.4·αpk at 2–5° body slip; shrinking
  // the window there pulled the steering out mid-corner (the car "straightened", user report 2026-10-18). So the dry
  // share also needs the body slip past DRY_BETA_ON (full at +DRY_BETA_SPAN) and the car rotating faster than its path.
  let dry = 0;
  if (v.speed > 5) {
    const beta = Math.abs(Math.atan2(v.vLat, v.vLong > 0.1 ? v.vLong : 0.1));
    const excess = v.yawRate - v.ayLat / v.speed;
    if (excess * v.yawRate > 0) {
      dry = (beta - DRY_BETA_ON) / DRY_BETA_SPAN;
      dry = dry <= 0 ? 0 : dry > 1 ? DRY_STABILITY : dry * DRY_STABILITY;
    }
  }
  const share = wf > dry ? wf : dry;
  if (share <= 0) return base;
  const k = 0.9 - 0.6 * x * share * (1 - rearLoose);
  return k < base ? k : base;
}

/** Profile speed (m/s) at main-track s (linear interpolation, wraps). */
export function profileSpeedAt(prof: SpeedProfile, s: number, length: number): number {
  const line = prof.line;
  let sw = s % length;
  if (sw < 0) sw += length;
  const f = sw / line.ds;
  const i0 = Math.floor(f);
  const t = f - i0;
  const n = line.count;
  const i = i0 % n;
  const j = (i + 1) % n;
  return prof.v[i]! + (prof.v[j]! - prof.v[i]!) * t;
}

const BRAKE_MARGIN: Readonly<Record<AssistSettings['braking'], number>> = { off: 0, low: 0.15, medium: 0.07, high: 0 };

/**
 * Braking assist (§5.8): brakes in proportion when v exceeds target·(1 + m) (m = 0.15 / 0.07 / 0 for
 * Low / Medium / High). Returns the assist brake demand 0..1 (0 when off).
 */
export function brakingAssist(level: AssistSettings['braking'], prof: SpeedProfile | null, s: number, speed: number, length: number): number {
  if (level === 'off' || prof === null) return 0;
  const target = profileSpeedAt(prof, s + 0.1 * speed, length) * (1 + BRAKE_MARGIN[level]);
  const e = speed - target;
  if (e <= 0) return 0;
  const b = e / 3;
  return b < 1 ? b : 1;
}
