// Sprint 4 new-track AI checks (tracks.md §2.11 / §3.11): racecraft regressions found on Lombardia / Bosphorus.

import { describe, expect, it } from 'vitest';
import { createSim, defaultSessionConfig } from '../../game/createSim';
import { loadTrack } from '../../track/index';

function trackReady(id: 'lombardia' | 'bosphorus'): boolean {
  try {
    return loadTrack(id).data.id === id;
  } catch {
    return false;
  }
}

describe.skipIf(!trackReady('bosphorus'))('new-track racecraft', () => {
  // Bosphorus seed 4, lap 1, T1 (half width 6.5 m): the packed field slows to a crawl and two cars stop side by side,
  // the outer one 1.2 m ahead and squeezed against the edge. It yielded to the inner one (cap = that car's speed
  // − 1.5 = 0) while the inner one followed it as "ahead" (2.1 m apart < corridor): both held the brakes until the
  // stuck reset, and the cars behind were reset too (10 resets).
  it('Bosphorus seed 4: no T1 deadlock on lap 1 (no stuck resets)', () => {
    const sim = createSim(defaultSessionConfig({ mode: 'race', aiCount: 19, seed: 4, laps: 3, difficulty: 70, autodrive: true, trackId: 'bosphorus' }));
    const w = sim.world;
    let resets = 0;
    while (w.state.race.raceMs < 60_000) {
      sim.step();
      w.events.drain((e) => {
        if (e.type === 'carReset') resets++;
      });
    }
    expect(resets).toBe(0);
  }, 120_000);
});

describe.skipIf(!trackReady('lombardia'))('new-track pit lane', () => {
  // Lombardia seed 2, every other car boxing on lap 2: a boxIn car swung from the fast lane across an exiting car
  // alongside in the working lane; both wedged 3 m past the box (outside the stop tolerance) and three cars never
  // finished (lane deadlock, no stuck reset in the pit lane).
  it('Lombardia seed 2, 10 cars boxing on lap 2: all stop once, all 20 finish', () => {
    const sim = createSim(defaultSessionConfig({ mode: 'race', aiCount: 19, seed: 2, laps: 3, difficulty: 70, autodrive: true, trackId: 'lombardia' }));
    const w = sim.world;
    const cars = w.state.cars;
    for (let k = 0; k < cars.length; k += 2) cars[k]!.ai.plannedStopLaps.push(2);
    const stops = new Array<number>(cars.length).fill(0);
    let finished = 0;
    while (w.state.race.phase !== 'finished' && w.state.race.raceMs < 420_000) {
      sim.step();
      w.events.drain((e) => {
        if (e.type === 'pit' && e.phase === 'stationary') stops[e.car]!++;
        if (e.type === 'finish') finished++;
      });
    }
    expect(stops.filter((n, k) => k % 2 === 0 && n === 1).length).toBe(10);
    expect(finished).toBe(20);
  }, 300_000);
});
