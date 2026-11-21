# Sprint 2: integration, race systems, UI, weather / night / pit

> Owner: Planner. Inputs: `PLAN.md` (Sprint 2, "Tasarım ve hareket dili", Sprint 5b), `DECISIONS.md` (D-001…D-024), `sprint-1-reports.md`, `ARCHITECTURE.md` §7–§14, `docs/design/{ui-hud,rules,pit-weather,audio,rendering,testing-qc}.md`, `DESIGN.md`, `implementation-handoff.md`.
> Six agents in parallel: Yönetici (YÖN 5173), Grafik-UI (GRA-UI 5179), Grafik-3B (GRA-3B 5175), Çevre (ÇEV 5174), Sürüş (SÜR 5176), Testçi (TEST 5177). QC (5178) runs the §10 gate at the end.
> Every agent reads `TEAM-RULES.md`, `docs/team/<role>.md` and this file first. Final report: TEAM-RULES §6 (one message, ≤ 8 KB).

**Goal (PLAN):** menu → 20-car race on İstanbul with the real HUD → results; Time Trial with ghost; flashback; pit stops with tyre strategy; sunset and floodlit night; rain with a wet track. UI motion costs < 3 % FPS. Commit `sprint-2`.

## 0. Sprint rules (usage limits interrupt agents every few hours)
1. **Strict task order.** Each task ends green: `npm run typecheck`, own unit tests, `npm run build`. Never leave a half-migrated file across a break; finish it or keep the old path behind a flag.
2. **Progress file** `test-results/progress/<role>.md` (`yon`, `gra-ui`, `gra-3b`, `cevre`, `surus`, `testci`; gitignored, written only by that role). After each task append `S2-<task> done|partial|blocked <ISO time> next: <task>`; after a milestone's last task append `M<n> DONE`. Hand-off signals (§3) are posted here too. **On resume, read it and your last screenshots first.**
3. **No reachable broken flow.** An unfinished menu path is hidden by GRA-UI (`src/ui/features.ts`, focus skips it). The Lead never wires a session mode whose sim side is red.
4. **Contract safety.** The Lead adds every member that **another owner provides** as optional (`?`) and calls it with `?.`; L12 makes it required after the owner's signal. typecheck stays green at all times.
5. **Grafik split.** GRA-UI writes `src/ui/**` (incl. `src/ui/i18n/**`), `public/assets/gra/{fonts,ui}/**`, `docs/design/{DESIGN,design-contract,implementation-handoff}.md`, `example.html`. GRA-3B writes `src/graphics/**` and the rest of `public/assets/gra/**`.
6. **Screenshots** (sprint-1.md §0 flags): `node scripts/shot.mjs --port <own> --url "<url>" --out test-results/screens/<role>/<name>.png --wait sceneReady --fail-on-errors`; `&freeze=1` for sandbox scenes; `--headed` for anything GPU-timed. Live shots: `/?mode=race&autostart=1&autodrive=1&seed=1234&skipLights=1&s=<m>&cam=<view>`. Open every PNG with Read.
7. **Packages:** GSAP 3.15.0 is installed (Flip, CustomEase included). Register plugins once in `src/ui/motion/gsap.ts`. No `npm install`.
8. **Contract baseline:** after each Lead contract signal (L0, L12) TEST re-records `tests/arch/contracts.baseline.json` (`UPDATE_CONTRACT_BASELINE=1 npx vitest run --project arch tests/arch/contracts-frozen.test.ts`) and says so in its report.

## 1. Milestones (every role front-loads M1)

| | Done when (observable) | YÖN | GRA-UI | GRA-3B | ÇEV | SÜR | TEST |
|---|---|---|---|---|---|---|---|
| **M0** contracts | `src/contracts/replay.ts` exists, typecheck green, `L0 done` posted | L0 | U0 | – | – | – | T0 |
| **M1** playable race | title → menu → HIZLI YARIŞ (4 steps) → loading → 20-car race, real HUD, start lights → results (20 rows); AI d=100 lap 1:24–1:27; E-RC-01 green; 0 console errors | L1–L4 | U1–U4 | G1 | Ç1 | S1–S3 | T1–T4 |
| **M2** TT, ghost, flashback, settings | TT with PB + ghost; flashback; settings persist; all screens; motion pass; replay recording | L5–L8 | U5–U6 | G2–G5 | – | S4–S5 | T5 |
| **M3** pit, weather, night | pit stops with compound change and penalties; variable weather, wet track, AI tyre calls; sunset and floodlit night | L9–L11 | U7 | G6–G8 | Ç2–Ç4 | S6–S7 | T6 |
| **M4** polish, audio extras | logo intro; mirrors, heat haze, pit crew; full audio; offline replay audio; contracts tightened; perf + leak runs | L12 | U8–U9 | G9–G12 | Ç5 | S8–S9 | T7 |

**Critical path:** L0 → L1 → L2 → L3 → (U2 + U3 → H-UI) → L4 → E-RC-01 = **M1** → L5 → L7 → L8 (H-REP) → L9 (H-COND) → L10 (H-PIT) → S7 → T6 = **M3**. The Lead is the bottleneck: nothing may delay L0–L4. Fully parallel, off the path: S1–S2, Ç1–Ç3, G2–G7, U5–U6.

## 2. Contract batch (Lead task L0, before anything else)
Names exactly as in ARCHITECTURE §14 / DECISIONS. **opt** = optional until the provider's signal (§0.4).

