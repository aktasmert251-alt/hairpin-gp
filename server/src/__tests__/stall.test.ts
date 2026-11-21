// User bug 2026-10-26: "online some cars stayed on the grid, a safety car came out and the AI could not get past the stopped
// car". Real server + 4 bots + 3 server AI over 3 laps: one bot loads but never sends a state (frozen tab), one sends states
// but nobody drives (AFK on the grid), one drops its socket at the lights, one races. 30 s after lights out the race must be
// flowing: every AI car well away from the grid, no safety car held by a car that is not there, the AFK car retired.
import { afterAll, describe, expect, it } from 'vitest';
import type { Bot } from '../../bots/bot';
import { crx } from '../../../src/race/extra';
import { bot, sleep, startRace, startServer, type TestServer } from './helpers';

const all: { srv: TestServer; bots: Bot[] }[] = [];
afterAll(async () => {
  for (const x of all) {
    for (const b of x.bots) b.close();
    await x.srv.stop();
  }
});

describe('stalled / absent cars at the start (no deadlock)', () => {
  it('idle, AFK and dropped humans never block the field or hold a safety car', async () => {
    const srv = await startServer({ countdownMs: 500 });
    const racer = await bot(srv, 'Racer');
    const idle = await bot(srv, 'Idle', { drive: 'idle' });
    const afk = await bot(srv, 'Afk', { drive: 'afk' });
    const drop = await bot(srv, 'Drop');
    all.push({ srv, bots: [racer, idle, afk, drop] });
    await startRace([racer, idle, afk, drop], { trackId: 'bosphorus', laps: 3, aiCount: 3 });
    const load = racer.load!;
    await sleep(srv.apex.hub.cfg.countdownMs + load.lightsOutAtMs + 200);
    drop.drop();
    await sleep(30_000);

    const room = [...srv.apex.hub.rooms.values()][0]!;
    const r = room.race!;
    const sim = r.sim!;
    const L = r.track.query.length;
    const st = sim.runner.world.state;
    const rows = r.cars.map((c) => {
      const sc = sim.car(c.index);
      return { name: c.name, human: c.human, status: c.timing.status, moved: sc.race.progress - c.gridProgress, x: sc.vehicle.x, slowT: crx(sc.race).slowT };
    });
    // Every server AI car is racing well away from the grid (≈ 30 s × ≥ 40 m/s even behind a safety car).
    for (const row of rows.filter((x) => !x.human)) expect(row.moved, JSON.stringify(rows)).toBeGreaterThan(800);
    expect(rows.find((x) => x.name === 'Racer')!.moved).toBeGreaterThan(800);
    // The AFK car on the grid was retired before it could bring out the safety car; the idle one never started.
    expect(r.cars.find((c) => c.name === 'Afk')!.timing.status).toBe('dnf');
    expect(r.cars.find((c) => c.name === 'Idle')!.timing.status).toBe('dnf');
    // Nothing that is not racing holds a safety car: none came out for the absent / stalled cars.
    expect(st.race.sc.count, JSON.stringify(rows)).toBe(0);
    expect(L).toBeGreaterThan(0);
  }, 90_000);
});
