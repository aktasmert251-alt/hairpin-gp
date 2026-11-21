// Track limits (rules §3) and corner cutting (rules §4). Sim layer, allocation-free per tick.

import type { SimCarState, SimWorld } from '../contracts/sim';
import type { TrackData, TrackFrame } from '../contracts/track';
import { crx, type CarRaceExtra } from './extra';
import { addPenalty } from './penalties';
import {
  BLACK_WHITE_STRIKE, CUT_GAIN_FACTOR, LIMITS_MARGIN_M, CUT_MARGIN_M, CUT_PROFILE_FACTOR, EXCURSION_MIN_S, PENALTY_S, PIT_ENTRY_EXEMPT, PIT_EXIT_EXEMPT,
  REARM_S, RECOVERY_EXEMPT_S, STRIKE_MIN_KMH, STRIKE_REJOIN_S, TT_LAST_SEGMENT_M,
} from './rules';

/** s ∈ [from, to) on a closed track of length L (handles zones that wrap over the line). */
export function inRange(s: number, from: number, to: number, length: number): boolean {
  const f = ((from % length) + length) % length;
  const t = ((to % length) + length) % length;
  return f <= t ? s >= f && s < t : s >= f || s < t;
}

/** Invalidates the current lap once (rules §3 / §4 / §10). */
export function invalidateLap(world: SimWorld, car: SimCarState, reason: 'trackLimits' | 'cornerCut' | 'flashback' | 'reset' | 'wrongWay'): void {
  if (!car.race.lapValid) return;
  car.race.lapValid = false;
  world.events.push({ type: 'lapInvalidated', car: car.id, reason });
}

/** Rules §3: one counted strike in a race. */
export function addStrike(world: SimWorld, car: SimCarState): void {
  const r = car.race;
  r.trackLimitCount++;
  const n = r.trackLimitCount;
  invalidateLap(world, car, 'trackLimits');
  world.events.push({ type: 'trackLimits', car: car.id, count: n });
  if (n === BLACK_WHITE_STRIKE) world.events.push({ type: 'flag', flag: 'blackWhite', sector: world.static.track.query.sectorAt(car.vehicle.s), car: car.id });
  else if (n > BLACK_WHITE_STRIKE) addPenalty(world, car, PENALTY_S, 'trackLimits');
}

function exemptAt(data: TrackData, s: number, d: number, length: number): boolean {
  const pit = data.pit;
  if (d > 0 && pit.count > 0 && pit.mainSAtSplit >= 0) {
    if (inRange(s, pit.mainSAtSplit + PIT_ENTRY_EXEMPT[0], pit.mainSAtSplit + PIT_ENTRY_EXEMPT[1], length)) return true;
    if (inRange(s, pit.mainSAtMerge + PIT_EXIT_EXEMPT[0], pit.mainSAtMerge + PIT_EXIT_EXEMPT[1], length)) return true;
  }
  const zones = data.cutZones;
  for (let i = 0; i < zones.length; i++) {
    const z = zones[i]!;
    if (inRange(s, z.fromS, z.toS, length)) return true;
  }
  return false;
}

const limFrame = {} as TrackFrame;

/**
 * Per tick for a running car on the main ribbon: excursion detection, strikes (race) or lap invalidation (TT).
 * `dt` in s.
 */
export function stepTrackLimits(world: SimWorld, car: SimCarState, dt: number): void {
  const v = car.vehicle;
  const x = crx(car.race);
  const tt = world.static.config.mode === 'timeTrial';
  const data = world.static.track.data;
  const length = world.static.track.query.length;

  if (v.resetCount !== x.resetSeen) {
    x.resetSeen = v.resetCount;
    x.recoverT = RECOVERY_EXEMPT_S;
    if (tt) invalidateLap(world, car, 'reset');
  }
  if (x.recoverT > 0) x.recoverT -= dt;

  const onPit = v.hint.ribbon === 'pit' || car.pit.phase !== 'none';
  const exempt = onPit || x.recoverT > 0 || exemptAt(data, v.s, v.d, length);
  let out4 = v.offTrackWheels >= 4 && !exempt;
  if (out4) {
    const f = world.static.track.query.frameAt(v.s, limFrame);
    out4 = v.d > f.halfWidthL + LIMITS_MARGIN_M || v.d < -f.halfWidthR - LIMITS_MARGIN_M;
  }

  if (out4) {
    x.exT += dt;
    x.exDist += v.speed * dt;
    if (x.exActive === 0 && x.armed === 1 && x.exT >= EXCURSION_MIN_S) {
      x.exActive = 1;
      if (tt) {
        invalidateLap(world, car, 'trackLimits');
        if (v.s >= length - TT_LAST_SEGMENT_M) x.nextLapInvalid = 1;
      }
    }
    return;
  }
  if (x.exActive === 1) {
    if (!tt) {
      const meanKmh = (x.exDist / Math.max(1e-6, x.exT)) * 3.6;
      if (meanKmh >= STRIKE_MIN_KMH && x.exT <= STRIKE_REJOIN_S) addStrike(world, car);
    }
    x.exActive = 0;
    x.armed = 0;
    x.rearmT = 0;
  }
  x.exT = 0;
  x.exDist = 0;
  if (x.armed === 0) {
    if (v.offTrackWheels <= 2) {
      x.rearmT += dt;
      if (x.rearmT >= REARM_S) x.armed = 1;
    } else x.rearmT = 0;
  }
}