| CR | Change | File | Provider → consumer |
|---|---|---|---|
| **CR-01** | `REPLAY_HZ = 60`, `REPLAY_CAR_STRIDE = 44`, `ReplayCarMeta`, `ReplayData`, `ReplayFrame`, `ReplayRecorder`, `ReplayPlayer` verbatim; `createReplayRecorder()`, `createReplayPlayer(d)`, `encodeReplay(d)`, `decodeReplay(b)` exported from `src/game/index.ts` (bodies in L8) | new `replay.ts` | YÖN → SÜR, trailer |
| **CR-05** | notification `ms`, `priority: 0\|1\|2\|3` (D-002); `timing.deltaRef`; `penalty {toServeSec, trackLimitWarnings}`; `pit {phase, inLane, limitKmh, speeding, boxDistM, serviceLeftS} \| null`; `mfd.ersAuto`, `mfd.pitLossS`, `mfd.rejoinPos` | `hud.ts` | YÖN → GRA-UI |
| **CR-07** | `getHud()`, `ui {screen(), focusId()}`, `audio() {unlocked, voices}`; `PerfStats.hitches`, `PerfStats.heapMB` | `debug.ts` | YÖN → TEST |
| **CR-08** | `createAudioSystem(opts?: { context?: BaseAudioContext })`; `renderReplayAudio(replay, o)` (opt) | `modules.ts`, `audio.ts` | SÜR → trailer |
| **CR-09 / D-021** | `GraphicsSystem.setPostEnabled(on)`, `onCollision(impulse: number)` (opt) | `render.ts` | GRA-3B → YÖN |
| **CR-10** | `RaceModule.forecast(c, seed, nowS, out): number` | `modules.ts` | YÖN → presenter, SÜR |
| **CR-11** | `EventMap['ui:sound']: { kind: 'move'\|'confirm'\|'back'\|'error'\|'toggle'\|'open'\|'close' }` | `events.ts` | GRA-UI → SÜR |
| **CR-12** | `ResultsModel.rows[].status: CarRaceState['status']` | `ui.ts` | YÖN → GRA-UI |
| **D-019** | `CarVisualsSystem.setQuality(q)`, `VfxSystem.setQuality(q)`, `VfxSystem.clear()` (opt) | `render.ts` | GRA-3B → YÖN |
| **D-020** | `CameraRig.onSimEvent(e)`, `setShake(k)`, `setMotionEffects(on)`, `setTrack(query)` (opt); CR-02 `setView/view/setOverride` stay opt until G1 | `render.ts` | GRA-3B → YÖN |
| **D-023** | CR-13 `VehicleState.aux { ghostT, stuckT, kerbT[4], spool, axF, ayF, heatJ[4] }`, `VehicleParams.tuning { rearAlphaFactor }` (opt); CR-14 `DriverControls.steerSensitivity` (required, glue latches `settings.controls.steerSensitivity`); `renderFrame.ts` rear slip `αpk × rearAlphaFactor` | `vehicle.ts`, `src/game/renderFrame.ts` | SÜR ↔ YÖN |
| **CR-TR-1/2** | doc comments: on the pit ribbon `GroundHit.d` is pit-local; `pitEntry`/`pitExit` lines carry main-track `s` | `track.ts` | ÇEV → all |

**New contract decisions (Planner, this file):**

| CR | Change | Why |
|---|---|---|
| **CR-15** | `GraphicsModule.createShowroom(): Showroom` (opt); `interface Showroom { init(ctx: RenderContext): Promise<void>; setTeam(teamId: string): void; render(dtS: number): void; resize(): void; dispose(): void }`; `EventMap['ui:focusTeam']: { teamId: string }` | main-menu 3D backdrop driven by team tiles |
| **CR-16** | `CarVisualsSystem.setWheelDisplay(m: HudModel \| null): void` (opt); glue calls it at 30 Hz after the presenter in `cockpit` view, `null` otherwise | wheel display shows the HUD's model |
| **CR-17** | `UiSystem.screen(): ScreenId \| null` (opt); `__APEX__.ui.focusId()` = `document.activeElement?.closest('[data-focus-id]')?.dataset.focusId ?? null` | needed by CR-07 |
| **CR-18** | `LaunchParams.record: boolean` (`?record=1`); `ApexDebugApi.lastReplay(): ArrayBuffer \| null` (encoded CR-01) | replay capture for I-04 and the 5b trailer |
| – | **Ghost is glue-internal, no contract:** `src/game/ghost/`, 20 Hz × 7 floats (px py pz fx fy fz speed), base64 in `apexgp:v1:ghost:istanbul:pb` | 95 s lap ≈ 53 KB → 71 KB base64 ≤ 100 KB (I-05) |

## 3. Hand-offs

