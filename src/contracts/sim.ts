// Contract: simulation world, systems, events and runner. Implemented by: Yönetici (src/game/createSim.ts); systems by their owners.

import type { AIModule, AIState } from './ai';
import type { ConditionsState } from './conditions';
import type { WheelIndex } from './common';
import type { CarPitState, CarRaceState, FlagType, PenaltyReason, PitPhase, RaceState, SafetyCarPhase, SectorStatus, SessionConfig } from './race';
import type { TrackBundle } from './track';
import type { DriverControls, KeyboardFilterState, VehicleInput, VehicleParams, VehicleState } from './vehicle';

// The two constants below are the only runtime values outside frames.ts (as specified in §4).
export const SIM_HZ = 240;
export const SIM_DT = 1 / 240;

export interface SimCarState {
  /** CR-NET-2: control 'remote' = online puppet (another client's car or a server AI car, D-043), posed by the glue; AI, vehicle and walls skip it. */
  id: number; driverId: string; teamId: string; isPlayer: boolean; control: 'player' | 'ai' | 'pitAuto' | 'remote';
  input: VehicleInput; controls: DriverControls;
  /** Deviation from §4 (addition): keyboard-filter memory, written only by the PlayerInputSystem. */
  kb: KeyboardFilterState;
  vehicle: VehicleState; ai: AIState; race: CarRaceState; pit: CarPitState;
}

export interface SimState { tick: number; time: number; cars: SimCarState[]; race: RaceState; conditions: ConditionsState; rng: { race: number; weather: number } }

export interface SimStatic { config: SessionConfig; track: TrackBundle; params: VehicleParams[]; ai: AIModule }

export interface SimWorld { static: SimStatic; state: SimState; events: SimEventQueue }

/** Systems hold no state of their own, only caches derived from world.static. */
export interface SimSystem { readonly name: string; step(world: SimWorld, dt: number): void }

export interface SimEventQueue {
  push(e: SimEvent): void; drain(cb: (e: SimEvent) => void): void;
  /**
   * D-056: synchronous push listener (the RaceDirector reads the CollisionSystem's `collision` events of the current tick
   * without draining). Optional for foreign queues.
   */
  listen?(cb: (e: SimEvent) => void): () => void;
}

export type SimEvent =
  | { type: 'lightsOn'; count: number } | { type: 'lightsOut' } | { type: 'jumpStart'; car: number }
  | { type: 'sector'; car: number; sector: 0 | 1 | 2; ms: number; status: SectorStatus } | { type: 'lap'; car: number; lap: number; ms: number; valid: boolean }
  | { type: 'fastestLap'; car: number; ms: number } | { type: 'position'; car: number; from: number; to: number }
  | { type: 'trackLimits'; car: number; count: number } | { type: 'penalty'; car: number; seconds: number; reason: PenaltyReason }
  | { type: 'drsEnabled' } | { type: 'drsDisabled' } | { type: 'drsAvailable'; car: number; zone: number }
  | { type: 'pit'; car: number; phase: PitPhase }
  | { type: 'collision'; a: number; /** -1 = wall */ b: number; impulse: number; x: number; y: number; z: number;
    /** CR-NET-8: unit contact normal in the ground plane, from a to b (optional until the CollisionSystem fills it). */
    nx?: number; nz?: number }
  | { type: 'gear'; car: number; gear: number } | { type: 'kerb'; car: number; wheel: WheelIndex; sausage: boolean }
  | { type: 'flag'; flag: FlagType; sector: number; car: number } | { type: 'finish'; car: number; position: number }
  | { type: 'weather'; rain: number; msg: 'rainSoon' | 'rainStarted' | 'drying' | 'intersNow' | 'slicksNow' | 'wetsNow' | 'none' } | { type: 'carReset'; car: number }
  // CR-06
  | { type: 'lapInvalidated'; car: number; reason: 'trackLimits' | 'cornerCut' | 'flashback' | 'reset' | 'wrongWay' }
  | { type: 'penaltyServed'; car: number; seconds: number }
  | { type: 'retired'; car: number }
  // D-056
  | { type: 'collisionWarning'; car: number; other: number }
  | { type: 'safetyCar'; phase: SafetyCarPhase }
  // D-040: wrong-way warning on / off (RaceDirector)
  | { type: 'wrongWay'; car: number; on: boolean };

/** structuredClone of state. */
export interface SimSnapshot { tick: number; time: number; state: SimState }

/**
 * Deviation from §4 (addition): the SnapshotSystem's 10 Hz × 15 s ring buffer, exposed for flashback.
 * Entries are owned by the ring (reused in place); restore one before stepping further.
 */
export interface SnapshotHistory {
  readonly hz: number;
  readonly capacity: number;
  count(): number;
  /** Oldest / newest stored sim time in s (NaN when empty). */
  oldestTime(): number;
  newestTime(): number;
  /** Newest snapshot with time ≤ t, or null. */
  at(t: number): SimSnapshot | null;
  /** Drops every snapshot newer than `tick` (called by SimRunner.restore). */
  truncateAfter(tick: number): void;
  clear(): void;
}

export interface SimRunner {
  world: SimWorld;
  step(): void;
  snapshot(): SimSnapshot;
  /** Deep-assigns into the live objects (identity of every nested object is preserved). */
  restore(s: SimSnapshot): void;
  /** FNV-1a over a canonical numeric walk of the state; stable across runs. */
  hash(): string;
  /** Deviation from §4 (addition), see SnapshotHistory. */
  history: SnapshotHistory;
}

/**
 * CR-NET-1 (online grid, D-043): one entry per car, in car-id order. 'player' = the local human (must be index 0, at most one;
 * `cfg.autodrive` turns it into AI with isPlayer kept). 'remote' = puppet. 'ai' = simulated locally (the server's AI cars).
 * `human` marks real players (false = AI car, wherever it is simulated).
 */
export interface SimLineupEntry { teamId: string; driverIdx: 0 | 1; gridSlot: number; control: 'player' | 'ai' | 'remote'; human: boolean }

/** Deviation from §4 (addition): `skipLights` starts the race in the `running` phase. CR-NET-1: `lineup` replaces buildLineup/assignGrid. */
export interface CreateSimOptions { track?: TrackBundle; skipLights?: boolean; lineup?: readonly SimLineupEntry[] }
