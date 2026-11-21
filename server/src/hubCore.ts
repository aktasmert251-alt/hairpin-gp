// The game hub: player identities (hello / resume tokens / NetIds), the room registry and message routing.
// Transport concerns (sockets, rate limits, sizes, latency simulation) stay in ws.ts; the hub sees Peers.
// Runtime-neutral (D-064): no Node-only API here, so the same hub runs on the Node server (hub.ts adds the salted log tag)
// and in a host's browser Web Worker (host-in-browser rooms, server/src/p2p/hostRoom.ts).
import { PROTOCOL_VERSION, NET_HZ } from '../../src/contracts/net';
import type { NetClientMsg, NetErrorCode } from '../../src/contracts/net';
import {
  CLOSE_BANNED, CLOSE_KICKED, MAX_ROOM_LISTINGS, MSG_CONTACT, MSG_PING, MSG_STATE, PONG_BYTES, ROOM_CODE_ALPHABET, decodePing, encodePong, normalizeName, parseClientMessage, viewOf,
  type NetPingMsg,
} from '../../src/net/protocol';
import { DEFAULT_GAME_CONFIG, type GameConfig } from './config';
import { Player, type Peer } from './player';
import { randomHex, randomInt } from './rand';
import { MAX_GRID, Room, type Log } from './room';
import { WindowCounter } from './validate';

/** Six full rooms need up to 120 human ids; AI ids are allocated around humans within each room. */
const HUMAN_IDS = 128;

interface PeerState { openedAt: number; bad: WindowCounter }

/** Admin hooks (D-050): bans checked at hello, maintenance refuses new rooms and joins. The admin panel replaces the default. */
export interface Admission {
  maintenance: boolean;
  /** True when this hello must be refused. */
  banned(keys: { deviceId: string | null; token: string | null; ip: string }): boolean;
  /** Current admin notice, sent after every `welcome` (null / absent = none). */
  notice?(): string | null;
}

/** WebSocket close codes after a `kicked` message (shared with the client: src/net/protocol.ts). */
export { CLOSE_BANNED, CLOSE_KICKED };


/** Privacy-safe log tag of a peer address (Node: salted hash, privacy.ts logTag). The default never logs the address. */
export type LogTag = (ip: string) => string;

export class HubCore {
  readonly cfg: GameConfig;
  readonly rooms = new Map<string, Room>();
  readonly players = new Map<string, Player>();
  private readonly idUsed = new Uint8Array(HUMAN_IDS);
  private readonly peers = new Map<Peer, PeerState>();
  private readonly failedJoins = new Map<string, WindowCounter>();
  private readonly ping: NetPingMsg = { seq: 0, clientMs: 0 };
  private readonly timer: ReturnType<typeof setInterval>;
  admission: Admission = { maintenance: false, banned: () => false };

  constructor(
    private readonly log: Log,
    cfg: Partial<GameConfig> = {},
    readonly now: () => number = serverNow,
    private readonly logTag: LogTag = () => '-',
  ) {
    this.cfg = { ...DEFAULT_GAME_CONFIG, ...cfg };
    this.cfg.maxPlayersPerRoom = Math.max(1, Math.min(MAX_GRID, Math.floor(this.cfg.maxPlayersPerRoom)));
    this.timer = setInterval(() => this.tick(), 1000 / NET_HZ);
    // Node: do not keep the process alive for the room tick (browsers have no unref).
    (this.timer as { unref?: () => void }).unref?.();
  }

  // ---- transport callbacks -------------------------------------------------------------------------------------------------

  onOpen(peer: Peer): void {
    this.peers.set(peer, { openedAt: this.now(), bad: new WindowCounter(this.cfg.badLimit, this.cfg.badWindowMs) });
  }

  onClose(peer: Peer): void {
    this.peers.delete(peer);
    const p = peer.player;
    peer.player = null;
    if (!p || p.peer !== peer) return;
    p.peer = null;
    if (p.room) p.room.onDisconnect(p);
    else this.forget(p);
  }

  onText(peer: Peer, raw: string): void {
    const msg = parseClientMessage(raw);
    if (!msg) return this.bad(peer, 'parse');
    const p = peer.player;
    if (msg.type === 'hello') {
      if (p) return this.bad(peer, 'helloTwice');
      return this.hello(peer, msg, msg.deviceId ?? null);
    }
    if (!p) return this.bad(peer, 'noHello');
    const err = this.route(p, msg, peer.ip);
    if (err) peer.sendJson({ type: 'error', code: err });
  }

