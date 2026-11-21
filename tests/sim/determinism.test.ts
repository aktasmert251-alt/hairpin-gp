// S-SM-01 determinism and its plumbing (testing-qc.md §2.3). Runs on whatever modules are real (MODULE_STATUS) and must already
// pass on stubs; once physics + AI are real (hand-off H4) the extra "real field" checks switch on automatically.
//
// Reproduce a failure with the seed printed in the message (tests/helpers/sim.ts SEEDS).

import { describe, expect, it } from 'vitest';
import { SIM_HZ } from '../../src/contracts/sim';
import { aiReal, physicsReal, readinessSummary, simReal, trackReal } from '../helpers/readiness';
import { EventDigest, SEEDS, assertFinite, hashState, makeSim, stepSeconds, stepTicks } from '../helpers/sim';

describe(`S-SM-01 determinism (${readinessSummary()})`, () => {
  it(`S-SM-01 full field: 20 cars, seed ${SEEDS.field}, 60 s, run twice -> equal hash() at every 10 s checkpoint and equal event digest`, () => {
    const a = makeSim({ skipLights: true });
    const b = makeSim({ skipLights: true });
    expect(a.world.state.cars).toHaveLength(20);
    expect(a.hash(), `identical at t=0 (seed ${SEEDS.field})`).toBe(b.hash());
    const ea = new EventDigest();
    const eb = new EventDigest();
    for (let t = 10; t <= 60; t += 10) {
      stepSeconds(a, 10, ea);
      stepSeconds(b, 10, eb);
      expect(a.hash(), `hash diverged by t=${t} s (seed ${SEEDS.field}, tick ${a.world.state.tick})`).toBe(b.hash());
      assertFinite(a, `t=${t} s`);
    }
    expect(a.world.state.time).toBeCloseTo(60, 6);
    expect(ea.value, 'event digest').toBe(eb.value);
    expect(ea.count, 'event count').toBe(eb.count);
  });

  it('with the start lights: grid -> lights -> running is deterministic and ends in the running phase', () => {
    const a = makeSim({ cfg: { seed: SEEDS.other } });
    const b = makeSim({ cfg: { seed: SEEDS.other } });
    expect(a.world.state.race.phase).toBe('grid');
    const ea = new EventDigest();
    const eb = new EventDigest();
    stepSeconds(a, 20, ea);
    stepSeconds(b, 20, eb);
    expect(a.hash(), `seed ${SEEDS.other}`).toBe(b.hash());
    expect(ea.value).toBe(eb.value);
    expect(ea.types.get('lightsOn'), 'five light events').toBe(5);
    expect(ea.types.get('lightsOut'), 'lights out once').toBe(1);
    expect(a.world.state.race.phase).toBe('running');
  });

  it('hash() is sensitive: different seeds differ, and the hash changes as the sim advances', () => {
    const a = makeSim({ skipLights: true });
    const b = makeSim({ skipLights: true, cfg: { seed: SEEDS.other } });
    expect(a.hash(), 'different seeds give different initial states').not.toBe(b.hash());
    const h0 = a.hash();
    stepTicks(a, 1);
    const h1 = a.hash();
    stepSeconds(a, 2);
    expect(h1).not.toBe(h0);
    expect(a.hash()).not.toBe(h1);
    expect(a.hash(), 'hash() is pure (same state, same value)').toBe(a.hash());
    expect(a.hash()).toBe(hashState(a.world.state));
  });

  it('no module-level mutable state: two sims stepped interleaved equal two sims stepped one after the other', () => {
    const ticks = SIM_HZ * 8;
    const seq1 = makeSim({ skipLights: true });
    const seq2 = makeSim({ skipLights: true, cfg: { seed: SEEDS.other } });
    stepTicks(seq1, ticks);
    stepTicks(seq2, ticks);

    const i1 = makeSim({ skipLights: true });
    const i2 = makeSim({ skipLights: true, cfg: { seed: SEEDS.other } });
    for (let i = 0; i < ticks; i++) {
      i1.step();
      i2.step();
      if ((i & 63) === 0) {
        i1.world.events.drain(() => {});
        i2.world.events.drain(() => {});
      }
    }
    expect(i1.hash(), `sim 1 (seed ${SEEDS.field}) must not depend on another sim running in between`).toBe(seq1.hash());
    expect(i2.hash(), `sim 2 (seed ${SEEDS.other}) must not depend on another sim running in between`).toBe(seq2.hash());
  });

  it('time-trial (one car) is deterministic', () => {
    const cfg = { mode: 'timeTrial' as const, aiCount: 0, seed: SEEDS.tt };
    const a = makeSim({ skipLights: true, cfg });
    const b = makeSim({ skipLights: true, cfg });
    expect(a.world.state.cars).toHaveLength(1);
    stepSeconds(a, 20);
    stepSeconds(b, 20);
    expect(a.hash(), `seed ${SEEDS.tt}`).toBe(b.hash());
    assertFinite(a, 'time trial');
  });

  it('ticks advance state.tick and state.time by exactly 1/240 s', () => {
    const sim = makeSim({ skipLights: true, cfg: { aiCount: 3 } });
    stepTicks(sim, 240);
    expect(sim.world.state.tick).toBe(240);
    expect(sim.world.state.time).toBeCloseTo(1, 12);
    expect(SIM_HZ).toBe(240);
  });

  // ---- switch on with the real modules (hand-offs H1, H4) ------------------------------------------------------------------

  it.skipIf(!simReal)('[needs H4: physics + ai real] 20 cars all move: finite state and progress after 30 s, nobody reset more than twice', () => {
    const sim = makeSim({ skipLights: true });
    stepSeconds(sim, 30);
    assertFinite(sim, '30 s real field');
    const cars = sim.world.state.cars;
    const slow = cars.filter((c) => c.race.progress < 300).map((c) => `${c.id}:${c.race.progress.toFixed(0)} m`);
    expect(slow, `cars that covered < 300 m in 30 s (seed ${SEEDS.field}): ${slow.join(', ')}`).toEqual([]);
    const resets = cars.filter((c) => c.vehicle.resetCount > 2).map((c) => `${c.id}:${c.vehicle.resetCount}`);
    expect(resets, `cars reset more than twice in 30 s: ${resets.join(', ')}`).toEqual([]);
  });

  it.skipIf(!physicsReal)('[needs H4: physics real] the player on the autodrive profile accelerates away from the grid', () => {
    const sim = makeSim({ skipLights: true, cfg: { aiCount: 0, gridPos: 1 } });
    stepSeconds(sim, 6);
    const v = sim.world.state.cars[0]!.vehicle;
    expect(v.speed * 3.6, 'speed after 6 s of autodrive (km/h)').toBeGreaterThan(100);
  });

  it.skipIf(!aiReal)('[needs H4: ai real] AI line preparation does not leave NaN in the first second', () => {
    const sim = makeSim({ skipLights: true });
    stepSeconds(sim, 1);
    assertFinite(sim, 'ai first second');
  });

  it.skipIf(!trackReal)('[needs H1: Istanbul track] the default track is Istanbul and 20 cars stay deterministic on it for 20 s', () => {
    const a = makeSim({ skipLights: true });
    const b = makeSim({ skipLights: true });
    expect(a.world.static.track.data.id).toBe('istanbul');
    stepSeconds(a, 20);
    stepSeconds(b, 20);
    expect(a.hash()).toBe(b.hash());
    assertFinite(a, 'istanbul 20 s');
  });
});