| Id | From → to | What | Signal | When | Waiting side meanwhile |
|---|---|---|---|---|---|
| **H-C** | YÖN → all | §2 batch | `replay.ts` exists, typecheck green, `L0 done` posted | M0, ≤ 90 min | code against §2 shapes behind `// CR-xx`; S1, Ç1, U1 need nothing |
| **H-HUD** | YÖN → GRA-UI | presenter v2 with CR-05 at 30 Hz | `__APEX__.getHud()` non-null in a race, `notifications[].ms > 0` | M1 (L3) | UI renders typed mock `src/ui/sandbox/mockHud.ts` |
| **H-UI** | GRA-UI → YÖN, TEST | real `createUi()`: HUD + race-flow screens | `src/ui/index.ts` `MODULE_STATUS = 'real'` | M1 (U4) | YÖN runs `?autostart=1` on the stub UI; TEST `skipIf` menu specs |
| **H-AI** | SÜR → YÖN, TEST | calibrated pace + start | S-SM-04/05/11 green in `src/ai/__tests__/calibration.test.ts` | M1 (S2) | races run at Sprint 1 pace (94–98 s) |
| **H-RACE** | YÖN → TEST, GRA-UI | lights → finish → results + CR-07 | E-RC-01 passes on 5173 | M1 (L4) | TEST writes specs on `?autostart`; UI uses mock results |
| **H-SR** | GRA-3B → YÖN, GRA-UI | `createShowroom()` | `?scene=showroom` `sceneReady`, export present | M2 (G2) | menu shows the DESIGN §1.4.5 CSS placeholder |
| **H-GH** | GRA-3B → YÖN | ghost rendering | `gra-3b/ghost.png` exists | M2 (G4) | ghost drawn as a normal car |
| **H-REP** | YÖN → SÜR, TEST | replay + CR-18 | `src/game/__tests__/replay.test.ts` green | M2 (L8) | SÜR uses a synthetic `ReplayData` (2 cars, 10 s) |
| **H-COND** | YÖN → ÇEV, GRA-3B, SÜR, GRA-UI | ConditionsSystem v2 + `forecast` | `?scene=weather` `sceneReady`; Lead wetness tests green | M3 (L9) | `__APEX__.setConditions` and scene GUIs |
| **H-NIGHT** | ÇEV → GRA-3B | sunset + floodlit night rigs | night `buildEnvironment` has floodlights; `cevre/night-t8.png` | M3 (Ç2) | tune on the Sprint 1 night rig |
| **H-PIT** | YÖN → SÜR, TEST, GRA-UI | PitProcedure + `HudModel.pit` | Lead test "pit loss 20–24 s" green; `race-logic` shows phases | M3 (L10) | SÜR tests `pitAuto` in its own harness; UI uses mock `pit` |
| **H-STRAT** | SÜR → TEST | AI pit + weather calls | S-SM-10/14 pass in SÜR tests | M3 (S7) | TEST marks them `todo` |
| **H-SCN** | all → TEST | new scenes `race-logic`, `weather`, `showroom`, `hud`, `menu` (+ rain in `vfx`, wet/night in `track`) | file exists | continuous | E-SM-02 and gallery skip missing ids with a warning |

## 4. Yönetici (5173), shots in `test-results/screens/yon/`

### L0. Contract batch (M0)
- **Files:** `src/contracts/{replay,render,hud,debug,modules,events,ui,vehicle,track}.ts`, `src/game/modules.check.ts`. **Do:** §2 exactly, opt rule §0.4. **Accept:** typecheck/test/build green; post `L0 done` (H-C).

### L1. Session integration and loading (M1)
- **Files:** `src/main.ts`, `src/game/{session,renderFrame,loading}.ts`, `src/core/assets/**`.
- **Do:** app states `boot → title → mainMenu → … → loading → session → results` through `createUi()` (stub until H-UI). Loading: track, env, cars, then `renderer.compileAsync` for the 5 driving views + `tv`, dry and rain variants. Glue: `quality:changed` → `carVisuals.setQuality` + `vfx.setQuality`; flashback apply → `vfx.clear()`; sim events → `cameraRig.onSimEvent`; `setShake(settings.graphics.cameraShake)`; `setMotionEffects(!reducedMotion)`; `setTrack(track.query)`; `?nopost=1` → `setPostEnabled(false)`; collisions → `graphics.onCollision(impulse)`. Latch CR-14; rear slip per D-023.
- **Accept:** menu → first race frame ≤ 8 s at High (P-06); `renderer.info.programs.length` unchanged over 5 camera cycles after load; 3 consecutive `?mode=race&autostart=1&autodrive=1&laps=1` runs with `__APEX__.errors` empty.
- **Shots:** `loading.png`, `race-start-tv.png` (2 s after lights out), `race-cockpit.png`.

