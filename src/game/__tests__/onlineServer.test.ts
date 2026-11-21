// T2/T3 (multiplayer-tasks §B), headless: the real server bundle (`npm run server:build` → server/dist/apex-server.mjs) on a free
// port, plus two Node clients built from the production pieces (netClient + createOnlineRace + createSim, no rendering), through
// lobby → load → countdown → a 1-lap race with 2 server AI cars → results. Real time: about 1.5 minutes. Skipped without the bundle.
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { NetLobbyModel, NetRoomSettings, NetServerMsg } from '../../contracts/net';
import { MAX_TARGET_TICKS } from '../../core/loop';
import { createStore } from '../../core/store';
import { createNetClient, OFFLINE_LOBBY, type NetClient } from '../../net/index';
import { createSim } from '../createSim';
import { createOnlineRace, type OnlineRace } from '../net/onlineSession';
import type { SimRunner } from '../../contracts/sim';

const ROOT = path.resolve(__dirname, '../../..');
const BUNDLE = path.join(ROOT, 'server/dist/apex-server.mjs');
const SETTINGS: NetRoomSettings = { trackId: 'bosphorus', laps: 1, tod: 'day', weather: 'dry', aiCount: 2, difficulty: 70 };

function freePort(): Promise<number> {
  return new Promise((res, rej) => {
    const s = createServer();
    s.once('error', rej);
    s.listen(0, '127.0.0.1', () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => res(p));
    });
  });
}

interface HeadlessClient {
  name: string;
  net: NetClient;
  msgs: NetServerMsg[];
  race: OnlineRace | null;
  sim: SimRunner | null;
  maxRemoteProgress: number[];
  liveSamples: number;
  staleSamples: number;
  waitFor(pred: (m: NetServerMsg) => boolean, ms?: number): Promise<NetServerMsg>;
  stop(): void;
}

function headless(url: string, name: string): HeadlessClient {
  const lobby = createStore<NetLobbyModel>({ ...OFFLINE_LOBBY });
  const net = createNetClient({ url, name, build: 'test', lobby }, { storage: null });
  const c: HeadlessClient = {
    name, net, msgs: [], race: null, sim: null, maxRemoteProgress: [], liveSamples: 0, staleSamples: 0,
    waitFor(pred, ms = 20_000) {
      const hit = c.msgs.find(pred);
      if (hit) return Promise.resolve(hit);
      return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error(`${name}: timeout (last ${JSON.stringify(c.msgs.at(-1))?.slice(0, 200)})`)), ms);
        const un = net.onMessage((m) => {
          if (!pred(m)) return;
          clearTimeout(t);
          un();
          resolve(m);
        });
      });
    },
    stop() {
      clearInterval(timer);
      c.race?.dispose();
      net.close(true);
    },
  };
  net.onMessage((m) => {
    c.msgs.push(m);
    if (m.type === 'load' && lobby.get().myId !== null) {
      // The headless twin of main.ts startOnlineRace: same glue, no presentation.
      const race = createOnlineRace(net, m, lobby.get().myId!, { autodrive: true });
      const sim = createSim(race.cfg, { lineup: race.lineup, collision: race.collision });
      race.bind(sim);
      c.race = race;
      c.sim = sim;
      c.maxRemoteProgress = race.lineup.map(() => -Infinity);
      race.sendLoaded();
    }
  });
  // The headless frame loop (core/loop's slaved path): every ~4 ms run the ticks the shared clock asks for.
  const timer = setInterval(() => {
    const race = c.race;
    const sim = c.sim;
    if (!race || !sim) return;
    const want = Math.floor(Math.min(MAX_TARGET_TICKS, Math.max(0, race.targetTicks())));
    for (let i = 0; i < want; i++) {
      race.beforeTick();
      sim.step();
    }
    sim.world.events.drain((e) => race.onSimEvent(e));
    race.afterTicks();
    if (sim.world.state.race.phase === 'running') {
      for (let car = 1; car < race.lineup.length; car++) {
        c.maxRemoteProgress[car] = Math.max(c.maxRemoteProgress[car]!, sim.world.state.cars[car]!.race.progress);
        if (race.link(car) === 'ok') c.liveSamples++;
        else c.staleSamples++;
      }
    }
  }, 4);
  net.connect();
  return c;
}

