// Volcano Rim full race (docs/design/tracks-volcano.md): a 20-car AI field (player on autodrive) runs a 3-lap race
// with one planned stop per car through the pit lane round the outside of T21; every car finishes, makes its stop,
// nobody touches the pit-lane walls and nobody needs a reset: the AI never goes over the edge of the two rim fall zones
// (T10, T11) and copes with the ash drifts. Overtakes are counted per braking zone (T1, T9, T12, T13).

import { expect, it } from 'vitest';
import { createSim, defaultSessionConfig } from '../../game/createSim';
import { getTrackExtras } from '../build/extras';

const HZ = 240;

it('volcano: 20-car AI race, 3 laps, one stop each: all finish, no pit-lane contact, no reset', () => {
  const sim = createSim(defaultSessionConfig({ mode: 'race', aiCount: 19, seed: 1234, laps: 3, difficulty: 70, autodrive: true, trackId: 'volcano' }), { skipLights: true });
  const w = sim.world;
  const cars = w.state.cars;
  const data = w.static.track.data;
  const q = w.static.track.query;
  expect(data.id).toBe('volcano');
  cars.forEach((c, k) => c.ai.plannedStopLaps.push(1 + (k % 2)));
  const stops = cars.map(() => 0);
  let pitWalls = 0, resets = 0, walls = 0;
  // Overtakes: position swaps between two cars within ±150 m before a corner apex .. 60 m after it (racing, not pits).
  const zones = [1, 9, 12, 13].map((n) => data.corners.find((c) => c.n === n)!);
  const passes = zones.map(() => 0);
  let allPasses = 0;
  let prev: number[] = cars.map((c) => c.race.position);
  for (let i = 0; i < 480 * HZ && w.state.race.phase !== 'finished'; i++) {
    sim.step();
    w.events.drain((e) => {
      if (e.type === 'collision' && e.b < 0) {
        walls++;
        if (cars[e.a]!.pit.phase !== 'none') pitWalls++;
      }
      if (e.type === 'carReset' && !cars[e.car]!.race.finished) resets++;
      if (e.type === 'pit' && e.phase === 'stationary') stops[e.car]!++;
    });
    if (w.state.race.phase !== 'running' || i % 24 !== 0) continue;
    const pos = cars.map((c) => c.race.position);
    cars.forEach((c, k) => {
      if (pos[k]! >= prev[k]! || c.pit.phase !== 'none' || c.race.lapsCompleted < 1) return;
      allPasses++;
      const z = zones.findIndex((cn) => { const ds = q.deltaS(cn.apexS, c.vehicle.s); return ds > -150 && ds < 60; });
      if (z >= 0) passes[z]!++;
    });
    prev = pos;
  }
  const finished = cars.filter((c) => c.race.finished).length;
  console.log(`volcano race: ${finished}/20 finished in ${(w.state.race.raceMs / 1000).toFixed(1)} s, stops ${stops.join('')}, pit-wall hits ${pitWalls}, wall contacts ${walls}, resets ${resets}; passes ${allPasses} (T1 ${passes[0]} T9 ${passes[1]} T12 ${passes[2]} T13 ${passes[3]})`);
  expect(finished).toBe(20);
  expect(stops).toEqual(cars.map(() => 1));
  expect(pitWalls).toBe(0);
  expect(resets).toBe(0);
}, 1_200_000);

it('volcano: a car pushed over the rim edge in a fall zone is reset onto the track', () => {
  const sim = createSim(defaultSessionConfig({ mode: 'timeTrial', aiCount: 0, autodrive: true, seed: 3, trackId: 'volcano' }), { skipLights: true });
  const w = sim.world;
  const data = w.static.track.data;
  const fz = getTrackExtras(data)!.falls[0]!;
  for (let i = 0; i < 2 * HZ; i++) sim.step();
  const v = w.state.cars[0]!.vehicle;
  const s = (fz.from + fz.to) / 2;
  const wall = fz.side > 0 ? data.wallL[Math.round(s)]! : data.wallR[Math.round(s)]!;
  const p = { x: 0, y: 0, z: 0 };
  w.static.track.query.worldFromSD(s, fz.side * (wall + 6), p);
  v.x = p.x; v.z = p.z; v.s = s; v.d = fz.side * (wall + 6); v.hint.s = s;
  let resets = 0;
  for (let i = 0; i < 10; i++) {
    sim.step();
    w.events.drain((e) => { if (e.type === 'carReset') resets++; });
  }
  expect(resets).toBe(1);
  expect(Math.abs(v.d)).toBeLessThan(wall);
});

it('volcano: 20 cars stay deterministic for 20 s (same seed → same hash)', () => {
  const mk = () => createSim(defaultSessionConfig({ mode: 'race', aiCount: 19, seed: 99, laps: 3, difficulty: 70, autodrive: true, trackId: 'volcano' }), { skipLights: true });
  const a = mk(), b = mk();
  for (let i = 0; i < 20 * HZ; i++) { a.step(); b.step(); }
  expect(a.hash()).toBe(b.hash());
}, 300_000);
