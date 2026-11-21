// Lead-Net: multi-client online quality harness. The real server bundle (server/dist/apex-server.mjs) with artificial
// latency (--net-delay / --net-jitter / --net-loss), N headless clients built from the production pieces (netClient +
// createOnlineRace + createSim, autodrive), one race. Every client records its own car per tick (the ground truth) and every
// puppet it shows per tick; the test compares them on the shared race clock:
//   posErr   |puppet âˆ’ owner's own pose| at the same tick (m), p50 / p95 / max
//   yErr     height error (m)  â€” floating / sinking
//   step     per-tick motion error |Î”puppet âˆ’ Î”truth| (m): rms = jitter, > 0.25 m = a visible snap
// Opt-in (real time, ~1â€“2 min per case): APEX_NET_QUALITY=1 [NETQ_TRACK=cliff NETQ_DELAY=60 NETQ_JITTER=30 NETQ_LOSS=2
// NETQ_CLIENTS=2 NETQ_LAPS=1 NETQ_AI=1 NETQ_SECONDS=60]. Results: test-results/net/quality-<label>.json.
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { NetLobbyModel, NetRoomSettings, NetServerMsg } from '../../contracts/net';
import type { RaceTrackId } from '../../contracts/track';
import type { SimRunner } from '../../contracts/sim';
import { MAX_TARGET_TICKS } from '../../core/loop';
import { createStore } from '../../core/store';
import { createNetClient, OFFLINE_LOBBY, type NetClient } from '../../net/index';
import { createSim } from '../createSim';
import { createOnlineRace, type OnlineRace } from '../net/onlineSession';

const ROOT = path.resolve(__dirname, '../../..');
const BUNDLE = path.join(ROOT, 'server/dist/apex-server.mjs');
const env = (k: string, d: string): string => process.env[k] ?? d;
const TRACK = env('NETQ_TRACK', 'bosphorus') as RaceTrackId;
const DELAY = Number(env('NETQ_DELAY', '60'));
const JITTER = Number(env('NETQ_JITTER', '30'));
const LOSS = Number(env('NETQ_LOSS', '2'));
const CLIENTS = Number(env('NETQ_CLIENTS', '2'));
const SECONDS = Number(env('NETQ_SECONDS', '60'));
const SETTINGS: NetRoomSettings = {
  trackId: TRACK, laps: Number(env('NETQ_LAPS', '1')) as NetRoomSettings['laps'], tod: 'day', weather: 'dry',
  aiCount: Number(env('NETQ_AI', '1')), difficulty: 70,
};
const MAX_T = 240 * 400;
const SNAP_M = 0.25;

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

interface Track4 { x: Float32Array; y: Float32Array; z: Float32Array; ok: Uint8Array; age: Float32Array }
const track4 = (): Track4 => ({ x: new Float32Array(MAX_T), y: new Float32Array(MAX_T), z: new Float32Array(MAX_T), ok: new Uint8Array(MAX_T), age: new Float32Array(MAX_T) });

interface Client {
  name: string;
  net: NetClient;
  msgs: NetServerMsg[];
  race: OnlineRace | null;
  sim: SimRunner | null;
  own: Track4;
  /** Puppet poses by NetId. */
  seen: Map<number, Track4>;
  lightsOutTick: number;
  collisions: number;
  maxRemoteImpulse: number;
  hits: { T: number; j: number; other: number; vRel: number }[];
  newestMs: Map<number, number>;
  waitFor(pred: (m: NetServerMsg) => boolean, ms?: number): Promise<NetServerMsg>;
  stop(): void;
}

