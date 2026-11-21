// Online puppets (design §5.2): remote cars inside the local sim are posed from their streamed samples, never simulated.
// Glue writer (ARCHITECTURE §4.3 row "puppet writer"): runs before each tick, so RenderFrame/graphics/audio see puppets
// exactly like normal cars. Pure and allocation-free after creation (no clocks: the caller passes sim time in seconds).
//
// Sampling (shared race clock: a sample's simMs and the local sim time live on one timeline):
//   t ≤ newest sample  → cubic Hermite between the two bracketing samples (positions with velocity tangents, yaw with yaw rate);
//   t > newest         → constant-curvature arc with the path acceleration of the two newest samples for up to 400 ms (the
//                        contact horizon, physics/remote/contact CONTACT_STALE_MS), then 'stale': the car rolls to a stop
//                        within PUPPET_STOP_S on the same arc and holds. (Lead-Net 2026-10-26: the old 250 ms horizon froze every
//                        car of a player ≥ ~180 ms away several times a second — stop, jump, stop — and let contacts hit a
//                        frozen pose between 250 and 400 ms.)
// Correction: when a new sample moves the pose shown at the current time, the error is blended out over 150 ms (position) /
// 100 ms (yaw) by a cubic that starts with the shown motion's rate (C1: no velocity jump at a sample); an error > 15 m or a
// sender reset flag snaps instead (the caller then calls rf.snapPrev).

import type { NetCarState } from '../../contracts/net';
import type { SimCarState } from '../../contracts/sim';
import type { GroundHit, TrackQuery } from '../../contracts/track';
import type { VehicleParams } from '../../contracts/vehicle';
import {
  NET_FLAG_DRS_OPEN, NET_FLAG_IN_PIT_BOX, NET_FLAG_PIT_LIMITER, NET_FLAG_RESET, NET_FLAG_REVERSE, newNetCarState,
} from '../../net/index';

export const PUPPET_SAMPLES = 16;
export const PUPPET_MAX_EXTRAP_S = 0.4;
export const PUPPET_SNAP_M = 15;
export const PUPPET_BLEND_POS_S = 0.15;
export const PUPPET_BLEND_YAW_S = 0.1;
/** Past the horizon a stale puppet rolls to a stop over this long (s) instead of freezing at speed. */
export const PUPPET_STOP_S = 0.5;
/** Cap of the velocity difference carried into a correction (m/s). */
const PUPPET_BLEND_V_MAX = 20;
/** Path acceleration used by the extrapolation: cap (m/s², ≈ 5 g braking) and the widest sample gap it is estimated over (s). */
const PUPPET_ACCEL_MAX = 50;
const PUPPET_ACCEL_MAX_GAP_S = 0.2;
/** ERS deploy power shown for a puppet that reports deploying (visual/audio only). */
const PUPPET_ERS_KW = 120;
const TWO_PI = Math.PI * 2;

export interface PuppetPose { x: number; z: number; yaw: number; vx: number; vz: number; yawRate: number; progress: number }
export type PuppetStatus = 'none' | 'live' | 'stale';

export function newPuppetPose(): PuppetPose {
  return { x: 0, z: 0, yaw: 0, vx: 0, vz: 0, yawRate: 0, progress: 0 };
}

const clampAbs = (v: number, m: number): number => (v > m ? m : v < -m ? -m : v);

function wrapPi(a: number): number {
  let w = a % TWO_PI;
  if (w > Math.PI) w -= TWO_PI;
  else if (w <= -Math.PI) w += TWO_PI;
  return w;
}

/**
 * Constant-curvature arc from a sample over `dt` s with a constant path acceleration `accel` (m/s², 0 = constant speed and yaw
 * rate; a braking car stops at speed 0). Yaw convention of the sim: heading = (cos yaw, −sin yaw), so a vector rotates by Δ as
 * (x cosΔ + z sinΔ, z cosΔ − x sinΔ).
 */
