# Ardennes Forest Circuit: build spec (D-048, Spa-inspired)

Owner: Çevre. Status: **built** (2026-10-16). Template: `tracks.md` §2 (Lombardia). Only what differs is written here.
Real names (Spa-Francorchamps, La Source, Eau Rouge, Raidillon, Kemmel, Les Combes, Pouhon, Blanchimont, the bus stop…) appear **only in this file and in `scripts/`** (D-037 §5, tracks.md Ek A).

## 1. Identity
| | |
|---|---|
| Track id | `ardennes` (URLs, storage keys, raw file `ardennes.raw.json`) |
| In-game name (D-003, pre-composed uppercase) | TR `ARDENLER ORMAN CIRCUIT` / EN `ARDENNES FOREST CIRCUIT` |
| `TrackData.name` | `Ardenler Orman Circuit` / `Ardennes Forest Circuit` |
| IP check | "Ardennes/Ardenler" is a geographic region (like Lombardy/Bosphorus), not a circuit trademark. No corner names in game: T-numbers only. |

## 2. Facts
- OSM relation **284560** (`type=circuit`), 30 main member ways, start node **258602622** (S/F), pit way **323851541** (`pit_lane`). Chained from the start node they close: 329 nodes, **7,003.5 m** (real 7,004 m).
- Built loop **6,951 m** (U-TR-02 band 6,890–6,970): the two fillets (§3) shorten the T1 hairpin and the T18 bend by ≈ 50 m.
- **Clockwise**, net heading −360°. 19 corners. Pit on the **right** (`PIT.side −1`), pole on the right (`GRID.poleSide −1`, inside of T1).
- Origin = S/F node at 50.4440643 N, 5.9651626 E; projection tracks.md §1.3 with φ = origin latitude. Track bbox x −397…880, z −244…1,823 (1.3 × 2.1 km).

## 3. Corners (s on the OSM basis 7,003.5 m; measured on the OSM nodes, 25 m window)
| T | Dir | entry–exit (apex) | Turn | vApex | Character | Run-off / outside wall |
|---|---|---|---|---|---|---|
| 1 | R | 225–310 (270) | 146° | 65 | Hairpin after the line, heaviest braking (real: La Source) | painted, then gravel; tecpro |
| 2 | L | 890–965 (940) | 16° | 290 | Flat-out left at the valley bottom (Eau Rouge) | asphalt; armco |
| 3 | R | 975–1,120 (1,030) | 46° | 290 | Steep right-hand climb (Raidillon), bank +2° | asphalt; tecpro |
| 4 | L | 1,135–1,200 (1,170) | 21° | 295 | Blind left at the crest | asphalt; armco |
| – | R | 1,465–1,525 | 13° | – | unnumbered kink on the long uphill straight (Kemmel) | |
| 5 | R | 2,255–2,342 (2,300) | 77° | 130 | Hill-top chicane, right (Les Combes); cut zone | painted; tecpro; sausage |
| 6 | L | 2,342–2,430 (2,385) | 74° | 120 | Hill-top chicane, left; cut zone | painted; tyres; sausage |
| 7 | R | 2,495–2,585 (2,535) | 69° | 145 | Downhill right (Malmedy) | gravel; tyres |
| 8 | R | 2,850–3,040 (2,945) | 183° | 75 | Downhill second hairpin (Rivage) | gravel; tyres |
| 9 | L | 3,135–3,230 (3,170) | 78° | 120 | Left out of the hairpin | gravel; tyres |
| 10 | L | 3,650–3,795 (3,755) | 74° | 240 | Fast downhill double left, first part (Pouhon) | gravel 40 m; armco |
| 11 | L | 3,830–4,025 (3,990) | 69° | 230 | Double left, second part | gravel 40 m; armco |
| 12 | R | 4,315–4,475 (4,385) | 97° | 160 | Forest right (Fagnes) | gravel; tyres |
| 13 | L | 4,480–4,615 (4,580) | 87° | 170 | Forest left | gravel; tyres |
| 14 | R | 4,780–4,895 (4,850) | 92° | 145 | Low-point right (Stavelot) | gravel; tyres |
| 15 | R | 4,980–5,135 (5,055) | 70° | 210 | Long fast right (Paul Frère) | gravel; armco |
| 16 | L | 5,680–5,830 (5,720, 5,815) | 24° | 300 | Flat-out uphill lefts in the forest | asphalt; armco |
| 17 | L | 6,020–6,135 (6,055) | 36° | 300 | Fast left (Blanchimont) | gravel; tecpro |
| 18 | R | 6,595–6,652 (6,625) | 76° | 80 | Final chicane, right (bus stop); cut zone | painted; tecpro; sausage |
| 19 | L | 6,652–6,725 (6,685) | 103° | 75 | Final chicane, left; cut zone | painted; armco; sausage |

Turns are the built values. **Sequence test: `R L R L R L R R L L L R L R R L L R L`.**
Per-track thresholds: each numbered corner turns **> 12°** (T2, T4 and T16 are flat-out kinks that the real numbering counts; new optional `TrackExpect.minTurn`), built `minRadius` **> 12 m** (built minimum ≈ 20 m).

