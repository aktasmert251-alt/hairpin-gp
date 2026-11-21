// D-064 host-in-browser room: the Node server's hub and room behind transport links (in-memory loopback here; MessagePorts and
// RTCDataChannels in the browser). Real bots (local sim under autodrive) race through it like through the ws server.
import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it } from 'vitest';
import type { WebSocket } from 'ws';
import type { NetServerMsg } from '../../../src/contracts/net';
import { createLoopbackPair, type Transport } from '../../../src/net/p2p/transport';
import { Bot } from '../../bots/bot';
import { HostRoom } from '../p2p/hostRoom';
import { isType, sleep, startRace } from './helpers';

/** ws-shaped wrapper over a Transport, for the bot harness. */
function wsOver(t: Transport): WebSocket {
  const em = new EventEmitter();
  Object.defineProperty(em, 'readyState', { get: () => t.readyState });
  Object.assign(em, {
    binaryType: 'nodebuffer',
    send: (d: string | Uint8Array) => t.send(d),
    close: () => t.close(1000),
    terminate: () => t.close(1006),
  });
  t.onopen = () => em.emit('open');
  t.onmessage = (ev) => em.emit('message', Buffer.from(ev.data as string | ArrayBuffer as never), typeof ev.data !== 'string');
  t.onclose = (ev) => em.emit('close', ev.code);
  return em as unknown as WebSocket;
}

interface Rig { room: HostRoom; logs: { event: string; data: Record<string, unknown> }[]; bots: Bot[] }
let rig: Rig | null = null;
afterEach(() => {
  for (const b of rig?.bots ?? []) b.close();
  rig?.room.end();
  rig = null;
});

function host(cfg: ConstructorParameters<typeof HostRoom>[0] = {}): Rig {
  const logs: Rig['logs'] = [];
  const room = new HostRoom({ ...cfg, log: (event, data = {}) => logs.push({ event, data }) });
  rig = { room, logs, bots: [] };
  return rig;
}

async function botOn(r: Rig, name: string, label: string): Promise<Bot> {
  const b = new Bot({
    url: 'p2p:test', name, socket: () => {
      const [client, server] = createLoopbackPair();
      r.room.attach(server, label);
      return wsOver(client);
    },
  });
  r.bots.push(b);
  const w = await b.connect();
  if (w.type !== 'welcome') throw new Error(`no welcome: ${JSON.stringify(w)}`);
  return b;
}

