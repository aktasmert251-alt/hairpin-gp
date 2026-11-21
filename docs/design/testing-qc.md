# Testing and quality control

> Owner: Planner. Users: **Testçi** (writes and runs tests), **Kalite Kontrolcü** (reviews), every module owner (unit tests).
> Thresholds come from PLAN Ek E and planner-report §5.11; where this file is more specific it refines them, never relaxes them.
> Layers, folders and commands: `docs/ARCHITECTURE.md` §13. Perf protocol: `docs/design/rendering.md` §11.2.

## 1. Gates that apply to every automated run
- `window.__APEX__.errors` is empty and no `console.error` was logged (fixture in `tests/helpers/fixtures.ts`).
- Every E2E test starts from a clean `localStorage` unless it tests persistence.
- Tests never use `Math.random`; seeds are explicit and printed on failure.
- Test ids below (`U-`, `S-`, `I-`, `E-`, `P-`, `L-`, `V-`) appear in test titles so reports can reference them.

---

## 2. Test catalogue

### 2.1 Module unit tests (owner writes; `src/<module>/__tests__/`)

| Id | Module | Test | Threshold | Sprint |
|---|---|---|---|---|
| U-TR-01 | track | loop closed | end gap < 0.5 m, tangent jump < 1° | 1 |
| U-TR-02 | track | length | 5,300–5,400 m | 1 |
| U-TR-03 | track | corner direction sequence | exactly `L R L R L L R L L R R L R L` | 1 |
| U-TR-04 | track | net heading change | +360° ± 1° | 1 |
| U-TR-05 | track | `worldFromSD` ↔ `project` round trip | < 2 cm on 10,000 seeded samples | 1 |
| U-TR-06 | track | walls continuous | gaps < 0.5 m except pit entry/exit | 1 |
| U-TR-07 | track | grid inside limits, pit connected, boxes inside limiter zone | all true | 1 |
| U-TR-08 | track | `ground()` speed | ≤ 1 µs mean over 1 M calls | 1 |
| U-TR-09 | track | build determinism and time | identical hash; ≤ 150 ms | 1 |
| U-PH-01…15 | physics | §5.11 benches: 0–100 (2.5–2.9 s), 0–200 (4.6–5.4 s), 0–300 (10.0–12.5 s), top speed 322–332 km/h, DRS +9…+15 km/h, ES empty 300–310 km/h, 200→0 50–65 m, 300→100 70–95 m, peak decel at 300 km/h 4.5–5.5 g, lateral 1.9–2.4 g at 80 km/h, 4.3–5.2 g at 250 km/h | ranges as listed | 1 |
| U-PH-16 | physics | standstill jitter | < 1 mm/s over 10 s | 1 |
| U-PH-17 | physics | random-input fuzz | 10 min sim time, no NaN, no reset loops | 1 |
| U-PH-18 | physics | determinism | same seed + inputs → same `hash()` after 60 s | 1 |
| U-PH-19 | physics | tyre thermal targets (a)–(e) of §5.4 | as specified | 1 |
| U-PH-20 | physics | keyboard filter ramps | full lock 0.25 s at 0 km/h, 0.62 s ≥ 288 km/h (±5 %) | 1 |
| U-PH-21 | physics | zero allocation in `step()` | heap delta < 64 KB over 100k ticks (`--expose-gc`) | 1 |
| U-AI-01 | ai | racing line build | ≤ 60 ms; inside edges − 1.3 m everywhere | 1 |
| U-AI-02 | ai | `prepare` | ≤ 300 ms for 20 cars | 1 |
| U-AI-03 | ai | difficulty table (§6.4) | values at d = 0, 50, 100, 110 within 0.005 | 1 |
| U-RC-01 | race | points table | 25-18-15-12-10-8-6-4-2-1, none for P11+, no fastest-lap point | 2 |
| U-RC-02 | race | classification order incl. penalties and laps down | rules.md §8 cases | 2 |
| U-RC-03 | race | weather timeline determinism and bounds | same seed → same keyframes; rain ∈ [0, 1] | 2 |
| U-RC-04 | race | wetness/drying equations | pit-weather.md §4.4 checkpoints ± 5 % | 2 |
| U-GR-01 | graphics | `QUALITY_PRESETS` match rendering.md §10 | deep equal to a fixture | 1 |
| U-GR-02 | graphics | LUT identity | neutral grade maps every lattice point to itself within 1/255 | 1 |
| U-UI-01 | ui | `format.ts` | `84567 → "1:24.567"`, gaps, `+1 TUR` / `+1 LAP`, tr-TR uppercase `"istanbul" → "İSTANBUL"` | 2 |
| U-AU-01 | audio | graph builds on `OfflineAudioContext` | runs in browser via `?scene=audio&offline=1`; covered by E-AU-01 | 1 |