export function extrapolateArc(s: Readonly<NetCarState>, dt: number, reverse: boolean, out: PuppetPose, accel = 0): void {
  const speed = Math.sqrt(s.vx * s.vx + s.vz * s.vz);
  // k: distance covered / (speed · dt); kEnd: end speed / speed. The arc keeps its curvature (yaw rate ∝ speed).
  let k = 1;
  let kEnd = 1;
  if (accel !== 0 && speed > 1 && dt > 0) {
    const te = accel < 0 && speed + accel * dt < 0 ? -speed / accel : dt;
    k = (speed * te + 0.5 * accel * te * te) / (speed * dt);
    kEnd = (speed + accel * te) / speed;
  }
  const w = s.yawRate * k;
  const vx = s.vx * k;
  const vz = s.vz * k;
  const a = w * dt;
  let ix: number;
  let iz: number;
  if (Math.abs(a) < 1e-6) {
    ix = vx * dt;
    iz = vz * dt;
  } else {
    const sn = Math.sin(a);
    const cm = 1 - Math.cos(a);
    ix = (vx * sn + vz * cm) / w;
    iz = (vz * sn - vx * cm) / w;
  }
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  out.x = s.x + ix;
  out.z = s.z + iz;
  out.yaw = s.yaw + a;
  out.vx = (s.vx * ca + s.vz * sa) * kEnd;
  out.vz = (s.vz * ca - s.vx * sa) * kEnd;
  out.yawRate = s.yawRate * kEnd;
  out.progress = s.progress + (reverse ? -speed : speed) * dt * k;
}

/** Cubic Hermite between samples a and b at time t (s); h = tb − ta > 0. */
export function hermite(a: Readonly<NetCarState>, b: Readonly<NetCarState>, ta: number, tb: number, t: number, out: PuppetPose): void {
  const h = tb - ta;
  const u = h > 0 ? Math.min(1, Math.max(0, (t - ta) / h)) : 1;
  const u2 = u * u;
  const u3 = u2 * u;
  const h00 = 2 * u3 - 3 * u2 + 1;
  const h10 = u3 - 2 * u2 + u;
  const h01 = -2 * u3 + 3 * u2;
  const h11 = u3 - u2;
  // Derivatives d/du, divided by h for d/dt.
  const d00 = 6 * u2 - 6 * u;
  const d10 = 3 * u2 - 4 * u + 1;
  const d01 = -6 * u2 + 6 * u;
  const d11 = 3 * u2 - 2 * u;
  out.x = h00 * a.x + h10 * h * a.vx + h01 * b.x + h11 * h * b.vx;
  out.z = h00 * a.z + h10 * h * a.vz + h01 * b.z + h11 * h * b.vz;
  out.vx = h > 0 ? (d00 * a.x + d10 * h * a.vx + d01 * b.x + d11 * h * b.vx) / h : b.vx;
  out.vz = h > 0 ? (d00 * a.z + d10 * h * a.vz + d01 * b.z + d11 * h * b.vz) / h : b.vz;
  const yb = a.yaw + wrapPi(b.yaw - a.yaw);
  out.yaw = h00 * a.yaw + h10 * h * a.yawRate + h01 * yb + h11 * h * b.yawRate;
  out.yawRate = a.yawRate + (b.yawRate - a.yawRate) * u;
  out.progress = a.progress + (b.progress - a.progress) * u;
}

export interface PuppetBuffer {
  /**
   * Adds a sample (dropped unless newer than the newest by simMs). `tNow` = the local sim time (s) at which the pose is
   * currently shown; used to blend out (or snap) the correction. Returns false when dropped.
   */
  push(s: Readonly<NetCarState>, tNow: number): boolean;
  /** Pose at sim time t (s), correction offset included. */
  sample(t: number, out: PuppetPose): PuppetStatus;
  /** Newest sample (gear, rpm, flags …), or null. */
  newest(): Readonly<NetCarState> | null;
  /** Sim time (s) of the newest sample (−Infinity when empty). */
  newestT(): number;
  /** True once after a snap (reset flag or error > 15 m). */
  takeSnap(): boolean;
  count(): number;
  clear(): void;
}