function client(url: string, name: string): Client {
  const lobby = createStore<NetLobbyModel>({ ...OFFLINE_LOBBY });
  const net = createNetClient({ url, name, build: 'test', lobby }, { storage: null, deviceStorage: null });
  const c: Client = {
    name, net, msgs: [], race: null, sim: null, own: track4(), seen: new Map(), lightsOutTick: -1, collisions: 0, maxRemoteImpulse: 0, hits: [], newestMs: new Map(),
    waitFor(pred, ms = 30_000) {
      const hit = c.msgs.find(pred);
      if (hit) return Promise.resolve(hit);
      return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error(`${name}: timeout`)), ms);
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
    if (m.type === 'load' && lobby.get().myId !== null && !c.race) {
      const race = createOnlineRace(net, m, lobby.get().myId!, { autodrive: true });
      const sim = createSim(race.cfg, { lineup: race.lineup, collision: race.collision });
      race.bind(sim);
      c.race = race;
      c.sim = sim;
      for (let car = 1; car < race.roster.length; car++) if (race.roster[car]!.kind === 'human') c.seen.set(race.roster[car]!.id, track4());
      race.sendLoaded();
    }
  });
  net.onStates((e) => c.newestMs.set(e.id, Math.max(c.newestMs.get(e.id) ?? 0, e.simMs)));
  const timer = setInterval(() => {
    const race = c.race;
    const sim = c.sim;
    if (!race || !sim) return;
    const want = Math.floor(Math.min(MAX_TARGET_TICKS, Math.max(0, race.targetTicks())));
    const st = sim.world.state;
    for (let i = 0; i < want; i++) {
      race.beforeTick();
      sim.step();
      const T = st.tick;
      if (T >= MAX_T) continue;
      const v = st.cars[0]!.vehicle;
      c.own.x[T] = v.x; c.own.y[T] = v.y; c.own.z[T] = v.z; c.own.ok[T] = 1;
      for (let car = 1; car < st.cars.length; car++) {
        const tr = c.seen.get(race.idOf(car));
        if (!tr || race.link(car) !== 'ok') continue;
        const pv = st.cars[car]!.vehicle;
        tr.x[T] = pv.x; tr.y[T] = pv.y; tr.z[T] = pv.z; tr.ok[T] = 1; tr.age[T] = st.time * 1000 - (c.newestMs.get(race.idOf(car)) ?? 0);
      }
      if (c.lightsOutTick < 0 && st.race.lightsOutAtMs > 0 && st.race.raceMs >= st.race.lightsOutAtMs) c.lightsOutTick = T;
    }
    sim.world.events.drain((e) => {
      if (e.type === 'collision' && (e.a === 0 || e.b === 0) && e.b > 0) {
        c.collisions++;
        if (e.impulse > c.maxRemoteImpulse) c.maxRemoteImpulse = e.impulse;
        const o = st.cars[e.a === 0 ? e.b : e.a]!.vehicle;
        const me = st.cars[0]!.vehicle;
        if (c.hits.length < 20) c.hits.push({ T: st.tick, j: Math.round(e.impulse), other: race.idOf(e.a === 0 ? e.b : e.a), vRel: r3(Math.hypot(o.vx - me.vx, o.vz - me.vz)) });
      }
      race.onSimEvent(e);
    });
    race.afterTicks();
  }, 4);
  net.connect();
  return c;
}

const pct = (a: number[], p: number): number => {
  if (a.length === 0) return Number.NaN;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))]!;
};
const r3 = (v: number): number => Math.round(v * 1000) / 1000;

/** Puppet `seen` (observer) against the owner's own track, ticks from `from` on. */
function compare(seen: Track4, own: Track4, from: number, to: number) {
  const pos: number[] = [];
  const ys: number[] = [];
  let stepSq = 0;
  let steps = 0;
  let snaps = 0;
  const snapAt: { T: number; e: number; age: number; ageBefore: number; err: number }[] = [];
  for (let T = from; T < to; T++) {
    if (!seen.ok[T] || !own.ok[T]) continue;
    pos.push(Math.hypot(seen.x[T]! - own.x[T]!, seen.z[T]! - own.z[T]!));
    ys.push(Math.abs(seen.y[T]! - own.y[T]!));
    if (seen.ok[T - 1] && own.ok[T - 1]) {
      const ex = seen.x[T]! - seen.x[T - 1]! - (own.x[T]! - own.x[T - 1]!);
      const ez = seen.z[T]! - seen.z[T - 1]! - (own.z[T]! - own.z[T - 1]!);
      const e = Math.hypot(ex, ez);
      stepSq += e * e;
      steps++;
      if (e > SNAP_M) {
        snaps++;
        if (snapAt.length < 12) snapAt.push({ T, e: r3(e), age: Math.round(seen.age[T]!), ageBefore: Math.round(seen.age[T - 1]!), err: r3(Math.hypot(seen.x[T]! - own.x[T]!, seen.z[T]! - own.z[T]!)) });
      }
    }
  }
  const minutes = steps / 240 / 60;
  return {
    samples: pos.length, posP50: r3(pct(pos, 0.5)), posP95: r3(pct(pos, 0.95)), posMax: r3(pct(pos, 1)),
    yP95: r3(pct(ys, 0.95)), yMax: r3(pct(ys, 1)), stepRmsMm: r3(Math.sqrt(stepSq / Math.max(1, steps)) * 1000),
    snaps, snapsPerMin: r3(snaps / Math.max(1e-9, minutes)), snapAt,
  };
}

