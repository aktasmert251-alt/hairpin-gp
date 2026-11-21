// One room: lobby, the race FSM (design §4), relay, validation, timing, contacts and the server AI sim (D-043).
//   lobby → (owner start) → loading → (all loaded / timeout) → countdown → (T0) → racing → (first finisher) → finishing
//   → (all done / window) → results → (backToLobby) → lobby.   The room closes when its last member leaves.
import type {
  NetCarState, NetContact, NetErrorCode, NetPlayerInfo, NetRaceConfig, NetReportKind, NetRoomPhase, NetRoomSettings, NetRosterEntry,
  NetServerMsg, NetCustomTeam, NetCustomTeamEntry,
} from '../../src/contracts/net';
import { NET_STATE_BYTES } from '../../src/contracts/net';
import type { PenaltyReason } from '../../src/contracts/race';
import type { TrackBundle } from '../../src/contracts/track';
import { createRng, seedStream } from '../../src/core/rng';
import { ALL_DRIVERS, TEAMS } from '../../src/data/teams';
import {
  BATCH_HEADER_BYTES, MSG_CONTACT, MSG_CONTACT_RELAY, NET_FLAG_IN_PIT_BOX, NET_FLAG_RESET, NET_LIMITS, batchBytes, copyStateToBatch, decodeContact,
  decodeState, encodeContact, newNetCarState, newNetContact, viewOf, writeBatchEntry, writeBatchHeader,
} from '../../src/net/protocol';
import { lightsOutAtMsFor } from '../../src/race/index';
import { JUMP_START_M, PENALTY_S } from '../../src/race/rules';
import { loadRaceTrack } from '../../src/track/registry';
import type { GameConfig } from './config';
import { CONTACT_AFTER_CONNECT_MS, checkContact, type ContactPose, type ContactReject } from './contact';
import { TokenBucket } from './limits';
import type { Player } from './player';
import { randomInt } from './rand';
import { RoomSim } from './serverAi';
import { CarTiming, LAP_CREDIT, LAP_REJECT, buildResults, compareCars, gapToLeaderMs } from './timing';
import { trackHashOf } from '../../src/net/protocol';
import { StateValidator, WindowCounter } from './validate';

export const MAX_GRID = 20;
/** Preferred AI id range; allocation skips human ids in this room. */
export const AI_ID_BASE = 64;
const STANDINGS_EVERY_MS = 500;
const JUMP_START_WINDOW_MS = 100;
/** A present car that moves less than this (m) counts as standing still (checkStalls). */
const STALL_MOVE_M = 5;
/** A human reset (NET_FLAG_RESET) makes the car a ghost for 3 s, like GHOST_TIME in the collision system: no contacts. */
export const RESET_GHOST_MS = 3_000;

export type Log = (event: string, data?: Record<string, unknown>) => void;

export interface RoomDeps {
  cfg: GameConfig;
  now: () => number;
  log: Log;
  /** The player left the room for good (left, timed out): the hub frees its id/token if it has no socket. */
  released: (p: Player) => void;
  closed: (room: Room) => void;
}

/** One car of the frozen race grid (human or server AI). */
export class RaceCar {
  player: Player | null;
  readonly timing: CarTiming;
  readonly validator: StateValidator | null;
  /** Newest accepted state (humans) — also the sim puppet source. */
  readonly state: NetCarState = newNetCarState();
  readonly raw = new Uint8Array(NET_STATE_BYTES);
  hasState = false;
  /** A new state arrived since the last batch. */
  fresh = false;
  lastAcceptAt = 0;
  stale = false;
  muteUntil = 0;
  /** Server ms until which this human is a reset ghost (no contacts either way). */
  ghostUntil = 0;
  loaded = false;
  jumpChecked = false;
  inBox = false;
  strikes = 0;
  hardViolations = 0;
  contactRejects = 0;
  /** Stall watch (user bug 2026-10-26): race ms since which a present car has not moved STALL_MOVE_M, at that progress. */
  stillSinceMs = Number.NaN;
  stillProgress = 0;
  /** Left the grid at least once. */
  started = false;
  readonly strikeWin: WindowCounter;
  readonly contactRejectWin: WindowCounter;
  readonly contactBucket: TokenBucket;
  connectedAt = 0;

  constructor(
    readonly entry: NetRosterEntry,
    /** Sim car index = roster index. */
    readonly index: number,
    player: Player | null,
    timing: CarTiming,
    validator: StateValidator | null,
    readonly gridProgress: number,
    cfg: GameConfig,
    now: number,
  ) {
    this.player = player;
    this.timing = timing;
    this.validator = validator;
    this.strikeWin = new WindowCounter(cfg.strikeLimit, cfg.strikeWindowMs);
    this.contactRejectWin = new WindowCounter(5, 10_000);
    this.contactBucket = new TokenBucket(NET_LIMITS.contactsPerPlayerPerS, NET_LIMITS.contactsPerPlayerPerS, now);
    this.connectedAt = now;
  }

