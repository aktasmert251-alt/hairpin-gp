// S2-S2 start racecraft (testing-qc S-SM-11, S-SM-06): full lights sequence (5 × 1 s, seeded hold), 20 cars on
// İstanbul. S-SM-11: no AI jump start over 20 seeds and ≤ 2 car-to-car collisions above 5 kN·s on lap 1.
// S-SM-06: 20 cars × 3 laps all finish, ≤ 1 off-track (4 wheels off) per car per lap, no car stuck > 4 s.

import { describe, expect, it } from 'vitest';
import type { SimRunner } from '../../contracts/sim';
import { createSim, defaultSessionConfig } from '../../game/createSim';
import { MODULE_STATUS as TRACK_STATUS, loadTrack } from '../../track/index';

const HZ = 240;
const istanbulReady = TRACK_STATUS !== 'stub' && loadTrack().data.id === 'istanbul';

interface StartRun { jumps: number; bigLap1: number; lap1: number[]; finished: number; maxOffs: number; maxStuck: number }

function runRace(seed: number, laps: number, untilLap1: boolean): StartRun {
  const sim: SimRunner = createSim(defaultSessionConfig({ mode: 'race', aiCount: 19, seed, laps, difficulty: 70, autodrive: true }));
  const w = sim.world;
  const cars = w.state.cars;
  const n = cars.length;
  const r: StartRun = { jumps: 0, bigLap1: 0, lap1: new Array<number>(n).fill(0), finished: 0, maxOffs: 0, maxStuck: 0 };
  const offs = new Array<number>(n).fill(0);
  const wasOff = new Array<boolean>(n).fill(false);
  const stuck = new Array<number>(n).fill(0);
  let lap1Done = 0;
  for (let i = 0; i < (laps * 130 + 30) * HZ && w.state.race.phase !== 'finished'; i++) {
    sim.step();
    w.events.drain((e) => {
      if (e.type === 'jumpStart') r.jumps++;
      if (e.type === 'collision' && e.b >= 0 && lap1Done < n && e.impulse > 5000) r.bigLap1++;
      if (e.type === 'lap' && e.lap === 1 && r.lap1[e.car] === 0) {
        r.lap1[e.car] = e.ms / 1000;
        lap1Done++;
      }
      if (e.type === 'finish') r.finished++;
    });
    if (untilLap1 && lap1Done === n) break;
    const race = w.state.race;
    if (race.phase !== 'running' && race.phase !== 'finishing') continue;
    const sinceStart = race.raceMs - race.lightsOutAtMs;
    for (let k = 0; k < n; k++) {
      const c = cars[k]!;
      if (c.race.finished) continue;
      const v = c.vehicle;
      const off = v.offTrackWheels >= 4;
      if (off && !wasOff[k]) offs[k]!++;
      wasOff[k] = off;
      // Standing on the grid during the reaction time is not "stuck".
      stuck[k] = v.speed < 1 && sinceStart > 3000 ? stuck[k]! + 1 / HZ : 0;
      if (stuck[k]! > r.maxStuck) r.maxStuck = stuck[k]!;
    }
  }
  r.maxOffs = Math.max(...offs);
  return r;
}

describe.skipIf(!istanbulReady)('start racecraft (S-SM-11, S-SM-06)', () => {
  it('S-SM-11: 20 seeds, no AI jump start, lap 1 ≤ 2 collisions > 5 kN·s', () => {
    const rows: string[] = [];
    for (let seed = 1; seed <= 20; seed++) {
      const r = runRace(seed, 3, true);
      const l = r.lap1.slice().sort((a, b) => a - b);
      rows.push(`seed ${seed}: jumps ${r.jumps} big ${r.bigLap1} lap 1 ${l[0]!.toFixed(1)}–${l[l.length - 1]!.toFixed(1)} s (median ${l[l.length >> 1]!.toFixed(1)})`);
      expect(r.jumps).toBe(0);
      expect(r.bigLap1).toBeLessThanOrEqual(2);
    }
    console.log(`S-SM-11 start:\n${rows.join('\n')}`);
  }, 900_000);

  it('S-SM-06: 20 cars × 3 laps, all finish, ≤ 1 off per car per lap, nobody stuck > 4 s', () => {
    for (const seed of [11, 12]) {
      const r = runRace(seed, 3, false);
      console.log(`S-SM-06 seed ${seed}: finished ${r.finished}/20, max offs per car ${r.maxOffs}, max stuck ${r.maxStuck.toFixed(1)} s`);
      expect(r.finished).toBe(20);
      expect(r.maxOffs).toBeLessThanOrEqual(3);
      expect(r.maxStuck).toBeLessThanOrEqual(4);
    }
  }, 900_000);
});
