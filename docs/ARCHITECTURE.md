# APEX GP: Architecture

> Owner: Planner. Binding for every role. Order of precedence: `docs/sprints/PLAN.md` > `docs/sprints/TEAM-RULES.md` > `src/contracts/*.ts` (as written by the Lead) > this file > `docs/design/planner-report.md`.
> This file turns planner-report §3 into a working reference and adds what the report lost. Detailed specs live in `docs/design/{rendering,ui-hud,audio,rules,pit-weather,testing-qc}.md`.

---

## 1. Layers and dependency rules

### 1.1 Layers

| Layer | Folders | May use | Must not use |
|---|---|---|---|
| **Contracts** | `src/contracts/**` | `import type` from `three`; `frames.ts` helpers; `SIM_HZ`, `SIM_DT` | any runtime code beyond `frames.ts` and the two constants |
| **Sim** | `src/physics/**`, `src/ai/**`, `src/race/**`, `src/game/sim/**`, `src/track/{data,build,query,authoring,stub}/**`, `src/core/math/**`, `src/core/rng.ts`, `src/data/**` | contracts, other sim folders, plain TS | `three`, `postprocessing`, `n8ao`, `gsap`, DOM/BOM globals (`window`, `document`, `localStorage`, `performance`, `requestAnimationFrame`), `Math.random`, `Date.now`, WebAudio |
| **Presentation** | `src/graphics/**`, `src/trailer/**`, `src/ui/**`, `src/audio/**`, `src/track/{mesh,scenery,terrain,sky}/**` | contracts, `three`, `postprocessing`, `n8ao`, DOM, WebAudio, `gsap` (only `src/ui/**` and `src/trailer/**`), read-only sim types | writing to `SimState`; importing `src/game/**` or `src/core/**` implementations (they receive services through their `init`/`mount` arguments) |
| **Glue** | `src/main.ts`, `src/core/**` (except `math`, `rng.ts`), `src/game/**` (except `game/sim`), `src/sandbox/**` | everything | sim-state writes during `step()` (see §4.3) |

Further rules:
- `lil-gui` may be imported only from files under `**/sandbox/**`.
- Cross-module imports go through the target module's `index.ts`. Deep imports (`src/physics/tyre/x.ts` from `src/ai`) are allowed only between modules of the **same owner** (for example `src/ai` → `src/physics/tyre/wetTable.ts`).
- Sandbox scenes (`src/<module>/sandbox/*.scene.ts`) may import any module's `index.ts`. They are never imported by game code.
- `src/data/teams.ts` is pure data (no imports except contract types). Sim and presentation may both read it.
- Sim code reads time only from `state.time` / `state.tick`, and randomness only from the RNG words stored in `SimState` (`state.rng.race`, `state.rng.weather`, `car.ai.rng`) through `src/core/rng.ts`.

### 1.2 Enforcement
`tests/arch/architecture.test.ts` (Testçi) scans every `.ts` file under `src/` with a regex import parser and fails on:
1. a sim file importing `three`, `postprocessing`, `n8ao`, `gsap`, `lil-gui` or any presentation/glue folder;
2. a sim file containing the tokens `Math.random`, `Date.now`, `performance.now`, `window.`, `document.`, `localStorage`;
3. `gsap` imported outside `src/ui/**` and `src/trailer/**`; `lil-gui` outside `**/sandbox/**`;
4. any import of `src/contracts/**` that is not `import type`, except from `frames.ts` and `sim.ts` (constants);
5. any file outside `src/contracts/` declaring an interface whose name collides with a contract interface (prevents shadow copies).

---

## 2. Module map and owners

Ownership follows TEAM-RULES §1 and PLAN Ek A. "Stub" means the Lead placed a Sprint 0 stub (`index.ts` + `stub/`) that the owner replaces in Sprint 1.

```
src/
├─ main.ts                         YÖN  boot: parse LaunchParams → AppState machine → sandbox | title | autostart
├─ contracts/                      YÖN  19 files, the only shared types (§4 of the report, plus approved additions)
├─ core/                           YÖN
│  ├─ loop.ts                           fixed-step loop, accumulator, alpha (§3)
│  ├─ eventBus.ts, appState.ts          EventBus<EventMap>, AppStateId machine
│  ├─ math/, rng.ts                     SIM LAYER: scalar/vec helpers, mulberry32 on numbers stored in state
│  ├─ input/InputManager.ts             KeyboardEvent.code → ActionId per InputContext; per-tick edge latch; KeyBindingsApi
│  ├─ settings/SettingsStore.ts         localStorage, debounce 500 ms, migrations
│  ├─ i18n/                             I18n service, namespace discovery
│  ├─ assets/AssetLoader.ts             ref-counted textures, fonts, progress, warmup (compileAsync)
│  ├─ debug/                            window.__APEX__, PerfMonitor, F8 overlay
│  └─ launchParams.ts                   URL → LaunchParams
├─ game/                           YÖN
│  ├─ createSim.ts                      canonical world factory (game AND tests)
│  ├─ modules.check.ts                  compile-time check of every index.ts against contracts/modules.ts
│  ├─ sim/                              SIM LAYER: latchControls.ts, snapshotSystem.ts, teleport.ts
│  ├─ session/SessionController.ts      load → start → run → end; owns the composition below
│  ├─ renderFrame.ts                    RenderFrame builder (pose double buffer, interpolation, derived visual fields)
│  ├─ hud/HudPresenter.ts               SimState + events → HudModel at 30 Hz; notification queue
│  ├─ flashback/FlashbackController.ts  open / scrub / apply / cancel over SnapshotHistory
│  ├─ ghost/                            TT ghost record (per lap) and playback
│  └─ replay/                           60 Hz ReplayRecorder / ReplayPlayer (trailer input, Sprint 2)
├─ race/                           YÖN  SIM LAYER: raceDirector/, pit/, conditions/, weatherTimeline.ts, classification.ts, points.ts
├─ data/teams.ts                   YÖN  10 fictional teams and 20 drivers
├─ sandbox/router.ts               YÖN  import.meta.glob('/src/**/sandbox/*.scene.ts')
├─ track/                          ÇEV  (stub: oval + straight)
│  ├─ data/, authoring/, build/, query/   SIM LAYER: raw JSON, authoring table, buildTrackData, TrackQuery
│  ├─ mesh/, scenery/, terrain/, sky/     PRESENTATION: ribbon, kerbs, walls, stands, crowd, trees, sky, LightingRig per TOD, floodlights, wet shader
│  └─ index.ts                            loadTrack(), createStraightTrack(m), buildEnvironment
├─ physics/                        SÜR  SIM LAYER (stub): vehicle/, tyre/, aero/, powertrain/, assists/, input/ (keyboardFilter.ts), collision/
├─ ai/                             SÜR  SIM LAYER (stub): line/, profile/, controller/, racecraft/, strategy/
├─ audio/                          SÜR  PRESENTATION (stub): engine/, tyres/, ambience/, ui/, mixer.ts, offline.ts
├─ graphics/                       GRA-3B PRESENTATION (stub): renderer/, post/, materials/, car/, vfx/, camera/, racingLine/, presets.ts
├─ trailer/                        GRA-3B PRESENTATION (Sprint 5b)
└─ ui/                             GRA-UI PRESENTATION (stub): screens/, hud/, styles/, motion/, format.ts
   (every module: index.ts, __tests__/, sandbox/*.scene.ts, i18n/*.{tr,en}.ts)
tests/{arch,sim,integration,e2e,perf,leak,visual,helpers}/   TEST
scripts/  shot.mjs (YÖN) · fetch-track.mjs (ÇEV) · perf.mjs (TEST) · render-trailer.mjs, trailer-audio.mjs (GRA)
public/assets/{env,gra,sur}/       per-role assets + CREDITS.part.md
```