  get id(): number {
    return this.entry.id;
  }
  get name(): string {
    return this.entry.name;
  }
  get teamId(): string {
    return this.entry.teamId;
  }
  get human(): boolean {
    return this.entry.kind === 'human';
  }
}

interface Race {
  raceId: string;
  config: NetRaceConfig;
  roster: NetRosterEntry[];
  cars: RaceCar[];
  byId: (RaceCar | undefined)[];
  lightsOutAtMs: number;
  track: TrackBundle;
  trackHash: string;
  sim: RoomSim | null;
  loadDeadline: number;
  /** Server ms of T0 (race clock 0); NaN until the countdown starts. */
  t0: number;
  finishDeadline: number;
  finishCount: number;
  serverSeq: number;
  nextStandingsAt: number;
  results: NetServerMsg | null;
  pairBuckets: Map<number, TokenBucket>;
  /** D-062: the custom teams frozen at load. */
  teams: NetCustomTeam[];
}

let raceCounter = 0;

export class Room {
  phase: NetRoomPhase = 'lobby';
  ownerId: number;
  readonly members: Player[] = [];
  race: Race | null = null;
  /** D-062: custom teams by base team id (one per base car), each owned (edited) by its creator. */
  readonly customTeams = new Map<string, NetCustomTeamEntry>();
  private readonly cfg: GameConfig;
  /** Batch scratch: every entry of this tick (humans' raw bytes + AI states); per recipient the own entry is skipped. */
  private readonly scratch = new Uint8Array(batchBytes(MAX_GRID));
  private readonly scratchView = viewOf(this.scratch);
  private readonly entryId = new Int16Array(MAX_GRID);
  private readonly aiState = newNetCarState();
  private readonly inState = newNetCarState();
  private readonly inContact = newNetContact();
  private readonly relayBuf = new Uint8Array(28);
  private readonly whyContact: { r: ContactReject } = { r: '' };
  private readonly poseA: ContactPose = { x: 0, z: 0, vx: 0, vz: 0, simMs: 0 };
  private readonly poseB: ContactPose = { x: 0, z: 0, vx: 0, vz: 0, simMs: 0 };
  /** Sim CPU accounting for /health (ms of stepping per wall second). */
  private cpuWinStart = 0;
  private cpuWinBusy = 0;
  simCpuPct = 0;

  constructor(
    readonly code: string,
    public settings: NetRoomSettings,
    owner: Player,
    private readonly deps: RoomDeps,
  ) {
    this.cfg = deps.cfg;
    this.settings = { ...settings, visibility: settings.visibility ?? 'public' };
    this.ownerId = owner.id;
    this.cpuWinStart = deps.now();
  }

  // ---- lobby -------------------------------------------------------------------------------------------------------------

  /** Adds a player (lobby only). Returns an error code or null. */
  join(p: Player): NetErrorCode | null {
    if (this.phase !== 'lobby') return 'phase';
    if (this.members.length >= this.cfg.maxPlayersPerRoom) return 'full';
    const seat = this.freeSeat();
    if (!seat) return 'full';
    p.teamId = seat.teamId;
    p.driverIdx = seat.driverIdx;
    p.ready = false;
    p.room = this;
    this.members.push(p);
    this.deps.log('roomJoin', { room: this.code, id: p.id, n: this.members.length });
    this.broadcastRoom();
    return null;
  }

  leave(p: Player, reason: string): void {
    const i = this.members.indexOf(p);
    if (i < 0) return;
    this.members.splice(i, 1);
    this.dropTeamOf(p);
    p.room = null;
    p.ready = false;
    const car = this.carOf(p);
    if (car) {
      car.player = null;
      if (car.timing.running && this.racing()) this.setStatus(car, 'dnf');
    }
    this.deps.log('roomLeave', { room: this.code, id: p.id, reason });
    this.deps.released(p);
    if (this.members.length === 0) {
      this.close();
      return;
    }
    if (this.ownerId === p.id) this.ownerId = this.members[0]!.id;
    this.broadcastRoom();
    if (this.phase === 'loading') this.maybeAllLoaded();
    this.checkRaceOver();
  }

  setCar(p: Player, teamId: string, driverIdx: 0 | 1): NetErrorCode | null {
    if (this.phase !== 'lobby') return 'phase';
    if (this.members.some((m) => m !== p && m.teamId === teamId && m.driverIdx === driverIdx)) return 'taken';
    // D-062: the creator leaving its base car drops the custom team (a teammate keeps the plain base team).
    const own = this.teamOwnedBy(p);
    if (own && own.team.baseTeamId !== teamId) this.customTeams.delete(own.team.baseTeamId);
    p.teamId = teamId;
    p.driverIdx = driverIdx;
    this.broadcastRoom();
    return null;
  }

