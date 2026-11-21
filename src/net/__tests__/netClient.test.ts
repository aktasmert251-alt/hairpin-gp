import { describe, expect, it } from 'vitest';
import type { NetCarState, NetLobbyModel, NetRoomSettings } from '../../contracts/net';
import { NET_STATE_BYTES, PROTOCOL_VERSION } from '../../contracts/net';
import { createStore } from '../../core/store';
import {
  DEVICE_ID_KEY, OFFLINE_LOBBY, RECONNECT_BACKOFF_MS, deviceIdFrom, RECONNECT_GRACE_MS, createNetClient, defaultServerUrl, type SocketLike,
} from '../netClient';
import {
  MSG_PING, MSG_STATE, batchBytes, encodePong, newNetCarState, viewOf, writeBatchEntry, writeBatchHeader,
} from '../protocol';

const TOKEN = '0123456789abcdef0123456789abcdef';
const SETTINGS: NetRoomSettings = { trackId: 'bosphorus', laps: 1, tod: 'day', weather: 'dry', aiCount: 0, difficulty: 70 };

class MockSocket implements SocketLike {
  binaryType = 'blob';
  readyState = 0;
  onopen: ((ev: unknown) => void) | null = null;
  onclose: ((ev: { code: number }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  readonly sent: (string | Uint8Array)[] = [];
  constructor(readonly url: string) {}
  send(d: string | ArrayBufferView | ArrayBuffer): void {
    this.sent.push(typeof d === 'string' ? d : new Uint8Array(d instanceof ArrayBuffer ? d : d.buffer).slice());
  }
  close(): void {
    this.readyState = 3;
  }
  open(): void {
    this.readyState = 1;
    this.onopen?.({});
  }
  json(): Record<string, unknown>[] {
    return this.sent.filter((d): d is string => typeof d === 'string').map((d) => JSON.parse(d) as Record<string, unknown>);
  }
  recv(o: unknown): void {
    this.onmessage?.({ data: JSON.stringify(o) });
  }
  recvBin(u8: Uint8Array): void {
    this.onmessage?.({ data: u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) });
  }
  drop(code = 1006): void {
    this.readyState = 3;
    this.onclose?.({ code });
  }
}

function harness() {
  let t = 1000;
  const sockets: MockSocket[] = [];
  const timers: { at: number; cb: () => void; every: number; id: number }[] = [];
  let ids = 0;
  const mem = new Map<string, string>();
  const local = new Map<string, string>();
  const lobby = createStore<NetLobbyModel>({ ...OFFLINE_LOBBY });
  const client = createNetClient({ url: 'ws://test/ws', name: 'Ayşe', build: 'test', lobby }, {
    now: () => t,
    socket: (url) => {
      const s = new MockSocket(url);
      sockets.push(s);
      return s;
    },
    storage: { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => void mem.set(k, v), removeItem: (k) => void mem.delete(k) },
    deviceStorage: { getItem: (k) => local.get(k) ?? null, setItem: (k, v) => void local.set(k, v), removeItem: (k) => void local.delete(k) },
    randomBytes: (n) => new Uint8Array(n).fill(0xfb),
    setTimeout: (cb, ms) => (timers.push({ at: t + ms, cb, every: 0, id: ++ids }), ids),
    clearTimeout: (h) => void timers.splice(timers.findIndex((x) => x.id === h) >>> 0, timers.some((x) => x.id === h) ? 1 : 0),
    setInterval: (cb, ms) => (timers.push({ at: t + ms, cb, every: ms, id: ++ids }), ids),
    clearInterval: (h) => void timers.splice(timers.findIndex((x) => x.id === h) >>> 0, timers.some((x) => x.id === h) ? 1 : 0),
  });
  const advance = (ms: number): void => {
    const end = t + ms;
    for (;;) {
      timers.sort((a, b) => a.at - b.at);
      const next = timers[0];
      if (!next || next.at > end) break;
      t = next.at;
      if (next.every > 0) next.at += next.every;
      else timers.shift();
      next.cb();
    }
    t = end;
  };
  const welcome = (s: MockSocket, id = 3): void => s.recv({ type: 'welcome', id, resumeToken: TOKEN, serverMs: 5000, limits: { maxPlayers: 20, hz: 20 } });
  return { client, lobby, sockets, mem, local, advance, welcome, now: () => t };
}

describe('netClient', () => {
  it('default URL: ?server= override, else same-origin /ws (wss on https)', () => {
    expect(defaultServerUrl('wss://x.example/ws', { protocol: 'http:', host: 'a' })).toBe('wss://x.example/ws');
    expect(defaultServerUrl(null, { protocol: 'https:', host: 'hairpin.duckdns.org' })).toBe('wss://hairpin.duckdns.org/ws');
    expect(defaultServerUrl(null, { protocol: 'http:', host: 'localhost:5173' })).toBe('ws://localhost:5173/ws');
  });

  it('says hello on open, queues control messages until welcome, stores the resume token and fills the lobby store', () => {
    const h = harness();
    h.client.connect();
    expect(h.lobby.get().status).toBe('connecting');
    h.client.send({ type: 'create', settings: SETTINGS });
    const s = h.sockets[0]!;
    s.open();
    expect(s.binaryType).toBe('arraybuffer');
    const hello = s.json()[0]!;
    expect(hello).toEqual({ type: 'hello', v: PROTOCOL_VERSION, build: 'test', name: 'Ayşe', deviceId: '-_v7-_v7-_v7-_v7-_v7-w' });
    expect(h.local.get(DEVICE_ID_KEY)).toBe(hello.deviceId); // D-050: created once, kept in localStorage
    expect(s.sent.some((d) => d instanceof Uint8Array && d[0] === MSG_PING)).toBe(true);
    expect(s.json().some((m) => m.type === 'create')).toBe(false);
    h.welcome(s);
    expect(h.lobby.get().status).toBe('online');
    expect(h.lobby.get().myId).toBe(3);
    expect(h.mem.get('apex.net.resume')).toBe(TOKEN);
    expect(s.json().at(-1)).toEqual({ type: 'create', settings: SETTINGS });
    s.recv({ type: 'room', code: 'ABCDE', ownerId: 3, phase: 'lobby', settings: SETTINGS, players: [
      { id: 3, name: 'Ayşe', teamId: 'anka', driverIdx: 0, ready: false, connected: true, pingMs: 12 },
    ] });
    expect(h.lobby.get().room?.code).toBe('ABCDE');
    s.recv({ type: 'start', t0ServerMs: 9000 });
    expect(h.lobby.get().t0ServerMs).toBe(9000);
    s.recv({ type: 'error', code: 'full' });
    expect(h.lobby.get().error).toBe('full');
    // Invalid server JSON is dropped, never thrown.
    s.recv({ type: 'room', code: '<script>' });
    expect(h.client.stats().dropped).toBeGreaterThan(0);
  });

  it('pongs feed the clock (offset, RTT) and the lobby rttMs', () => {
    const h = harness();
    h.client.connect();
    const s = h.sockets[0]!;
    s.open();
    const sendAt = h.now();
    h.advance(40); // 40 ms RTT
    const pong = new Uint8Array(20);
    encodePong(0, sendAt, 100_000, viewOf(pong));
    s.recvBin(pong);
    expect(h.client.clock.rttMs()).toBe(40);
    expect(h.client.serverNow()).toBeCloseTo(100_000 + 20, 6); // server stamp + half the RTT
    expect(h.lobby.get().rttMs).toBe(40);
    expect(h.client.stats().offsetMs).toBeCloseTo(100_000 - (sendAt + 20), 6);
  });

  it('decodes a 20-car batch into the states listener (reused entry object, D-048)', () => {
    const h = harness();
    h.client.connect();
    const s = h.sockets[0]!;
    s.open();
    h.welcome(s);
    const buf = new Uint8Array(batchBytes(20));
    const dv = viewOf(buf);
    writeBatchHeader(dv, 20, 7, 123_456);
    const st = newNetCarState();
    for (let k = 0; k < 20; k++) {
      st.x = k * 10;
      st.simMs = 1000 + k;
      writeBatchEntry(dv, k, k < 12 ? k : 64 + k, k >= 12, st);
    }
    const got: { id: number; fromServer: boolean; x: number }[] = [];
    let same = true;
    let first: Readonly<NetCarState> | null = null;
    h.client.onStates((e, serverMs) => {
      expect(serverMs).toBe(123_456);
      first ??= e;
      same &&= first === e;
      got.push({ id: e.id, fromServer: e.fromServer, x: e.x });
    });
    s.recvBin(buf);
    expect(got.length).toBe(20);
    expect(same).toBe(true);
    expect(got[3]).toEqual({ id: 3, fromServer: false, x: 30 });
    expect(got[15]).toEqual({ id: 79, fromServer: true, x: 150 });
  });

  it('sends 40-byte states, rate-limits control and state messages', () => {
    const h = harness();
    h.client.connect();
    const s = h.sockets[0]!;
    s.open();
    h.welcome(s);
    const st: NetCarState = newNetCarState();
    expect(h.client.sendState(st)).toBe(true);
    const bin = s.sent.filter((d): d is Uint8Array => d instanceof Uint8Array && d[0] === MSG_STATE);
    expect(bin[0]!.length).toBe(NET_STATE_BYTES);
    let ok = 0;
    for (let i = 0; i < 30; i++) if (h.client.sendState(st)) ok++;
    expect(ok).toBeLessThan(30); // burst 10
    h.advance(1000);
    expect(h.client.sendState(st)).toBe(true);
    let ctl = 0;
    for (let i = 0; i < 20; i++) if (h.client.send({ type: 'setReady', ready: i % 2 === 0 })) ctl++;
    expect(ctl).toBe(10);
  });

  it('reconnects with backoff and resumes with the token; gives up after the grace period', () => {
    const h = harness();
    h.client.connect();
    h.sockets[0]!.open();
    h.welcome(h.sockets[0]!);
    h.sockets[0]!.drop();
    expect(h.lobby.get().status).toBe('reconnecting');
    expect(h.sockets.length).toBe(1);
    h.advance(RECONNECT_BACKOFF_MS[0]!);
    expect(h.sockets.length).toBe(2);
    const s2 = h.sockets[1]!;
    s2.open();
    expect(s2.json()[0]).toMatchObject({ type: 'hello', resume: TOKEN });
    h.welcome(s2);
    expect(h.lobby.get().status).toBe('online');
    // Now the server stays away: 0.5, 1, 2, 4, 4 … s until 60 s, then 'error'.
    s2.drop();
    h.advance(RECONNECT_BACKOFF_MS[0]!);
    expect(h.sockets.length).toBe(3);
    h.sockets[2]!.drop();
    h.advance(RECONNECT_BACKOFF_MS[1]! - 1);
    expect(h.sockets.length).toBe(3);
    h.advance(1);
    expect(h.sockets.length).toBe(4);
    h.sockets[3]!.drop();
    for (let i = 0; i < 40 && h.lobby.get().status === 'reconnecting'; i++) {
      h.advance(4000);
      const last = h.sockets.at(-1)!;
      if (last.readyState === 0) last.drop();
    }
    expect(h.lobby.get().status).toBe('error');
    expect(h.now()).toBeGreaterThan(1000 + RECONNECT_GRACE_MS);
  });

  it('does not reconnect after a version error, a 1008 kick or close()', () => {
    const h = harness();
    h.client.connect();
    const s = h.sockets[0]!;
    s.open();
    s.recv({ type: 'error', code: 'version' });
    expect(h.lobby.get().status).toBe('error');
    h.advance(10_000);
    expect(h.sockets.length).toBe(1);

    const k = harness();
    k.client.connect();
    k.sockets[0]!.open();
    k.welcome(k.sockets[0]!);
    k.sockets[0]!.drop(1008);
    k.advance(10_000);
    expect(k.sockets.length).toBe(1);

    const c = harness();
    c.client.connect();
    c.sockets[0]!.open();
    c.welcome(c.sockets[0]!);
    c.sockets[0]!.recv({ type: 'room', code: 'ABCDE', ownerId: 3, phase: 'lobby', settings: SETTINGS, players: [] });
    c.client.close(true);
    expect(c.sockets[0]!.json().at(-1)).toEqual({ type: 'leave' });
    expect(c.lobby.get()).toMatchObject({ status: 'offline', room: null });
    expect(c.mem.has('apex.net.resume')).toBe(false);
    c.advance(10_000);
    expect(c.sockets.length).toBe(1);
  });
});

describe('netClient D-050 (device id, notice, kicked, maintenance)', () => {
  it('device id: reused from storage, a fresh valid one otherwise, per-session when storage is blocked', () => {
    const store = new Map<string, string>([[DEVICE_ID_KEY, 'existing-device-id-01']]);
    const s = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: () => {} };
    expect(deviceIdFrom(s, () => new Uint8Array(16))).toBe('existing-device-id-01');
    store.set(DEVICE_ID_KEY, '<bad>');
    const fresh = deviceIdFrom(s, (n) => new Uint8Array(n).fill(1));
    expect(fresh).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(store.get(DEVICE_ID_KEY)).toBe(fresh);
    const blocked = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => {} };
    const a = deviceIdFrom(blocked, (n) => new Uint8Array(n).fill(2));
    expect(deviceIdFrom(blocked, (n) => new Uint8Array(n).fill(3))).toBe(a);
    expect(deviceIdFrom(null, (n) => new Uint8Array(n).fill(4))).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });

