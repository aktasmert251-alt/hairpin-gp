// Pit-lane driving for cars in `pitAuto` (pit-weather.md §2). Sim layer, allocation-free per call.
//
// Approach (main ribbon, before the split): the car keeps racing on its line and profile; over the last APPROACH_M it
// blends its lateral target toward the pit-entry side (`mainD`, `blend`, consumed by the AI controller) and caps its
// speed with the pit-lane speed curve. S2-S7: Sprint 1 pursued the fixed split point for the last 300 m, which cut
// across the T12–T14 infield into the wall at d ≈ −19.
// Lane (pit ribbon, pit-local frame per CR-TR-1): pursue (sp + Ld, laneD) with pitWorldFromSD. laneD is the fast lane,
// the working lane in the box phases and 0 on the narrow entry / exit roads (half-width 3.5 m: the ±2.75 m lanes left
// 0.75 m to the wall). Speed: the precomputed pit speed curve (lateral 24 m/s², braking 10 m/s², limiter 79 km/h
// inside the limit zone), then 8 m/s² into the box (box-in starts 30 m out: 79 km/h → 0 needs 8 m/s²). Past the ribbon end the target continues on the main track at
// the merge.

import type { TrackQuery } from '../../contracts/track';
import type { SimCarState } from '../../contracts/sim';
import type { AiContext } from '../context';

export interface PitDriveOut {
  /** true when the pit logic steers this tick (false = racing line, see mainD/blend). */
  active: boolean;
  tx: number;
  tz: number;
  /** Speed cap (m/s); Infinity = none. */
  vT: number;
  limiter: boolean;
  /** Stand still (stationary / release). */
  hold: boolean;
  /** Approach on the main ribbon: lateral target (main-track d) and its weight 0..1 (0 = off). */
  mainD: number;
  blend: number;
}

const LIMIT_MS = 79 / 3.6;
const LAT_A = 24;
const BRAKE_A = 10;
const BOX_A = 8;
/** Approach braking curve to the split (m/s²): gentle, the car is still turning in T13 (QC2-12: 10 m/s² there
 * locked into a rear slide and a long smoke trail). */
const APPROACH_A = 6;
const BOX_HOLD_M = 0.8;
/** Same-lane test for pit traffic (pit-local d, m): the fast and working lanes are 5.5 m apart. */
const LANE_W = 2.6;
/** Working → fast lane over this distance after the box (boxes are 28 m apart: a 25 m ramp clipped the next car). */
const MERGE_M = 15;
/** Lateral blend toward the entry starts this far before the split and is complete APPROACH_FULL_M before it. */
const APPROACH_M = 220;
const APPROACH_FULL_M = 60;
const CROSS_M = 40;
/** Narrow road: lanes fade to the centreline as the half-width drops from 5.3 m to 3.5 m. */
const HW_NARROW = 3.5;
const HW_WIDE = 5.3;

export interface PitGeometry {
  /** Pit speed curve per pit sample (m/s). */
  v: Float32Array;
  ds: number;
  /** Main-track d of the fast lane at the split and of the ribbon end at the merge. */
  entryD: number;
  exitD: number;
}

/** The exit ribbon occupies part of the main road before its end. Keep the racing path on the track side of the
 * blend line, including the car's half width. The approach ramp lets pursuit steer away before the ribbons meet. */
export function pitExitTrackD(q: TrackQuery, g: PitGeometry, s: number, d: number, frame: AiContext['frame']): number {
  const fromMerge = q.deltaS(q.data.pit.mainSAtMerge, s);
  if (fromMerge < -80 || fromMerge > 30) return d;
  const weight = fromMerge < -30 ? (fromMerge + 80) / 50 : fromMerge > 0 ? 1 - fromMerge / 30 : 1;
  q.frameAt(s, frame);
  const side = Math.sign(g.exitD);
  const edge = side > 0 ? frame.halfWidthL : frame.halfWidthR;
  const reserve = q.data.pit.halfWidth[q.data.pit.count - 1]!;
  const bound = edge - 1.3 - reserve * weight;
  return side * d > bound ? side * bound : d;
}

