// PitProcedure (pit-weather §2, rules §5/§7/§8; sim layer, 240 Hz, run by the RaceDirector for every running car in a
// race). Phases none → requested → entry → limiter → boxIn → stationary → release → boxOut → exit → none. Driving in the
// lane is Sürüş's pitAuto (src/ai/pit/pitDriver.ts); this file decides phases, control hand-over, queueing, service,
// penalties and the tyre change. Allocation-free per tick.

import type { Compound } from '../contracts/common';
import type { PitPhase } from '../contracts/race';
import type { SimCarState, SimWorld } from '../contracts/sim';
import { nextRandom } from '../core/rng';
import { TEAMS } from '../data/teams';
import { crx } from './extra';
import { addPenalty } from './penalties';
import { PENALTY_S, PIT_SPEEDING_KMH, PIT_SPEEDING_S } from './rules';
import { compoundBit } from './state';

/** pitAuto takes over this far before the split (§1 pitAutoS), requests can be cancelled until pitCommitS. */
export const PIT_AUTO_BEFORE_SPLIT_M = 300;
export const PIT_COMMIT_BEFORE_SPLIT_M = 150;
/** Past the split by this much without entering the lane the entry is missed; a withdrawn request is honoured again (UIT-09). */
export const PIT_MISSED_SPLIT_M = 30;
/** boxIn starts 30 m before the box; boxOut ends 30 m after it; queue slot 9 m before it (§2.3). */
export const BOX_IN_M = 30;
export const BOX_OUT_M = 30;
export const QUEUE_M = 9;
export const BOX_STOP_TOL_M = 1.5;
export const STOP_SPEED = 0.5;
/** Safe release: reserve enough time to reach the fast lane from rest. */
export const RELEASE_BEHIND_M = 25;
export const RELEASE_AHEAD_M = 8;
export const RELEASE_GAP_S = 2;
/** §2.2 service time. */
export const SERVICE_BASE_S = 2.1;
export const SERVICE_SPREAD_S = 0.6;
export const SERVICE_PERF_S = 0.1;
export const SLOW_STOP_P = 0.05;
export const MEAN_SERVICE_S = 2.5;

const IN_BOX: readonly PitPhase[] = ['boxIn', 'stationary', 'release'];

function setPhase(world: SimWorld, car: SimCarState, phase: PitPhase): void {
  car.pit.phase = phase;
  car.pit.timer = 0;
  world.events.push({ type: 'pit', car: car.id, phase });
}

function takeControl(car: SimCarState): void {
  const x = crx(car.race);
  if (x.pitCtrl !== 0 || car.control === 'pitAuto') return;
  x.pitCtrl = car.control === 'ai' ? 2 : 1;
  car.control = 'pitAuto';
}

function giveBackControl(car: SimCarState): void {
  const x = crx(car.race);
  if (x.pitCtrl === 0) return;
  car.control = x.pitCtrl === 2 ? 'ai' : 'player';
  x.pitCtrl = 0;
}

/** The car is driven by the AI outside the pit (AI field car or the player under autodrive). */
function aiDriven(car: SimCarState): boolean {
  const x = crx(car.race);
  return x.pitCtrl !== 0 ? x.pitCtrl === 2 : car.control === 'ai';
}

function wantsBox(car: SimCarState): boolean {
  const plan = car.ai.plannedStopLaps;
  const planned = plan.length > 0 && plan[0] === car.race.lapsCompleted + 1;
  return car.isPlayer && !aiDriven(car) ? car.controls.boxRequest : planned || (car.isPlayer && car.controls.boxRequest);
}

function chosenCompound(car: SimCarState): Compound {
  // TS2-01: an MFD box request wins under autodrive too, so the player's compound choice is fitted.
  return car.isPlayer && (!aiDriven(car) || car.controls.boxRequest) ? car.controls.nextCompound : car.ai.nextCompound;
}

