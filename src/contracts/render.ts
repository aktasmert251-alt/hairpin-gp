// Contract: render frame, quality presets and presentation systems. Implemented by: Grafik (src/graphics/**); AssetLoader by Yönetici (src/core/assets).

import type { Camera, Object3D, PMREMGenerator, PerspectiveCamera, Scene, Texture, WebGLRenderer } from 'three';
import type { CameraId, Compound, QualityId, Quad, SurfaceType, Unsubscribe } from './common';
import type { ConditionsFrame } from './conditions';
import type { HudModel } from './hud';
import type { SpeedProfile, RacingLine } from './ai';
import type { LightingRig } from './environment';
import type { SimEvent } from './sim';
import type { TrackQuery } from './track';

export interface CarRenderState {
  id: number; visible: boolean; isPlayer: boolean; isGhost: boolean; ghostAlpha: number;
  px: number; py: number; pz: number; fx: number; fy: number; fz: number; ux: number; uy: number; uz: number;
  speed: number; steerAngle: number; wheelSpin: Quad<number>; susp: Quad<number>; rpm: number; gear: number; throttle: number; brake: number;
  drsFlap: number; brakeGlow: Quad<number>;
  /** 0 off, 1 on, 2 flash */
  rainLight: 0 | 1 | 2;
  compound: Compound; slip: Quad<number>; wheelSurface: Quad<SurfaceType>;
  sparks: number; inPitBox: boolean; teamId: string; number: number; tcam: 'black' | 'yellow';
  /** CR-04: MGU-K power in kW, + deploy / − harvest (audio whine). */
  ersKw: number;
  /** CR-04: pit limiter engaged (limiter beeps). */
  pitLimiter: boolean;
}

/** CR-02: every view the camera system can show (the 5 driving cams plus TV, orbit, free and trailer). */
export type ViewId = CameraId | 'tv' | 'orbit' | 'free' | 'trailer';

/** CR-02: explicit camera pose (trailer / free cam override). `t*` = look-at target. */
export interface CameraPose { px: number; py: number; pz: number; tx: number; ty: number; tz: number; fov: number; roll: number }

export interface RenderFrame {
  time: number; frameDt: number; alpha: number; cars: CarRenderState[]; playerId: number; conditions: ConditionsFrame;
  lights: { lit: number; out: boolean }; yellowSectors: [boolean, boolean, boolean]; paused: boolean;
  racingLine: { mode: 'off' | 'corners' | 'full'; profile: SpeedProfile | null; playerS: number; playerSpeed: number };
  /** CR-02: active view, filled by the glue after cameraRig.update (lens droplets, audio interior/exterior). */
  view: ViewId;
  /** CR-02: look-back held. */
  lookBack: boolean;
}

export interface QualityPreset {
  id: QualityId; renderScale: number; aa: 'fxaa' | 'smaa'; smaa: 'MEDIUM' | 'HIGH' | 'ULTRA'; shadowSize: 1024 | 2048 | 4096;
  shadowExtent: number; shadowRadius: number; ao: 'off' | 'half' | 'full'; bloom: boolean; lut: boolean; lens: 'droplets' | 'dropletsCA' | 'all';
  envSize: 128 | 256 | 512; anisotropy: number; carLod: [number, number, number]; mirrors: 'static' | 'low30' | 'high60';
  treeDensity: number; crowdDensity: number; grassCards: number; rainStreaks: number; sprayPerCar: number; smokeMax: number; skidQuads: number; far: number;
}

export interface RenderContext { renderer: WebGLRenderer; scene: Scene; camera: PerspectiveCamera; pmrem: PMREMGenerator; quality: QualityPreset; width: number; height: number; pixelRatio: number }

export interface RendererPerf { calls: number; triangles: number; geometries: number; textures: number; programs: number }

export interface GraphicsSystem {
  init(canvas: HTMLCanvasElement, q: QualityPreset): Promise<RenderContext>;
  setQuality(q: QualityPreset): void;
  setLighting(rig: LightingRig, envScene: Scene): void;
  render(frame: RenderFrame): void;
  resize(): void;
  getPerf(): RendererPerf;
  dispose(): void;
  /** CR-09 / D-021: post chain on/off (`?nopost=1`, post scene A/B). */
  setPostEnabled(on: boolean): void;
  /** D-021: collision kick for the CA pass; `impulse` = SimEvent collision impulse (N·s) involving the player. */
  onCollision(impulse: number): void;
  /**
   * Addition (Grafik-3B G2 finding, optional): compileAsync against the post chain's input target so the programs match
   * the ones the first frame uses (a plain compileAsync compiles sRGB-output variants). Glue prefers it over AssetLoader.warmup.
   */
  warmup?(scene: Object3D, camera: Camera): Promise<void>;
}