  /**
   * D-062: create / edit (team) or drop (null) the player's custom team. The team (already shape- and rule-checked by the shared
   * parser: name, palette ids, base car) takes its base car: the creator moves to a free seat of it; one custom team per base car.
   */
  setTeam(p: Player, team: NetCustomTeam | null): NetErrorCode | null {
    if (this.phase !== 'lobby') return 'phase';
    if (!team) {
      this.dropTeamOf(p);
      this.broadcastRoom();
      return null;
    }
    const base = team.baseTeamId;
    const existing = this.customTeams.get(base);
    if (existing && existing.ownerId !== p.id) return 'taken';
    // Several players may bring custom teams (one per base car); two teams with one name would be indistinguishable.
    const nameKey = (n: string): string => n.normalize('NFKC').toLocaleLowerCase('en').replace(/\s+/g, ' ');
    for (const e of this.customTeams.values()) if (e.ownerId !== p.id && nameKey(e.team.name) === nameKey(team.name)) return 'taken';
    if (p.teamId !== base) {
      const idx = ([0, 1] as const).find((i) => !this.members.some((m) => m !== p && m.teamId === base && m.driverIdx === i));
      if (idx === undefined) return 'taken';
      p.teamId = base;
      p.driverIdx = idx;
    }
    this.dropTeamOf(p);
    this.customTeams.set(base, { ownerId: p.id, team: { ...team, id: `custom-${base}` } });
    this.broadcastRoom();
    return null;
  }

  private teamOwnedBy(p: Player): NetCustomTeamEntry | undefined {
    for (const e of this.customTeams.values()) if (e.ownerId === p.id) return e;
    return undefined;
  }

  private dropTeamOf(p: Player): void {
    const own = this.teamOwnedBy(p);
    if (own) this.customTeams.delete(own.team.baseTeamId);
  }

  setReady(p: Player, ready: boolean): NetErrorCode | null {
    if (this.phase !== 'lobby') return 'phase';
    p.ready = ready;
    this.broadcastRoom();
    return null;
  }

  setSettings(p: Player, s: NetRoomSettings): NetErrorCode | null {
    if (this.phase !== 'lobby' || p.id !== this.ownerId) return 'phase';
    this.settings = { ...s, visibility: s.visibility ?? 'public' };
    this.broadcastRoom();
    return null;
  }

  start(p: Player): NetErrorCode | null {
    if (this.phase !== 'lobby' || p.id !== this.ownerId) return 'phase';
    const others = this.members.filter((m) => m !== p);
    if (this.members.length < this.cfg.minPlayersToStart || !this.members.every((m) => m.connected) || !others.every((m) => m.ready)) {
      return 'phase';
    }
    this.beginLoading();
    return null;
  }

  backToLobby(p: Player): NetErrorCode | null {
    if (this.phase !== 'results') return 'phase';
    this.deps.log('backToLobby', { room: this.code, by: p.id });
    this.race = null;
    this.phase = 'lobby';
    for (const m of this.members) m.ready = false;
    for (const m of [...this.members]) if (!m.connected) this.leave(m, 'disconnected');
    if (this.members.length > 0) this.broadcastRoom();
    return null;
  }

  // ---- race lifecycle ----------------------------------------------------------------------------------------------------

  private aiId(k: number, humans: readonly Player[]): number {
    for (let id = AI_ID_BASE; id < AI_ID_BASE + 128; id++) {
      const candidate = id % 128;
      if (!humans.some((p) => p.id === candidate) && k-- === 0) return candidate;
    }
    throw new Error('No AI id available');
  }