---

## 3. Loop and timestep

`src/core/loop.ts` (YÖN). Driven by `renderer.setAnimationLoop`. In sandbox scenes without a renderer, by `requestAnimationFrame`.

| Constant | Value |
|---|---|
| `SIM_HZ` / `SIM_DT` | 240 / (1/240) s |
| Wheel-spin substeps | 4 per tick (960 Hz), inside VehicleSystem |
| Max ticks per frame | 12. On hitting the cap, the accumulator is set to 0 and `PerfStats.simOverrun` += 1 (the game slows instead of spiralling) |
| `frameDt` clamp | `clamp(rawDt, 0, 0.1)` s |
| Time scale | `LaunchParams.timescale` × debug `setTimeScale` (default 1) |

### 3.1 Frame order (glue, every animation frame)
1. `frameDt = clamp(dt, 0, 0.1)`; `perf.beginFrame()`.
2. `input.pollFrame()`: collects key edges since last frame (InputManager keeps them in per-action counters).
3. If a session runs and the UI sub-state is `driving`: `acc += frameDt·timeScale`. While `acc ≥ SIM_DT && n < 12`:
   1. `poseBuffer.savePrevious()` (copy x, y, z, yaw, pitch, roll, heave, steer, wheel spin of every car into the *previous* slot; preallocated `Float64Array`),
   2. `latchControls(world, input)`: writes the player car's `controls` (§4.3),
   3. `runner.step()` (runs §4 systems in order; `state.tick++`, `state.time += SIM_DT`),
   4. `ghostRecorder.sample()` / `replayRecorder.sample()` when `tick % 4 === 0` (60 Hz; read-only),
   5. `acc -= SIM_DT; n++`.
4. `world.events.drain(e => bus.emit('sim', e))`: all ticks' events, in emission order.
5. `alpha = acc / SIM_DT`. `renderFrame.build(world, alpha, out)` interpolates previous/current poses without allocating (angles by shortest path through `wrapAngle`) and fills derived visual fields (§5.3).
6. Presentation update: `cameraRig.update(frame, frameDt)` → `env.update(cam, frame, frameDt)` → `carVisuals.update(frame, cam)` → `vfx.update(frame, cam, frameDt)` → `racingLine.update(frame)`.
7. `audio.update(frame, cameraRig.getListener(listener), frameDt)`.
8. Every 1/30 s of wall time: `hudPresenter.build(world, model)` → `ui.updateHud(model)`.
9. `graphics.render(frame)`; `perf.endFrame(graphics.getPerf())`.

When paused (`paused`, `flashback`, `finished` sub-states) steps 3 and 4 are skipped; steps 5–9 still run (with `frame.paused = true`), so the picture, menus and audio fades stay live.

### 3.2 Sub-rates inside the 240 Hz tick

| Work | Rate | Rule |
|---|---|---|
| Conditions | 10 Hz | `tick % 24 === 0` |
| AI controllers | 60 Hz staggered | car *i* runs when `(tick + i) % 4 === 0`; between runs the car keeps its last `input` |
| Tyre thermal/wear, slipstream, fuel, brake temps, sparks, visual pitch/roll/heave | 60 Hz | `tick % 4 === 0`, with `dt = 4·SIM_DT` |
| Standings, gaps, flags | 60 Hz | `tick % 4 === 2` |
| Line crossings (finish, sectors, DRS, speed trap, pit lines) | 240 Hz | sub-tick interpolated crossing time |
| Snapshots (flashback) | 10 Hz | `tick % 24 === 0`, ring of 150 entries (15 s), outside `SimState` |
| Ghost / replay sampling | 60 Hz | glue, after `step()` when `tick % 4 === 0` |

### 3.3 Pause and focus
- `visibilitychange` (hidden) or `blur` during a session → `UiAction resume` is not dispatched; the session enters `paused` and the pause screen shows. Override with `?autopause=0`; default is on unless `navigator.webdriver` is true (Playwright).
- While paused, `acc` is reset to 0 so resuming never fast-forwards.

---

## 4. Sim systems, order and the single-writer rule

### 4.1 Order per tick

