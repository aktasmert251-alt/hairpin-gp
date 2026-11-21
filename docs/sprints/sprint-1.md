# Sprint 1: parallel production (Çevre, Grafik-3B, Sürüş, Testçi)

> Owner: Planner. Inputs: `docs/sprints/PLAN.md` (Sprint 1), `docs/ARCHITECTURE.md`, `docs/design/*.md`, `docs/design/planner-report.md` §5–§7, `docs/design/DESIGN.md`.
> Every agent: read `docs/sprints/TEAM-RULES.md` and your brief in `docs/team/<role>.md` first. Work only in your area. Report in the TEAM-RULES §6 format (one message, ≤ 8 KB).

## 0. Before the sprint starts (orchestrator + Lead)
- The Lead applies the small contract additions that Sprint 1 code depends on: **CR-02** (`ViewId`, `CameraPose`, `RenderFrame.view/lookBack`), **CR-03** (`DriverControls` strategy fields), **CR-04** (`CarRenderState.ersKw/pitLimiter`) and **CR-06** (new sim events). See `docs/ARCHITECTURE.md` §14.
- If they are not applied in time, builders code against the current contracts and keep the extra data internal, behind a `// CR-0x` comment, so the switch later is mechanical.
- Stubs live in `src/track/stub/*`, `src/physics/stub/*`, `src/ai/stub/*`, `src/audio/stub/*`, `src/graphics/stub/*`, `src/ui/stub/*`. Each module `index.ts` exports `MODULE_STATUS: 'stub' | 'real'` (D-016). Owners replace the stub behind the same exports, then flip `MODULE_STATUS` to `'real'` when their acceptance tests pass.
- **Screenshots** (TEAM-RULES §4): `node scripts/shot.mjs --port <port> --url "/?scene=<id>" --out <png> [--wait ready|sceneReady|<ms>] [--delay <ms>] [--eval "<js>"] [--press Enter] [--headed] [--serve] [--fail-on-errors]`. Use your own port (ÇEV 5174, GRA-3B 5175, SÜR 5176, TEST 5177, QC 5178), `--wait sceneReady`, and add `&freeze=1` for deterministic shots; `--fail-on-errors` makes console errors fatal; `--serve` starts a dev server on the port if none runs. Open every PNG with Read.

## 1. Hand-offs (who waits for whom)

| Id | From → To | What | Signal | Target | Until then |
|---|---|---|---|---|---|
| **H1** | ÇEV → SÜR, TEST | İstanbul `loadTrack()` + `TrackQuery` passing its tests (replacing `src/track/stub/*` oval as the default) | `src/track/index.ts` `MODULE_STATUS = 'real'` and `loadTrack().data.id === 'istanbul'` | first third of the sprint (Ç1–Ç3) | SÜR uses the oval stub; TEST skips track tests (`it.skipIf`) |
| **H2** | GRA-3B → ÇEV | real `createGraphicsSystem` + `QUALITY_PRESETS` (renderer, post chain, presets) replacing `src/graphics/stub/*` | `src/graphics/index.ts` `MODULE_STATUS = 'real'` | after G1–G2 | ÇEV's `?scene=track` renders through the Lead's stub GraphicsSystem |
| **H3** | ÇEV → GRA-3B | day `LightingRig` + env scene (`buildEnvironment` returning at least sky, sun, hemi, envScene) | `src/track/index.ts` exports `buildEnvironment` from `src/track/sky|scenery`, no longer from `src/track/stub/*` | after Ç8 | GRA scenes use `RoomEnvironment` from `three/examples/jsm/environments/RoomEnvironment.js` and the day rig values from `rendering.md` §5 |
| **H4** | SÜR → TEST | real physics + AI behind the contracts, replacing `src/physics/stub/*` and `src/ai/stub/*` | `src/physics/index.ts` and `src/ai/index.ts` `MODULE_STATUS = 'real'` | after S7 / S9 | sim tests run on stubs and only check determinism plumbing |
| **H5** | every role → TEST | list of sandbox scene ids (ARCHITECTURE §8) | scene files exist | continuous | gallery skips missing scenes with a warning |

