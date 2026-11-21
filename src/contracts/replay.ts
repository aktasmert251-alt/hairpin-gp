// Contract: replay recording and playback (CR-01). Implemented by: Yönetici (src/game/replay/**); consumed by Sürüş
// (renderReplayAudio, CR-08) and the Sprint 5b trailer. Factories exported from src/game/index.ts:
// createReplayRecorder(), createReplayPlayer(d), encodeReplay(d), decodeReplay(b).

import type { ConditionsFrame } from './conditions';
import type { RacePhase, SessionConfig } from './race';
import type { CarRenderState, RenderFrame } from './render';
import type { SimEvent, SimWorld } from './sim';
import type { TrackId } from './track';

// Runtime constants (CR-01), like SIM_HZ in sim.ts.
export const REPLAY_HZ = 60;
/**
 * Floats per car per frame. Layout:
 * `px py pz fx fy fz ux uy uz speed steerAngle | wheelSpin×4 | susp×4 | rpm gear throttle brake drsFlap | brakeGlow×4 |
 *  rainLight compoundIdx | slip×4 | surfaceIdx×4 | sparks inPitBox ersKw position lapsCompleted visible` (= 44).
 */
export const REPLAY_CAR_STRIDE = 44;

export interface ReplayCarMeta { id: number; driverId: string; teamId: string; number: number; tcam: 'black' | 'yellow'; isPlayer: boolean }

export interface ReplayData {
  version: 1; buildHash: string; trackId: TrackId; config: SessionConfig; hz: 60;
  startTime: number; frameCount: number; meta: ReplayCarMeta[];
  /** frame-major: ((frame * meta.length) + car) * REPLAY_CAR_STRIDE */
  cars: Float32Array;
  /** frameCount × 8: raceMs, phaseIndex, lightsLit, lightsOut(0/1), rain, wetness, lineWetness, cloud */
  global: Float32Array;
  events: { t: number; e: SimEvent }[];
}

export interface ReplayFrame {
  t: number; raceMs: number; phase: RacePhase; lights: { lit: number; out: boolean };
  conditions: ConditionsFrame; cars: CarRenderState[]; order: number[]; laps: number[];
}

export interface ReplayRecorder { begin(world: SimWorld): void; sample(world: SimWorld): void; end(): ReplayData }

export interface ReplayPlayer {
  readonly data: ReplayData; duration(): number;
  /** Interpolated, allocation-free. */
  frameAt(t: number, out: ReplayFrame): ReplayFrame;
  toRenderFrame(f: ReplayFrame, playerId: number, out: RenderFrame): RenderFrame;
  eventsIn(t0: number, t1: number, cb: (t: number, e: SimEvent) => void): void;
}