  private beginLoading(): void {
    const now = this.deps.now();
    const seed = randomInt(-0x80000000, 0x7fffffff);
    const humans = [...this.members];
    const aiCount = Math.max(0, Math.min(this.settings.aiCount, MAX_GRID - humans.length));
    const taken = new Set(humans.map((h) => `${h.teamId}/${h.driverIdx}`));
    const pool = ALL_DRIVERS.filter((e) => !taken.has(`${e.team.id}/${e.idx}`));
    const rng = createRng(seedStream(seed, 3));
    for (let i = pool.length - 1; i > 0; i--) {
      const j = rng.int(0, i);
      const t = pool[i]!;
      pool[i] = pool[j]!;
      pool[j] = t;
    }
    const n = humans.length + aiCount;
    const slots = Array.from({ length: n }, (_, i) => i);
    const grng = createRng(seedStream(seed, 4));
    for (let i = n - 1; i > 0; i--) {
      const j = grng.int(0, i);
      const t = slots[i]!;
      slots[i] = slots[j]!;
      slots[j] = t;
    }
    const roster: NetRosterEntry[] = [
      ...humans.map((h, i) => ({ id: h.id, kind: 'human' as const, name: h.name, teamId: h.teamId, driverIdx: h.driverIdx, gridSlot: slots[i]! })),
      ...pool.slice(0, aiCount).map((e, k) => ({
        id: this.aiId(k, humans), kind: 'ai' as const, name: e.driver.name, teamId: e.team.id, driverIdx: e.idx, gridSlot: slots[humans.length + k]!,
      })),
    ];
    const config: NetRaceConfig = { ...this.settings, aiCount, seed };
    const track = loadRaceTrack(config.trackId);
    const q = track.query;
    const L = q.length;
    const lightsOutAtMs = lightsOutAtMsFor(seed);
    const minLap = this.cfg.minLapMs[config.trackId];
    const cars = roster.map((r, i) => {
      const slot = track.data.grid[r.gridSlot] ?? { s: q.wrapS(-12 - 8 * r.gridSlot), d: 0 };
      const human = r.kind === 'human' ? humans[i]! : null;
      return new RaceCar(
        r, i, human, new CarTiming(L, track.data.sectors, minLap, lightsOutAtMs), human ? new StateValidator(q, slot.s) : null,
        slot.s > L / 2 ? slot.s - L : slot.s, this.cfg, now,
      );
    });
    const byId: (RaceCar | undefined)[] = new Array(128);
    for (const c of cars) byId[c.id] = c;
    const sim = aiCount > 0 ? new RoomSim(config, roster, track) : null;
    this.race = {
      raceId: `${this.code}-${++raceCounter}`, config, roster, cars, byId, lightsOutAtMs, track, trackHash: trackHashOf(track.data), sim,
      loadDeadline: now + this.cfg.loadTimeoutMs, t0: Number.NaN, finishDeadline: Number.NaN, finishCount: 0, serverSeq: 0,
      nextStandingsAt: 0, results: null, pairBuckets: new Map(), teams: [...this.customTeams.values()].map((e) => ({ ...e.team })),
    };
    if (sim) for (const c of cars) if (c.human) sim.puppets[c.index] = null;
    this.phase = 'loading';
    this.deps.log('raceLoad', { room: this.code, raceId: this.race.raceId, track: config.trackId, laps: config.laps, humans: humans.length, ai: aiCount });
    this.broadcastRoom();
    this.broadcast(this.loadMsg());
  }

  private loadMsg(): NetServerMsg {
    const r = this.race!;
    return { type: 'load', raceId: r.raceId, config: r.config, roster: r.roster, lightsOutAtMs: r.lightsOutAtMs, teams: r.teams };
  }

  loaded(p: Player, trackHash: string): NetErrorCode | null {
    const car = this.carOf(p);
    if (this.phase !== 'loading' || !car) return 'phase';
    if (trackHash !== this.race!.trackHash) {
      this.deps.log('trackHashMismatch', { room: this.code, id: p.id });
      return 'version';
    }
    car.loaded = true;
    this.maybeAllLoaded();
    return null;
  }

  private maybeAllLoaded(): void {
    const r = this.race;
    if (!r || this.phase !== 'loading') return;
    if (r.cars.every((c) => !c.human || c.loaded || !c.player)) this.beginCountdown();
  }

  private beginCountdown(): void {
    const r = this.race!;
    const now = this.deps.now();
    for (const c of r.cars) if (c.human && !c.loaded) this.setStatus(c, 'dnf'); // did not start
    r.t0 = now + this.cfg.countdownMs;
    this.phase = 'countdown';
    this.deps.log('raceCountdown', { room: this.code, raceId: r.raceId });
    this.broadcastRoom();
    this.broadcast({ type: 'start', t0ServerMs: r.t0 });
  }

  retire(p: Player): NetErrorCode | null {
    const car = this.carOf(p);
    if (!car || !this.racing()) return 'phase';
    if (car.timing.running) this.setStatus(car, 'dnf');
    this.checkRaceOver();
    return null;
  }

  report(p: Player, kind: NetReportKind, seconds: number | undefined, lap: number): NetErrorCode | null {
    const car = this.carOf(p);
    if (!car || (this.phase !== 'racing' && this.phase !== 'finishing')) return 'phase';
    if (kind === 'lapInvalidated') {
      car.timing.invalidateLap(lap);
      return null;
    }
    const s = seconds ?? 0;
    if (s > 0) this.penalise(car, s, kind as PenaltyReason);
    return null;
  }

  private penalise(car: RaceCar, seconds: number, reason: PenaltyReason): void {
    if (this.race?.config.mode === 'kasap') return; // D-061 Kasap: no penalties (jump start, reports, AI) of any kind
    car.timing.penaltySec += seconds;
    this.broadcast({ type: 'penalty', id: car.id, seconds, reason });
    this.deps.log('penalty', { room: this.code, id: car.id, seconds, reason });
  }