| # | System (owner) | Factory | Writes | Reads (main) |
|---|---|---|---|---|
| 1 | ConditionsSystem (YÖN) | `createConditionsSystem()` | `state.conditions`, `state.rng.weather` | timeline, cars (traffic for line drying) |
| 2 | PlayerInputSystem (SÜR) | `createPlayerInputSystem()` | player `car.input`, player `car.kb` | `car.controls`, `config.assists`, vehicle speed, conditions |
| 3 | AISystem (SÜR) | `createAISystem(ai)` | `car.input` and `car.ai` of every car whose `control` is `'ai'` or `'pitAuto'` | everything |
| 4 | VehicleSystem (SÜR) | `createVehicleSystem()` | `car.vehicle` (all fields, incl. ERS lap counters reset on its own lap-wrap detection) | `car.input`, track, conditions, `race.phase` |
| 5 | CollisionSystem (SÜR) | `createCollisionSystem()` | `car.vehicle` pose/velocity corrections, `wallImpulse`, `carImpulse`, `resetCount`; `collision`/`carReset` events | vehicles, walls, `race.order` |
| 6 | RaceDirector + PitProcedure (YÖN) | `createRaceDirector()` | `car.race`, `car.pit`, `car.control` (switches to/from `'pitAuto'`), `state.race`, `state.rng.race`; race events | vehicles, `car.controls` (player pit request), `car.ai` (AI pit plan) |
| 7 | SnapshotSystem (YÖN) | internal to `createSim` | the SnapshotHistory ring (outside `state`) | whole `state` |

### 4.2 Rules
- A system may read any field but writes only the fields listed in its row. QC checks this by `grep` in code review; Testçi's `tests/sim/single-writer.test.ts` deep-freezes foreign sub-objects in a debug build of each system and runs 600 ticks.
- No module-level mutable state in sim code. Systems keep only caches derived from `world.static` (built in the factory or lazily on first `step`).
- No allocation inside `step()`: no object/array literals, closures, `map`/`filter`, string building, or `structuredClone`. Scratch objects live at module scope as `const` and are reset before use.
- All per-car randomness uses `car.ai.rng`; race-wide randomness `state.rng.race`; weather `state.rng.weather`. Each is a 32-bit integer advanced by `src/core/rng.ts`.

### 4.3 Writers outside `step()` (glue, YÖN only, between ticks)

| Writer | File | Writes | When |
|---|---|---|---|
| Control latch | `src/game/sim/latchControls.ts` | player `car.controls` | before every tick |
| Flashback | `src/game/flashback/FlashbackController.ts` | whole `state` via `runner.restore`, then re-applies `race.flashbacksLeft` and (TT) `car.race.lapValid = false` | on apply (rules.md §10) |
| Teleport | `src/game/sim/teleport.ts` | `car.vehicle` via physics `initVehicleState`, `car.race.progress` | debug API / screenshot points |
| Debug conditions | `src/core/debug` → `race/conditions` helper | `state.conditions` | `__APEX__.setConditions` |
| Autodrive switch | `src/core/debug` | player `car.control` (`'player'` ⇄ `'ai'`) | `__APEX__.setAutodrive`, `?autodrive=1` |

---

## 5. Data flow

```
Keyboard ──KeyboardEvent.code──► InputManager (context: menu | driving | flashback | rebind)
   │                                  │ menu/flashback actions            │ driving edges + held state
   ▼                                  ▼                                    ▼
 UI (MenuInputSource)          FlashbackController                latchControls → car.controls (DriverControls)
                                                                          │
                     ┌───────────────── SimRunner.step() at 240 Hz ───────┴─────────────────────┐
                     │ Conditions → PlayerInput(kb filter) → AI → Vehicle → Collision → Race+Pit │
                     └───────────────┬─────────────────────────────────────┬────────────────────┘
                                     │ SimState (plain data)               │ world.events (pooled)
                                     ▼                                     ▼
                       renderFrame.build(alpha) ──► RenderFrame     bus.emit('sim', e)
                                     │                                     │
         ┌───────────────┬───────────┼──────────────┬──────────────┐       ├─► HudPresenter (notifications)
         ▼               ▼           ▼              ▼              ▼       ├─► AudioSystem.onSimEvent
     CameraRig     Environment   CarVisuals        Vfx       RacingLineVisual├─► VfxSystem.onSimEvent
         │ ListenerPose                                                     └─► Ghost/Replay recorders
         ▼
     AudioSystem.update(frame, listener)      HudPresenter (30 Hz) ─► HudModel ─► UiSystem.updateHud
                                    GraphicsSystem.render(frame)
```

### 5.1 Input
- Bindings use `KeyboardEvent.code`. Ctrl/Alt/Meta chords are never bound; `KeyBindingsApi.setBinding` rejects them with `reason: 'modifier'`. Reserved codes: `F5`, `F11`, `F12`, `Tab` in browser-reserved contexts are allowed only where listed in PLAN Ek D.
- Every handled driving key calls `preventDefault()` (also Space, arrows, Tab, Backspace).
- Edges are latched per tick: a press between two ticks produces exactly one `*Pressed = true` tick; a press-release inside one frame still produces one tick of `true`.

### 5.2 Sim → presentation
- Presentation never reads `SimState` directly except through `RenderFrame`, `HudModel`, `SimEvent` and the debug API. Exception: `RacingLineVisual` receives `RacingLine`/`SpeedProfile` objects (read-only, created once by AI `prepare`).
- `RenderFrame` and `HudModel` are single long-lived objects owned by the glue and mutated in place each frame. Consumers must not keep references to nested arrays across frames unless documented (they are stable objects, refilled in place).

### 5.3 Fields derived by the RenderFrame builder (`src/game/renderFrame.ts`)

| Field | Rule |
|---|---|
| `fx..uz` | from interpolated yaw, pitch, roll and the ground normal |
| `brakeGlow[i]` | `clamp((wheels[i].brakeTempC − 550) / 450, 0, 1)` |
| `rainLight` | `2` (flash) when `vehicle.pitLimiterOn` or (`ers.harvestKw > 100` and `input.throttle > 0.9`); else `1` when `conditions.wetness > 0.15` or `conditions.rain > 0.1`; else `0` |
| `slip[i]` | combined normalised slip σ of wheel *i* (1 = peak grip), from slip ratio and slip angle with the compound peaks |
| `sparks` | `vehicle.sparks` (0..1) |
| `inPitBox` | `pit.phase === 'stationary'` |
| `tcam` | from the driver's `DriverDef.tcam` |
| ghost | TT ghost appended as one extra `CarRenderState` with `id = 100`, `isGhost = true`, `ghostAlpha` 0.45 (fades to 0 within 8 m of the camera) |

