// Headless replay bot (multiplayer-tasks T1/T4/T6/T7): a Node `ws` client that speaks the real protocol and drives its car
// with a local one-car sim under autodrive (the game's own AI at d100), sending `state` at `hz` on the shared race clock.
// `tamper` makes it cheat on purpose (teleport, impossible speed, fake progress, early start) for the validation tests.
import { WebSocket } from 'ws';
import { NET_HZ, PROTOCOL_VERSION } from '../../src/contracts/net';
import type { NetCarState, NetRoomSettings, NetServerMsg } from '../../src/contracts/net';
import { SIM_DT, type SimRunner } from '../../src/contracts/sim';
import type { TrackQuery } from '../../src/contracts/track';
import { createSim } from '../../src/game/createSim';
import { createClockSync, type ClockSync } from '../../src/net/clock';
import {
  MSG_CONTACT_RELAY, MSG_PONG, MSG_STATES, NET_FLAG_DRS_OPEN, NET_FLAG_FINISHED, NET_FLAG_IN_PIT_BOX, NET_FLAG_PIT_LIMITER, NET_FLAG_PIT_RIBBON,
  NET_FLAG_REVERSE, PING_BYTES, decodeBatchEntry, decodeBatchHeader, decodePong, encodePing, encodeState, newNetCarState, parseServerMessage,
  viewOf, type NetBatchHeader, type NetPongMsg,
} from '../../src/net/protocol';
import { loadRaceTrack } from '../../src/track/registry';
import { sessionConfigFor } from '../src/serverAi';
import { trackHashOf } from '../../src/net/protocol';

export type Tamper = 'none' | 'teleport' | 'speed' | 'fakeProgress' | 'earlyStart';

export interface BotOptions {
  url: string;
  name: string;
  /** State send rate (10/15/20 Hz tests). */
  hz?: number;
  tamper?: Tamper;
  /** Send `loaded` with a wrong hash (tests). */
  badHash?: boolean;
  /** hello.deviceId (D-050 admin bans). */
  deviceId?: string;
  /** 'idle': loads but never sends a state (frozen tab); 'afk': sends states but nobody drives (car stays on the grid). */
  drive?: 'auto' | 'idle' | 'afk';
  /** D-064 tests: a ws-shaped socket over another transport (host-in-browser loopback) instead of `new WebSocket(url)`. */
  socket?: () => WebSocket;
}

export const DEFAULT_SETTINGS: NetRoomSettings = { trackId: 'bosphorus', laps: 1, tod: 'day', weather: 'dry', aiCount: 0, difficulty: 70 };

type Load = Extract<NetServerMsg, { type: 'load' }>;

export class Bot {
  ws!: WebSocket;
  id = -1;
  token = '';
  readonly msgs: NetServerMsg[] = [];
  room: Extract<NetServerMsg, { type: 'room' }> | null = null;
  load: Load | null = null;
  t0 = Number.NaN;
  results: Extract<NetServerMsg, { type: 'results' }> | null = null;
  /** Batches received, ids seen in them (with the bit-7 source flag), contacts relayed to this bot. */
  batches = 0;
  readonly seenIds = new Set<number>();
  readonly seenAiIds = new Set<number>();
  contactsIn = 0;
  sent = 0;
  closeCode = -1;
  /** Tests: flags OR-ed into the next state only (e.g. NET_FLAG_RESET). */
  nextFlags = 0;
  readonly clock: ClockSync = createClockSync();
  private sim: SimRunner | null = null;
  private q: TrackQuery | null = null;
  private driveTimer: NodeJS.Timeout | null = null;
  private pingTimer: NodeJS.Timeout | null = null;
  private seq = 0;
  private pingSeq = 0;
  private readonly out: NetCarState = newNetCarState();
  private readonly buf = new Uint8Array(40);
  private readonly pingBuf = new Uint8Array(PING_BYTES);
  private readonly pong: NetPongMsg = { seq: 0, clientMs: 0, serverMs: 0 };
  private readonly hdr: NetBatchHeader = { count: 0, serverSeq: 0, serverMs: 0 };
  private readonly entry: NetCarState = newNetCarState();
  private waiters: { pred: (m: NetServerMsg) => boolean; resolve: (m: NetServerMsg) => void }[] = [];