function boxSpOf(world: SimWorld, car: SimCarState): number {
  const boxes = world.static.track.data.pit.boxes;
  for (let i = 0; i < boxes.length; i++) if (boxes[i]!.teamId === car.teamId) return boxes[i]!.sp;
  return boxes.length > 0 ? boxes[car.id % boxes.length]!.sp : world.static.track.data.pit.length / 2;
}

/** Real box of the car (car.pit.boxSp may point at the queue slot). */
function realBox(world: SimWorld, car: SimCarState): number {
  return boxSpOf(world, car);
}

function boxOccupied(world: SimWorld, car: SimCarState, box: number): boolean {
  const cars = world.state.cars;
  for (let i = 0; i < cars.length; i++) {
    const o = cars[i]!;
    if (o === car || o.teamId !== car.teamId) continue;
    const ph = o.pit.phase;
    if (ph === 'stationary' || ph === 'release' || (ph === 'boxOut' && o.vehicle.hint.sp < box + QUEUE_M)) return true;
    // A teammate already braking into the box ahead of us.
    if (ph === 'boxIn' && o.vehicle.hint.ribbon === 'pit' && o.vehicle.hint.sp > car.vehicle.hint.sp && o.pit.boxSp === box) return true;
  }
  return false;
}

function laneClear(world: SimWorld, car: SimCarState, box: number): boolean {
  const cars = world.state.cars;
  for (let i = 0; i < cars.length; i++) {
    const o = cars[i]!;
    if (o === car || o.vehicle.hint.ribbon !== 'pit') continue;
    const sp = o.vehicle.hint.sp;
    // A departure reserves the diagonal corridor, even before it reaches the fast lane. A queued teammate behind
    // the box is in the working lane and must not prevent the car it is waiting for from leaving.
    const fast = Math.abs(o.vehicle.d - world.static.track.data.pit.fastLaneD) < 2.6;
    if (fast && sp >= box - Math.max(RELEASE_BEHIND_M, o.vehicle.speed * RELEASE_GAP_S) && sp <= box + RELEASE_AHEAD_M) return false;
    if (o.pit.phase === 'boxOut' && Math.abs(sp - box) < 20) return false;
    if (sp > box && sp < box + 12) return false;
  }
  return true;
}

/** §2.2 service time from the race RNG. */
export function drawServiceS(world: SimWorld, teamPerf: number): number {
  const rng = world.state.rng;
  let s = SERVICE_BASE_S + SERVICE_SPREAD_S * nextRandom(rng, 'race') - SERVICE_PERF_S * (teamPerf / 0.015);
  if (nextRandom(rng, 'race') < SLOW_STOP_P) s += 1 + 3 * nextRandom(rng, 'race');
  return s;
}

function fitTyres(world: SimWorld, car: SimCarState): void {
  const v = car.vehicle;
  const c = car.pit.nextCompound;
  const blanket = world.static.params[car.id]!.compounds[c].blanketC;
  v.compound = c;
  v.tyreAgeLaps = 0;
  for (let k = 0; k < 4; k++) {
    const t = v.tyres[k]!;
    t.wear = 0;
    t.surfC = blanket;
    t.coreC = blanket;
    t.gripMul = 1;
  }
  car.race.compoundsUsedMask |= compoundBit(c);
}

function teamPerfOf(car: SimCarState): number {
  for (let i = 0; i < TEAMS.length; i++) if (TEAMS[i]!.id === car.teamId) return TEAMS[i]!.perf;
  return 0;
}

