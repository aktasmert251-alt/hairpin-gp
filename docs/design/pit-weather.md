# Pit procedure, weather and conditions

> Owner: Planner. Implementers: **Yönetici** (`src/race/pit/**`, `src/race/conditions/**`, `src/race/weatherTimeline.ts`, forecast), **Sürüş** (AI pit and weather decisions, pit-lane driving in `pitAuto`, pit limiter in VehicleSystem), **Çevre** (`GroundHit.wetLocal`, wet visuals).
> Rules that pit stops must respect: `rules.md` §5, §7, §8. Geometry: report §7.7. Constants live in `src/race/pit/pitConstants.ts` and `src/race/conditions/conditionsConstants.ts`.

## 1. Pit lane geometry (recap, report §7.7)
- Pit lane on the left (inside). Split at main s ≈ 4,775 (T13 exit), merge at s ≈ 419. Ribbon length 910 m (`sp`).
- Speed limit zone sp 115–705 (590 m). 10 boxes at `sp = 300 + 28k` (team order of `src/data/teams.ts`), lateral: fast lane d = +12, working lane d = +17.5 (main-centreline offsets; on the pit ribbon use `PitLaneData.fastLaneD/workingLaneD`).
- Derived points: `pitCommitS = mainSAtSplit − 150`; `pitAutoS = mainSAtSplit − 300`.

## 2. `PitPhase` state machine (PitProcedure, runs inside the RaceDirector system, 240 Hz)

| Phase | Entered when | Control (`car.control`) | Behaviour | Left when |
|---|---|---|---|---|
| `none` | default; after `exit` completes | player / ai | – | a request appears, or the car crosses the pit-entry line |
| `requested` | player `controls.boxRequest` (CR-03) or AI `ai.plannedStopLaps[0] === race.lapsCompleted + 1`, with race phase `running` | player / ai; **`pitAuto` from `pitAutoS`** for AI and for the player with pit assist on | request can be cancelled until the car passes `pitCommitS` | crosses the pit-entry line → `entry`; passes the split on the main ribbon (player missed it) → stays `requested` for the next lap |
| `entry` | car on the pit ribbon past the entry line (also directly from `none`: entering unrequested = stop with the suggested compound) | player (assist off) or `pitAuto` | `pitAuto` sets `input.pitLimiter = true` 20 m before `limitStartSp` and brakes to 79 km/h | `sp ≥ limitStartSp` → `limiter` |
| `limiter` | inside the limit zone | as above | speeding check (rules §7); fast lane | `sp ≥ boxSp − 30` → `boxIn` |
| `boxIn` | 30 m before the box | **always `pitAuto`** | steer to working lane, decelerate at 4 m/s² to stop at `boxSp ± 0.3 m`; if the box is occupied, stop at the queue slot `boxSp − 9` (§2.3) | `v < 0.5 m/s` at the box → `stationary` |
| `stationary` | stopped in the box | `pitAuto` | hold `penaltyToServeSec` (no work), then service for `serviceS` (§2.2); at the end: new tyres (`nextCompound`, wear 0, surface/core at blanket temperature, age 0), `compoundsUsedMask |= bit`; no refuelling | timer done → `release` |
| `release` | service complete | `pitAuto` | safe-release check every tick (§2.4) | lane clear → `boxOut` |
| `boxOut` | released | `pitAuto` | accelerate to 79 km/h, merge into the fast lane over 25 m | `sp > boxSp + 30` → `exit` |
| `exit` | back in the fast lane | player (assist off) or `pitAuto` | limiter must stay on until `limitEndSp` (`pitAuto` turns it off there) | car back on the main ribbon at `mainSAtMerge` → `none`, `race.pitStops++` |

Every phase change emits `pit {car, phase}`. `car.pit.timer` counts the current phase time; `car.pit.serviceS` holds the drawn service time.

