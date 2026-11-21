// Server-side AI (D-043): one pure sim per racing room, run at 240 Hz in Node. AI cars are 'ai' (simulated here and
// streamed to the clients with the id bit-7 source flag); humans are 'remote' puppets posed from their latest validated
// states before every step, so the AI sees and races them. Allocation-free per step (the sim's own event objects aside).
import type { NetCarState, NetRaceConfig, NetRosterEntry } from '../../src/contracts/net';
import type { PenaltyReason, SessionConfig } from '../../src/contracts/race';
import { SIM_DT, type SimCarState, type SimEvent, type SimLineupEntry, type SimRunner } from '../../src/contracts/sim';
import type { TrackBundle } from '../../src/contracts/track';
import { createSim, defaultSessionConfig } from '../../src/game/createSim';
import { crx } from '../../src/race/extra';
import { parkOffTrack } from '../../src/race/safetyCar';
import {
  NET_FLAG_DRS_OPEN, NET_FLAG_FINISHED, NET_FLAG_IN_PIT_BOX, NET_FLAG_PIT_LIMITER, NET_FLAG_PIT_RIBBON, NET_FLAG_RESET, NET_FLAG_REVERSE,
} from '../../src/net/protocol';

/** Extrapolation horizon of a puppet past its newest sample (the clients' horizon, src/game/net/puppet.ts); then it holds. */
const PUPPET_MAX_EXTRAP_S = 0.4;

export function sessionConfigFor(cfg: NetRaceConfig, aiCount: number): SessionConfig {
  return defaultSessionConfig({
    mode: 'race', trackId: cfg.trackId, laps: cfg.laps, tod: cfg.tod, weather: cfg.weather, seed: cfg.seed, aiCount,
    difficulty: cfg.difficulty, flashbacks: 0, autodrive: false, mandatoryStop: false,
    // D-058: equal cars online, as every client's onlineSessionConfig.
    equalCars: true,
    // D-061: same rule set as every client (onlineSessionConfig).
    rules: cfg.mode === 'kasap' ? 'kasap' : 'normal',
  });
}

/** Last collision the sim itself resolved between an AI car and another car (contact top-up, design §6.2 step 4). */
interface SimContact { other: number; impulse: number; simMs: number }

export class RoomSim {
  readonly runner: SimRunner;
  /** Roster index = sim car id. */
  readonly roster: readonly NetRosterEntry[];
  /** Latest validated state per car (humans only; null until the first one). Owned by the room, read here. */
  readonly puppets: (NetCarState | null)[];
  /**
   * Per car, set by the room every tick: 1 = the human is not on track (no state yet, stale / disconnected, retired, DSQ). Its
   * puppet is parked off the map like a marshal-cleared car: no obstacle for the AI, no yellow / safety-car cause (user bug
   * 2026-10-26: AI stuck on the grid behind absent humans, then a safety car that never ended).
   */
  readonly absent: Uint8Array;
  readonly lastContact: SimContact[];
  /** Per AI car: a carReset happened since the last streamed state. */
  private readonly resetPending: Uint8Array;
  private readonly seq: Uint16Array;
  private readonly onEvent: (e: SimEvent) => void;
  /** Penalties the sim gave AI cars since the last takePenalties() (collision, SC overtaking, track limits …; D-056). */
  private pendingPenalties: { car: number; seconds: number; reason: PenaltyReason }[] = [];
  private readonly sd = { s: 0, d: 0 };
  /** Wall ms spent stepping (CPU per room, /health). */
  busyMs = 0;
  steps = 0;
  droppedSteps = 0;

  constructor(cfg: NetRaceConfig, roster: readonly NetRosterEntry[], track: TrackBundle) {
    this.roster = roster;
    const aiCount = roster.filter((r) => r.kind === 'ai').length;
    const lineup: SimLineupEntry[] = roster.map((r) => ({
      teamId: r.teamId, driverIdx: r.driverIdx, gridSlot: r.gridSlot, control: r.kind === 'ai' ? 'ai' : 'remote', human: r.kind === 'human',
    }));
    this.runner = createSim(sessionConfigFor(cfg, aiCount), { track, lineup });
    this.puppets = roster.map(() => null);
    this.absent = new Uint8Array(roster.length);
    this.lastContact = roster.map(() => ({ other: -1, impulse: 0, simMs: -1e9 }));
    this.resetPending = new Uint8Array(roster.length);
    this.seq = new Uint16Array(roster.length);
    this.onEvent = (e) => {
      if (e.type === 'carReset') this.resetPending[e.car] = 1;
      // Humans are 'remote' puppets here: their own client judges and reports them; only AI penalties are forwarded.
      else if (e.type === 'penalty' && this.roster[e.car]?.kind === 'ai') this.pendingPenalties.push({ car: e.car, seconds: e.seconds, reason: e.reason });
      else if (e.type === 'collision' && e.b >= 0) {
        const t = Math.round(this.runner.world.state.time * 1000);
        this.noteContact(e.a, e.b, e.impulse, t);
        this.noteContact(e.b, e.a, e.impulse, t);
      }
    };
  }

  /** AI-car penalties since the last call (roster index = sim car id). */
  takePenalties(): { car: number; seconds: number; reason: PenaltyReason }[] {
    const p = this.pendingPenalties;
    if (p.length > 0) this.pendingPenalties = [];
    return p;
  }