### 2.2 Static and architecture (`tests/arch/`)

| Id | Test | Rule |
|---|---|---|
| S-AR-01 | layer imports | ARCHITECTURE §1.2 items 1–5 |
| S-AR-02 | i18n parity | identical key sets and `{param}` names TR/EN per namespace |
| S-AR-03 | dependency resolution | `three`, `postprocessing`, `n8ao`, `gsap` resolve inside the project `node_modules`; one `three` copy; versions = PLAN table |
| S-AR-04 | IP words | no `F1`, `Formula 1`, `Formula1` (case-insensitive, word boundary) in `src/`, `public/`, `index.html` |
| S-AR-05 | contracts frozen | `src/contracts/**` hash equals the value recorded at the last sprint commit unless the sprint is a Lead CR sprint |

### 2.3 Sim tests (`tests/sim/`, headless `createSim`)

| Id | Test | Threshold | Sprint |
|---|---|---|---|
| S-SM-01 | determinism, full field | 20 cars, seed 1234, 60 s, run twice → equal `hash()` | 1 |
| S-SM-02 | snapshot/restore | snapshot at 20 s → run to 40 s → restore → run to 40 s → equal hash | 1 |
| S-SM-03 | single writer | each system run with foreign sub-objects frozen, 600 ticks, no throw | 1 |
| S-SM-04 | AI lap time | d = 100, dry, Medium, 10 kg fuel, İstanbul: 1:24.0–1:27.0 | 2 |
| S-SM-05 | sector split | 33 % / 36 % / 31 % ± 2 points | 2 |
| S-SM-06 | 20 cars × 3 laps | all finish, ≤ 1 off-track per car per lap, no car stuck > 4 s | 2 |
| S-SM-07 | wet deltas | Inters at W = 0.5: +8–13 %; Wets at W = 1: +15–22 %; slicks at W = 0.6: ≥ +25 % | 2 |
| S-SM-08 | T8 lateral g | AI d = 100 peak 4.5–5.5 g | 2 |
| S-SM-09 | back straight speed | s ≈ 4,500 with DRS + ERS: 320–335 km/h | 2 |
| S-SM-10 | pit strategy | 15-lap dry race, 20 cars: everyone stops ≥ 1×, two-compound rule satisfied by all AI, no pit deadlock, pit loss 20–24 s | 2 |
| S-SM-11 | start | lights sequence 5 × 1 s, hold 0.2–3.0 s (seeded), no AI jump start, no first-lap pile-up (≤ 2 collisions > 5 kN·s) | 2 |
| S-SM-12 | race logic | timing error < 1 ms vs analytic crossing; positions, gaps, laps down, penalties, flags | 2 |
| S-SM-13 | flashback | rewind 10 s restores state hash; `flashbacksLeft` decremented and kept; TT lap invalid | 2 |
| S-SM-14 | weather | variable preset: rain spell occurs; wetness rises/dries per equations; AI switches to Inters within 2 laps of W ≥ 0.18 | 2 |
| S-SM-15 | performance | one tick, 20 cars ≤ 0.6 ms mean in Node | 2 |

### 2.4 Integration (`tests/integration/`)

| Id | Test | Sprint |
|---|---|---|
| I-01 | HudPresenter builds a valid `HudModel` from a running sim (all fields finite, tower sorted) | 2 |
| I-02 | Notification queue priority/eviction rules (ui-hud.md §3) | 2 |
| I-03 | Settings migration v0 → v1, corrupt JSON → defaults with one warning | 2 |
| I-04 | Replay record → encode → decode → `frameAt` equals recorded samples (exact at sample times) | 2 |
| I-05 | Ghost record/playback round trip, base64 size ≤ 100 KB | 2 |
| I-06 | Forecast function is deterministic and identical for presenter and AI | 2 |

### 2.5 E2E (`tests/e2e/`, Playwright, system Chrome, headless unless noted)

