# Sprint 1: builder hand-off summary (orchestrator)

This summary is distilled from the final reports of Çevre, Grafik-3B and Sürüş. It is the input for the Sprint 1 QC gate and for `sprint-2.md`. Decisions: D-019 to D-024 in `DECISIONS.md`.

## Module status
- `track`, `graphics`, `physics`, `ai` and `audio` are `MODULE_STATUS = 'real'`. All stubs are deleted, except the oval and straight test tracks.
- typecheck and build are green.
- Tests at the time of the last builder report: 29 files, 191 tests green.
- Tester results are pending: `docs/qa/test-*.md`.

## Çevre (src/track): done
- **Data and geometry.** Data comes from OSM via Overpass, with the EU-DEM elevation profile (the §7.15 fallback was not used). Built track: 5335 m. Pit lane 910 m (split at s≈4765, merge at s≈419, 10 boxes).
- **TrackQuery.**
  - `ground()` takes 0.10–0.22 µs per call.
  - Round-trip error < 2 cm.
  - The build is deterministic and takes ~50 ms (best of 7 is 110 ms under a parallel suite).
  - `getTrackExtras(data)` exposes the racing-line approximation and the pit↔main maps.
- **Scenery.**
  - **Track surface:** chunks, rubbered line, kerbs, astroturf, muted painted run-offs, gravel.
  - **Terrain:** 3 rings, splat.
  - **Barriers:** catch fences.
  - **Spectator areas:** main grandstand plus 14 OSM bleachers, ~50k crowd instances.
  - **Buildings:** pit building with garages and control tower, paddock, OSM and village houses.
  - **Trackside furniture:** start gantry driven by `frame.lights`; 21 marshal posts driven by `yellowSectors`; fictional sponsor boards; distance boards; up to 40k trees.
- **Sky and lighting.** Sky, clouds and stars. `BASE_RIGS` for day, sunset and night follow rendering.md §5.2, with conditions modifiers per §5.3. Shadows use texel snapping. PMREM env scene and night panels.
- **Budgets at High.** S/F 149 calls / 0.55 M tris; T8 158 / 0.58 M. The env main pass is 115–128 calls. **Shader programs are 64–65, above the High budget of 55 (P2).**
- **Sprint 2 items:**
  - wet shader (puddles, ripples, line drying)
  - floodlights and night polish
  - sunset tuning
  - pit-lane detail
  - program merging
  - alpha-to-coverage for distant fences and boards
- **Orchestrator visual notes:**
  - At T8, two plain grey box buildings look like placeholders.
  - The pit building facade is flat white; add detail and team branding.
- **Documentation-only CRs** (Lead adds the comments to `track.ts`):
  - CR-TR-1: on the pit ribbon, `GroundHit.d` is pit-local.
  - CR-TR-2: `pitEntry`/`pitExit` timing lines carry the main-track s.

## Grafik-3B (src/graphics): done
- **Renderer and post.**
  - Renderer: WebGL2, sRGB.
  - Post chain: RenderPass → DepthCopy → FX pass → N8AO → [FXAA/SMAA, bloom, exposure, AgX, LUT, vignette], with CA and lens passes.
  - `QUALITY_PRESETS` are exact. 80 preset switches leak nothing.
- **Car.**
  - Procedural 2025-spec car.
  - LOD0 49.6k tris / 7 draws; LOD1 9.3k / 3; LOD2 1.8k with one instanced draw for all far cars.
  - 20-car grid: 83 car draws.
  - 10 liveries following DESIGN §1.4.2.
- **Cameras.** 5 driving cameras, plus TV, orbit, free and trailer override (CR-02). Includes shake and look-back.
- **VFX and racing line.**
  - VFX: smoke, titanium sparks, dust, skid marks.
  - Racing line: 1 draw, `corners` and `full` modes.
- **Sprint 2 items:**
  - mirror render targets (`low30`/`high60`)
  - steering-wheel display canvas
  - rain VFX: streaks, spray, rooster tail, lens droplets
  - heat haze on Ultra
  - TV hero spots
  - showroom polish
  - night look, together with Çevre's night rig
- **Contract requests:** queued as D-019 to D-021 for the Lead in Sprint 2.

## Sürüş (src/physics, src/ai, src/audio): done (Sprint 1 scope)
- **Benches (§5.11 Sprint 1 subset, all green):**
  - 0–100 / 0–200 / 0–300 km/h: 2.58 / 4.82 / 10.92 s
  - top speed 323.8 km/h; DRS +11.6; empty energy store 303.4
  - braking 200→0 in 57.2 m, 300→100 in 79.9 m
  - 4.97 g peak deceleration
  - lateral 1.96 g at 80 km/h, 4.42 g at 250 km/h
- **Keyboard feel.**
  - With default assists, an on/off keyboard bot laps İstanbul in 98–108 s with no resets. This is the permanent test `keyboardFeel.test.ts`.
  - With Expert assists (none) the bot slides often, which needs a QC look.
- **AI v1.**
  - The racing line uses curvature averaging and builds in 15 ms.
  - 20 cars × 3 laps on İstanbul: laps 2–3 run 94.3–98.2 s. Lap 1 takes 101–119 s because of start chaos.
  - **The calibration target is 1:24–1:27, which is Sprint 2 work** (`ACHIEVABLE_MU` and `AI_MARGIN` in `speedProfile.ts`). Start racecraft also needs work.
- **Audio v1.** Built on `createAudioGraph(BaseAudioContext)`; renders offline 2 s in 85 ms. Covers the engine stack, whines, shift effects, limiter, wind and tyre squeal.
- **Sprint 2 items:**
  - AI pace calibration and start racecraft
  - tyre thermal (target (a) is borderline at 95 °C; slow-lap cooling is 15.8 °C) and wear-life calibration
  - wet compounds and wet-lap deltas
  - AI pit strategy and weather calls
  - pit-lane driving, which is written but not yet exercised by the race director
  - AI voices with doppler, kerb/surface/rain/crowd/UI sounds, and `renderReplayAudio` (CR-08)
- **Contract requests:** D-023 for the Lead (`VehicleState.aux`, `VehicleParams.tuning`, `DriverControls.steerSensitivity`, rear slip in `renderFrame`).
- **Deviation:** the physics scene uses its own key listener, so `__APEX__.input` synthetic keys don't reach it.