### 5.4 Lighting hand-off (ÇEV → GRA)
- `buildEnvironment` returns `EnvironmentHandle` whose `rig` is a **live object**: `applyConditions()` mutates it in place (rendering.md §5.4).
- SessionController calls `graphics.setLighting(env.rig, env.envScene)` once after load, and again whenever `|Δcloud| ≥ 0.1` or `|Δrain| ≥ 0.1` since the last call, at most once per 2 s. That call regenerates PMREM. Per-frame values (exposure, bloom, fog) are re-read from the same `rig` object every frame by GRA.
- ÇEV owns the sun `DirectionalLight` and fits its shadow camera each frame in `env.update()` using `quality.shadowExtent/shadowSize/shadowRadius` (rendering.md §3).

---

## 6. Sim events and the EventMap

Sim events are pushed by systems into `world.events`, a **pooled** queue: `push(e)` copies the fields into a preallocated object of that type (per-type pools of 64, grown only at load). Handlers must copy anything they keep. Events are re-emitted on the bus as `'sim'`.

### 6.1 SimEvent catalogue

| `type` | Emitter | Consumers | Notes |
|---|---|---|---|
| `lightsOn {count}` | RaceDirector | HUD start lights, audio beep, env gantry | count 1..5, one per second |
| `lightsOut` | RaceDirector | HUD, audio crowd roar, AI start | after random hold 0.2–3.0 s |
| `jumpStart {car}` | RaceDirector | HUD notification | always followed by `penalty` |
| `sector {car, sector, ms, status}` | RaceDirector | HUD sector flash, ghost | `sector` = index of the sector just completed |
| `lap {car, lap, ms, valid}` | RaceDirector | HUD, ghost (TT PB save), results | `lap` = laps completed |
| `fastestLap {car, ms}` | RaceDirector | HUD tower badge, notification | session fastest lap |
| `position {car, from, to}` | RaceDirector | tower Flip animation, audio crowd | emitted at the 60 Hz standings update |
| `trackLimits {car, count}` | RaceDirector | HUD warning 1/3..3/3 | rules.md §3 |
| `penalty {car, seconds, reason}` | RaceDirector / Pit | HUD, tower badge | rules.md §4 |
| `drsEnabled` / `drsDisabled` | RaceDirector | HUD DRS state, notification | enabled when the leader starts lap 3; disabled in the wet (rules.md §6) |
| `drsAvailable {car, zone}` | RaceDirector | HUD DRS "available", audio tick | at the activation line when eligible |
| `pit {car, phase}` | PitProcedure | HUD pit panel, tower "PIT", VFX pit crew (S2) | every phase change |
| `collision {a, b, impulse, x, y, z}` | CollisionSystem | VFX sparks/debris, audio impact, camera shake | `b = -1` for walls |
| `gear {car, gear}` | VehicleSystem | audio upshift cut / downshift blip, HUD | every shift |
| `kerb {car, wheel, sausage}` | VehicleSystem | audio thump, camera shake | on kerb entry per wheel, ≥ 0.15 s apart per wheel |
| `flag {flag, sector, car}` | RaceDirector | HUD flags, env marshal panels | `car = -1` for sector-wide flags |
| `finish {car, position}` | RaceDirector | HUD, results, camera switch to TV | |
| `weather {rain, msg}` | ConditionsSystem | HUD notification, audio rain bed | pit-weather.md §5 |
| `carReset {car}` | CollisionSystem | HUD notification, VFX fade-in | car is non-colliding for 3 s |

### 6.2 EventMap (app bus)

| Event | Emitted by | Consumed by |
|---|---|---|
| `app:state {from,to}` | appState | UI screen routing, audio fades, debug |
| `settings:changed {path}` | SettingsStore | graphics (`graphics.*`), audio (`audio.*`), input (`controls.*`), UI (`hud.*`, `ui.*`), i18n (`lang`) |
| `lang:changed {lang}` | I18n | UI re-render, `<html lang>` |
| `session:loading {progress, stage}` | SessionController | loading screen |
| `session:started {mode}` / `session:ended {reason}` | SessionController | UI, audio, perf reset, leak checks |
| `sim` | loop (drain) | see §6.1 |
| `camera:changed {id}` | CameraRig owner (glue) | HUD (cockpit hides duplicate info), audio interior/exterior |
| `hud:mode {mode}` | glue (H key) | UI |
| `racingLine:mode {mode}` | glue (Y key) | RacingLineVisual, UI toast |
| `mfd:changed {open,page}` | glue (Tab, 1–4) | UI |
| `flashback:open {left}` / `flashback:applied {toTime,left}` / `flashback:cancel` | FlashbackController | UI, audio, VFX reset |
| `notify {key, params, level, ms}` | HudPresenter and any glue code | UI notification strip (via HudModel), audio UI sound |
| `audio:unlocked` | AudioSystem | title screen |
| `quality:changed {id}` | glue | graphics, environment, VFX |

---

## 7. Module factory map

Every owner exports exactly these names from `src/<module>/index.ts` (`src/contracts/modules.ts`; checked at compile time by `src/game/modules.check.ts`).

| Module (owner) | Exports | Consumed by |
|---|---|---|
| `track` (ÇEV) | `loadTrack(): TrackBundle` (sync, baked JSON) · `createStraightTrack(lengthM)` · `buildEnvironment` | `createSim`, physics benches, SessionController |
| `physics` (SÜR) | `createPlayerInputSystem()`, `createVehicleSystem()`, `createCollisionSystem()`, `defaultVehicleParams(teamPerf)`, `initVehicleState(p, t, slot, c)` | `createSim`, teleport |
| `ai` (SÜR) | `createAIModule()`, `createAISystem(ai)` | `createSim` |
| `race` (YÖN) | `createRaceDirector()`, `createConditionsSystem()`, `generateWeatherTimeline(p, seed, durationS)` (+ `forecast`, CR-10) | `createSim`, HudPresenter, AI strategy |
| `game` (YÖN) | `createSim(cfg, opts?)` | SessionController, every sim/integration test |
| `graphics` (GRA-3B) | `createGraphicsSystem()`, `createCarVisuals()`, `createCameraRig(ctx)`, `createVfx()`, `createRacingLineVisual()`, `QUALITY_PRESETS` | SessionController, sandbox scenes |
| `ui` (GRA-UI) | `createUi()` | `main.ts` |
| `audio` (SÜR) | `createAudioSystem()` (+ offline renderer, CR-08) | `main.ts`, trailer |