function mainDOf(q: TrackQuery, s: number, x: number, z: number, frame: AiContext['frame']): number {
  q.frameAt(s, frame);
  return (x - frame.px) * frame.lx + (z - frame.pz) * frame.lz;
}

/** Built once per track (AIModule.prepare); null for a track without a pit lane. */
export function buildPitGeometry(q: TrackQuery, frame: AiContext['frame']): PitGeometry | null {
  const pit = q.data.pit;
  if (pit.count < 2 || pit.length <= 0 || pit.mainSAtSplit < 0) return null;
  const n = pit.count;
  const ds = pit.length / (n - 1);
  const v = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = i > 0 ? i - 1 : 0;
    const b = i < n - 1 ? i + 1 : n - 1;
    const cross = pit.tx[a]! * pit.tz[b]! - pit.tz[a]! * pit.tx[b]!;
    const dot = pit.tx[a]! * pit.tx[b]! + pit.tz[a]! * pit.tz[b]!;
    const k = Math.abs(Math.atan2(cross, dot)) / ((b - a) * ds);
    let vc = k > 1e-5 ? Math.sqrt(LAT_A / k) : 100;
    const sp = i * ds;
    if (sp >= pit.limitStartSp && sp <= pit.limitEndSp && vc > LIMIT_MS) vc = LIMIT_MS;
    v[i] = vc;
  }
  for (let i = n - 2; i >= 0; i--) {
    const lim = Math.sqrt(v[i + 1]! * v[i + 1]! + 2 * BRAKE_A * ds);
    if (lim < v[i]!) v[i] = lim;
  }
  const p = { x: 0, y: 0, z: 0 };
  q.pitWorldFromSD(0, pit.fastLaneD, p);
  const entryD = mainDOf(q, pit.mainSAtSplit, p.x, p.z, frame);
  q.pitWorldFromSD(pit.length, 0, p);
  const exitD = mainDOf(q, pit.mainSAtMerge, p.x, p.z, frame);
  return { v, ds, entryD, exitD };
}

function curveAt(g: PitGeometry, sp: number): number {
  const n = g.v.length;
  let i = Math.round(sp / g.ds);
  if (i < 0) i = 0;
  if (i > n - 1) i = n - 1;
  return g.v[i]!;
}

