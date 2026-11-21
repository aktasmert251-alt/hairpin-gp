// Penalties, the two-compound rule and retirement (rules §5, §8, §9; sim layer).

import type { PenaltyReason } from '../contracts/race';
import type { SimCarState, SimWorld } from '../contracts/sim';
import { crx, rrx } from './extra';
import { TWO_COMPOUND_PENALTY_S, TWO_COMPOUND_WET_LIFT } from './rules';

/** Dry-compound bits of `compoundsUsedMask` (S 1, M 2, H 4) and the wet ones (I 8, W 16). */
const DRY_MASK = 1 | 2 | 4;
const WET_MASK = 8 | 16;

/**
 * Adds a time penalty. Every reason except `twoCompound` is served at the next stop (`penaltyToServeSec`);
 * `twoCompound` is applied at the finish and cannot be served.
 */
export function addPenalty(world: SimWorld, car: SimCarState, seconds: number, reason: PenaltyReason): void {
  if (!rulesOn(world)) return; // D-061 Kasap: no penalties of any kind
  const r = car.race;
  r.penaltySec += seconds;
  if (reason === 'twoCompound') crx(r).twoCompoundSec += seconds;
  else r.penaltyToServeSec += seconds;
  world.events.push({ type: 'penalty', car: car.id, seconds, reason });
}

/** D-061: false in the online 'kasap' mode (no penalties, warnings or safety car). */
export function rulesOn(world: SimWorld): boolean {
  return world.static.config.rules !== 'kasap';
}

/** Rules §8: is the two-compound rule violated for this car (active rule, not lifted)? */
export function twoCompoundViolated(world: SimWorld, car: SimCarState): boolean {
  const cfg = world.static.config;
  if (!cfg.mandatoryStop || cfg.mode !== 'race') return false;
  const r = car.race;
  if (r.status === 'dnf' || r.status === 'dsq') return false;
  if ((r.compoundsUsedMask & WET_MASK) !== 0) return false;
  if (rrx(world.state.race).wetMax >= TWO_COMPOUND_WET_LIFT) return false;
  const dry = r.compoundsUsedMask & DRY_MASK;
  // At least two different dry compounds = more than one bit set.
  return (dry & (dry - 1)) === 0;
}

/** Applied once when the car takes the chequered flag. */
export function applyFinishPenalties(world: SimWorld, car: SimCarState): void {
  if (twoCompoundViolated(world, car) && crx(car.race).twoCompoundSec === 0) addPenalty(world, car, TWO_COMPOUND_PENALTY_S, 'twoCompound');
}

/**
 * Glue writer (ARCHITECTURE §4.3, between ticks): the car retires (rules §9). Status `dnf`, `retired` event (CR-06).
 * The session shows the projected classification right after; the car is not simulated further.
 */
export function retireCar(world: SimWorld, carId: number): void {
  const car = world.state.cars[carId];
  if (!car || car.race.status !== 'running' || car.race.finished) return;
  car.race.status = 'dnf';
  crx(car.race).retireMs = world.state.race.raceMs;
  world.events.push({ type: 'retired', car: carId });
}

/** Rules §9: classification time = race time at the crossing + unserved penalties + two-compound penalty. */
export function classificationMs(car: SimCarState): number {
  const r = car.race;
  return r.finishMs + (r.penaltyToServeSec + crx(r).twoCompoundSec) * 1000;
}