| Id | Flow | Pass rule | Sprint |
|---|---|---|---|
| E-SM-01 | `?scene=skeleton` | `sceneReady`, no errors | 1 |
| E-SM-02 | every sandbox scene id | loads, `sceneReady` ≤ 15 s, no errors | 1–2 |
| E-MN-01 | boot → title → key → main menu → every screen by keyboard only → back to main menu | `__APEX__.ui.screen()` sequence correct; `focusId()` never null on interactive screens | 2 |
| E-MN-02 | settings persist | change language, HUD mode, a binding → reload → values kept | 2 |
| E-MN-03 | rebinding | rebind throttle to `KeyI`; Ctrl+K rejected (`modifier`); reset restores defaults | 2 |
| E-RC-01 | full race | `?mode=race&autostart=1&autodrive=1&laps=1` → lights → finish → results screen with 20 rows | 2 |
| E-RC-02 | pit stop | `autodrive` + box request on lap 1 of 3 → stop happens, compound changes, results show 1 stop | 2 |
| E-RC-03 | flashback | drive 12 s → `flashback` → scrub −5 s → confirm → `getRace().race.raceMs` decreased by ≈ 5 s, `flashbacksLeft` − 1 | 2 |
| E-RC-04 | keyboard driving | press throttle 3 s → kmh > 100; steer left 1 s → yaw rate > 0; brake → stop | 2 |
| E-TT-01 | time trial | 2 laps autodrive → PB saved → reload → TT setup shows PB; ghost on lap 2 | 2 |
| E-A11-01 | reduced motion | `page.emulateMedia({ reducedMotion: 'reduce' })` + `ui.animations = 'auto'` → no element animates (computed `transition-duration` 0 / GSAP disabled) | 2 |
| E-AU-01 | audio | title key press → `__APEX__.audio().unlocked`; `?scene=audio&offline=1` renders | 2 |
| E-AU-02 | offline audio determinism | rendering the same replay twice gives bit-identical buffers (audio.md §9) | 5b |
| E-SH-01 | screenshot matrix | §3 points × matrix, PNG not blank (luma σ > 8) | 2–3 |

### 2.6 Performance (`tests/perf/`, headed)

| Id | Test | Gate |
|---|---|---|
| P-01 | FPS scenarios A/B/C × 4 presets (rendering.md §11.2) | Ultra A ≥ 60, High A ≥ 100, Ultra C ≥ 50 |
| P-02 | renderer budgets at screenshot points | ARCHITECTURE §12 draw calls / triangles per preset |
| P-03 | sim overrun | `simOverrun = 0` on High |
| P-04 | shader hitches | `programs` unchanged after warm-up across camera cycles, weather change, flashback; `hitches = 0` |
| P-05 | UI stress | `?scene=hud&stress=1` vs baseline: FPS drop < 3 % |
| P-06 | load time | menu → first race frame ≤ 8 s (High) |

### 2.7 Leak (`tests/leak/`)

| Id | Test | Gate |
|---|---|---|
| L-01 | 5 × (start race → 10 s → quit to menu) | `renderer.info.memory.geometries` and `.textures` within ± 2 % of run 1; JS heap within + 10 % |
| L-02 | 5 × open/close every menu screen | DOM node count and GSAP global timeline children back to baseline |
| L-03 | 5 × quality preset switch | render targets and programs stable after the second cycle |

### 2.8 Visual (`tests/visual/`, review by QC and the orchestrator)
- V-01 screenshot matrix (§3), V-02 car showroom per team, V-03 HUD in all modes (full, minimal, off) in TR and EN, V-04 every menu screen in TR and EN, V-05 F1 25 visual checklist (§5.3).
- Visual tests have no pixel-diff gate. They fail only on blank/black frames or console errors; quality is judged by QC with the checklists.

---

## 3. Screenshot points (İstanbul)

`s` values are on the OSM basis of 5,351.5 m (report §7.3). Convert with `s_final = s · L / 5351.5`, where `L = track.data.length`. `d` is positive to the left. Procedure per shot:
`startSession({ mode: 'timeTrial', tod, weather, seed: 777, autodrive: true, skipLights: true })` → `setConditions({ rain, wetness })` → `teleport(0, s, d, kmh)` → `setCamera(view)` → wait 90 frames → `pause()` → wait 2 frames → screenshot.

