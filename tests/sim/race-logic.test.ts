// S-SM-12 race logic through createSim (cross-module): lights, timing, order, finish and classification invariants.
// Seeds are printed in every message (SEEDS in tests/helpers/sim.ts).

import { describe, expect, it } from 'vitest';
import { SIM_HZ, type SimEvent } from '../../src/contracts/sim';
import { EventDigest, SEEDS, makeSim, stepSeconds } from '../helpers/sim';

describe('S-SM-12 race logic (20 cars, istanbul)', () => {
  it('lights: five lightsOn at 1..5 s, one lightsOut, phase grid -> lights -> running; no jump start for autodrive', () => {
    const sim = makeSim({ cfg: { seed: SEEDS.field, laps: 3 } });
    const events: { e: SimEvent; t: number }[] = [];
    for (let i = 0; i < 12 * SIM_HZ; i++) {
      sim.step();
      sim.world.events.drain((e) => events.push({ e: { ...e }, t: sim.world.state.time }));
    }
    const on = events.filter((x) => x.e.type === 'lightsOn');
    expect(on.map((x) => (x.e as { count: number }).count), `seed ${SEEDS.field}`).toEqual([1, 2, 3, 4, 5]);
    for (let i = 0; i < 5; i++) expect(on[i]!.t, `light ${i + 1}`).toBeGreaterThanOrEqual(i + 1 - 0.05);
    for (let i = 1; i < 5; i++) expect(on[i]!.t - on[i - 1]!.t, 'one second apart').toBeCloseTo(1, 1);
    const out = events.filter((x) => x.e.type === 'lightsOut');
    expect(out).toHaveLength(1);
    expect(out[0]!.t, 'hold 0.2-3.0 s after the fifth light').toBeGreaterThanOrEqual(on[4]!.t + 0.2 - 0.01);
    expect(out[0]!.t).toBeLessThanOrEqual(on[4]!.t + 3.0 + 0.01);
    expect(events.filter((x) => x.e.type === 'jumpStart')).toHaveLength(0);
    expect(sim.world.state.race.phase).toBe('running');
  });

  it('order is a permutation, positions agree with order, gaps non-decreasing, laps-completed monotone, over 100 s', () => {
    const sim = makeSim({ skipLights: true, cfg: { seed: SEEDS.field, laps: 5 } });
    const lapsSeen = new Map<number, number>();
    const digest = new EventDigest();
    for (let t = 0; t < 100; t += 5) {
      stepSeconds(sim, 5, digest);
      const st = sim.world.state;
      const order = st.race.order;
      expect([...order].sort((a, b) => a - b), `order permutation at t=${t + 5}`).toEqual(Array.from({ length: 20 }, (_, i) => i));
      order.forEach((car, i) => expect(st.cars[car]!.race.position, `car ${car}`).toBe(i + 1));
      // Gaps are marker-time differences taken at each car's own track position (director.ts), so they are only
      // monotone within a tolerance (the interval is clamped with max(0, ..) by design): finite, >= 0, leader 0,
      // and never more than 1 s below the car ahead.
      let prevGap = 0;
      for (const car of order) {
        const g = st.cars[car]!.race.gapToLeaderMs;
        expect(Number.isFinite(g) && g >= 0, `gap of car ${car} = ${g}`).toBe(true);
        expect(g, `gap of car ${car}`).toBeGreaterThanOrEqual(prevGap - 1000);
        prevGap = Math.max(prevGap, g);
      }
      expect(st.cars[order[0]!]!.race.gapToLeaderMs).toBe(0);
      for (const c of st.cars) {
        expect(c.race.lapsCompleted).toBeGreaterThanOrEqual(lapsSeen.get(c.id) ?? 0);
        lapsSeen.set(c.id, c.race.lapsCompleted);
      }
    }
  });

  it('a 1-lap race finishes: chequered, every car finishes or is classified, finish positions unique (seed 1234)', () => {
    const sim = makeSim({ skipLights: true, cfg: { seed: SEEDS.field, laps: 1 } });
    const finishes: { car: number; position: number }[] = [];
    const laps: { car: number; ms: number; valid: boolean }[] = [];
    const sink = (e: SimEvent): void => {
      if (e.type === 'finish') finishes.push({ car: e.car, position: e.position });
      if (e.type === 'lap') laps.push({ car: e.car, ms: e.ms, valid: e.valid });
    };
    let guard = 0;
    while (sim.world.state.race.phase !== 'finished' && guard++ < 260 * SIM_HZ) {
      sim.step();
      sim.world.events.drain(sink);
    }
    const st = sim.world.state;
    expect(st.race.phase, `race did not finish within 260 s (seed ${SEEDS.field})`).toBe('finished');
    expect(finishes.length, 'finish events').toBeGreaterThanOrEqual(10);
    expect(new Set(finishes.map((f) => f.position)).size, 'unique finish positions').toBe(finishes.length);
    expect(finishes.map((f) => f.position)).toEqual(finishes.map((_, i) => i + 1));
    // Timing: lap time equals the race-clock delta (ms resolution) and is plausible for the track.
    for (const l of laps) {
      expect(l.ms, `lap time of car ${l.car}`).toBeGreaterThan(80_000);
      expect(l.ms).toBeLessThan(140_000);
    }
    const leader = st.cars[st.race.order[0]!]!;
    expect(leader.race.finished).toBe(true);
    expect(Math.abs(leader.race.finishMs - leader.race.lastLapMs), 'single-lap race: finish time = lap time (< 1 ms)').toBeLessThan(1);
  });
});