  constructor(readonly opts: BotOptions) {}

  /** Connects and says hello (optionally resuming); resolves with `welcome`. */
  async connect(resume?: string): Promise<NetServerMsg> {
    this.ws = this.opts.socket ? this.opts.socket() : new WebSocket(this.opts.url);
    this.ws.binaryType = 'nodebuffer';
    this.ws.on('message', (data: Buffer, isBinary: boolean) => (isBinary ? this.onBinary(data) : this.onText(data.toString('utf8'))));
    this.ws.on('close', (code) => {
      this.closeCode = code;
      this.stopTimers();
    });
    await new Promise<void>((res, rej) => {
      this.ws.once('open', () => res());
      this.ws.once('error', rej);
    });
    this.pingTimer = setInterval(() => this.sendPing(), 1000);
    this.sendPing();
    const hello: Record<string, unknown> = { type: 'hello', v: PROTOCOL_VERSION, build: 'bot', name: this.opts.name };
    if (resume) hello.resume = resume;
    if (this.opts.deviceId) hello.deviceId = this.opts.deviceId;
    this.send(hello);
    // id/token are bound in onText as the welcome arrives, so a resumed load/start right behind it sees them.
    return this.next((m) => m.type === 'welcome' || m.type === 'error');
  }

  send(obj: unknown): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(obj));
  }

  sendRaw(data: string | Uint8Array): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(data);
  }

  waitFor(pred: (m: NetServerMsg) => boolean, timeoutMs = 10_000): Promise<NetServerMsg> {
    const hit = this.msgs.find(pred);
    if (hit) return Promise.resolve(hit);
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`bot ${this.opts.name}: timeout waiting (last: ${JSON.stringify(this.msgs.at(-1))})`)), timeoutMs);
      this.waiters.push({ pred, resolve: (m) => (clearTimeout(t), resolve(m)) });
    });
  }

  /** Waits for a message that arrives after now (not one already in the log). */
  next(pred: (m: NetServerMsg) => boolean, timeoutMs = 10_000): Promise<NetServerMsg> {
    const n = this.msgs.length;
    return this.waitFor((m) => this.msgs.indexOf(m) >= n && pred(m), timeoutMs);
  }

  close(): void {
    this.stopTimers();
    this.ws?.close();
  }

  /** Drops the socket without a leave (reconnect tests). */
  drop(): void {
    this.stopTimers();
    this.ws.terminate();
  }

  private stopTimers(): void {
    if (this.driveTimer) clearInterval(this.driveTimer);
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.driveTimer = null;
    this.pingTimer = null;
  }

  private sendPing(): void {
    encodePing(this.pingSeq++, performance.now(), viewOf(this.pingBuf));
    this.sendRaw(this.pingBuf);
  }

  private onText(text: string): void {
    const m = parseServerMessage(text);
    if (!m) throw new Error(`bot ${this.opts.name}: server sent an invalid message: ${text.slice(0, 200)}`);
    this.msgs.push(m);
    if (m.type === 'welcome') {
      this.id = m.id;
      this.token = m.resumeToken;
    } else if (m.type === 'room') this.room = m;
    else if (m.type === 'load') this.onLoad(m);
    else if (m.type === 'start') this.onStart(m.t0ServerMs);
    else if (m.type === 'results') {
      this.results = m;
      this.stopDriving();
    }
    const ws = this.waiters;
    this.waiters = [];
    for (const w of ws) {
      if (w.pred(m)) w.resolve(m);
      else this.waiters.push(w);
    }
  }

  private onBinary(b: Buffer): void {
    const dv = viewOf(b);
    const t = b[0];
    if (t === MSG_PONG) {
      if (decodePong(dv, this.pong)) this.clock.addSample(this.pong.clientMs, this.pong.serverMs, performance.now());
    } else if (t === MSG_STATES) {
      if (!decodeBatchHeader(dv, this.hdr)) throw new Error('bot: bad batch');
      this.batches++;
      for (let k = 0; k < this.hdr.count; k++) {
        if (!decodeBatchEntry(dv, k, this.entry)) throw new Error('bot: bad batch entry');
        if (this.entry.fromServer) this.seenAiIds.add(this.entry.id);
        else this.seenIds.add(this.entry.id);
      }
    } else if (t === MSG_CONTACT_RELAY) this.contactsIn++;
  }

  private onLoad(m: Load): void {
    this.load = m;
    this.t0 = Number.NaN;
    const me = m.roster.find((r) => r.id === this.id);
    if (!me) return;
    const track = loadRaceTrack(m.config.trackId);
    this.q = track.query;
    const cfg = { ...sessionConfigFor(m.config, 0), autodrive: this.opts.drive !== 'afk' };
    this.sim = createSim(cfg, { track, lineup: [{ teamId: me.teamId, driverIdx: me.driverIdx, gridSlot: me.gridSlot, control: 'player', human: true }] });
    this.seq = 0;
    this.send({ type: 'loaded', trackHash: this.opts.badHash ? '00000000' : trackHashOf(track.data) });
  }

  private onStart(t0: number): void {
    this.t0 = t0;
    if (!this.sim || this.driveTimer || this.opts.drive === 'idle') return;
    this.driveTimer = setInterval(() => this.drive(), 1000 / (this.opts.hz ?? NET_HZ));
  }

  private stopDriving(): void {
    if (this.driveTimer) clearInterval(this.driveTimer);
    this.driveTimer = null;
  }

  /** Steps the local sim to the race clock and sends one `state`. */
  private drive(): void {
    const sim = this.sim;
    const q = this.q;
    if (!sim || !q || !this.load) return;
    const raceMs = this.clock.serverNow(performance.now()) - this.t0;
    if (raceMs < 0) return;
    const st = sim.world.state;
    const target = Math.min(Math.floor(raceMs / 1000 / SIM_DT), st.tick + 2400);
    while (st.tick < target) sim.step();
    const c = st.cars[0]!;
    const v = c.vehicle;
    const o = this.out;
    let flags = 0;
    if (v.pitLimiterOn) flags |= NET_FLAG_PIT_LIMITER;
    if (v.drs.open) flags |= NET_FLAG_DRS_OPEN;
    if (v.hint.ribbon === 'pit') flags |= NET_FLAG_PIT_RIBBON;
    if (c.pit.phase === 'stationary') flags |= NET_FLAG_IN_PIT_BOX;
    if (c.race.finished) flags |= NET_FLAG_FINISHED;
    if (v.gear < 0) flags |= NET_FLAG_REVERSE;
    o.flags = flags | this.nextFlags;
    this.nextFlags = 0;
    o.seq = this.seq = (this.seq + 1) & 0xffff;
    o.simMs = Math.round(st.time * 1000);
    o.x = v.x;
    o.y = v.y;
    o.z = v.z;
    o.progress = v.lapWraps * q.length + v.s;
    o.yaw = v.yaw;
    o.vx = v.vx;
    o.vz = v.vz;
    o.yawRate = v.yawRate;
    o.steerAngle = v.steerAngle;
    o.throttle = c.input.throttle;
    o.brake = c.input.brake;
    o.gear = v.gear;
    o.rpm = v.rpm;
    o.drsFlap = v.drs.flap;
    o.compound = v.compound;
    o.ersDeploying = v.ers.deployKw > 0;
    this.applyTamper(o, this.load.lightsOutAtMs);
    encodeState(o, viewOf(this.buf));
    this.sendRaw(this.buf);
    this.sent++;
  }

  private applyTamper(o: NetCarState, lightsOutAtMs: number): void {
    const t = this.opts.tamper ?? 'none';
    const after = o.simMs - lightsOutAtMs;
    if (t === 'teleport' && after > 3000) {
      o.x += 200; // every state from here on is 200 m away from the last accepted one
    } else if (t === 'speed' && after > 3000) {
      o.vx = 120;
      o.vz = 0;
    } else if (t === 'fakeProgress' && after > 3000) {
      o.progress += 400;
    } else if (t === 'earlyStart' && after > -1000 && after < 0) {
      // Creeps forward 2 m along the heading in the second before lights out.
      const k = 2 * (1 + after / 1000);
      o.x += Math.sin(o.yaw) * k;
      o.z += Math.cos(o.yaw) * k;
      o.progress += k;
    }
  }
}