  onBinary(peer: Peer, buf: Uint8Array): void {
    const type = buf.length > 0 ? buf[0] : -1;
    if (type === MSG_PING) {
      if (!decodePing(viewOf(buf), this.ping)) return this.bad(peer, 'ping');
      const out = new Uint8Array(PONG_BYTES);
      encodePong(this.ping.seq, this.ping.clientMs, this.now(), viewOf(out));
      peer.sendBinary(out, false);
      return;
    }
    const p = peer.player;
    if (!p) return this.bad(peer, 'noHello');
    if (type === MSG_STATE) {
      if (!p.room) return;
      if (!p.room.onState(p, buf)) this.bad(peer, 'state');
      return;
    }
    if (type === MSG_CONTACT) {
      if (!p.room) return;
      if (!p.room.onContact(p, buf)) this.bad(peer, 'contact');
      return;
    }
    this.bad(peer, 'binaryType');
  }

  // ---- messages --------------------------------------------------------------------------------------------------------------

  private hello(peer: Peer, msg: Extract<NetClientMsg, { type: 'hello' }>, deviceId: string | null): void {
    if (msg.v !== PROTOCOL_VERSION) return peer.sendJson({ type: 'error', code: 'version' });
    if (this.admission.banned({ deviceId, token: msg.resume ?? null, ip: peer.ip })) {
      this.log('helloBanned', {});
      this.peers.delete(peer);
      peer.sendJson({ type: 'kicked', reason: 'banned' });
      return peer.close(CLOSE_BANNED, 'banned');
    }
    const name = normalizeName(msg.name);
    if (!name) return peer.sendJson({ type: 'error', code: 'badName' });
    let p = msg.resume ? this.players.get(msg.resume) : undefined;
    const resumed = p !== undefined;
    if (p) {
      const old = p.peer;
      if (old) {
        old.player = null;
        old.close(4000, 'replaced');
      }
    } else {
      const id = this.idUsed.indexOf(0);
      if (id < 0) return peer.sendJson({ type: 'error', code: 'full' });
      this.idUsed[id] = 1;
      p = new Player(id, name, randomHex(16));
      this.players.set(p.token, p);
    }
    p.peer = peer;
    p.connectedAt = this.now();
    p.lastIp = peer.ip;
    if (deviceId) p.deviceId = deviceId;
    peer.player = p;
    peer.sendJson({
      type: 'welcome', id: p.id, resumeToken: p.token, serverMs: this.now(), limits: { maxPlayers: this.cfg.maxPlayersPerRoom, hz: NET_HZ },
    });
    const notice = this.admission.notice?.() ?? null;
    if (notice) peer.sendJson({ type: 'notice', text: notice });
    this.log('hello', { id: p.id, resumed });
    if (resumed && p.room) p.room.onResume(p);
  }

  private route(p: Player, msg: NetClientMsg, ip: string): NetErrorCode | null {
    const room = p.room;
    switch (msg.type) {
      case 'listRooms':
        if (this.admission.maintenance) return 'maintenance';
        p.peer?.sendJson({ type: 'rooms', rooms: [...this.rooms.values()]
          .filter((r) => r.settings.visibility !== 'private' && r.members.length > 0)
          .slice(0, MAX_ROOM_LISTINGS).map((r) => ({
            code: r.code, track: r.settings.trackId, laps: r.settings.laps, weather: r.settings.weather, tod: r.settings.tod,
            humans: r.members.length, capacity: this.cfg.maxPlayersPerRoom, state: r.phase === 'lobby' ? 'lobby' : 'racing',
            owner: r.members.find((m) => m.id === r.ownerId)!.name, mode: r.settings.mode ?? 'normal',
          })) });
        return null;
      case 'quickJoin': {
        if (room) return 'phase';
        if (this.admission.maintenance) return 'maintenance';
        const candidate = [...this.rooms.values()]
          .filter((r) => r.settings.visibility !== 'private' && r.phase === 'lobby' && r.members.length < this.cfg.maxPlayersPerRoom)
          .sort((a, b) => b.members.length - a.members.length)[0];
        if (candidate) return candidate.join(p);
        return this.route(p, { type: 'create', settings: {
          visibility: 'public', trackId: 'istanbul', laps: 5, weather: 'dry', tod: 'day', aiCount: 19, difficulty: 70,
        } }, ip);
      }
      case 'create': {
        if (room) return 'phase';
        if (this.admission.maintenance) return 'maintenance';
        if (this.rooms.size >= this.cfg.maxRooms) return 'full';
        const r = new Room(this.newCode(), msg.settings, p, {
          cfg: this.cfg, now: this.now, log: this.log, released: (x) => this.released(x), closed: (x) => this.rooms.delete(x.code),
        });
        this.rooms.set(r.code, r);
        this.log('roomCreate', { room: r.code, owner: p.id });
        return r.join(p);
      }
      case 'join': {
        if (room) return 'phase';
        if (this.admission.maintenance) return 'maintenance';
        const fails = this.failedJoins.get(ip);
        const r = this.rooms.get(msg.code);
        if (!r) {
          let w = fails;
          if (!w) {
            w = new WindowCounter(this.cfg.maxFailedJoinsPerMin, 60_000);
            this.failedJoins.set(ip, w);
          }
          return w.hit(this.now()) ? 'rate' : 'notFound';
        }
        return r.join(p);
      }
      case 'leave':
        if (!room) return 'phase';
        room.leave(p, 'leave');
        return null;
      default:
        break;
    }
    if (!room) return 'phase';
    switch (msg.type) {
      case 'setCar':
        return room.setCar(p, msg.teamId, msg.driverIdx);
      case 'setTeam':
        return room.setTeam(p, msg.team);
      case 'setReady':
        return room.setReady(p, msg.ready);
      case 'setSettings':
        return room.setSettings(p, msg.settings);
      case 'start':
        return room.start(p);
      case 'loaded':
        return room.loaded(p, msg.trackHash);
      case 'report':
        return room.report(p, msg.kind, msg.seconds, msg.lap);
      case 'retire':
        return room.retire(p);
      case 'backToLobby':
        return room.backToLobby(p);
      default:
        return 'badMessage';
    }
  }

