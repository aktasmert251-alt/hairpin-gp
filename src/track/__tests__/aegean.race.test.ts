// Aegean Islands full race: a 20-car AI field (player on autodrive) runs a 3-lap race with one planned stop per car
// through the main-island pit lane; every car finishes, makes its stop, nobody touches the pit-lane walls or needs a
// reset, and over the cable-stayed bridge crest the summed wheel load stays between 0.3 g·m (no launch) and 6 g·m.

import { expect, it } from 'vitest';
import { createSim, defaultSessionConfig } from '../../game/createSim';
import { CABLE_BRIDGE } from '../authoring/aegean-ctrl';
import { getTrackExtras } from '../build/extras';

const HZ = 240;

it('aegean: 20-car AI race, 3 laps, one stop each: all finish, no pit-lane contact, no reset', () => {
  const sim = createSim(defaultSessionConfig({ mode: 'race', aiCount: 19, seed: 1234, laps: 3, difficulty: 70, autodrive: true, trackId: 'aegean' }), { skipLights: true });
  const w = sim.world;
  const cars = w.state.cars;
  expect(w.static.track.data.id).toBe('aegean');
  cars.forEach((c, k) => c.ai.plannedStopLaps.push(1 + (k % 2)));
  const stops = cars.map(() => 0);
  let pitWalls = 0, resets = 0, loMin = Infinity, loMax = 0;
  const sc = getTrackExtras(w.static.track.data)!.sScale;
  const r0 = CABLE_BRIDGE.from * sc, r1 = CABLE_BRIDGE.to * sc;
  for (let i = 0; i < 480 * HZ && w.state.race.phase !== 'finished'; i++) {
    sim.step();
    w.events.drain((e) => {
      if (e.type === 'collision' && e.b < 0 && cars[e.a]!.pit.phase !== 'none') pitWalls++;
      if (e.type === 'carReset' && !cars[e.car]!.race.finished) resets++;
      if (e.type === 'pit' && e.phase === 'stationary') stops[e.car]!++;
    });
    if (w.state.race.phase !== 'running' || (i & 7) !== 0) continue;
    for (const c of cars) {
      const v = c.vehicle;
      if (v.hint.ribbon !== 'main' || v.s < r0 || v.s > r1 || v.speed < 20) continue;
      const g = (v.wheels[0].load + v.wheels[1].load + v.wheels[2].load + v.wheels[3].load) / (v.massKg * 9.81);
      loMin = Math.min(loMin, g);
      loMax = Math.max(loMax, g);
    }
  }
  const finished = cars.filter((c) => c.race.finished).length;
  console.log(`aegean race: ${finished}/20 finished in ${(w.state.race.raceMs / 1000).toFixed(1)} s, stops ${stops.join('')}, pit-wall hits ${pitWalls}, resets ${resets}; bridge wheel load ${loMin.toFixed(2)}…${loMax.toFixed(2)} g·m`);
  expect(loMin).toBeGreaterThan(0.3);
  expect(loMax).toBeLessThan(6);
  expect(finished).toBe(20);
  expect(stops).toEqual(cars.map(() => 1));
  expect(pitWalls).toBe(0);
  expect(resets).toBe(0);
}, 1_200_000);

it('aegean: 20 cars stay deterministic for 20 s (same seed → same hash)', () => {
  const mk = () => createSim(defaultSessionConfig({ mode: 'race', aiCount: 19, seed: 99, laps: 3, difficulty: 70, autodrive: true, trackId: 'aegean' }), { skipLights: true });
  const a = mk(), b = mk();
  for (let i = 0; i < 20 * HZ; i++) { a.step(); b.step(); }
  expect(a.hash()).toBe(b.hash());
}, 300_000);
