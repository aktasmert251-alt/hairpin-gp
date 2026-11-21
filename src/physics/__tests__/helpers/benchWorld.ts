// Single-car bench world: createSim (Time Trial, no AI) on a given track, then only the VehicleSystem and the
// CollisionSystem are stepped; the test writes car.input directly (no keyboard filter). Test helper.

import type { Compound } from '../../../contracts/common';
import type { AssistSettings } from '../../../contracts/race';
import { SIM_DT, type SimCarState, type SimWorld } from '../../../contracts/sim';
import type { TrackBundle } from '../../../contracts/track';
import { ASSIST_PRESETS } from '../../../core/settings/defaults';
import { createSim, defaultSessionConfig } from '../../../game/createSim';
import { createCollisionSystem } from '../../collision/collisionSystem';
import { initVehicleState } from '../../state';
import { createVehicleSystem } from '../../vehicle/vehicleSystem';

export interface BenchOpts {
  compound?: Compound;
  assists?: Partial<AssistSettings>;
  fuelKg?: number;
  s?: number;
  d?: number;
  kmh?: number;
  /** Keep tyres at their optimum temperature every tick (bench condition). */
  optimumTyres?: boolean;
}

export interface Bench {
  world: SimWorld;
  car: SimCarState;
  step(n?: number): void;
  /** Places the car at (s, d) at speed (wheels rolling). */
  place(s: number, d: number, kmh: number): void;
}

export function createBench(track: TrackBundle, o: BenchOpts = {}): Bench {
  const cfg = defaultSessionConfig({
    mode: 'timeTrial', aiCount: 0, weather: 'dry', startCompound: o.compound ?? 'medium',
    assists: { ...ASSIST_PRESETS.intermediate, ...o.assists },
  });
  const sim = createSim(cfg, { track, skipLights: true });
  const world = sim.world;
  const car = world.state.cars[0]!;
  const p = world.static.params[0]!;
  const vehicle = createVehicleSystem();
  const collision = createCollisionSystem();
  const fuel = o.fuelKg ?? 10;
  const optimum = o.optimumTyres !== false;

  const place = (s: number, d: number, kmh: number): void => {
    const fresh = initVehicleState(p, track, { s, d }, car.vehicle.compound);
    Object.assign(car.vehicle, fresh);
    const v = car.vehicle;
    v.fuelKg = fuel;
    v.massKg = p.massDryKg + fuel;
    const sp = kmh / 3.6;
    v.vx = Math.cos(v.yaw) * sp;
    v.vz = -Math.sin(v.yaw) * sp;
    v.speed = sp;
    v.vLong = sp;
    for (const w of v.wheels) w.omega = sp / p.wheelRadius;
    v.clutch = 1;
    if (sp > 1) {
      // Pick the gear the auto box would hold at this speed.
      const om = sp / p.wheelRadius;
      for (let g = 1; g <= p.gearRatios.length; g++) {
        v.gear = g;
        if (om * p.gearRatios[g - 1]! * p.finalDrive * 60 / (2 * Math.PI) < 11000) break;
      }
    }
    car.input.throttle = 0;
    car.input.brake = 0;
    car.input.steer = 0;
  };
  place(o.s ?? 0, o.d ?? 0, o.kmh ?? 0);

  return {
    world,
    car,
    place,
    step(n = 1) {
      const st = world.state;
      for (let k = 0; k < n; k++) {
        if (optimum) {
          const c = p.compounds[car.vehicle.compound];
          for (const t of car.vehicle.tyres) {
            t.surfC = c.tOptC;
            t.coreC = c.tOptC;
            t.gripMul = 1;
          }
        }
        st.tick++;
        st.time = st.tick * SIM_DT;
        vehicle.step(world, SIM_DT);
        collision.step(world, SIM_DT);
        if (st.tick % 1024 === 0) world.events.drain(noop);
      }
    },
  };
}

function noop(): void {}