### 2.1 Pit loss (target 20–24 s, PLAN Ek D)
Lane: entry + exit segments outside the limit (320 m at ≈ 150 km/h) ≈ 7.7 s; limit zone 590 m at 80 km/h = 26.6 s; box decel/accel ≈ 2.5 s; service ≈ 2.5 s → ≈ 39.3 s. Main track split → merge (≈ 996 m) at race pace ≈ 16–17 s. **Loss ≈ 22.5 s.** S-SM-10 checks 20–24 s; tune with the limit-zone length only if needed (ÇEV) and report.
`mfd.pitLossS` = this value computed at load from the speed profile (main segment) and the lane profile, plus the mean service time.

### 2.2 Service-time distribution
`serviceS = 2.10 + 0.60·u₁ − 0.10·(team.perf / 0.015)`, plus a slow-stop tail: with probability 0.05, `+ (1.0 + 3.0·u₂)` s. `u₁, u₂` uniform from `state.rng.race`. Mean ≈ 2.5 s; range 2.0–2.8 s normally, up to 6.8 s on a slow stop. Same distribution for player and AI. Wet or dry tyres make no difference.

### 2.3 Box queueing (double stack)
- One box per team. A car whose box is occupied (teammate in `boxIn`…`release`) stops at the queue slot `boxSp − 9 m` in the working lane, stays in `boxIn`, and moves up when the box is free (≈ +1.5 s).
- AI avoids double stacks in the dry: if the teammate has the same in-lap and is < 4 s ahead, the trailing car moves its stop one lap later. In weather calls both may stack.

