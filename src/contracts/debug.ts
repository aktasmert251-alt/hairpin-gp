// Contract: test hooks (window.__APEX__), sandbox scenes, launch params, perf stats. Implemented by: Yönetici (src/core/debug, src/sandbox, src/core/launchParams.ts).

import type { Compound, Lang, QualityId, TimeOfDay, Vec3, WeatherPreset } from './common';
import type { AppStateId } from './events';
import type { HudModel } from './hud';
import type { ActionId } from './input';
import type { NetStats } from './net';
import type { CarRaceState, RacePhase, RaceState, SessionConfig } from './race';
import type { RendererPerf, ViewId } from './render';
import type { RaceTrackId } from './track';
import type { ScreenId } from './ui';
import type { DriverControls, VehicleInput, VehicleState } from './vehicle';

export interface SandboxScene {
  id: string; title: string;
  create(ctx: { canvas: HTMLCanvasElement; uiRoot: HTMLElement; params: URLSearchParams }): Promise<{ update(dt: number): void; dispose(): void }>;
}

/** URL parameters (§3.7), parsed once at boot. `null` = not given (use settings / defaults). */
export interface LaunchParams {
  scene: string | null;
  mode: 'menu' | 'tt' | 'race';
  autostart: boolean;
  autodrive: boolean;
  weather: WeatherPreset | null;
  tod: TimeOfDay | null;
  laps: number | null;
  ai: number | null;
  difficulty: number | null;
  quality: QualityId | null;
  seed: number | null;
  /** CR-02: any ViewId. */
  cam: ViewId | null;
  lang: Lang | null;
  team: string | null;
  tyre: Compound | null;
  grid: number | null;
  skipLights: boolean;
  timescale: number;
  freeze: boolean;
  mute: boolean;
  debug: boolean;
  nopost: boolean;
  /** Start position along the track in m (teleport). */
  s: number | null;
  /** Sandbox: sim time in s to fast-forward to. */
  t: number | null;
  /** Visibility auto-pause override; null = on unless navigator.webdriver. */
  autopause: boolean | null;
  /** CR-18: `?record=1` records a replay of the session (ApexDebugApi.lastReplay). */
  record: boolean;
  /** CR-TRK-4: `?track=lombardia`; invalid → null + console warning. */
  track: RaceTrackId | null;
  /** CR-NET-4: `?server=wss://host/ws` (ws:// or wss:// only; else null + warning). */
  server: string | null;
  /** CR-NET-4: `?room=ABCDE` (5-character room code; else null). */
  room: string | null;
  /** CR-NET-4: `?name=` nickname (validated by the protocol name rule; else null). */
  name: string | null;
}

/** Addition (Sprint 0 brief). Frame stats over the window since the last resetPerf(). */
export interface PerfStats {
  frames: number;
  seconds: number;
  fps: number;
  frameMsAvg: number;
  frameMsP95: number;
  frameMsMax: number;
  ticks: number;
  /** Frames that hit the 12-tick cap (accumulator dropped). */
  simOverrun: number;
  renderer: RendererPerf;
  /** CR-07: frames longer than 50 ms in the window. */
  hitches: number;
  /** CR-07: JS heap in MB (performance.memory), 0 when unavailable. */
  heapMB: number;
}

export interface Telemetry {
  car: number; tick: number; time: number; kmh: number;
  vehicle: VehicleState; input: VehicleInput; controls: DriverControls; race: CarRaceState;
}

export interface RaceInfo {
  phase: RacePhase; raceMs: number; laps: number; mode: SessionConfig['mode'];
  race: RaceState;
  cars: { id: number; driverId: string; teamId: string; isPlayer: boolean; position: number; lapsCompleted: number; progress: number; lastLapMs: number; bestLapMs: number; finished: boolean; status: CarRaceState['status'] }[];
}

/** window.__APEX__: always present, in production builds too (§3.8). */
export interface ApexDebugApi {
  // State and lifecycle
  ready: boolean;
  /** True after the first rendered frame of the current view (sandbox scene, menu screen or session). */
  sceneReady: boolean;
  whenReady(what?: 'ready' | 'sceneReady'): Promise<void>;
  state(): AppStateId;
  readonly launch: LaunchParams;
  // Session control
  startSession(cfg?: Partial<SessionConfig> & { skipLights?: boolean }): Promise<void>;
  pause(): void;
  resume(): void;
  step(ticks: number): void;
  setTimeScale(s: number): void;
  // Teleport and camera
  teleport(car: number, s: number, d: number, kmh: number): void;
  /** CR-02: accepts any ViewId (the stub rig maps non-driving views to chaseFar). */
  setCamera(id: ViewId): void;
  freeCam(pos: Vec3, look: Vec3): void;
  // Conditions and quality
  setConditions(c: Partial<{ tod: TimeOfDay; weather: WeatherPreset; rain: number; wetness: number }>): void;
  setQuality(id: QualityId): void;
  setAutodrive(on: boolean): void;
  // Synthetic input
  input: { press(action: ActionId, ms?: number): void; release(action: ActionId): void };
  // Inspection
  getTelemetry(car?: number): Telemetry | null;
  getRace(): RaceInfo | null;
  getPerf(): PerfStats;
  resetPerf(): void;
  hashState(): string | null;
  /** CR-07: the HUD model of the running session (null outside a session). */
  getHud(): HudModel | null;
  /** CR-07 / CR-17: active UI screen and the focused element's `data-focus-id`. */
  ui: { screen(): ScreenId | null; focusId(): string | null };
  /** CR-07: audio state (voices = active AI engine voices). */
  audio(): { unlocked: boolean; voices: number };
  /** CR-18: the last recorded replay, encoded (CR-01 encodeReplay); null when nothing was recorded. */
  lastReplay(): ArrayBuffer | null;
  /** B-6: the main track's id, length and a world position for (s, d), so harnesses need no /src import (preview builds). */
  track(): { id: string; length: number; worldFromSD(s: number, d: number): Vec3 } | null;
  /** CR-NET-4: network stats of the online session (null offline). */
  net(): NetStats | null;
  // Diagnostics
  errors: string[];
  /** UNMASKED_RENDERER_WEBGL string ('' until probed, 'unavailable' without WebGL2). */
  gpu: string;
}
