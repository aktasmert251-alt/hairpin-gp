// D-056 safety car (sim layer, allocation-free). Owned by the RaceDirector (stepSafetyCar, called every running tick) plus the
// RaceControlSystem (createRaceControlSystem, between the AI and the vehicle systems) that makes AI-driven cars obey.
//
// Deploy: a yellow cause (stopped / crashed car near the track, flags.ts slowT) still there SC_DELAY_S after its yellow, while the
//   leader has at least one more lap to start. The SC car appears SC_START_AHEAD_M ahead of the leader and drives the AI racing
//   line at SC_LINE_FACTOR × the line speed (≤ SC_SPEED_MAX).
// Queue: every racing car gets `race.scTargetSpeed`: catch up at SC_CATCHUP_MS, then keep SC_QUEUE_GAP_M to the car (or SC) right
//   ahead on track (lapped-car rules skipped: the physical car ahead counts). Overtaking under the SC = +5 s ('safetyCar').
// End: after SC_MIN_LAPS leader laps with the track clear (retired cars are cleared by marshals after SC_CLEAR_RETIRED_S) the SC
//   comes in ('ending'): it leaves the track SC_PIT_IN_M before the line, the leader keeps the SC pace, and the race restarts
//   (phase 'none', green flag) when the leader crosses the line.

import type { SimCarState, SimSystem, SimWorld } from '../contracts/sim';
import { crx, rrx } from './extra';
import { addPenalty } from './penalties';
import {
  PARK_X, SC_ACCEL, SC_CATCHUP_MS, SC_CLEAR_RETIRED_S, SC_DELAY_S, SC_GAP_GAIN, SC_LINE_FACTOR, SC_MAX_LAPS, SC_MIN_LAPS, SC_OVERTAKE_COOLDOWN_S,
  SC_DEPLOY_OVERLAP_M, SC_DEPLOY_PASS_MS, SC_OVERTAKE_MIN_MS, SC_PIT_IN_M, SC_QUEUE_GAP_M, SC_QUEUE_MIN_MS, SC_SPEED_MAX, SC_START_AHEAD_M, YELLOW_SLOW_S,
} from './rules';

export function safetyCarEnabled(world: SimWorld): boolean {
  const cfg = world.static.config;
  return cfg.mode === 'race' && cfg.safetyCar !== false && cfg.rules !== 'kasap'; // D-061: no SC in Kasap
}

/** SC target speed at track position s: a share of the AI racing-line profile (car 0's profile), capped. */
function scSpeedAt(world: SimWorld, s: number): number {
  const prof = world.static.ai.getProfile(0);
  const line = prof.line;
  const n = line.count;
  if (!(n > 0) || !(line.ds > 0)) return SC_SPEED_MAX;
  let i = Math.floor(s / line.ds) % n;
  if (i < 0) i += n;
  const v = prof.v[i]! * SC_LINE_FACTOR;
  return v > SC_SPEED_MAX ? SC_SPEED_MAX : v > 10 ? v : 10;
}

/** A car that blocks the track for the SC rule: a yellow cause for SC_DELAY_S beyond its yellow, not cleared. */
function blockingCar(world: SimWorld): number {
  const cars = world.state.cars;
  for (let i = 0; i < cars.length; i++) {
    const x = crx(cars[i]!.race);
    if (x.scCleared === 0 && x.slowT >= YELLOW_SLOW_S + SC_DELAY_S) return i;
  }
  return -1;
}

/** True when no stopped / crashed car (yellow cause) is on track. */
function trackClear(world: SimWorld): boolean {
  const cars = world.state.cars;
  for (let i = 0; i < cars.length; i++) {
    const x = crx(cars[i]!.race);
    if (x.scCleared === 0 && x.slowT >= YELLOW_SLOW_S) return false;
  }
  return true;
}

function leaderOf(world: SimWorld): number {
  return world.state.race.order[0] ?? 0;
}

