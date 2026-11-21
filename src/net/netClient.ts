// Online client (design §5.3, §7.1, §8, §11.3; multiplayer-tasks A.2): one WebSocket to `/ws`, hello / resume token, reconnect
// with backoff inside the server's grace period, ping/pong → clock.ts, strict parsing (parseServerMessage / binary codecs),
// client-side rate limits matching the server's buckets, NetStats and the lobby store the UI reads (UiDeps.net).
// Not sim layer: it reads the wall clock and the WebSocket / sessionStorage globals (all injectable for tests and Node).

import type { Unsubscribe } from '../contracts/common';
import type { NetCarState, NetClientMsg, NetContact, NetLobbyModel, NetServerMsg, NetStats } from '../contracts/net';
import { NET_STATE_BYTES, PROTOCOL_VERSION } from '../contracts/net';
import type { Store } from '../contracts/ui';
import { createClockSync, type ClockSync } from './clock';
import {
  CLOSE_BANNED, CLOSE_KICKED, CONTACT_BYTES, DEVICE_ID_RE, MSG_CONTACT, MSG_CONTACT_RELAY, MSG_PONG, MSG_STATES, PING_BYTES, decodeBatchEntry, decodeBatchHeader, decodeContact,
  decodePong, encodeContact, encodePing, encodeState, newNetCarState, newNetContact, parseServerMessage, type NetBatchHeader, type NetPongMsg,
} from './protocol';

/** Reconnect delays (design: 0.5 / 1 / 2 / 4 s, then every 4 s) until the grace period ends. */
export const RECONNECT_BACKOFF_MS: readonly number[] = [500, 1000, 2000, 4000];
/** Server grace in a race (D-045: 60 s); after it the client gives up (status 'error'). */
export const RECONNECT_GRACE_MS = 60_000;
/** Ping every 1 s outside a race, every 2 s in a race (design §5.3). */
export const PING_LOBBY_MS = 1000;
export const PING_RACE_MS = 2000;
/** Client-side token buckets, mirroring the server (design §7.1): control 5/s burst 10, state+contact 30/s burst 10. */
export const CONTROL_RATE = { perS: 5, burst: 10 };
export const STATE_RATE = { perS: 30, burst: 10 };
export const RESUME_KEY = 'apex.net.resume';
/** D-050/D-055: per-browser device id for bans and feedback abuse limits, kept in localStorage. */
export const DEVICE_ID_KEY = 'apexgp:v1:deviceId';