  private racing(): boolean {
    return this.phase === 'countdown' || this.phase === 'racing' || this.phase === 'finishing';
  }

  private setStatus(car: RaceCar, status: 'dnf' | 'dsq' | 'finished'): void {
    car.timing.status = status;
    this.deps.log('carStatus', { room: this.code, id: car.id, status });
  }

  private finish(car: RaceCar): void {
    const r = this.race!;
    const t = car.timing;
    t.status = 'finished';
    t.finishMs = t.lastCrossingMs;
    t.finishOrder = ++r.finishCount;
    if (this.phase === 'racing') {
      this.phase = 'finishing';
      r.finishDeadline = this.deps.now() + this.cfg.finishWindowMs;
      this.broadcast({ type: 'finishing', byId: car.id, windowMs: this.cfg.finishWindowMs });
      this.broadcastRoom();
    }
    this.checkRaceOver();
  }

  private checkRaceOver(): void {
    const r = this.race;
    if (!r || (this.phase !== 'racing' && this.phase !== 'finishing' && this.phase !== 'countdown')) return;
    if (r.cars.every((c) => !c.timing.running)) this.endRace();
  }

  private endRace(): void {
    const r = this.race!;
    for (const c of r.cars) if (c.timing.running) c.timing.status = 'dnf';
    r.results = { type: 'results', rows: buildResults(r.cars, r.lightsOutAtMs) };
    r.sim = null;
    this.phase = 'results';
    this.deps.log('raceResults', { room: this.code, raceId: r.raceId, rows: (r.results as { rows: unknown[] }).rows.length });
    this.broadcastRoom();
    this.broadcast(r.results);
  }

  // ---- binary: state / contact ---------------------------------------------------------------------------------------------

  /** A client `state`. Returns false when the message is malformed (the hub counts a bad message). */
  onState(p: Player, buf: Uint8Array): boolean {
    const s = this.inState;
    if (!decodeState(viewOf(buf), s)) return false;
    const r = this.race;
    const car = this.carOf(p);
    if (!r || !car || (this.phase !== 'racing' && this.phase !== 'finishing') || car.timing.status === 'dnf' || car.timing.status === 'dsq') return true;
    const now = this.deps.now();
    const raceMs = now - r.t0;
    const v = car.validator!;
    const verdict = v.check(s, raceMs);
    if (verdict !== 'ok') {
      if (verdict === 'strike') this.strike(car, v.reason, now);
      else if (verdict === 'hard') this.hard(car, v.reason, now);
      return true;
    }
    v.accept(s, raceMs);
    Object.assign(car.state, s);
    car.raw.set(buf.subarray(0, NET_STATE_BYTES));
    car.hasState = true;
    car.fresh = true;
    car.lastAcceptAt = now;
    if ((s.flags & NET_FLAG_RESET) !== 0) car.ghostUntil = now + RESET_GHOST_MS;
    if (r.sim && r.sim.puppets[car.index] === null) r.sim.puppets[car.index] = car.state;

    if (!car.jumpChecked) {
      if (s.simMs >= r.lightsOutAtMs + JUMP_START_WINDOW_MS) car.jumpChecked = true;
      else if (s.progress - car.gridProgress > JUMP_START_M) {
        car.jumpChecked = true;
        this.penalise(car, PENALTY_S, 'jumpStart');
      }
    }
    const inBox = (s.flags & NET_FLAG_IN_PIT_BOX) !== 0;
    if (inBox && !car.inBox) car.timing.stops++;
    car.inBox = inBox;
    if (car.timing.running) this.timingSample(car, s.simMs, s.progress);
    return true;
  }

  private timingSample(car: RaceCar, simMs: number, progress: number): void {
    const t = car.timing;
    const res = t.sample(simMs, progress);
    if (res === LAP_CREDIT) {
      this.broadcast({ type: 'lap', id: car.id, lap: t.lapsCompleted, ms: Math.round(t.lastLapMs), valid: t.isLapValid(t.lapsCompleted), bestMs: Math.round(t.bestLapMs) });
      if (t.lapsCompleted >= this.race!.config.laps || this.phase === 'finishing') this.finish(car);
    } else if (res === LAP_REJECT) {
      this.deps.log('lapRejected', { room: this.code, id: car.id, reason: t.rejectReason });
      if (this.phase === 'finishing' && t.rejectReason === 'floor') return;
    }
  }

  private strike(car: RaceCar, reason: string, now: number): void {
    car.strikes++;
    this.deps.log('strike', { room: this.code, id: car.id, reason });
    if (car.strikeWin.hit(now)) {
      car.muteUntil = now + this.cfg.strikeMuteMs;
      this.deps.log('strikeMute', { room: this.code, id: car.id });
    }
  }

