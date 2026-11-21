import { describe, expect, it } from 'vitest';
import { SIM_HZ } from '../../contracts/sim';
import { createSim, defaultSessionConfig } from '../createSim';
import { findNonFinite } from '../sim/stateUtils';
import { createOvalTrack } from '../../track';

function runSeconds(sim: ReturnType<typeof createSim>, seconds: number): void {
  const n = Math.round(seconds * SIM_HZ);
  for (let i = 0; i < n; i++) sim.step();
  sim.world.events.drain(() => {});
}

describe('createSim', () => {
  it('runs 60 s with 20 cars without producing NaN', () => {
    const sim = createSim(defaultSessionConfig({ aiCount: 19, autodrive: true, seed: 42, laps: 50 }), { skipLights: true, track: createOvalTrack() });
    expect(sim.world.state.cars).toHaveLength(20);
    for (let t = 0; t < 60; t += 10) {
      runSeconds(sim, 10);
      expect(findNonFinite(sim.world.state)).toBeNull();
    }
    const st = sim.world.state;
    expect(st.time).toBeCloseTo(60, 6);
    // Everybody is moving and the leader has completed laps on the 1.4 km oval.
    for (const car of st.cars) expect(car.race.progress).toBeGreaterThan(500);
    const leader = st.cars[st.race.order[0]!]!;
    expect(leader.race.lapsCompleted).toBeGreaterThanOrEqual(1);
    // lastLapMs, not bestLapMs: AI laps on the oval test track hit track limits (invalid laps never set a best).
    expect(leader.race.lastLapMs).toBeGreaterThan(15_000);
  });

  it('gives the same hash for the same seed', () => {
    const cfg = defaultSessionConfig({ aiCount: 19, autodrive: true, seed: 7, laps: 20 });
    const a = createSim(cfg);
    const b = createSim(cfg);
    expect(a.hash()).toBe(b.hash());
    runSeconds(a, 20);
    runSeconds(b, 20);
    expect(a.hash()).toBe(b.hash());
    expect(a.world.state.race.phase).toBe('running');
  });

  it('restores a snapshot so that re-running gives the same hash', () => {
    const sim = createSim(defaultSessionConfig({ aiCount: 9, autodrive: true, seed: 3, laps: 20 }), { skipLights: true });
    runSeconds(sim, 5);
    const snap = sim.snapshot();
    const carsRef = sim.world.state.cars;
    const vehicleRef = carsRef[0]!.vehicle;
    runSeconds(sim, 8);
    const after = sim.hash();
    sim.restore(snap);
    // Identity of live objects is preserved (systems may hold references).
    expect(sim.world.state.cars).toBe(carsRef);
    expect(sim.world.state.cars[0]!.vehicle).toBe(vehicleRef);
    expect(sim.world.state.tick).toBe(snap.tick);
    runSeconds(sim, 8);
    expect(sim.hash()).toBe(after);
  });

  it('keeps a 10 Hz x 15 s snapshot history usable for restore', () => {
    const sim = createSim(defaultSessionConfig({ aiCount: 3, autodrive: true, seed: 11 }), { skipLights: true });
    runSeconds(sim, 20);
    const h = sim.history;
    expect(h.capacity).toBe(150);
    expect(h.count()).toBe(150);
    expect(h.newestTime() - h.oldestTime()).toBeCloseTo(14.9, 5);
    const target = h.at(sim.world.state.time - 10)!;
    expect(target).not.toBeNull();
    const tick = target.tick;
    sim.restore(target);
    expect(sim.world.state.tick).toBe(tick);
    expect(h.newestTime()).toBeLessThanOrEqual(sim.world.state.time + 1e-9);
  });

  it('runs lights then finishes a 1-lap race', () => {
    const sim = createSim(defaultSessionConfig({ aiCount: 5, autodrive: true, seed: 5, laps: 1 }));
    const st = sim.world.state;
    expect(st.race.phase).toBe('grid');
    const seen = new Set<string>();
    let finished = false;
    for (let i = 0; i < 240 * 120 && !finished; i++) {
      sim.step();
      sim.world.events.drain((e) => seen.add(e.type));
      finished = st.race.phase === 'finished';
    }
    expect(seen.has('lightsOn')).toBe(true);
    expect(seen.has('lightsOut')).toBe(true);
    expect(seen.has('lap')).toBe(true);
    expect(seen.has('finish')).toBe(true);
    expect(finished).toBe(true);
    const positions = st.cars.map((c) => c.race.position).sort((a, b) => a - b);
    expect(positions).toEqual([1, 2, 3, 4, 5, 6]);
  });
});