---

## 2. Çevre Dizaynlayıcı (port 5174)
Spec: planner-report §7, `rendering.md` §2, §3, §5, §10 (environment fields), DESIGN.md §1 (3D art direction).

### Ç1. Track data pipeline
- **Files:** `scripts/fetch-track.mjs`, `src/track/data/istanbul.raw.json`, `src/track/data/fallback.ts`, `public/assets/env/CREDITS.part.md`.
- **Do:** follow report §7.2: Overpass POST (descriptive User-Agent, 3 retries with backoff) → OSM API fallback → EU-DEM via OpenTopoData (≤ 100 points per call, ≥ 1 s apart). Rotate the loop to start at node 1893855303. If all network paths fail, generate the raw file from the §7.15 fallback XZ arrays and §7.4 elevation samples and set `"source": "fallback"` in the JSON.
- **Accept:** the script is idempotent; the raw JSON contains main loop, pit polyline, scenery features, centreline elevations and the 3 × 3 km terrain grid (or the fallback subset); attribution strings from §7.2 are in the JSON and in `CREDITS.part.md`.

### Ç2. `buildTrackData` + authoring + `TrackQuery` (sim layer)
- **Files:** `src/track/authoring/istanbul.ts`, `src/track/build/buildTrackData.ts`, `src/track/query/trackQuery.ts`, `src/track/index.ts`, `src/track/__tests__/*.test.ts`.
- **Do:** report §7.2 runtime build (Catmull-Rom 1 m, Gaussian σ = 3 m, elevation σ = 40 m, vertical-curvature clamp), §7.5 widths/banking, §7.6 timing/DRS/cut zones, §7.7 pit and grid, §7.8 bands/kerbs/run-offs/walls, corners from §7.3 (rescale s to the final length), surfaces from §5.5. `ground()` uses the persistent `TrackHint` and a local search window; walls in a 20 m spatial hash.
- **Accept (unit tests, all must pass):**
  - loop closed: end-to-start gap < 0.5 m, tangent discontinuity < 1°;
  - length 5,300–5,400 m;
  - corner direction sequence exactly `L R L R L L R L L R R L R L`; net heading change +360° ± 1°;
  - `worldFromSD` → `project` round trip < 2 cm on 10,000 seeded samples with |d| ≤ halfWidth + 10 m;
  - walls continuous (gap < 0.5 m) except at pit entry and exit; every wall face ≥ 1 m outside the outermost band;
  - 20 grid slots inside the limits; pit ribbon split/merge within 1 m of the main left edge; 10 boxes inside the limiter zone;
  - `ground()` ≤ 1 µs mean over 1 M calls along a lap (Node bench, warm);
  - two builds produce identical arrays (hash); build ≤ 150 ms.
- **Hand-off H1:** make `loadTrack()` return İstanbul and set `MODULE_STATUS = 'real'` as soon as these pass (keep the oval and straight tracks for tests, D-011). Do this **before** starting Ç4.

### Ç3. `?scene=track-data`
- **Files:** `src/track/sandbox/track-data.scene.ts`.
- **Do:** 2D canvas plot (pan with arrows, zoom with `+`/`-`): edges, bands coloured by surface, walls by kind, sector boundaries, DRS detect/activate/end, cut-zone gates, corner numbers at apex, pit ribbon with boxes and limiter lines, grid slots. `&focus=t8` centres on a corner.
- **Screenshots:** `test-results/screens/cevre/track-data-full.png`, `track-data-t8.png`, `track-data-pit.png`.