export interface CarVisualSpec { id: number; teamId: string; number: number; tcam: 'black' | 'yellow'; isGhost: boolean }

export interface CarVisualsSystem {
  init(ctx: RenderContext, cars: CarVisualSpec[]): Promise<void>;
  update(frame: RenderFrame, cam: PerspectiveCamera): void;
  setCockpitCar(id: number | null): void;
  dispose(): void;
  /** D-019: rebuild per-preset pools/materials; the glue calls it on `quality:changed`. */
  setQuality(q: QualityPreset): void;
  /** CR-16: steering-wheel display model; glue calls it at 30 Hz in `cockpit`, null otherwise. */
  setWheelDisplay(m: HudModel | null): void;
}

export interface ListenerPose { px: number; py: number; pz: number; fx: number; fy: number; fz: number; ux: number; uy: number; uz: number; vx: number; vy: number; vz: number; camera: CameraId }

export interface CameraRig {
  readonly camera: PerspectiveCamera;
  setMode(id: CameraId): void; mode(): CameraId; next(): CameraId; setLookBack(on: boolean): void;
  setFovOffset(deg: number): void; update(frame: RenderFrame, dt: number): void; getListener(out: ListenerPose): ListenerPose;
  /**
   * CR-02: select any view,
   * including 'tv' | 'orbit' | 'free' | 'trailer'; setMode(id) stays the driving-camera shortcut.
   */
  setView(id: ViewId): void;
  view(): ViewId;
  /** CR-02: pose override for trailer / free cam; null returns control to the active view. */
  setOverride(p: CameraPose | null): void;
  /** D-020: kerb / collision shake; the glue forwards every sim event. */
  onSimEvent(e: SimEvent): void;
  /** D-020: settings.graphics.cameraShake (0..1). */
  setShake(k: number): void;
  /** D-020: speed FOV + shake; false under reduced motion / settings.graphics.motionEffects off. */
  setMotionEffects(on: boolean): void;
  /** D-020: TV spots come from the track (null = spots generated ahead of the car). */
  setTrack(q: TrackQuery | null): void;
}

export interface VfxSystem {
  init(ctx: RenderContext): void; update(frame: RenderFrame, cam: PerspectiveCamera, dt: number): void; onSimEvent(e: SimEvent): void; dispose(): void;
  /** D-019: pools rebuilt per preset. */
  setQuality(q: QualityPreset): void;
  /** D-019: drop every live particle / skid mark (flashback apply). */
  clear(): void;
}

/** CR-15: main-menu 3D backdrop (turntable car) driven by the team tiles (`ui:focusTeam`). Implemented by Grafik-3B. */
export interface Showroom {
  init(ctx: RenderContext): Promise<void>;
  setTeam(teamId: string): void;
  render(dtS: number): void;
  resize(): void;
  dispose(): void;
}

export interface RacingLineVisual { init(ctx: RenderContext, line: RacingLine): void; update(frame: RenderFrame): void; dispose(): void }

// ---------------------------------------------------------------------------------------------
// Addition (Sprint 0 brief): AssetLoader, implemented by Yönetici in src/core/assets/AssetLoader.ts.

export interface TextureOptions {
  /** true for colour (albedo/emissive) maps; false for data maps (normal/roughness). Default true. */
  srgb?: boolean;
  /** RepeatWrapping on both axes. Default false. */
  repeat?: boolean;
  /** Clamped to the renderer's maximum. Default 1. */
  anisotropy?: number;
  /** Default true (three's default for image textures). */
  flipY?: boolean;
}

export interface AssetProgress { loaded: number; total: number; progress: number }

export interface AssetLoader {
  /** Loads (or reuses) a texture; every call adds one reference. Textures are keyed by url + options. */
  texture(url: string, opts?: TextureOptions): Promise<Texture>;
  /** Drops one reference; the texture is disposed when its count reaches 0. */
  release(tex: Texture): void;
  refCount(url: string, opts?: TextureOptions): number;
  /**
   * Waits for a web font via document.fonts.load(spec, text). `text` selects the unicode-range subsets to fetch
   * (e.g. 'İŞĞÇÖÜışğçöü0123'). Resolves false on timeout or when fonts are unavailable.
   */
  font(family: string, opts?: { weight?: string | number; style?: string; text?: string; timeoutMs?: number }): Promise<boolean>;
  /** Adds arbitrary work to the progress total. */
  track<T>(work: Promise<T>, weight?: number): Promise<T>;
  progress(): AssetProgress;
  onProgress(cb: (p: AssetProgress) => void): Unsubscribe;
  resetProgress(): void;
  /** renderer.compileAsync(scene, camera) at the end of loading, to avoid first-frame hitches. */
  warmup(renderer: WebGLRenderer, scene: Object3D, camera: Camera): Promise<void>;
  /** Disposes every cached texture regardless of counts. */
  dispose(): void;
}