export function createPuppetBuffer(): PuppetBuffer {
  const ring: NetCarState[] = Array.from({ length: PUPPET_SAMPLES }, newNetCarState);
  let head = 0; // next write slot
  let n = 0;
  // Correction offset at errT: value and rate per axis (the rate keeps the shown motion C1 across corrections).
  let errX = 0;
  let errZ = 0;
  let errYaw = 0;
  let errVX = 0;
  let errVZ = 0;
  let errVYaw = 0;
  let errT = 0;
  let snap = false;
  const before = newPuppetPose();
  const after = newPuppetPose();
  const horizon = newNetCarState();
  /** Offset value / rate at time t from the stored correction (cubic Hermite decay to 0 with zero end slope). */
  let offV = 0;
  const offset = (p0: number, v0: number, t: number, blend: number): number => {
    const h = t - errT;
    if (!(h < blend)) {
      offV = 0;
      return 0;
    }
    const u = h <= 0 ? 0 : h / blend;
    const m0 = v0 * blend;
    offV = (p0 * (6 * u * u - 6 * u) + m0 * (3 * u * u - 4 * u + 1)) / blend;
    return p0 * (2 * u * u * u - 3 * u * u + 1) + m0 * (u * u * u - 2 * u * u + u);
  };

  /** i-th sample, 0 = oldest. */
  const at = (i: number): NetCarState => ring[(head - n + i + PUPPET_SAMPLES * 2) % PUPPET_SAMPLES]!;

  const raw = (t: number, out: PuppetPose): PuppetStatus => {
    if (n === 0) return 'none';
    const newest = at(n - 1);
    const tn = newest.simMs / 1000;
    if (t >= tn) {
      const dt = t - tn;
      // Path acceleration from the two newest samples (braking / traction zones), when they are close in time.
      let acc = 0;
      if (n > 1) {
        const prev = at(n - 2);
        const h = (newest.simMs - prev.simMs) / 1000;
        if (h > 0 && h <= PUPPET_ACCEL_MAX_GAP_S) {
          acc = clampAbs((Math.sqrt(newest.vx * newest.vx + newest.vz * newest.vz) - Math.sqrt(prev.vx * prev.vx + prev.vz * prev.vz)) / h, PUPPET_ACCEL_MAX);
        }
      }
      const reverse = (newest.flags & NET_FLAG_REVERSE) !== 0;
      extrapolateArc(newest, dt > PUPPET_MAX_EXTRAP_S ? PUPPET_MAX_EXTRAP_S : dt, reverse, out, acc);
      if (dt <= PUPPET_MAX_EXTRAP_S) return 'live';
      // Stale: from the horizon pose, decelerate to a stop on the same arc, then hold.
      const h = horizon;
      h.x = out.x; h.z = out.z; h.yaw = out.yaw; h.vx = out.vx; h.vz = out.vz; h.yawRate = out.yawRate; h.progress = out.progress;
      const extra = dt - PUPPET_MAX_EXTRAP_S;
      extrapolateArc(h, extra > PUPPET_STOP_S ? PUPPET_STOP_S : extra, reverse, out, -Math.sqrt(h.vx * h.vx + h.vz * h.vz) / PUPPET_STOP_S);
      if (extra >= PUPPET_STOP_S) {
        out.vx = 0;
        out.vz = 0;
        out.yawRate = 0;
      }
      return 'stale';
    }
    const oldest = at(0);
    if (t <= oldest.simMs / 1000) {
      extrapolateArc(oldest, 0, false, out);
      return 'live';
    }
    let i = n - 2;
    while (i > 0 && at(i).simMs / 1000 > t) i--;
    const a = at(i);
    const b = at(i + 1);
    hermite(a, b, a.simMs / 1000, b.simMs / 1000, t, out);
    return 'live';
  };

  return {
    push(s, tNow) {
      if (n > 0 && s.simMs <= at(n - 1).simMs) return false;
      const was = n > 0 ? raw(tNow, before) : 'none';
      // Shown motion now: the raw path plus the correction still in progress (a chain of corrections stays continuous). A held
      // (stale) pose does not move, so no rate is carried from it.
      let bvx = 0;
      let bvz = 0;
      let bvy = 0;
      if (was !== 'none') {
        before.x += offset(errX, errVX, tNow, PUPPET_BLEND_POS_S);
        bvx = was === 'live' ? before.vx + offV : 0;
        before.z += offset(errZ, errVZ, tNow, PUPPET_BLEND_POS_S);
        bvz = was === 'live' ? before.vz + offV : 0;
        before.yaw += offset(errYaw, errVYaw, tNow, PUPPET_BLEND_YAW_S);
        bvy = was === 'live' ? before.yawRate + offV : 0;
      }
      const slot = ring[head]!;
      Object.assign(slot, s);
      head = (head + 1) % PUPPET_SAMPLES;
      if (n < PUPPET_SAMPLES) n++;
      errX = errZ = errYaw = errVX = errVZ = errVYaw = 0;
      errT = tNow;
      if (was === 'none') {
        snap = true;
        return true;
      }
      raw(tNow, after);
      const ex = before.x - after.x;
      const ez = before.z - after.z;
      if ((s.flags & NET_FLAG_RESET) !== 0 || ex * ex + ez * ez > PUPPET_SNAP_M * PUPPET_SNAP_M) snap = true;
      else {
        errX = ex;
        errZ = ez;
        errYaw = wrapPi(before.yaw - after.yaw);
        if (was === 'live') {
          errVX = clampAbs(bvx - after.vx, PUPPET_BLEND_V_MAX);
          errVZ = clampAbs(bvz - after.vz, PUPPET_BLEND_V_MAX);
          errVYaw = clampAbs(bvy - after.yawRate, 2);
        }
      }
      return true;
    },
    sample(t, out) {
      const st = raw(t, out);
      if (st === 'none') return st;
      out.x += offset(errX, errVX, t, PUPPET_BLEND_POS_S);
      out.z += offset(errZ, errVZ, t, PUPPET_BLEND_POS_S);
      out.yaw += offset(errYaw, errVYaw, t, PUPPET_BLEND_YAW_S);
      return st;
    },
    newest: () => (n > 0 ? at(n - 1) : null),
    newestT: () => (n > 0 ? at(n - 1).simMs / 1000 : -Infinity),
    takeSnap() {
      const s = snap;
      snap = false;
      return s;
    },
    count: () => n,
    clear() {
      n = 0;
      head = 0;
      errX = errZ = errYaw = errVX = errVZ = errVYaw = 0;
      snap = false;
    },
  };
}

