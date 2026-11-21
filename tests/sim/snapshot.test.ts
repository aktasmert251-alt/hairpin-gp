// S-SM-02 snapshot / restore (testing-qc.md §2.3) and the 10 Hz x 15 s flashback history that sits on top of it.
// Must pass on stubs; nothing here depends on physics or AI quality, only on deterministic replay.

import { describe, expect, it } from 'vitest';
import { SIM_HZ } from '../../src/contracts/sim';
import { readinessSummary } from '../helpers/readiness';
import { EventDigest, SEEDS, assertFinite, hashState, makeSim, stepSeconds, stepTicks } from '../helpers/sim';

describe(`S-SM-02 snapshot/restore (${readinessSummary()})`, () => {
  it(`S-SM-02 snapshot at 20 s -> run to 40 s -> restore -> run to 40 s -> equal hash (20 cars, seed ${SEEDS.snapshot})`, () => {
    const sim = makeSim({ skipLights: true, cfg: { seed: SEEDS.snapshot } });
    stepSeconds(sim, 20);
    const snap = sim.snapshot();
    const h20 = sim.hash();
    const events = new EventDigest();
    stepSeconds(sim, 20, events);
    const h40 = sim.hash();
    expect(h40, 'the sim moved on').not.toBe(h20);
    assertFinite(sim, 't=40 s');

    sim.restore(snap);
    expect(sim.world.state.tick).toBe(snap.tick);
    expect(sim.world.state.time).toBeCloseTo(20, 9);
    expect(sim.hash(), 'restoring brings back the exact state hash of t=20 s').toBe(h20);

    const replay = new EventDigest();
    stepSeconds(sim, 20, replay);
    expect(sim.hash(), `replayed run must reach the same t=40 s state (seed ${SEEDS.snapshot})`).toBe(h40);
    expect(replay.value, 'and emit the same events').toBe(events.value);
    expect(replay.count).toBe(events.count);
  });

  it('restore keeps the identity of live objects (systems may hold references into the state)', () => {
    const sim = makeSim({ skipLights: true, cfg: { aiCount: 5, seed: SEEDS.snapshot } });
    stepSeconds(sim, 3);
    const snap = sim.snapshot();
    const st = sim.world.state;
    const refs = { cars: st.cars, car0: st.cars[0]!, vehicle: st.cars[0]!.vehicle, wheels: st.cars[0]!.vehicle.wheels, race: st.race, order: st.race.order, conditions: st.conditions };
    stepSeconds(sim, 3);
    sim.restore(snap);
    expect(sim.world.state).toBe(st);
    expect(sim.world.state.cars).toBe(refs.cars);
    expect(sim.world.state.cars[0]).toBe(refs.car0);
    expect(sim.world.state.cars[0]!.vehicle).toBe(refs.vehicle);
    expect(sim.world.state.cars[0]!.vehicle.wheels).toBe(refs.wheels);
    expect(sim.world.state.race).toBe(refs.race);
    expect(sim.world.state.race.order).toBe(refs.order);
    expect(sim.world.state.conditions).toBe(refs.conditions);
  });

  it('a snapshot is independent of the live state: later steps do not change it, restoring twice gives the same state', () => {
    const sim = makeSim({ skipLights: true, cfg: { aiCount: 7, seed: SEEDS.snapshot } });
    stepSeconds(sim, 4);
    const snap = sim.snapshot();
    const snapHash = hashState(snap.state);
    expect(snapHash, 'snapshot state hashes like the live state at that moment').toBe(sim.hash());
    stepSeconds(sim, 6);
    expect(hashState(snap.state), 'snapshot content unchanged by later ticks (no aliasing with live objects)').toBe(snapHash);
    sim.restore(snap);
    const first = sim.hash();
    stepSeconds(sim, 2);
    sim.restore(snap);
    expect(sim.hash(), 'second restore gives the same state as the first').toBe(first);
    expect(hashState(snap.state), 'restore does not write into the snapshot').toBe(snapHash);
  });

  it('restore preserves the lights sequence: snapshot during `lights`, finish the sequence twice, same lights-out time', () => {
    const sim = makeSim({ cfg: { seed: SEEDS.other, aiCount: 9 } });
    stepSeconds(sim, 3.5);
    expect(['grid', 'lights']).toContain(sim.world.state.race.phase);
    const snap = sim.snapshot();
    const a = new EventDigest();
    stepSeconds(sim, 12, a);
    const outAt = sim.world.state.race.lightsOutAtMs;
    const hA = sim.hash();
    sim.restore(snap);
    const b = new EventDigest();
    stepSeconds(sim, 12, b);
    expect(sim.world.state.race.lightsOutAtMs).toBe(outAt);
    expect(sim.hash()).toBe(hA);
    expect(b.value).toBe(a.value);
    expect(a.types.get('lightsOut'), 'lights went out in the replayed window').toBeGreaterThanOrEqual(1);
  });

  describe('SnapshotHistory (flashback ring, rules.md §10)', () => {
    it('is a 10 Hz x 15 s ring: 150 entries after 20 s, spanning 14.9 s', () => {
      const sim = makeSim({ skipLights: true, cfg: { aiCount: 3, seed: SEEDS.snapshot } });
      expect(sim.history.hz).toBe(10);
      expect(sim.history.capacity).toBe(150);
      stepSeconds(sim, 20);
      const h = sim.history;
      expect(h.count()).toBe(150);
      expect(h.newestTime() - h.oldestTime()).toBeCloseTo(14.9, 5);
      expect(h.at(sim.world.state.time - 10)).not.toBeNull();
      expect(h.at(h.oldestTime() - 1), 'older than the ring').toBeNull();
    });

    it('rewinding 10 s from the history and replaying reaches the same state as never having rewound', () => {
      // Reference run that never rewinds.
      const reference = makeSim({ skipLights: true, cfg: { seed: SEEDS.snapshot } });
      stepSeconds(reference, 25);
      const hContinuous = reference.hash();
      const tickAt25 = reference.world.state.tick;

      // Same seed: run 20 s, rewind 10 s through the history ring, replay to the same tick.
      // (History entries are reused in place by the ring: restore one before stepping further, see contracts/sim.ts.)
      const sim = makeSim({ skipLights: true, cfg: { seed: SEEDS.snapshot } });
      stepSeconds(sim, 20);
      const target = sim.history.at(sim.world.state.time - 10)!;
      expect(target).not.toBeNull();
      const targetTick = target.tick;
      sim.restore(target);
      expect(sim.world.state.tick).toBe(targetTick);
      expect(sim.world.state.time).toBeCloseTo(10, 6);
      expect(sim.history.newestTime(), 'restore truncates snapshots newer than the restore point').toBeLessThanOrEqual(sim.world.state.time + 1e-9);
      stepTicks(sim, tickAt25 - targetTick);
      expect(sim.world.state.tick).toBe(tickAt25);
      expect(sim.hash(), `flashback replay must be bit-identical (seed ${SEEDS.snapshot})`).toBe(hContinuous);
      expect(sim.history.count(), 'the ring is refilled while replaying').toBeGreaterThan(100);
    });

    it('history entries are taken every 24 ticks (10 Hz)', () => {
      const sim = makeSim({ skipLights: true, cfg: { aiCount: 1, seed: SEEDS.snapshot } });
      stepTicks(sim, SIM_HZ * 3);
      const h = sim.history;
      const ticks: number[] = [];
      for (let t = 0; t <= 3; t += 0.1) {
        const s = h.at(t);
        if (s) ticks.push(s.tick);
      }
      for (const t of ticks) expect(t % 24, `snapshot tick ${t}`).toBe(0);
      expect(new Set(ticks).size).toBeGreaterThan(20);
    });
  });
});
