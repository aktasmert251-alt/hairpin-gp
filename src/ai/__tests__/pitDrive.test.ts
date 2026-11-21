// S2-S7 pit-lane driving (pitAuto, pit-weather §2) on İstanbul through the real PitProcedure and physics.
// Pit loss = time split → merge in the lane minus the car's own profile time over the same main-track span (the
// definition of the Lead's pitLossEstimateS); acceptance 20–24 s, no wall contact in the lane.

import { describe, expect, it } from 'vitest';
import type { SimRunner } from '../../contracts/sim';
import { createSim, defaultSessionConfig } from '../../game/createSim';
import { MODULE_STATUS as TRACK_STATUS, loadTrack } from '../../track/index';

const HZ = 240;
const istanbulReady = TRACK_STATUS !== 'stub' && loadTrack().data.id === 'istanbul' && loadTrack().data.pit.count > 1;

function race(aiCount: number, stopLap: number): SimRunner {
  const sim = createSim(defaultSessionConfig({ mode: 'race', aiCount, seed: 5, laps: 4, difficulty: 70, autodrive: true }), { skipLights: true });
  for (const c of sim.world.state.cars) c.ai.plannedStopLaps.push(stopLap);
  return sim;
}

describe.skipIf(!istanbulReady)('pit-lane driving (S7)', () => {
  it('one car: full stop, lane loss 20–24 s, no wall contact', () => {
    const sim = race(0, 2);
    const w = sim.world;
    const q = w.static.track.query;
    const pit = w.static.track.data.pit;
    const car = w.state.cars[0]!;
    const v = car.vehicle;
    const prof = w.static.ai.getProfile(0);
    let mainT = 0;
    const d0 = q.deltaS(pit.mainSAtSplit, pit.mainSAtMerge);
    const span = d0 > 0 ? d0 : d0 + q.length;
    for (let i = 0; i < prof.line.count; i++) {
      let d = prof.line.s[i]! - pit.mainSAtSplit;
      if (d < 0) d += q.length;
      if (d < span) mainT += prof.line.ds / Math.max(5, prof.v[i]!);
    }
    let tIn = -1;
    let tOut = -1;
    let walls = 0;
    // QC2-12: no dense tyre smoke braking into the pit entry: seconds with any wheel past 1.6 × peak combined slip
    // (renderFrame σ; graphics smoke starts at 1.15 and is dense from ~1.75) over the last 100 m (T13) before the split.
    let smokeS = 0;
    const p0 = w.static.params[0]!;
    let stops = 0;
    for (let i = 0; i < 400 * HZ && tOut < 0; i++) {
      sim.step();
      w.events.drain((e) => {
        if (e.type === 'collision' && e.a === 0 && e.b < 0 && car.pit.phase !== 'none') walls++;
        if (e.type === 'pit' && e.phase === 'stationary') stops++;
      });
      const toSplit0 = q.deltaS(v.s, pit.mainSAtSplit);
      if ((car.pit.phase === 'requested' || car.pit.phase === 'entry') && toSplit0 > -40 && toSplit0 < 100) {
        const cp = p0.compounds[v.compound];
        let sg = 0;
        v.wheels.forEach((wh, k) => {
          const sy = Math.tan(wh.slipAngle) / Math.tan(cp.slipAnglePeak * (k >= 2 ? p0.tuning?.rearAlphaFactor ?? 1 : 1));
          sg = Math.max(sg, Math.hypot(wh.slipRatio / cp.slipRatioPeak, sy));
        });
        if (sg > 1.6) smokeS += 1 / HZ;
      }
      const toSplit = q.deltaS(pit.mainSAtSplit, v.s);
      if (tIn < 0 && car.pit.phase !== 'none' && v.hint.ribbon === 'main' && toSplit >= 0 && toSplit < 5) tIn = w.state.race.raceMs;
      if (tIn > 0 && v.hint.ribbon === 'main' && q.deltaS(pit.mainSAtMerge, v.s) >= 0 && q.deltaS(pit.mainSAtMerge, v.s) < 5) tOut = w.state.race.raceMs;
    }
    const loss = (tOut - tIn) / 1000 - mainT;
    console.log(`S7 pit loss ${loss.toFixed(2)} s (lane ${((tOut - tIn) / 1000).toFixed(2)} s, main ${mainT.toFixed(2)} s), wall hits ${walls}, entry smoke ${smokeS.toFixed(2)} s`);
    expect(stops).toBe(1);
    expect(smokeS).toBeLessThan(0.5);
    expect(walls).toBe(0);
    expect(loss).toBeGreaterThanOrEqual(20);
    expect(loss).toBeLessThanOrEqual(24);
  }, 300_000);

  it('20 cars boxing on the same lap: all stop, no wall contact, no reset, all finish', () => {
    const sim = race(19, 2);
    const w = sim.world;
    const cars = w.state.cars;
    let walls = 0;
    let resets = 0;
    let finished = 0;
    const stops = new Array<number>(cars.length).fill(0);
    for (let i = 0; i < 600 * HZ && w.state.race.phase !== 'finished'; i++) {
      sim.step();
      w.events.drain((e) => {
        if (e.type === 'collision' && e.b < 0 && cars[e.a]!.vehicle.hint.ribbon === 'pit') walls++;
        // Racing cars only: a finished car coasting its cool-down lap spun at T2 (lift-off, B-4) and was reset (Sprint 4).
        if (e.type === 'carReset' && !cars[e.car]!.race.finished) resets++;
        if (e.type === 'pit' && e.phase === 'stationary') stops[e.car]!++;
        if (e.type === 'finish') finished++;
      });
    }
    console.log(`S7 20-car stop: stops ${stops.join('')}, lane wall hits ${walls}, resets ${resets}, finished ${finished}`);
    expect(stops.every((n) => n === 1)).toBe(true);
    expect(walls).toBe(0);
    expect(resets).toBe(0);
    expect(finished).toBe(20);
  }, 600_000);
});
