import { describe, expect, it } from 'vitest';
import type { SimLineupEntry } from '../../contracts/sim';
import { lightsOutAtMsFor } from '../../race';
import { createOvalTrack } from '../../track';
import { createSim, defaultSessionConfig } from '../createSim';

const track = createOvalTrack();

describe('CR-NET-6 lightsOutAtMsFor(seed)', () => {
  it('equals createSim lights-out time for every seed (server jump-start check uses the client number)', () => {
    for (const seed of [-2147483648, -7, 0, 1, 42, 99_991, 2147483647]) {
      const sim = createSim(defaultSessionConfig({ seed, aiCount: 1 }), { track });
      expect(lightsOutAtMsFor(seed)).toBe(sim.world.state.race.lightsOutAtMs);
    }
  });
});

describe('CR-NET-1 createSim lineup (online grid, D-043)', () => {
  const client: SimLineupEntry[] = [
    { teamId: 'aurora', driverIdx: 1, gridSlot: 4, control: 'player', human: true },
    { teamId: 'anka', driverIdx: 0, gridSlot: 0, control: 'remote', human: true },
    { teamId: 'anka', driverIdx: 1, gridSlot: 2, control: 'remote', human: false },
  ];

  it('client view: local player = car 0, humans and server AI cars are remote puppets at the given slots', () => {
    const sim = createSim(defaultSessionConfig({ seed: 3, aiCount: 0 }), { track, lineup: client });
    const cars = sim.world.state.cars;
    expect(cars.map((c) => [c.teamId, c.control, c.isPlayer])).toEqual([
      ['aurora', 'player', true],
      ['anka', 'remote', false],
      ['anka', 'remote', false],
    ]);
    expect(cars[1]!.driverId).not.toBe(cars[2]!.driverId);
    // Slot order: 0 ahead of 2 ahead of 4 (further back = smaller s on the grid).
    const s = (i: number) => cars[i]!.vehicle.s;
    expect(s(1)).toBeGreaterThan(s(2));
    expect(s(2)).toBeGreaterThan(s(0));
  });

  it('server view: no local player, AI cars simulated, humans remote', () => {
    const server: SimLineupEntry[] = client.map((e) => ({ ...e, control: e.human ? 'remote' : 'ai' }));
    const sim = createSim(defaultSessionConfig({ seed: 3, aiCount: 0 }), { track, lineup: server });
    expect(sim.world.state.cars.map((c) => [c.control, c.isPlayer])).toEqual([
      ['remote', false],
      ['remote', false],
      ['ai', false],
    ]);
  });

  it('autodrive keeps isPlayer on car 0; invalid lineups throw', () => {
    const sim = createSim(defaultSessionConfig({ seed: 3, autodrive: true }), { track, lineup: client });
    expect([sim.world.state.cars[0]!.control, sim.world.state.cars[0]!.isPlayer]).toEqual(['ai', true]);
    expect(() => createSim(defaultSessionConfig(), { track, lineup: [{ ...client[0]!, teamId: 'nope' }] })).toThrow(/unknown teamId/);
    expect(() => createSim(defaultSessionConfig(), { track, lineup: [client[1]!, client[0]!] })).toThrow(/only car 0/);
  });

  it('without a lineup the offline world is unchanged (same hash as the default path)', () => {
    const cfg = defaultSessionConfig({ seed: 11, aiCount: 5 });
    const a = createSim(cfg, { track });
    const b = createSim(cfg, { track, lineup: undefined });
    for (let i = 0; i < 240; i++) {
      a.step();
      b.step();
    }
    expect(a.hash()).toBe(b.hash());
  });
});