### Ç4. Track surface meshes (presentation)
- **Files:** `src/track/mesh/**`, `public/assets/env/textures/**`.
- **Do:** ribbon in 250 m chunks merged per material; asphalt 2K (CC0, Poly Haven), white lines, flat kerbs (red/white 1 m stripes, sawtooth edge), yellow sausage kerbs, astroturf, painted run-off stripes, gravel, grass verges, pit lane asphalt and box concrete; UV convention u = s (m), v = d (m); markings use `polygonOffset` (−1, −1), never y-offsets above 2 mm; rubbered racing line darkening from the AI line approximation (report §7.13 1D texture, dry look in S1).
- **Accept:** no z-fighting or seams at chunk borders in screenshots at 3 distances; texture budget ≤ 12 MB total.

### Ç5. Terrain
- **Files:** `src/track/terrain/**`. **Do:** report §7.10 (inner ring 10 m, outer 50 m, silhouette ring drawn as camera-following backdrop at 0.95·far, `depthWrite=false`); ribbon blend; splat by slope/noise. **Accept:** barrier bases match terrain within 5 cm; no cracks between rings.

### Ç6. Barriers and fences
- **Files:** `src/track/scenery/barriers.ts`. **Do:** armco, concrete + catch fence (alpha-tested, single draw per chunk), tyre walls, TecPro, pit wall; merged per 250 m chunk. **Accept:** follows `TrackData.walls` exactly (same polylines physics uses).

### Ç7. Scenery
- **Files:** `src/track/scenery/**`. **Do:** report §7.9 and §7.11: grandstands with roofs, instanced crowd billboards (16-silhouette atlas, team-colour tints, vertex bob), pit building + paddock + control tower, start gantry (5 × 2 lamps driven by `frame.lights`), ~21 marshal posts with LED panels (yellow from `frame.yellowSectors`), billboards with fictional sponsors only, distance boards, two banner gantries, instanced trees (3D < 150 m, cross-billboards beyond), residential backdrop. Densities from `QualityPreset.treeDensity/crowdDensity/grassCards`.
- **Accept:** High-preset environment ≤ 1.5 M triangles and ≤ 200 draw calls (report §7.14 per-component table), measured with `renderer.info` in `?scene=track&quality=high` from the S/F camera and the T8 camera; numbers go in the final report.

### Ç8. Sky, env scene and day lighting
- **Files:** `src/track/sky/**`, `src/track/sky/rigs.ts`.
- **Do:** Sky shader + FBM cloud dome (cover from `ConditionsFrame.cloud`), env scene for PMREM (`rendering.md` §2), `LightingRig` for **day, sunset and night** as data exactly per `rendering.md` §5 (sunset/night visuals are polished in Sprint 2, but the values ship now), `applyConditions()` modifiers (§5.4), sun shadow-camera fitting with texel snapping (`rendering.md` §3).
- **Hand-off H3:** `buildEnvironment` returns a real handle (sky, sun, hemi, envScene, rig).

### Ç9. `?scene=track`
- **Files:** `src/track/sandbox/track.scene.ts`. **Do:** orbit, free-fly (WASD + R/F up/down, Shift fast) and drive-along (follows the centreline at a chosen km/h) cameras; lil-gui for TOD, rain, wetness, quality preset; `renderer.info` overlay. Supports `&cam=` presets `sf`, `t1`, `t8`, `t12`, `pit`, `aerial`.
- **Screenshots:** `test-results/screens/cevre/track-sf.png`, `track-t1.png`, `track-t8.png`, `track-t12.png`, `track-pit.png`, `track-aerial.png` (all `quality=high`, `tod=day`, `freeze=1`), plus `track-t8-low.png` and `track-t8-ultra.png`.

---

## 3. Grafik-3B (port 5175)
Spec: `rendering.md` (all), DESIGN.md §1 (3D art direction and livery language), contracts `render.ts`.

