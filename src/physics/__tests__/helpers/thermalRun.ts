// Tyre thermal calibration harness: a perfect-AI car laps İstanbul in Time Trial; the caller can scale the
// speed profile (slow lap) and set the wetness. Test helper.

import type { Compound } from '../../../contracts/common';
import type { SimRunner } from '../../../contracts/sim';
import { createSim, defaultSessionConfig } from '../../../game/createSim';

export interface ThermalRun {
  sim: SimRunner;
  /** Mean core / surface temperature of the 4 tyres. */
  core(): number;
  surf(): number;
  /** Runs until the next lap event (or maxS of sim time); returns the lap time in s. */
  lap(maxS?: number): number;
  /** Scales the car's speed profile (slow lap = 0.6). */
  pace(f: number): void;
  setWet(w: number): void;
}

export function thermalRun(compound: Compound): ThermalRun {
  const sim = createSim(defaultSessionConfig({ mode: 'timeTrial', aiCount: 0, autodrive: true, startCompound: compound }), { skipLights: true });
  const w = sim.world;
  const car = w.state.cars[0]!;
  const prof = w.static.ai.getProfile(0);
  const base = Float32Array.from(prof.v);
  const tyres = car.vehicle.tyres;
  // Held wetness (−1 = conditions run free): the ConditionsSystem (L9) would otherwise dry a dry-preset track.
  let wet = -1;
  return {
    sim,
    core: () => (tyres[0].coreC + tyres[1].coreC + tyres[2].coreC + tyres[3].coreC) / 4,
    surf: () => (tyres[0].surfC + tyres[1].surfC + tyres[2].surfC + tyres[3].surfC) / 4,
    lap(maxS = 200) {
      let ms = NaN;
      for (let i = 0; i < maxS * 240 && ms !== ms; i++) {
        if (wet >= 0) {
          const c = w.state.conditions;
          c.wetness = wet;
          c.lineWetness = wet;
          c.rain = wet;
        }
        sim.step();
        w.events.drain((e) => {
          if (e.type === 'lap' && e.car === 0) ms = e.ms;
        });
      }
      return ms / 1000;
    },
    pace(f) {
      for (let i = 0; i < base.length; i++) prof.v[i] = base[i]! * f;
    },
    setWet(x) {
      wet = x;
    },
  };
}