  get simMs(): number {
    return Math.round(this.runner.world.state.time * 1000);
  }

  /** Steps the sim until its clock reaches `raceMs` (at most maxSteps per call; the rest is dropped). */
  advanceTo(raceMs: number, maxSteps: number): number {
    const st = this.runner.world.state;
    const target = Math.floor(raceMs / 1000 / SIM_DT);
    if (target - st.tick > maxSteps) {
      this.droppedSteps += target - st.tick - maxSteps;
      // Keep the sim clock on the race clock: skip time without simulating it (logged by the room).
      st.tick = target - maxSteps;
      st.time = st.tick * SIM_DT;
    }
    let n = 0;
    const t0 = performance.now();
    while (st.tick < target) {
      this.writePuppets();
      this.runner.step();
      n++;
    }
    this.runner.world.events.drain(this.onEvent);
    this.busyMs += performance.now() - t0;
    this.steps += n;
    return n;
  }

  /** Encodes AI car `car` as a NetCarState (id/fromServer filled by the caller's batch writer). */
  writeAiState(car: number, out: NetCarState): void {
    const c = this.runner.world.state.cars[car]!;
    const v = c.vehicle;
    const L = this.runner.world.static.track.query.length;
    let flags = 0;
    if (v.pitLimiterOn) flags |= NET_FLAG_PIT_LIMITER;
    if (v.drs.open) flags |= NET_FLAG_DRS_OPEN;
    if (v.hint.ribbon === 'pit') flags |= NET_FLAG_PIT_RIBBON;
    if (c.pit.phase === 'stationary') flags |= NET_FLAG_IN_PIT_BOX;
    if (this.resetPending[car] === 1) flags |= NET_FLAG_RESET;
    if (c.race.finished) flags |= NET_FLAG_FINISHED;
    if (v.gear < 0) flags |= NET_FLAG_REVERSE;
    this.resetPending[car] = 0;
    this.seq[car] = (this.seq[car]! + 1) & 0xffff;
    out.flags = flags;
    out.seq = this.seq[car]!;
    out.simMs = this.simMs;
    out.x = v.x;
    out.y = v.y;
    out.z = v.z;
    out.progress = v.lapWraps * L + v.s;
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
  }

  car(car: number): SimCarState {
    return this.runner.world.state.cars[car]!;
  }

  /** Validated contact on a server AI car (design §6.2): Δv = j·n / m on the AI car, minus what the sim already applied. */
  applyContact(car: number, otherCar: number, j: number, nx: number, nz: number, simMs: number, windowMs: number): number {
    const last = this.lastContact[car]!;
    let jApply = j;
    if (last.other === otherCar && Math.abs(simMs - last.simMs) <= windowMs) jApply = Math.max(0, j - last.impulse);
    if (jApply <= 0) return 0;
    const v = this.car(car).vehicle;
    v.vx += (jApply * nx) / v.massKg;
    v.vz += (jApply * nz) / v.massKg;
    this.noteContact(car, otherCar, last.other === otherCar ? Math.max(j, last.impulse) : j, simMs);
    return jApply;
  }

  private noteContact(car: number, other: number, impulse: number, simMs: number): void {
    const c = this.lastContact[car];
    if (!c) return;
    c.other = other;
    c.impulse = impulse;
    c.simMs = simMs;
  }

  /** Poses every human puppet from its newest validated sample, extrapolated ≤ 250 ms to the sim time. */
  private writePuppets(): void {
    const w = this.runner.world;
    const q = w.static.track.query;
    const L = q.length;
    const t = (w.state.tick + 1) * SIM_DT; // the time the coming step produces
    for (let i = 0; i < this.puppets.length; i++) {
      const p = this.puppets[i];
      const c = w.state.cars[i]!;
      const v = c.vehicle;
      if (this.absent[i] === 1) {
        parkOffTrack(c);
        continue;
      }
      if (!p) continue;
      // Back on track (or never gone): a yellow / safety-car cause again when it stops.
      crx(c.race).scCleared = 0;
      let dt = t - p.simMs / 1000;
      dt = dt < 0 ? 0 : dt > PUPPET_MAX_EXTRAP_S ? PUPPET_MAX_EXTRAP_S : dt;
      const speed = Math.hypot(p.vx, p.vz);
      v.x = p.x + p.vx * dt;
      v.z = p.z + p.vz * dt;
      v.y = p.y;
      v.yaw = p.yaw + p.yawRate * dt;
      v.vx = p.vx;
      v.vz = p.vz;
      v.yawRate = p.yawRate;
      v.speed = speed;
      v.vLong = p.gear < 0 ? -speed : speed;
      v.vLat = 0;
      v.steerAngle = p.steerAngle;
      v.gear = p.gear;
      v.rpm = p.rpm;
      const progress = p.progress + (p.gear < 0 ? -speed : speed) * dt;
      v.lapWraps = Math.floor(progress / L);
      v.s = progress - v.lapWraps * L;
      v.hint.s = v.s;
      q.project(v.x, v.z, v.hint, this.sd);
      v.d = this.sd.d;
      c.race.progress = progress;
      c.input.throttle = p.throttle;
      c.input.brake = p.brake;
    }
  }
}