/** Per tick for a running race car (`dt` s). */
export function stepPit(world: SimWorld, car: SimCarState, dt: number): void {
  const data = world.static.track.data;
  const pitLane = data.pit;
  if (pitLane.count < 2 || pitLane.mainSAtSplit < 0) return;
  const q = world.static.track.query;
  const st = world.state;
  const v = car.vehicle;
  const p = car.pit;
  const x = crx(car.race);
  const onPit = v.hint.ribbon === 'pit' && v.hint.sp === v.hint.sp;
  const sp = onPit ? v.hint.sp : -1;
  if (v.resetCount !== x.pitResetSeen) {
    x.pitResetSeen = v.resetCount;
    if (p.phase !== 'none') {
      giveBackControl(car);
      p.requested = false;
      p.speeding = false;
      x.pitRelT = 0;
      x.pitHoldS = 0;
      x.speedT = 0;
      x.pitVisitPen = 0;
      setPhase(world, car, 'none');
      return;
    }
  }
  p.timer += dt;
  if (p.phase !== 'stationary') p.nextCompound = chosenCompound(car);

  // Speeding (rules §7): once per visit, inside the limit zone.
  if (onPit && sp >= pitLane.limitStartSp && sp <= pitLane.limitEndSp && !IN_BOX.includes(p.phase)) {
    if (v.speed * 3.6 > PIT_SPEEDING_KMH) {
      x.speedT += dt;
      if (x.speedT >= PIT_SPEEDING_S && !p.speeding) {
        p.speeding = true;
        addPenalty(world, car, PENALTY_S, 'pitSpeeding');
        x.pitVisitPen += PENALTY_S;
      }
    } else x.speedT = 0;
  }

  // An aborted visit returns control after 1 s off the ribbon. Do not continue service or release on the main road.
  // Explicit resets above clear immediately; pitRelT doubles as the off-lane timer for other departures.
  if ((p.phase === 'entry' || p.phase === 'limiter' || p.phase === 'boxIn' || p.phase === 'stationary' || p.phase === 'release' || p.phase === 'boxOut') && !onPit) {
    x.pitRelT += dt;
    if (x.pitRelT >= 1) {
      x.pitRelT = 0;
      giveBackControl(car);
      p.requested = wantsBox(car);
      setPhase(world, car, p.requested ? 'requested' : 'none');
    }
    return;
  } else if (p.phase !== 'release') x.pitRelT = 0;

  switch (p.phase) {
    case 'none':
      if (onPit) {
        if (aiDriven(car) || world.static.config.assists.pit) takeControl(car);
        // Entered unrequested: stop with the chosen (suggested) compound.
        p.requested = false;
        p.boxSp = boxSpOf(world, car);
        setPhase(world, car, 'entry');
      } else if (st.race.phase === 'running' && wantsBox(car)) {
        p.requested = true;
        p.boxSp = boxSpOf(world, car);
        setPhase(world, car, 'requested');
      }
      break;
    case 'requested': {
      const toSplit = q.deltaS(v.s, pitLane.mainSAtSplit);
      if (onPit) {
        if (aiDriven(car) || world.static.config.assists.pit) takeControl(car);
        setPhase(world, car, 'entry');
        break;
      }
      if (!wantsBox(car) && (toSplit > PIT_COMMIT_BEFORE_SPLIT_M || toSplit < -PIT_MISSED_SPLIT_M)) {
        p.requested = false;
        giveBackControl(car);
        setPhase(world, car, 'none');
        break;
      }
      const autoOn = aiDriven(car) || world.static.config.assists.pit;
      if (autoOn && toSplit > 0 && toSplit <= PIT_AUTO_BEFORE_SPLIT_M) takeControl(car);
      // Missed the entry (passed the split on the main ribbon): try again next lap.
      // Hand back only once the car is clearly past the split (it is still crossing the main edge onto the lane before that).
      if (toSplit < -PIT_MISSED_SPLIT_M && toSplit > -200) giveBackControl(car);
      break;
    }
    case 'entry':
      if (onPit && (aiDriven(car) || world.static.config.assists.pit)) takeControl(car);
      if (sp >= pitLane.limitStartSp) setPhase(world, car, 'limiter');
      break;
    case 'limiter':
      if (sp >= realBox(world, car) - BOX_IN_M) {
        takeControl(car);
        setPhase(world, car, 'boxIn');
      }
      break;
    case 'boxIn': {
      const box = realBox(world, car);
      p.boxSp = boxOccupied(world, car, box) ? box - QUEUE_M : box;
      if (p.boxSp === box && v.speed < STOP_SPEED && Math.abs(sp - box) <= BOX_STOP_TOL_M) {
        setPhase(world, car, 'stationary');
        // Penalties incurred before this visit are served now (rules §5); this visit's ones at the next stop.
        x.pitHoldS = Math.max(0, car.race.penaltyToServeSec - x.pitVisitPen);
        p.serviceS = drawServiceS(world, teamPerfOf(car));
        p.timer = -x.pitHoldS;
      }
      break;
    }
    case 'stationary':
      if (x.pitHoldS > 0 && p.timer >= 0) {
        car.race.penaltyToServeSec = Math.max(0, car.race.penaltyToServeSec - x.pitHoldS);
        world.events.push({ type: 'penaltyServed', car: car.id, seconds: x.pitHoldS });
        x.pitHoldS = 0;
      }
      if (p.timer >= p.serviceS) {
        fitTyres(world, car);
        x.pitRelT = 0;
        setPhase(world, car, 'release');
      }
      break;
    case 'release':
      x.pitRelT += dt;
      if (laneClear(world, car, realBox(world, car))) setPhase(world, car, 'boxOut');
      break;
    case 'boxOut':
      if (sp > realBox(world, car) + BOX_OUT_M) {
        // Player without pit assist drives the rest of the lane (limiter is the driver's job).
        if (!aiDriven(car) && !world.static.config.assists.pit) giveBackControl(car);
        setPhase(world, car, 'exit');
      }
      break;
    case 'exit':
      if (!onPit) {
        giveBackControl(car);
        p.requested = false;
        p.speeding = false;
        x.speedT = 0;
        x.pitVisitPen = 0;
        car.race.pitStops++;
        setPhase(world, car, 'none');
      }
      break;
  }
}