`createSim(cfg, opts)` composition (YÖN): track = `opts.track ?? loadTrack()`; params = `defaultVehicleParams(team.perf)` per car (perf 0 in TT); `ai.prepare(track.query, params)`; vehicle states from `initVehicleState` at `track.data.grid[k]`; systems in §4.1 order; `SnapshotHistory` of 150 entries.

**Stub policy (D-016).** Sprint 0 stubs live in `src/track/stub/*`, `src/physics/stub/*`, `src/ai/stub/*`, `src/audio/stub/*`, `src/graphics/stub/*`, `src/ui/stub/*`; each module `index.ts` exports `MODULE_STATUS: 'stub' | 'real'` (`ModuleStatusExport`). The owner replaces the stub behind the same `index.ts` exports, deletes the stub files it no longer needs, and flips `MODULE_STATUS` to `'real'` when its acceptance tests pass. Other roles and tests read `MODULE_STATUS` to decide whether to use the real module (sprint-1.md hand-offs). The track keeps its oval and straight test tracks (`TrackId` `'oval'`, `'straight'`, D-011).

---

## 8. Sandbox scene registry

Discovery: `import.meta.glob('/src/**/sandbox/*.scene.ts')` in `src/sandbox/router.ts`. Each file default-exports a `SandboxScene` whose `id` equals the file name without `.scene.ts`. Ids are kebab-case and unique; the router throws on duplicates. `__APEX__.sceneReady` turns true after the scene's first rendered frame.

| `?scene=` | Owner (port) | File | Sprint | Content |
|---|---|---|---|---|
| `skeleton` | YÖN (5173) | `src/game/sandbox/skeleton.scene.ts` (D-017) | 0 | Placeholder oval, kinematic box car |
| `race-logic` | YÖN (5173) | `src/race/sandbox/race-logic.scene.ts` | 2 | Headless RaceDirector, cars as dots on a 2D map, timing table, flags, pit phases |
| `weather` | YÖN (5173) | `src/race/sandbox/weather.scene.ts` | 2 | Timeline plot for a seed: rain, wetness, line wetness, forecast entries |
| `track-data` | ÇEV (5174) | `src/track/sandbox/track-data.scene.ts` | 1 | 2D plot: edges, bands, kerbs, walls, sectors, DRS, cut zones, pit, grid, corner numbers |
| `track` | ÇEV (5174) | `src/track/sandbox/track.scene.ts` | 1–2 | Full environment; orbit / free-fly / drive-along cams; GUI for TOD, rain, wetness, quality |
| `car` | GRA-3B (5175) | `src/graphics/sandbox/car.scene.ts` | 1 | Showroom turntable; livery and LOD browser; 20-car grid; wheel/steer/DRS animation sliders |
| `cameras` | GRA-3B (5175) | `src/graphics/sandbox/cameras.scene.ts` | 1 | Car on a scripted loop of the track; cycles the 5 driving cams + TV; speed FOV, shake, look-back |
| `vfx` | GRA-3B (5175) | `src/graphics/sandbox/vfx.scene.ts` | 1–2 | Smoke, sparks, dust, skid marks, rain streaks, spray, rooster tail; counters per preset |
| `post` | GRA-3B (5175) | `src/graphics/sandbox/post.scene.ts` | 1 | Post chain A/B per effect and per preset; LUT per TOD; exposure; lens droplets |
| `showroom` | GRA-3B (5175) | `src/graphics/sandbox/showroom.scene.ts` | 2 | Main-menu 3D background exactly as used by the menu |
| `trailer` | GRA-3B (5175) | `src/trailer/sandbox/trailer.scene.ts` | 5b | `window.seek(t)` deterministic trailer |
| `hud` | GRA-UI (5179) | `src/ui/sandbox/hud.scene.ts` | 2 | HUD driven by an animated mock HudModel; `&stress=1` fires 10 notifications/s |
| `menu` | GRA-UI (5179) | `src/ui/sandbox/menu.scene.ts` | 2 | Every screen with mock stores; `&screen=<ScreenId>` opens one directly |
| `physics` | SÜR (5176) | `src/physics/sandbox/physics.scene.ts` | 1 | One drivable car, telemetry plots, lil-gui parameters; `&track=oval\|straight\|istanbul` |
| `ai` | SÜR (5176) | `src/ai/sandbox/ai.scene.ts` | 1 | 20 AI box cars, racing line and speed-profile overlay |
| `audio` | SÜR (5176) | `src/audio/sandbox/audio.scene.ts` | 1 | Engine synth bench (rpm/throttle sliders, sweep), event triggers, bus meters |

Common sandbox URL extras (parsed by the router, passed in `params`): `t` (seconds), `freeze=1` (no time advance after `t`; deterministic shots), `cam`, `quality`, `tod`, `weather`, `seed`, `lang`.

---

## 9. URL parameters and `window.__APEX__`

### 9.1 `LaunchParams` (`src/core/launchParams.ts`, parsed once)

