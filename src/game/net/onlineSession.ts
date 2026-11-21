// Online race glue (design §5, §6; multiplayer-tasks A.2 `onlineSession.ts`). One instance per server `load` (raceId).
// Headless-capable: it needs a NetClient and a SimRunner only, so the rendering session (session.ts) and Node tests drive it
// the same way:
//   createOnlineRace(net, load, …) → createSim(race.cfg, { lineup: race.lineup }) → race.bind(sim) → race.sendLoaded()
//   per frame:  n = race.targetTicks();  n × { race.beforeTick(); sim.step() };  race.afterTicks()
// Local human = car 0 ('player'); every other roster entry (humans and server AI, D-043) is a 'remote' puppet posed from its
// samples (puppet.ts). Standings, laps and results come from the server; the local director only times the local car and
// tracks puppet progress/markers for gaps.

import type { Unsubscribe } from '../../contracts/common';
import type { NetCarState, NetContact, NetResultRow, NetRosterEntry, NetServerMsg } from '../../contracts/net';
import { NET_HZ } from '../../contracts/net';
import type { HudModel, TowerRow } from '../../contracts/hud';
import type { SessionConfig } from '../../contracts/race';
import { SIM_DT, type SimEvent, type SimLineupEntry, type SimRunner } from '../../contracts/sim';
import type { GroundHit } from '../../contracts/track';
import type { ResultsModel } from '../../contracts/ui';
import {
  NET_FLAG_DRS_OPEN, NET_FLAG_FINISHED, NET_FLAG_IN_PIT_BOX, NET_FLAG_PIT_LIMITER, NET_FLAG_PIT_RIBBON, NET_FLAG_RESET, NET_FLAG_REVERSE,
  newNetCarState, newNetContact, trackHashOf, type NetClient,
} from '../../net/index';
import {
  applyContactImpulse, contactScale, contactTopUp, createContactEpisodes, type CollisionOptions, type ContactEpisodes,
} from '../../physics/index';
import { crx } from '../../race/extra';
import { parkOffTrack } from '../../race/index';
import { defaultSessionConfig } from '../createSim';
import { createPuppetBuffer, newPuppetPose, writePuppet, type PuppetBuffer, type PuppetStatus } from './puppet';

type LoadMsg = Extract<NetServerMsg, { type: 'load' }>;
type StandingsMsg = Extract<NetServerMsg, { type: 'standings' }>;

/** Server standings are preferred while younger than this (design §6.1). */
export const STANDINGS_FRESH_MS = 1000;
const SEND_EVERY_MS = 1000 / NET_HZ;
const NO_CAR = -1;

export interface OnlineRaceOptions {
  /** Local choices kept online (design §5.1): assists, start compound … */
  local?: Partial<Pick<SessionConfig, 'assists' | 'startCompound' | 'wearScale'>>;
  /** AI drives the local car (tests / `?autodrive=1`). */
  autodrive?: boolean;
}

export interface OnlineStandings { order: Int16Array; gapMs: Float64Array; count: number }

export interface OnlineRace {
  readonly raceId: string;
  readonly cfg: SessionConfig;
  readonly lineup: readonly SimLineupEntry[];
  /** Tower code per car (nickname for humans, null = the driver's own code for AI). */
  readonly codes: readonly (string | null)[];
  readonly roster: readonly NetRosterEntry[];
  /** P3c: CollisionSystem options for createSim (latency scale, response delay, the shared contact episodes). */
  readonly collision: CollisionOptions;
  readonly episodes: ContactEpisodes;
  /** car id → NetId and back. */
  carOf(id: number): number;
  idOf(car: number): number;
  /** Attach the sim built from `cfg` + `lineup`; `onSnap(car)` is called when a puppet teleports (rf.snapPrev). */
  bind(sim: SimRunner, onSnap?: (car: number) => void): void;
  /** `loaded{trackHash}` (after the session is fully built). */
  sendLoaded(): void;
  /** Server start time (NaN until `start`). */
  t0(): number;
  /** CR-NET-7: ticks the sim is behind the shared clock; 0 before T0. */
  targetTicks(): number;
  /** Puppet writer + relayed contacts; call before every sim step. */
  beforeTick(): void;
  /** Own state at NET_HZ; call after each tick batch. */
  afterTicks(): void;
  /** Local sim events (track-limit / cut / pit reports to the server, reset flag). */
  onSimEvent(e: SimEvent): void;
  link(car: number): NonNullable<TowerRow['net']>;
  /** Last lobby ping of a human car's player (NaN for AI / unknown). */
  rttOf(car: number): number;
  /** Fresh server order (car ids) + leader gaps, or null. */
  standings(): OnlineStandings | null;
  hudNet(): NonNullable<HudModel['net']>;
  /** Server classification (null until `results`). */
  results(): ResultsModel | null;
  staleCount(): number;
  dispose(): void;
}