### 2.4 Safe release (no unsafe-release penalty)
The crew holds the car until no car in the fast lane has `sp ∈ [boxSp − 25, boxSp + 8]` with speed > 30 km/h. Maximum hold 8 s (then released anyway; the fast-lane car's AI yields). The player cannot leave early: inputs are ignored until `boxOut` ends.

### 2.5 Pit limiter (VehicleSystem, SÜR)
- Toggled by the `pitLimiterPressed` edge (`L`) or `input.pitLimiter` from `pitAuto`. `vehicle.pitLimiterOn` mirrors it.
- While on: throttle is cut by a P-controller so `v ≤ 79.5 km/h`; braking is never applied by the limiter.
- On the main track the limiter still limits speed (driver's responsibility); the HUD shows the `PİT` chip.
- Player feedback: warning beeps and `notify.pit.limiter` when the car is in `entry` with the limiter off (audio.md §6, ui-hud.md §3).

### 2.6 Decision hooks
- **AI (SÜR):** writes `car.ai.plannedStopLaps` (ascending in-lap numbers, in-lap = `lapsCompleted + 1` at the time of entry) and `car.ai.nextCompound`. It may change `plannedStopLaps[0]` until the car passes `pitCommitS` on that lap; later changes are ignored for that lap. After a stop it drops the first entry when it sees `race.pitStops` increase. Evaluation: at each finish-line crossing, and within 0.1 s of a `weather` event or a forecast change.
- **Player (YÖN glue):** MFD writes `PlayerStrategy { boxRequest, nextCompound }` → `DriverControls` (CR-03). The glue clears `boxRequest` when it sees `pit` phase `exit` for the player.
- **Suggested compound** for unrequested entries and MFD pre-selection: ui-hud.md §4.
- **Rejoin prediction** (`mfd.rejoinPos`): `position + count(cars behind with gap < pitLossS)` at 2 Hz.

## 3. AI pit strategy summary (report §6.8, decisive additions)
- Dry, N ≥ 15: template at start (seeded): M→H 50 %, S→H 25 %, H→M 15 %, S→M→S 10 %. Stop lap `min(0.85·life/wearScale, 0.45·N) ± 2`.
- Dry, 10 ≤ N < 15: one stop at `round(0.5·N) ± 1` with the other dry compound (two-compound rule).
- N < 10: box only if wear ≥ 0.85 or for weather.
- Re-evaluate every lap: worst tyre wear ≥ 0.72 or predicted cliff before the plan → box this lap; undercut rule of §6.8.
- Weather thresholds use **`lineWetness`** (what the car drives on), shifted ±0.04 per driver: slicks → Inters when ≥ 0.18 for 20 s (or a forecast entry ≤ 5 min shows rain ≥ 0.7 with probability ≥ 60 % and line wetness ≥ 0.10); Wets instead of Inters if rain ≥ 0.7 and W ≥ 0.6; Inters → Wets at ≥ 0.68; Wets → Inters at ≤ 0.55; Inters → slicks when ≤ 0.10 for 30 s and no rain ≥ 0.2 in the forecast (M if ≥ 12 laps left, else S).
- Start compound: dry by template; `light` → Inters; `heavy` → Wets when W ≥ 0.6, else Inters; `variable` by current line wetness. Player `startCompound: 'auto'` uses the same rule (dry: M for ≥ 10 laps, S below).

## 4. Conditions (`ConditionsState`, ConditionsSystem at 10 Hz)

### 4.1 Presets

| Preset | Rain | Initial W / line W | Base cloud |
|---|---|---|---|
| `dry` | 0 throughout | 0 / 0 | 0.15 |
| `light` | 0.30 ± 0.08, keyframes every 120 s | 0.35 / 0.35 | 0.85 |
| `heavy` | 0.85 ± 0.08, keyframes every 120 s (≤ 1) | 0.85 / 0.85 | 1.0 |
| `variable` | generated timeline (§4.2) | `min(1, 1.1·rain(0))` | 0.25 |

Time of day is **static per session** (`tod` never changes; no day–night cycle).

### 4.2 Timeline generator `generateWeatherTimeline(preset, seed, durationS)`
- RNG: mulberry32 with state `seed ^ 0x5eed7a1e` (local to the generator; deterministic, never touches `state.rng`).
- `durationS` passed by `createSim`: race `laps × 95 s × 1.3`; Time Trial 3,600 s.
- `variable`: Markov chain over states DRY (0), DRIZZLE (0.15–0.25), RAIN (0.40–0.60), HEAVY (0.75–0.95); level drawn uniformly within the band.
  - Start: DRY 0.55, DRIZZLE 0.30, RAIN 0.15.
  - Transitions: DRY → DRIZZLE 0.6 / RAIN 0.3 / HEAVY 0.1; DRIZZLE → DRY 0.45 / RAIN 0.40 / HEAVY 0.15; RAIN → DRY 0.30 / DRIZZLE 0.35 / HEAVY 0.35; HEAVY → RAIN 0.6 / DRIZZLE 0.4.
  - Segment length `clamp(durationS·U(0.18, 0.35), 90, 900)` s; linear ramps between segments of `clamp(0.15·segment, 30, 120)` s.
  - Guarantee: at least one segment with rain ≥ 0.4 starting before 60 % of `durationS`, and at least one DRY segment. Otherwise retry with `seed + 1` (≤ 8 tries), then force DRY → RAIN → DRY with changes at 25 % and 60 %.
- Output: keyframes sorted by `t`; `rain(t)` = linear interpolation, constant after the last keyframe.

### 4.3 Cloud (derived, not stored)
`cloud(t) = max(baseCloud, clamp(2.5·rain(t + 120 s) + (rain(t) > 0 ? 0.1 : 0), 0, 1))`: clouds arrive 2 minutes before the rain. Computed by the RenderFrame builder from the timeline into `ConditionsFrame.cloud`.

### 4.4 Wetness equations (dt = 0.1 s)
- `W_target = min(1, 1.1·rain)`.
- **Wetting** (`rain ≥ 0.02` and `W < W_target`): `dW/dt = (W_target − W) / τw`, `τw = 60 + 120·(1 − rain)` s.
- **Drying** (otherwise): `dW/dt = −evap / 600`, with `evap = (0.6 + 0.4·(1 − cloud)) · clamp(1 + (trackC − 20)/40, 0.5, 1.75)`; `W ≥ 0`.
- **Racing line** (`lineWetness`, `Lw`): `passRate = Σ(speed of running cars on the main ribbon) / L` (≈ 0.22 /s with 20 cars).
  - While `rain ≥ 0.05`: `Lw = clamp(W − 0.05·passRate/0.224, 0, W)`.
  - Otherwise: `dLw/dt = −evap/600 − 0.015·passRate`, clamped to `[0, W]`.
- **Checkpoints** (unit test U-RC-04, ± 5 %): rain 0.9 from W = 0 → W = 0.626 at 72 s, 0.909 at 180 s. Drying from W = 0.5 with cloud 0.3, trackC 30 °C (evap 1.1): off-line dry after ≈ 273 s; line with 20 cars dry after ≈ 96 s.
- **Per-wheel wetness for physics:** ÇEV's `TrackQuery.ground` fills `GroundHit.wetLocal` as a weight: 0 on the dry line (|d − lineD(s)| ≤ 1.5 m, ÇEV's own approximate line), rising linearly to 1 at 3.0 m, and 2 inside a puddle mask. Physics: `W_local = wetLocal ≤ 1 ? lerp(Lw, W, wetLocal) : (W > 0.65 ? 1 : W)`.

### 4.5 Temperatures
- Base air/track °C: day 24/38, sunset 21/29, night 18/22, each + U(−2, 2) from the seed.
- `trackC` → `airC − 2` with τ 300 s while `rain ≥ 0.1`; otherwise back toward base with τ 600 s. `airC` → base − 3·rain with τ 300 s.

### 4.6 Weather events (`weather {rain, msg}`)
Hysteresis ±0.02; each message at most once per 60 s.

| `msg` | Trigger |
|---|---|
| `rainSoon` | forecast entry ≤ 5 min with rain ≥ 0.2 and probability ≥ 60 % while `rain < 0.05`; once per spell (re-armed after 120 s dry) |
| `rainStarted` | rain crosses 0.10 upward |
| `drying` | rain < 0.05 for 60 s, W > 0.15 and falling; once per spell |
| `intersNow` | `Lw` crosses 0.12 upward (slick/inter crossover ≈ 0.11) |
| `wetsNow` | `Lw` crosses 0.62 upward (inter/wet crossover) |
| `slicksNow` | `Lw` crosses 0.10 downward after having been ≥ 0.15 |

## 5. Forecast (`RaceModule.forecast`, CR-10)
Pure function of `(conditions.timeline, seed, nowS)`, used by HudPresenter (MFD weather page, `rainSoon`) and AI, so both see the same numbers.
- Horizons `h ∈ {5, 10, 15, 30}` min, dropping those beyond the remaining session + 5 min (minimum two).
- `trueRain` = max of `rain(t)` over `nowS + 60h ± 60 s`.
- `epoch = floor(nowS / 60)` (forecast refreshes once per minute); `e = (hash01(seed, epoch, h) − 0.5)·2·(0.03 + 0.012·h)`.
- Shown rain = `clamp(trueRain + e, 0, 1)` rounded to 0.05.
- Probability (chance of rain): `h ≤ 10`: `clamp(0.5 + 4·(trueRain + e − 0.1), 0.05, 0.95)`; `h > 10`: `clamp(0.5 + 2.5·(trueRain + e − 0.1), 0.10, 0.90)`; rounded to 5 %.

## 6. How it feeds strategy
- **Player:** weather strip (rain, wetness class, temperatures), MFD HAVA page (forecast), MFD STRATEJİ (pit loss, rejoin position, suggested compound, two-compound status), banners (`rainSoon`, `intersNow`, …), tyre widget (temps, wear), the visible drying line on track.
- **AI:** §3 thresholds on line wetness plus the shared forecast; profile rebuild when |ΔW| > 0.05 (report §6.7).
- **Physics:** `W_local` per wheel with the wet grip table (report §5.3); aquaplaning in puddles above 160 km/h.
- **Visuals/audio:** `ConditionsFrame` → LightingRig modifiers (rendering.md §5.3), rain VFX, wet track shader, rain audio bed.

## 7. Tests
U-RC-03 (timeline determinism and bounds), U-RC-04 (wetness checkpoints), I-06 (forecast determinism), S-SM-10 (pit strategy and loss), S-SM-14 (variable weather and AI tyre switches), E-RC-02 (pit stop E2E). Catalogue: `testing-qc.md` §2.
