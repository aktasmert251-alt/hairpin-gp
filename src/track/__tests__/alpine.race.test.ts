// Alpine Pass full race (D-063): a 20-car AI field (player on autodrive) runs a 3-lap race with one planned stop per car
// through the alpine pit lane (entry on the T14–T15 straight, exit on the lake straight) and the tunnel; every car
// finishes, makes its stop, and nobody touches the pit-lane walls or needs a reset.

import { expect, it } from 'vitest';
import { createSim, defaultSessionConfig } from '../../game/createSim';

const HZ = 240;

it('alpine: 20-car AI race, 3 laps, one stop each: all finish, no pit-lane contact, no reset', () => {
  const sim = createSim(defaultSessionConfig({ mode: 'race', aiCount: 19, seed: 1234, laps: 3, difficulty: 70, autodrive: true, trackId: 'alpine' }), { skipLights: true });
  const w = sim.world;
  const cars = w.state.cars;
  expect(w.static.track.data.id).toBe('alpine');
  cars.forEach((c, k) => c.ai.plannedStopLaps.push(1 + (k % 2)));
  const stops = cars.map(() => 0);
  let pitWalls = 0, resets = 0;
  for (let i = 0; i < 480 * HZ && w.state.race.phase !== 'finished'; i++) {
    sim.step();
    w.events.drain((e) => {
      if (e.type === 'collision' && e.b < 0 && cars[e.a]!.pit.phase !== 'none') pitWalls++;
      if (e.type === 'carReset' && !cars[e.car]!.race.finished) resets++;
      if (e.type === 'pit' && e.phase === 'stationary') stops[e.car]!++;
    });
  }
  const finished = cars.filter((c) => c.race.finished).length;
  console.log(`alpine race: ${finished}/20 finished in ${(w.state.race.raceMs / 1000).toFixed(1)} s, stops ${stops.join('')}, pit-wall hits ${pitWalls}, resets ${resets}`);
  expect(finished).toBe(20);
  expect(stops).toEqual(cars.map(() => 1));
  expect(pitWalls).toBe(0);
  expect(resets).toBe(0);
}, 1_200_000);

it('alpine: 20 cars stay deterministic for 20 s (same seed → same hash)', () => {
  const mk = () => createSim(defaultSessionConfig({ mode: 'race', aiCount: 19, seed: 99, laps: 3, difficulty: 70, autodrive: true, trackId: 'alpine' }), { skipLights: true });
  const a = mk(), b = mk();
  for (let i = 0; i < 20 * HZ; i++) { a.step(); b.step(); }
  expect(a.hash()).toBe(b.hash());
}, 300_000);
