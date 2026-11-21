// Eifel Forest Ring race (docs/design/tracks-eifel.md §10): the default race field (11 AI + the player on autodrive)
// runs 2 laps of the ≈ 20 km ring, half the field making one stop through the GP-loop pit lane. Every car finishes,
// nobody needs a reset or touches the pit walls, and over the crests and compressions the vertical load stays inside
// the envelope: the hump and the plateau crests are taken flat and go light (mechanical g + v²·κv may dip just below 0
// at 330 km/h, a 'jump' the downforce holds down), but the tyres' total load never drops under 0.5 g and compressions
// stay under 2.6 g mechanical.

import { expect, it } from 'vitest';
import { createSim, defaultSessionConfig } from '../../game/createSim';
import { RACE_TRACK_INFO } from '../../data/tracks';

const HZ = 240;
const G = 9.81;

it('eifel: 12-car AI race, 2 laps, stops for half the field: all finish, no reset, vertical load in the envelope', () => {
  const ai = RACE_TRACK_INFO.eifel.maxAi!;
  const sim = createSim(defaultSessionConfig({ mode: 'race', aiCount: ai, seed: 4321, laps: 2, difficulty: 70, autodrive: true, trackId: 'eifel' }), { skipLights: true });
  const w = sim.world;
  const cars = w.state.cars;
  const q = w.static.track.query;
  expect(w.static.track.data.id).toBe('eifel');
  expect(cars).toHaveLength(ai + 1);
  cars.forEach((c, k) => { if (k % 2 === 0) c.ai.plannedStopLaps.push(1); });
  const stops = cars.map(() => 0);
  let pitWalls = 0, resets = 0, lo = Infinity, hi = 0, tyreLo = Infinity;
  const f = {} as Parameters<typeof q.frameAt>[1];
  for (let i = 0; i < 700 * HZ && w.state.race.phase !== 'finished'; i++) {
    sim.step();
    w.events.drain((e) => {
      if (e.type === 'collision' && e.b < 0 && cars[e.a]!.pit.phase !== 'none') pitWalls++;
      if (e.type === 'carReset' && !cars[e.car]!.race.finished) resets++;
      if (e.type === 'pit' && e.phase === 'stationary') stops[e.car]!++;
    });
    if (i % 24 !== 0) continue;
    for (const c of cars) {
      const v = c.vehicle;
      if (c.race.finished || v.hint.ribbon !== 'main' || v.speed < 20) continue;
      const kv = q.frameAt(v.s, f).vCurvature;
      const n = (G + v.speed * v.speed * kv) / G;
      lo = Math.min(lo, n);
      hi = Math.max(hi, n);
      const m = v.massKg;
      tyreLo = Math.min(tyreLo, v.wheels.reduce((a, wh) => a + wh.load, 0) / (m * G));
    }
  }
  const finished = cars.filter((c) => c.race.finished).length;
  console.log(`eifel race: ${finished}/${cars.length} finished in ${(w.state.race.raceMs / 1000).toFixed(1)} s, stops ${stops.join('')}, pit-wall hits ${pitWalls}, resets ${resets}, vertical load ${lo.toFixed(2)}…${hi.toFixed(2)} g mechanical, tyre load ≥ ${tyreLo.toFixed(2)} g`);
  expect(finished).toBe(cars.length);
  expect(stops).toEqual(cars.map((_, k) => (k % 2 === 0 ? 1 : 0)));
  expect(pitWalls).toBe(0);
  expect(resets).toBe(0);
  expect(lo).toBeGreaterThanOrEqual(-0.3);
  expect(tyreLo).toBeGreaterThanOrEqual(0.5);
  expect(hi).toBeLessThanOrEqual(2.6);
}, 1_800_000);

it('eifel: the field stays deterministic for 20 s (same seed → same hash)', () => {
  const mk = () => createSim(defaultSessionConfig({ mode: 'race', aiCount: 11, seed: 99, laps: 1, difficulty: 70, autodrive: true, trackId: 'eifel' }), { skipLights: true });
  const a = mk(), b = mk();
  for (let i = 0; i < 20 * HZ; i++) { a.step(); b.step(); }
  expect(a.hash()).toBe(b.hash());
}, 300_000);