| Param | Values (default) | Effect |
|---|---|---|
| `scene` | sandbox id (none) | boots straight into `sandbox` |
| `mode` | `menu` \| `tt` \| `race` (`menu`) | which session `autostart` builds |
| `autostart` | `1` | `boot → loading → session`, skipping title and menus |
| `autodrive` | `1` | player car `control = 'ai'`, AI mode `perfect`, d = 100 |
| `weather` | `dry` \| `light` \| `heavy` \| `variable` | overrides setup |
| `tod` | `day` \| `sunset` \| `night` | overrides setup |
| `laps` | 3 \| 5 \| 10 \| 15 \| 29 | |
| `ai` | 0–19 (19) | opponent count |
| `difficulty` | 0–110 (70) | |
| `quality` | `low` \| `medium` \| `high` \| `ultra` | overrides settings for this run (not saved) |
| `seed` | int (random from `crypto.getRandomValues` at boot, logged) | session seed |
| `cam` | `cockpit` \| `tcam` \| `nose` \| `chaseNear` \| `chaseFar` \| `orbit` \| `free` | initial camera |
| `lang` | `tr` \| `en` | overrides settings for this run |
| `team` | team id | player team |
| `tyre` | compound | start compound |
| `grid` | 1–20 | player grid slot |
| `skipLights` | `1` | race starts in `running` |
| `timescale` | number (1) | |
| `freeze` | `1` | sandbox only: stop time after `t` |
| `mute` | `1` | master gain 0 |
| `debug` | `1` | F8 overlay on at start |
| `nopost` | `1` | post chain bypassed (render → tone map only) |
| `s` | metres | teleport the player car to this main-track s at start (d = 0, 60 km/h unless `skipLights=0`) |
| `t` | seconds | sandbox time to fast-forward to |
| `autopause` | `0` \| `1` | override visibility auto-pause |

### 9.2 `ApexDebugApi` (`src/contracts/debug.ts`)
Always present (production too). Semantics that tests rely on:
- `ready` true after boot; `whenReady('sceneReady')` resolves after the first rendered frame of the current view.
- `startSession(cfg)` goes through `loading` (incl. `compileAsync` warmup) and resolves when the first session frame is rendered. `cfg.skipLights` maps to `CreateSimOptions.skipLights`.
- `step(ticks)` works only while paused; it runs exactly `ticks` sim ticks and one render.
- `teleport(car, s, d, kmh)` places the car on the main ribbon facing the driving direction with `vLong = kmh/3.6`.
- `input.press(action, ms)` injects through InputManager exactly like a key (same latching). Without `ms` it holds until `release`.
- `getPerf()` returns `PerfStats` since the last `resetPerf()`.
- `hashState()` is `SimRunner.hash()` of the running session (null outside sessions).
- `errors` collects `console.error`, `window.onerror` and `unhandledrejection` messages. Every E2E test asserts it is empty.

---

## 10. Settings and i18n

### 10.1 Persistence

| Key | Content | Writer |
|---|---|---|
| `apexgp:v1:settings` | `Settings` | SettingsStore (debounced 500 ms, try/catch, versioned migrations `migrate(raw): Settings`) |
| `apexgp:v1:lastRaceSetup` | last `SessionConfig` used for a race (seed excluded) | SessionController |
| `apexgp:v1:tt:istanbul` | `{ pbMs, pbSectors, bestSectors, ghost (Float32 → base64, ≈75 KB), top10, tod }` | Ghost/TT code |
| `apexgp:v1:rivalGhost:<buildHash>` | baked rival ghost (perfect AI lap) cache | Ghost code |

Corrupt or unknown-version data is discarded with one `console.warn` (never `console.error`).

### 10.2 Settings defaults

| Path | Default | Range / options |
|---|---|---|
| `lang` | `tr` | `tr`, `en` |
| `graphics.preset` | `high` | `low`…`ultra`, `custom` |
| `graphics.custom` | `{}` | any `QualityPreset` subset (ui-hud.md §7) |
| `graphics.fovOffset` | 0 | −10…+10°, step 1 |
| `graphics.showFps` | false | |
| `graphics.cameraShake` | 0.6 (0 when `prefers-reduced-motion` on first run) | 0…1, step 0.1 |
| `graphics.motionEffects` | true (false when reduced motion on first run) | speed FOV, chromatic aberration, head motion |
| `audio.master/engine/sfx/ambience/ui` | 0.8 / 0.9 / 0.8 / 0.6 / 0.6 | 0…1, step 0.05 |
| `controls.layout` | `combined` | `combined`, `wasd`, `arrows` |
| `controls.bindings` | PLAN Ek D (table below) | ≤ 2 codes per action |
| `controls.steerSensitivity` | 1.0 | 0.5…1.5, step 0.05 |
| `assists` | Intermediate preset (GDD §6) | |
| `hud.mode` / `hud.minimap` / `hud.units` / `hud.scale` | `full` / true / `kmh` / 1.0 (1.1 when the viewport height is below 900 px, D-004; an explicit user value always wins) | scale 0.8…1.25, step 0.05 |
| `camera.default` | `chaseNear` | 5 driving cams |
| `gameplay.difficulty` / `gameplay.flashbacks` | 70 / 5 | 0…110 / 0, 3, 5, −1 (∞) |
| `ui.animations` | `auto` | `auto` (follows `prefers-reduced-motion`), `on`, `off` |

Default bindings (`KeyboardEvent.code`): throttle `KeyW`,`ArrowUp` · brake `KeyS`,`ArrowDown` · steerLeft `KeyA`,`ArrowLeft` · steerRight `KeyD`,`ArrowRight` · gearUp `KeyE` · gearDown `KeyQ` · drs `Space` · ersOvertake `KeyF` · pitLimiter `KeyL` · cameraNext `KeyC` · lookBack `KeyV` · flashback `KeyR` · pause `Escape`,`KeyP` · mfdNext `Tab` · mfd1–4 `Digit1`–`Digit4` · racingLine `KeyY` · hudCycle `KeyH` · restartLap `Backspace` · debugOverlay `F8` · menuUp `ArrowUp`,`KeyW` · menuDown `ArrowDown`,`KeyS` · menuLeft `ArrowLeft`,`KeyA` · menuRight `ArrowRight`,`KeyD` · menuConfirm `Enter`,`Space` · menuBack `Escape`,`Backspace`. Layout `wasd` drops the arrow codes from driving actions; `arrows` drops the letter codes.

