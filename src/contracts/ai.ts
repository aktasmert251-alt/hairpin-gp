// Contract: AI racing line, speed profiles and driver module. Implemented by: Sürüş (src/ai/**).

import type { Compound } from './common';
import type { SimWorld } from './sim';
import type { TrackQuery } from './track';
import type { VehicleInput, VehicleParams } from './vehicle';

export interface RacingLine { count: number; ds: number; s: Float32Array; d: Float32Array; x: Float32Array; y: Float32Array; z: Float32Array; curvature: Float32Array }

export interface SpeedProfile {
  line: RacingLine; v: Float32Array; accel: Float32Array;
  /** 0 throttle, 1 lift, 2 brake */
  zone: Uint8Array;
  gripScale: number; wetness: number;
}

export interface AIDriverProfile { pace: number; consistency: number; aggression: number; wetSkill: number; tyreMgmt: number; startSkill: number; defending: number }

export type AIMode = 'start' | 'race' | 'overtake' | 'defend' | 'yield' | 'recover' | 'pit' | 'cooldown' | 'perfect';

export interface AIState {
  mode: AIMode; laneOffset: number; laneTarget: number; targetCar: number; rng: number; mistakeTimer: number; mistakeKind: number;
  integ: number; plannedStopLaps: number[]; nextCompound: Compound; overtakeTimer: number; defendUsed: boolean; stuckTimer: number; lastSteer: number;
}

export interface AIModule {
  /** Base line + per-car profiles (≤ 300 ms total). */
  prepare(track: TrackQuery, params: VehicleParams[]): void;
  getRacingLine(): RacingLine;
  getProfile(carId: number): SpeedProfile;
  setDifficulty(d: number): void;
  /** Rebuild profiles when |Δw| > 0.05 (spread over ticks). */
  onWetnessChanged(w: number): void;
  initCar(world: SimWorld, carId: number, profile: AIDriverProfile): void;
  computeInput(world: SimWorld, carId: number, out: VehicleInput): void;
}