/** SessionConfig of an online race (design §5.1): everything from the server, assists etc. local, no flashback / AI / two-compound rule. */
export function onlineSessionConfig(load: LoadMsg, me: NetRosterEntry, opts: OnlineRaceOptions = {}): SessionConfig {
  const c = load.config;
  return defaultSessionConfig({
    ...opts.local,
    mode: 'race', trackId: c.trackId, laps: c.laps, tod: c.tod, weather: c.weather, seed: c.seed, difficulty: c.difficulty,
    aiCount: load.roster.length - 1, playerTeamId: me.teamId, playerDriverIdx: me.driverIdx, gridPos: me.gridSlot + 1,
    flashbacks: 0, mandatoryStop: false, autodrive: opts.autodrive === true,
    // D-058: equal cars online (the server sim builds its config the same way: serverAi.sessionConfigFor).
    equalCars: true,
    // D-061: the room's race mode, applied identically by the server sim (serverAi.sessionConfigFor).
    rules: c.mode === 'kasap' ? 'kasap' : 'normal',
  });
}

/** Tower code from a nickname (multiplayer-tasks A.1): first 3 letters, upper-cased with the Turkish locale. */
export function nicknameCode(name: string): string {
  const letters = [...name].filter((ch) => /\p{L}|\p{Nd}/u.test(ch)).slice(0, 3).join('');
  return (letters || name.slice(0, 3)).toLocaleUpperCase('tr-TR');
}

/** ResultsModel from the server rows (car = local car id). */
export function buildOnlineResults(rows: readonly NetResultRow[], carOf: (id: number) => number): ResultsModel {
  let fastestCar = -1;
  let fastestMs = Infinity;
  const out: ResultsModel['rows'] = [];
  for (const r of rows) {
    const car = carOf(r.id);
    if (car < 0) continue;
    if (r.bestLapMs > 0 && r.bestLapMs < fastestMs) {
      fastestMs = r.bestLapMs;
      fastestCar = car;
    }
    out.push({
      pos: r.pos, car, name: r.name, teamId: r.teamId, totalMs: r.totalMs, gapMs: r.gapMs, lapsDown: r.lapsDown, bestLapMs: r.bestLapMs,
      stops: r.stops, penaltySec: r.penaltySec, points: r.points, status: r.status,
    });
  }
  out.sort((a, b) => a.pos - b.pos);
  return { rows: out, fastestCar };
}

