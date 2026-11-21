// Control latch (glue writer, docs/ARCHITECTURE.md §4.3): before every tick the InputManager's latched
// keyboard state is written into the player's DriverControls. Always latched (also under autodrive) so
// pending edges are consumed tick by tick and never replayed later.

import type { SimWorld } from '../../contracts/sim';
import type { DriverControls } from '../../contracts/vehicle';

export interface ControlSource { latch(out: DriverControls): void }

/** Persistent (non-keyboard) values the glue latches with every tick (CR-03 / CR-14; padSpeedSteer: gamepad option). */
export interface LatchedSettings { steerSensitivity: number; padSpeedSteer?: boolean }

/** Gamepad speed-sensitive steering: stick lock × 1 at ≤ 15 m/s, falling linearly to × 0.6 at ≥ 80 m/s. */
export function padSpeedSteerScale(speed: number): number {
  const t = speed <= 15 ? 0 : speed >= 80 ? 1 : (speed - 15) / 65;
  return 1 - 0.4 * t;
}

export function latchPlayerControls(world: SimWorld, source: ControlSource, playerId: number, latched?: LatchedSettings): void {
  const car = world.state.cars[playerId];
  if (!car) return;
  source.latch(car.controls);
  // CR-14: settings.controls.steerSensitivity, latched every tick (deterministic: it is part of SimState).
  if (latched) car.controls.steerSensitivity = latched.steerSensitivity;
  // Applied here (state at the tick start), so the latched axis is the recorded value.
  if (latched?.padSpeedSteer && car.controls.analog) car.controls.steerAxis *= padSpeedSteerScale(car.vehicle.speed);
}
