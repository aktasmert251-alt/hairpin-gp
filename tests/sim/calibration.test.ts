// S-SM-04/05/08/09 (AI pace calibration) and S-SM-06 (20 cars x 3 laps) through createSim, cross-module (testing-qc §2.3).
// Sürüş's own unit calibration (src/ai) checks the same numbers on the profile; this file is the integration view the QC gate reads.
// S-SM-05 deviation known (src/ai/__tests__/calibration.test.ts): S2 and S3 are asserted together (67 +- 2 %).

import { describe, expect, it } from 'vitest';
import { SIM_HZ, type SimEvent } from '../../src/contracts/sim';
import { createSim, defaultSessionConfig } from '../../src/game/createSim';
import { SEEDS, makeSim } from '../helpers/sim';

describe('S-SM-04/05/08/09 AI d=100 flying lap (time trial car driven by autodrive, Medium, 10 kg)', () => {
  it('lap 1:24-1:27, S1 33 +- 2 %, S2+S3 67 +- 2 %, T8 4.5-5.5 g, back straight 320-335 km/h, no resets', () => {
    const sim = createSim(defaultSessionConfig({ mode: 'timeTrial', aiCount: 0, autodrive: true, startCompound: 'medium', seed: 7 }), { skipLights: true });
    const w = sim.world;
    const v = w.state.cars[0]!.vehicle;
    const laps: number[] = [];
    const sec = [0, 0, 0];
    let sectors = [0, 0, 0];
    let t8 = 0;
    let bs = 0;
    for (let i = 0; i < (3 * 110 + 40) * SIM_HZ && laps.length < 3; i++) {
      sim.step();
      w.events.drain((e) => {
        if (e.type === 'sector' && e.car === 0) sec[e.sector] = e.ms / 1000;
        if (e.type === 'lap' && e.car === 0) {
          laps.push(e.ms / 1000);
          sectors = [sec[0]!, sec[1]!, e.ms / 1000 - sec[0]! - sec[1]!];
        }
      });
      if (laps.length >= 1) {
        if (v.s > 2192 && v.s < 2750) t8 = Math.max(t8, Math.abs(v.ayLat) / 9.81);
        if (v.s > 4300 && v.s < 4560) bs = Math.max(bs, v.speed * 3.6);
      }
    }
    expect(laps.length, 'three laps completed').toBe(3);
    const best = Math.min(...laps.slice(1));
    const tot = sectors[0]! + sectors[1]! + sectors[2]!;
    const pct = sectors.map((x) => (100 * x) / tot);
    console.log(`S-SM-04..09 laps ${laps.map((x) => x.toFixed(2))}; best ${best.toFixed(2)}; split ${pct.map((x) => x.toFixed(1))}; T8 ${t8.toFixed(2)} g; BS ${bs.toFixed(1)} km/h`);
    expect(v.resetCount, 'resets').toBe(0);
    expect(best, 'S-SM-04').toBeGreaterThanOrEqual(84);
    expect(best).toBeLessThanOrEqual(87);
    expect(Math.abs(pct[0]! - 33), 'S-SM-05 S1').toBeLessThanOrEqual(2);
    expect(Math.abs(pct[1]! + pct[2]! - 67), 'S-SM-05 S2+S3').toBeLessThanOrEqual(2);
    expect(t8, 'S-SM-08').toBeGreaterThanOrEqual(4.5);
    expect(t8).toBeLessThanOrEqual(5.5);
    expect(bs, 'S-SM-09').toBeGreaterThanOrEqual(320);
    expect(bs).toBeLessThanOrEqual(335);
  }, 300_000);
});

describe('S-SM-06 20 cars x 3 laps', () => {
  it('all finish, <= 1 track-limit event per car per lap, no car stuck > 4 s, no resets (seed 1234)', () => {
    const sim = makeSim({ skipLights: true, cfg: { seed: SEEDS.field, laps: 3 } });
    const w = sim.world;
    const finished = new Set<number>();
    const limits = new Map<string, number>();
    const stuck = new Array<number>(20).fill(0);
    let maxStuck = 0;
    let stuckCar = -1;
    const sink = (e: SimEvent): void => {
      if (e.type === 'finish') finished.add(e.car);
      if (e.type === 'trackLimits') {
        const lap = w.state.cars[e.car]!.race.lapsCompleted;
        limits.set(`${e.car}:${lap}`, (limits.get(`${e.car}:${lap}`) ?? 0) + 1);
      }
    };
    const dt = 1 / SIM_HZ;
    let guard = 0;
    while (w.state.race.phase !== 'finished' && guard++ < 420 * SIM_HZ) {
      sim.step();
      w.events.drain(sink);
      if (w.state.time > 15)
        for (const c of w.state.cars) {
          if (c.race.finished || c.race.status !== 'running') continue;
          stuck[c.id] = c.vehicle.speed < 1 ? stuck[c.id]! + dt : 0;
          if (stuck[c.id]! > maxStuck) {
            maxStuck = stuck[c.id]!;
            stuckCar = c.id;
          }
        }
    }
    expect(w.state.race.phase, `race finished within 420 s (seed ${SEEDS.field})`).toBe('finished');
    expect(finished.size, 'cars that crossed the line').toBeGreaterThanOrEqual(19);
    const worst = [...limits.entries()].sort((a, b) => b[1] - a[1])[0];
    console.log(`S-SM-06 finished ${finished.size}/20, max stuck ${maxStuck.toFixed(1)} s (car ${stuckCar}), worst limits ${worst?.[0]}=${worst?.[1] ?? 0}`);
    expect(maxStuck, `car ${stuckCar} stuck`).toBeLessThanOrEqual(4);
    expect(worst?.[1] ?? 0, `track-limit events car:lap ${worst?.[0]}`).toBeLessThanOrEqual(1);
    expect(w.state.cars.reduce((n, c) => n + c.vehicle.resetCount, 0), 'car resets').toBe(0);
  }, 400_000);
});
