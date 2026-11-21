// User bugs 2026-10-26: (1) "AI makes illegal overtakes behind the safety car": while the SC is out (deployed, and coming in
// until the leader takes the line: race/safetyCar.ts noteScPass gives +5 s for any gain over a racing car then) the AI must
// hold its place in the queue. (2) A car stalled on the grid (an absent online player) with the SC out kept the field stuck
// behind it: a stopped car must be driven round, SC or not.

import { describe, expect, it } from 'vitest';
import { createSim, defaultSessionConfig } from '../../game/createSim';
import { retireCar } from '../../race/penalties';
import { loadTrack } from '../../track/index';

type Tid = 'istanbul' | 'lombardia' | 'ardennes';

function ready(id: Tid): boolean {
  try {
    return loadTrack(id).data.id === id;
  } catch {
    return false;
  }
}

/** The last car retires on track at 60 s and brings the SC out (as safetyCar.test). Counts order swaps between two racing
 * cars (both on the main road, not pitting, > 15 m/s) while the SC is out, from 2 s after the deployment (a pass already
 * completing as the SC is called cannot be undone), and SC-overtake penalties over the whole SC period. */
function scRace(trackId: Tid, seed: number): { deployed: boolean; swaps: number; scPen: number; finished: number } {
  const sim = createSim(defaultSessionConfig({ mode: 'race', aiCount: 19, laps: 4, autodrive: true, trackId, seed, difficulty: 55 }));
  const w = sim.world;
  const cars = w.state.cars;
  const n = cars.length;
  const sign = new Int8Array(n * n);
  let retired = -1;
  let deployedMs = -1;
  let swaps = 0;
  let scPen = 0;
  let finished = 0;
  while (w.state.race.phase !== 'finished' && w.state.race.raceMs < 900_000) {
    sim.step();
    if (retired < 0 && w.state.race.raceMs >= 60_000) {
      retired = w.state.race.order[w.state.race.order.length - 1]!;
      retireCar(w, retired);
    }
    w.events.drain((e) => {
      if (e.type === 'penalty' && e.reason === 'safetyCar') scPen++;
      if (e.type === 'finish') finished++;
    });
    const sc = w.state.race.sc.phase;
    if (sc === 'none') {
      sign.fill(0);
      continue;
    }
    if (deployedMs < 0) deployedMs = w.state.race.raceMs;
    if ((w.state.tick & 3) !== 0 || w.state.race.raceMs < deployedMs + 2000) continue;
    for (let a = 0; a < n; a++) {
      const ca = cars[a]!;
      const okA = ca.race.status === 'running' && !ca.race.finished && ca.pit.phase === 'none' && ca.vehicle.hint.ribbon === 'main' && ca.vehicle.speed > 15;
      for (let b = a + 1; b < n; b++) {
        const cb = cars[b]!;
        const k = a * n + b;
        const okB = cb.race.status === 'running' && !cb.race.finished && cb.pit.phase === 'none' && cb.vehicle.hint.ribbon === 'main' && cb.vehicle.speed > 15;
        if (!okA || !okB) {
          sign[k] = 0;
          continue;
        }
        const s = ca.race.progress > cb.race.progress ? 1 : -1;
        if (sign[k] !== 0 && sign[k] !== s) swaps++;
        sign[k] = s;
      }
    }
  }
  return { deployed: deployedMs >= 0, swaps, scPen, finished };
}

for (const tid of ['lombardia', 'ardennes'] as const) {
  describe.skipIf(!ready(tid))(`AI holds its place under the safety car (${tid})`, () => {
    it('20 cars, SC out: no position changes among racing cars, no SC-overtake penalty, all finish', () => {
      const r = scRace(tid, 1234);
      expect(r.deployed).toBe(true);
      expect(r.swaps).toBe(0);
      expect(r.scPen).toBe(0);
      expect(r.finished).toBe(19);
    }, 900_000);
  });
}

describe.skipIf(!ready('istanbul'))('a car stalled on the grid is driven round (SC or not)', () => {
  it('car 9 never moves: every other car gets round it, no deadlock, no contact', () => {
    const sim = createSim(defaultSessionConfig({ mode: 'race', aiCount: 19, laps: 3, autodrive: true, trackId: 'istanbul', seed: 1234, difficulty: 55 }));
    const w = sim.world;
    const cars = w.state.cars;
    // An absent online player's car: a kinematic puppet that stays on its grid slot.
    const stalled = cars[9]!;
    stalled.control = 'remote';
    let hits = 0;
    let scSeen = false;
    while (w.state.race.raceMs < 45_000 && w.state.race.phase !== 'finished') {
      sim.step();
      if (w.state.race.sc.phase !== 'none') scSeen = true;
      w.events.drain((e) => {
        if (e.type === 'collision' && (e.a === stalled.id || e.b === stalled.id)) hits++;
      });
    }
    // Lights out ≈ 9 s: by 45 s every other car is past 300 m (the last ones round it ~15 s after the start).
    const behind = cars.filter((c) => c !== stalled && c.race.progress < 300);
    void scSeen;
    expect(behind.map((c) => c.id)).toEqual([]);
    expect(hits).toBe(0);
  }, 600_000);
});