/** Minimal WebSocket surface (browser WebSocket and Node 24's global WebSocket both fit). */
export interface SocketLike {
  binaryType: string;
  readonly readyState: number;
  onopen: ((ev: unknown) => void) | null;
  onclose: ((ev: { code: number }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  send(data: string | ArrayBufferView | ArrayBuffer): void;
  close(code?: number, reason?: string): void;
}

export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export interface NetClientDeps {
  /** Wall clock in ms (default performance.now). */
  now?(): number;
  /** Socket factory (default `new WebSocket(url)`). */
  socket?(url: string): SocketLike;
  /** Resume-token store (default sessionStorage when present; null = none). */
  storage?: StorageLike | null;
  /** Device-id store (default localStorage when present; null = a per-session id). */
  deviceStorage?: StorageLike | null;
  /** 16 random bytes (default crypto.getRandomValues). */
  randomBytes?(n: number): Uint8Array;
  setTimeout?(cb: () => void, ms: number): unknown;
  clearTimeout?(h: unknown): void;
  setInterval?(cb: () => void, ms: number): unknown;
  clearInterval?(h: unknown): void;
}

export interface NetClientOptions {
  url: string;
  name: string;
  build: string;
  /** The lobby store to drive (main.ts owns it so UiDeps.net exists before the client loads). */
  lobby: Store<NetLobbyModel>;
}

/** Batch entries are delivered one by one into a reused object (allocation-free); `serverMs` from the batch header. */
export type StatesListener = (entry: Readonly<NetCarState>, serverMs: number) => void;
export type ContactListener = (c: Readonly<NetContact>) => void;
export type MessageListener = (m: NetServerMsg) => void;
export type StatusListener = (state: NetLobbyModel['status'], rttMs: number) => void;

export interface NetClient {
  readonly lobby: Store<NetLobbyModel>;
  readonly clock: ClockSync;
  /** Opens the socket (no-op when already open / connecting). */
  connect(): void;
  /** Rate-limited JSON control message; queued until `welcome`. False when dropped. */
  send(m: NetClientMsg): boolean;
  /** Optional for pre-directory client adapters. The concrete client always provides these methods. */
  listRooms?(): boolean;
  quickJoin?(): boolean;
  /** Binary `state` (40 B). False when not connected or rate-limited. */
  sendState(s: NetCarState): boolean;
  /** Binary `contact` (28 B, P3c glue). */
  sendContact(c: NetContact): boolean;
  onMessage(cb: MessageListener): Unsubscribe;
  onStates(cb: StatesListener): Unsubscribe;
  onContact(cb: ContactListener): Unsubscribe;
  onStatus(cb: StatusListener): Unsubscribe;
  /** Server time estimate now (ms). */
  serverNow(): number;
  stats(): NetStats;
  /** Puppets past their extrapolation horizon (written by the online session). */
  setStaleCars(n: number): void;
  /** Closes for good (no reconnect); `forget` drops the resume token too. */
  close(forget?: boolean): void;
}

interface Bucket { tokens: number; at: number }

function take(b: Bucket, rate: { perS: number; burst: number }, now: number): boolean {
  b.tokens = Math.min(rate.burst, b.tokens + ((now - b.at) / 1000) * rate.perS);
  b.at = now;
  if (b.tokens < 1) return false;
  b.tokens -= 1;
  return true;
}

function base64url(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]!);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

let sessionDeviceId: string | null = null;

/**
 * D-050: the browser's device id: 16 random bytes base64url (22 chars), created once and kept in `store`; when the store is
 * missing or blocked, one id per page session.
 */
export function deviceIdFrom(store: StorageLike | null, rnd: (n: number) => Uint8Array): string {
  try {
    const v = store?.getItem(DEVICE_ID_KEY) ?? null;
    if (v && DEVICE_ID_RE.test(v)) return v;
  } catch {
    /* blocked storage: fall through */
  }
  const id = store ? base64url(rnd(16)) : (sessionDeviceId ??= base64url(rnd(16)));
  try {
    store?.setItem(DEVICE_ID_KEY, id);
  } catch {
    return (sessionDeviceId ??= id);
  }
  return id;
}

function defaultLocalStorage(): StorageLike | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

function defaultStorage(): StorageLike | null {
  try {
    return typeof sessionStorage !== 'undefined' ? sessionStorage : null;
  } catch {
    return null;
  }
}

/** Default server URL (design §11.3): the `?server=` override, else same origin `/ws` (wss on https pages). */
export function defaultServerUrl(override: string | null | undefined, loc: { protocol: string; host: string } | null): string {
  if (override) return override;
  if (!loc) return 'ws://localhost:8787/ws';
  return `${loc.protocol === 'https:' ? 'wss' : 'ws'}://${loc.host}/ws`;
}

export const OFFLINE_LOBBY: Readonly<NetLobbyModel> = { status: 'offline', error: null, myId: null, room: null, t0ServerMs: null, rttMs: 0 };

export function createNetClient(opts: NetClientOptions, deps: NetClientDeps = {}): NetClient & { listRooms(): boolean; quickJoin(): boolean } {
  const now = deps.now ?? (() => performance.now());
  const mkSocket = deps.socket ?? ((url: string) => new WebSocket(url) as unknown as SocketLike);
  const storage = deps.storage === undefined ? defaultStorage() : deps.storage;
  const deviceId = deviceIdFrom(deps.deviceStorage === undefined ? defaultLocalStorage() : deps.deviceStorage,
    deps.randomBytes ?? ((n) => crypto.getRandomValues(new Uint8Array(n))));
  const setT = deps.setTimeout ?? ((cb: () => void, ms: number) => setTimeout(cb, ms));
  const clearT = deps.clearTimeout ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const setI = deps.setInterval ?? ((cb: () => void, ms: number) => setInterval(cb, ms));
  const clearI = deps.clearInterval ?? ((h: unknown) => clearInterval(h as ReturnType<typeof setInterval>));
  const lobby = opts.lobby;
  const clock = createClockSync();

  let ws: SocketLike | null = null;
  let welcomed = false;
  let closedForGood = false;
  let attempt = 0;
  let lostAt = -1;
  let retryTimer: unknown = null;
  let pingTimer: unknown = null;
  let pingEvery = 0;
  let pingSeq = 0;
  let pending: NetClientMsg[] = [];
  let sent = 0;
  let recv = 0;
  let dropped = 0;
  let staleCars = 0;
  const ctl: Bucket = { tokens: CONTROL_RATE.burst, at: now() };
  const bin: Bucket = { tokens: STATE_RATE.burst, at: now() };

  let msgCbs: readonly MessageListener[] = [];
  let stateCbs: readonly StatesListener[] = [];
  let contactCbs: readonly ContactListener[] = [];
  let statusCbs: readonly StatusListener[] = [];

  const pingBuf = new Uint8Array(PING_BYTES);
  const pingView = new DataView(pingBuf.buffer);
  const stateBuf = new Uint8Array(NET_STATE_BYTES);
  const stateView = new DataView(stateBuf.buffer);
  const contactBuf = new Uint8Array(CONTACT_BYTES);
  const contactView = new DataView(contactBuf.buffer);
  const pong: NetPongMsg = { seq: 0, clientMs: 0, serverMs: 0 };
  const hdr: NetBatchHeader = { count: 0, serverSeq: 0, serverMs: 0 };
  const entry = newNetCarState();
  const contact = newNetContact();

  const rtt = (): number => {
    const r = clock.rttMs();
    return Number.isFinite(r) ? r : 0;
  };

  const setStatus = (status: NetLobbyModel['status'], patch: Partial<NetLobbyModel> = {}): void => {
    const changed = lobby.get().status !== status;
    lobby.set({ ...patch, status });
    if (changed) for (const cb of statusCbs) cb(status, rtt());
  };

  const rawSend = (data: string | Uint8Array): boolean => {
    if (!ws || ws.readyState !== 1) {
      dropped++;
      return false;
    }
    ws.send(data);
    sent++;
    return true;
  };

  const sendPing = (): void => {
    encodePing(pingSeq++, now(), pingView);
    rawSend(pingBuf);
  };

  const schedulePing = (): void => {
    const phase = lobby.get().room?.phase;
    const every = phase === 'countdown' || phase === 'racing' || phase === 'finishing' ? PING_RACE_MS : PING_LOBBY_MS;
    if (every === pingEvery && pingTimer !== null) return;
    if (pingTimer !== null) clearI(pingTimer);
    pingEvery = every;
    pingTimer = setI(sendPing, every);
  };

  const stopTimers = (): void => {
    if (pingTimer !== null) clearI(pingTimer);
    pingTimer = null;
    pingEvery = 0;
    if (retryTimer !== null) clearT(retryTimer);
    retryTimer = null;
  };

  const onText = (text: string): void => {
    const m = parseServerMessage(text);
    if (!m) {
      dropped++;
      return;
    }
    recv++;
    switch (m.type) {
      case 'welcome':
        welcomed = true;
        attempt = 0;
        lostAt = -1;
        try {
          storage?.setItem(RESUME_KEY, m.resumeToken);
        } catch {
          /* storage may be blocked */
        }
        setStatus('online', { myId: m.id, error: null, notice: null });
        for (const p of pending) send(p);
        pending = [];
        break;
      case 'rooms':
        lobby.set({ rooms: m.rooms, error: null });
        break;
      case 'room':
        lobby.set({
          room: { code: m.code, ownerId: m.ownerId, phase: m.phase, settings: m.settings, players: m.players, teams: m.teams ?? [] },
          t0ServerMs: m.phase === 'countdown' || m.phase === 'racing' || m.phase === 'finishing' ? lobby.get().t0ServerMs : null,
        });
        schedulePing();
        break;
      case 'start':
        lobby.set({ t0ServerMs: m.t0ServerMs });
        break;
      case 'notice':
        lobby.set({ notice: m.text || null });
        break;
      case 'kicked':
        // D-050: the close (4001 / 4003) follows; never resume after it.
        lobby.set({ kicked: { reason: m.reason, until: m.until ?? null } });
        closeForGood(true, 'error');
        break;
      case 'error':
        lobby.set({ error: m.code });
        if (m.code === 'version') closeForGood(false, 'error');
        break;
      default:
        break;
    }
    for (const cb of msgCbs) cb(m);
  };

  const onBinary = (u8: Uint8Array): void => {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const t = u8.length > 0 ? u8[0] : -1;
    if (t === MSG_PONG) {
      if (!decodePong(dv, pong)) {
        dropped++;
        return;
      }
      recv++;
      clock.addSample(pong.clientMs, pong.serverMs, now());
      const r = rtt();
      if (Math.abs(r - lobby.get().rttMs) >= 1) lobby.set({ rttMs: Math.round(r) });
    } else if (t === MSG_STATES) {
      if (!decodeBatchHeader(dv, hdr)) {
        dropped++;
        return;
      }
      recv++;
      for (let k = 0; k < hdr.count; k++) {
        if (!decodeBatchEntry(dv, k, entry)) {
          dropped++;
          continue;
        }
        for (let i = 0; i < stateCbs.length; i++) stateCbs[i]!(entry, hdr.serverMs);
      }
    } else if (t === MSG_CONTACT_RELAY) {
      if (!decodeContact(dv, MSG_CONTACT_RELAY, contact)) {
        dropped++;
        return;
      }
      recv++;
      for (const cb of contactCbs) cb(contact);
    } else dropped++;
  };

  const scheduleReconnect = (): void => {
    if (closedForGood) return;
    if (lostAt < 0) lostAt = now();
    if (now() - lostAt >= RECONNECT_GRACE_MS) {
      closeForGood(false, 'error');
      return;
    }
    setStatus('reconnecting');
    const delay = RECONNECT_BACKOFF_MS[Math.min(attempt, RECONNECT_BACKOFF_MS.length - 1)]!;
    attempt++;
    retryTimer = setT(() => {
      retryTimer = null;
      open();
    }, delay);
  };

  const open = (): void => {
    if (closedForGood || ws) return;
    let sock: SocketLike;
    try {
      sock = mkSocket(opts.url);
    } catch {
      scheduleReconnect();
      return;
    }
    ws = sock;
    welcomed = false;
    sock.binaryType = 'arraybuffer';
    if (lobby.get().status !== 'reconnecting') setStatus('connecting');
    sock.onopen = () => {
      if (ws !== sock) return;
      let resume: string | null = null;
      try {
        resume = storage?.getItem(RESUME_KEY) ?? null;
      } catch {
        resume = null;
      }
      const hello: NetClientMsg = resume && /^[0-9a-f]{32}$/.test(resume)
        ? { type: 'hello', v: PROTOCOL_VERSION, build: opts.build, name: opts.name, resume, deviceId }
        : { type: 'hello', v: PROTOCOL_VERSION, build: opts.build, name: opts.name, deviceId };
      rawSend(JSON.stringify(hello));
      sendPing();
      schedulePing();
    };
    sock.onmessage = (ev) => {
      if (ws !== sock) return;
      const d = ev.data;
      if (typeof d === 'string') onText(d);
      else if (d instanceof ArrayBuffer) onBinary(new Uint8Array(d));
      else if (ArrayBuffer.isView(d)) onBinary(new Uint8Array(d.buffer, d.byteOffset, d.byteLength));
      else dropped++;
    };
    sock.onerror = () => {
      /* a close event follows */
    };
    sock.onclose = (ev) => {
      if (ws !== sock) return;
      ws = null;
      if (pingTimer !== null) clearI(pingTimer);
      pingTimer = null;
      pingEvery = 0;
      // 1008 = kicked for bad messages, 4000 = another tab resumed this player: reconnecting would only fight it.
      if (ev.code === CLOSE_KICKED || ev.code === CLOSE_BANNED) {
        // D-050 (a close without the `kicked` message, e.g. a banned hello): surface it, never resume.
        if (!lobby.get().kicked) lobby.set({ kicked: { reason: ev.code === CLOSE_BANNED ? 'banned' : 'kicked', until: null } });
        closeForGood(true, 'error');
      } else if (ev.code === 1008 || ev.code === 4000) closeForGood(false, 'error');
      else scheduleReconnect();
    };
  };

  const closeForGood = (forget: boolean, status: NetLobbyModel['status']): void => {
    closedForGood = true;
    stopTimers();
    const s = ws;
    ws = null;
    if (s) {
      s.onclose = null;
      s.onmessage = null;
      try {
        s.close(1000, 'bye');
      } catch {
        /* already closed */
      }
    }
    if (forget) {
      try {
        storage?.removeItem(RESUME_KEY);
      } catch {
        /* ignore */
      }
    }
    pending = [];
    setStatus(status, status === 'offline' ? { room: null, myId: null, t0ServerMs: null } : {});
  };

  function send(m: NetClientMsg): boolean {
    if (closedForGood) return false;
    if (!welcomed) {
      if (m.type !== 'hello') pending.push(m);
      return true;
    }
    if (!take(ctl, CONTROL_RATE, now())) {
      dropped++;
      return false;
    }
    if (m.type === 'leave') lobby.set({ room: null, t0ServerMs: null });
    return rawSend(JSON.stringify(m));
  }

  const subscribe = <T>(get: () => readonly T[], set: (v: readonly T[]) => void, cb: T): Unsubscribe => {
    set([...get(), cb]);
    return () => set(get().filter((x) => x !== cb));
  };

  return {
    lobby,
    clock,
    connect() {
      closedForGood = false;
      if (lobby.get().kicked) lobby.set({ kicked: null });
      attempt = 0;
      lostAt = -1;
      open();
    },
    send,
    listRooms: () => send({ type: 'listRooms' }),
    quickJoin: () => send({ type: 'quickJoin' }),
    sendState(s) {
      if (!welcomed || !take(bin, STATE_RATE, now())) {
        dropped++;
        return false;
      }
      encodeState(s, stateView);
      return rawSend(stateBuf);
    },
    sendContact(c) {
      if (!welcomed || !take(bin, STATE_RATE, now())) {
        dropped++;
        return false;
      }
      encodeContact(c, MSG_CONTACT, contactView);
      return rawSend(contactBuf);
    },
    onMessage: (cb) => subscribe(() => msgCbs, (v) => (msgCbs = v), cb),
    onStates: (cb) => subscribe(() => stateCbs, (v) => (stateCbs = v), cb),
    onContact: (cb) => subscribe(() => contactCbs, (v) => (contactCbs = v), cb),
    onStatus: (cb) => subscribe(() => statusCbs, (v) => (statusCbs = v), cb),
    serverNow: () => clock.serverNow(now()),
    stats: () => ({ state: lobby.get().status, rttMs: rtt(), offsetMs: clock.offsetMs(), sent, recv, dropped, staleCars }),
    setStaleCars(n) {
      staleCars = n;
    },
    close(forget = false) {
      if (welcomed && lobby.get().room) send({ type: 'leave' });
      closeForGood(forget, 'offline');
    },
  };
}
