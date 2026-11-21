// Real-time races with bots (T7 cheat detection, end-to-end 1-lap race with server AI and results). Slow: ~2 min total.
import { afterAll, describe, expect, it } from 'vitest';
import type { NetServerMsg } from '../../../src/contracts/net';
import type { Bot } from '../../bots/bot';
import { bot, isType, sleep, startRace, startServer, type TestServer } from './helpers';

const all: { srv: TestServer; bots: Bot[] }[] = [];
afterAll(async () => {
  for (const x of all) {
    for (const b of x.bots) b.close();
    await x.srv.stop();
  }
});

function carOf(srv: TestServer, id: number) {
  for (const r of srv.apex.hub.rooms.values()) {
    const c = r.race?.byId[id];
    if (c) return c;
  }
  throw new Error(`no car ${id}`);
}

describe('cheat detection (T7)', () => {
  it('flags teleport / impossible speed / fake progress / early start; a legit bot gets 0 strikes', async () => {
    const srv = await startServer({ countdownMs: 500 });
    const legit = await bot(srv, 'Legit');
    const tele = await bot(srv, 'Tele', { tamper: 'teleport' });
    const fast = await bot(srv, 'Fast', { tamper: 'speed' });
    const prog = await bot(srv, 'Prog', { tamper: 'fakeProgress' });
    const early = await bot(srv, 'Early', { tamper: 'earlyStart' });
    const legit2 = await bot(srv, 'Legit2');
    all.push({ srv, bots: [legit, tele, fast, prog, early, legit2] });
    await startRace([legit, tele, fast, prog], { trackId: 'istanbul' });
    await startRace([early, legit2], { trackId: 'istanbul' });
    const load = legit.load!;
    // Run until lights out + ~6 s.
    await sleep(srv.apex.hub.cfg.countdownMs + load.lightsOutAtMs + 6000);

    expect(carOf(srv, legit.id).strikes).toBe(0);
    expect(carOf(srv, legit2.id).strikes).toBe(0);
    expect(legit.sent).toBeGreaterThan(100);

    const t = carOf(srv, tele.id);
    expect(t.hardViolations).toBeGreaterThanOrEqual(2);
    expect(t.timing.status).toBe('dsq');
    const f = carOf(srv, fast.id);
    expect(f.strikes).toBeGreaterThan(10);
    const p = carOf(srv, prog.id);
    expect(p.strikes).toBeGreaterThan(10);
    expect(p.timing.lapsCompleted).toBe(0);
    // Rejected states are not relayed: the others stopped receiving the cheaters' fresh states (muted / dropped).
    const strikeReasons = new Set(srv.logs.filter((l) => l.event === 'strike').map((l) => `${l.data.id}:${l.data.reason}`));
    expect(strikeReasons.has(`${f.id}:speed`)).toBe(true);
    expect([...strikeReasons].some((r) => r.startsWith(`${p.id}:`))).toBe(true);
    expect(srv.logs.some((l) => l.event === 'strikeMute' && l.data.id === p.id)).toBe(true);

    const pen = (await legit2.waitFor((m) => m.type === 'penalty' && m.id === early.id)) as Extract<NetServerMsg, { type: 'penalty' }>;
    expect(pen).toEqual({ type: 'penalty', id: early.id, seconds: 5, reason: 'jumpStart' });
    expect(legit.msgs.some((m) => m.type === 'penalty' && m.id === legit.id)).toBe(false);
  }, 60_000);
});

describe('end to end (T1/T4)', () => {
  it('two bots and one server AI complete a 1-lap Bosphorus race; the server classifies everyone', async () => {
    const srv = await startServer({ countdownMs: 1000 });
    const a = await bot(srv, 'Botan');
    const b = await bot(srv, 'Botila', { hz: 15 });
    all.push({ srv, bots: [a, b] });
    await startRace([a, b], { trackId: 'bosphorus', laps: 1, aiCount: 1, difficulty: 100 });
    const res = (await a.waitFor(isType('results'), 170_000)) as Extract<NetServerMsg, { type: 'results' }>;
    const laps = a.msgs.filter((m) => m.type === 'lap') as Extract<NetServerMsg, { type: 'lap' }>[];
    const standings = a.msgs.filter((m) => m.type === 'standings');
    const finishing = a.msgs.find((m) => m.type === 'finishing');
    const strikes = srv.logs.filter((l) => l.event === 'strike' || l.event === 'lapRejected');
    // Report material (test output).
    console.log(JSON.stringify({ rows: res.rows, laps, standings: standings.length, strikes, health: srv.apex.hub.stats() }));
    expect(strikes).toEqual([]);
    expect(finishing).toBeDefined();
    expect(res.rows).toHaveLength(3);
    expect(res.rows.map((r) => r.status)).toEqual(['finished', 'finished', 'finished']);
    expect(res.rows[0]!.points).toBe(25);
    expect(res.rows.map((r) => r.pos)).toEqual([1, 2, 3]);
    for (const r of res.rows) {
      expect(r.totalMs).toBeGreaterThan(66_400);
      expect(r.totalMs).toBeLessThan(110_000);
      expect(r.bestLapMs).toBe(r.totalMs); // 1 lap: the lap is the race (measured from lights out)
    }
    expect(res.rows.some((r) => r.id >= 64)).toBe(true);
    expect(laps.map((l) => l.lap)).toEqual([1, 1, 1]);
    expect(standings.length).toBeGreaterThan(50);
    expect(a.seenAiIds.size).toBe(1);
    await b.waitFor(isType('results'), 2000);
  }, 180_000);
});
