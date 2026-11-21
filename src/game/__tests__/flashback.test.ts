// Flashback (rules §11): S-SM-13 rewind → equal hash and deterministic re-simulation; allowance; preview; cancel.

import { describe, expect, it } from 'vitest';
import type { EventMap } from '../../contracts/events';
import type { HudModel } from '../../contracts/hud';
import { SIM_HZ } from '../../contracts/sim';
import { createEventBus } from '../../core/eventBus';
import { createStraightTrack, loadTrack } from '../../track/index';
import { PLAYER_CAR_ID, createSim, defaultSessionConfig } from '../createSim';
import { createFlashbackController } from '../flashback';

const hudFb = (): HudModel['flashback'] => ({ open: false, offsetSec: 0, maxSec: 15, left: 3 });

describe('flashback (rules §11)', () => {
  it('S-SM-13: rewind 10 s restores the exact state (hash) and re-simulates identically', () => {
    const sim = createSim(defaultSessionConfig({ aiCount: 5, seed: 11, flashbacks: 3 }), { track: loadTrack(), skipLights: true });
    const hashes = new Map<number, string>();
    for (let i = 0; i < 20 * SIM_HZ; i++) {
      sim.step();
      if (sim.world.state.tick % 24 === 0) hashes.set(sim.world.state.tick, sim.hash());
    }
    const target = sim.history.at(sim.world.state.time - 10)!;
    const t0 = target.tick;
    // Reference: where the original timeline was 5 s after the restore point.
    const refTick = t0 + 5 * SIM_HZ;
    expect(hashes.get(t0)).toBeDefined();
    const bus = createEventBus<EventMap>();
    const fb = createFlashbackController({ sim, playerId: PLAYER_CAR_ID, bus, hud: hudFb(), onRestored: () => {} });
    expect(fb.available()).toBe(true);
    expect(fb.open()).toBe(true);
    fb.scrub(-7); // −3 (open) − 7 = −10 s
    fb.apply();
    expect(sim.world.state.tick).toBe(t0);
    // The allowance is the only intended difference; compare with it restored.
    sim.world.state.race.flashbacksLeft = 3;
    expect(sim.hash()).toBe(hashes.get(t0));
    sim.world.state.race.flashbacksLeft = 2;
    while (sim.world.state.tick < refTick) sim.step();
    sim.world.state.race.flashbacksLeft = 3;
    expect(sim.hash()).toBe(hashes.get(refTick));
  });

  it('allowance decrements, unlimited stays −1, cancel restores now and consumes nothing', () => {
    const sim = createSim(defaultSessionConfig({ aiCount: 1, flashbacks: 1 }), { track: createStraightTrack(2000), skipLights: true });
    for (let i = 0; i < 5 * SIM_HZ; i++) sim.step();
    const bus = createEventBus<EventMap>();
    const applied: number[] = [];
    bus.on('flashback:applied', (p) => applied.push(p.left));
    const hud = hudFb();
    const fb = createFlashbackController({ sim, playerId: PLAYER_CAR_ID, bus, hud, onRestored: () => {} });
    const tick0 = sim.world.state.tick;
    const h0 = sim.hash();
    fb.open();
    expect(hud.open).toBe(true);
    expect(hud.offsetSec).toBeCloseTo(-3, 5);
    expect(sim.world.state.tick).toBeLessThan(tick0); // preview restore
    fb.cancel();
    expect(sim.world.state.tick).toBe(tick0);
    expect(sim.hash()).toBe(h0);
    fb.open();
    fb.apply();
    expect(applied).toEqual([0]);
    expect(sim.world.state.race.flashbacksLeft).toBe(0);
    for (let i = 0; i < 2 * SIM_HZ; i++) sim.step();
    expect(fb.available()).toBe(false);
    expect(fb.open()).toBe(false);
    sim.world.state.race.flashbacksLeft = -1;
    expect(fb.open()).toBe(true);
    fb.apply();
    expect(sim.world.state.race.flashbacksLeft).toBe(-1);
  });

  it('time trial: an applied flashback invalidates the lap (lapInvalidated flashback); ramp 0.25 → 1 over 0.8 s', () => {
    const sim = createSim(defaultSessionConfig({ mode: 'timeTrial', aiCount: 0, flashbacks: -1 }), { track: createStraightTrack(2000), skipLights: true });
    for (let i = 0; i < 4 * SIM_HZ; i++) sim.step();
    sim.world.events.drain(() => {});
    sim.world.state.cars[0]!.race.lapValid = true;
    const fb = createFlashbackController({ sim, playerId: PLAYER_CAR_ID, bus: createEventBus<EventMap>(), hud: hudFb(), onRestored: () => {} });
    fb.open();
    fb.apply();
    const ev: string[] = [];
    sim.world.events.drain((e) => ev.push(e.type === 'lapInvalidated' ? `${e.type}:${e.reason}` : e.type));
    expect(ev).toContain('lapInvalidated:flashback');
    expect(fb.ramp(0)).toBeCloseTo(0.25, 5);
    expect(fb.ramp(0.4)).toBeCloseTo(0.625, 5);
    expect(fb.ramp(0.5)).toBe(1);
  });
});