/** Time to cover `d` m starting at `v0`, accelerating at `a` up to `vMax` (m/s, s). */
function rampTime(d: number, v0: number, vMax: number, a: number): number {
  const dRamp = (vMax * vMax - v0 * v0) / (2 * a);
  if (d <= dRamp) return (Math.sqrt(v0 * v0 + 2 * a * d) - v0) / a;
  return (vMax - v0) / a + (d - dRamp) / vMax;
}

const LANE_MS = 150 / 3.6;
const LIMIT_MS = 79 / 3.6;
/** Lane kinematics assumed by the estimate: braking into the limit 10 m/s², out of it 8 m/s², box 4 / 8 m/s². */
const ENTRY_DECEL = 10;
const EXIT_ACCEL = 8;
const BOX_DECEL = 4;
const BOX_ACCEL = 8;

/**
 * Pit loss estimate (§2.1) for `mfd.pitLossS`: lane time (entry braking to the limit, limit zone at 79 km/h with the
 * box stop, exit acceleration) + mean service, minus the car's own speed-profile time over split → merge.
 */
export function pitLossEstimateS(world: SimWorld, carId: number): number {
  const pitLane = world.static.track.data.pit;
  if (pitLane.count < 2 || pitLane.mainSAtSplit < 0) return 0;
  const limitLen = pitLane.limitEndSp - pitLane.limitStartSp;
  const lane = rampTime(pitLane.limitStartSp, LIMIT_MS, LANE_MS, ENTRY_DECEL)
    + limitLen / LIMIT_MS + LIMIT_MS / (2 * BOX_DECEL) + LIMIT_MS / (2 * BOX_ACCEL)
    + rampTime(pitLane.length - pitLane.limitEndSp, LIMIT_MS, LANE_MS, EXIT_ACCEL) + MEAN_SERVICE_S;
  const q = world.static.track.query;
  const prof = world.static.ai.getProfile(carId);
  const d0 = q.deltaS(pitLane.mainSAtSplit, pitLane.mainSAtMerge);
  const span = d0 > 0 ? d0 : d0 + q.length;
  const line = prof.line;
  let main = 0;
  for (let i = 0; i < line.count; i++) {
    let d = line.s[i]! - pitLane.mainSAtSplit;
    if (d < 0) d += q.length;
    if (d < span) main += line.ds / Math.max(5, prof.v[i]!);
  }
  return lane - main;
}
