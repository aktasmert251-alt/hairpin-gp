// createSim (§4 modules.ts): the canonical world factory used by the game AND by tests.
// Builds a plain-data SimState and wires the systems in the §3.3 order from the module factories.
// Sim layer: no three, no DOM, no Math.random; step() is allocation-free (events aside).

import type { AIDriverProfile, AIState } from '../contracts/ai';
import type { Compound } from '../contracts/common';
import type { DriverDef, TeamDef, TeamTraits } from '../contracts/data';
import type { SessionConfig } from '../contracts/race';
import { SIM_DT, type CreateSimOptions, type SimCarState, type SimLineupEntry, type SimRunner, type SimState, type SimSystem, type SimWorld } from '../contracts/sim';
import type { TrackBundle } from '../contracts/track';
import type { DriverControls, VehicleInput } from '../contracts/vehicle';
import { createAIModule, createAISystem } from '../ai/index';
import { createRng, nextRandom, seedStream } from '../core/rng';
import { ALL_DRIVERS, DEFAULT_PLAYER_TEAM, TEAMS, teamById } from '../data/teams';
import { customTeamById, customTeamDef } from '../data/customTeams';
import {
  createCollisionSystem, createPlayerInputSystem, createVehicleSystem, defaultVehicleParams, initVehicleState, type CollisionOptions,
} from '../physics/index';
import {
  createConditionsSystem, createRaceControlSystem, createRaceDirector, createSnapshotHistory, createSnapshotSystem,
  initCarPitState, initCarRaceState, initConditions, initRaceState, lightsHoldFor, markerCountFor, raceRngSeed,
} from '../race/index';
import { ASSIST_PRESETS } from '../core/settings/defaults';
import { RACE_TRACK_INFO, isRaceTrackId } from '../data/tracks';
import { loadRaceTrack } from './tracks';
import { createEventQueue } from './sim/eventQueue';
import { rollingStart } from './sim/teleport';
import { deepAssign, hashState } from './sim/stateUtils';

/** The player is always car 0. */
export const PLAYER_CAR_ID = 0;
/** Rules §1: Time Trial flying start. */
export const TT_START_BEFORE_LINE_M = 200;
export const TT_START_KMH = 200;

/** "Perfect AI at d=100" profile used for autodrive (§3.7). */
export const PERFECT_PROFILE: AIDriverProfile = { pace: 1, consistency: 1, aggression: 0.5, wetSkill: 1, tyreMgmt: 1, startSkill: 1, defending: 0.5 };

export function defaultSessionConfig(patch: Partial<SessionConfig> = {}): SessionConfig {
  return {
    mode: 'race',
    laps: 3,
    aiCount: 19,
    difficulty: 70,
    tod: 'day',
    weather: 'dry',
    seed: 1,
    playerTeamId: DEFAULT_PLAYER_TEAM,
    playerDriverIdx: 0,
    gridPos: 10,
    startCompound: 'auto',
    flashbacks: 5,
    assists: { ...ASSIST_PRESETS.intermediate },
    autodrive: false,
    ghost: 'pb', // ui-hud §6 ttSetup default; races ignore it
    mandatoryStop: false,
    wearScale: 2,
    trackId: 'istanbul',
    safetyCar: true,
    ...patch,
  };
}

export function startCompoundFor(cfg: SessionConfig): Compound {
  if (cfg.startCompound !== 'auto') return cfg.startCompound;
  return cfg.weather === 'heavy' ? 'wet' : cfg.weather === 'light' ? 'inter' : 'medium';
}

export function neutralInput(brakeBias = 0.575): VehicleInput {
  return { throttle: 0, brake: 0, steer: 0, gearUp: false, gearDown: false, drsRequest: false, ersOvertake: false, pitLimiter: false, ersMode: 'medium', brakeBias };
}

export function neutralControls(brakeBias = 0.575, nextCompound: Compound = 'medium'): DriverControls {
  return {
    throttle: false, brake: false, left: false, right: false, gearUpPressed: false, gearDownPressed: false, drsPressed: false, ersOvertakeHeld: false, pitLimiterPressed: false,
    // CR-03 strategy values (persistent; set by the glue from the MFD in Sprint 2).
    ersModeSel: 'auto', brakeBias, boxRequest: false, nextCompound,
    // CR-14: settings.controls.steerSensitivity, latched by the glue every tick.
    steerSensitivity: 1,
    // Gamepad axes (latched by the glue; analog false = keyboard booleans drive).
    analog: false, steerAxis: 0, throttleAxis: 0, brakeAxis: 0,
  };
}