### L2. RaceDirector v2 (M1)
- **Files:** `src/race/{director,limits,penalties}.ts`, `src/race/__tests__/*.test.ts`, `src/race/sandbox/race-logic.scene.ts`.
- **Do:** rules §2 (5 lights × 1 s, seeded hold 0.2–3.0 s, > 0.5 m early = +5 s), §3 track limits (0.10 s, ≥ 60 km/h, strikes 1–2 warn, 3 black-and-white, 4+ = +5 s), §4 cut zones, §5 penalties, §6 flags/DRS (yellow per sector, blue at ≤ 1.0 s, DRS from leader's lap 3, 1.000 s detection), §9 classification and points 25-18-15-12-10-8-6-4-2-1. Minimal `?scene=race-logic`: dots on a 2D map + timing table.
- **Accept:** crossing time error < 1 ms vs analytic (S-SM-12); lights and hold in range over 50 seeds; 20-car tick ≤ 0.6 ms mean in Node (S-SM-15); one unit test per row of the rules §5 table. **Shot:** `race-logic.png`.

### L3. HudPresenter v2 (M1)
- **Files:** `src/game/hud/{presenter,notifications}.ts`, `src/game/hud/__tests__/*.test.ts`.
- **Do:** every CR-05 field at 30 Hz; tower `teamColor = colors.ui ?? colors.primary` (D-001); interval/leader gaps; deltas with `deltaRef`; notifications per ui-hud §3.1/§3.2 with D-002 coalescing (same `key` → same `id`, timer restarts), priority, eviction; start lights, flags, minimap, weather; `getHud()`.
- **Accept:** presenter + `updateHud` ≤ 1 ms per update; heap delta < 64 KB over 1,000 updates (`--expose-gc`); I-01, I-02 green.

### L4. Results and session end (M1, closes M1)
- **Do:** `ResultsModel` (CR-12); results 4 s after the player finishes, on the TV camera; retire → projected classification (rules §9); restart, quitToMenu, `session:ended`; `__APEX__.ui.screen()` via CR-17.
- **Accept:** E-RC-01 passes locally (20 sorted rows, correct points, fastest lap marked); post H-RACE. **Shot:** `results.png`.

### L5. Flashback (M2)
- **Files:** `src/game/flashback.ts`. **Do:** rules §11, ui-hud §5: 10 Hz × 15 s history, preview restore while scrubbing, apply → `flashbacksLeft − 1` + `vfx.clear()` + time-scale ramp 0.25 → 1 over 0.8 s wall clock; cancel restores "now"; TT → `lapInvalidated` `flashback`.
- **Accept:** S-SM-13 (rewind 10 s → equal hash); E-RC-03 locally. **Shot:** `flashback.png`.

### L6. MFD, PlayerStrategy, settings persistence (M2)
- **Files:** `src/game/strategy.ts`, `src/core/settings/**`. **Do:** ui-hud §4 (Tab, 1–4, 8 s auto-close, suggested compound); `PlayerStrategy` → `DriverControls` (CR-03) latched every tick; settings v1 + migration v0 → v1; D-004 scale default; `apexgp:v1:lastRaceSetup`.
- **Accept:** I-03; E-MN-02 locally; a brake-bias change shows in `getTelemetry()` within 1 tick.

### L7. Time Trial and ghost (M2)
- **Files:** `src/game/timeTrial.ts`, `src/game/ghost/**`. **Do:** rules §10; Backspace → s = L − 200 m at 200 km/h; PB with sectors in `apexgp:v1:tt:istanbul`, local top 10, `TimeTrialModel`; ghost per §2, appended with `isGhost: true`, `ghostAlpha = 0.35`, fading to 0 within 8 m of the player.
- **Accept:** I-05 (≤ 100 KB); E-TT-01 locally. **Shot:** `tt-ghost.png`.

### L8. Replay recording (M2, closes M2)
- **Files:** `src/game/replay/{recorder,player,codec}.ts`, `src/game/__tests__/replay.test.ts`.
- **Do:** CR-01; sample every 4th tick into pre-allocated 600-frame chunks; record only with `?record=1` or `cfg.record`; cap 8 min (28,800 frames ≈ 101 MB at 20 cars); allocation-free `frameAt`; `encodeReplay` = JSON header + raw Float32; `lastReplay()` (CR-18).
- **Accept:** I-04 exact at sample times; 3-lap encode + decode ≤ 1.5 s; 0 allocations in 10,000 `frameAt` calls; post H-REP.

### L9. ConditionsSystem v2 and forecast (M3)
- **Files:** `src/race/{conditions,weather,forecast}.ts`, `src/race/sandbox/weather.scene.ts`. **Do:** pit-weather §4 (presets, `generateWeatherTimeline`, cloud, wetness at dt 0.1 s, line drying, temperatures, weather events → `notify`) and §5 `forecast()` (pure).
- **Accept:** I-06; variable preset has a rain spell for seeds 1–20; post H-COND. **Shot:** `weather-variable-seed7.png`.

### L10. PitProcedure (M3)
- **Files:** `src/race/pit.ts`, `src/race/__tests__/pit.test.ts`. **Do:** pit-weather §2 state machine, §2.2 service times, §2.3 double stack, §2.4 safe release; speeding +5 s (rules §7); penalty served before work (§5); two-compound +30 s (§8); `HudModel.pit`, `mfd.pitLossS`, `mfd.rejoinPos`; pit phases in `race-logic`.
- **Accept:** player pit loss with pit assist 20–24 s; 0 deadlocks with 20 cars boxing on the same lap; E-RC-02 locally; post H-PIT. **Shot:** `race-logic-pit.png`.

### L11. TOD and weather plumbing (M3, closes M3)
- **Do:** setup `tod`/`weather` → `buildEnvironment(tod)` + `applyConditions` per frame; `compileAsync` warms night and rain variants; `?record=1` with weather active.
- **Accept:** P-04: `programs` unchanged after dry → heavy → dry in one session and after a flashback; night heavy-rain race loads ≤ 8 s.

### L12. Tightening and debug completion (M4)
- **Do:** make §0.4 opt members required where signalled; `PerfStats.hitches`, `heapMB`; `race-logic` gets pit, flag and penalty columns. **Accept:** typecheck green; TEST re-records the baseline.

## 5. Grafik-UI (5179), shots in `test-results/screens/gra-ui/`

### U0. Skills and reading (M0)
Load `frontend-design`, `emil-design-eng`, `ui-ux-pro-max` (if one fails, read `docs/design/skills/<skill>.md` and report it). Read DESIGN §2–§8, `implementation-handoff.md`, `example.html`, ui-hud §1–§9.

### U1. Foundation (M1)
- **Files:** `src/ui/styles/{tokens,fonts}.css`, `src/ui/format.ts`, `src/ui/__tests__/format.test.ts`; delete `src/ui/stub/*`.
- **Do:** handoff build order 1–4: tokens verbatim from DESIGN §2.2; 12 `@font-face` (`font-display: block`) + fonts gate; `--k = min(W/1920, H/1080) × hud.scale`; `format.ts` (`m:ss.mmm`, U+2212, TR `%57,5` / EN `57.5%`).
- **Accept:** tests cover every handoff step-4 case in TR and EN; `İSTANBUL CIRCUIT` from i18n (D-003); team names `lang="en"` (D-008); SVG arrows (D-007).

### U2. HUD (M1)
- **Files:** `src/ui/hud/**`, `src/ui/sandbox/{hud.scene,mockHud}.ts`.
- **Do:** DESIGN §6.1–§6.8 in the §5.1 boxes: tower (20 rows, white player row, auto-collapse above 1.1, D-005), timing panel (lap counter only here, D-006), wheel module (15 LEDs, gear, speed, DRS, ERS), tyres, minimap (canvas 240 × 200 on `--apx-panel`), weather strip, notification banner, start lights; `visible` full/minimal/off; 30 Hz direct writes (`textContent`, `transform`), no layout reads in the update path; `?scene=hud` animated mock, `&stress=1` = 10 notifications/s.
- **Accept:** `updateHud` ≤ 0.5 ms mean (`&perf=1` overlay); no `#FF4B1F` in the HUD (D-009); handoff "first artifact" items 1–2.
- **Shots:** `hud-1080-full.png`, `hud-scale-080.png`, `hud-scale-125.png` (collapsed), `hud-minimal.png`, `hud-en.png`.

### U3. Race-flow screens (M1)
- **Files:** `src/ui/screens/**`, `src/ui/focus/**`, `src/ui/sandbox/{menu.scene,mockStores}.ts`.
- **Do:** `title` (static wordmark DESIGN §8.1; any key → `audio.unlock()`), `mainMenu`, `raceConditions`, `teamSelect` (emits `ui:focusTeam`), `raceSettings`, `assists`, `loading`, `pause` (+ confirm, HAYIR focused), `results` (§6.14). Focus model §7.6, `data-focus-id` everywhere, CR-17 `screen()`. Showroom placeholder (§1.4.5) until H-SR.
- **Accept:** keyboard only; focus always visible (white row + vermilion notch); lists do not wrap; back restores the focused index; `?scene=menu&screen=<id>` opens each screen.
- **Shots:** `menu-title.png`, `menu-main.png`, `menu-team-select.png`, `menu-race-settings.png`, `menu-assists.png`, `menu-loading.png`, `menu-pause.png`, `menu-results.png`.

### U4. Go live (M1, closes M1)
Set `MODULE_STATUS = 'real'` (H-UI); run `/?mode=race&autostart=1&autodrive=1&laps=1` and the full menu path on 5179; fix gaps inside `src/ui`. **Accept:** menu → race → results without errors. **Shots:** `race-hud-live.png`, `race-results-live.png`.

### U5. Remaining screens and panels (M2)
`ttSetup`, `ttResults`, `credits`; `settings` with 7 tabs, toggle/slider/stepper/select/key chip (§6.12–§6.13), rebinding via `UiDeps.keys` with modifier rejection; MFD panel (§6.9, 5 pages); flashback timeline (§6.10). **Shots:** `menu-tt-setup.png`, `menu-tt-results.png`, `menu-settings-graphics.png`, `menu-settings-controls-rebind.png`, `menu-credits.png`, `hud-mfd-strategy.png`, `hud-mfd-ers.png`, `hud-flashback.png`.

### U6. Motion pass (M2, closes M2)
- **Skills:** `emilkowalski-motion`, `gsap-core`, `gsap-timeline`, `gsap-plugins` (Flip, CustomEase), `gsap-performance`.
- **Do:** DESIGN §7.1–§7.7: one CustomEase family (§7.2), controls 140–220 ms, only `transform`/`opacity`; GSAP only for notifications, tower Flip (§7.4), sector flash, menu transitions, start lights, results reveal; HUD numbers never tweened; `gsap.matchMedia()` for `prefers-reduced-motion` + `Settings.ui.animations` (reduced = opacity ≤ 120 ms only); `dispose()` kills every tween and timeline.
- **Accept:** P-05 `?scene=hud&stress=1` vs `&stress=0`, headed Ultra 30 s: FPS drop < 3 %; 5-place reorder = one Flip batch ≤ 2 ms main thread; `gsap.globalTimeline.getChildren().length` back to baseline after closing every screen (L-02).
- **Shots** (`--delay` mid-animation): `motion-tower-flip.png`, `motion-notification-enter.png`, `motion-reduced.png`.

### U7. Pit, penalty, weather states (M3)
`HudModel.pit` panel (limiter, speeding, box distance, service left), penalty chip, black-and-white/blue/chequered banners, weather strip + MFD weather page from `forecast`; legibility over night and rain. **Shots:** `hud-pit-limiter.png`, `hud-penalty.png`, `hud-night-heavy.png` (live, `tod=night&weather=heavy`), `hud-sunset.png`.

### U8. Title logo intro (M4)
Skill `frame-logo-outro`: segmented wordmark assembly, glow bloom, tagline; CSS/SVG only, ≤ 2.5 s, any key skips (and unlocks audio), once per page load; reduced motion = static wordmark, 120 ms fade. **Shots:** `intro-0500ms.png`, `intro-1500ms.png`, `intro-end.png`.

### U9. Polish (M4)
EN pass on every screen, accessibility (ui-hud §9), D-004 default, i18n parity. **Shots:** `menu-main-en.png`, `menu-settings-en.png`, `menu-results-en.png`.

## 6. Grafik-3B (5175), shots in `test-results/screens/gra-3b/`

### G1. Glue hooks (M1)
- **Do:** implement the L0 signatures exactly: D-019 `setQuality` on car visuals and VFX (pools rebuilt per preset), `vfx.clear()`; D-020 `onSimEvent` shake kicks, `setShake(k)`, `setMotionEffects(on)` (speed FOV + shake off), `setTrack(query)`; CR-02 `setView/view/setOverride`; D-021 `setPostEnabled`, `onCollision` (CA kick ≤ 150 ms). Verify in a full session on 5175; post `G1 done`.
- **Accept:** 20 preset switches mid-race leave geometries/textures at ±0 (L-03); `?nopost=1` renders. **Shots:** `race-chasefar.png`, `race-cockpit.png`, `race-nopost.png`, `race-tv.png`.

### G2. Showroom (M2)
`src/graphics/showroom/**`, `src/graphics/sandbox/showroom.scene.ts`; CR-15, DESIGN §1.4.5: turntable, studio light, livery switch within 1 frame (10 liveries preloaded). **Accept:** ≤ 120 draws; vsync-capped 144 FPS at High; no leak over 5 cycles; post H-SR. **Shots:** `showroom-anka.png`, `showroom-kestrel.png`, `showroom-menu-live.png`.

### G3. Steering-wheel display (M2)
CR-16, DESIGN §6.3: 512 × 256 `CanvasTexture`, redraw ≤ 30 Hz and only on change, ≤ 0.3 ms per redraw; gear, speed, delta, LEDs, ERS, DRS. **Shot:** `cockpit-wheel-t9.png`.

### G4. Ghost visual (M2)
`isGhost` → dithered alpha at `ghostAlpha`, LOD1, no shadow, no VFX, not in mirrors; post H-GH. **Shot:** `ghost.png`.

### G5. TV hero spots (M2, closes M2)
≥ 8 TV cameras (S/F, T1, T3, T8 ×2, T9, T12, pit), nearest-ahead selection, uses `setTrack`; frames gallery points `t8-tv` and `race-start`. **Shots:** `tv-t1.png`, `tv-t8.png`, `tv-race-start.png`.

### G6. Rain VFX (M3)
rendering §4.4, §8.2–§8.3: streaks, spray, rooster tail, lens droplets only in `cockpit`/`tcam`/`nose` (`RenderFrame.view`), pools per preset. **Accept:** heavy rain, 20 cars, Ultra: VFX ≤ 1.5 ms GPU; no new programs after warm-up. **Shots:** `vfx-rain-heavy.png`, `cockpit-droplets.png`, `race-heavy-spray-t1.png`.

### G7. Wet cars, brake glow, rain light (M3)
Wet clearcoat/roughness from conditions; disc glow from `brakeGlow`; `rainLight` 0/1/2 with 4 Hz flash. **Shots:** `car-wet.png`, `brake-glow-t12.png`, `rain-light-night.png`.

### G8. Night look with Çevre (M3, closes M3; after H-NIGHT)
Exposure, LUT per TOD (rendering §4.3), bloom threshold for floodlights; sunset grade (DESIGN §1.4.1). **Shots:** `night-t8.png`, `night-sf-chasefar.png`, `sunset-t1.png`.

### G9–G12 (M4, in this order)
- **G9 Mirrors** (rendering §7.6, `low30` 30 Hz / `high60`): ≤ 1.5 ms GPU at High. **Shot:** `cockpit-mirrors.png`.
- **G10 Heat haze** (Ultra only). **Shot:** `heat-haze-sf.png`.
- **G11 Programs:** cars + VFX + post + racing line ≤ 25 at High after warm-up (race total was 95, env 64–65); breakdown in the report.
- **G12 Simplified pit crew (last):** instanced crew of 8 per box, 3 poses (wait/work/release) from `inPitBox`; ≤ 2 draws, ≤ 20k tris. **Shot:** `pit-crew.png`.

## 7. Çevre (5174), shots in `test-results/screens/cevre/`

### Ç1. Shader-program merging (first)
- **Files:** `src/track/{mesh,scenery}/**`, `src/track/materials/shared.ts`.
- **Do:** shared `onBeforeCompile` chunks with a stable `customProgramCacheKey`; per-material `#define`s → uniforms; atlases for boards and buildings; add the wet uniforms now (`uRain`, `uWetness`, `uLineWet`, `uTime`, no-op when dry).
- **Accept:** env programs ≤ **30** at High after warm-up on `?scene=track&quality=high` (from 64–65; race total ≤ 55 = env 30 + graphics 25); calls and tris ≤ +5 %; same look. **Shots:** `merge-sf-before.png`, `merge-sf-after.png`, `merge-t8-after.png`.

### Ç2. Sunset and night rigs, floodlights (M3)
- **Do:** rendering §5.2 rigs, DESIGN §1.4.1 sunset; floodlights = instanced poles (≤ 2 draws) + baked light-pool lightmap along the ribbon (s × d texture) + glow sprites (1 draw) + emissive lamp heads for bloom; no new dynamic or shadowed lights.
- **Accept:** night High env ≤ 200 calls (≤ +12 vs day); Ultra C ≥ 50 FPS in a TEST run; post H-NIGHT. **Shots:** `night-sf.png`, `night-t8.png`, `night-t12.png`, `sunset-sf.png`, `sunset-t1.png`.

### Ç3. Wet track shader (M3)
- **Do:** puddles in low/flat spots (elevation-curvature mask, visible at W > 0.4); ripples when `rain > 0`; racing line dries first (`lineWetness` via the 1D line texture); wet reflections via lower roughness on PMREM (no SSR).
- **Accept:** 0 new programs (uniform variants only); `?scene=track&weather=heavy` matches H-COND values. **Shots:** `wet-t1-heavy.png`, `wet-sf-drying.png` (W 0.4, line 0.1), `wet-night-heavy-t8.png`.

### Ç4. Pit lane, pit building, T8 placeholders (M3)
Box markings in team colours (`colors.ui ?? primary`), garage interiors, speed-limit boards, line markings, pit-wall gantry; facade window bands and fictional team branding (DESIGN §1.4.3, TEAM-RULES §9); replace the 2 grey boxes at T8. **Accept:** ≤ +10 calls. **Shots:** `pit-lane.png` (gallery `pit` pose), `pit-building.png`, `t8-buildings.png`.

### Ç5. Alpha-to-coverage and polish (M4)
Alpha-to-coverage on distant fences and boards; sunset tuning. **Shot:** `fence-a2c-t3.png`.

## 8. Sürüş (5176), shots in `test-results/screens/surus/`

### S1. AI pace calibration (M1)
`src/ai/speedProfile.ts` (`ACHIEVABLE_MU`, `AI_MARGIN`), `src/ai/__tests__/calibration.test.ts`. **Accept:** d = 100, dry, Medium, 10 kg: 1:24.0–1:27.0 (S-SM-04); sectors 33/36/31 % ± 2 (S-SM-05); T8 peak 4.5–5.5 g (S-SM-08); back straight DRS + ERS 320–335 km/h (S-SM-09); laps for d = 0/70/110 reported and monotonic. **Shot:** `ai-calibration.png` (`?scene=ai` overlay).

### S2. Start racecraft (M1)
**Accept:** S-SM-11 (no AI jump start over 20 seeds; lap 1 ≤ 2 collisions > 5 kN·s); S-SM-06 (20 × 3 laps all finish, ≤ 1 off-track per car per lap, no car stuck > 4 s); post H-AI. **Shot:** `ai-start.png`.

### S3. Contract migration after H-C (M1, closes M1)
CR-13 `aux`/`tuning` replace the `// CR-13` internals; CR-14 `steerSensitivity` scales the keyboard steer rate. **Accept:** `keyboardFeel.test.ts` still 98–108 s; 3 s throttle → > 100 km/h (E-RC-04).

### S4. Tyre thermal and wear (M2)
**Accept** (report §5.4): (a) Medium blanket → 95–105 °C core in one push lap; (c) slow lap cools 10–15 °C (now 15.8); (d) Soft ≈ +15 °C after 3 push laps; wear 0.7 at Soft 18 / Medium 28 / Hard 38 laps (wearScale 1, d = 100).

### S5. Racecraft (M2, closes M2)
Attack/defend, blue-flag yield (report §6.5), collision avoidance, slipstream and dirty air (report §5, 30 m, ClA × (1 − 0.22·dirty)). **Accept:** 10-lap 20-car sim ≥ 15 overtakes, ≤ 3 contacts > 5 kN·s; lapped car yields within 3 s of its blue flag; S-SM-02 holds mid-overtake.

### S6. Wet compounds and deltas (M3)
**Accept:** S-SM-07 (Inters W 0.5 +8–13 %; Wets W 1 +15–22 %; slicks W 0.6 ≥ +25 %); §5.4 (e) slick ≈ 60 °C within one lap at W > 0.5. **Shot:** `wet-deltas.png`.

### S7. Pit-lane driving and AI strategy (M3, after H-PIT + H-COND)
`pitAuto` per pit-weather §2 and limiter 80 km/h (§2.5); strategy per §3 (templates, stop lap `min(0.85·life/wearScale, 0.45·N) ± 2`, wear ≥ 0.72, `lineWetness` thresholds ± 0.04, forecast via CR-10). **Accept:** S-SM-10 (15-lap dry: everyone stops, two-compound rule met, pit loss 20–24 s); S-SM-14 (Inters within 2 laps of W ≥ 0.18); post H-STRAT.

### S8. Audio extras (M4)
audio.md §5 AI voices with doppler (nearest N, count in `__APEX__.audio().voices`); §3 tyres/surfaces/kerbs; §4 wind, rain, crowd; §6 UI sounds from `ui:sound` (CR-11), start and pit beeps; §7 pause/flashback states; §8 buses and ducking. **Accept:** audio ≤ 1 ms per frame with 20 cars. **Shot:** `audio-bus-meters.png`.

### S9. `renderReplayAudio` (M4, CR-08, audio.md §9)
**Accept:** 30 s of a 20-car replay at 48 kHz in ≤ 20 s wall time; two renders give identical sample hashes (pre-checks E-AU-02); `?scene=audio&offline=1` works (E-AU-01).

## 9. Testçi (5177), shots in `test-results/screens/testci/`
Spec: `testing-qc.md` §1–§4; ids in test titles; errors fixture on every spec.

- **T0 (M0, after H-C):** re-record the baseline (§0.8); extend `tests/arch` for new contract files.
- **T1 (M1) E2E:** `tests/e2e/{race,keyboard,scenes}.spec.ts`: E-RC-01 (`?mode=race&autostart=1&autodrive=1&laps=1` → lights → finish → 20-row results, timeout ≤ 4 min); E-RC-04 via `__APEX__.input.press`; E-SM-02 with the new ids. **Shot:** `e2e-results.png`.
- **T2 (M1) sim:** `tests/sim/{calibration,race-logic,start,perf}.test.ts`: S-SM-04, 05, 06, 08, 09, 11, 12, 15 cross-module through `createSim`.
- **T3 (M1) integration:** I-01, I-02 (extend `tests/integration/hud-presenter.test.ts`).
- **T4 (M1) perf baseline, headed:** `scripts/perf.mjs --uncapped`, scenarios A and C at High and Ultra → `docs/qa/test-perf.md` with a program breakdown per module.
- **T5 (M2):** E-MN-01/02/03, E-TT-01, E-RC-03, E-A11-01 (`emulateMedia({ reducedMotion: 'reduce' })`: computed `transition-duration` 0, no live GSAP tweens); S-SM-13; I-03, I-04, I-05; P-05 (headed); L-02. **Shots:** `e2e-flashback.png`, `e2e-tt-ghost.png`, `e2e-reduced-motion.png`, `e2e-settings-reload.png`.
- **T6 (M3):** S-SM-07, 10, 14; I-06; E-RC-02 (MFD `mfdNext` + `mfd1` on lap 1 of 3 → 1 stop, compound changed). **Gallery matrix** (E-SH-01/V-01, `gallery/<point>-<tod>-<weather>-<preset>.png`): 7 points × 6 conditions at High (42) + `sf`, `t8` × 6 conditions × {Low, Ultra} (24) + `race-start` × 6 (6) + `t8-tv` day-dry (1) = **73**, each luma σ > 8. **Shot:** `e2e-pit.png`.
- **T7 (M4, headed):** P-01 A/B/C × 4 presets (two runs, keep the lower); P-02, P-03, P-04 (camera cycle, weather change, flashback), P-06; L-01, L-03; E-AU-01. Reports `docs/qa/test-perf.md`, `docs/qa/test-sprint-2.md` (pass/fail per id; bugs per testing-qc §7 with owner).

## 10. Sprint 2 QC gate (Kalite, 5178, writes `docs/qa/qc-sprint-2.md`)

| # | Check | Pass rule |
|---|---|---|
| 1 | Build health | typecheck, `npm test`, build green |
| 2 | Contracts | Lead-only changes; L0/L12 match §2; baseline re-recorded; no `// CR-xx` leftovers for applied CRs |
| 3 | Console errors | **0** across all E2E, gallery and perf runs (`__APEX__.errors` empty) |
| 4 | End to end | QC plays menu → 20-car race → results by keyboard on 5178; E-RC-01…04, E-MN-01…03, E-TT-01 green |
| 5 | Sim / integration | S-SM-01…15 and I-01…I-06 green |
| 6 | **FPS** (P-01, headed, uncapped, 20 cars) | High A ≥ **100**; Ultra A ≥ **60**; worst case Ultra C (night + heavy) ≥ **50**; p95 per ARCHITECTURE §12 |
| 7 | **UI motion cost** | P-05 drop < **3 %**; in-race `ui.animations` on vs off < **3 %** |
| 8 | Programs, hitches | High ≤ 55 after warm-up (env ≤ 30, graphics ≤ 25); P-04 no new programs after camera cycle, weather change, flashback; `hitches = 0` after 3 s |
| 9 | Budgets, load | P-02 draws/tris per ARCHITECTURE §12 at all gallery points; load ≤ 8 s (P-06) |
| 10 | Leaks | L-01…L-03 within gates |
| 11 | Motion rules | 140–220 ms; transform/opacity only; one ease family; HUD numbers untweened; reduced motion honoured (E-A11-01); tweens killed on dispose |
| 12 | Visual | every §4–§9 screenshot exists and was viewed; 73 gallery shots not blank; HUD matches DESIGN (no vermilion in race HUD, D-009); night and rain convincing; no z-fighting or pop-in |
| 13 | Driving feel | QC drives 3 laps at default assists: steering predictable, no AI start chaos, pit and flashback smooth |
| 14 | Determinism | S-SM-01/02 with pit and weather active; I-04 exact |
| 15 | IP | `grep -ri "formula 1\|formula1\|\bF1\b"` over `src/`, `public/` empty; no real names |
| 16 | Assets, i18n | credits complete; parity green; every screen checked in TR and EN |

**Severity:** rows 1–4 and 15 are **P0**. Rows 6–8 are **P1**, except a result below 80 % of the gate (High < 80, Ultra < 48, worst case < 40, UI motion ≥ 6 %), which is **P0**. Other rows are P1 unless QC justifies P2.

## 11. Exit criteria
1. PLAN acceptance: menu → 20-car race → results plays end to end; UI motion does not lower FPS (row 7).
2. testing-qc §6 S2 row: HUD and menus complete with motion; E-MN, E-RC, E-TT, E-A11, E-AU green; S-SM-04…14 green; AI calibrated; pit, weather, flashback, ghost and replay recording work; perf measured.
3. No open P0 in §10; open P1s go to the Sprint 4 fix plan with an owner.
4. `M1`…`M4 DONE` lines in every progress file. If usage limits end the sprint early, the orchestrator commits the last green state at the highest completed milestone and carries the rest, in the same order, into Sprint 2b.
5. Orchestrator commits `sprint-2`.
