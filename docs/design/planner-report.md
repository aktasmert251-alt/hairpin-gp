# APEX GP: Planner technical report (Sprint 0 input)

> Source: Planner agent, 2026-10-04. This file holds the PRESERVED part of the report:
> the end of §2 (sandbox scenes), §3 core architecture, §4 contracts appendix, §5 physics spec,
> §6 AI spec and §7 track and environment spec (including the embedded fallback geometry).
> §0 (OSM/DEM facts), §1 (stack), the start of §2 (directory tree) and §8–§16 were lost when the report was cut off.
> Those topics are covered by `docs/sprints/PLAN.md` (the approved plan, sections "Teknik kararlar" and Ek A–E)
> and by the design docs the Planner writes in Sprint 0.
> Where this report and PLAN.md disagree, **PLAN.md wins**. Pinned package versions are in PLAN.md.

---

## 2. (end) Sandbox scenes, registries and credits

**No shared registry files: discovery is automatic.**
- Sandbox scenes are found by `import.meta.glob('/src/**/sandbox/*.scene.ts')` in `src/sandbox/router.ts`.
- i18n namespaces are found by `import.meta.glob('/src/**/i18n/*.{tr,en}.ts')` in `src/core/i18n`.
- Credits fragments live in `public/assets/<role>/CREDITS.part.md`. YÖN merges them into `CREDITS.md` in Sprint 5.

**Sandbox scenes.** Each one exports `default: SandboxScene` (contract in §4).

| URL | Owner | Content |
|---|---|---|
| `?scene=skeleton` | YÖN | Walking skeleton: placeholder track and a kinematic box car |
| `?scene=race-logic` | YÖN | Headless RaceDirector shown as dots on a 2D map, with a timing table |
| `?scene=track` | ÇEV | Full environment. Orbit, free-fly and drive-along cameras. GUI for TOD and wetness |
| `?scene=track-data` | ÇEV | 2D plot of TrackData: edges, kerbs, walls, sectors, DRS, pit, grid |
| `?scene=car` | GRA | Showroom, livery and LOD browser, a 20-car grid |
| `?scene=vfx` · `?scene=post` | GRA | Particles, rain and spray; post chain and preset A/B |
| `?scene=hud` · `?scene=menu` | GRA | HUD driven by an animated mock HudModel; all menu screens with mock stores |
| `?scene=physics` | SÜR | One drivable car with telemetry plots and lil-gui parameters |
| `?scene=ai` | SÜR | 20 AI box cars, racing line and speed profile overlay |
| `?scene=audio` | SÜR | Engine synth bench and event triggers |

Sandbox URL extras:
- `&t=<sec>` sets time.
- `&freeze=1` gives deterministic shots.
- `&cam=…` selects the camera.

`window.__APEX__.sceneReady` becomes true after the first rendered frame.

---

## 3. Core architecture

### 3.1 Layers and dependency rules
- **Sim layer.** Plain TS with no DOM and no three.
  - Files: `physics`, `ai`, `race`, `game/sim`, `track/{build,query,data,authoring}`, `core/{math,rng}`.
  - It is deterministic.
  - All mutable state lives in `SimState`, which is plain data: numbers, booleans, arrays and typed arrays. No class instances, Maps or closures.
  - It runs headless in Node (Vitest).
- **Presentation layer.** Contains three, DOM and WebAudio.
  - Files: `graphics`, `ui`, `audio`, `track/{mesh,scenery,terrain,sky}`.
  - It reads `RenderFrame` and the sim events. It never mutates sim state.
- **Glue layer.** `core`, `game`, `main.ts`. Holds the app state machine, sessions, presenters, input, settings and i18n.

### 3.2 Loop and timestep
- Sim rate is **240 Hz** (`SIM_DT = 1/240`). Wheel spin integrates in **4 substeps** (960 Hz).
- **Max 12 ticks per frame.** If it hits the cap, the accumulator is dropped (the game slows down instead of spiralling) and `simOverrun` is counted.
- Subsystems run at their own rates:

| Subsystem | Rate | Detail |
|---|---|---|
| AI controllers | 60 Hz | Staggered: car *i* runs when `(tick+i)%4==0` |
| RaceDirector line crossings | 240 Hz | Sub-tick interpolation |
| Standings and gaps | 60 Hz | |
| Conditions | 10 Hz | |
| Tyre thermal/wear | 60 Hz | |
| Snapshots | 10 Hz | Ring buffer of 15 s |

- Frame order, driven by `renderer.setAnimationLoop`:
  1. `frameDt = clamp(dt, 0, 0.1)`.
  2. `input.pollFrame()`.
  3. If a session is running and not paused: `acc += frameDt*timeScale`. While `acc >= DT && n < 12`: save the previous pose, latch DriverControls, step the sim, decrement `acc`.
  4. Drain sim events to the bus.
  5. `alpha = acc/DT`. Build `RenderFrame` by interpolating the previous and current pose, without allocating. Use shortest-path lerp for angles.
  6. `cameraRig.update`, then `env.update`, `carVisuals.update`, `vfx.update`, `racingLine.update`.
  7. `audio.update`.
  8. `HudPresenter` at 30 Hz, then `ui.updateHud`.
  9. `graphics.render`, then `perf.record`.
- Visibility handling: when the tab is hidden or the window loses focus during a session, auto-pause.

### 3.3 System order per tick (single-writer rule)

| # | System (owner) | Writes |
|---|---|---|
| 1 | ConditionsSystem (YÖN) | `state.conditions` |
| 2 | PlayerInputSystem / keyboard filter (SÜR) | player `car.input` (skipped when autodrive or pit-auto is on) |
| 3 | AISystem (SÜR) | `car.input` and `car.ai` for AI-controlled cars (including the player under autodrive or pit-auto) |
| 4 | VehicleSystem (SÜR) | `car.vehicle` (everything, including the ERS lap counters, which it resets on its own lap-wrap detection) |
| 5 | CollisionSystem (SÜR) | `car.vehicle` pose and velocity corrections; collision events |
| 6 | RaceDirector + PitProcedure (YÖN) | `car.race`, `car.pit`, `state.race`; sim events |
| 7 | SnapshotSystem (YÖN) | ring buffer (outside `state`) |

Rules:
- A system may read any field but writes only its own.
- No module-level mutable state in the sim. Everything goes into `SimState`. Per-car RNG states live inside it too (mulberry32, stored as a number).

### 3.4 Module lifecycle
- **Sim systems** implement `SimSystem { name; step(world, dt) }`. They are created by factories and hold no state, only caches derived from `world.static`.
- **Presentation modules** follow `init(ctx) → (load) → update(frame) → dispose()`.
  - `dispose()` must release every geometry, material, texture and render target it created.
  - It must also remove DOM nodes and listeners and unsubscribe from the bus.
  - A Playwright leak test enforces this (§14).
- **AssetLoader (YÖN):**
  - Caches textures with reference counts and reports progress.
  - Waits for fonts via `document.fonts.load`.
  - At the end of loading, calls `renderer.compileAsync(scene, camera)` to avoid first-frame hitches.

### 3.5 Event bus
`EventBus<EventMap>` provides synchronous `on`, `off`, `once` and `emit`. Sim events are pushed into `world.events` (a pooled queue) and the glue layer re-emits them as `'sim'`. The full `EventMap` is in §4.

### 3.6 App state machine and screen flow

`AppState` is one of: `boot`, `title`, `menu`, `loading`, `session`, `results`, `sandbox`.

Main flow:
```
boot → title ("press any key": unlocks AudioContext)
     → menu{mainMenu ⇄ settings ⇄ credits}
mainMenu → ttSetup → loading → session(TT)
mainMenu → raceConditions → teamSelect → raceSettings[→ assists] → loading → session(Race)
```

Inside a session:
- **UI sub-state:** `driving` ⇄ `paused` ⇄ `flashback`, then `finished`.
- **Race phase (director):** `grid` → `lights` → `running` → `finishing` → `finished`.

Exits:
- `session(Race)` → `results` → (Restart → `loading`) | `mainMenu`.
- `session(TT)` → Pause → Quit → `ttResults` → `mainMenu`.

Other entry points:
- `?scene=` goes straight to `sandbox`.
- `?autostart=1` jumps from `boot` to `loading`, using defaults plus the URL params.

### 3.7 URL parameters (parsed once by YÖN into `LaunchParams`)

| Param | Values (default) |
|---|---|
| `scene` | sandbox id |
| `mode` | `menu`(default) \| `tt` \| `race` |
| `autostart` | `1` skips menus |
| `autodrive` | `1`: the player car is driven by perfect AI at d=100 |
| `weather` | `dry` \| `light` \| `heavy` \| `variable` |
| `tod` | `day` \| `sunset` \| `night` |
| `laps` | 3 \| 5 \| 10 \| 15 \| 29 |
| `ai` | 0–19 (19) |
| `difficulty` | 0–110 (70) |
| `quality` | `low` \| `medium` \| `high` \| `ultra` |
| `seed` | int |
| `cam` | `cockpit` \| `tcam` \| `nose` \| `chaseNear` \| `chaseFar` \| `orbit` \| `free` |
| `lang` | `tr` \| `en` |
| `team` | team id |
| `tyre` | `soft` \| `medium` \| `hard` \| `inter` \| `wet` |
| `grid` | 1–20 |
| `skipLights` | 1 |
| `timescale` | number |
| `freeze` | 1 |
| `mute` | 1 |
| `debug` | 1 (overlay) |
| `nopost` | 1 |
| `s` | start position along the track, in m (teleport) |

### 3.8 `window.__APEX__` (always present, in production builds too)
The interface `ApexDebugApi` is in §4.
- **State and lifecycle:** `ready`, `sceneReady`, `whenReady()`, `state()`.
- **Session control:** `startSession(cfg)`, `pause()`, `resume()`, `step(ticks)`, `setTimeScale()`.
- **Teleport:** `teleport(car, s, d, kmh)`.
- **Camera:** `setCamera(id)`, `freeCam(pos, look)`.
- **Conditions and quality:** `setConditions()`, `setQuality()`, `setAutodrive()`.
- **Synthetic input:** `input.press(action, ms)` and `input.release(action)`.
- **Inspection:** `getTelemetry(car)`, `getRace()`, `getPerf()`, `resetPerf()`, `hashState()`.
- **Diagnostics:** `errors[]` (captured `console.error` and uncaught errors) and `gpu` (renderer string).

### 3.9 Settings and persistence
- `SettingsStore` wraps `localStorage` with try/catch, debounced writes (500 ms) and versioned migrations.
- Keys:
  - `apexgp:v1:settings`
  - `apexgp:v1:lastRaceSetup`
  - `apexgp:v1:tt:istanbul`: PB lap, sectors, ghost (Float32 → base64, about 75 KB) and a local top-10.
  - `apexgp:v1:rivalGhost:<buildHash>`
- The schema is in §4.

### 3.10 i18n
- `t(key, params)` does `{name}` substitution. Turkish needs no plural forms after numbers ("3 tur").
- Dictionaries are typed objects per namespace, and a parity test requires identical key sets in TR and EN.
- `<html lang>` is set dynamically. Upper-casing uses `toLocaleUpperCase('tr-TR')` or CSS `text-transform` under `lang="tr"`, which handles dotted İ correctly.
- Lap times are always shown as `m:ss.mmm`.
- TR is the default. Strings are never hard-coded in UI code.