export function initAIState(rngSeed: number, compound: Compound): AIState {
  return {
    mode: 'race', laneOffset: 0, laneTarget: 0, targetCar: -1, rng: rngSeed, mistakeTimer: 0, mistakeKind: 0,
    integ: 0, plannedStopLaps: [], nextCompound: compound, overtakeTimer: 0, defendUsed: false, stuckTimer: 0, lastSteer: 0,
  };
}

export interface LineupEntry { team: TeamDef; driver: DriverDef; idx: 0 | 1; isPlayer: boolean }

/** Player first (car 0), then `aiCount` AI drivers picked by a seeded shuffle. */
export function buildLineup(cfg: SessionConfig): LineupEntry[] {
  const custom = customTeamById(cfg.playerTeamId);
  // Retain base ids: pit boxes, shared team queues and pit-stop performance use them.
  const team = custom ? { ...customTeamDef(custom), id: custom.baseTeamId } : teamById(cfg.playerTeamId) ?? TEAMS[0]!;
  const player: LineupEntry = { team, driver: team.drivers[cfg.playerDriverIdx], idx: cfg.playerDriverIdx, isPlayer: true };
  if (cfg.mode === 'timeTrial') return [player];
  const pool = ALL_DRIVERS.filter((e) => e.driver.id !== player.driver.id).map((e) => ({
    ...e, team: custom && e.team.id === custom.baseTeamId ? team : e.team, isPlayer: false,
  }));
  const rng = createRng(seedStream(cfg.seed, 3));
  for (let i = pool.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    const t = pool[i]!;
    pool[i] = pool[j]!;
    pool[j] = t;
  }
  const n = Math.max(0, Math.min(19, Math.round(cfg.aiCount)));
  return [player, ...pool.slice(0, n)];
}

/** Grid slot index per car: AI ordered by strength (+ seeded jitter), player inserted at gridPos. */
export function assignGrid(cfg: SessionConfig, lineup: readonly LineupEntry[]): number[] {
  const n = lineup.length;
  const rng = createRng(seedStream(cfg.seed, 4));
  const ai = lineup
    .map((e, i) => ({ i, k: e.team.perf * 2 + (e.driver.ai.pace - 1) + rng.range(-0.004, 0.004) }))
    .filter((x) => x.i !== PLAYER_CAR_ID)
    .sort((a, b) => b.k - a.k)
    .map((x) => x.i);
  const wanted = cfg.gridPos === 'random' ? rng.int(1, n) : Math.max(1, Math.min(n, Math.round(cfg.gridPos)));
  const order = [...ai];
  order.splice(wanted - 1, 0, PLAYER_CAR_ID);
  const slotOf = new Array<number>(n).fill(0);
  order.forEach((carId, slot) => {
    slotOf[carId] = slot;
  });
  return slotOf;
}

/** CR-NET-1: the explicit (online) lineup; 'player' only at index 0. */
function lineupFromEntries(entries: readonly SimLineupEntry[]): LineupEntry[] {
  return entries.map((e, i) => {
    const team = teamById(e.teamId);
    if (!team) throw new Error(`createSim: unknown teamId "${e.teamId}" in lineup[${i}]`);
    if (e.control === 'player' && i !== PLAYER_CAR_ID) throw new Error(`createSim: lineup[${i}] is 'player'; only car ${PLAYER_CAR_ID} may be`);
    return { team, driver: team.drivers[e.driverIdx], idx: e.driverIdx, isPlayer: e.control === 'player' };
  });
}

/** D-058: field-average team performance and traits (equal cars online). */
export const FIELD_PERF: number = TEAMS.reduce((a, t) => a + t.perf, 0) / TEAMS.length;
export const FIELD_TRAITS: TeamTraits = (() => {
  const keys = ['power', 'lowDrag', 'downforce', 'mechGrip', 'tyreCare', 'ers'] as const;
  const out: TeamTraits = { power: 0, lowDrag: 0, downforce: 0, mechGrip: 0, tyreCare: 0, ers: 0 };
  for (const t of TEAMS) for (const k of keys) out[k] += (t.traits?.[k] ?? 0) / TEAMS.length;
  return out;
})();

function fuelFor(cfg: SessionConfig): number {
  return cfg.mode === 'timeTrial' ? 10 : Math.min(105, cfg.laps * 1.75 + 1.5);
}

/** P3c (online only, game-internal): CollisionSystem options for local–remote contact (latency scale, response delay, episodes). */
export interface CreateSimOptionsExt extends CreateSimOptions { collision?: CollisionOptions }

