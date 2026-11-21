// S2-S7 AI strategy (testing-qc S-SM-10, S-SM-14) through createSim with the real PitProcedure and ConditionsSystem.
// S-SM-10: 15-lap dry race, 20 cars: every AI stops at least once, every AI uses two dry compounds, nobody is stuck in
// the pit (deadlock), all finish. S-SM-14: variable weather: a rain spell occurs and every running AI car on slicks
// is on Inters / Wets within 2 laps of line wetness reaching 0.18.

import { describe, expect, it } from 'vitest';
import type { Compound } from '../../contracts/common';
import { createSim, defaultSessionConfig } from '../../game/createSim';
import { MODULE_STATUS as TRACK_STATUS, loadTrack } from '../../track/index';

const HZ = 240;
const istanbulReady = TRACK_STATUS !== 'stub' && loadTrack().data.id === 'istanbul' && loadTrack().data.pit.count > 1;
const DRY: Compound[] = ['soft', 'medium', 'hard'];

describe.skipIf(!istanbulReady)('AI strategy (S-SM-10, S-SM-14)', () => {
  it('S-SM-10: 15-lap dry race: everyone stops, two dry compounds each, no pit deadlock, all finish', () => {
    const sim = createSim(defaultSessionConfig({ mode: 'race', aiCount: 19, seed: 11, laps: 15, difficulty: 70, autodrive: true }));
    const w = sim.world;
    const cars = w.state.cars;
    const used = cars.map((c) => new Set<Compound>([c.vehicle.compound]));
    const stops = new Array<number>(cars.length).fill(0);
    const pitT = new Array<number>(cars.length).fill(0);
    let maxPitT = 0;
    let finished = 0;
    for (let i = 0; i < 15 * 130 * HZ && w.state.race.phase !== 'finished'; i++) {
      sim.step();
      w.events.drain((e) => {
        if (e.type === 'pit' && e.phase === 'stationary') stops[e.car]!++;
        if (e.type === 'finish') finished++;
      });
      for (const c of cars) {
        used[c.id]!.add(c.vehicle.compound);
        pitT[c.id] = c.pit.phase !== 'none' && c.pit.phase !== 'requested' ? pitT[c.id]! + 1 / HZ : 0;
        if (pitT[c.id]! > maxPitT) maxPitT = pitT[c.id]!;
      }
    }
    const dryUsed = used.map((u) => DRY.filter((d) => u.has(d)).length);
    console.log(`S-SM-10: stops ${stops.join('')}, dry compounds per car ${dryUsed.join('')}, longest pit visit ${maxPitT.toFixed(1)} s, finished ${finished}`);
    expect(finished).toBe(20);
    expect(stops.every((n) => n >= 1)).toBe(true);
    expect(dryUsed.every((n) => n >= 2)).toBe(true);
    expect(maxPitT).toBeLessThan(60);
  }, 900_000);

  it('S-SM-14: variable weather: AI on Inters within 2 laps of line wetness 0.18', () => {
    const sim = createSim(defaultSessionConfig({ mode: 'race', aiCount: 19, seed: 3, laps: 15, difficulty: 70, autodrive: true, weather: 'variable' }));
    const w = sim.world;
    const cars = w.state.cars;
    const c = w.state.conditions;
    let wetLap = -1;
    const onSlicksAtWet: boolean[] = new Array<boolean>(cars.length).fill(false);
    const switchLap = new Array<number>(cars.length).fill(-1);
    let maxW = 0;
    for (let i = 0; i < 15 * 140 * HZ && w.state.race.phase !== 'finished'; i++) {
      sim.step();
      w.events.drain(() => {});
      if (w.state.race.phase !== 'running') continue;
      if (c.lineWetness > maxW) maxW = c.lineWetness;
      const leaderLaps = Math.max(...cars.map((x) => x.race.lapsCompleted));
      if (wetLap < 0 && c.lineWetness >= 0.18) {
        wetLap = leaderLaps;
        for (const x of cars) onSlicksAtWet[x.id] = DRY.includes(x.vehicle.compound) && !x.race.finished;
      }
      if (wetLap >= 0) {
        for (const x of cars) if (switchLap[x.id]! < 0 && !DRY.includes(x.vehicle.compound)) switchLap[x.id] = x.race.lapsCompleted;
        // Two laps after the threshold (and the line still wet): stop watching.
        if (leaderLaps > wetLap + 3) break;
      }
    }
    const late = cars.filter((x) => onSlicksAtWet[x.id] && !x.race.finished && x.race.lapsCompleted > wetLap + 2 && (switchLap[x.id]! < 0 || switchLap[x.id]! > wetLap + 2));
    console.log(`S-SM-14: max line W ${maxW.toFixed(2)}, W ≥ 0.18 on lap ${wetLap}, switched ${switchLap.filter((l) => l >= 0).length}/${cars.length} (laps ${switchLap.join(',')}), late ${late.length}`);
    expect(wetLap).toBeGreaterThanOrEqual(0);
    expect(late.length).toBe(0);
  }, 900_000);
});
