// Ardennes pit entry (regression): the OSM pit way branches off between the halves of the final chicane, where pitAuto
// ran wide at the T18 exit, missed the lane and hit the lane nose. The re-drawn entry (PIT.entryRedraw) must take a car
// from racing speed into its box with no wall contact or reset, for a player box request and for AI stops.

import { describe, expect, it } from 'vitest';
import type { SimRunner } from '../../contracts/sim';
import { createSim, defaultSessionConfig } from '../../game/createSim';
import { teleportCar } from '../../game/sim/teleport';

const HZ = 240;

interface Tally { walls: number; resets: number; stops: number[]; inLane: boolean[] }

function run(sim: SimRunner, seconds: number, done: () => boolean): Tally {
  const w = sim.world;
  const cars = w.state.cars;
  const t: Tally = { walls: 0, resets: 0, stops: cars.map(() => 0), inLane: cars.map(() => false) };
  for (let i = 0; i < seconds * HZ && !done(); i++) {
    sim.step();
    w.events.drain((e) => {
      if (e.type === 'collision' && e.b < 0 && cars[e.a]!.pit.phase !== 'none') t.walls++;
      if (e.type === 'carReset' && !cars[e.car]!.race.finished) t.resets++;
      if (e.type === 'pit' && e.phase === 'stationary') t.stops[e.car]!++;
    });
    cars.forEach((c, k) => { if (c.vehicle.hint.ribbon === 'pit') t.inLane[k] = true; });
  }
  return t;
}

describe('Ardennes pit entry', () => {
  // KNOWN RACE BUG (src/race/pit.ts, Lead; every track, not only Ardennes): with the pit assist, the 'requested' phase
  // hands control back as soon as the car passes the split s (`toSplit < 0`), while it is still crossing the main edge
  // onto the ribbon; the 'entry' phase never takes it again, so the player car coasts into the lane uncontrolled. The
  // proposed one-line fix (`toSplit < -PIT_MISSED_SPLIT_M`) makes these pass on Ardennes, İstanbul and Lombardia.
  // `it.fails` until then: flip to `it` with the fix.
  for (const kmh of [80, 120]) {
    it(`player box request at ${kmh} km/h before the final chicane reaches the box without contact`, () => {
      const sim = createSim(defaultSessionConfig({ mode: 'race', aiCount: 0, seed: 3, laps: 3, trackId: 'ardennes' }), { skipLights: true });
      const w = sim.world;
      const me = w.state.cars[0]!;
      expect(me.control).toBe('player');
      const pit = w.static.track.data.pit;
      teleportCar(w, 0, w.static.track.query.wrapS(pit.mainSAtSplit - 320), 0, kmh);
      me.controls.boxRequest = true;
      const t = run(sim, 90, () => me.pit.phase === 'exit');
      expect(t.stops[0]).toBe(1);
      expect(t.walls).toBe(0);
      expect(t.resets).toBe(0);
    }, 300_000);
  }

  it('AI field: every car makes its planned stop, no lane contact, no reset', () => {
    const sim = createSim(defaultSessionConfig({ mode: 'race', aiCount: 9, seed: 7, laps: 3, difficulty: 70, autodrive: true, trackId: 'ardennes' }), { skipLights: true });
    const cars = sim.world.state.cars;
    cars.forEach((c, k) => c.ai.plannedStopLaps.push(1 + (k % 2)));
    const t = run(sim, 420, () => cars.every((c) => c.race.lapsCompleted >= 3));
    expect(t.stops).toEqual(cars.map(() => 1));
    expect(t.walls).toBe(0);
    expect(t.resets).toBe(0);
  }, 900_000);
});