export function pitDrive(ctx: AiContext, cars: readonly SimCarState[], car: SimCarState, lookAhead: number, out: PitDriveOut): void {
  const q = ctx.track!;
  const pit = q.data.pit;
  const g = ctx.pit;
  out.active = false;
  out.hold = false;
  out.limiter = false;
  out.vT = Infinity;
  out.blend = 0;
  if (!g) return;
  const ph = car.pit.phase;
  if (ph === 'none') return;
  const v = car.vehicle;
  const onPit = v.hint.ribbon === 'pit' && v.hint.sp === v.hint.sp;

  // The entry narrows to one lane. Account for cars across the main/pit query boundary before pursuing the ribbon;
  // main-track racecraft ignores pit cars and otherwise lets the following car arrive with no braking gap.
  let entryCap = Infinity;
  const toSplit = q.deltaS(v.s, pit.mainSAtSplit);
  const entrySp = onPit ? v.hint.sp : -toSplit;
  if (entrySp > -150 && entrySp < 100) {
    for (let j = 0; j < cars.length; j++) {
      const o = cars[j]!;
      if (o === car || (o.pit.phase !== 'requested' && o.pit.phase !== 'entry')) continue;
      const ov = o.vehicle;
      const otherSp = ov.hint.ribbon === 'pit' ? ov.hint.sp : -q.deltaS(ov.s, pit.mainSAtSplit);
      const gap = otherSp - entrySp;
      if (gap > 0 && gap < 80) entryCap = Math.min(entryCap, Math.max(0, ov.speed + 0.6 * (gap - 10 - v.speed)));
    }
  }

  if (!onPit) {
    // Approach: racing line + lateral blend + speed cap toward the split (requested / entry before the ribbon).
    if (ph !== 'requested' && ph !== 'entry') return;
    const toSplit = q.deltaS(v.s, pit.mainSAtSplit);
    // Up to CROSS_M past the split the car is still crossing the edge onto the ribbon (the ground query claims the
    // ribbon only beyond the main track's edge).
    if (toSplit < -CROSS_M || toSplit > APPROACH_M + lookAhead) return;
    const t = (APPROACH_M - toSplit) / (APPROACH_M - APPROACH_FULL_M);
    out.blend = t < 0 ? 0 : t > 1 ? 1 : t;
    out.mainD = g.entryD;
    const v0 = curveAt(g, 0);
    out.vT = Math.min(entryCap, Math.sqrt(Math.max(0, v0 * v0 + 2 * APPROACH_A * toSplit)));
    // Within the look-ahead of the split, pursue the ribbon itself.
    if (toSplit < lookAhead) {
      if (toSplit < 0) out.vT = Math.min(v0, entryCap);
      q.pitWorldFromSD(lookAhead - toSplit, 0, ctx.p0);
      // Past the split on the wrong side, the ribbon point can lie abeam or behind: steering at it turned the car
      // round on the main track (full lock, İstanbul d70 seed 4321, then wedged at the lane wall). Missed: carry on.
      const dx = ctx.p0.x - v.x;
      const dz = ctx.p0.z - v.z;
      if (toSplit < 0 && dx * Math.cos(v.yaw) - dz * Math.sin(v.yaw) < 0.5 * Math.sqrt(dx * dx + dz * dz)) {
        out.blend = 0;
        out.vT = Infinity;
        return;
      }
      out.tx = ctx.p0.x;
      out.tz = ctx.p0.z;
      out.active = true;
    }
    return;
  }

  const sp = v.hint.sp;
  const box = car.pit.boxSp;
  let laneD = pit.fastLaneD;
  if (ph === 'boxIn' || ph === 'stationary' || ph === 'release') laneD = pit.workingLaneD;
  if (ph === 'boxOut') {
    // Release already reserved the gap. Aim along the departure path at the target's sp, rather than lagging one
    // look-ahead behind it and driving into the next team's box. Never yield halfway across the reserved corridor.
    const t = (sp + lookAhead - box) / MERGE_M;
    laneD = pit.workingLaneD + (pit.fastLaneD - pit.workingLaneD) * (t < 0 ? 0 : t > 1 ? 1 : t);
  }
  const spT = sp + lookAhead;
  // Beyond the garages there is one exit road. Continuing the offset fast lane through a tight exit bend cuts
  // its inside edge (Ardennes sp 734: centre d 4.67 m on a 5.25 m half-width, with another 1.15 m of car body).
  const lastBox = pit.boxes.length > 0 ? pit.boxes[pit.boxes.length - 1]!.sp : pit.limitEndSp;
  if (ph === 'exit') {
    const t = Math.max(0, Math.min(1, (spT - lastBox - 30) / 20));
    laneD *= 1 - t;
  }
  if (spT > pit.length) {
    // Past the ribbon end: aim along the main track from the merge.
    q.worldFromSD(pit.mainSAtMerge + (spT - pit.length), g.exitD, ctx.p0);
  } else {
    const hw = pit.halfWidth[Math.min(pit.count - 1, Math.max(0, Math.round(spT / g.ds)))]!;
    const w = (hw - HW_NARROW) / (HW_WIDE - HW_NARROW);
    q.pitWorldFromSD(spT, laneD * (w < 0 ? 0 : w > 1 ? 1 : w), ctx.p0);
  }
  out.tx = ctx.p0.x;
  out.tz = ctx.p0.z;
  out.active = true;

  let vT = Math.min(curveAt(g, sp), entryCap);
  const vA = curveAt(g, sp + 0.15 * v.speed);
  if (vA < vT) vT = vA;
  out.limiter = sp < pit.limitEndSp && pit.limitStartSp - sp < 20;
  if (ph === 'boxIn') {
    const toBox = box - sp;
    const vb = Math.sqrt(2 * BOX_A * (toBox > 0 ? toBox : 0));
    if (vb < vT) vT = vb;
    // Last metre: full brake (the speed PI does not brake on a 1–5 km/h error, so the car crept past the box).
    if (toBox < BOX_HOLD_M) out.hold = true;
    // Behind the stopping curve (the speed PI only brakes from 1.5 m/s over its target): full brake rather than slide
    // past the box tolerance (20-car stop, İstanbul seed 5: stopped 1.5 m past the box behind a car leaving it, the
    // queued car behind waited for ever).
    else if (v.speed * v.speed > 2 * 1.2 * BOX_A * toBox) out.hold = true;
  }
  if (ph === 'exit' && sp > pit.length - 100) {
    // Queue before the end of the blend line while main-track traffic reaches the merge. The main ribbon keeps
    // its corridor; an exiting car waits here rather than stopping halfway onto it. Ignore traffic stopped behind
    // the merge so the two queues cannot wait for each other indefinitely.
    let yieldMerge = false;
    for (let j = 0; j < cars.length; j++) {
      const o = cars[j]!;
      if (o === car || o.vehicle.hint.ribbon !== 'main') continue;
      const ds = q.deltaS(pit.mainSAtMerge, o.vehicle.s);
      if ((ds >= -8 && ds < 12) || (ds < 0 && o.vehicle.speed > 1 && -ds / o.vehicle.speed < 2.5)) {
        yieldMerge = true;
        break;
      }
    }
    if (yieldMerge) {
      const toHold = pit.length - 12 - sp;
      vT = Math.min(vT, Math.sqrt(2 * BRAKE_A * Math.max(0, toHold)));
      if (toHold < BOX_HOLD_M) out.hold = true;
      else if (v.speed * v.speed > 2 * 1.2 * BRAKE_A * toHold) out.hold = true;
    }
  }
  // Lane traffic: follow a car ahead on the ribbon in the same lane, with an 8 m + 0.6 s gap.
  for (let j = 0; j < cars.length; j++) {
    const o = cars[j]!;
    if (o === car) continue;
    const ov = o.vehicle;
    if (ov.hint.ribbon !== 'pit') continue;
    const dsp = ov.hint.sp - sp;
    if (dsp <= 0 || dsp > 45) continue;
    const dd = ov.d - v.d;
    const targetDD = ov.d - laneD;
    // A parked working-lane car beyond the departure ramp is clear of our path. Following its current d while
    // moving diagonally away stops the departure halfway through the merge and strands it beside the next box.
    if (ph === 'boxOut' && dsp > 7 && Math.abs(targetDD) > LANE_W &&
      (o.pit.phase === 'boxIn' || o.pit.phase === 'stationary' || o.pit.phase === 'release')) continue;
    // Include a car entering our path before its body crosses the lane boundary. Departures own their reserved
    // gap; approaching traffic follows them instead of passing on the other side of a narrowing exit.
    const joining = o.pit.phase === 'boxOut' && ph !== 'boxIn';
    if (Math.abs(dd) > LANE_W && Math.abs(targetDD) > LANE_W && !joining) continue;
    const cap = ov.speed + 0.6 * (dsp - 8 - 0.6 * v.speed);
    if (cap < vT) vT = cap > 0 ? cap : 0;
  }
  if (ph === 'stationary' || ph === 'release') {
    out.hold = true;
    vT = 0;
  }
  // Stopped behind traffic or in the queue slot: hold on the brake instead of creeping into the car ahead.
  if (vT < 0.5 && v.speed < 1) out.hold = true;
  out.vT = vT;
}