const ENABLED = process.env.APEX_NET_QUALITY === '1' && existsSync(BUNDLE);

describe.skipIf(!ENABLED)('online quality: real server, latency, N headless clients', () => {
  let server: ChildProcess | null = null;
  const clients: Client[] = [];
  afterAll(() => {
    for (const c of clients) c.stop();
    server?.kill();
  });

  it(`${TRACK} d${DELAY} j${JITTER} l${LOSS} x${CLIENTS}`, async () => {
    const port = await freePort();
    server = spawn(process.execPath, [BUNDLE, '--net-delay', String(DELAY), '--net-jitter', String(JITTER), '--net-loss', String(LOSS)], {
      cwd: ROOT, env: { ...process.env, PORT: String(port), MAX_SOCKETS_PER_IP: '64', CERT_DIR: path.join(ROOT, 'tests/net/.no-certs') },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const logs: string[] = [];
    await new Promise<void>((res, rej) => {
      const t = setTimeout(() => rej(new Error('server did not start')), 15_000);
      server!.stdout!.on('data', (d: Buffer) => {
        const s = d.toString();
        logs.push(s);
        if (s.includes('listening')) {
          clearTimeout(t);
          res();
        }
      });
      server!.once('exit', (code) => rej(new Error(`server exited ${code}`)));
    });
    const url = `ws://127.0.0.1:${port}/ws`;
    const a = client(url, 'Pilot A');
    clients.push(a);
    await a.waitFor((m) => m.type === 'welcome');
    a.net.send({ type: 'create', settings: SETTINGS });
    const room = (await a.waitFor((m) => m.type === 'room')) as Extract<NetServerMsg, { type: 'room' }>;
    for (let k = 1; k < CLIENTS; k++) {
      const b = client(url, `Pilot ${String.fromCharCode(65 + k)}`);
      clients.push(b);
      await b.waitFor((m) => m.type === 'welcome');
      b.net.send({ type: 'join', code: room.code });
      await b.waitFor((m) => m.type === 'room' && m.players.length === k + 1);
    }
    for (const c of clients) c.net.send({ type: 'setReady', ready: true });
    await a.waitFor((m) => m.type === 'room' && m.players.length === CLIENTS && m.players.every((p) => p.ready));
    a.net.send({ type: 'start' });
    for (const c of clients) await c.waitFor((m) => m.type === 'start', 60_000);
    // Race for SECONDS after lights out (or until results).
    const deadline = Date.now() + (SECONDS + 15) * 1000;
    while (Date.now() < deadline && !clients.every((c) => c.msgs.some((m) => m.type === 'results'))) await new Promise((r) => setTimeout(r, 250));

    const byId = new Map<number, Client>();
    for (const c of clients) byId.set(c.net.lobby.get().myId!, c);
    const pairs: Record<string, unknown>[] = [];
    for (const obs of clients) {
      for (const [id, seen] of obs.seen) {
        const owner = byId.get(id);
        if (!owner) continue;
        const from = Math.max(obs.lightsOutTick, owner.lightsOutTick) + 240 * 2;
        pairs.push({ observer: obs.name, owner: owner.name, ...compare(seen, owner.own, from, MAX_T) });
      }
    }
    const result = {
      track: TRACK, delayMs: DELAY, jitterMs: JITTER, lossPct: LOSS, clients: CLIENTS, ai: SETTINGS.aiCount,
      label: process.env.NETQ_LABEL ?? 'run', pairs,
      collisions: clients.map((c) => ({ name: c.name, n: c.collisions, maxJ: Math.round(c.maxRemoteImpulse), hits: c.hits })),
      rtt: clients.map((c) => Math.round(c.net.stats().rttMs)),
      results: (a.msgs.find((m) => m.type === 'results') as Extract<NetServerMsg, { type: 'results' }> | undefined)?.rows
        .map((r) => ({ name: r.name, status: r.status, totalMs: r.totalMs })) ?? null,
      strikes: logs.join('').split('\n').filter((l) => /"event":"(strike|hardViolation|contactReject|lapRejected)"/.test(l)).slice(0, 20),
    };
    const dir = path.join(ROOT, 'test-results/net');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, `quality-${result.label}-${TRACK}-d${DELAY}.json`), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 1));
    expect(pairs.length).toBeGreaterThan(0);
  }, 600_000);
});
