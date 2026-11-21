# Race rules

> Owner: Planner. Implementer: **Yönetici** (`src/race/**`: RaceDirector + PitProcedure; `src/game/flashback`, `src/game/ghost`). AI behaviour under these rules: **Sürüş** (`src/ai/**`).
> Consistent with PLAN Ek D (wins on conflict). Every number here is a constant in `src/race/rules.ts`. Timing resolution 1 ms (sub-tick interpolated line crossings). `L` = track length; `s` values are main-track metres.

## 1. Sessions
| | Quick Race (`race`) | Time Trial (`timeTrial`) |
|---|---|---|
| Laps | 3, 5, 10, 15, 29 | unlimited until quit |
| Cars | player + 0–19 AI | player (+ ghost) |
| Difficulty | 0–110, default 70 | – (car perf 0) |
| Start | standing start from the grid, 5 lights | flying start at `s = L − 200`, 200 km/h, lap starts at the line |
| Weather | dry, light, heavy, variable | dry, light, heavy (constant) |
| Not implemented | safety car, VSC, red flag, black flag, damage, formation lap, qualifying | |

## 2. Start
1. **Grid phase** (2.0 s): cars on slots `track.data.grid[k]` (pole on the left, report §7.7). Player slot = `gridPos` (`'random'` → seeded from `rng.race`); AI fill the rest in reverse order of `pace × (1 + team perf)` with seeded ±2-slot noise.
2. **Lights phase:** `lightsOn` with `count = 1…5` at 1.0, 2.0, 3.0, 4.0, 5.0 s; then a hold drawn uniformly from **0.2–3.0 s** (`rng.race`), then `lightsOut`. The race clock (`raceMs`) starts at 0 at `lightsOut`.
3. **Start hold:** during `grid` and `lights`, VehicleSystem holds every car stationary while `throttle < 0.05` (no roll-back on the grade). With `throttle ≥ 0.05` the auto-clutch engages and the car moves. Launch technique: hold brake + throttle (brakes beat first-gear torque, the engine revs) and release the brake at lights out.
4. **Jump start:** if the player's car moves more than **0.5 m** along `s` from its slot before `lightsOut` → `jumpStart` + `penalty` (+5 s, reason `jumpStart`), once per race. AI never jump-starts (§6.6 of the report). Autodrive makes a perfect start.
5. `skipLights` (URL/test) starts directly in `running` with `raceMs = 0`.
6. Lap 1 is timed from `lightsOut` to the first finish-line crossing (includes the grid distance).

## 3. Track limits
- **Limit:** the white line is part of the track (`halfWidthL/R`). A wheel is out when `GroundHit.inLimits` is false.
- **Excursion:** all four wheels out (`offTrackWheels === 4`) continuously for ≥ **0.10 s**.
- **Exempt zones:** left side within `[mainSAtSplit − 30, mainSAtSplit + 60]` and `[mainSAtMerge − 60, mainSAtMerge + 30]` (pit entry/exit), any car in recovery (3 s after `carReset`), and cut zones (§4, handled there).
- **Race counting:** an excursion counts as one **strike** when its mean speed is ≥ **60 km/h** and the car rejoins within 6 s (spins and slow off-track moments do not count). Re-armed after ≥ 2 wheels have been back in limits for 1.0 s.
  - Strikes 1 and 2: `trackLimits` event, warning (1/3, 2/3).
  - Strike 3: warning 3/3 plus the **black-and-white flag** (`flag` event `blackWhite`).
  - Strike 4 and every later one: **+5 s** (`penalty` reason `trackLimits`).
  - A lap with a strike is invalid for best-lap purposes (`lapValid = false`); it still counts for distance.
- **Time Trial:** any excursion (no speed exemption) invalidates the current lap (`lapInvalidated` reason `trackLimits`). An excursion in `[L − 150, L)` also invalidates the next lap.

## 4. Corner cutting (cut zones, report §7.6)
- Zones: T1 inside, T9–T10 inside, T12–T14 insides; gates at each apex (`TrackData.cutZones[].gates`).
- **Cut:** the car centre crosses a gate `s` more than **1.0 m** beyond the inner edge (`side = +1`: `d > halfWidthL + 1.0`; `side = −1`: `d < −(halfWidthR + 1.0)`).
- **Race:** zone time = `markerTime(toS) − markerTime(fromS)`. Reference = the car's best valid time through that zone this session, or, if none, the zone time of the car's own speed profile × 1.05. If zone time < reference × **1.03** → **+5 s** (`penalty` reason `cornerCut`); otherwise it counts as a track-limits strike (§3). Either way the lap is invalid for best-lap purposes.
- **Time Trial:** a cut invalidates the lap (`lapInvalidated` reason `cornerCut`).

## 5. Penalties and how they are served
| Reason | Amount | When |
|---|---|---|
| `jumpStart` | +5 s | §2 |
| `trackLimits` | +5 s | 4th and later strikes |
| `cornerCut` | +5 s | §4 |
| `pitSpeeding` | +5 s | §7, once per pit visit |
| `twoCompound` | +30 s | at the finish, cannot be served (§8) |

- `car.race.penaltySec` = total incurred; `penaltyToServeSec` = still unserved (shown in the tower, `TowerRow.penaltySec`).
- **Serving:** at the car's next pit stop the car is held stationary for `penaltyToServeSec` **before** tyre work starts (no work during the hold), then `penaltyServed` (CR-06) and `penaltyToServeSec = 0`. A penalty incurred during that pit visit (pit speeding) is served at the next stop or added at the finish.
- **Unserved at the finish:** added to the classification time.
- AI cars get the same penalties and serve them at their planned stop. `dsq` is reserved and never assigned.