  private hard(car: RaceCar, reason: string, now: number): void {
    car.hardViolations++;
    this.deps.log('hardViolation', { room: this.code, id: car.id, reason });
    this.strike(car, reason, now);
    if (car.hardViolations >= this.cfg.hardLimit && car.timing.status !== 'dsq') {
      this.setStatus(car, 'dsq');
      this.checkRaceOver();
    }
  }

  /** A client `contact` (0x11). Returns false when malformed. */
  onContact(p: Player, buf: Uint8Array): boolean {
    const c: NetContact = this.inContact;
    if (!decodeContact(viewOf(buf), MSG_CONTACT, c)) return false;
    const r = this.race;
    const car = this.carOf(p);
    if (!r || !car || (this.phase !== 'racing' && this.phase !== 'finishing')) return true;
    const now = this.deps.now();
    const other = r.byId[c.other];
    const reject = (why: string): boolean => {
      car.contactRejects++;
      this.deps.log('contactReject', { room: this.code, id: car.id, other: c.other, why });
      if (car.contactRejectWin.hit(now)) this.strike(car, 'contacts', now);
      return true;
    };
    // Impersonation / wrong room / self: the target must be another car of this race, AI only with the source bit.
    if (!other || other === car || other.human === c.fromServer) return reject('target');
    if (!car.contactBucket.take(now) || !this.pairBucket(car, other, now).take(now)) return reject('rate');
    if (!car.timing.running || !other.timing.running || !car.hasState) return reject('state');
    if (now - car.connectedAt < CONTACT_AFTER_CONNECT_MS || (other.human && now - other.connectedAt < CONTACT_AFTER_CONNECT_MS)) {
      return reject('connect');
    }
    if (car.validator!.lagging || car.stale || other.stale) return reject('stale');
    if (now < car.ghostUntil || now < other.ghostUntil) return reject('ghost');
    const a = this.poseA;
    a.x = car.state.x;
    a.z = car.state.z;
    a.vx = car.state.vx;
    a.vz = car.state.vz;
    a.simMs = car.state.simMs;
    if (!this.poseOf(other, this.poseB)) return reject('stale');
    const raceMs = now - r.t0;
    const j = checkContact(c, a, this.poseB, raceMs, r.lightsOutAtMs, this.whyContact);
    if (j < 0) return reject(this.whyContact.r);
    if (!other.human) {
      const sim = r.sim!;
      const ghost = sim.car(other.index).vehicle.aux?.ghostT ?? 0;
      if (ghost > 0) return reject('ghost');
      sim.applyContact(other.index, car.index, j, c.nx, c.nz, c.simMs, NET_LIMITS.contactWindowMs);
      return true;
    }
    const target = other.player?.peer;
    if (!target) return true;
    c.other = car.id;
    c.fromServer = false;
    c.j = j;
    encodeContact(c, MSG_CONTACT_RELAY, viewOf(this.relayBuf));
    target.sendBinary(Uint8Array.from(this.relayBuf), false);
    return true;
  }

  private pairBucket(a: RaceCar, b: RaceCar, now: number): TokenBucket {
    const r = this.race!;
    const key = Math.min(a.id, b.id) * 128 + Math.max(a.id, b.id);
    let tb = r.pairBuckets.get(key);
    if (!tb) {
      tb = new TokenBucket(NET_LIMITS.contactsPerPairPerS, NET_LIMITS.contactsPerPairPerS, now);
      r.pairBuckets.set(key, tb);
    }
    return tb;
  }

  private poseOf(car: RaceCar, out: ContactPose): boolean {
    if (car.human) {
      if (!car.hasState) return false;
      out.x = car.state.x;
      out.z = car.state.z;
      out.vx = car.state.vx;
      out.vz = car.state.vz;
      out.simMs = car.state.simMs;
      return true;
    }
    const sim = this.race!.sim;
    if (!sim) return false;
    const v = sim.car(car.index).vehicle;
    out.x = v.x;
    out.z = v.z;
    out.vx = v.vx;
    out.vz = v.vz;
    out.simMs = sim.simMs;
    return true;
  }

  // ---- connection events ---------------------------------------------------------------------------------------------------

  onDisconnect(p: Player): void {
    p.disconnectedAt = this.deps.now();
    const car = this.carOf(p);
    if (car && this.racing()) this.broadcast({ type: 'player', id: p.id, connected: false, stale: true });
    this.broadcastRoom();
    if (this.phase === 'loading') this.maybeAllLoaded();
  }