| Point | `s` | `d` | km/h | View | Look for |
|---|---|---|---|---|---|
| `sf` | 5,300 | 0 | 0 | `chaseFar` | start gantry (s 0), main grandstand (right), pit wall and building (left), grid boxes |
| `t1` | 150 | −4.0 | 280 | `chaseNear` | T1 braking boards, apex kerb (left), hill bleachers, drop after apex |
| `t3` | 930 | +1.0 | 210 | `chaseNear` | crest (highest point), sky, blind left |
| `t8` | 2,392 | −2.0 | 270 | `chaseFar` | multi-apex left, outside bleachers, gravel second half, sparks bump |
| `t9` | 3,230 | −2.5 | 140 | `cockpit` | steep downhill braking, lowest point, halo and wheel in frame |
| `t12` | 4,600 | −3.0 | 320 | `chaseNear` | biggest braking zone, DRS end board, T12 bleachers |
| `pit` | 5,150 | 0 | 0 | `freeCam(pos = worldFromSD(5150, +4) + 6 m up, look = worldFromSD(5190, +16))` | pit lane, pit wall, garages with team colours |
| `t8-tv` | 2,392 | 0 | 270 | `tv` | TV hero framing (Sprint 2+) |
| `race-start` | race from the grid, 19 AI, capture 2.0 s after `lightsOut` | – | – | `tv` (T1 hero) | field into T1, spray/smoke |

**Conditions matrix** (`rain` / `wetness` set explicitly): day-dry (0 / 0), day-heavy (0.9 / 0.95), sunset-dry (0 / 0), sunset-light (0.35 / 0.40), night-dry (0 / 0), night-heavy (0.9 / 0.95). Main gallery = 7 points (`sf` … `pit`) × 6 conditions on High = 42 shots; plus `sf` and `t8` on Low and Ultra (day-dry) and `race-start` in all 6 conditions.
**File names:** `test-results/screens/gallery/<point>-<tod>-<weather>-<preset>.png`; index in `test-results/screens/gallery/index.json`.

---

## 4. Perf protocol (summary)
Headed system Chrome, flags and validity rules of rendering.md §11.2; scenarios A (day dry), B (sunset light), C (night heavy); 10 s warm-up, 30 s sample, two runs, keep the lower; JSON to `test-results/perf/`; summary in `docs/qa/test-perf.md` with GPU string, preset, scenario, FPS, p95, draw calls, triangles, programs, hitches, overruns. Perf runs happen at the end of Sprints 1 (scene-level), 2, 3 and 4, and before `v1.0`.

---

## 5. QC checklists (Kalite Kontrolcü)

Every finding: id, P0/P1/P2, owner role, evidence (`file:line`, screenshot path, `renderer.info` numbers or telemetry), concrete fix. Reports go to `docs/qa/qc-*.md`.

### 5.1 Code

| # | Check | How |
|---|---|---|
| C1 | Contracts respected; no local copies of contract interfaces | S-AR-01, read factories against `modules.ts` |
| C2 | Single-writer rule | grep assignments per system against ARCHITECTURE §4.1 and §4.3 |
| C3 | No `three`/DOM/`Math.random`/`Date.now` in sim | S-AR-01 + spot review |
| C4 | No allocations in hot loops | review `physics/vehicle`, `ai/controller`, `track/query`, `race/raceDirector`, `game/renderFrame.ts`, `game/hud/HudPresenter.ts`, `ui/hud/*`, `audio/*update*`, `graphics/vfx/*`, `graphics/camera/*` |
| C5 | `dispose()` complete and idempotent (GPU resources, DOM, listeners, bus, AudioNodes, GSAP) | review + L-01…L-03 |
| C6 | Determinism | seeded RNG only; stable sorts with id tie-breaks; S-SM-01/02 green |
| C7 | Errors | no `console.error` on normal paths; NaN guard present; WebGL loss handled |
| C8 | Keyboard | `KeyboardEvent.code`, no Ctrl/Alt/Meta, `preventDefault` on game keys |
| C9 | i18n | no hard-coded UI strings; parity green; casing via `format.ts` or CSS under the right `lang`; D-003 track names and D-008 team names respected |
| C10 | TypeScript | strict, no `any`, no `@ts-ignore` |
| C11 | UI perf hygiene | only `transform`/`opacity` animated; no layout reads after writes in `updateHud`; HUD numbers not tweened |

### 5.2 Performance

