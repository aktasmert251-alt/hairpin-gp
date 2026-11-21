// Teleport (glue writer, docs/ARCHITECTURE.md §4.3): places a car on the main ribbon at (s, d), facing the
// driving direction with vLong = kmh / 3.6. Uses the physics initVehicleState, then keeps lap count, fuel,
// tyres and ERS charge. Debug / screenshot use only (between ticks).

import type { SimWorld } from '../../contracts/sim';
import { initVehicleState } from '../../physics/index';
import { deepAssign } from './stateUtils';

/** Gives a car standing on the track a rolling speed: body velocity, wheel spin and a matching gear. */
export function rollingStart(world: SimWorld, carId: number, kmh: number): void {
  const car = world.state.cars[carId]!;
  const p = world.static.params[carId]!;
  const v = car.vehicle;
  const speed = Math.max(0, kmh / 3.6);
  v.speed = speed;
  v.vLong = speed;
  v.vx = Math.cos(v.yaw) * speed;
  v.vz = -Math.sin(v.yaw) * speed;
  if (speed <= 0) return;
  const omega = speed / p.wheelRadius;
  for (const w of v.wheels) w.omega = omega;
  // Highest gear that keeps the engine above 9,500 rpm (or first gear).
  let gear = 1;
  for (let g = 1; g <= p.gearRatios.length; g++) {
    const rpm = (omega * p.gearRatios[g - 1]! * p.finalDrive * 60) / (2 * Math.PI);
    if (rpm >= 9500 && rpm <= p.limiterRpm) gear = g;
  }
  v.gear = gear;
  v.rpm = Math.min(p.limiterRpm, (omega * p.gearRatios[gear - 1]! * p.finalDrive * 60) / (2 * Math.PI));
}

export function teleportCar(world: SimWorld, carId: number, s: number, d: number, kmh: number): void {
  const car = world.state.cars[carId];
  if (!car) throw new Error(`teleport: no car ${carId}`);
  const track = world.static.track;
  const q = track.query;
  const v = car.vehicle;
  const keep = { lapWraps: v.lapWraps, fuelKg: v.fuelKg, massKg: v.massKg, compound: v.compound, tyreAgeLaps: v.tyreAgeLaps, socJ: v.ers.socJ, resetCount: v.resetCount };
  const tyres = structuredClone(v.tyres);
  const fresh = initVehicleState(world.static.params[carId]!, track, { s: q.wrapS(s), d }, keep.compound);
  deepAssign(v, fresh);
  v.lapWraps = keep.lapWraps;
  v.fuelKg = keep.fuelKg;
  v.massKg = keep.massKg;
  v.tyreAgeLaps = keep.tyreAgeLaps;
  v.ers.socJ = keep.socJ;
  v.resetCount = keep.resetCount;
  deepAssign(v.tyres, tyres);
  rollingStart(world, carId, kmh);
  car.race.progress = v.lapWraps * q.length + v.s;
  car.kb.throttle = 0;
  car.kb.brake = 0;
  car.kb.steerU = 0;
  car.ai.laneOffset = d;
  car.ai.lastSteer = 0;
  car.ai.integ = 0;
}