/** Per running tick (after the cars moved and the standings of this tick). */
export function stepSafetyCar(world: SimWorld, dt: number): void {
  const st = world.state;
  const race = st.race;
  const sc = race.sc;
  const cars = st.cars;
  const cfg = world.static.config;
  const L = world.static.track.query.length;
  const rx = rrx(race);
  const leader = cars[leaderOf(world)]!;
  const leaderLaps = leader.race.lapsCompleted;
  const crossed = leaderLaps > rx.scLeaderLaps;
  rx.scLeaderLaps = leaderLaps;
  for (let i = 0; i < cars.length; i++) {
    const x = crx(cars[i]!.race);
    if (x.scPenT > 0) x.scPenT = x.scPenT > dt ? x.scPenT - dt : 0;
  }

  if (sc.phase === 'none') {
    for (let i = 0; i < cars.length; i++) cars[i]!.race.scTargetSpeed = -1;
    if (race.phase !== 'running' || !safetyCarEnabled(world)) return;
    // No new SC once the leader is on the last lap.
    if (leaderLaps >= cfg.laps - 1) return;
    if (blockingCar(world) < 0) return;
    sc.phase = 'deployed';
    sc.sinceMs = race.raceMs;
    sc.laps = 0;
    sc.count++;
    sc.onTrack = true;
    sc.progress = leader.race.progress + SC_START_AHEAD_M;
    sc.speed = scSpeedAt(world, sc.progress - Math.floor(sc.progress / L) * L);
    for (let i = 0; i < cars.length; i++) crx(cars[i]!.race).scDeployProg = cars[i]!.race.progress;
    world.events.push({ type: 'safetyCar', phase: 'deployed' });
  } else if (race.phase !== 'running') {
    // Chequered flag (or a glue-set finish): the SC period ends with the race.
    endSafetyCar(world);
    return;
  }

  if (crossed) sc.laps++;
  if (sc.phase === 'deployed' && sc.laps >= SC_MIN_LAPS && trackClear(world)) {
    sc.phase = 'ending';
    world.events.push({ type: 'safetyCar', phase: 'ending' });
  } else if (sc.phase === 'deployed' && sc.laps >= SC_MAX_LAPS && trackClear(world)) {
    sc.phase = 'ending';
    world.events.push({ type: 'safetyCar', phase: 'ending' });
  }

  // The SC car.
  if (sc.onTrack) {
    const s = sc.progress - Math.floor(sc.progress / L) * L;
    const target = scSpeedAt(world, s);
    const dv = target - sc.speed;
    const maxDv = SC_ACCEL * dt;
    sc.speed += dv > maxDv ? maxDv : dv < -maxDv ? -maxDv : dv;
    sc.progress += sc.speed * dt;
    const s2 = sc.progress - Math.floor(sc.progress / L) * L;
    if (sc.phase === 'ending' && s2 >= L - SC_PIT_IN_M) sc.onTrack = false;
  } else if (sc.phase === 'ending' && crossed) {
    // Restart: the leader crossed the line after the SC came in.
    endSafetyCar(world);
    return;
  }

  // Queue speeds.
  const q = world.static.track.query;
  for (let i = 0; i < cars.length; i++) {
    const car = cars[i]!;
    const r = car.race;
    if (r.status !== 'running' || r.finished || car.vehicle.hint.ribbon === 'pit' || car.pit.phase !== 'none') {
      r.scTargetSpeed = -1;
      continue;
    }
    const v = car.vehicle;
    let gap = Infinity;
    let aheadSpeed = sc.speed;
    if (sc.onTrack) {
      const g = sc.progress - r.progress;
      if (g > 0 && g < L) {
        gap = g;
        aheadSpeed = sc.speed;
      }
    }
    for (let j = 0; j < cars.length; j++) {
      if (j === i) continue;
      const o = cars[j]!;
      if (o.race.status !== 'running' || o.race.finished || o.vehicle.hint.ribbon === 'pit' || o.pit.phase !== 'none') continue;
      // Stopped / crashed cars are passed, not queued behind (else the queue deadlocks behind them).
      if (o.vehicle.speed < SC_QUEUE_MIN_MS || crx(o.race).slowT > 0) continue;
      let g = q.deltaS(v.s, o.vehicle.s);
      if (g <= 0) g += L;
      if (g < gap) {
        gap = g;
        aheadSpeed = o.vehicle.speed;
      }
    }
    let target = gap === Infinity ? sc.speed : aheadSpeed + (gap - SC_QUEUE_GAP_M) * SC_GAP_GAIN;
    if (target > SC_CATCHUP_MS) target = SC_CATCHUP_MS;
    if (target < 0) target = 0;
    // After the SC came in, the leader keeps the SC pace to the line.
    if (!sc.onTrack && i === leaderOf(world) && target > sc.speed) target = sc.speed;
    r.scTargetSpeed = target;
  }
}