| # | Check | Gate |
|---|---|---|
| PF1 | FPS gates (P-01) | Ultra A ≥ 60, High A ≥ 100, Ultra C ≥ 50 |
| PF2 | Draw calls, triangles, programs (P-02, P-04) | ARCHITECTURE §12 |
| PF3 | Shader-compile hitches | none after warm-up (camera cycle, weather change, flashback, results screen) |
| PF4 | Sim overruns | 0 on High |
| PF5 | Memory and leaks | heap ≤ 400 MB; L-01…L-03 green |
| PF6 | UI animation cost | P-05 drop < 3 % |
| PF7 | Load time | ≤ 8 s (High) |
| PF8 | Regeneration rates | PMREM ≤ 1 per 2 s, LUT ≤ 1 per s (counters in the F8 overlay) |

### 5.3 Visual (F1 25 reference qualities, never copied layouts)
Judge from the §3 gallery and the `car` scene. Each item: pass / P1 / P2.
- **Car:** V1 2025 silhouette and proportions (low nose, 4-element front wing, halo, sidepod undercut, fin, beam wing, DRS rear wing; 5.6 m long, 3.6 m wheelbase). V2 18" wheels with covers; ORBIS sidewall; compound band colour correct for S/M/H/I/W. V3 paint finishes read as specified in DESIGN.md §1.4.4 (gloss mirrors the sky gradient, matte never mirror-like, metallic flake); carbon weave visible close, no moiré far. V4 each team reads as its dominant body colour at LOD1 distance; numbers legible in the showroom. V5 brake glow only under heavy braking from speed (night T12). V6 rain light on in the wet, flashing with the pit limiter. V7 T-cam black (driver 1) / yellow (driver 2). V8 contact shadows, no peter-panning, no acne.
- **Track and environment:** V9 asphalt scale and no visible tiling at 50 m; rubbered line visible. V10 red/white flat kerbs with sawtooth edges; yellow sausage kerbs at T1, T9, T10, T12, T14. V11 painted run-off bands at T1, T3, T12, T14 and T8 entry; gravel at T4, T7, T8 (second half), T9. V12 elevation reads (T1 drop, T3 crest, T8 plateau, T9 dive). V13 grandstands with a varied, moving crowd; pit building and garages. V14 barriers match type per zone; catch fences at stands. V15 trees and backdrop without visible billboard rotation or pop-in under 150 m. V16 sky and light per DESIGN.md §1.4.1 for each TOD; floodlights white, sodium only at the horizon, no purple/blue glows. V17 wet look: darker glossy asphalt, puddles in heavy rain, drying line, spray and rooster tails, lens droplets. V18 aerial perspective at distance.
- **Image quality:** V19 no z-fighting, shimmering or shadow swimming. V20 no car LOD pop within 30 m. V21 post subtle: no daylight bloom blow-out, AO subtle, CA barely perceptible, vignette subtle. V22 exposure: day not washed out, night track readable, sunset not oversaturated.
- **Cameras:** V23 cockpit shows halo and wheel; head motion subtle. V24 chase stable at 300 km/h, no jitter.

### 5.4 UI
- U1 `web-design-guidelines` audit of `src/ui/**` (load the skill); findings as `file:line`; P0 = 0 to pass.
- U2 DESIGN.md compliance: tokens, fonts (D-007), 12° slant, apex-notch focus, white player row, no vermilion in the race HUD (D-009).
- U3 Motion: control transitions 140–220 ms, transform/opacity only, one easing family, spring damping ≥ 0.72, no GSAP on HUD numbers, `prefers-reduced-motion` and `ui.animations` honoured.
- U4 Keyboard: every screen navigable by keyboard only; focus always visible; Esc/Backspace go back; no traps; rebinding rejects modifiers.
- U5 Copy: TR default, EN complete; tr-TR casing (İ/ı); no truncation at 1280 × 720 and 1920 × 1080; tabular numbers; U+2212 minus (D-007).
- U6 Layout: broadcast hierarchy per PLAN Ek C without copying F1 25 layouts; `hud.scale` 0.8–1.25 overlap-free; tower auto-collapse above 1.1 (D-005); lap counter only in the timing panel (D-006).
- U7 Contrast: body text ≥ 4.5:1, large numerals and team strips ≥ 3:1 (D-001); colour never the only carrier of meaning.
- U8 Notifications: priority, coalescing by key (D-002), no overlap; stress FPS drop < 3 %.
- U9 Required states exist: loading, empty (no PB yet), error (no WebGL2, context lost).
- U10 (Sprint 4, D-010) Colour-vision-deficiency check of team strips, especially Anka/Zephyr and Aurora/Kestrel, with simulated protanopia/deuteranopia/tritanopia screenshots.

