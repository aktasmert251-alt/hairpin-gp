// D-056 collision-causing penalties (sim layer, allocation-free). The RaceDirector feeds every car–car `collision` event of the
// tick (read through SimEventQueue.listen, so it does not depend on when the glue drains) to `noteCollision`, which decides who
// is at fault from the approach geometry; `stepCollisionPenalties` then watches the victim for COLLISION_WINDOW_S and grades:
//   heavy (victim spun / off track / stopped)          → +10 s
//   rear-end or divebomb without heavy consequence     → 1st offence a warning (`collisionWarning`), then +5 s
//   push (sideways into a car alongside), no consequence → free (racing contact)
// Light contacts (< COLLISION_MIN_J) and contacts without a clear fault are free. Applies to the player and AI; a 'remote'
// offender (online) is judged by its own client / the server sim, never locally.

import type { SimCarState, SimWorld } from '../contracts/sim';
import { crx } from './extra';
import { addPenalty, rulesOn } from './penalties';
import {
  COLLISION_ALONGSIDE_M, COLLISION_CLOSING_MS, COLLISION_CORNER_K, COLLISION_CORNER_LOOK_M, COLLISION_HEAVY_S, COLLISION_INLINE_M,
  COLLISION_MIN_J, COLLISION_PAIR_COOLDOWN_S, COLLISION_PENALTY_S, COLLISION_PUSH_MS, COLLISION_SPIN_RAD, COLLISION_START_FACTOR,
  COLLISION_START_S, COLLISION_STOP_MS, COLLISION_WINDOW_S,
} from './rules';

const KIND_REAR = 1;
const KIND_DIVEBOMB = 2;
const KIND_PUSH = 3;
const COS_SPIN = Math.cos(COLLISION_SPIN_RAD);

/** Lateral velocity (m/s, + = towards the track's left) of a car at its track position. */
function lateralSpeed(world: SimWorld, car: SimCarState): number {
  const data = world.static.track.data;
  const v = car.vehicle;
  const i = Math.min(data.count - 1, Math.max(0, Math.floor(v.s)));
  // Left vector = (tz, −tx) (TrackFrame convention: tangent (1, 0) → left (0, −1)).
  return v.vx * data.tz[i]! - v.vz * data.tx[i]!;
}

function inCorner(world: SimWorld, s: number): boolean {
  const q = world.static.track.query;
  const k = world.static.track.data.curvature;
  const n = world.static.track.data.count;
  for (let ds = 0; ds <= COLLISION_CORNER_LOOK_M; ds += 10) {
    const i = Math.min(n - 1, Math.max(0, Math.floor(q.wrapS(s + ds))));
    const c = k[i]!;
    if (c > COLLISION_CORNER_K || c < -COLLISION_CORNER_K) return true;
  }
  return false;
}

function eligible(car: SimCarState): boolean {
  return car.race.status === 'running' && !car.race.finished && car.vehicle.hint.ribbon === 'main' && car.pit.phase === 'none';
}