### 3.11 Input pipeline
1. Keyboard events use `KeyboardEvent.code`, which is layout-independent and works with TR-Q.
2. `InputManager` maps codes to `ActionId`s per context (`menu`, `driving`, `flashback`, `rebind`).
3. It latches edges per sim tick into `DriverControls`, so an edge is never lost or double-consumed between frames and ticks.
4. SÜR's keyboard filter turns that into `VehicleInput`.
5. Everything driving-related calls `preventDefault`.
6. In fullscreen, `navigator.keyboard.lock(['Escape'])` is used when available (Chrome).

### 3.12 Errors
- No WebGL2: show a TR/EN message.
- `webglcontextlost`: pause and offer a reload button.
- An uncaught error in a session: show a non-blocking toast and record it in `__APEX__.errors`. The E2E gate fails on it.

---

## 4. Contracts appendix (`src/contracts/*.ts`, written by YÖN in Sprint 0)

```ts
// ===== common.ts =====
export interface Vec3 { x: number; y: number; z: number }
export type Quad<T> = [T, T, T, T];                // wheel order FL, FR, RL, RR
export type WheelIndex = 0 | 1 | 2 | 3;
export type Side = 1 | -1;                          // +1 = LEFT (+d), -1 = right
export type Compound = 'soft' | 'medium' | 'hard' | 'inter' | 'wet';
export type SurfaceType = 'asphalt' | 'line' | 'kerbFlat' | 'kerbSausage' | 'astroturf'
  | 'runoffAsphalt' | 'grass' | 'gravel' | 'pitAsphalt' | 'concrete';
export type TimeOfDay = 'day' | 'sunset' | 'night';
export type WeatherPreset = 'dry' | 'light' | 'heavy' | 'variable';
export type QualityId = 'low' | 'medium' | 'high' | 'ultra';
export type CameraId = 'cockpit' | 'tcam' | 'nose' | 'chaseNear' | 'chaseFar';
export type Lang = 'tr' | 'en';
export type Unsubscribe = () => void;

// ===== frames.ts (pure helpers; the only runtime code in contracts) =====
// World: right-handed, +Y up, +X east, +Z south (north = -Z). Units m, s, kg, rad, N. Origin = S/F line centre at ground.
// yaw ψ: CCW seen from above. forward f = (cos ψ, 0, -sin ψ); left l = (-sin ψ, 0, -cos ψ).
// Car MODEL space: +Z forward (nose), +Y up, +X left -> matrix.makeBasis(leftW, upW, fwdW).setPosition(p)
export function forwardFromYaw(yaw: number, out: Vec3): Vec3;
export function leftFromYaw(yaw: number, out: Vec3): Vec3;
export function wrapAngle(a: number): number;      // (-π, π]

// ===== track.ts =====
export interface TrackFrame {
  s: number; px: number; py: number; pz: number;    // centreline ground point
  tx: number; tz: number;                           // horizontal unit tangent (driving dir)
  lx: number; lz: number;                           // horizontal unit LEFT vector
  halfWidthL: number; halfWidthR: number;           // white-line edges = track limits (>0)
  crossSlope: number;                               // dy/dd; ground y at offset d = py + crossSlope*d
  curvature: number; vCurvature: number; grade: number; // 1/m (+left), d²y/ds² (+compression), dy/ds
  sector: 0 | 1 | 2;
}
export interface TrackHint { s: number; ribbon: 'main' | 'pit'; sp: number }   // persistent per car/wheel
export interface GroundHit {
  y: number; nx: number; ny: number; nz: number; surface: SurfaceType;
  ribbon: 'main' | 'pit'; s: number; d: number; sp: number;  // s always = main-track s (projected); sp NaN on main
  inLimits: boolean; wetLocal: number;                        // wetness multiplier hint (puddle/line), filled by query if provided
}
export type WallKind = 'armco' | 'concrete' | 'tyres' | 'tecpro' | 'pitwall' | 'fence';
export interface WallHit { nx: number; nz: number; px: number; pz: number; dist: number; wallId: number; kind: WallKind } // dist<0 = penetration; n points to drivable side
export interface SurfaceProps { mu: number; muWetMul: number; rollingResistance: number; dragDecel: number; bumpAmp: number; bumpWavelength: number; loadNoise: number }
export interface TrackQuery {
  readonly data: TrackData; readonly length: number;
  frameAt(s: number, out: TrackFrame): TrackFrame;
  worldFromSD(s: number, d: number, out: Vec3): Vec3;
  pitWorldFromSD(sp: number, d: number, out: Vec3): Vec3;
  project(x: number, z: number, hint: TrackHint, out: { s: number; d: number }): void; // local search ±40 m around hint.s
  ground(x: number, z: number, hint: TrackHint, out: GroundHit): GroundHit;        // updates hint in place; ≤1 µs target
  wallsNear(x: number, z: number, radius: number, out: WallHit[], max: number): number;
  surfaceProps(t: SurfaceType): SurfaceProps;
  wrapS(s: number): number; deltaS(from: number, to: number): number;               // shortest signed difference
  sectorAt(s: number): 0 | 1 | 2;
}
export interface TrackData {
  id: 'istanbul'; name: { tr: string; en: string }; length: number; ds: 1; count: number;
  x: Float32Array; y: Float32Array; z: Float32Array; tx: Float32Array; tz: Float32Array;
  curvature: Float32Array; vCurvature: Float32Array; grade: Float32Array; crossSlope: Float32Array;
  halfWidthL: Float32Array; halfWidthR: Float32Array;
  bandTypeL: Uint8Array; bandOuterL: Float32Array; bandTypeR: Uint8Array; bandOuterR: Float32Array; // 4 bands/side/sample, outer offsets in m (>0)
  wallL: Float32Array; wallR: Float32Array;                       // lateral distance to barrier face
  sectors: [number, number];                                      // s where S2, S3 start
  timingLines: { kind: 'finish' | 'sector2' | 'sector3' | 'speedTrap' | 'drsDetect' | 'drsActivate' | 'drsEnd' | 'pitEntry' | 'pitExit'; s: number; ref: number }[];
  drsZones: { id: number; detectS: number; activateS: number; endS: number }[];
  corners: { n: number; dir: 'L' | 'R'; entryS: number; apexS: number; exitS: number; minRadius: number }[];
  cutZones: { id: string; side: Side; fromS: number; toS: number; gates: number[] }[];
  grid: { s: number; d: number }[];                               // 20, index 0 = pole
  pit: PitLaneData; walls: { id: number; kind: WallKind; height: number; xz: Float32Array; drivableSide: Side }[];
  startGantryS: number; attribution: string[];
}
export interface PitLaneData {
  length: number; count: number; x: Float32Array; y: Float32Array; z: Float32Array; tx: Float32Array; tz: Float32Array; halfWidth: Float32Array;
  mainSAtSplit: number; mainSAtMerge: number; limitStartSp: number; limitEndSp: number; speedLimitKmh: 80;
  fastLaneD: number; workingLaneD: number;                        // +d toward garages
  boxes: { teamId: string; sp: number; d: number }[];
}
export interface TrackBundle { data: TrackData; query: TrackQuery }

// ===== vehicle.ts =====
export interface TyreCompoundParams { mu: number; tOptC: number; windowC: number; wearRate: number; heatRate: number;
  slipAnglePeak: number; slipRatioPeak: number; shapeC: number; blanketC: number; wetTable: [number, number][] }
export interface VehicleParams {
  massDryKg: number; cgHeight: number; frontWeightFrac: number; wheelbase: number; trackFront: number; trackRear: number;
  yawInertiaPerKg: number; wheelRadius: number; wheelInertiaFront: number; wheelInertiaRear: number; engineInertia: number;
  maxSteerRad: number; ackermann: number; steeringWheelRatio: number; lltdFront: number;
  ClA: number; CdA: number; aeroFrontShare: number; airDensity: number; drsDragFactor: number; drsDownforceFactor: number; drsOpenTime: number; drsCloseTime: number;
  torqueCurve: [number, number][]; engineBrakeCurve: [number, number][]; idleRpm: number; limiterRpm: number; launchRpm: number;
  gearRatios: number[]; finalDrive: number; drivetrainEff: number; upshiftTime: number; downshiftTime: number; shiftTorqueFactor: number;
  diffLockPower: number; diffLockCoast: number; brakeTorqueTotal: number; brakeBiasDefault: number;
  ers: { maxKw: number; capacityMJ: number; deployLimitMJ: number; harvestKLimitMJ: number; maxHarvestKkW: number; maxHarvestHkW: number; maxTorqueNm: number };
  rollingResistance: number; loadSensitivity: number; loadRefN: number; fuelKgPerLap: number;
  compounds: Record<Compound, TyreCompoundParams>; bodyLength: number; bodyWidth: number; teamPerf: number;
}
export type ErsMode = 'none' | 'medium' | 'hotlap' | 'overtake';
export interface VehicleInput { throttle: number; brake: number; steer: number;   // steer -1..1 (+left) × maxSteer
  gearUp: boolean; gearDown: boolean; drsRequest: boolean; ersOvertake: boolean; pitLimiter: boolean; ersMode: ErsMode; brakeBias: number }
export interface DriverControls { throttle: boolean; brake: boolean; left: boolean; right: boolean;
  gearUpPressed: boolean; gearDownPressed: boolean; drsPressed: boolean; ersOvertakeHeld: boolean; pitLimiterPressed: boolean }
export interface WheelState { omega: number; spin: number; slipRatio: number; slipAngle: number; load: number; fx: number; fy: number;
  surface: SurfaceType; inLimits: boolean; groundY: number; susp: number; brakeTempC: number; locked: boolean; hint: TrackHint }
export interface TyreState { wear: number; surfC: number; coreC: number; gripMul: number }
export interface VehicleState {
  x: number; y: number; z: number; yaw: number; vx: number; vz: number; yawRate: number;
  vLong: number; vLat: number; speed: number; axLong: number; ayLat: number;
  nx: number; ny: number; nz: number; pitch: number; roll: number; heave: number; steerAngle: number;
  wheels: Quad<WheelState>; tyres: Quad<TyreState>; compound: Compound; tyreAgeLaps: number;
  rpm: number; gear: number; shiftTimer: number; clutch: number; limiterHit: boolean; pitLimiterOn: boolean;
  ers: { socJ: number; deployedLapJ: number; harvestedKLapJ: number; mode: ErsMode; deployKw: number; harvestKw: number };
  drs: { open: boolean; flap: number }; fuelKg: number; massKg: number;
  hint: TrackHint; s: number; d: number; lapWraps: number;       // progress = lapWraps*L + s
  offTrackWheels: number; wallImpulse: number; carImpulse: number; sparks: number; slipstream: number; dirtyAir: number; resetCount: number;
}

// ===== ai.ts =====
export interface RacingLine { count: number; ds: number; s: Float32Array; d: Float32Array; x: Float32Array; y: Float32Array; z: Float32Array; curvature: Float32Array }
export interface SpeedProfile { line: RacingLine; v: Float32Array; accel: Float32Array; zone: Uint8Array /*0 throttle,1 lift,2 brake*/; gripScale: number; wetness: number }
export interface AIDriverProfile { pace: number; consistency: number; aggression: number; wetSkill: number; tyreMgmt: number; startSkill: number; defending: number }
export type AIMode = 'start' | 'race' | 'overtake' | 'defend' | 'yield' | 'recover' | 'pit' | 'cooldown' | 'perfect';
export interface AIState { mode: AIMode; laneOffset: number; laneTarget: number; targetCar: number; rng: number; mistakeTimer: number; mistakeKind: number;
  integ: number; plannedStopLaps: number[]; nextCompound: Compound; overtakeTimer: number; defendUsed: boolean; stuckTimer: number; lastSteer: number }
export interface AIModule {
  prepare(track: TrackQuery, params: VehicleParams[]): void;   // base line + per-car profiles (≤ 300 ms total)
  getRacingLine(): RacingLine; getProfile(carId: number): SpeedProfile;
  setDifficulty(d: number): void; onWetnessChanged(w: number): void;   // rebuild profiles when |Δw| > 0.05 (spread over ticks)
  initCar(world: SimWorld, carId: number, profile: AIDriverProfile): void;
  computeInput(world: SimWorld, carId: number, out: VehicleInput): void;
}

// ===== conditions.ts =====
export interface WeatherKeyframe { t: number; rain: number }
export interface ConditionsState { tod: TimeOfDay; preset: WeatherPreset; rain: number; wetness: number; lineWetness: number; airC: number; trackC: number; timeline: WeatherKeyframe[]; nextTickT: number }
export interface ForecastEntry { inMin: number; rain: number; probability: number }
export interface ConditionsFrame { tod: TimeOfDay; rain: number; wetness: number; lineWetness: number; cloud: number; time: number }

// ===== race.ts =====
export type SessionMode = 'timeTrial' | 'race';
export type RacePhase = 'grid' | 'lights' | 'running' | 'finishing' | 'finished';
export type SectorStatus = 'none' | 'yellow' | 'green' | 'purple';
export type FlagType = 'green' | 'yellow' | 'blue' | 'chequered' | 'blackWhite';
export type PenaltyReason = 'jumpStart' | 'trackLimits' | 'cornerCut' | 'pitSpeeding' | 'twoCompound';
export type PitPhase = 'none' | 'requested' | 'entry' | 'limiter' | 'boxIn' | 'stationary' | 'release' | 'boxOut' | 'exit';
export interface AssistSettings { steering: boolean; braking: 'off' | 'low' | 'medium' | 'high'; abs: boolean; tc: 'off' | 'medium' | 'full';
  gearbox: 'auto' | 'manual'; racingLine: 'off' | 'corners' | 'full'; pit: boolean; ers: boolean; drs: boolean; kbBrakeLimiter: boolean }
export interface SessionConfig { mode: SessionMode; laps: number; aiCount: number; difficulty: number; tod: TimeOfDay; weather: WeatherPreset; seed: number;
  playerTeamId: string; playerDriverIdx: 0 | 1; gridPos: number | 'random'; startCompound: Compound | 'auto'; flashbacks: number /*-1 = ∞*/;
  assists: AssistSettings; autodrive: boolean; ghost: 'off' | 'pb' | 'rival'; mandatoryStop: boolean; wearScale: number }
export interface CarRaceState { lapsCompleted: number; sector: 0 | 1 | 2; position: number; progress: number;
  lapStartMs: number; sectorStartMs: number; curSectors: [number, number, number]; lastLapMs: number; bestLapMs: number; bestSectors: [number, number, number];
  sectorStatus: [SectorStatus, SectorStatus, SectorStatus]; lapValid: boolean; trackLimitCount: number; penaltySec: number; penaltyToServeSec: number;
  gapToLeaderMs: number; intervalMs: number; lapsDown: number; drsEligible: boolean; drsZone: number; finished: boolean; finishMs: number;
  status: 'running' | 'finished' | 'dnf' | 'dsq'; compoundsUsedMask: number; pitStops: number; speedTrapKmh: number; markerTimes: Float32Array /*536 × 10 m*/ }
export interface CarPitState { phase: PitPhase; requested: boolean; nextCompound: Compound; boxSp: number; timer: number; serviceS: number; speeding: boolean }
export interface RaceState { phase: RacePhase; lightsLit: number; lightsOutAtMs: number; raceMs: number; leaderLap: number; drsEnabled: boolean;
  fastest: { car: number; ms: number }; sessionBestSectors: [number, number, number]; yellow: [boolean, boolean, boolean]; order: number[]; flashbacksLeft: number; finishCountdownMs: number }

// ===== sim.ts =====
export const SIM_HZ = 240; export const SIM_DT = 1 / 240;
export interface SimCarState { id: number; driverId: string; teamId: string; isPlayer: boolean; control: 'player' | 'ai' | 'pitAuto';
  input: VehicleInput; controls: DriverControls; vehicle: VehicleState; ai: AIState; race: CarRaceState; pit: CarPitState }
export interface SimState { tick: number; time: number; cars: SimCarState[]; race: RaceState; conditions: ConditionsState; rng: { race: number; weather: number } }
export interface SimStatic { config: SessionConfig; track: TrackBundle; params: VehicleParams[]; ai: AIModule }
export interface SimWorld { static: SimStatic; state: SimState; events: SimEventQueue }
export interface SimSystem { readonly name: string; step(world: SimWorld, dt: number): void }
export interface SimEventQueue { push(e: SimEvent): void; drain(cb: (e: SimEvent) => void): void }
export type SimEvent =
  | { type: 'lightsOn'; count: number } | { type: 'lightsOut' } | { type: 'jumpStart'; car: number }
  | { type: 'sector'; car: number; sector: 0 | 1 | 2; ms: number; status: SectorStatus } | { type: 'lap'; car: number; lap: number; ms: number; valid: boolean }
  | { type: 'fastestLap'; car: number; ms: number } | { type: 'position'; car: number; from: number; to: number }
  | { type: 'trackLimits'; car: number; count: number } | { type: 'penalty'; car: number; seconds: number; reason: PenaltyReason }
  | { type: 'drsEnabled' } | { type: 'drsDisabled' } | { type: 'drsAvailable'; car: number; zone: number }
  | { type: 'pit'; car: number; phase: PitPhase } | { type: 'collision'; a: number; b: number /* -1 wall */; impulse: number; x: number; y: number; z: number }
  | { type: 'gear'; car: number; gear: number } | { type: 'kerb'; car: number; wheel: WheelIndex; sausage: boolean }
  | { type: 'flag'; flag: FlagType; sector: number; car: number } | { type: 'finish'; car: number; position: number }
  | { type: 'weather'; rain: number; msg: 'rainSoon' | 'rainStarted' | 'drying' | 'intersNow' | 'slicksNow' | 'wetsNow' | 'none' } | { type: 'carReset'; car: number };
export interface SimSnapshot { tick: number; time: number; state: SimState }   // structuredClone of state
export interface SimRunner { world: SimWorld; step(): void; snapshot(): SimSnapshot; restore(s: SimSnapshot): void /* deep-assign into live objects */; hash(): string }

// ===== render.ts (presentation; may import types from 'three') =====
export interface CarRenderState { id: number; visible: boolean; isPlayer: boolean; isGhost: boolean; ghostAlpha: number;
  px: number; py: number; pz: number; fx: number; fy: number; fz: number; ux: number; uy: number; uz: number;
  speed: number; steerAngle: number; wheelSpin: Quad<number>; susp: Quad<number>; rpm: number; gear: number; throttle: number; brake: number;
  drsFlap: number; brakeGlow: Quad<number>; rainLight: 0 | 1 | 2 /*off,on,flash*/; compound: Compound; slip: Quad<number>; wheelSurface: Quad<SurfaceType>;
  sparks: number; inPitBox: boolean; teamId: string; number: number; tcam: 'black' | 'yellow' }
export interface RenderFrame { time: number; frameDt: number; alpha: number; cars: CarRenderState[]; playerId: number; conditions: ConditionsFrame;
  lights: { lit: number; out: boolean }; yellowSectors: [boolean, boolean, boolean]; paused: boolean;
  racingLine: { mode: 'off' | 'corners' | 'full'; profile: SpeedProfile | null; playerS: number; playerSpeed: number } }
export interface QualityPreset { id: QualityId; renderScale: number; aa: 'fxaa' | 'smaa'; smaa: 'MEDIUM' | 'HIGH' | 'ULTRA'; shadowSize: 1024 | 2048 | 4096;
  shadowExtent: number; shadowRadius: number; ao: 'off' | 'half' | 'full'; bloom: boolean; lut: boolean; lens: 'droplets' | 'dropletsCA' | 'all';
  envSize: 128 | 256 | 512; anisotropy: number; carLod: [number, number, number]; mirrors: 'static' | 'low30' | 'high60';
  treeDensity: number; crowdDensity: number; grassCards: number; rainStreaks: number; sprayPerCar: number; smokeMax: number; skidQuads: number; far: number }
export interface RenderContext { renderer: WebGLRenderer; scene: Scene; camera: PerspectiveCamera; pmrem: PMREMGenerator; quality: QualityPreset; width: number; height: number; pixelRatio: number }
export interface RendererPerf { calls: number; triangles: number; geometries: number; textures: number; programs: number }
export interface GraphicsSystem { init(canvas: HTMLCanvasElement, q: QualityPreset): Promise<RenderContext>; setQuality(q: QualityPreset): void;
  setLighting(rig: LightingRig, envScene: Scene): void; render(frame: RenderFrame): void; resize(): void; getPerf(): RendererPerf; dispose(): void }
export interface CarVisualSpec { id: number; teamId: string; number: number; tcam: 'black' | 'yellow'; isGhost: boolean }
export interface CarVisualsSystem { init(ctx: RenderContext, cars: CarVisualSpec[]): Promise<void>; update(frame: RenderFrame, cam: PerspectiveCamera): void; setCockpitCar(id: number | null): void; dispose(): void }
export interface ListenerPose { px: number; py: number; pz: number; fx: number; fy: number; fz: number; ux: number; uy: number; uz: number; vx: number; vy: number; vz: number; camera: CameraId }
export interface CameraRig { readonly camera: PerspectiveCamera; setMode(id: CameraId): void; mode(): CameraId; next(): CameraId; setLookBack(on: boolean): void;
  setFovOffset(deg: number): void; update(frame: RenderFrame, dt: number): void; getListener(out: ListenerPose): ListenerPose }
export interface VfxSystem { init(ctx: RenderContext): void; update(frame: RenderFrame, cam: PerspectiveCamera, dt: number): void; onSimEvent(e: SimEvent): void; dispose(): void }
export interface RacingLineVisual { init(ctx: RenderContext, line: RacingLine): void; update(frame: RenderFrame): void; dispose(): void }

// ===== environment.ts =====
export interface LightingRig { tod: TimeOfDay; sunDir: Vec3; sunColor: number; sunIntensity: number; hemiSky: number; hemiGround: number; hemiIntensity: number;
  envIntensity: number; exposure: number; fogColor: number; fogDensity: number; bloomIntensity: number; bloomThreshold: number; lut: 'day' | 'sunset' | 'night' | 'overcast'; shadows: boolean }
export interface EnvironmentHandle { root: Object3D; sun: DirectionalLight; hemi: HemisphereLight; envScene: Scene; rig: LightingRig;
  applyConditions(c: ConditionsFrame): void; update(cam: PerspectiveCamera, frame: RenderFrame, dt: number): void; setQuality(q: QualityPreset): void; dispose(): void }
export type BuildEnvironment = (a: { track: TrackBundle; quality: QualityPreset; conditions: ConditionsFrame; ctx: RenderContext; assets: AssetLoader; onProgress(p: number): void }) => Promise<EnvironmentHandle>;

// ===== audio.ts =====
export interface AudioSettings { master: number; engine: number; sfx: number; ambience: number; ui: number }
export interface AudioSystem { init(bus: EventBus<EventMap>, s: AudioSettings): void; unlock(): Promise<void>; isUnlocked(): boolean;
  update(frame: RenderFrame, listener: ListenerPose, dt: number): void; onSimEvent(e: SimEvent): void; setVolumes(v: AudioSettings): void; setPaused(p: boolean): void; dispose(): void }

// ===== hud.ts =====
export interface TowerRow { car: number; pos: number; code: string; teamColor: string; gapText: string /*pre-formatted by presenter? NO: raw ms*/;
  gapMs: number; lapsDown: number; compound: Compound; inPit: boolean; penaltySec: number; isPlayer: boolean; fastest: boolean; drs: boolean; status: CarRaceState['status'] }
export interface HudModel { visible: 'full' | 'minimal' | 'off'; mode: SessionMode;
  lap: { current: number; total: number | null }; position: { pos: number; of: number } | null;
  timing: { curLapMs: number; lastLapMs: number; bestLapMs: number; deltaMs: number | null; invalid: boolean; sectors: [{ ms: number; status: SectorStatus }, { ms: number; status: SectorStatus }, { ms: number; status: SectorStatus }]; curSector: 0 | 1 | 2 };
  tower: TowerRow[]; towerExpanded: boolean; gapMode: 'interval' | 'leader';
  car: { kmh: number; gear: number; rpm: number; rpmMax: number; shiftLeds: number /*0..15*/; shiftNow: boolean; limiter: boolean; pitLimiter: boolean;
    throttle: number; brake: number; drs: 'off' | 'unavailable' | 'available' | 'open' | 'disabled'; ers: { soc: number; mode: ErsMode; lapUsed: number; overtake: boolean };
    brakeBias: number; tyre: { compound: Compound; ageLaps: number; wear: Quad<number>; tempC: Quad<number>; state: Quad<'cold' | 'ok' | 'hot'> } };
  minimap: { x: Float32Array; z: Float32Array; teamColor: string[]; player: number; inPit: Uint8Array };
  startLights: { visible: boolean; lit: number; out: boolean };
  flags: { yellow: [boolean, boolean, boolean]; blue: boolean; chequered: boolean; blackWhite: boolean };
  notifications: { id: number; key: string; params: Record<string, string | number>; level: 'info' | 'warn' | 'penalty' | 'good' }[];
  mfd: { open: boolean; page: 'strategy' | 'ers' | 'brakes' | 'weather' | 'tyres'; nextCompound: Compound; boxRequested: boolean; forecast: ForecastEntry[] };
  weather: { rain: number; wetness: number; airC: number; trackC: number };
  flashback: { open: boolean; offsetSec: number; maxSec: number; left: number } }

// ===== ui.ts =====
export type ScreenId = 'title' | 'mainMenu' | 'ttSetup' | 'raceConditions' | 'teamSelect' | 'raceSettings' | 'assists' | 'loading' | 'pause' | 'settings' | 'results' | 'ttResults' | 'credits';
export type UiAction = { type: 'navigate'; to: ScreenId } | { type: 'back' } | { type: 'startTimeTrial' } | { type: 'startRace' } | { type: 'resume' }
  | { type: 'restart' } | { type: 'quitToMenu' } | { type: 'retire' } | { type: 'skipToResults' } | { type: 'toggleFullscreen' };
export interface Store<T> { get(): Readonly<T>; set(patch: Partial<T>): void; subscribe(cb: (v: Readonly<T>) => void): Unsubscribe }
export interface UiDeps { settings: SettingsStore; setup: Store<SessionConfig>; results: Store<ResultsModel>; tt: Store<TimeTrialModel>;
  loading: Store<{ progress: number; tipKey: string }>; i18n: I18n; bus: EventBus<EventMap>; dispatch(a: UiAction): void; menuInput: MenuInputSource; teams: readonly TeamDef[] }
export interface UiSystem { mount(root: HTMLElement, deps: UiDeps): void; show(id: ScreenId): void; hideScreens(): void; updateHud(m: HudModel): void; dispose(): void }
export interface ResultsModel { rows: { pos: number; car: number; name: string; teamId: string; totalMs: number; gapMs: number; lapsDown: number; bestLapMs: number; stops: number; penaltySec: number; points: number; status: string }[]; fastestCar: number }
export interface TimeTrialModel { laps: { n: number; ms: number; valid: boolean; sectors: [number, number, number] }[]; pbMs: number; top10: { ms: number; date: string; teamId: string }[] }

// ===== settings.ts / input.ts / events.ts / debug.ts / data.ts / modules.ts =====
export interface Settings { version: 1; lang: Lang;
  graphics: { preset: QualityId | 'custom'; custom: Partial<QualityPreset>; fovOffset: number; showFps: boolean; cameraShake: number; motionEffects: boolean };
  audio: AudioSettings; controls: { layout: 'wasd' | 'arrows'; bindings: Record<ActionId, string[]>; steerSensitivity: number };
  assists: AssistSettings; hud: { mode: 'full' | 'minimal' | 'off'; minimap: boolean; units: 'kmh' | 'mph'; scale: number };
  camera: { default: CameraId }; gameplay: { difficulty: number; flashbacks: number } }
export interface SettingsStore extends Store<Settings> { setPath(path: string, value: unknown): void; reset(section?: keyof Settings): void }
export type ActionId = 'throttle' | 'brake' | 'steerLeft' | 'steerRight' | 'gearUp' | 'gearDown' | 'drs' | 'ersOvertake' | 'pitLimiter' | 'cameraNext' | 'lookBack'
  | 'flashback' | 'pause' | 'mfdNext' | 'mfd1' | 'mfd2' | 'mfd3' | 'mfd4' | 'racingLine' | 'hudCycle' | 'restartLap' | 'debugOverlay'
  | 'menuUp' | 'menuDown' | 'menuLeft' | 'menuRight' | 'menuConfirm' | 'menuBack';
export interface MenuInputSource { onAction(cb: (a: ActionId) => void): Unsubscribe }
export interface I18n { lang(): Lang; setLang(l: Lang): void; t(key: string, params?: Record<string, string | number>): string }
export interface EventMap { 'app:state': { from: string; to: string }; 'settings:changed': { path: string }; 'lang:changed': { lang: Lang };
  'session:loading': { progress: number; stage: string }; 'session:started': { mode: SessionMode }; 'session:ended': { reason: 'finished' | 'quit' | 'restart' };
  'sim': SimEvent; 'camera:changed': { id: CameraId }; 'hud:mode': { mode: 'full' | 'minimal' | 'off' }; 'racingLine:mode': { mode: 'off' | 'corners' | 'full' };
  'mfd:changed': { open: boolean; page: string }; 'flashback:open': { left: number }; 'flashback:applied': { toTime: number; left: number }; 'flashback:cancel': Record<string, never>;
  'notify': { key: string; params?: Record<string, string | number>; level: 'info' | 'warn' | 'penalty' | 'good'; ms: number }; 'audio:unlocked': Record<string, never>; 'quality:changed': { id: QualityId } }
export interface TeamDef { id: string; name: string; short: string; colors: { primary: string; secondary: string; accent: string }; finish: 'gloss' | 'matte' | 'metallic'; perf: number; drivers: [DriverDef, DriverDef] }
export interface DriverDef { id: string; name: string; code: string; number: number; nat: string; ai: AIDriverProfile }
export interface SandboxScene { id: string; title: string; create(ctx: { canvas: HTMLCanvasElement; uiRoot: HTMLElement; params: URLSearchParams }): Promise<{ update(dt: number): void; dispose(): void }> }
// modules.ts: factory signatures each owner must export from its index.ts
//  track:    loadTrack(): TrackBundle (sync, imports baked JSON) · buildEnvironment: BuildEnvironment
//  physics:  createPlayerInputSystem(), createVehicleSystem(), createCollisionSystem(): SimSystem · defaultVehicleParams(teamPerf): VehicleParams
//            initVehicleState(p: VehicleParams, t: TrackBundle, slot: {s:number; d:number}, c: Compound): VehicleState
//  ai:       createAIModule(): AIModule · createAISystem(ai: AIModule): SimSystem
//  race:     createRaceDirector(): SimSystem · createConditionsSystem(): SimSystem · generateWeatherTimeline(p, seed, durationS): WeatherKeyframe[]
//  game:     createSim(cfg: SessionConfig, opts?: { track?: TrackBundle }): SimRunner   (canonical world factory, used by game AND tests)
//  graphics: createGraphicsSystem(), createCarVisuals(), createCameraRig(), createVfx(), createRacingLineVisual(), QUALITY_PRESETS
//  ui:       createUi(): UiSystem      audio: createAudioSystem(): AudioSystem
```

