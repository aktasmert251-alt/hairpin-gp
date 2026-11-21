// Contract: session config, race and pit state. Implemented by: Yönetici (src/race/**, src/game/**).

import type { Compound, TimeOfDay, WeatherPreset } from './common';
import type { RaceTrackId } from './track';

export type SessionMode = 'timeTrial' | 'race';
export type RacePhase = 'grid' | 'lights' | 'running' | 'finishing' | 'finished';
export type SectorStatus = 'none' | 'yellow' | 'green' | 'purple';
export type FlagType = 'green' | 'yellow' | 'blue' | 'chequered' | 'blackWhite';
/** D-056: 'collision' = causing a collision, 'safetyCar' = overtaking under the safety car. */
export type PenaltyReason = 'jumpStart' | 'trackLimits' | 'cornerCut' | 'pitSpeeding' | 'twoCompound' | 'collision' | 'safetyCar';
export type PitPhase = 'none' | 'requested' | 'entry' | 'limiter' | 'boxIn' | 'stationary' | 'release' | 'boxOut' | 'exit';

export interface AssistSettings {
  steering: boolean; braking: 'off' | 'low' | 'medium' | 'high'; abs: boolean; tc: 'off' | 'medium' | 'full';
  gearbox: 'auto' | 'manual'; racingLine: 'off' | 'corners' | 'full'; pit: boolean; ers: boolean; drs: boolean; kbBrakeLimiter: boolean;
}

export interface SessionConfig {
  mode: SessionMode; laps: number; aiCount: number; difficulty: number; tod: TimeOfDay; weather: WeatherPreset; seed: number;
  playerTeamId: string; playerDriverIdx: 0 | 1; gridPos: number | 'random'; startCompound: Compound | 'auto';
  /** -1 = unlimited */
  flashbacks: number;
  assists: AssistSettings; autodrive: boolean; ghost: 'off' | 'pb' | 'rival'; mandatoryStop: boolean; wearScale: number;
  /** CR-TRK-3: the session's track; defaultSessionConfig gives 'istanbul'. */
  trackId: RaceTrackId;
  /** D-056: safety car on (default; absent = on). Races only. */
  safetyCar?: boolean;
  /** D-061: 'kasap' = no penalties or warnings of any kind and no safety car (online race mode). Absent = 'normal'. */
  rules?: 'normal' | 'kasap';
  /** D-058: every car gets the field-average performance (team perf + traits); online races. Absent = team differences. */
  equalCars?: boolean;
}

export interface CarRaceState {
  lapsCompleted: number; sector: 0 | 1 | 2; position: number; progress: number;
  lapStartMs: number; sectorStartMs: number; curSectors: [number, number, number]; lastLapMs: number; bestLapMs: number; bestSectors: [number, number, number];
  sectorStatus: [SectorStatus, SectorStatus, SectorStatus]; lapValid: boolean; trackLimitCount: number; penaltySec: number; penaltyToServeSec: number;
  gapToLeaderMs: number; intervalMs: number; lapsDown: number; drsEligible: boolean; drsZone: number; finished: boolean; finishMs: number;
  status: 'running' | 'finished' | 'dnf' | 'dsq'; compoundsUsedMask: number; pitStops: number; speedTrapKmh: number;
  /** Race clock (ms) at which each 10 m marker was last passed; length = ceil(track length / 10). */
  markerTimes: Float32Array;
  /**
   * D-056 safety car: speed cap for this car in m/s while the SC is out (queue behind the car ahead / the SC), −1 = no cap.
   * Written by the RaceDirector every tick; the AI reads it (and the SafetyCarSystem enforces it for AI-driven cars).
   */
  scTargetSpeed: number;
  /** D-056: collision warnings received (the first at-fault hard contact is a warning, later ones cost time). */
  collisionWarnings: number;
}

export interface CarPitState { phase: PitPhase; requested: boolean; nextCompound: Compound; boxSp: number; timer: number; serviceS: number; speeding: boolean }

export interface RaceState {
  phase: RacePhase; lightsLit: number; lightsOutAtMs: number; raceMs: number; leaderLap: number; drsEnabled: boolean;
  fastest: { car: number; ms: number }; sessionBestSectors: [number, number, number]; yellow: [boolean, boolean, boolean]; order: number[];
  flashbacksLeft: number; finishCountdownMs: number;
  /** D-056 safety car (phase 'none' when off or disabled). */
  sc: SafetyCarState;
}

/** D-056: 'deployed' = SC out, cars queue, no overtaking; 'ending' = SC comes in this lap, restart when the leader crosses the line. */
export type SafetyCarPhase = 'none' | 'deployed' | 'ending';

export interface SafetyCarState {
  phase: SafetyCarPhase;
  /** Race clock (ms) of the deployment (−1 = never). */
  sinceMs: number;
  /** SC car position as progress (m, same scale as CarRaceState.progress) and speed (m/s) while it is on track. */
  progress: number;
  speed: number;
  /** True while the SC car is on track (false once it peeled into the pit lane in the 'ending' lap). */
  onTrack: boolean;
  /** Leader line crossings since the deployment. */
  laps: number;
  /** Deployments this race. */
  count: number;
}
