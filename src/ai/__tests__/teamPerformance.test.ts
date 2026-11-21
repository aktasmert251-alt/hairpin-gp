// User question 2026-10-26: "does car performance really differ between teams in Quick Race?". It does: createSim builds
// every car (the player's too) from its team's `perf` + D-036 `traits` (power, drag, downforce, grip, tyre care, ERS); online
// rooms set `equalCars` (D-058) and every car gets the field average. Measured 2026-10-26 (d100 perfect driver, alone,
// best of flying laps 2–3): best → worst team +1.96 % Lombardia, +1.74 % İstanbul, +1.47 % Bosphorus; Vortex (power / low
// drag) fastest on the straights, Meridian (low drag) quick at the end of a straight for a perf-0 car.

import { describe, expect, it } from 'vitest';
import { createSim, defaultSessionConfig } from '../../game/createSim';
import { loadTrack } from '../../track/index';

function ready(): boolean {
  try {
    return loadTrack('lombardia').data.id === 'lombardia';
  } catch {
    return false;
  }
}

/** The player's car of `team`, driven by the autodrive (perfect, d100) driver alone; best flying lap and top speed. */
function solo(team: string, equalCars = false): { lap: number; top: number; perf: number } {
  const sim = createSim(defaultSessionConfig({ mode: 'race', aiCount: 0, laps: 4, autodrive: true, trackId: 'lombardia', seed: 7, difficulty: 100, playerTeamId: team, startCompound: 'medium', equalCars }), { skipLights: true });
  const w = sim.world;
  const car = w.state.cars[0]!;
  const laps: number[] = [];
  let top = 0;
  for (let i = 0; i < 4 * 140 * 240 && laps.length < 3; i++) {
    sim.step();
    w.events.drain((e) => {
      if (e.type === 'lap' && e.car === 0) laps.push(e.ms / 1000);
    });
    if (laps.length >= 1 && car.vehicle.speed * 3.6 > top) top = car.vehicle.speed * 3.6;
  }
  expect(car.vehicle.resetCount).toBe(0);
  return { lap: Math.min(...laps.slice(1)), top, perf: w.static.params[0]!.teamPerf };
}

describe.skipIf(!ready())('team car performance (Quick Race)', () => {
  it('the player car carries its team performance; best → worst team is a real but fair spread', () => {
    const best = solo('vortex');
    const mid = solo('kestrel');
    const worst = solo('nova');
    expect(best.perf).toBeCloseTo(0.015, 5);
    expect(worst.perf).toBeCloseTo(-0.015, 5);
    expect(best.lap).toBeLessThan(mid.lap);
    expect(mid.lap).toBeLessThan(worst.lap);
    const spread = 100 * (worst.lap / best.lap - 1);
    expect(spread).toBeGreaterThan(0.8);
    expect(spread).toBeLessThan(2.5);
    expect(best.top).toBeGreaterThan(worst.top + 2);
  }, 300_000);

  it('online (equalCars, D-058): every team gets the same car', () => {
    const a = solo('vortex', true);
    const b = solo('nova', true);
    expect(a.perf).toBeCloseTo(b.perf, 9);
    expect(Math.abs(a.lap - b.lap)).toBeLessThan(0.05);
  }, 300_000);
});