  /** The player re-bound a socket (resume token): re-send everything it needs to rebuild its screen. */
  onResume(p: Player): void {
    const now = this.deps.now();
    p.disconnectedAt = Number.NaN;
    p.connectedAt = now;
    this.broadcastRoom();
    const r = this.race;
    const car = this.carOf(p);
    if (!r || !car) return;
    car.connectedAt = now;
    car.validator?.resume();
    if (this.phase !== 'lobby') p.send(this.loadMsg());
    if (Number.isFinite(r.t0)) p.send({ type: 'start', t0ServerMs: r.t0 });
    if (r.results) p.send(r.results);
    if (this.racing()) this.broadcast({ type: 'player', id: p.id, connected: true, stale: false });
  }

  // ---- tick (NET_HZ) -------------------------------------------------------------------------------------------------------

  tick(now: number): void {
    this.dropTimedOut(now);
    if (this.members.length === 0) return;
    const r = this.race;
    if (this.phase === 'loading' && r && now >= r.loadDeadline) this.beginCountdown();
    if (!r || !this.racing()) return;
    if (this.phase === 'countdown' && now >= r.t0) {
      this.phase = 'racing';
      this.broadcastRoom();
    }
    const raceMs = now - r.t0;
    if (raceMs > this.cfg.staleMs) this.updateStale(r, now);
    if (this.phase !== 'countdown') this.checkStalls(r, raceMs);
    if (r.sim) {
      // Absent humans (no state yet, stale / disconnected, retired, DSQ) are parked off the map in the AI sim.
      for (const c of r.cars) if (c.human) r.sim.absent[c.index] = c.timing.status === 'dnf' || c.timing.status === 'dsq' || !c.hasState || c.stale ? 1 : 0;
    }
    if (r.sim && raceMs > 0) {
      const sim = r.sim;
      sim.advanceTo(raceMs, this.cfg.maxStepsPerTick);
      // D-056: penalties the sim gave AI cars (collisions, SC overtaking, …) count in the online results.
      for (const p of sim.takePenalties()) {
        const car = r.cars.find((c) => c.index === p.car && !c.human);
        if (car) this.penalise(car, p.seconds, p.reason);
      }
      const simMs = sim.simMs;
      for (const c of r.cars) {
        if (c.human || !c.timing.running) continue;
        const v = sim.car(c.index).vehicle;
        this.timingSample(c, simMs, v.lapWraps * r.track.query.length + v.s);
      }
    }
    if (!this.race || !this.racing()) return; // the race may have ended inside a timing sample
    this.relay(r, now);
    if (now >= r.nextStandingsAt && this.phase !== 'countdown') {
      r.nextStandingsAt = now + STANDINGS_EVERY_MS;
      this.sendStandings(r);
    }
    if (this.phase === 'finishing' && now >= r.finishDeadline) this.endRace();
    this.accountCpu(now);
  }

  private relay(r: Race, now: number): void {
    const dv = this.scratchView;
    let k = 0;
    for (const c of r.cars) {
      if (c.human) {
        if (!c.fresh || now < c.muteUntil || c.timing.status === 'dsq') continue;
        copyStateToBatch(c.raw, this.scratch, k, c.id, false);
        c.fresh = false;
      } else if (r.sim) {
        r.sim.writeAiState(c.index, this.aiState);
        writeBatchEntry(dv, k, c.id, true, this.aiState);
      } else continue;
      this.entryId[k++] = c.id;
    }
    r.serverSeq = (r.serverSeq + 1) & 0xffff;
    if (k === 0) return;
    for (const m of this.members) {
      const peer = m.peer;
      if (!peer || peer.bufferedAmount() > this.cfg.maxBufferedBytes) continue;
      let own = -1;
      for (let i = 0; i < k; i++) if (this.entryId[i] === m.id) own = i;
      const count = own >= 0 ? k - 1 : k;
      if (count === 0) continue;
      const out = new Uint8Array(batchBytes(count));
      out.set(this.scratch.subarray(0, BATCH_HEADER_BYTES));
      writeBatchHeader(viewOf(out), count, r.serverSeq, now);
      let o = BATCH_HEADER_BYTES;
      for (let i = 0; i < k; i++) {
        if (i === own) continue;
        const src = BATCH_HEADER_BYTES + i * NET_STATE_BYTES;
        out.set(this.scratch.subarray(src, src + NET_STATE_BYTES), o);
        o += NET_STATE_BYTES;
      }
      peer.sendBinary(out, true);
    }
  }