/** One car–car contact (a, b ≥ 0) of this tick. */
export function noteCollision(world: SimWorld, a: number, b: number, impulse: number): void {
  const st = world.state;
  const race = st.race;
  if (race.phase !== 'running' && race.phase !== 'finishing') return;
  if (!rulesOn(world)) return; // D-061 Kasap: no collision penalties or warnings
  const sinceStart = (race.raceMs - race.lightsOutAtMs) / 1000;
  const minJ = sinceStart < COLLISION_START_S ? COLLISION_MIN_J * COLLISION_START_FACTOR : COLLISION_MIN_J;
  if (!(impulse >= minJ)) return;
  const A = st.cars[a];
  const B = st.cars[b];
  if (!A || !B || !eligible(A) || !eligible(B)) return;
  // One incident per pair per cooldown (a long scrape emits several events).
  const xa = crx(A.race);
  const xb = crx(B.race);
  if ((xa.colOther === b && race.raceMs - xa.colMs < COLLISION_PAIR_COOLDOWN_S * 1000)
    || (xb.colOther === a && race.raceMs - xb.colMs < COLLISION_PAIR_COOLDOWN_S * 1000)) return;
  xa.colOther = b;
  xa.colMs = race.raceMs;
  xb.colOther = a;
  xb.colMs = race.raceMs;

  const q = world.static.track.query;
  const va = A.vehicle;
  const vb = B.vehicle;
  // ds > 0: B is ahead of A on track.
  const ds = q.deltaS(va.s, vb.s);
  const behind = ds >= 0 ? A : B;
  const ahead = ds >= 0 ? B : A;
  const gap = ds >= 0 ? ds : -ds;
  const lat = va.d - vb.d;
  const latAbs = lat < 0 ? -lat : lat;
  const closing = behind.vehicle.speed - ahead.vehicle.speed;
  let offender: SimCarState | null = null;
  let kind = 0;
  if (gap >= COLLISION_ALONGSIDE_M && closing > COLLISION_CLOSING_MS) {
    if (latAbs < COLLISION_INLINE_M) {
      offender = behind;
      kind = KIND_REAR;
    } else if (inCorner(world, behind.vehicle.s)) {
      offender = behind;
      kind = KIND_DIVEBOMB;
    }
  } else if (gap < COLLISION_ALONGSIDE_M) {
    // Alongside: who moved sideways into whom.
    const sideA = lat < 0 ? 1 : -1; // direction from A towards B in d
    const towardA = lateralSpeed(world, A) * sideA;
    const towardB = -lateralSpeed(world, B) * sideA;
    if (towardA - towardB > COLLISION_PUSH_MS) {
      offender = A;
      kind = KIND_PUSH;
    } else if (towardB - towardA > COLLISION_PUSH_MS) {
      offender = B;
      kind = KIND_PUSH;
    }
  }
  if (!offender || offender.control === 'remote') return;
  const xo = crx(offender.race);
  if (xo.incT > 0) return; // already being judged for an earlier contact
  xo.incT = COLLISION_WINDOW_S;
  xo.incVictim = offender === A ? b : a;
  xo.incKind = kind;
  xo.incHeavy = 0;
}

/** Heavy consequence for the victim right now: spun, off track, stopped or out. */
function victimInTrouble(world: SimWorld, victim: SimCarState): boolean {
  if (victim.race.status !== 'running') return true;
  const v = victim.vehicle;
  if (v.speed < COLLISION_STOP_MS) return true;
  if (v.offTrackWheels >= 4) return true;
  const data = world.static.track.data;
  const i = Math.min(data.count - 1, Math.max(0, Math.floor(v.s)));
  // Heading vs the track tangent (forward = (cos yaw, −sin yaw)).
  const dot = Math.cos(v.yaw) * data.tx[i]! - Math.sin(v.yaw) * data.tz[i]!;
  return dot < COS_SPIN;
}

/** Per tick: judge the pending incidents. */
export function stepCollisionPenalties(world: SimWorld, dt: number): void {
  const cars = world.state.cars;
  for (let i = 0; i < cars.length; i++) {
    const car = cars[i]!;
    const x = crx(car.race);
    if (x.incT <= 0) continue;
    const victim = cars[x.incVictim];
    if (victim && x.incHeavy === 0 && victimInTrouble(world, victim)) x.incHeavy = 1;
    x.incT -= dt;
    if (x.incHeavy === 0 && x.incT > 0) continue;
    x.incT = 0;
    if (car.race.status !== 'running' || car.race.finished) continue;
    if (x.incHeavy === 1) addPenalty(world, car, COLLISION_HEAVY_S, 'collision');
    else if (x.incKind === KIND_REAR || x.incKind === KIND_DIVEBOMB) {
      if (car.race.collisionWarnings === 0) {
        car.race.collisionWarnings = 1;
        world.events.push({ type: 'collisionWarning', car: car.id, other: x.incVictim });
      } else addPenalty(world, car, COLLISION_PENALTY_S, 'collision');
    }
  }
}
