// Contract: factory signatures each owner must export from src/<module>/index.ts. Checked at compile time by src/game/modules.check.ts.

import type { AIModule } from './ai';
import type { AudioSettings, AudioSystem } from './audio';
import type { Compound, QualityId, WeatherPreset } from './common';
import type { ConditionsState, ForecastEntry, WeatherKeyframe } from './conditions';
import type { BuildEnvironment } from './environment';
import type { SessionConfig } from './race';
import type { CameraRig, CarVisualsSystem, GraphicsSystem, ListenerPose, QualityPreset, RacingLineVisual, RenderContext, Showroom, VfxSystem } from './render';
import type { TeamTraits } from './data';
import type { ReplayData } from './replay';
import type { CreateSimOptions, SimRunner, SimSystem } from './sim';
import type { TrackBundle, TrackId } from './track';
import type { UiSystem } from './ui';
import type { VehicleParams, VehicleState } from './vehicle';

/**
 * Addition (stub policy, docs/ARCHITECTURE.md §7): every owner module exports MODULE_STATUS:
 * 'stub' while the Sprint 0 stub is in place, 'real' once its acceptance tests pass (track: 'istanbul-v1').
 */
export interface ModuleStatusExport { readonly MODULE_STATUS: string }

/** src/track (Çevre). `loadTrack` is sync (imports baked JSON). */
export interface TrackModule extends ModuleStatusExport {
  /** CR-TRK-2: default 'istanbul'; sync; cached per id; 'oval' → createOvalTrack(). */
  loadTrack(id?: TrackId): TrackBundle;
  /** Addition: flat straight test track for physics benches (s wraps modulo length). */
  createStraightTrack(lengthM: number): TrackBundle;
  buildEnvironment: BuildEnvironment;
}

/** src/physics (Sürüş). */
export interface PhysicsModule extends ModuleStatusExport {
  createPlayerInputSystem(): SimSystem;
  createVehicleSystem(): SimSystem;
  createCollisionSystem(): SimSystem;
  defaultVehicleParams(teamPerf: number, traits?: TeamTraits): VehicleParams;
  initVehicleState(p: VehicleParams, t: TrackBundle, slot: { s: number; d: number }, c: Compound): VehicleState;
  /**
   * CR-NET-8 (P3c, optional until Sürüş lands it): glue writer for a relayed online contact. Applies impulse `j` (N·s) along the
   * unit normal (nx, nz) at world point (px, pz) to the local car `v`, before the next tick. Allocation-free.
   */
  applyContactImpulse?(v: VehicleState, p: VehicleParams, j: number, nx: number, nz: number, px: number, pz: number): void;
}

/** src/ai (Sürüş). */
export interface AiModuleExports extends ModuleStatusExport {
  createAIModule(): AIModule;
  createAISystem(ai: AIModule): SimSystem;
}

/** src/race (Yönetici). */
export interface RaceModule {
  createRaceDirector(): SimSystem;
  createConditionsSystem(): SimSystem;
  generateWeatherTimeline(p: WeatherPreset, seed: number, durationS: number): WeatherKeyframe[];
  /**
   * CR-10: pure forecast (pit-weather §5) used by the HudPresenter and the AI strategy so both see identical values.
   * Fills the pre-allocated `out` entries and returns how many were written.
   */
  forecast(c: ConditionsState, seed: number, nowS: number, out: ForecastEntry[]): number;
}

/** src/game (Yönetici): canonical world factory, used by the game AND tests. */
export interface GameModule {
  createSim(cfg: SessionConfig, opts?: CreateSimOptions): SimRunner;
}

/** src/graphics (Grafik). */
export interface GraphicsModule extends ModuleStatusExport {
  createGraphicsSystem(): GraphicsSystem;
  createCarVisuals(): CarVisualsSystem;
  createCameraRig(ctx: RenderContext): CameraRig;
  createVfx(): VfxSystem;
  createRacingLineVisual(): RacingLineVisual;
  QUALITY_PRESETS: Readonly<Record<QualityId, QualityPreset>>;
  /** CR-15: main-menu showroom. */
  createShowroom(): Showroom;
}

/** src/ui (Grafik-UI). */
export interface UiModule extends ModuleStatusExport { createUi(): UiSystem }

/** CR-08: offline replay render options (audio.md §9). */
export interface ReplayAudioOptions {
  from: number; to: number; sampleRate: number;
  listener(t: number, out: ListenerPose): ListenerPose;
  volumes: AudioSettings;
}

/** src/audio (Sürüş). */
export interface AudioModule extends ModuleStatusExport {
  /** CR-08: `context` = an OfflineAudioContext for offline renders (default: a realtime AudioContext on unlock). */
  createAudioSystem(opts?: { context?: BaseAudioContext }): AudioSystem;
  /** CR-08: render a replay's audio offline. */
  renderReplayAudio(replay: ReplayData, o: ReplayAudioOptions): Promise<AudioBuffer>;
}