**Fillets (`A.CENTRE_FILLETS`, new optional field).** The OSM hairpin after the line is ≈ 14 m radius and the T18 bend ≈ 18 m. The 19.5 m centreline limiter cannot open them: it ran its 400-pass cap (build 300+ ms), shortened the loop by 72 m and left points inside the hairpin ambiguous (U-TR-05 errors up to 7 m at d = −19). Before the build, raw s 170–370 is re-drawn as tangent → **22 m arc** → tangent, and raw s 6,560–6,652 as tangent → 21 m arc → tangent (`filletRaw()` in `build/centreline.ts`; the apex moves ≈ 10–15 m inward, the pit behind T1 still clears it by ≈ 25 m). The limiter then converges in < 150 passes (main line build ≈ 23 ms).

## 4. Widths and banking
| s range | hw L/R |
|---|---|
| default | 7 / 7 |
| start straight 6,740 → 225 | 8 / 8 |
| T1 225–320 | 7 (inside reach must stay < the 22 m radius for an unambiguous projection) |
| valley + climb 880–1,210 | 7.5 |
| hill-top chicane 2,150–2,440 | 8 |
| final chicane 6,540–6,740 | 7 |

Banking: T3 +2°, T8/T10/T11 +1°, T15 +0.5°, everything else 0.

## 5. Elevation
- EU-DEM 25 m centreline samples (OpenTopoData `eudem25m`), y relative to S/F (DEM 418.05 m). Raw range 107 m.
- Running median ±5 samples (±125 m) against canopy spikes, then Gaussian **σ 50 m**.
- Built: **−49.9…+50.7 m (100.6 m)**; max |grade| **15.8 %** (the descent after T9, s ≈ 3,210). The climb after the valley dip (T3–T4) peaks at **12 %** in the DEM; the real ~17 % section is shorter than the 25 m sampling plus smoothing can hold (σ 35 m gives 18.6 % on the T9 descent but still 12 % on the climb, so σ 50 was kept).
- Lap shape: line 0 → +11 at T1 → down to −26 at the valley (s ≈ 900) → climb to +9 (1,300) → long uphill to +50 at the hill-top chicane (2,500) → down through the second hairpin and the double left to −41 (4,100) → −49 low point (T14) → steady climb back to 0.
- **Test (U-TR-10): range 90–115 m, max |grade| < 17 %.**
- Terrain grid **4.5 × 4.5 km at 75 m** (61 × 61, same sample count as Lombardia, raw ≤ 80 KB), centred on the track bbox. Terrain spans −97…+127 m. The far ring uses `backdrop 'residential'` (hill factor 1).

## 6. Timing
- Finish at s = 0. Sector 2 at **2,200** (end of the long uphill straight), sector 3 at **5,150** (T15 exit). Speed trap **2,150**.
- DRS 0 (start straight): detect 6,560, activate 6,800, end 200.
- DRS 1 (long uphill straight): detect 700, activate 1,320, end 2,200.

## 7. Pit lane and grid
- Pit on the right. Split on the T19 exit (built main s ≈ 6,614), merge on the descent after T1 (built s ≈ 406). OSM pit 721 m; built **680 m** (test band 640–700).
- The pit exit cuts behind the T1 hairpin, where the nearest main s jumps ≈ 120 m; the build walks it with a 160 m search window (`PIT.projectWindow`, new optional field, default 60).
- Parallel section main s 6,860 → 175 (OSM ≈ 14 m right; authored offsets): pit-wall face 11.5, fast lane 14.5, working lane 20.0, garage fronts 24.5. Limiter sp 120–640; 10 boxes at sp 290 + 26k.
- Grid: P_k at s = L − 12 − 8k, d ±2.4, pole on the right. Slots s ≈ 6,939 → 6,787, all after the split.
- `HIDE_FEATURES`: the real pit building (77352246) and the 210 × 230 m paddock block beside the descent (77352249), which rendered as a blank wall.

## 8. Track limits, walls, cut zones
- `cutZones`: T5–T6 (hill-top chicane) and T18–T19 (final chicane: the obvious cut).
- Spectator walls (concrete + fence): start straight and T1 outside (left), the valley/climb left side 520–1,180, the hill-top chicane, the final-chicane inside.
- Wall clearance ≥ 40 m outside T10–T11, ≥ 35 m outside T17.

## 9. Scenery theme: dense Ardennes forest
- `THEME`: `ground 'green'`, `forestMix [0, 0, 0.05, 0.25, 0.70]` (70 % **spruce**), `forestSpacing 7`, `openTreeSpacing 16`, `openMix [0, 0, 0.1, 0.4, 0.5]`, `treeSetback 14`, `maxTrees 60,000`, floodlights as Lombardia (18 m, 30 m, one side), `backdrop 'residential'` (hills + villages), `sea null`.
- **New tree species 4, spruce** (`scenery/trees.ts`): a short trunk with four stacked open cones (≈ 20–30 m tall with the instance scale), and a fifth 256² atlas cell. The billboard atlas is now 5 × 1 (1280 × 256; shader `/ 5.0`): same program, so 0 new programs. `TrackTheme.forestMix/openMix` take an optional 5th weight; the 4-weight tracks draw the same random sequence. Empty 3D species meshes are hidden (no empty draws).
- Stands: OSM grandstands at the start straight, T1, the valley and the climb (8); authored bleachers at the hill-top chicane and the double left, and a grandstand at the final chicane.
- Rain-prone character: five puddle spots (valley dip, second hairpin, T12, T14, final chicane). Default-weather weighting is a Lead/session setting (CR-TRK-8).