### 10.3 i18n
- Dictionaries: `src/<module>/i18n/<namespace>.{tr,en}.ts`, each `export default` a nested object. Namespace = file stem. Key = `<namespace>.<path>` (for example `notify.trackLimits.warning`).
- Track names are pre-composed upper-case strings per language (`İSTANBUL CIRCUIT` / `ISTANBUL CIRCUIT`, D-003); team names render with `lang="en"` (D-008); driver names take `lang` from `DriverDef.nat`.
- Namespaces and owners: `common`, `errors` (YÖN, `src/core/i18n/`); `notify` (YÖN, `src/game/hud/i18n/`); `menu`, `settings`, `hud`, `results`, `tt`, `loading`, `credits` (GRA-UI, `src/ui/i18n/`).
- `t(key, params)` substitutes `{name}`; falls back to TR, then to the key itself (and records a `console.warn` once per missing key in dev).
- Parity test: identical key sets and identical `{param}` names in TR and EN for every namespace.
- Case: never store upper-case copies. Upper-case with CSS `text-transform: uppercase` under the correct `<html lang>` or `toLocaleUpperCase('tr-TR')` / `('en-GB')` in `src/ui/format.ts` (`i` → `İ`, `ı` → `I`).
- Numbers: lap/sector/gap times always `m:ss.mmm` / `ss.mmm` with a full stop in both languages (broadcast convention). Other decimals use `Intl.NumberFormat(lang)` (TR: `57,5`). Units: `km/sa` (TR) / `km/h` (EN), `°C`.

---

## 11. Coding standards
- TypeScript strict (`strict`, `noImplicitOverride`, `noFallthroughCasesInSwitch`, `useUnknownInCatchVariables`). No `any`; use `unknown` and narrow. No `@ts-ignore`; `@ts-expect-error` only in tests with a reason.
- Files: modules `camelCase.ts`, classes `PascalCase.ts`, factories `createX()`. Named exports only, except `*.scene.ts` and i18n dictionaries (default export).
- Identifiers and comments in English. UI strings only through `t()`.
- **Hot loops** (sim `step`, any per-frame `update`, audio `update`, HUD `updateHud`): no allocation, no closures, no `Array.prototype` callbacks, no template strings, no `Object.keys`. Reuse scratch objects; write into `out` parameters.
- **Determinism:** sim iterates arrays by index; no `Map`/`Set` iteration in sim code paths; no `sort` with unstable comparators on objects (use explicit tie-breaks by car id).
- **Errors:** never throw inside `step()`; the NaN guard triggers a recovery reset. `console.error` only for real faults (it fails E2E). Expected degradations use `console.warn` once.
- **dispose():** every presentation module releases geometries, materials, textures, render targets, DOM nodes, listeners, bus subscriptions, AudioNodes and GSAP tweens/timelines it created, and is idempotent.
- **Keyboard:** `KeyboardEvent.code` only; never Ctrl/Alt/Meta; `preventDefault` on handled game keys.
- **three r186 specifics:** `outputColorSpace = SRGBColorSpace`, colour textures `SRGBColorSpace`, data textures `NoColorSpace`; no deprecated APIs (a deprecation warning is a P2 finding).
- **GSAP:** only `src/ui/**` and `src/trailer/**`; never for per-frame HUD numbers; `gsap.context()` per screen, reverted in `dispose`.

---

## 12. Performance budgets (RTX 4060 Laptop, 1080p, Chrome)

| | Low | Medium | High | Ultra |
|---|---|---|---|---|
| FPS gate (30 s avg, race, 20 cars) | ≥ 140 (P2) | ≥ 120 (P2) | **≥ 100** | **≥ 60**; night + heavy rain **≥ 50** |
| p95 frame time | ≤ 9 ms | ≤ 10 ms | ≤ 12 ms | ≤ 20 ms |
| Draw calls (total / environment) | 250 / 110 | 320 / 150 | **400 / 200** | 520 / 260 |
| Triangles (total / environment) | 1.2 M / 0.7 M | 2.0 M / 1.05 M | **3.0 M / 1.5 M** | 4.0 M / 1.95 M |
| Shader programs after warmup | ≤ 45 | ≤ 50 | ≤ 55 | ≤ 60 |

| CPU budget | Value |
|---|---|
| One sim tick, 20 cars, all systems (Chrome) | ≤ 0.35 ms mean, ≤ 0.8 ms p99 |
| `TrackQuery.ground` | ≤ 1 µs per call (Node bench) |
| `buildTrackData` / AI `prepare` | ≤ 150 ms / ≤ 300 ms |
| Presentation JS per frame (camera, env, cars, VFX, audio) | ≤ 3 ms |
| HudPresenter + `updateHud` (30 Hz) | ≤ 1 ms per update |
| Hitches | no frame > 50 ms after the first 3 s of a session |
| Load, menu → first race frame (High) | ≤ 8 s |
| JS heap in a 20-car race | ≤ 400 MB |
| Leak gate | 5× start/quit: geometries and textures within ±2 % |

The perf protocol is in `docs/design/rendering.md` §11 and `docs/design/testing-qc.md` §4.

---

## 13. Test layers

| Layer | Location | Owner | Runner | Command |
|---|---|---|---|---|
| Module unit | `src/<module>/__tests__/*.test.ts` | module owner | Vitest, node env | `npm test` |
| Architecture, i18n parity, dependency resolution | `tests/arch/` | Testçi | Vitest | `npm test` |
| Sim (headless `createSim`) | `tests/sim/` | Testçi | Vitest | `npm test` |
| Integration (presenters, settings migrations, replay, flashback) | `tests/integration/` | Testçi | Vitest | `npm test` |
| E2E (system Chrome, headless) | `tests/e2e/` | Testçi | Playwright `channel: 'chrome'` | `npm run e2e` |
| Perf (headed, GPU flags) | `tests/perf/`, `scripts/perf.mjs` | Testçi | Playwright headed | `npm run perf` |
| Leak | `tests/leak/` | Testçi | Playwright | `npm run e2e -- leak` |
| Visual gallery | `tests/visual/` → `test-results/screens/` | Testçi (+ every role for own scenes) | Playwright + Read review | `npm run shots` |

Single screenshots (every role, own port): `node scripts/shot.mjs --port <port> --url "/?scene=<id>" --out <png> [--wait ready|sceneReady|<ms>] [--delay <ms>] [--eval "<js>"] [--press Enter] [--headed] [--serve] [--fail-on-errors]`. Look at every PNG with Read before claiming visual quality.

Thresholds and the full catalogue: `docs/design/testing-qc.md`.

---

## 14. Contract change requests (for the Lead)