// ---- corner cutting --------------------------------------------------------------------------------------------

let profileCacheKey: object | null = null;
let profileCache = new Float64Array(0);

/** Zone time (ms) along the car's own AI speed profile; cached per world.static (derived data only). */
export function profileZoneMs(world: SimWorld, carId: number, zone: number): number {
  const zones = world.static.track.data.cutZones;
  const n = world.state.cars.length;
  if (profileCacheKey !== world.static || profileCache.length !== n * zones.length) {
    profileCacheKey = world.static;
    profileCache = new Float64Array(n * zones.length).fill(-1);
  }
  const k = carId * zones.length + zone;
  const cached = profileCache[k]!;
  if (cached >= 0) return cached;
  const z = zones[zone]!;
  const length = world.static.track.query.length;
  const prof = world.static.ai.getProfile(carId);
  const line = prof.line;
  let t = 0;
  for (let i = 0; i < line.count; i++) {
    if (inRange(line.s[i]!, z.fromS, z.toS, length)) t += line.ds / Math.max(5, prof.v[i]!);
  }
  const ms = t * 1000;
  profileCache[k] = ms;
  return ms;
}

function cutAtGate(data: TrackData, side: 1 | -1, gateS: number, d: number): boolean {
  const i = Math.min(data.count - 1, Math.max(0, Math.round(gateS / data.ds)));
  return side > 0 ? d > data.halfWidthL[i]! + CUT_MARGIN_M : d < -(data.halfWidthR[i]! + CUT_MARGIN_M);
}

function markerAt(markers: Float32Array, s: number): number {
  const i = Math.min(markers.length - 1, Math.max(0, Math.floor(s / 10)));
  return markers[i]!;
}

/** Called for every line-crossing check of a tick (prevS → prevS + ds). `cross(lineS)` returns the tick fraction or -1. */
export function stepCutZones(world: SimWorld, car: SimCarState, cross: (lineS: number) => number): void {
  const data = world.static.track.data;
  const zones = data.cutZones;
  if (zones.length === 0) return;
  const x: CarRaceExtra = crx(car.race);
  const tt = world.static.config.mode === 'timeTrial';
  const r = car.race;
  for (let zi = 0; zi < zones.length; zi++) {
    const z = zones[zi]!;
    if (cross(z.fromS) > 0) x.zoneCut[zi] = 0;
    const gates = z.gates;
    for (let g = 0; g < gates.length; g++) {
      if (cross(gates[g]!) > 0 && cutAtGate(data, z.side, gates[g]!, car.vehicle.d)) {
        x.zoneCut[zi] = 1;
        invalidateLap(world, car, 'cornerCut');
      }
    }
    if (cross(z.toS) > 0) {
      const t0 = markerAt(r.markerTimes, z.fromS);
      const t1 = markerAt(r.markerTimes, z.toS);
      const zoneMs = t0 >= 0 && t1 >= t0 ? t1 - t0 : -1;
      if (x.zoneCut[zi] === 1) {
        x.zoneCut[zi] = 0;
        if (!tt && zoneMs > 0) {
          const best = x.zoneBest[zi] ?? 0;
          const ref = best > 0 ? best : profileZoneMs(world, car.id, zi) * CUT_PROFILE_FACTOR;
          if (zoneMs < ref * CUT_GAIN_FACTOR) addPenalty(world, car, PENALTY_S, 'cornerCut');
          else addStrike(world, car);
        }
      } else if (zoneMs > 0 && r.lapValid) {
        const best = x.zoneBest[zi] ?? 0;
        if (best <= 0 || zoneMs < best) x.zoneBest[zi] = zoneMs;
      }
    }
  }
}