### 5.5 Driving feel
QC drives 3 laps per assist preset (Beginner, Intermediate, Expert) on day-dry and 2 laps in heavy rain on Inters and Wets, records lap times from `getTelemetry()`, and scores each item 1–5 (pass ≥ 4):
D1 keyboard steering predictable (tap vs hold, no snap on release, counter-steer assist works) · D2 straight-line stability at 300 km/h · D3 threshold braking with the keyboard limiter; lock-ups audible/visible; ABS off still drivable · D4 TC levels distinct; wheelspin out of T7, T9, T14 with TC off · D5 flat kerbs usable, sausage kerbs unsettle, no launches · D6 grass/gravel slow the car sensibly; recovery not frustrating · D7 wet grip consistent with tyre choice; crossovers felt · D8 auto shift points sensible; manual shifts instant; limiter audible · D9 DRS gain noticeable; ERS overtake works within budget · D10 AI start not chaotic, no ramming, blue flags respected, credible overtakes, fair defending · D11 pit flow smooth; pit assist works; ≈ 22 s loss · D12 flashback instant and consistent · D13 sense of speed; no discomfort with motion effects off.

### 5.6 Trailer critique (Sprint 5b, motion-design loop; default verdict "reject")
Score each criterion 0–10 from contact sheets (one frame every 0.5 s) and the full-speed MP4; every criterion needs ≥ 8:

| Criterion | 8 means |
|---|---|
| Hook (first 2 s) | a striking real-game moment and the brand within 2 s |
| Readability | every title card readable in ≤ 1.5 s at 1080p; DESIGN.md type and safe areas |
| Motion quality | continuous camera paths, no unexplained pops, 12°-slant wipes consistent, eases from one family |
| Variety | ≥ 5 distinct shot types (TV, onboard, T8 drone, pit, start) and ≥ 2 conditions (day, night/rain) |
| Composition | subject placement intentional; horizon level unless deliberately rolled ≤ 2° |
| Accuracy | every on-screen claim listed in `media/trailer/facts.md` and true in the build |
| Audio sync | the drop lands on its beat (lights out or the T8 night/rain transition) within ± 1 frame; engine audio matches the picture |

Global gates: −14 LUFS ± 1 (two-pass loudnorm), BT.709 TV range, H.264 crf 16, AAC 256k, 1920 × 1080 @ 60 fps.

---

## 6. Definition of done per sprint

| Sprint | Done when |
|---|---|
| **S0** | typecheck/test/build green; `?scene=skeleton` screenshot shows the box car on the oval; DESIGN.md passes its skill's P0 gates; `example.html` reviewed; GDD, ARCHITECTURE, the six design docs, team briefs and `sprint-1.md` exist; contracts compile; `__APEX__` present |
| **S1** | `sprint-1.md` §6 QC gate without open P0; all Sprint 1 screenshots reviewed; Sprint 1 benches and track tests green; `MODULE_STATUS` flags set |
| **S2** | menu → 20-car race → results playable end to end; HUD and menus complete with motion; E-MN, E-RC, E-TT, E-A11, E-AU suites green; S-SM-04…14 green; AI calibrated; pit, weather, flashback, ghost and replay recording working; perf measured (gates may still be amber) |
| **S3** | `docs/qa/test-report-1.md` and `docs/qa/qc-report-1.md` written; full matrix run; every finding prioritised with an owner |
| **S4** | P0 = 0; P1 = 0 or deferred with written reason; all thresholds green (P-01…P-06, L-01…L-03); regression suite green; UI polish pass done; D-010 CVD check done |
| **S5a** | `CREDITS.md` complete; Turkish `README.md`; `start.bat` works from a clean copy (`npm ci`, build, preview); final full test run green; `v1.0` tag |
| **S5b** | §5.6 scores all ≥ 8; stills approved; −14 LUFS; BT.709; `media/apex-gp-trailer.mp4` delivered |

## 7. Bug reports (Testçi) and severity
- Location: `docs/qa/test-report-<n>.md`, one row per bug: id, test id, title, repro (URL with params and seed), expected, actual, evidence (paths), owner role, severity.
- **P0:** crash, console error, data loss, blocked flow, a failed gate in PLAN "Doğrulama", IP violation. **P1:** a threshold missed, clearly wrong behaviour or visual defect visible in normal play. **P2:** polish.