### G1. GraphicsSystem + quality presets
- **Files:** `src/graphics/renderer/graphicsSystem.ts`, `src/graphics/post/**`, `src/graphics/presets.ts`, `src/graphics/index.ts`.
- **Do:** `rendering.md` §1 renderer, §4 post chain (N8AO, SMAA/FXAA, bloom, exposure, AgX, procedural LUT, vignette, chromatic aberration, lens-droplet stub), §10 `QUALITY_PRESETS` with every field exactly as tabled; `setQuality` rebuilds only what changed; `resize()` honours `renderScale`; `getPerf()` from `renderer.info`.
- **Accept:** switching presets 20 times leaks no render targets (`renderer.info.memory` stable); no console warnings from three/postprocessing.
- **Hand-off H2:** set `MODULE_STATUS = 'real'`.

### G2. `?scene=post`
- **Files:** `src/graphics/sandbox/post.scene.ts`, `src/graphics/post/lut.ts`.
- **Do:** test scene (car on a turntable over an asphalt disc + emissive bars for bloom); lil-gui toggles per effect; preset switch; LUT preview for day/sunset/night/overcast.
- **Screenshots:** `test-results/screens/grafik/post-low.png`, `post-medium.png`, `post-high.png`, `post-ultra.png`, `post-lut-sunset.png`, `post-lut-night.png`.

### G3. Materials
- **Files:** `src/graphics/materials/**`. **Do:** `rendering.md` §6: paint (gloss, matte, metallic flake), carbon weave, tyre rubber with ORBIS sidewall + compound stripe, metals, visor/glass, emissive brake discs, rain light, ghost material. Procedural textures generated once and cached (no per-car duplicates).
- **Accept:** one material instance per (material kind × team) at most; textures ≤ 64 MB total at Ultra.

### G4. Procedural 2025-style car
- **Files:** `src/graphics/car/**`. **Do:** parts and triangle targets per `rendering.md` §7.1, model space per §7.2, livery atlas generator for the 10 teams (`src/data/teams.ts` colours, finish, numbers, T-cam colour), 3 LODs, wheels as shared InstancedMeshes, animation channels (steer, wheel spin with blur swap, suspension, DRS flap, brake glow, rain light).
- **Accept:** LOD0 ≤ 60k triangles incl. wheels and ≤ 8 body draw calls (target 6, `rendering.md` §7.4); LOD1 ≤ 15k / ≤ 3; LOD2 ≤ 3k, all far cars in one instanced draw; silhouette matches the 5.6 × 2.0 m footprint and 3.60 m wheelbase.

### G5. CarVisualsSystem
- **Files:** `src/graphics/car/carVisuals.ts`. **Do:** contract `CarVisualsSystem`; LOD selection with 10 % hysteresis and the LOD0 cap (§7.3); ghost rendering; `setCockpitCar(id)` hides the player's body parts that would clip the cockpit camera (keeps halo, wheel, front wing, mirrors).
- **Accept:** 20 cars on the grid in the worst view ≤ 90 car draw calls in the main pass.

### G6. Camera rig
- **Files:** `src/graphics/camera/**`, `src/graphics/sandbox/cameras.scene.ts`. **Do:** `rendering.md` §9: 5 driving cams with exact offsets/FOV/damping, speed FOV, shake, look-back, TV camera (CR-02 `ViewId`), `getListener()`.
- **Screenshots:** `test-results/screens/grafik/cam-cockpit.png`, `cam-tcam.png`, `cam-nose.png`, `cam-chaseNear.png`, `cam-chaseFar.png`, `cam-tv.png`.

### G7. Basic VFX
- **Files:** `src/graphics/vfx/**`, `src/graphics/sandbox/vfx.scene.ts`. **Do:** `rendering.md` §8: tyre smoke (soft particles), titanium sparks, gravel/grass dust, skid-mark ring buffer; pools sized from `QualityPreset`. Rain streaks/spray are Sprint 2.
- **Screenshots:** `test-results/screens/grafik/vfx-smoke.png`, `vfx-sparks.png`, `vfx-dust.png`, `vfx-skids.png`.