## 10. AI calibration (Sürüş)
- k = 1.0426 (tracks.md §2.11). Reference: pole 1:40.562 (2025). **Target 1:44.85; band × [0.972, 1.007] = 1:41.9–1:45.6.**
- Note: the brief's figure "≈ 1:39.1–1:42.6" does not follow from that formula (it would need a target of 1:41.95). Lombardia's first measured lap was 5 % under its spec target (D-042), so expect the same here and re-band once from the first measured d = 100 lap (D-037 §3 procedure).
- Checks: top speed at the end of the uphill straight with DRS 320–340 km/h; T1 minimum 60–75 km/h; the T2–T4 climb flat out in the dry.
- Per-track `aeroTrim` (D-037): suggest **−0.3** (long full-throttle sections, but the twisty middle sector needs downforce).

## 11. Acceptance tests (`src/track/__tests__/ardennes.test.ts`, shared `trackSuite`)
U-TR-01…12 with: length 6,890–6,970; sequence §3; minTurn 12; minRadius 12; heading −360; pit 640–700; elevation 90–115 m; grade < 17 %.
Suite change for every track: the U-TR-07 pit drive now approaches the split along the main line (2 m steps) instead of jumping 50 m with a stale hint. A chicane before the split trapped that hint in a local minimum; real cars never jump.

## 12. Data and fallback
- `node scripts/fetch-track.mjs --track ardennes`: OSM API relation full.json (Overpass fallback), OSM API map.json scenery (bbox 5.948, 50.424 → 5.989, 50.450), EU-DEM. Raw **70.4 KB** (forest 23 KB, terrain 19 KB). Names stripped.
- `src/track/data/fallback-ardennes.ts`: 180-point main loop (Douglas–Peucker 0.6 m), 25-point pit, 70 unsmoothed EU-DEM samples at 100 m. Generated from the live raw file.

## 13. Contract change requests (Lead)
- **CR-TRK-6** `src/contracts/track.ts`: `TrackId = 'istanbul' | 'lombardia' | 'bosphorus' | 'ardennes' | 'oval' | 'straight'`. Until it lands, `src/track` uses `BuiltTrackId = RaceTrackId | 'ardennes'` (authoring/types.ts) and casts `TrackData.id`. Afterwards `BuiltTrackId` collapses to `RaceTrackId`.
- **CR-TRK-7** `src/data/tracks.ts`: `RACE_TRACKS = ['istanbul', 'lombardia', 'bosphorus', 'ardennes']`; `RACE_TRACK_INFO.ardennes = { id: 'ardennes', nameKey: 'tracks.ardennes', lengthM: 7004, defaultLaps: 3, aeroTrim: -0.3 }`; i18n `tracks.ardennes`: TR `ARDENLER ORMAN CIRCUIT`, EN `ARDENNES FOREST CIRCUIT`. `availableRaceTracks()` filters `RACE_TRACKS`, so the track does **not** appear in menus until this lands. `?track=ardennes` already works in the Çevre sandboxes. Also re-record the contract baseline and let `net/protocol.ts` accept the id (it reads `RACE_TRACKS`).
- **CR-TRK-8** (optional): weather-preset weighting per track, so random weather at `ardennes` is wetter.

## 14. Credits (`public/assets/env/CREDITS.part.md`, UI credits, `TrackData.attribution`)
- Ardennes Forest Circuit: track geometry and scenery footprints derived from OpenStreetMap data © OpenStreetMap contributors (ODbL 1.0). The derived file ardennes.raw.json is also provided under ODbL.
- Ardennes Forest Circuit elevation: EU-DEM v1.1, produced using Copernicus data and information funded by the European Union; served via OpenTopoData.

## 15. Budgets (High; measured in `?scene=track`, main pass / whole frame)
| View | calls | tris |
|---|---|---|
| start/finish | 61 / 96 | 0.49 M / 0.54 M |
| valley dip | 118 / 153 | 0.55 M / 0.60 M |
| climb | 116 / 151 | 0.58 M / 0.65 M |
| T1 hairpin | ~40 / 73 | 0.46 M (frame) |
| forest | 119 / 151 | 0.63 M / 0.68 M |
| second hairpin | 28 / 60 | 0.39 M / 0.44 M |
| night T1 | 39 / 78 | 0.48 M / 0.54 M |
| aerial (not a game view) | 203 / 234 | 0.72 M / 0.75 M |
Programs 35 (day), 31–35 at night; no new programs. `ground()` 0.19–0.37 µs; build ≈ 120 ms warm on an idle machine (the 150 ms gate fails under heavy parallel load for Lombardia too).