/**
 * Writes a puppet pose into a remote car (design §5.2 field list): pose and velocities, ground (y, normal, hint, d), s / lapWraps
 * from progress, drivetrain values and flags from the newest sample, wheel spin from speed; no suspension or slip.
 */
export function writePuppet(
  car: SimCarState, pose: Readonly<PuppetPose>, latest: Readonly<NetCarState>, p: VehicleParams, q: TrackQuery, gh: GroundHit, dt: number,
): void {
  const v = car.vehicle;
  const L = q.length;
  v.x = pose.x;
  v.z = pose.z;
  v.yaw = pose.yaw;
  v.vx = pose.vx;
  v.vz = pose.vz;
  v.yawRate = pose.yawRate;
  const speed = Math.sqrt(pose.vx * pose.vx + pose.vz * pose.vz);
  const reverse = (latest.flags & NET_FLAG_REVERSE) !== 0;
  v.speed = speed;
  v.vLong = reverse ? -speed : speed;
  v.vLat = 0;
  v.axLong = 0;
  v.ayLat = 0;
  // The sender's progress is the authoritative s: seed the local ±40 m search with it, so a puppet that jumped (first sight,
  // reconnect, reset, back from parking) never locks onto a wrong stretch / level of the track (height and s / d).
  if (v.hint.ribbon === 'main') {
    const sw = pose.progress - Math.floor(pose.progress / L) * L;
    if (sw === sw) v.hint.s = sw;
  }
  q.ground(pose.x, pose.z, v.hint, gh);
  v.y = gh.y;
  v.nx = gh.nx;
  v.ny = gh.ny;
  v.nz = gh.nz;
  v.pitch = 0;
  v.roll = 0;
  v.heave = 0;
  v.d = gh.ribbon === 'main' ? gh.d : v.d;
  const lapWraps = Math.floor(pose.progress / L);
  v.lapWraps = lapWraps;
  v.s = pose.progress - lapWraps * L;
  v.steerAngle = latest.steerAngle;
  v.rpm = latest.rpm;
  v.gear = latest.gear;
  v.drs.flap = latest.drsFlap;
  v.drs.open = (latest.flags & NET_FLAG_DRS_OPEN) !== 0;
  v.compound = latest.compound;
  v.pitLimiterOn = (latest.flags & NET_FLAG_PIT_LIMITER) !== 0;
  v.ers.deployKw = latest.ersDeploying ? PUPPET_ERS_KW : 0;
  v.ers.harvestKw = 0;
  v.sparks = 0;
  car.input.throttle = latest.throttle;
  car.input.brake = latest.brake;
  car.pit.phase = (latest.flags & NET_FLAG_IN_PIT_BOX) !== 0 ? 'stationary' : 'none';
  const omega = v.vLong / p.wheelRadius;
  for (let k = 0; k < 4; k++) {
    const w = v.wheels[k]!;
    w.omega = omega;
    w.spin = (w.spin + omega * dt) % TWO_PI;
    w.susp = 0;
    w.slipRatio = 0;
    w.slipAngle = 0;
    w.locked = false;
  }
}