### G8. Racing line visual
- **Files:** `src/graphics/racingLine/**`. **Do:** ribbon 0.6 m wide, 2 cm above ground with `polygonOffset`, coloured by `SpeedProfile.zone` (colours from DESIGN.md tokens), modes `corners` (only 250 m before to 50 m after each brake zone) and `full`; drawn 5–220 m ahead of the player; one draw call.

### G9. `?scene=car`
- **Files:** `src/graphics/sandbox/car.scene.ts`. **Do:** showroom turntable, team livery browser (←/→), LOD browser (1/2/3), 20-car grid view, wheel/steer/DRS sliders, draw-call/triangle overlay.
- **Screenshots:** `test-results/screens/grafik/car-anka.png`, `car-aurora.png`, `car-vortex.png` (matte), `car-solaris.png` (metallic), `car-lod0.png`, `car-lod1.png`, `car-lod2.png`, `car-grid-20.png`.

---

## 4. Sürüş Motoru Mühendisi (port 5176)
Spec: planner-report §5 and §6, `audio.md`, contracts `vehicle.ts`, `ai.ts`, `sim.ts`.

### S1. Keyboard filter + PlayerInputSystem
- **Files:** `src/physics/input/keyboardFilter.ts`, `src/physics/input/playerInputSystem.ts`. **Do:** §5.7 exactly (ramp rates, `|u|^1.4` shaping, `δmax(v)`, throttle/brake ramps, keyboard brake limiter); state in `car.kb`; MFD values from `car.controls` (CR-03).
- **Accept:** unit tests for ramp timing (full lock reached in 0.25 s at 0 km/h and 0.62 s at ≥ 288 km/h ±5 %), reversal passes through 0, limiter output = 1.05 × lock threshold.

### S2. VehicleSystem (§5.1–§5.2, §5.3 params)
- **Files:** `src/physics/vehicle/**`, `src/physics/aero/**`, `src/physics/powertrain/**`, `src/physics/index.ts`. **Do:** ground query, aero with DRS/slipstream/dirty air, loads, steering with Ackermann, combined-slip tyre forces, 4 wheel substeps, drivetrain with diff and auto-clutch, limiter, semi-implicit integration, 60 Hz tasks; `defaultVehicleParams`, `initVehicleState`; start hold during `grid`/`lights` phases (rules.md §2).
- **Accept:** zero allocations in `step()` (heap delta < 64 KB over 100k ticks with `--expose-gc`), NaN guard.

### S3. Tyres and surfaces
- **Files:** `src/physics/tyre/**`. **Do:** §5.3 compounds and wet table, §5.4 thermal/wear, §5.5 surface table via `TrackQuery.surfaceProps`. **Accept:** calibration targets (a)–(e) of §5.4 as tests.

### S4. Power unit, ERS, DRS, gears, brakes
- **Files:** `src/physics/powertrain/**`. **Do:** torque and engine-brake curves, 8 gears, shift times and cut, ERS K/H harvest and deploy modes (§5.6), DRS open/close timing, brake torque and bias.

### S5. Assists
- **Files:** `src/physics/assists/**`. **Do:** §5.8 ABS, TC, steering assist with counter-steer, braking assist (uses the player `SpeedProfile`), auto gearbox, DRS assist; pit assist is the AI (S8).

### S6. Collisions and recovery
- **Files:** `src/physics/collision/**`. **Do:** §5.9 walls (OBB vs `wallsNear`), car vs car SAT with impulse clamps, recovery reset and 3 s ghosting; `collision` and `carReset` events.