  it('notice fills the lobby store ("" clears it)', () => {
    const h = harness();
    h.client.connect();
    const s = h.sockets[0]!;
    s.open();
    h.welcome(s);
    s.recv({ type: 'notice', text: 'Restart at 22:00' });
    expect(h.lobby.get().notice).toBe('Restart at 22:00');
    s.recv({ type: 'notice', text: '' });
    expect(h.lobby.get().notice).toBeNull();
  });

  it('kicked message or close 4001 / 4003: reason surfaced, resume token dropped, no reconnect', () => {
    const h = harness();
    h.client.connect();
    h.sockets[0]!.open();
    h.welcome(h.sockets[0]!);
    h.sockets[0]!.recv({ type: 'kicked', reason: 'banned', until: 123 });
    h.sockets[0]!.drop(4003);
    expect(h.lobby.get()).toMatchObject({ status: 'error', kicked: { reason: 'banned', until: 123 } });
    expect(h.mem.has('apex.net.resume')).toBe(false);
    h.advance(30_000);
    expect(h.sockets.length).toBe(1);

    for (const [code, reason] of [[4001, 'kicked'], [4003, 'banned']] as const) {
      const k = harness();
      k.client.connect();
      k.sockets[0]!.open();
      k.welcome(k.sockets[0]!);
      k.sockets[0]!.drop(code);
      expect(k.lobby.get()).toMatchObject({ status: 'error', kicked: { reason, until: null } });
      k.advance(30_000);
      expect(k.sockets.length).toBe(1);
      // A new connect() (the player tries again) clears the old reason.
      k.client.connect();
      expect(k.lobby.get().kicked).toBeNull();
    }
  });