function endSafetyCar(world: SimWorld): void {
  const race = world.state.race;
  const sc = race.sc;
  sc.phase = 'none';
  sc.onTrack = false;
  for (const c of world.state.cars) c.race.scTargetSpeed = -1;
  world.events.push({ type: 'safetyCar', phase: 'none' });
  world.events.push({ type: 'flag', flag: 'green', sector: -1, car: -1 });
}

/**
 * Called by the director's standings update when `carId` gained a position while the SC is out. Penalises a pass of a car
 * that was still racing on track (not one that pitted, crashed or retired).
 */
export function noteScPass(world: SimWorld, carId: number, passedId: number): void {
  const cars = world.state.cars;
  const car = cars[carId];
  const passed = cars[passedId];
  if (!car || !passed || car.control === 'remote') return;
  const x = crx(car.race);
  if (x.scPenT > 0 || car.race.status !== 'running' || car.vehicle.hint.ribbon !== 'main' || car.pit.phase !== 'none') return;
  const p = passed.race;
  if (p.status !== 'running' || p.finished || passed.vehicle.hint.ribbon !== 'main' || passed.pit.phase !== 'none') return;
  if (passed.vehicle.speed < SC_OVERTAKE_MIN_MS) return;
  // A pass completed just after the deployment by a car that was already alongside then is not an SC overtake.
  const sc = world.state.race.sc;
  const gap = x.scDeployProg - crx(p).scDeployProg;
  if (world.state.race.raceMs - sc.sinceMs <= SC_DEPLOY_PASS_MS && x.scDeployProg > -1e8 && Math.abs(gap) < SC_DEPLOY_OVERLAP_M) return;
  x.scPenT = SC_OVERTAKE_COOLDOWN_S;
  addPenalty(world, car, 5, 'safetyCar');
}

/**
 * Marshals' parking: the car is moved off the map (far from every car, wall and line; s and progress kept) and is no yellow /
 * safety-car cause. Also used online for remote cars that are not on track (absent, retired, stale; user bug 2026-10-26).
 */
export function parkOffTrack(car: SimCarState): void {
  const v = car.vehicle;
  v.x = PARK_X + car.id * 20;
  v.z = PARK_X;
  v.d = PARK_X; // traffic logic (AI, flags) reads s / d: far off to the side = gone
  v.vx = 0;
  v.vz = 0;
  v.speed = 0;
  v.yawRate = 0;
  const x = crx(car.race);
  x.scCleared = 1;
  x.slowT = 0;
}

/**
 * RaceControlSystem (between the AI and the vehicle systems): AI-driven cars obey `race.scTargetSpeed` (lift / brake when too
 * fast) and retired cars brake to a stop. Minimal safe default until the AI reads the SC state itself; no-op without an SC.
 */
export function createRaceControlSystem(): SimSystem {
  return {
    name: 'raceControl',
    step(world) {
      const cars = world.state.cars;
      for (let i = 0; i < cars.length; i++) {
        const car = cars[i]!;
        if (car.control !== 'ai') continue;
        const inp = car.input;
        if (car.race.status === 'dnf') {
          // A retired car brakes to a stop where it is; SC_CLEAR_RETIRED_S later the marshals remove it from the circuit.
          inp.throttle = 0;
          inp.brake = 1;
          const x = crx(car.race);
          if (x.retireMs >= 0 && world.state.race.raceMs - x.retireMs >= SC_CLEAR_RETIRED_S * 1000) {
            // Parked off the circuit as a kinematic car ('remote': no AI, physics, walls or timing), hidden by the render glue.
            car.control = 'remote';
            parkOffTrack(car);
          }
          continue;
        }
        const target = car.race.scTargetSpeed;
        if (target < 0) continue;
        const over = car.vehicle.speed - target;
        if (over > 0) {
          inp.throttle = 0;
          const b = over * 0.12;
          if (b > inp.brake) inp.brake = b > 0.8 ? 0.8 : b;
        } else if (over > -3 && inp.throttle > 0.35) inp.throttle = 0.35;
      }
    },
  };
}