export function createSim(cfg: SessionConfig, opts: CreateSimOptionsExt = {}): SimRunner {
  const track: TrackBundle = opts.track ?? loadRaceTrack(cfg.trackId);
  const q = track.query;
  const lineup = opts.lineup ? lineupFromEntries(opts.lineup) : buildLineup(cfg);
  const tt = cfg.mode === 'timeTrial';
  // D-058: equal cars (online): every car gets the field average of perf and traits.
  const equal = !tt && cfg.equalCars === true;
  const params = lineup.map((e) => (tt ? defaultVehicleParams(0, undefined) : equal ? defaultVehicleParams(FIELD_PERF, FIELD_TRAITS) : defaultVehicleParams(e.team.perf, e.team.traits)));
  // D-037: per-track aero trim on every car (omitted at 0 so İstanbul params stay byte-identical).
  const aeroTrim = isRaceTrackId(track.data.id) ? RACE_TRACK_INFO[track.data.id].aeroTrim : 0;
  if (aeroTrim !== 0) for (const p of params) p.aeroTrim = aeroTrim;
  const compound = startCompoundFor(cfg);
  const slots = opts.lineup ? opts.lineup.map((e) => e.gridSlot) : assignGrid(cfg, lineup);
  const markerCount = markerCountFor(q.length);
  const fuel = fuelFor(cfg);

  const rng = { race: raceRngSeed(cfg.seed), weather: seedStream(cfg.seed, 2) };
  // First race-RNG draw = the lights hold (CR-NET-6: lightsOutAtMsFor(seed) reproduces it).
  const lightsHoldMs = lightsHoldFor(nextRandom(rng, 'race'));

  const cars: SimCarState[] = lineup.map((e, i) => {
    const p = params[i]!;
    // Rules §1: Time Trial flying start at s = L − 200 m, 200 km/h (rollingStart below).
    const slot = tt ? { s: q.wrapS(-TT_START_BEFORE_LINE_M), d: 0 } : track.data.grid[slots[i]!] ?? { s: q.wrapS(-12 - 8 * slots[i]!), d: 0 };
    const vehicle = initVehicleState(p, track, slot, compound);
    vehicle.fuelKg = fuel;
    vehicle.massKg = p.massDryKg + fuel;
    return {
      id: i,
      driverId: e.driver.id,
      teamId: e.team.id,
      isPlayer: e.isPlayer,
      control: opts.lineup?.[i]!.control === 'remote' ? 'remote' : e.isPlayer && !cfg.autodrive ? 'player' : 'ai',
      input: neutralInput(p.brakeBiasDefault),
      controls: neutralControls(p.brakeBiasDefault, compound),
      kb: { steerU: 0, throttle: 0, brake: 0 },
      vehicle,
      ai: initAIState(seedStream(cfg.seed, 100 + i), compound),
      race: initCarRaceState(markerCount, compound, track.data.cutZones.length, track.data.drsZones.length),
      pit: initCarPitState(compound),
    };
  });

  const state: SimState = {
    tick: 0,
    time: 0,
    cars,
    race: initRaceState(cfg, cars.length, lightsHoldMs, opts.skipLights === true),
    conditions: initConditions(cfg, tt ? 3600 : cfg.laps * 95 * 1.3),
    rng,
  };
  if (state.race.phase === 'running' && !tt) {
    for (const c of cars) {
      c.race.lapStartMs = 0;
      c.race.sectorStartMs = 0;
    }
  }
  for (const c of cars) c.race.progress = c.vehicle.lapWraps * q.length + c.vehicle.s;

  const ai = createAIModule();
  ai.prepare(q, params);
  ai.setDifficulty(cfg.difficulty);
  ai.onWetnessChanged(state.conditions.wetness);

  const world: SimWorld = { static: { config: cfg, track, params, ai }, state, events: createEventQueue() };
  if (tt) for (const c of cars) rollingStart(world, c.id, TT_START_KMH);
  for (const c of cars) {
    if (c.control === 'ai') ai.initCar(world, c.id, c.isPlayer ? PERFECT_PROFILE : lineup[c.id]!.driver.ai);
  }

  const history = createSnapshotHistory(10, 15);
  history.prime(state);
  const systems: readonly SimSystem[] = [
    createConditionsSystem(),
    createPlayerInputSystem(),
    createAISystem(ai),
    // D-056: AI cars obey the safety-car speed caps; retired AI cars stop.
    createRaceControlSystem(),
    createVehicleSystem(),
    createCollisionSystem(opts.collision),
    createRaceDirector(),
    createSnapshotSystem(history),
  ];

  return {
    world,
    history,
    step() {
      // tick/time advance first, so every system (and any snapshot) sees the time this tick produces.
      state.tick++;
      state.time = state.tick * SIM_DT;
      for (let i = 0; i < systems.length; i++) systems[i]!.step(world, SIM_DT);
    },
    snapshot() {
      return { tick: state.tick, time: state.time, state: structuredClone(state) };
    },
    restore(s) {
      deepAssign(state, s.state);
      history.truncateAfter(s.tick);
    },
    hash() {
      return hashState(state);
    },
  };
}