export function createOnlineRace(net: NetClient, load: LoadMsg, myId: number, opts: OnlineRaceOptions = {}): OnlineRace {
  const meIdx = load.roster.findIndex((r) => r.id === myId);
  if (meIdx < 0) throw new Error(`online: player ${myId} is not in the roster of ${load.raceId}`);
  const me = load.roster[meIdx]!;
  // Car 0 = the local human (PLAYER_CAR_ID); the others keep roster order.
  const roster = [me, ...load.roster.filter((_, i) => i !== meIdx)];
  const n = roster.length;
  const carById = new Int16Array(128).fill(NO_CAR);
  roster.forEach((r, i) => (carById[r.id] = i));
  const lineup: SimLineupEntry[] = roster.map((r, i) => ({
    teamId: r.teamId, driverIdx: r.driverIdx, gridSlot: r.gridSlot, control: i === 0 ? 'player' : 'remote', human: r.kind === 'human',
  }));
  const codes = roster.map((r) => (r.kind === 'human' ? nicknameCode(r.name) : null));
  const cfg = onlineSessionConfig(load, me, opts);

  const buffers: PuppetBuffer[] = roster.map(() => createPuppetBuffer());
  const status: PuppetStatus[] = roster.map(() => 'none');
  const parked = new Uint8Array(n);
  const connected = roster.map(() => true);
  const serverStale = roster.map(() => false);
  const pingMs = new Float64Array(n).fill(Number.NaN);
  const pose = newPuppetPose();
  const gh: GroundHit = { y: 0, nx: 0, ny: 1, nz: 0, surface: 'asphalt', ribbon: 'main', s: 0, d: 0, sp: NaN, inLimits: true, wetLocal: 1 };
  const out = newNetCarState();
  const standingsOut: OnlineStandings = { order: new Int16Array(n), gapMs: new Float64Array(n), count: 0 };
  // Relayed contacts (P3c glue): applied before the next tick, deduplicated per episode with the local detection.
  const contactQ = Array.from({ length: 8 }, newNetContact);
  let contactN = 0;
  const hudNetOut = { rttMs: 0 };
  // P3c: one episode memory per race, shared by the CollisionSystem (local hits) and the relayed contacts below.
  const episodes = createContactEpisodes(n);
  const lastContactSentMs = new Float64Array(n).fill(-Infinity);
  const outContact = newNetContact();
  let contactSeq = 0;
  const rttNow = (): number => net.stats().rttMs;
  /** Age (ms) of a puppet's newest sample on the shared race clock (Infinity before the first one). */
  const sampleAgeMs = (car: number): number => simMs() - buffers[car]!.newestT() * 1000;
  const collision: CollisionOptions = {
    remoteContactScale: (car) => contactScale(rttNow(), sampleAgeMs(car)),
    remoteResponseDelayMs: () => rttNow() / 2 + 50,
    episodes,
  };

  let sim: SimRunner | null = null;
  let snap: (car: number) => void = () => {};
  let t0 = Number.NaN;
  let nextSendMs = 0;
  let seq = 0;
  let resetPending = false;
  let lastStandings: StandingsMsg | null = null;
  let standingsAt = -Infinity;
  let results: ResultsModel | null = null;
  let disposed = false;

  const simMs = (): number => (sim ? sim.world.state.time * 1000 : 0);

  const applyStandings = (m: StandingsMsg): void => {
    if (!sim) return;
    const cars = sim.world.state.cars;
    for (let k = 0; k < m.order.length; k++) {
      const car = carById[m.order[k]!]!;
      if (car <= 0) continue; // local car: own director
      const r = cars[car]!.race;
      r.lapsCompleted = m.laps[k]!;
      const st = m.status[k]!;
      if (st !== 'running' && r.status === 'running') {
        r.status = st;
        if (st === 'finished') {
          r.finished = true;
          r.finishMs = sim.world.state.race.raceMs;
        }
      }
    }
  };

  const onMessage = (m: NetServerMsg): void => {
    switch (m.type) {
      case 'start':
        t0 = m.t0ServerMs;
        break;
      case 'room':
        for (const pl of m.players) {
          const car = carById[pl.id]!;
          if (car >= 0) pingMs[car] = pl.pingMs;
        }
        break;
      case 'standings':
        lastStandings = m;
        standingsAt = net.serverNow();
        applyStandings(m);
        break;
      case 'lap': {
        const car = carById[m.id]!;
        if (car > 0 && sim) {
          const r = sim.world.state.cars[car]!.race;
          r.lastLapMs = m.ms;
          if (m.bestMs > 0) r.bestLapMs = m.bestMs;
        }
        break;
      }
      case 'finishing':
        // Design §6.1: the glue writes 'finishing' so the local car finishes at its next line crossing.
        if (sim && sim.world.state.race.phase === 'running') {
          sim.world.state.race.phase = 'finishing';
          sim.world.state.race.finishCountdownMs = m.windowMs;
        }
        break;
      case 'player': {
        const car = carById[m.id]!;
        if (car >= 0) {
          connected[car] = m.connected;
          serverStale[car] = m.stale;
        }
        break;
      }
      case 'results':
        results = buildOnlineResults(m.rows, (id) => carById[id]!);
        break;
      case 'welcome':
        // P3c: no contact in the first 2 s after a (re)connect / resume (design §6.2).
        for (let i = 1; i < n; i++) ghost(i, 2);
        break;
      default:
        break;
    }
  };

  const ghost = (car: number, s: number): void => {
    // VehicleState.aux is created by the physics on the first tick; until then there is nothing to ghost.
    const a = sim?.world.state.cars[car]!.vehicle.aux;
    if (a && a.ghostT < s) a.ghostT = s;
  };

  const onStates = (e: Readonly<NetCarState>): void => {
    const car = carById[e.id]!;
    if (car <= 0) return; // unknown or the local car's own echo
    // P3c: a reset puppet is a 3 s ghost (no contact), as offline after a car reset.
    if (buffers[car]!.push(e, simMs() / 1000) && (e.flags & NET_FLAG_RESET) !== 0) ghost(car, 3);
  };

  const onContact = (c: Readonly<NetContact>): void => {
    if (contactN < contactQ.length) Object.assign(contactQ[contactN++]!, c);
  };

  const unsubs: Unsubscribe[] = [net.onMessage(onMessage), net.onStates(onStates), net.onContact(onContact)];
  // A `start` that arrived before this race existed (resume) is in the lobby store.
  const t0Known = net.lobby.get().t0ServerMs;
  if (t0Known !== null && net.lobby.get().room?.phase !== 'loading') t0 = t0Known;
  for (const pl of net.lobby.get().room?.players ?? []) {
    const car = carById[pl.id]!;
    if (car >= 0) pingMs[car] = pl.pingMs;
  }

  const sendOwnState = (): void => {
    if (!sim) return;
    const w = sim.world;
    const c = w.state.cars[0]!;
    const v = c.vehicle;
    let flags = 0;
    if (v.pitLimiterOn) flags |= NET_FLAG_PIT_LIMITER;
    if (v.drs.open) flags |= NET_FLAG_DRS_OPEN;
    if (v.hint.ribbon === 'pit') flags |= NET_FLAG_PIT_RIBBON;
    if (c.pit.phase === 'stationary') flags |= NET_FLAG_IN_PIT_BOX;
    if (resetPending) flags |= NET_FLAG_RESET;
    if (c.race.finished) flags |= NET_FLAG_FINISHED;
    if (v.gear < 0) flags |= NET_FLAG_REVERSE;
    resetPending = false;
    out.flags = flags;
    seq = (seq + 1) & 0xffff;
    out.seq = seq;
    out.simMs = Math.round(w.state.time * 1000);
    out.x = v.x;
    out.y = v.y;
    out.z = v.z;
    out.progress = v.lapWraps * w.static.track.query.length + v.s;
    out.yaw = v.yaw;
    out.vx = v.vx;
    out.vz = v.vz;
    out.yawRate = v.yawRate;
    out.steerAngle = v.steerAngle;
    out.throttle = c.input.throttle;
    out.brake = c.input.brake;
    out.gear = v.gear;
    out.rpm = v.rpm;
    out.drsFlap = v.drs.flap;
    out.compound = v.compound;
    out.ersDeploying = v.ers.deployKw > 0;
    net.sendState(out);
  };


  const race: OnlineRace = {
    raceId: load.raceId,
    cfg,
    lineup,
    collision,
    episodes,
    codes,
    roster,
    carOf: (id) => (id >= 0 && id < 128 ? carById[id]! : NO_CAR),
    idOf: (car) => roster[car]?.id ?? NO_CAR,
    bind(s, onSnap) {
      sim = s;
      if (onSnap) snap = onSnap;
    },
    sendLoaded() {
      if (sim) net.send({ type: 'loaded', trackHash: trackHashOf(sim.world.static.track.data) });
    },
    t0: () => t0,
    targetTicks() {
      if (!sim || !(t0 === t0)) return 0;
      return (net.serverNow() - t0) / 1000 / SIM_DT - sim.world.state.tick;
    },
    beforeTick() {
      if (!sim) return;
      const w = sim.world;
      const cars = w.state.cars;
      const q = w.static.track.query;
      const t = (w.state.tick + 1) * SIM_DT; // the time the coming step produces
      for (let i = 1; i < n; i++) {
        const b = buffers[i]!;
        const car = cars[i]!;
        // User bug 2026-10-26: a car that is not on track (retired / DSQ, disconnected, server-stale) is parked off the map
        // (hidden, no obstacle, no yellow / safety-car cause), as on the server; it snaps back when it is live again.
        const rs = car.race.status;
        if (rs === 'dnf' || rs === 'dsq' || !connected[i] || serverStale[i]) {
          parkOffTrack(car);
          parked[i] = 1;
          status[i] = b.count() > 0 ? 'stale' : 'none';
          continue;
        }
        const st = b.sample(t, pose);
        status[i] = st;
        // No sample yet / past the extrapolation horizon: shown where it is, but no yellow / safety-car cause.
        crx(car.race).scCleared = st === 'live' ? 0 : 1;
        if (st === 'none') continue;
        writePuppet(car, pose, b.newest()!, w.static.params[i]!, q, gh, SIM_DT);
        if (b.takeSnap() || parked[i] === 1) snap(i);
        parked[i] = 0;
      }
      if (contactN > 0) {
        const me0 = cars[0]!;
        for (let k = 0; k < contactN; k++) {
          const c = contactQ[k]!;
          const other = carById[c.other]!;
          if (other <= 0) continue;
          const add = contactTopUp(episodes, 0, other, c.j, w.state.race.raceMs);
          if (add <= 0) continue;
          applyContactImpulse(me0.vehicle, w.static.params[0]!, add, c.nx, c.nz, c.px, c.pz);
          // For audio / VFX / camera shake: a = the sender (so it is never relayed back), n = sender → local car.
          w.events.push({ type: 'collision', a: other, b: 0, impulse: add, x: c.px, y: me0.vehicle.y, z: c.pz, nx: c.nx, nz: c.nz });
        }
        contactN = 0;
      }
    },
    afterTicks() {
      if (!sim || disposed) return;
      const tMs = sim.world.state.time * 1000;
      // NET_HZ on the race clock, phase kept across frames (any frame rate averages 20 Hz); a stall restarts the schedule.
      if (sim.world.state.tick > 0 && tMs >= nextSendMs - 0.5) {
        nextSendMs = tMs - nextSendMs > SEND_EVERY_MS ? tMs + SEND_EVERY_MS : nextSendMs + SEND_EVERY_MS;
        sendOwnState();
      }
      net.setStaleCars(race.staleCount());
    },
    onSimEvent(e) {
      if (!sim) return;
      const lap = sim.world.state.cars[0]!.race.lapsCompleted;
      switch (e.type) {
        case 'carReset':
          if (e.car === 0) resetPending = true;
          break;
        case 'collision': {
          // P3c: the local car hit a puppet → `contact` to its owner, at most one per 200 ms episode per pair (5/s).
          const other = e.b;
          if (e.a !== 0 || other <= 0 || other >= n || e.nx === undefined || e.nz === undefined) break;
          const nowMs = sim.world.state.race.raceMs;
          if (nowMs - lastContactSentMs[other]! < 200) break;
          lastContactSentMs[other] = nowMs;
          const oc = outContact;
          oc.other = roster[other]!.id;
          oc.fromServer = false;
          contactSeq = (contactSeq + 1) & 0xffff;
          oc.seq = contactSeq;
          oc.simMs = Math.round(sim.world.state.time * 1000);
          oc.j = e.impulse;
          oc.nx = e.nx;
          oc.nz = e.nz;
          oc.px = e.x;
          oc.pz = e.z;
          const a = sim.world.state.cars[0]!.vehicle;
          const b = sim.world.state.cars[other]!.vehicle;
          oc.vRelN = (b.vx - a.vx) * e.nx + (b.vz - a.vz) * e.nz;
          oc.episode = contactSeq;
          net.sendContact(oc);
          break;
        }
        case 'penalty':
          if (e.car === 0 && (e.reason === 'trackLimits' || e.reason === 'cornerCut' || e.reason === 'pitSpeeding' || e.reason === 'collision' || e.reason === 'safetyCar')) {
            net.send({ type: 'report', kind: e.reason, seconds: e.seconds, lap });
          }
          break;
        case 'lapInvalidated':
          if (e.car === 0 && (e.reason === 'trackLimits' || e.reason === 'cornerCut')) net.send({ type: 'report', kind: 'lapInvalidated', lap });
          break;
        default:
          break;
      }
    },
    link(car) {
      if (car === 0) return net.lobby.get().status === 'online' ? 'ok' : 'dc';
      if (!connected[car]) return 'dc';
      return serverStale[car] || status[car] === 'stale' ? 'stale' : 'ok';
    },
    rttOf: (car) => (car === 0 ? net.stats().rttMs : pingMs[car] ?? Number.NaN),
    standings() {
      const m = lastStandings;
      if (!m || net.serverNow() - standingsAt > STANDINGS_FRESH_MS || m.order.length !== n) return null;
      for (let k = 0; k < n; k++) {
        const car = carById[m.order[k]!]!;
        if (car < 0) return null;
        standingsOut.order[k] = car;
        standingsOut.gapMs[k] = m.gapMs[k]!;
      }
      standingsOut.count = n;
      return standingsOut;
    },
    hudNet() {
      hudNetOut.rttMs = Math.round(net.stats().rttMs);
      return hudNetOut;
    },
    results: () => results,
    staleCount() {
      let k = 0;
      for (let i = 1; i < n; i++) if (status[i] === 'stale' || serverStale[i]) k++;
      return k;
    },
    dispose() {
      disposed = true;
      for (const u of unsubs) u();
      net.setStaleCars(0);
    },
  };
  return race;
}