// `APEX_SKIP_NET_IT=1` skips it (it runs in real time for ~1.5 min).
const HAVE_BUNDLE = existsSync(BUNDLE) && process.env.APEX_SKIP_NET_IT !== '1';

describe.skipIf(!HAVE_BUNDLE)('online: real server + 2 headless clients (T2/T3)', () => {
  let server: ChildProcess | null = null;
  const clients: HeadlessClient[] = [];
  afterAll(() => {
    for (const c of clients) c.stop();
    server?.kill();
  });

  it('lobby → load → countdown → 1-lap race → results; both see each other move', async () => {
    const port = await freePort();
    server = spawn(process.execPath, [BUNDLE], { cwd: ROOT, env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
    await new Promise<void>((res, rej) => {
      const t = setTimeout(() => rej(new Error('server did not start')), 15_000);
      server!.stdout!.on('data', (d: Buffer) => {
        if (d.toString().includes('listening')) {
          clearTimeout(t);
          res();
        }
      });
      server!.once('exit', (code) => rej(new Error(`server exited ${code}`)));
    });
    const url = `ws://127.0.0.1:${port}/ws`;

    const a = headless(url, 'Ayşe');
    clients.push(a);
    await a.waitFor((m) => m.type === 'welcome');
    a.net.send({ type: 'create', settings: SETTINGS });
    const room = (await a.waitFor((m) => m.type === 'room')) as Extract<NetServerMsg, { type: 'room' }>;
    const b = headless(url, 'Barış');
    clients.push(b);
    await b.waitFor((m) => m.type === 'welcome');
    b.net.send({ type: 'join', code: room.code });
    await b.waitFor((m) => m.type === 'room' && m.players.length === 2);
    // Distinct cars (the server gives free seats on join; make sure).
    b.net.send({ type: 'setCar', teamId: 'vortex', driverIdx: 0 });
    a.net.send({ type: 'setReady', ready: true });
    b.net.send({ type: 'setReady', ready: true });
    await a.waitFor((m) => m.type === 'room' && m.players.length === 2 && m.players.every((p) => p.ready));
    a.net.send({ type: 'start' });

    const loadA = (await a.waitFor((m) => m.type === 'load')) as Extract<NetServerMsg, { type: 'load' }>;
    await b.waitFor((m) => m.type === 'load');
    expect(loadA.roster.length).toBe(4); // 2 humans + 2 server AI
    await a.waitFor((m) => m.type === 'start');
    await b.waitFor((m) => m.type === 'start');
    expect(a.race!.lineup.filter((e) => e.control === 'remote').length).toBe(3);
    // Same clock: both sims run within a few ticks of each other.
    await new Promise((r) => setTimeout(r, 3000));
    expect(Math.abs(a.sim!.world.state.tick - b.sim!.world.state.tick)).toBeLessThan(120); // < 0.5 s even on a loaded machine (setInterval starvation)

    const resA = (await a.waitFor((m) => m.type === 'results', 200_000)) as Extract<NetServerMsg, { type: 'results' }>;
    await b.waitFor((m) => m.type === 'results', 30_000);
    expect(resA.rows.length).toBe(4);
    const humans = resA.rows.filter((r) => r.name === 'Ayşe' || r.name === 'Barış');
    expect(humans.map((r) => r.status)).toEqual(['finished', 'finished']);
    // Every local car finished its lap on its own director too (lap count matches the server).
    for (const c of [a, b]) {
      expect(c.sim!.world.state.cars[0]!.race.lapsCompleted).toBe(1);
      expect(c.race!.results()!.rows.length).toBe(4);
      const L = c.sim!.world.static.track.query.length;
      // Each puppet (the other human and both AI) was seen moving along most of the lap.
      for (let car = 1; car < 4; car++) expect(c.maxRemoteProgress[car]!).toBeGreaterThan(0.8 * L);
      expect(c.liveSamples / (c.liveSamples + c.staleSamples)).toBeGreaterThan(0.9);
      expect(c.net.stats().dropped).toBe(0);
    }
  }, 260_000);
});