  /**
   * User bug 2026-10-26: a human that is on track (fresh states) but does not move is retired (DNF), so it can neither block
   * the field nor hold a safety car for the rest of the race: START_STALL_MS after lights out if it never left the grid
   * (before the SC rule's 5 + 2 + 10 s), STALL_MS later in the race. Time while stale / disconnected does not count (that car is
   * parked and keeps its seat until the reconnect grace ends).
   */
  private checkStalls(r: Race, raceMs: number): void {
    if (raceMs < r.lightsOutAtMs) return;
    for (const c of r.cars) {
      if (!c.human || !c.timing.running) continue;
      let stalled = false;
      if (!c.hasState) stalled = raceMs - r.lightsOutAtMs >= this.cfg.startStallMs; // never on the grid: did not start
      else if (c.stale) c.stillSinceMs = Number.NaN;
      else {
        const p = c.state.progress;
        if (!(c.stillSinceMs === c.stillSinceMs) || Math.abs(p - c.stillProgress) > STALL_MOVE_M) {
          c.stillSinceMs = raceMs;
          c.stillProgress = p;
          if (p - c.gridProgress > STALL_MOVE_M) c.started = true;
        } else stalled = raceMs - c.stillSinceMs >= (c.started ? this.cfg.stallMs : this.cfg.startStallMs);
      }
      if (stalled) {
        this.deps.log('stalled', { room: this.code, id: c.id, started: c.started, hasState: c.hasState });
        this.setStatus(c, 'dnf');
        this.checkRaceOver();
        if (this.phase === 'results') return;
      }
    }
  }

  private updateStale(r: Race, now: number): void {
    for (const c of r.cars) {
      if (!c.human || !c.timing.running) continue;
      const stale = !c.player?.connected || now - c.lastAcceptAt > this.cfg.staleMs || now < c.muteUntil;
      if (stale !== c.stale) {
        c.stale = stale;
        this.broadcast({ type: 'player', id: c.id, connected: c.player?.connected ?? false, stale });
      }
    }
  }

  private sendStandings(r: Race): void {
    const sorted = [...r.cars].sort(compareCars);
    const leader = sorted[0]!.timing;
    this.broadcast({
      type: 'standings',
      order: sorted.map((c) => c.id),
      laps: sorted.map((c) => Math.min(99, c.timing.lapsCompleted)),
      gapMs: sorted.map((c) => gapToLeaderMs(leader, c.timing)),
      status: sorted.map((c) => c.timing.status),
    });
  }

  private accountCpu(now: number): void {
    const sim = this.race?.sim;
    if (!sim) return;
    if (now - this.cpuWinStart >= 5000) {
      this.simCpuPct = Math.round(((sim.busyMs - this.cpuWinBusy) / (now - this.cpuWinStart)) * 1000) / 10;
      this.cpuWinBusy = sim.busyMs;
      this.cpuWinStart = now;
    }
  }

  /** Disconnected members past their grace window leave (lobby/results) or are DNF and leave (race). */
  private dropTimedOut(now: number): void {
    const grace = this.phase === 'lobby' || this.phase === 'results' ? this.cfg.graceLobbyMs : this.phase === 'loading' ? this.cfg.graceLoadingMs : this.cfg.graceRaceMs;
    for (const m of [...this.members]) {
      if (!m.connected && now - m.disconnectedAt >= grace) this.leave(m, 'timeout');
    }
  }

  // ---- helpers ---------------------------------------------------------------------------------------------------------------

  carOf(p: Player): RaceCar | undefined {
    const c = this.race?.byId[p.id];
    return c && c.human && c.player === p ? c : undefined;
  }

  private freeSeat(): { teamId: string; driverIdx: 0 | 1 } | null {
    for (const t of TEAMS) {
      for (const idx of [0, 1] as const) {
        if (!this.members.some((m) => m.teamId === t.id && m.driverIdx === idx)) return { teamId: t.id, driverIdx: idx };
      }
    }
    return null;
  }

  snapshot(): NetServerMsg {
    const players: NetPlayerInfo[] = this.members.map((m) => ({
      id: m.id, name: m.name, teamId: m.teamId, driverIdx: m.driverIdx, ready: m.ready, connected: m.connected,
      pingMs: Math.max(0, Math.min(60_000, Math.round(m.peer?.pingMs ?? 0))),
    }));
    return { type: 'room', code: this.code, ownerId: this.ownerId, phase: this.phase, settings: this.settings, players, teams: [...this.customTeams.values()] };
  }

  broadcastRoom(): void {
    this.broadcast(this.snapshot());
  }

  broadcast(msg: NetServerMsg): void {
    for (const m of this.members) m.peer?.sendJson(msg);
  }

  private close(): void {
    this.race = null;
    this.deps.log('roomClose', { room: this.code });
    this.deps.closed(this);
  }

  /** Test/health view. */
  stats(): { phase: NetRoomPhase; humans: number; ai: number; simCpuPct: number; simSteps: number; droppedSteps: number } {
    const sim = this.race?.sim;
    return {
      phase: this.phase, humans: this.members.length, ai: this.race ? this.race.cars.filter((c) => !c.human).length : 0,
      simCpuPct: this.simCpuPct, simSteps: sim?.steps ?? 0, droppedSteps: sim?.droppedSteps ?? 0,
    };
  }
}