  it("maintenance is an error code like 'full'", () => {
    const h = harness();
    h.client.connect();
    h.sockets[0]!.open();
    h.welcome(h.sockets[0]!);
    h.sockets[0]!.recv({ type: 'error', code: 'maintenance' });
    expect(h.lobby.get()).toMatchObject({ status: 'online', error: 'maintenance' });
  });
});

describe('D-052 directory client', () => {
  it('sends directory controls through the control bucket and replaces directory snapshots', () => {
    const h = harness(); h.client.connect(); const s = h.sockets[0]!; s.open(); h.welcome(s);
    expect(h.client.listRooms()).toBe(true);
    expect(h.client.quickJoin()).toBe(true);
    expect(s.json().slice(-2)).toEqual([{ type: 'listRooms' }, { type: 'quickJoin' }]);
    const rooms = [{ code: 'APX27', track: 'istanbul', laps: 5, weather: 'dry', tod: 'day', humans: 1, capacity: 20, state: 'lobby', owner: 'Deniz' }];
    s.recv({ type: 'rooms', rooms }); expect(h.lobby.get().rooms).toEqual(rooms);
    s.recv({ type: 'rooms', rooms: [] }); expect(h.lobby.get().rooms).toEqual([]);
    for (let i = 0; i < 8; i++) expect(h.client.listRooms()).toBe(true);
    expect(h.client.quickJoin()).toBe(false);
    h.advance(1000); expect(h.client.listRooms()).toBe(true);
    h.client.close();
  });
});
