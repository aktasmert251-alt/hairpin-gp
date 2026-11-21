// D-040 wrong-way detection (RaceDirector). Sim layer, allocation-free per tick; state in CarRaceExtra (ww*).
// Heading = forward vector (cos yaw, −sin yaw) of the car; compared with the main-track tangent at its s.
// Exempt (and reset): pit lane / pit procedure, post-reset recovery window (recoverT, set by stepTrackLimits).

import type { SimCarState, SimWorld } from '../contracts/sim';
import type { TrackFrame } from '../contracts/track';
import { crx } from './extra';
import { invalidateLap } from './limits';
import { WRONG_WAY_DOT, WRONG_WAY_KMH, WRONG_WAY_OFF_S, WRONG_WAY_ON_S } from './rules';

const wwFrame = {} as TrackFrame;

function setOn(world: SimWorld, car: SimCarState, on: 0 | 1): void {
  const x = crx(car.race);
  if (x.wwOn === on) return;
  x.wwOn = on;
  world.events.push({ type: 'wrongWay', car: car.id, on: on === 1 });
}

/** Per tick for a running car (after stepTrackLimits). `dt` in s. */
export function stepWrongWay(world: SimWorld, car: SimCarState, dt: number): void {
  const v = car.vehicle;
  const x = crx(car.race);
  if (v.hint.ribbon === 'pit' || car.pit.phase !== 'none' || x.recoverT > 0) {
    x.wwT = 0;
    x.wwOkT = 0;
    setOn(world, car, 0);
    return;
  }
  const f = world.static.track.query.frameAt(v.s, wwFrame);
  const dot = Math.cos(v.yaw) * f.tx - Math.sin(v.yaw) * f.tz;
  if (v.speed * 3.6 > WRONG_WAY_KMH && dot < WRONG_WAY_DOT) {
    x.wwT += dt;
    x.wwOkT = 0;
    if (x.wwOn === 0 && x.wwT >= WRONG_WAY_ON_S) {
      setOn(world, car, 1);
      if (world.static.config.mode === 'timeTrial') invalidateLap(world, car, 'wrongWay');
    }
    return;
  }
  x.wwT = 0;
  if (x.wwOn === 0) return;
  x.wwOkT = dot > 0 ? x.wwOkT + dt : 0;
  if (x.wwOkT >= WRONG_WAY_OFF_S) {
    x.wwOkT = 0;
    setOn(world, car, 0);
  }
}