Accepted by the orchestrator (DECISIONS.md), already in `src/contracts`:
- **D-001** `TeamDef.colors.ui: string` (HUD strip colour; presenter passes `colors.ui ?? colors.primary` as `TowerRow.teamColor` and `minimap.teamColor`).
- **D-011** `TrackId = 'istanbul' | 'oval' | 'straight'`; `createStraightTrack` exported from `src/track`.
- **D-012** `SimCarState.kb: KeyboardFilterState` (written only by PlayerInputSystem).
- **D-013** `SimRunner.history: SnapshotHistory`; `CreateSimOptions.skipLights`.
- **D-014** `DriverDef.tcam`; `Settings.controls.layout` adds `'combined'` (default); `Settings.ui.animations`.
- **D-015** `UiDeps.keys: KeyBindingsApi` (+ `InputContext`, `RebindResult`).
- **D-016** `ModuleStatusExport` (`MODULE_STATUS` in every module `index.ts`), `createCameraRig(ctx)`, `AssetLoader.font(text?)`, `AppStateId`, `EventBus`, `LaunchParams`, `Telemetry`, `RaceInfo`.
- **D-017** skeleton scene at `src/game/sandbox/skeleton.scene.ts`.
- **D-018** `tsconfig` `typeRoots: ["./node_modules/@types", "./node_modules"]`; Vite `apex:project-boundary` plugin fails builds that resolve modules outside the project.

Already satisfied by the Sprint 0 contracts (no action): `PerfStats`, `AssetLoader`, `settings.ui.animations`, `KeyboardFilterState` (`car.kb`), `SnapshotHistory`, `LaunchParams` (incl. `t`, `autopause`), `TrackId`, `createStraightTrack`, `DriverDef.tcam`, `KeyBindingsApi`.

**CR-01 Replay (new `src/contracts/replay.ts`). Needed by Sprint 2 recorder and Sprint 5b trailer.**
```ts
export const REPLAY_HZ = 60;
export const REPLAY_CAR_STRIDE = 44; // floats per car per frame, layout below
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
  frameAt(t: number, out: ReplayFrame): ReplayFrame;        // interpolated, allocation-free
  toRenderFrame(f: ReplayFrame, playerId: number, out: RenderFrame): RenderFrame;
  eventsIn(t0: number, t1: number, cb: (t: number, e: SimEvent) => void): void;
}
```
Car layout: `px py pz fx fy fz ux uy uz speed steerAngle | wheelSpin×4 | susp×4 | rpm gear throttle brake drsFlap | brakeGlow×4 | rainLight compoundIdx | slip×4 | surfaceIdx×4 | sparks inPitBox ersKw position lapsCompleted visible` (= 44). Factories in `src/game/index.ts`: `createReplayRecorder()`, `createReplayPlayer(d)`; binary export `encodeReplay(d): ArrayBuffer` / `decodeReplay(b)`.

**CR-02 View cameras.** `export type ViewId = CameraId | 'tv' | 'orbit' | 'free' | 'trailer'`; `export interface CameraPose { px: number; py: number; pz: number; tx: number; ty: number; tz: number; fov: number; roll: number }`. `CameraRig` gains `setView(id: ViewId): void`, `view(): ViewId`, `setOverride(p: CameraPose | null): void` (trailer/free). `RenderFrame` gains `view: ViewId; lookBack: boolean` (filled by glue after `cameraRig.update`; used by lens droplets and audio). `ApexDebugApi.setCamera(id: ViewId)`; `LaunchParams.cam: ViewId | null`.

**CR-03 Player strategy inputs in `DriverControls`** (persistent values, latched every tick; needed so MFD choices reach the sim deterministically): `ersModeSel: ErsMode | 'auto'; brakeBias: number; boxRequest: boolean; nextCompound: Compound`. PlayerInputSystem copies `ersModeSel`/`brakeBias` into `VehicleInput`; PitProcedure reads `boxRequest`/`nextCompound` for the player car.

**CR-04 `CarRenderState` additions:** `ersKw: number` (+ deploy / − harvest, for MGU-K whine) and `pitLimiter: boolean` (limiter beeps).

**CR-05 `HudModel` additions:** notification entries gain `ms: number; priority: 0 | 1 | 2 | 3` (D-002: an entry lives for `ms`; a repeated `key` reuses its `id` and restarts the timer, so the UI coalesces); `timing.deltaRef: 'pb' | 'best' | 'rival' | null`; `penalty: { toServeSec: number; trackLimitWarnings: number }`; `pit: { phase: PitPhase; inLane: boolean; limitKmh: number; speeding: boolean; boxDistM: number; serviceLeftS: number } | null`; `mfd` gains `ersAuto: boolean; pitLossS: number; rejoinPos: number | null`.

**CR-06 `SimEvent` additions:** `{ type: 'lapInvalidated'; car: number; reason: 'trackLimits' | 'cornerCut' | 'flashback' | 'reset' }`, `{ type: 'penaltyServed'; car: number; seconds: number }`, `{ type: 'retired'; car: number }`.

**CR-07 Debug API:** `getHud(): HudModel | null`; `ui: { screen(): ScreenId | null; focusId(): string | null }` (value of the focused element's `data-focus-id`); `audio(): { unlocked: boolean; voices: number }`. `PerfStats` gains `hitches: number` (frames > 50 ms) and `heapMB: number` (0 when unavailable).

**CR-08 Offline audio** (`AudioModule` in `modules.ts`): `createAudioSystem(opts?: { context?: BaseAudioContext })` and `renderReplayAudio(replay: ReplayData, o: { from: number; to: number; sampleRate: number; listener(t: number, out: ListenerPose): ListenerPose; volumes: AudioSettings }): Promise<AudioBuffer>`.

**CR-09 `GraphicsSystem.setPostEnabled(on: boolean)`** for `?nopost=1` and the `post` scene A/B.

**CR-10 `RaceModule.forecast(c: ConditionsState, seed: number, nowS: number, out: ForecastEntry[]): number`** (pure; used by HudPresenter and AI strategy so both see identical forecasts).

**CR-11 `EventMap` addition:** `'ui:sound': { kind: 'move' | 'confirm' | 'back' | 'error' | 'toggle' | 'open' | 'close' }` (UI → audio).

**CR-12 `ResultsModel.rows[].status`** typed as `CarRaceState['status']` instead of `string`.
