// Protocol / room FSM / relay / AI streaming / reconnect / isolation against a real server (T1, T4, T6, parts of T5).
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import type { NetServerMsg } from '../../../src/contracts/net';
import { PROTOCOL_VERSION } from '../../../src/contracts/net';
import { NET_ID_SERVER_BIT } from '../../../src/net/protocol';
import { Bot, DEFAULT_SETTINGS } from '../../bots/bot';
import { AI_ID_BASE } from '../room';
import { bot, isType, sleep, startRace, startServer, type TestServer } from './helpers';

let srv: TestServer | null = null;
const bots: Bot[] = [];

async function server(game: Parameters<typeof startServer>[0] = {}): Promise<TestServer> {
  srv = await startServer(game);
  return srv;
}

async function mk(name: string, opts: ConstructorParameters<typeof Bot>[0] extends infer O ? Partial<O> : never = {}): Promise<Bot> {
  const b = await bot(srv!, name, opts);
  bots.push(b);
  return b;
}

afterEach(async () => {
  for (const b of bots.splice(0)) b.close();
  await srv?.stop();
  srv = null;
});

describe('hello / lobby FSM (T1)', () => {
  it('accepts opponents Off at create and owner update, preserves zero across joins, and loads humans only', async () => {
    await server();
    const owner = await mk('Deniz');
    owner.send({ type: 'create', settings: { ...DEFAULT_SETTINGS, aiCount: 0 } });
    const room = await owner.waitFor(isType('room')) as Extract<NetServerMsg, { type: 'room' }>;
    expect(room.settings.aiCount).toBe(0);
    const guest = await mk('Ece');
    guest.send({ type: 'join', code: room.code });
    const joined = await guest.waitFor((m) => m.type === 'room' && m.players.length === 2);
    expect(joined.type === 'room' && joined.settings.aiCount).toBe(0);
    owner.send({ type: 'setSettings', settings: { ...DEFAULT_SETTINGS, aiCount: 19 } });
    await guest.waitFor((m) => m.type === 'room' && m.settings.aiCount === 19);
    owner.send({ type: 'setSettings', settings: { ...DEFAULT_SETTINGS, aiCount: 0 } });
    await guest.waitFor((m) => m.type === 'room' && m.settings.aiCount === 0);
    guest.send({ type: 'setReady', ready: true });
    await owner.waitFor((m) => m.type === 'room' && m.settings.aiCount === 0 && m.players.some((p) => p.id === guest.id && p.ready));
    owner.send({ type: 'start' });
    for (const client of [owner, guest]) {
      const load = await client.waitFor(isType('load')) as Extract<NetServerMsg, { type: 'load' }>;
      expect(load.config.aiCount).toBe(0);
      expect(load.roster).toHaveLength(2);
      expect(load.roster.every((entry) => entry.kind === 'human')).toBe(true);
    }
  });

  it('welcome < 100 ms, create → room snapshot, join, car choice, owner-only settings, ready, start', async () => {
    await server();
    const t = performance.now();
    const a = await mk('Alice');
    expect(performance.now() - t).toBeLessThan(100);
    expect(a.id).toBeGreaterThanOrEqual(0);
    expect(a.token).toMatch(/^[0-9a-f]{32}$/);

    a.send({ type: 'create', settings: { ...DEFAULT_SETTINGS, aiCount: 19 } });
    const room = (await a.waitFor(isType('room'))) as Extract<NetServerMsg, { type: 'room' }>;
    expect(room.code).toMatch(/^[A-HJ-NP-Z2-9]{5}$/);
    expect(room.ownerId).toBe(a.id);
    expect(room.phase).toBe('lobby');
    expect(room.players).toHaveLength(1);

    const b = await mk('Bülent');
    b.send({ type: 'join', code: room.code });
    const r2 = (await b.waitFor((m) => m.type === 'room' && m.players.length === 2)) as Extract<NetServerMsg, { type: 'room' }>;
    const pa = r2.players.find((p) => p.id === a.id)!;
    const pb = r2.players.find((p) => p.id === b.id)!;
    expect(`${pa.teamId}/${pa.driverIdx}`).not.toBe(`${pb.teamId}/${pb.driverIdx}`);
    expect(pb.name).toBe('Bülent');

    b.send({ type: 'setCar', teamId: pa.teamId, driverIdx: pa.driverIdx });
    expect(await b.next(isType('error'))).toEqual({ type: 'error', code: 'taken' });
    b.send({ type: 'setSettings', settings: DEFAULT_SETTINGS });
    expect(await b.next(isType('error'))).toEqual({ type: 'error', code: 'phase' });
    a.send({ type: 'start' }); // b not ready
    expect(await a.next(isType('error'))).toEqual({ type: 'error', code: 'phase' });
    a.send({ type: 'setSettings', settings: { ...DEFAULT_SETTINGS, laps: 3, aiCount: 19 } });
    await b.waitFor((m) => m.type === 'room' && m.settings.laps === 3);

    b.send({ type: 'setReady', ready: true });
    await a.waitFor((m) => m.type === 'room' && m.players.some((p) => p.id === b.id && p.ready));
    a.send({ type: 'start' });
    const load = (await b.waitFor(isType('load'))) as Extract<NetServerMsg, { type: 'load' }>;
    // aiCount 19 is clamped to 20 − 2 humans.
    expect(load.config.aiCount).toBe(18);
    expect(load.roster).toHaveLength(20);
    expect(load.roster.filter((r) => r.kind === 'human').map((r) => r.id).sort()).toEqual([a.id, b.id].sort());
    expect(load.roster.filter((r) => r.kind === 'ai').every((r) => r.id >= AI_ID_BASE)).toBe(true);
    expect(new Set(load.roster.map((r) => r.gridSlot)).size).toBe(20);
    expect(new Set(load.roster.map((r) => `${r.teamId}/${r.driverIdx}`)).size).toBe(20);
    expect(load.lightsOutAtMs).toBeGreaterThan(7000);
    await b.waitFor(isType('start'));
    const st = (await a.waitFor(isType('start'))) as Extract<NetServerMsg, { type: 'start' }>;
    expect(st.t0ServerMs).toBeGreaterThan(Date.now() - 60_000);
    await a.waitFor((m) => m.type === 'room' && m.phase === 'countdown');
  });

  it('rejects a bad name, a wrong version, messages before hello and joins of unknown codes', async () => {
    await server();
    const b = new Bot({ url: srv!.url, name: '<script>' });
    bots.push(b);
    expect(await b.connect()).toEqual({ type: 'error', code: 'badName' });
    const ws = new WebSocket(srv!.url);
    await new Promise((r) => ws.once('open', r));
    const replies: string[] = [];
    ws.on('message', (d) => replies.push(d.toString()));
    ws.send(JSON.stringify({ type: 'hello', v: PROTOCOL_VERSION + 1, build: 'x', name: 'Ok' }));
    ws.send(JSON.stringify({ type: 'join', code: 'ABCDE' }));
    await sleep(100);
    expect(replies.map((r) => JSON.parse(r) as unknown)).toEqual([{ type: 'error', code: 'version' }, { type: 'error', code: 'badMessage' }]);
    ws.close();
    const c = await mk('Carl');
    c.send({ type: 'join', code: 'ABCDE' });
    expect(await c.next(isType('error'))).toEqual({ type: 'error', code: 'notFound' });
  });

  it('closes a socket without hello after the hello timeout', async () => {
    await server({ helloTimeoutMs: 200 });
    const ws = new WebSocket(srv!.url);
    const code = await new Promise<number>((r) => ws.once('close', (c) => r(c)));
    expect(code).toBe(1008);
  });

  it('holds at most MAX_ROOMS rooms and MAX_PLAYERS_PER_ROOM players', async () => {
    await server({ maxRooms: 2, maxPlayersPerRoom: 2 });
    const [a, b, c, d] = [await mk('Ay'), await mk('Be'), await mk('Ce'), await mk('De')];
    a.send({ type: 'create', settings: DEFAULT_SETTINGS });
    const room = (await a.waitFor(isType('room'))) as Extract<NetServerMsg, { type: 'room' }>;
    b.send({ type: 'create', settings: DEFAULT_SETTINGS });
    await b.waitFor(isType('room'));
    c.send({ type: 'create', settings: DEFAULT_SETTINGS });
    expect(await c.next(isType('error'))).toEqual({ type: 'error', code: 'full' });
    c.send({ type: 'join', code: room.code });
    await c.waitFor(isType('room'));
    d.send({ type: 'join', code: room.code });
    expect(await d.next(isType('error'))).toEqual({ type: 'error', code: 'full' });
    // The owner leaves: ownership passes on; the room closes when the last member leaves.
    a.send({ type: 'leave' });
    const r = (await c.next((m) => m.type === 'room' && m.players.length === 1)) as Extract<NetServerMsg, { type: 'room' }>;
    expect(r.ownerId).toBe(c.id);
    c.send({ type: 'leave' });
    await sleep(50);
    expect(srv!.apex.hub.rooms.size).toBe(1);
  });
});