### S7. Physics benches (§5.11)
- **Files:** `src/physics/__tests__/benches.test.ts`, `src/physics/__tests__/helpers/flatPlane.ts` (own flat-plane `TrackQuery` for skidpad tests).
- **Accept (Sprint 1 subset, all green):** 0–100 / 0–200 / 0–300, top speed with and without DRS and with ES empty, 200→0 and 300→100 braking distances, peak decel at 300 km/h, steady lateral g at 80 and 250 km/h, standstill jitter < 1 mm/s, 10 min random-input fuzz without NaN, bitwise determinism of `hash()` after 60 s, snapshot → continue → restore → re-run equality. İstanbul-specific rows (back-straight speed, T8 g, lap times, sector split, wet lap deltas) are Sprint 2.
- **Hand-off H4:** `MODULE_STATUS = 'real'` in `src/physics/index.ts`.

### S8. AI v1
- **Files:** `src/ai/**`. **Do:** §6.1 racing line (≤ 60 ms), §6.2 speed profile, §6.3 controller, §6.4 difficulty table, §6.5 following/overtake lanes/side-by-side/avoidance, §6.6 start, pit-auto driving of the pit lane (pit-weather.md §2), `perfect` mode for autodrive. Strategy and weather calls are Sprint 2.
- **Order:** develop on the oval stub; when H1 lands, switch `?scene=ai` default to İstanbul and run the smoke check.
- **Accept:** `prepare` ≤ 300 ms; 20 cars × 3 laps on İstanbul (after H1): no NaN, no car stuck > 4 s, ≤ 1 off-track per car per lap; lap times printed in the report (calibration to 1:24–1:27 is Sprint 2). `MODULE_STATUS = 'real'` in `src/ai/index.ts`.

### S9. Engine audio v1
- **Files:** `src/audio/**`, `src/audio/sandbox/audio.scene.ts`. **Do:** `audio.md` §2 player engine (harmonic stack, noise, waveshaper, load/throttle crossfade, turbo/MGU-H/MGU-K whine, shift cut/blip, limiter), mixer buses (§8), `unlock()`. Build every node through `createAudioGraph(ctx: BaseAudioContext)` so the graph also builds on an `OfflineAudioContext`.
- **Accept:** `?scene=audio&offline=1` renders 2 s offline and plots the waveform; no `AudioContext`-only API used in the graph code.

### S10. Sandbox scenes
- `?scene=physics` (drivable car, telemetry plots: speed, rpm, gear, slip per wheel, g-g diagram; lil-gui params; `&track=oval|straight|istanbul`), `?scene=ai`, `?scene=audio`.
- **Screenshots:** `test-results/screens/surus/physics-telemetry.png`, `ai-oval-20.png`, `ai-istanbul-line.png` (after H1), `audio-bench.png`.

---

## 5. Testçi (port 5177)
Spec: `testing-qc.md`, ARCHITECTURE §8, §9, §13.

### T1. Test infrastructure ownership
- **Files:** `vitest.config.ts`, `playwright.config.ts`. **Do:** Vitest projects `unit` (`src/**/__tests__/**/*.test.ts`), `arch`, `sim`, `integration` (all node env); Playwright projects `e2e` (headless, `channel: 'chrome'`), `perf` (headed, GPU flags from `testing-qc.md` §4), `leak`. Base URL from the dev server on 5177 (`webServer` starts `npm run dev -- --port 5177 --strictPort`).

### T2. `__APEX__` client and fixtures
- **Files:** `tests/helpers/apexClient.ts`, `tests/helpers/fixtures.ts`. **Do:** typed wrapper (`whenReady`, `waitForPhase(phase, timeout)`, `waitForLap(n)`, `press`, `teleport`, `perf`), an auto-fixture that fails any test when `__APEX__.errors` is non-empty or the page logs `console.error`.

### T3. Screenshot gallery
- **Files:** `tests/visual/gallery.spec.ts`, `tests/visual/points.ts`. **Do:** iterate the scene list (ARCHITECTURE §8) and the screenshot points of `testing-qc.md` §3 that the current modules support; write PNGs to `test-results/screens/gallery/` plus `index.json` (path, scene, params, timestamp). Every PNG passes a "not blank" check (luminance standard deviation > 8 on 0–255).