  private bad(peer: Peer, why: string): void {
    const st = this.peers.get(peer);
    this.log('badMessage', { net: this.logTag(peer.ip), id: peer.player?.id ?? null, why });
    if (st && st.bad.hit(this.now())) {
      peer.close(1008, 'bad messages');
      return;
    }
    peer.sendJson({ type: 'error', code: 'badMessage' });
  }

  // ---- admin (D-050) ----------------------------------------------------------------------------------------------------------

  /** D-050: admin notice to every connected player ('' = cleared). */
  broadcastNotice(text: string): void {
    for (const p of this.players.values()) p.peer?.sendJson({ type: 'notice', text });
  }

  playerById(id: number): Player | undefined {
    for (const p of this.players.values()) if (p.id === id) return p;
    return undefined;
  }

  /** Removes a player for good: out of its room (DNF if racing), resume token invalidated, socket closed with the given code. */
  kick(p: Player, code: number, reason: string, until: number | null = null): void {
    const peer = p.peer;
    if (peer) {
      peer.player = null;
      this.peers.delete(peer);
      p.peer = null;
      // D-050: the reason first, so the client shows it and does not resume.
      peer.sendJson({ type: 'kicked', reason: code === CLOSE_BANNED ? 'banned' : 'kicked', until });
      peer.close(code, reason);
    }
    if (p.room) p.room.leave(p, reason);
    this.forget(p);
    this.log('kick', { id: p.id, reason });
  }

  // ---- identities / rooms ----------------------------------------------------------------------------------------------------

  /** A room let the player go: forget it now if it has no socket, else it stays as a room-less player. */
  private released(p: Player): void {
    if (!p.peer) this.forget(p);
  }

  private forget(p: Player): void {
    if (this.players.get(p.token) !== p) return;
    this.players.delete(p.token);
    this.idUsed[p.id] = 0;
  }

  private newCode(): string {
    for (;;) {
      let c = '';
      for (let i = 0; i < 5; i++) c += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
      if (!this.rooms.has(c)) return c;
    }
  }

  tick(): void {
    const now = this.now();
    for (const [peer, st] of this.peers) {
      if (!peer.player && now - st.openedAt >= this.cfg.helloTimeoutMs) {
        this.log('helloTimeout', { net: this.logTag(peer.ip) });
        this.peers.delete(peer);
        peer.close(1008, 'hello timeout');
      }
    }
    for (const r of [...this.rooms.values()]) {
      try {
        r.tick(now);
      } catch (err) {
        // One broken room must not take the process down: log it and close the room.
        this.log('roomError', { room: r.code, error: String(err instanceof Error ? (err.stack ?? err.message) : err) });
        for (const m of [...r.members]) r.leave(m, 'roomError');
        this.rooms.delete(r.code);
      }
    }
    if (this.failedJoins.size > 1000) this.failedJoins.clear();
  }

  stats(): { rooms: ReturnType<Room['stats']>[]; players: number } {
    return { rooms: [...this.rooms.values()].map((r) => r.stats()), players: this.players.size };
  }

  dispose(): void {
    clearInterval(this.timer);
  }
}

/** Server clock (ms): monotonic, epoch-based so values look like wall time. */
export function serverNow(): number {
  return performance.timeOrigin + performance.now();
}