The **ApexDebugApi** type mirrors §3.8.

Remove the comment on `TowerRow.gapText`. The presenter passes raw numbers, and GRA formats them in `src/ui/format.ts`.

**The 10 fictional teams (`src/data/teams.ts`, YÖN).** Avoid real team names, real driver names and real 3-letter codes. T-cam colour follows the real convention: driver 1 black, driver 2 yellow.

| Team | Colours | Finish | perf | Drivers (code, #) |
|---|---|---|---|---|
| **Anka Racing** (TR) | crimson / white / gold | gloss | +0.010 | Kerem Aydın (AYD, 7) · Deniz Arslan (ARS, 34) |
| Aurora GP | ice white / electric blue | gloss | +0.012 | Elias Norberg (NRB, 6) · Juho Virtanen (VIR, 19) |
| Vortex Motorsport | matte black / neon green | matte | +0.015 | Tom Ashby (ASH, 9) · Rafael Mendes (MEN, 28) |
| Solaris Racing | orange / deep purple | metallic | +0.005 | Luca Moretti (MOR, 15) · Hugo Lambert (LAM, 41) |
| Kestrel Racing | navy / gold | gloss | 0 | Oliver Grant (GRA, 3) · Kenji Morita (MRT, 25) |
| Meridian Racing | teal / silver | metallic | 0 | Mateo Ortega (ORT, 11) · Noah Fischer (FIS, 52) |
| Titan Dynamics | gunmetal / red | matte | −0.005 | Viktor Hale (HAL, 8) · Anton Petrov (PET, 70) |
| Zephyr Racing | sky blue / pink | gloss | −0.008 | Leo Duval (DUV, 21) · Santiago Ruiz (RUI, 37) |
| Ironclad Racing | yellow / black | gloss | −0.012 | Jack Whitmore (WHI, 12) · Ethan Cole (CLE, 46) |
| Nova Corsa | white with blue/red stripes | gloss | −0.015 | Julien Moreau (MRE, 17) · Aiden Park (PAR, 88) |

`perf` scales the AI grip scale and the car's power and ClA by up to ±1.5%. Time Trial uses perf 0 for every car.

Other fictional names:
- Tyre brand on sidewalls: "ORBIS".
- Billboard sponsors: Kuzey Air, Vela Fuel, Halcyon Energy, Pulsar Tech, Lale Çay, Kervan Bank, Mavi Rota Lojistik, Nexa Watches, Simit Express.
- Series name: "APEX GP". The words "Formula 1" and "F1" never appear in the game.

---

## 5. Physics spec (SÜR, `src/physics/**`)

### 5.1 Model
- **2.5D.** Dynamics are planar in the horizontal plane: x, z, yaw, the two velocity components and yaw rate. Each of the 4 wheels has independent spin ω.
- Load transfer is quasi-static (longitudinal and lateral, using filtered accelerations with τ = 0.05 s).
- Height comes from `TrackQuery.ground` at the 4 contact points. y is the average plus the visual heave.
- Slope, bank and vertical curvature enter as force terms.
- Pitch, roll and heave are visual only and are derived from the load transfer.
- s is horizontal arc length; a slope of 8% or less changes it by under 0.3%.
- There is no airborne state, no damage model and no suspension integration.

### 5.2 Per-tick algorithm (240 Hz; wheel spin in 4 substeps)
1. **Ground query.** Query the ground under the 4 wheels using each wheel's hint. This gives surface, `inLimits`, y and normal. Also project the centre to get s, d, lap wraps and `offTrackWheels`.
2. **Body velocities.** `vLong = vx cosψ − vz sinψ`, `vLat = −vx sinψ − vz cosψ`.
3. **Aero.**
   - `q = ½ρ·vLong²`.
   - `Fdf = q·ClA·(1−0.08·drsFlap)·(1−dirty)·(1+teamPerf)`.
   - Split front/rear by `aeroFrontShare`.
   - `Fdrag = q·CdA·(1−(1−drsDragFactor)·drsFlap)·(1−0.30·slip)`.
4. **Loads.**
   - `Ffront = m·g·ny·b/L + Fdf·share − m·āx·h/L + m·v²·κv·b/L`. The rear is symmetric.
   - Lateral transfer per axle: `ΔF = m·āy·h/track·LLTD`. When `āy > 0` (accelerating left), the right wheels gain load.
   - Clamp every load to at least 50 N.
5. **Steering.**
   - `δ = input.steer·maxSteer`. Ackermann 0.3: the inner wheel gets `δ·(1+0.3·|δ|/maxSteer)`.
   - Wheel positions in body coordinates (forward, left):

     | Wheel | Position |
     |---|---|
     | FL | (a, +tf/2) |
     | FR | (a, −tf/2) |
     | RL | (−b, +tr/2) |
     | RR | (−b, −tr/2) |

   - `a = L(1−frontWeightFrac) = 1.962`, `b = 1.638`.
6. **Contact velocities.**
   - `vi = (vLong − r·lat_i, vLat + r·long_i)`, then rotate into the wheel frame by δ to get `(vix, viy)`.
   - `κ = (ωR − vix)/max(|vix|, 3)`.
   - `α = atan2(viy, max(|vix|, 1))`, with first-order relaxation (σ = 0.3 m) at low speed.
7. **Tyre forces (combined slip).**
   - `σx = κ/κpk`, `σy = tan α / tan αpk`, `σ = √(σx²+σy²)`.
   - `F = D·sin(C·atan(2.3σ))` with C = 1.35, so the peak sits at σ = 1 and sliding gives about 85% of peak.
   - `Fx = F·σx/σ`, `Fy = −F·σy/σ`.
   - `D = μ_eff·Fz`.
   - `μ_eff = μ_compound · gT · gWear · wetTable(W_local) · surface.mu · (surface wet multiplier when W>0) · loadSens`.
   - `loadSens = clamp(1 − 0.075·(Fz/4000 − 1), 0.80, 1.10)`.
8. **Wheel spin (substeps).**
   - `I·ω̇ = Tdrive − Tbrake·sgn(ω) − Fx·R − Crr·Fz·R`.
   - Wheel inertia: front 1.1, rear 1.4 + `0.06·ratio²/2` when the clutch is engaged.
   - If ω would cross zero under braking, clamp ω = 0 (lock).
   - ABS: when `κ < −0.10`, scale that wheel's brake torque by 0.6 for the substep.
9. **Drivetrain.**
   - `Taxle = (Te·cut + Tk)·gear·final·η`, with η = 0.95.
   - `Te = thr·Tmax(rpm) + (1−thr)·Teb(rpm)`.
   - During a shift, multiply by `shiftTorqueFactor` 0.25.
   - Diff: `Trl,rr = Taxle/2 ∓ clamp(40·Δω, ±lock·|Taxle|/2)`. Lock is 0.35 on power and 0.15 on coast.
   - Engine speed `= ratio·mean(ωRL, ωRR)`.
   - Auto-clutch: below 5 m/s in 1st, `rpm = max(wheel rpm, lerp(idle, launchRpm, thr))` and torque is capped by a 0.6 s clutch ramp.
   - Limiter: above 12,550 rpm cut for 15 ms, resume at 12,350, and set `limiterHit`.
10. **Integration (semi-implicit Euler, world frame).**
    - Sum the wheel forces (rotated back from the wheel frames), minus drag, minus rolling resistance, minus gravity along the slope (`−g·∂y/∂fwd`, `−g·∂y/∂left` from the normal), plus surface drag decel (gravel).
    - `v += F/m·dt`, `r += Mz/Izz·dt`, `ψ += r·dt`, `x,z += v·dt`.
    - `Izz = 1.40·m`.
11. **At 60 Hz:** tyre thermal and wear, slipstream and dirty air, fuel burn, brake temperatures, ERS mode pacing, visual pitch/roll/heave (0.30° per g pitch, 0.25° per g roll, heave −22 mm at 300 km/h) and sparks.

### 5.3 Parameter table (`defaultVehicleParams`)

| Parameter | Value |
|---|---|
| Dry mass (with driver) | 798 kg |
| Fuel | race: laps × 1.75 kg + 1.5 kg (cap 105); TT: 10 kg |
| CG height | 0.28 m |
| Front weight fraction | 0.455 |
| Wheelbase / track F / track R | 3.60 / 1.60 / 1.55 m |
| Wheel radius | 0.36 m |
| Body length × width | 5.6 × 2.0 m |
| Max steer / Ackermann / steering-wheel ratio | 22° (0.384 rad) / 0.3 / 8:1 |
| LLTD front | 0.52 |
| ClA / CdA / front aero share / ρ | 4.4 m² / 1.48 m² / 0.42 / 1.20 (×288.15/(273.15+T_air)) |
| DRS | drag ×0.885, downforce ×0.92; open 0.25 s, close 0.15 s |
| Torque curve (rpm : N·m) | 4000:330, 6000:400, 8000:460, 9000:485, 10000:505, 10500:505, 11000:486, 12000:445, 12500:410 (about 560 kW peak) |
| Engine braking (rpm : N·m) | 4000:−30, 8000:−70, 12000:−110 |
| Idle / launch / limiter | 4000 / 9500 / 12500 rpm |
| Gear ratios | 2.95, 2.32, 1.90, 1.62, 1.40, 1.22, 1.067, 0.933 |
| Final drive | 5.25 (overall 15.5 … 4.9; 8th = 332 km/h at 12k rpm) |
| Shift times | up 0.035 s, down 0.06 s (auto blip) |
| Brakes | total torque 17,800 N·m at full pedal; bias default 0.575 (adjustable 0.50–0.70) |
| ERS (MGU-K) | 120 kW, ES 4.0 MJ, deploy limit 4.0 MJ/lap, K harvest ≤120 kW and 2.0 MJ/lap, H harvest ≤40 kW (full throttle, >10k rpm, unlimited), K torque cap 240 N·m |
| Rolling resistance | Crr 0.012 × surface multiplier |

**Compounds**

| Compound | μ | T_opt / window (°C) | wearRate | heatRate | α_pk (rad) | κ_pk | C | Blanket (°C) |
|---|---|---|---|---|---|---|---|---|
| Soft | 1.82 | 100 / 18 | 1.6 | 1.15 | 0.095 | 0.11 | 1.38 | 70 |
| Medium | 1.75 | 105 / 20 | 1.0 | 1.0 | 0.100 | 0.11 | 1.35 | 70 |
| Hard | 1.68 | 110 / 22 | 0.65 | 0.9 | 0.105 | 0.11 | 1.33 | 70 |
| Inter | 1.52 | 75 / 20 | 1.2 (×3 if W<0.15) | 0.95 | 0.12 | 0.12 | 1.30 | 60 |
| Wet | 1.40 | 65 / 20 | 1.2 (×4 if W<0.25) | 0.85 | 0.13 | 0.13 | 1.30 | 60 |

**Wet grip table** (multiplier on the compound's own μ, interpolated linearly in W):

| W | 0 | 0.1 | 0.2 | 0.35 | 0.5 | 0.75 | 1.0 |
|---|---|---|---|---|---|---|---|
| Slick | 1.00 | 0.84 | 0.70 | 0.58 | 0.50 | 0.42 | 0.36 |
| Inter | 0.95 | 0.95 | 0.94 | 0.92 | 0.88 | 0.78 | 0.66 |
| Wet | 0.92 | 0.92 | 0.92 | 0.915 | 0.91 | 0.89 | 0.86 |

This gives a slick-to-inter crossover at W ≈ 0.11 and an inter-to-wet crossover at W ≈ 0.62.

Puddles (W_local = 1, at speeds above 160 km/h) add aquaplaning: slick ×0.5, inter ×0.8, wet ×0.95.

### 5.4 Tyre thermal and wear
- Each tyre has a surface temperature and a core temperature.
  - The surface heats with `|Fx·vsx|+|Fy·vsy|` and with rolling.
  - It cools toward the track/air temperature at `(h0 + h1·v)`.
  - It exchanges heat with the core.
  - Rain adds cooling of ×(1 + 2W).
- Calibration targets (to be tested):
  - (a) A Medium goes from blanket temperature to 95–105 °C core within one push lap.
  - (b) It stays inside its window on push laps.
  - (c) A slow lap cools it by 10–15 °C.
  - (d) A Soft overheats by about +15 °C after three push laps.
  - (e) A slick drops to about 60 °C within one lap at W > 0.5.
- Temperature grip `gT`:
  - When cold: `1 − 0.25·min(1, (ΔT/45)²)`.
  - When hot: `1 − 0.30·min(1, (ΔT/40)²)`.
  - Overheating multiplies wear by `(1 + max(0, ΔT)/15)`.
- Wear `w` (0 = new, 1 = dead) grows with slip power × wearRate × wearScale.
  - `gWear = 1 − 0.10·min(w, 0.7)/0.7`.
  - Past 0.7 there is a cliff: subtract a further `0.35·(w − 0.7)/0.3`.
- Calibrate so that at wearScale 1 and AI pace d=100, wear reaches 0.7 at: Soft 18 laps, Medium 28, Hard 38.
- `wearScale = 58/max(N, 15)` when N ≥ 15; otherwise 2.0.

### 5.5 Surfaces table (owned by ÇEV's query, values given here)

| Surface | μ | Wet extra × | Crr | Drag decel | Bump amp / λ | Notes |
|---|---|---|---|---|---|---|
| asphalt | 1.00 | 1.00 | 0.012 | 0 | 0 | |
| line (paint) | 0.92 | 0.75 | 0.012 | 0 | 0 | |
| kerbFlat | 0.94 | 0.80 | 0.014 | 0 | 6 mm / 1.0 m | rumble |
| kerbSausage | 0.75 | 0.70 | 0.030 | 0 | 40 mm / 0.5 m | load noise 40% |
| astroturf | 0.80 | 0.60 | 0.020 | 0 | 2 mm | |
| runoffAsphalt | 0.95 | 0.95 | 0.013 | 0 | 0 | |
| grass | 0.55 | 0.60 | 0.050 | 0 | 20 mm / 2 m | dust |
| gravel | 0.45 | 0.90 | 0.120 | 0.25 g·min(1, v/10) | 30 mm / 0.3 m | stones |
| pitAsphalt | 0.98 | 1.00 | 0.012 | 0 | 0 | |
| concrete | 0.90 | 0.85 | 0.012 | 0 | 0 | pit boxes |

### 5.6 DRS, ERS, slipstream and dirty air
- **DRS.** Opens on a `drsRequest` edge when `race.drsZone ≥ 0` and the car is eligible (always eligible in TT). It closes when brake > 0.05 or the zone ends.
- **ERS modes:**

| Mode | Deploy behaviour |
|---|---|
| `none` | Never deploys |
| `medium` | Deploys at throttle ≥ 0.95 and v > 30 m/s while lap-budget fraction used ≤ lap distance fraction + 0.1 |
| `hotlap` | Deploys whenever throttle ≥ 0.95 |
| `overtake` | While the key is held: max deploy at throttle ≥ 0.9, still capped by 4 MJ per lap and state of charge |

  The ERS assist uses `medium` automatically. Counters reset on lap wrap.
- **Slipstream.**
  - For a car within 0 < Δs < 50 m behind another car on the main ribbon: `slip = (1−Δs/50)^1.2 · max(0, 1−|Δd|/2.2)`, giving drag ×(1 − 0.30·slip).
  - Dirty air within 30 m: `dirty = (1−Δs/30)·max(0, 1−|Δd|/3.0)`, giving ClA ×(1 − 0.22·dirty) and front surface temperature +5 °C/s × dirty while cornering.

### 5.7 Keyboard input filtering (`src/physics/input/keyboardFilter.ts`, the most important piece for feel)
- **Steering**
  - Target `u* = left − right`.
  - Ramp in at `lerp(4.0, 1.6, clamp(v/80, 0, 1))` per second × sensitivity. Release and centring use 6.0/s; a reversal releases to 0 first, then ramps in.
  - Shaping: `δ = sign(u)·|u|^1.4 · δmax(v)`.
  - `δmax(v) = min(maxSteer, atan(L·aLat(v)/max(v², 1)) + αpk·k)`, where `aLat(v) = μest·(g + ½ρClA·v²/m)` and `μest = 1.6 × wetTable(current compound, W)`.
  - k = 0.9 with the steering assist on, 1.25 with it off.
  - Result: holding the key gives about peak cornering, never an instant spin.
- **Throttle:** ramps in at 6/s, out at 10/s.
- **Brake:** ramps in at 8/s, out at 12/s.
- **Keyboard brake limiter** (setting, default on): full key equals 1.05 × the lock threshold estimated at the current speed. With ABS off the car can still lock, but it stays drivable.
- AI bypasses this filter. It writes `steer` directly, rate-limited to 1.5 rad/s.

### 5.8 Assists

| Assist | Behaviour |
|---|---|
| ABS | Per-wheel κ target −0.10 |
| TC | Rear κ target 0.16 (Medium) or 0.10 (Full). PI torque cut, Kp 6, Ki 20 |
| Steering assist | Clamp at k = 0.9, plus counter-steer when the rear slip angle exceeds 0.75·αpk: `δcs = 0.5·(r − v·κpath)` clamped to ±4° |
| Braking assist | Uses the player's SpeedProfile at the current d. Brakes in proportion when v exceeds target·(1+m), with m = 0.15 / 0.07 / 0 for Low / Med / High; High also lifts the throttle |
| Auto gearbox | Up at 11,800 rpm (or the limiter). Down when rpm < 7,800, or under braking when rpm after the downshift would be ≤ 11,000. Never above 12,500 |
| Pit assist | AI drives the car between the pit entry and exit lines |
| DRS assist | Opens automatically when allowed |

Assist presets:
- **Beginner:** everything on, TC Full, braking High, racing line Full.
- **Intermediate (default):** steering assist ON, ABS ON, TC Medium, braking assist Off, racing line Corners, auto gears, pit assist ON, ERS auto, DRS manual.
- **Expert:** everything off, manual gears.

### 5.9 Collisions
- **Walls.**
  - Check the OBB corners (5.6 × 2.0 m) against `wallsNear(radius 6)`. Walls come from a spatial hash with 20 m cells.
  - Push the car out by the penetration depth.
  - Impulse at the deepest corner: `j = −(1+e)·vn/(1/m + (r×n)²/Izz)` with e = 0.25, plus tangential friction μ = 0.35.
  - Emit an event with sparks when |vn| > 3 m/s.
- **Car vs car.**
  - Broadphase: neighbours in `race.order` with |Δs| < 7 m.
  - Narrowphase: 2D SAT on the OBBs. Split the minimum translation vector by inverse mass.
  - Impulse with e = 0.15 and μ = 0.25, clamped to 30 kN·s.
- **Recovery.**
  - Trigger when speed < 2 km/h for 4 s off track, or the car is NaN or outside the drivable ribbon by more than 5 m.
  - Reset to the nearest track edge with v = 0, emit `carReset`, and make the car non-colliding for 3 s.

### 5.10 Low-speed stability and numerical safety
- Slip floors: 3 m/s for κ and 1 m/s for α.
- Below 1.5 m/s with brake > 0.1 and throttle < 0.05: hold, setting v, r and ω to 0.
- Below 0.5 m/s with no input: damping ×0.9 per tick.
- Wheel ω substeps as above.
- A NaN guard triggers the recovery reset.

### 5.11 Acceptance numbers (Vitest benches)
Test conditions unless stated otherwise: dry, Medium tyres at optimum temperature, fuel 10 kg, ES full, flat straight test track.

| Metric | Target |
|---|---|
| 0–100 km/h (TC Full, auto) | 2.5–2.9 s |
| 0–200 km/h | 4.6–5.4 s |
| 0–300 km/h | 10.0–12.5 s |
| Top speed, ERS deploying, DRS closed | 322–332 km/h |
| Top speed, DRS open | +9 to +15 km/h |
| Top speed, ES empty | 300–310 km/h |
| End of İstanbul back straight (s≈4,500), DRS + ERS | 320–335 km/h |
| 200→0 km/h (ABS on) | 50–65 m |
| 300→100 km/h | 70–95 m |
| Peak decel at 300 km/h | 4.5–5.5 g |
| Steady lateral g at 80 km/h | 1.9–2.4 g |
| Steady lateral g at 250 km/h | 4.3–5.2 g |
| T8 peak lateral g (AI d=100) | 4.5–5.5 g |
| AI lap time at d=100, dry, Medium, 10 kg fuel | 1:24.0–1:27.0 |
| Sector split | about 33% / 36% / 31% |
| Wet: inters at W=0.5 | +8–13% lap time |
| Wet: full wets at W=1.0 | +15–22% |
| Wet: slicks at W=0.6 | ≥ +25% |

Robustness requirements:
- Standstill jitter < 1 mm/s.
- 10 minutes of random-input fuzz with no NaN.
- Bitwise determinism: the same seed and inputs give the same `hash()` after 60 s, and snapshot → continue → restore → re-run gives the same state.

---

## 6. AI spec (SÜR, `src/ai/**`)

1. **Racing line.**
   - Resample the centreline at 2 m. Each point has a lateral offset bounded by the track edges minus a 1.3 m margin.
   - Run multigrid elastic relaxation at 16 m, 8 m, 4 m and 2 m spacing (300 / 200 / 150 / 100 iterations, ω = 0.5). Each iteration moves `d_i` toward the projection of its neighbours' midpoint onto the binormal, then clamps.
   - Finish with 3 Laplacian passes. This approximates the minimum-curvature line.
   - Each driver gets a smooth personal offset noise of ±0.3 m.
   - Budget: ≤ 60 ms.
2. **Speed profile** (per car):
   - Corner limit: `v = √(μg/(|κ| − μ·k))` with `k = ½ρ·ClA/m`, iterated 3 times to include κv and grade.
   - Forward pass: `a = min(P(v)/(m·v) − drag/m − rr, traction)·√(1 − (aLat/aLatMax)²)`.
   - Backward pass: `a_brk = (μ(mg + Fdf) + drag)/m · brakeEff·√(1 − (aLat/aLatMax)²)`.
   - Loop the passes twice around the circuit (it is closed).
   - Zones: accel < −3 → brake; −3 to 0.5 → lift; otherwise throttle.
   - μ includes `gripScale × wetTable(compound, W) × (1 − 0.03·W)` as a wet margin.
3. **Controller** (60 Hz).
   - Pure pursuit to the point at `s + Ld`, with `Ld = clamp(6 + 0.35v, 8, 45)` m and the target `d = line.d + laneOffset`.
   - Curvature `κpp = 2·y_local/Ld²`. Steering `δ = atan(L·κpp) + Kus·aLat + 0.08·(r_ref − r)`.
   - Speed: target `v = profile(s + 0.15v)`. Throttle PI (Kp 0.35, Ki 0.05). Brake = clamp(−0.25·e, 0, 1) when e < −1.5 m/s.
   - The AI always uses ABS and TC Medium.
4. **Difficulty scaling** (d = 0–110):
   - `gripScale = 0.86 + 0.14·min(d,100)/100 + 0.0025·max(d−100, 0)`.
   - `brakeEff = 0.88 + 0.12·min(d,100)/100`.
   - Mistake chance per corner = `0.002 + 0.02·(1 − min(d,100)/100)²`.
   - Start reaction = `0.40 − 0.18·min(d,110)/110 s ± 0.03` (startSkill) `+ N(0, 0.02)`.
   - Driver `pace` (0.985–1.0) and team `perf` multiply in.
   - Resulting table: d=0 → 0.86 / 0.88 / 2.2% / 0.40 s; d=50 → 0.93 / 0.94 / 0.7% / 0.32 s; d=100 → 1.00 / 1.00 / 0.2% / 0.24 s; d=110 → 1.025 / 1.00 / 0.2% / 0.22 s.
5. **Racecraft.** `laneOffset` moves at most 2.5 m/s laterally.
   - **Following:** IDM-like gap control with desired gap = 4 m + 0.25·v.
   - **Overtake:** within 25 m, closing, with a speed advantage > 2 km/h (or DRS/slipstream) and space available. Pick the inside of the next corner if the next brake zone is more than 150 m away, otherwise the freer side. Set `laneTarget = ±3.0 m`. Commit only if overlap is ≥ 30% at the brake point; otherwise abort and tuck back in.
   - **Side by side** (|Δs| < 5.8 m): keep at least 2.3 m centre-to-centre lateral separation. The outside car gets corner speed −4% and brakes +10 m earlier.
   - **Defend:** when a car within 0.5 s is behind and the next brake zone is within 300 m, make one move to the inside (≤ 2.5 m) per straight, and never in a braking zone.
   - **Blue flag:** a car being lapped moves to the offline side and lifts 5% when a lapping car is within 1 s for 3 s.
   - **Avoidance:** if time-to-collision < 1.0 s with lateral overlap, brake in proportion. For a stopped or slow car ahead (< 30 km/h), steer to the wider gap.
6. **Start.**
   - Mode `start` covers the first 600 m. Lane offsets come from the grid column (±2 m), T1 braking is 3% earlier and aggression ×0.6.
   - The AI never jump-starts.
7. **Rain.**
   - Profiles are rebuilt whenever ΔW > 0.05 (spread across ticks).
   - `wetSkill` gives ±2% grip in the wet.
   - Mistake rate ×(1 + 1.5W).
8. **Pit strategy.**
   - For dry races with N ≥ 15, pick a template at the start (seeded):

     | Template | Share |
     |---|---|
     | M→H | 50% |
     | S→H | 25% |
     | H→M | 15% |
     | S→M→S | 10% |

   - Stop lap = `min(0.85·life(compound)/wearScale, 0.45N) ± 2`.
   - Re-evaluate every lap:
     - Box if the worst tyre's wear is ≥ 0.72, or the trend predicts the cliff before the plan.
     - Undercut: if the car ahead (≤ 1.5 s) pitted last lap and our stop is within 4 laps, box with probability 0.4 × aggression.
   - For N < 15: box only if wear ≥ 0.85 or for weather.
   - Weather thresholds (shifted ±0.04 per driver):

     | Situation | Action |
     |---|---|
     | On slicks, W ≥ 0.18 for 20 s (or heavy rain forecast within 3 min and W ≥ 0.1) | Inters (Wets if rain ≥ 0.7 and W ≥ 0.6) |
     | On Inters, W ≥ 0.68 | Wets |
     | On Wets, W ≤ 0.55 | Inters |
     | On Inters, W ≤ 0.10 for 30 s and dry forecast | Slicks (M or H depending on laps left) |

   - Double stacking: queue behind the teammate if the box is occupied.
9. **Mistakes.**
   - Rolled on brake-zone entry using the per-car RNG. Pressure: ×1.5 when followed within 0.5 s.
   - Mistake types:

     | Type | Share | Effect |
     |---|---|---|
     | Late braking / lock-up | 60% | +8–15 m braking point, brakeEff ×0.9 |
     | Wide exit | 30% | Lane +1.5 m outward |
     | Overdrive | 10% | Grip +6% for the corner, may slide |

   - Lap-to-lap noise: grip ×(1 + N(0, (1 − consistency)·0.004)).
   - Mode `perfect` (autodrive, rival ghost) disables all mistakes and noise.
10. **Recovery** after a spin or going off: slow to ≤ 60 km/h, aim for d = 0 at s + 30 m, and wait if a car is within 3 s approaching. A car stuck for more than 4 s triggers the physics reset.

---

## 7. Track & environment spec (ÇEV)

### 7.1 Source facts
See §0 for the OSM and DEM facts.

The world origin is the S/F node. Projection from lat/lon to the world frame:
- `x = Δlon · mLon`, `z = −Δlat · mLat`.
- `mLat = 111132.92 − 559.82·cos2φ + 1.175·cos4φ`.
- `mLon = 111412.84·cosφ − 93.5·cos3φ`.
- φ = 40.95222°.
- `y = EU-DEM − 130.6 m`.

### 7.2 Pipeline (`scripts/fetch-track.mjs`, run once and commit the output)
1. **Fetch the geometry.**
   - Use Overpass (POST, with a descriptive User-Agent and no personal data; retry 3 times with backoff) querying `way(id:179048507,295742111);out geom;`.
   - Fallback: OSM API `https://api.openstreetmap.org/api/0.6/way/179048507/full.json` and `.../295742111/full.json`.
   - Rotate the main loop so it starts at node 1893855303.
2. **Fetch scenery features.** Use OSM API `map.json?bbox=29.396,40.945,29.425,40.966` for `leisure=bleachers`, `building=grandstand`, `building=*`, `landuse=forest|farmland|residential`, `natural=wood|scrub`.
3. **Fetch elevation.** Use `https://api.opentopodata.org/v1/eudem25m?locations=lat,lon|…`: at most 100 points per call, at least 1 s between calls, at most 1,000 calls per day.
   - Centreline every 25 m.
   - A 3 × 3 km terrain grid at 50 m spacing (17 calls).
4. **Write** `src/track/data/istanbul.raw.json`.
5. **Last-resort fallback** if the network is down: the data in §7.4 and §7.15.

Runtime `buildTrackData(raw, authoring)`:
- Centreline Catmull-Rom at 1 m, Gaussian smoothing σ = 3 m, and a curvature limiter on spikes.
- Elevation: Gaussian σ = 40 m, then clamp vertical curvature to [−1/700, +1/400].
- Widths, banking, kerbs, run-offs and walls come from `src/track/authoring/istanbul.ts`, keyed by s. Transitions use smoothstep over 40 m.
- Pit ribbon from the OSM pit polyline. Blend its first and last 60 m onto the main left edge.
- Must be deterministic and take ≤ 150 ms.

**Credits:**
- "Track geometry derived from OpenStreetMap data © OpenStreetMap contributors (ODbL 1.0). The derived file istanbul.raw.json is also provided under ODbL."
- "Elevation: EU-DEM v1.1, produced using Copernicus data and information funded by the European Union; served via OpenTopoData."

### 7.3 Corner list
s is measured from S/F on the OSM basis of 5,351.5 m. Rescale proportionally to the final length. The radii are on the smoothed centreline; the racing-line radii are much larger.

| T | s entry–exit (apex) | Dir | Turn | Min R | Character | Elev at apex (m) |
|---|---|---|---|---|---|---|
| 1 | 191–283 (235) | L | 94° | 27 | Blind, heavy braking from ~300 km/h, track drops away on exit | +1 falling to −4 |
| 2 | 307–520 (420) | R | ~72° (+40° gentle to 869) | 87 | Long right in the valley, then a flat-out 7% climb | −12.9 |
| 3 | 881–1049 (965) | L | 105° | 69 | Fast blind left over the crest (highest point), ~210 km/h | +20.0 |
| 4 | 1077–1153 (1115) | R | 101° | 19 | Downhill, off-camber braking right | +11 |
| 5 | 1203–1321 (1262) | L | 101° | 27 | Medium-slow left on a plateau | +12.2 |
| 6 | 1341–1421 (1381) | L | 53° | 50 | Quick left flick, then a −24 m descent | +8.7 |
| 7 | 1797–2033 (1900) | R | 164° | 35 | Wide right-hand hairpin: downhill entry, lowest point at apex, positive camber | −12.8 |
| 8 | 2200–2760 (2280 / 2392 / 2597) | L | ~212° | 48–52 | Iconic multi-apex left, ~640 m, 260–290 km/h, 5 g, bump mid-corner, on a plateau | +9.5…+10.8 |
| 9 | 3227–3305 (3266) | L | 107° | 23 | Steep downhill braking (−9%) to the lowest point of the lap, ~95 km/h | −22.4 |
| 10 | 3309–3401 (3355) | R | 51° | 57 | Right flick onto the back straight; traction matters | −20 |
| 11 | 3819–3951 (3885) | R | 42° | 92 | Flat-out kink on the 1.15 km back straight | −16.5 |
| 12 | 4607–4725 (4666) | L | 153° | 29 | Biggest braking zone (~325 km/h), the main overtaking spot | −12.8 |
| 13 | 4731–4803 (4767) | R | 101° | 21 | Slow right; pit entry splits off on the left at its exit | −8 |
| 14 | 4843–4919 (4881) | L | 111° | 19 | Slow uphill left onto the main straight | −3.5 |

Expected net heading change: +360° (anti-clockwise).

Test: the direction sequence must be **L R L R L L R L L R R L R L**.

### 7.4 Elevation (y relative to S/F, metres)
100 samples at `s_k = k·L/100`. From EU-DEM; smooth before use.
```
0.0 2.0 2.7 2.2 -0.2 -4.4 -9.1 -11.8 -12.9 -12.4 -9.5 -5.5 -1.4 3.0 7.2 10.3 14.0 17.6 20.0 19.3
15.1 10.9 12.2 12.3 12.2 9.9 7.5 4.6 1.7 -1.7 -4.4 -5.2 -7.1 -9.0 -11.0 -12.8 -11.6 -8.4 -4.5 -1.3
0.9 2.4 5.5 8.0 9.2 9.5 9.5 10.3 10.8 10.1 9.9 8.0 5.7 2.5 -1.2 -5.8 -10.7 -13.9 -17.0 -19.3
-21.3 -22.4 -21.6 -20.2 -17.8 -14.7 -14.3 -15.3 -16.6 -17.6 -17.5 -17.3 -16.8 -15.6 -11.4 -9.1 -6.1 -3.2 -1.1 -0.9
-1.6 -4.8 -8.6 -11.4 -12.1 -12.0 -13.0 -12.6 -9.0 -7.7 -5.6 -3.5 -1.6 0.4 0.1 -0.4 -2.9 -1.7 -1.2 -1.1
```
Shape of the lap:
1. S/F, then a small crest at s≈110, then T1 drops to the T2 valley (−12.9).
2. A 7% climb to the T3 crest (+20.0, the highest point).
3. The T4–T5 plateau (+12), then a descent to the T7 apex (−12.8).
4. The T8 plateau (crest at s≈2569), then a −9% descent to T9 (−22.4, the lowest point).
5. The back straight around −17, climbing 7.8% to a crest at s≈4,228.
6. A descent into the T12 braking zone, then a climb through T13–T14 back to 0.

### 7.5 Widths and banking
**Half-widths** (left/right, metres):

| Section | s range | Half-widths L/R |
|---|---|---|
| Main straight | 4,919 → 120 | 8/8 |
| T1 approach | 120–230 | 10/10 |
| T1 exit | to 320 | 8/8 |
| T2–T8 | 320–2,800 | 7.5/7.5 |
| T3–T6 | | 7/7 |
| T9 braking | 3,150–3,230 | 8/8 |
| Back straight | | 7.5/7.5 |
| T12 braking | 4,450–4,610 | 9/9 |
| T12–T14 | | 7.5/7.5 |

Track width overall: 14–20 m.

**Banking (crossSlope).** Sign convention: positive means banked into the corner.

| Corner | Bank |
|---|---|
| T1 | +2° |
| T4 | −2° (off-camber) |
| T7 | +3° |
| T8 | +1.5° |
| Others | 0–1° |
| Straights | 0, visual crown only |

### 7.6 Timing
- Finish at s = 0.
- Sector 2 starts at **1,650** (after T6). Sector 3 starts at **3,480** (after T10).
- Speed trap at 4,500.
- DRS zone 1 (main straight): detection 4,840, activation 4,990, end 150.
- DRS zone 2 (back straight): detection 3,200, activation 3,480, end 4,560.
- `cutZones`: T1 inside, T9–T10 inside, T12–T14 insides. Each gate sits at the apex.

### 7.7 Pit lane and grid
- The pit lane is on the **left** (inside).
- **Split** at main s ≈ 4,775 (exit of T13). The pit road runs south, inside T14, then along the straight about 13–15 m to the left of the centreline. **Merge** at main s ≈ 419 (inside T1, joining at T2).
- Pit ribbon length is 910 m.
  - The speed limit applies from sp 115 to 705 (590 m at 80 km/h).
  - 10 boxes (one per team) at sp = 300 + 28k, inside the pit building's s range (main 5,089 → 130).
  - Lateral layout: fast lane at d = +12, working lane at +17.5, pit wall face at d = +8.9 (main left edge +7.5 to +8), garage fronts at +22.
  - A pit-exit line runs to s ≈ 470.
- Target total pit loss is **20–24 s**.
- **Grid:** P_k at s = L − 12 − 8k and d = +2.4 (k even) or −2.4 (k odd). Pole is on the **left**, the inside of T1. The 20 slots span s = 5,340 down to 5,188.
- The start gantry is above the track at s = 0, 6 m high, facing the grid: 5 columns × 2 red lamps.

### 7.8 Kerb, run-off and barrier rules
- **Inside (apex) kerb:** apex ± 0.4 × corner length, 1.2 m wide, flat, red/white 1 m stripes, sawtooth edge.
- **Exit kerb (outside):** from apex + 0.2·len to exit + 30 m, 1.8 m wide.
- **Sausage kerbs:** yellow, 0.4 m wide, 12 cm high, placed 2.5 m behind the exit kerb at T1, T9, T10, T12 and T14.
- **Outside run-off:** width = clamp(0.12·v_apex_kmh, 10, 45) m.
  - Asphalt with red/blue painted stripe bands at T1, T3, T12, T14 and on the T8 entry.
  - Gravel after a 3 m asphalt band at T4, T7, T8 (second half) and T9.
- **Inside:** kerb, then 2 m astroturf, then grass.
- **Straights:** grass verge of 6–12 m, then the wall.
- **Barriers:**
  - Tyre walls plus TecPro at impact zones: T1, T4, T8 exit, T9, T12.
  - Armco elsewhere.
  - Concrete walls with a catch fence at spectator areas and along the main straight. The right-hand wall there is at d = −14.
  - At least 25 m clearance in high-speed corners; at least 45 m outside T8.
- The wall polylines must form continuous chains. Gaps are allowed only at the pit entry and exit.

### 7.9 Scenery placement (OSM-derived; s along the main track, side, setback)

| What | Placement |
|---|---|
| **Main grandstand** | Right side, s 5,089 → 130 (≈400 m long), setback 40–48 m, 3 tiers with roof |
| **Pit building + paddock** | Left side, same s range, front at +22 m, about 100 m deep. 3 floors, team-coloured garage doors, VIP floor, control tower near s = 0 |
| Bleachers (right) | s 250–278 (79–96 m, T1 hill) · 1,013 (128 m, T3) · 1,390 and 1,433 (~90 m, T5/T6) · 2,280 (83 m) and 2,632 (108 m, span 103; T8 outside) · 3,210–3,266 (55–63 m, T9) · 3,432 (94 m, T10 exit) · 4,563 (44 m, span 123; T12) · 4,870 (62 m, span 143; T13/T14) · 5,036 (55 m) |
| Bleachers (left) | s 3,877 (53 m, T11 inside) |
| Roofed hospitality | s 202, right side, 43 m |
| Marshal posts | ~21, every ~250 m on alternating sides, with LED flag panels driven by flags |
| Distance boards | 150/100/50 m before T1, T4, T9, T12 |
| Billboards | On straights and braking zones |
| Overhead banner gantries | s ≈ 1,600 and 4,400 |
| Trees | Fill OSM forest/wood polygons plus scatter: stone pine, cypress, oak scrub. Keep ≥ 30 m from barriers at corner sightlines |
| Backdrop | Residential silhouettes to the north; farmland texture on far terrain |

### 7.10 Terrain
- EU-DEM grid over 3 × 3 km, rendered in two rings:
  - Inner ring 1.6 km at 10 m resolution (about 51 k triangles).
  - Outer ring at 50 m resolution.
  - A distant hill-silhouette ring at 3–6 km.
- Within the ribbon + 15 m, terrain height equals the ribbon height, blended over 20–60 m with smoothstep.
- The terrain must match the barrier base within 5 cm.
- Material splat: dry golden summer grass / green grass / dirt, by slope and noise.

### 7.11 Instancing and LOD
- Track ribbon in 250 m chunks, merged per material, with frustum culling.
- Barriers, fences and kerbs are merged per chunk.
- Trees: InstancedMesh with 3D low-poly within 150 m and cross-billboards beyond.
- Crowd: one InstancedMesh of billboard quads with a canvas atlas of 16 silhouettes, tinted per instance, with a cheap bob animation in the vertex shader.
- Light poles and marshal posts are instanced.

### 7.12 Time of day and night lighting
- ÇEV provides a `LightingRig` per TOD (values in §8.10), plus Sky.js, a cloud dome (FBM shader, cover driven by weather) and the env scene used for PMREM.
- **Night floodlights** (cheap but convincing):
  - About 180 instanced 18 m poles, one every ~30 m on alternating sides, with emissive lamp heads and glow sprites so bloom picks them up.
  - A 2048² **floodlight lightmap** in world XZ (about 0.8 m per texel over 1.6 km), splatted on the CPU at load from Gaussian light pools around each pole. Ground-level materials (track, terrain, barriers, grandstands) sample it in an `onBeforeCompile` chunk.
  - Cars are lit by a steep cool-white key directional light with soft shadows, plus a night env scene containing bright emissive floodlight panels so paint reflects them.
  - Night sky: dark gradient, stars and a sodium-warm glow near the horizon.

### 7.13 Wet track look
`onBeforeCompile` uniforms: `uWet`, `uLineWet`, `uRain`, `uTime`, plus a 1D texture holding the racing-line d(s). Ribbon UV convention: u = s in metres, v = d in metres.

| Property | Change with wetness |
|---|---|
| Albedo | ×lerp(1, 0.55, w) |
| Roughness | → 0.35 wet; → 0.08 in puddles |
| Puddles | Noise mask in s/d, appearing at w > 0.65; flattened normal and animated ripple rings in rain |
| Racing line | Dries first (`uLineWet`) |
| Kerbs and lines | Get glossier |

At night or in rain, add stretched vertical light-streak billboards under lamps and the cars' rain lights (alpha ∝ wetness, within 300 m).

### 7.14 Environment budgets
These apply to the High preset; Ultra is ×1.3.

| Component | Triangles | Draw calls |
|---|---|---|
| Track ribbon | ≤ 220 k | ≤ 60 visible |
| Terrain | ≤ 250 k | ≤ 16 |
| Trees | ≤ 450 k | ≤ 8 |
| Grandstands + crowd | ≤ 250 k | ≤ 30 |
| Buildings + gantries + boards | ≤ 150 k | ≤ 30 |
| Barriers + fences | ≤ 200 k | ≤ 40 |
| **Environment total** | **≤ 1.5 M** | **≤ 200** |

Assets (CC0, preferably Poly Haven direct JPG links found via `api.polyhaven.com/files/<id>`): asphalt 2K (diffuse/normal/rough), grass, gravel, concrete and dirt at 1K. Each file ≤ 1.5 MB; total ≤ 12 MB.

### 7.15 Fallback geometry
World XZ in metres. Main loop: 127 points, closed, index 0 = S/F, in driving order, total length 5,349 m.
```
[0.0,0.0],[155.9,-29.5],[208.1,-41.5],[216.3,-44.3],[225.7,-49.9],[231.8,-59.1],[233.1,-70.8],[230.0,-86.1],[212.5,-145.8],[208.6,-164.4],[207.4,-185.2],[210.4,-218.3],[217.3,-240.7],[229.6,-261.8],[246.9,-280.4],[282.3,-305.7],[338.4,-336.7],[383.5,-356.2],[419.3,-367.8],[462.1,-378.1],[504.6,-385.0],[545.7,-388.0],[603.0,-387.7],[649.6,-383.3],[661.5,-383.9],[672.4,-386.5],[682.3,-390.5],[692.3,-396.1],[708.7,-411.3],[714.5,-419.5],[722.3,-436.6],[725.2,-456.7],[724.7,-467.2],[713.2,-540.7],[714.7,-551.7],[718.7,-557.4],[725.6,-560.4],[804.3,-557.2],[850.0,-557.6],[858.5,-559.6],[864.1,-562.5],[872.0,-570.7],[874.7,-576.6],[875.6,-588.3],[865.9,-645.3],[862.8,-656.0],[859.9,-660.8],[847.8,-673.9],[837.0,-680.7],[461.1,-869.0],[447.0,-879.0],[439.8,-887.5],[435.8,-895.1],[433.9,-902.8],[434.1,-912.1],[436.1,-920.4],[439.7,-927.4],[453.3,-942.0],[474.3,-954.9],[495.5,-962.7],[506.8,-965.0],[530.7,-965.7],[549.5,-963.4],[659.4,-941.2],[700.0,-931.5],[781.8,-909.3],[802.3,-906.0],[810.4,-906.9],[818.9,-909.8],[851.4,-927.7],[889.1,-946.4],[897.3,-951.9],[903.9,-958.4],[911.8,-973.2],[930.0,-1030.6],[931.8,-1047.1],[930.3,-1054.8],[924.0,-1069.1],[910.2,-1092.9],[888.7,-1122.8],[856.9,-1157.4],[831.1,-1179.3],[821.6,-1185.0],[811.6,-1188.6],[800.8,-1190.8],[775.2,-1190.9],[761.5,-1188.6],[267.0,-1042.9],[258.1,-1039.3],[251.7,-1035.1],[244.5,-1024.4],[243.0,-1018.0],[243.5,-1011.4],[258.4,-990.9],[271.8,-964.1],[277.2,-944.8],[275.4,-926.2],[186.8,-653.3],[139.9,-504.5],[132.3,-483.1],[123.2,-464.1],[107.9,-441.7],[99.1,-433.1],[85.4,-423.6],[-13.7,-366.4],[-179.2,-278.7],[-526.0,-91.5],[-535.7,-85.6],[-539.8,-80.8],[-544.2,-68.9],[-543.4,-58.1],[-537.7,-44.8],[-527.3,-35.3],[-516.0,-31.1],[-509.4,-30.5],[-466.7,-31.5],[-459.0,-28.1],[-453.1,-21.3],[-451.6,-17.8],[-451.4,-8.1],[-464.4,67.3],[-465.0,76.1],[-463.4,81.2],[-460.4,85.4],[-455.7,88.5],[-449.9,90.3],[-441.3,90.1]
```
Pit lane: 20 points, from the split to the merge.
```
[-451.6,-17.8],[-438.5,58.4],[-432.1,66.9],[-426.8,69.7],[-417.0,70.9],[139.5,-41.1],[154.0,-45.0],[178.5,-53.3],[187.4,-57.6],[195.9,-63.7],[203.3,-72.1],[211.7,-89.1],[213.4,-99.7],[212.8,-109.8],[200.3,-165.1],[198.8,-185.8],[199.4,-195.7],[201.8,-206.8],[205.0,-215.7],[213.6,-231.2]
```

*(Continued in the next message: §8 Rendering through §16 Risks, then Critical Files.)*