### T4. FPS sampler
- **Files:** `scripts/perf.mjs`, `tests/perf/fps.spec.ts`. **Do:** protocol of `testing-qc.md` §4; JSON per run in `test-results/perf/`; prints the GPU string and flags the run invalid if it does not contain the discrete GPU name.

### T5. Static tests
- **Files:** `tests/arch/architecture.test.ts` (rules of ARCHITECTURE §1.2), `tests/arch/i18n-parity.test.ts`, `tests/arch/deps.test.ts` (`three`, `postprocessing`, `n8ao`, `gsap` resolve inside the project's `node_modules`; exactly one `three` copy; versions equal PLAN's pinned table).

### T6. E2E smoke
- **Files:** `tests/e2e/smoke.spec.ts`. **Do:** (a) `?scene=skeleton` → `sceneReady`, screenshot, no errors; (b) boot → title → any key → main menu visible; (c) `?mode=race&autostart=1&autodrive=1&laps=1&ai=0&skipLights=1` → session starts, 10 s later `hashState()` changed and `getTelemetry().kmh > 0`.

### T7. Sim scaffolding
- **Files:** `tests/sim/determinism.test.ts`, `tests/sim/snapshot.test.ts`, `tests/sim/single-writer.test.ts`. Run on whatever modules are real (`MODULE_STATUS`); they must already pass on stubs.

### T8. Test plan
- **Files:** `docs/qa/test-plan.md`: the catalogue of `testing-qc.md` §2 mapped to files and sprints, with status columns.
- **Screenshots:** `test-results/screens/testci/skeleton.png`, `title.png`, `menu.png`.

---

## 6. Sprint 1 QC gate (Kalite, port 5178, writes `docs/qa/qc-sprint-1.md`)

| # | Check | Pass rule |
|---|---|---|
| 1 | Build health | `npm run typecheck`, `npm test`, `npm run build` green |
| 2 | Layer rule | `tests/arch/architecture.test.ts` green; manual spot check of 5 sim files |
| 3 | Single writer | each system writes only its row of ARCHITECTURE §4.1 (grep `state.`/`car.` assignments) |
| 4 | Hot-loop allocations | no literals/closures in `step()` of physics, AI, track query (review) + heap test green |
| 5 | Contracts | `src/contracts/**` changed only by the Lead (compare with the sprint-0 commit) |
| 6 | dispose | graphics, car visuals, VFX, camera, track presentation and audio release everything (review against ARCHITECTURE §11) |
| 7 | Sandbox scenes | all Sprint 1 scenes load with `sceneReady` and zero console errors |
| 8 | Screenshots | every screenshot listed above exists and QC looked at each one; visual P0/P1 noted |
| 9 | Physics | Sprint 1 bench subset green (S7) |
| 10 | Track | Ç2 tests green; `MODULE_STATUS = 'real'` in track, graphics, physics, ai, audio |
| 11 | Budgets | environment ≤ 1.5 M tris / 200 draws (High); car LOD0 ≤ 60k tris / ≤ 8 body draws; grid view ≤ 90 car draws |
| 12 | Perf smoke | `?scene=track&quality=high` (headed) ≥ 100 FPS; `?scene=car` grid at Ultra ≥ 60 FPS |
| 13 | IP | `grep -ri "formula 1\|formula1\|\bF1\b"` over `src/` and `public/` finds nothing; no real team/driver names |
| 14 | Assets | every downloaded file listed in a `CREDITS.part.md` with URL, licence (CC0/OFL), author |
| 15 | i18n | parity test green; no hard-coded UI strings outside sandbox GUIs |

Severity: any failure of rows 1, 2, 5, 7, 13 is P0; rows 3, 4, 6, 9–12, 14, 15 are P1 unless QC justifies P2.

## 7. Sprint 1 exit (PLAN)
All sandbox screenshots taken and reviewed, Sprint 1 benchmarks green, typecheck/test/build green, QC gate has no open P0. Commit `sprint-1`.