describe('host-in-browser room over loopback transports', () => {
  it('host + 3 guests + 1 server AI: lobby, load, racing traffic with zero strikes, standings', async () => {
    const r = host({ cfg: { countdownMs: 500 } });
    const bots = [await botOn(r, 'Host', 'host')];
    for (let i = 2; i <= 4; i++) bots.push(await botOn(r, `Guest ${i}`, `guest-${i}`));
    await startRace(bots, { trackId: 'bosphorus', laps: 1, aiCount: 1, difficulty: 90 });
    expect(r.room.hub.rooms.size).toBe(1);
    const load = bots[0]!.load!;
    expect(load.roster.filter((e) => e.kind === 'human')).toHaveLength(4);
    expect(load.roster.filter((e) => e.kind === 'ai')).toHaveLength(1);
    await sleep(500 + load.lightsOutAtMs + 5000);
    const race = [...r.room.hub.rooms.values()][0]!.race!;
    for (const b of bots) {
      expect(race.byId[b.id]!.strikes).toBe(0);
      expect(b.sent).toBeGreaterThan(50);
      // Every other human and the AI car reach every client.
      expect(b.seenIds.size).toBe(3);
      expect(b.seenAiIds.size).toBe(1);
      expect(b.msgs.some((m) => m.type === 'standings')).toBe(true);
    }
    expect(r.logs.filter((l) => l.event === 'strike' || l.event === 'badMessage')).toEqual([]);
  }, 60_000);

  it('a second room cannot be created in a host tab (one room per host)', async () => {
    const r = host();
    const a = await botOn(r, 'Host', 'host');
    const b = await botOn(r, 'Guest', 'guest-2');
    a.send({ type: 'create', settings: { trackId: 'bosphorus', laps: 1, tod: 'day', weather: 'dry', aiCount: 0, difficulty: 70 } });
    await a.waitFor(isType('room'));
    b.send({ type: 'create', settings: { trackId: 'bosphorus', laps: 1, tod: 'day', weather: 'dry', aiCount: 0, difficulty: 70 } });
    expect(await b.waitFor(isType('error'))).toEqual({ type: 'error', code: 'full' });
  });

  it('host leaves: the room ends and every guest link closes with 1001', async () => {
    const r = host();
    const bots = [await botOn(r, 'Host', 'host'), await botOn(r, 'Guest A', 'guest-2'), await botOn(r, 'Guest B', 'guest-3')];
    bots[0]!.send({ type: 'create', settings: { trackId: 'bosphorus', laps: 1, tod: 'day', weather: 'dry', aiCount: 0, difficulty: 70 } });
    const room = (await bots[0]!.waitFor(isType('room'))) as Extract<NetServerMsg, { type: 'room' }>;
    for (const b of bots.slice(1)) {
      b.send({ type: 'join', code: room.code });
      await b.waitFor((m) => m.type === 'room' && m.players.some((p) => p.id === b.id));
    }
    r.room.end();
    await sleep(20);
    expect(bots.map((b) => b.closeCode)).toEqual([1001, 1001, 1001]);
    expect(r.room.linkCount()).toBe(0);
    // A link offered after the end is refused at once.
    const [c, s] = createLoopbackPair();
    let code = -1;
    c.onclose = (ev) => (code = ev.code);
    r.room.attach(s, 'guest-9');
    await sleep(10);
    expect(code).toBe(1001);
  });

  it('keeps the transport limits of the ws server: oversized message → 1009, control flood → 1008', async () => {
    const r = host();
    const big = await botOn(r, 'Big', 'guest-2');
    big.sendRaw('x'.repeat(2000));
    await sleep(20);
    expect(big.closeCode).toBe(1009);
    const flood = await botOn(r, 'Flood', 'guest-3');
    for (let i = 0; i < 60; i++) flood.send({ type: 'listRooms' });
    await sleep(20);
    expect(flood.closeCode).toBe(1008);
    expect(r.logs.some((l) => l.event === 'wsFlood' && l.data.net === 'guest-3')).toBe(true);
  });

  it('link stats feed the lobby ping; a reconnecting guest resumes its player on a new link', async () => {
    const r = host();
    const a = await botOn(r, 'Host', 'host');
    const g = await botOn(r, 'Guest', 'guest-2');
    a.send({ type: 'create', settings: { trackId: 'bosphorus', laps: 1, tod: 'day', weather: 'dry', aiCount: 0, difficulty: 70 } });
    const room = (await a.waitFor(isType('room'))) as Extract<NetServerMsg, { type: 'room' }>;
    g.send({ type: 'join', code: room.code });
    await g.waitFor((m) => m.type === 'room' && m.players.length === 2);
    r.room.linkStats('guest-2', 42.4, 0);
    a.send({ type: 'setReady', ready: false });
    const snap = (await a.next((m) => m.type === 'room')) as Extract<NetServerMsg, { type: 'room' }>;
    expect(snap.players.find((p) => p.id === g.id)!.pingMs).toBe(42);
    // The data channel drops; the guest comes back on a new link (new invite) with its resume token.
    const id = g.id;
    const token = g.token;
    g.drop();
    await a.waitFor((m) => m.type === 'room' && m.players.some((p) => p.id === id && !p.connected));
    const back = new Bot({ url: 'p2p:test', name: 'Guest', socket: () => {
      const [client, server] = createLoopbackPair();
      r.room.attach(server, 'guest-3');
      return wsOver(client);
    } });
    r.bots.push(back);
    const w = await back.connect(token);
    expect(w).toMatchObject({ type: 'welcome', id });
    await a.waitFor((m) => m.type === 'room' && m.players.some((p) => p.id === id && p.connected));
  });
});