## 6. Flags and DRS
| Flag | Shown when | Effect |
|---|---|---|
| **Yellow** (per sector) | a car in that sector is below 40 km/h for ≥ 2 s on track, is stopped within 15 m of the track, or is in its 3 s post-reset window; clears 3 s after the cause ends | `RaceState.yellow[sector]`, `flag` event, marshal panels; DRS unavailable in zones whose activation line lies in a yellow sector; AI does not start overtakes there and lifts 3 %. Player overtakes under yellow: no penalty (simplification) |
| **Green** | marshal panels for 3 s after a yellow clears | visual only |
| **Blue** | a car at least one lap down has a lapping car ≤ 1.0 s behind (marker times) for ≥ 1 s | `flag` event blue for the lapped car; AI yields per report §6.5; player gets a banner; no penalty for ignoring it |
| **Black-and-white** | 3rd track-limits strike | banner 5 s |
| **Chequered** | the leader completes the final lap | phase `finishing` (§9) |

**DRS:** enabled (`drsEnabled`) when the leader starts lap 3. Detection: at the zone's detection line the car is ≤ **1.000 s** behind any car (lapped cars included) → `drsEligible` for that zone; `drsAvailable` fires at the activation line. Disabled race-wide (`drsDisabled`) while `wetness ≥ 0.30`; re-enabled 2 laps after it drops below 0.20. Time Trial: always enabled, always eligible.

## 7. Pit lane
- Speed limit **80 km/h** between `limitStartSp` and `limitEndSp` (sp 115–705). The pit limiter caps at 79.5 km/h; it only cuts throttle, so the driver must brake below 80 before the line.
- **Speeding:** speed > 80.5 km/h for ≥ 0.2 s inside the limit zone → +5 s (`pitSpeeding`), at most once per pit visit; `car.pit.speeding = true`.
- **Race:** entering the pit lane always ends in a stop at the team box with the selected `nextCompound` (crew always ready). There is no drive-through. Release is always safe (pit-weather.md §2.4), so there is no unsafe-release penalty.
- **Time Trial:** no pit stops; entering the pit lane invalidates the lap and the car drives through at the limiter.
- Stops are allowed on any lap, including lap 1 and the final lap (the finish is taken on the main track).

## 8. Two-compound rule
- Active when `config.mandatoryStop` is true: weather preset `dry` or `variable`, **and** laps ≥ 10.
- Each classified car must have used at least two different dry compounds (S, M, H) during the race; the start compound counts (`compoundsUsedMask` bits S 1, M 2, H 4, I 8, W 16).
- Lifted for a car that used Inters or Wets, and lifted for everyone if track `wetness` reached ≥ 0.12 at any time.
- Violation: **+30 s** at the finish (`penalty` reason `twoCompound`). Not applied to DNF cars.

## 9. Finish, classification and points
- **Finishing:** after the chequered flag every car finishes at its next finish-line crossing (`finish` event). The session ends when every running car has finished or **120 s** after the leader's finish; cars still running are classified by laps completed and track order at that moment.
- **Classification time** = race time at the crossing + unserved penalties + two-compound penalty.
- **Order:** laps completed (desc), then classification time (asc); equal times → better grid slot first. DNF cars after all classified cars, by laps completed (desc), then retirement time.
- **Gaps:** same lap → `gapMs` to the winner; otherwise `lapsDown`.
- **Points (2025):** P1–P10 classified finishers: **25, 18, 15, 12, 10, 8, 6, 4, 2, 1**. No fastest-lap point. DNF 0. Single race only, no championship.
- **Best lap** in results = best valid lap.
- **Retire** (pause → YARIŞTAN ÇEKİL, confirmed): player status `dnf` (CR-06 `retired`), car hidden and non-colliding, then the results screen with a **projected classification**: remaining cars keep their current order; projected time = current race time + remaining laps × the car's last valid lap (or session average). No further simulation. `skipToResults` after the player finished uses the same projection for cars still running.
- After the player finishes: TV camera, results screen after 4 s (projected for unfinished cars, marked provisional).

## 10. Time Trial validity, sectors and ghosts
- **Invalid lap** when any of: excursion (§3), cut (§4), flashback used during the lap, car reset, pit lane entered, `restartLap` mid-lap (lap aborted, not listed). An excursion in the last 150 m also invalidates the next lap.
- Personal best, ghost and the local top-10 are saved **only from dry Time Trial** sessions (`weather = 'dry'`); wet laps are shown but not stored.
- **Sector colours (TT):** purple = faster than the stored all-time best for that sector; green = faster than this session's best but not all-time; yellow = slower than the session best; `none` on invalid laps.
- **Sector colours (race):** purple = session best of all cars; green = the car's personal best this race; yellow = slower than its personal best. A car's first timed sector is green unless purple.
- **Delta:** TT vs PB lap (`deltaRef: 'pb'`) or rival ghost (`'rival'`); race vs the player's best lap (`'best'`); computed from 10 m marker times.
- **Ghosts:** `pb` = stored PB lap; `rival` = a perfect AI lap (d = 100, `perfect` mode) recorded headless once and cached under `apexgp:v1:rivalGhost:<buildHash>`.

## 11. Flashback
- **Allowance:** 0, 3, 5 or unlimited per session (`config.flashbacks`, −1 = unlimited).
- **Window:** up to 15 s back, 0.1 s granularity (10 Hz snapshots). Available only in phase `running`, before the player finishes, with ≥ 1 s of history.
- **Effect:** the whole world is restored (all cars, race state, penalties, conditions). Penalties, strikes and events after the restore point disappear. After the restore the FlashbackController re-applies `race.flashbacksLeft` (decremented) and, in TT, `lapValid = false` for the current lap; replay and ghost recorders drop samples after the restore time.
- Results and points do not record flashback use.
