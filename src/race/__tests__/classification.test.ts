// Rules §9: classification order, penalties in the classification time, points, DNF, projections.

import { describe, expect, it } from 'vitest';
import { createSim, defaultSessionConfig } from '../../game/createSim';
import { buildResults } from '../../game/results';
import { TEAMS } from '../../data/teams';
import { createStraightTrack } from '../../track/index';
import { classify, pointsForPosition } from '../classification';
import { crx } from '../extra';
import { retireCar } from '../penalties';

function finishedWorld() {
  const sim = createSim(defaultSessionConfig({ aiCount: 11, laps: 3 }), { track: createStraightTrack(1000), skipLights: true });
  const w = sim.world;
  w.state.race.phase = 'finished';
  w.state.race.raceMs = 300_000;
  w.state.cars.forEach((c, i) => {
    c.race.finished = true;
    c.race.status = 'finished';
    c.race.lapsCompleted = 3;
    c.race.finishMs = 200_000 + i * 1000;
    c.race.bestLapMs = 60_000 + i;
  });
  return { sim, w };
}

describe('classification (rules §9)', () => {
  it('orders by laps then classification time; unserved + two-compound penalties count; 25-18-15-12-10-8-6-4-2-1', () => {
    const { sim, w } = finishedWorld();
    const cars = w.state.cars;
    cars[0]!.race.penaltyToServeSec = 5; // 200.0 + 5 = 205.0, tied with car 5
    crx(cars[0]!.race).gridProg = 5;
    crx(cars[5]!.race).gridProg = 10; // car 5 started further up the grid → wins the tie
    crx(cars[1]!.race).twoCompoundSec = 30; // 201 + 30 → 231 s
    cars[11]!.race.lapsCompleted = 2; // lapped
    const res = classify(w);
    const order = res.map((r) => r.car);
    expect(order.indexOf(5)).toBe(3);
    expect(order.indexOf(0)).toBe(4);
    expect(order.indexOf(1)).toBe(10);
    expect(order[11]).toBe(11);
    expect(res[11]!.lapsDown).toBe(1);
    expect(res.slice(0, 10).map((r) => r.points)).toEqual([25, 18, 15, 12, 10, 8, 6, 4, 2, 1]);
    expect(res[10]!.points).toBe(0);
    expect(pointsForPosition(11)).toBe(0);
    for (let i = 1; i < 11; i++) expect(res[i]!.gapMs).toBeGreaterThanOrEqual(res[i - 1]!.gapMs);
    w.state.race.fastest = { car: 3, ms: 60_003 };
    const model = buildResults(sim, TEAMS);
    expect(model.rows).toHaveLength(12);
    expect(model.fastestCar).toBe(3);
    expect(model.rows.map((r) => r.pos)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it('retired player: dnf at the bottom with 0 points; running cars projected in their current order', () => {
    const sim = createSim(defaultSessionConfig({ aiCount: 4, laps: 5 }), { track: createStraightTrack(1000), skipLights: true });
    const w = sim.world;
    w.state.race.raceMs = 100_000;
    w.state.race.order = [3, 1, 0, 2, 4];
    w.state.cars.forEach((c, i) => {
      c.race.lapsCompleted = 1;
      c.race.progress = 1500 - [2, 1, 3, 0, 4][i]! * 50;
      c.race.lastLapMs = 61_000;
      c.race.bestLapMs = 61_000;
    });
    const ev: string[] = [];
    retireCar(w, 0);
    w.events.drain((e) => ev.push(e.type));
    expect(ev).toEqual(['retired']);
    const res = classify(w);
    expect(res.map((r) => r.car)).toEqual([3, 1, 2, 4, 0]);
    expect(res[4]!.status).toBe('dnf');
    expect(res[4]!.points).toBe(0);
    expect(res.slice(0, 4).every((r) => r.projected)).toBe(true);
    expect(res[0]!.totalMs).toBeGreaterThan(100_000);
  });
});