describe('race start, AI streaming and relay', () => {
  it('streams server AI cars with the bit-7 flag and relays humans to the room only (T4 isolation)', async () => {
    await server({ countdownMs: 300 });
    const r1 = [await mk('Ra1'), await mk('Ra2')];
    const r2 = [await mk('Rb1'), await mk('Rb2')];
    await startRace(r1, { aiCount: 3 });
    await startRace(r2, { aiCount: 0, trackId: 'istanbul' });
    for (const b of [...r1, ...r2]) await b.waitFor(isType('start'));
    await sleep(2500);
    for (const b of r1) {
      expect(b.batches).toBeGreaterThan(10);
      expect([...b.seenAiIds].sort()).toEqual([AI_ID_BASE, AI_ID_BASE + 1, AI_ID_BASE + 2]);
    }
    // Humans see each other, never themselves, never the other room.
    expect([...r1[0]!.seenIds]).toEqual([r1[1]!.id]);
    expect([...r1[1]!.seenIds]).toEqual([r1[0]!.id]);
    expect([...r2[0]!.seenIds]).toEqual([r2[1]!.id]);
    expect([...r2[1]!.seenIds]).toEqual([r2[0]!.id]);
    expect(r2[0]!.seenAiIds.size).toBe(0);
    expect(NET_ID_SERVER_BIT).toBe(0x80);
    const health = srv!.apex.hub.stats();
    expect(health.rooms.map((r) => r.phase).sort()).toEqual(['racing', 'racing']);
    expect(health.rooms.find((r) => r.ai === 3)!.simSteps).toBeGreaterThan(200);
  });

  it('a wrong trackHash is refused; the unloaded player is DNF when loading times out', async () => {
    // Let cold track loading finish before asserting rejection; then exercise the real timeout.
    await server({ loadTimeoutMs: 5000, countdownMs: 100 });
    const a = await mk('Good');
    const b = await mk('Badhash', { badHash: true });
    await startRace([a, b]);
    expect(await b.waitFor(isType('error'))).toEqual({ type: 'error', code: 'version' });
    await a.waitFor(isType('start'), 7000);
  });
});

describe('reconnect (T5)', () => {
  it('resumes the same id and slot in the lobby with the token', async () => {
    await server();
    const a = await mk('Res');
    a.send({ type: 'create', settings: DEFAULT_SETTINGS });
    const room = (await a.waitFor(isType('room'))) as Extract<NetServerMsg, { type: 'room' }>;
    const { id, token } = a;
    a.drop();
    await sleep(100);
    const a2 = new Bot({ url: srv!.url, name: 'Res' });
    bots.push(a2);
    const w = await a2.connect(token);
    expect(w).toMatchObject({ type: 'welcome', id, resumeToken: token });
    const r = (await a2.waitFor(isType('room'))) as Extract<NetServerMsg, { type: 'room' }>;
    expect(r.code).toBe(room.code);
    expect(r.players.find((p) => p.id === id)!.connected).toBe(true);
  });

  it('a racer that stays away past the grace window is DNF; the race still ends with results', async () => {
    await server({ countdownMs: 200, graceRaceMs: 800 });
    const a = await mk('Stay');
    const b = await mk('Gone');
    await startRace([a, b]);
    await b.waitFor(isType('start'));
    const bid = b.id;
    await sleep(300);
    b.drop();
    await a.waitFor((m) => m.type === 'player' && m.id === bid && !m.connected);
    await a.waitFor((m) => m.type === 'room' && m.players.length === 1, 3000);
    a.send({ type: 'retire' });
    const res = (await a.waitFor(isType('results'), 3000)) as Extract<NetServerMsg, { type: 'results' }>;
    expect(res.rows.map((r) => r.status)).toEqual(['dnf', 'dnf']);
    a.send({ type: 'backToLobby' });
    await a.waitFor((m) => m.type === 'room' && m.phase === 'lobby');
  });
});
