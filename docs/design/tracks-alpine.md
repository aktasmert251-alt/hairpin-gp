# Alpine Pass Circuit: design and build spec (D-063)

Owner: Çevre-2. Status: **built and registered** (2026-10-25): built L 5,649 m, elevation 85.8 m, max grade 10.0 %, AI d = 100 lap 76.84 s (band 75.7–78.0 s asserted in calibration.test.ts), server minLapMs 73,000. Template: `tracks.md` §1 (shared pipeline) and `tracks-spa.md` (Ardennes). Only what differs is written here.
Layout sketch: `test-results/screens/alpine/layout.png` (top-down, elevation-coloured line, pit, tunnel, villages, cable car, elevation profile).

## 1. Identity
| | |
|---|---|
| Track id | `alpine` (URLs, storage keys); no raw JSON file: the raw track is generated at first use from `src/track/authoring/alpine-ctrl.ts` |
| In-game name (pre-composed uppercase) | TR `ALP DAĞ GEÇİDİ` / EN `ALPINE PASS CIRCUIT` |
| `TrackData.name` | `Alp Dağ Geçidi` / `Alpine Pass Circuit` |
| IP check | Fictional. No real circuit layout, no real place or corner names (T-numbers only). Generic Swiss/Italian Alps mood: lake, pass road, chalets, cable car. |

## 2. Layout (authored, no OSM)
- Fillet polygon (Bosphorus method): 16 vertices (E, N, radius) in map metres, world x = E, z = −N; tangent arcs joined by straights, sampled at 1 m. The S/F is at (0, 0) on the lake straight, **heading west**. Polygon basis length **5,649 m** (`BASE_LENGTH`, the authoring table's `OSM_LENGTH`).
- **Clockwise**, net heading −360°, **15 corners** (T10 is one hairpin made of two 24 m vertices 50 m apart). Pit and pole on the **right** (`PIT.side −1`, `GRID.poleSide −1`, inside of T1).
- Control points `CTRL` (E, N, r): (−560,0,30) (−560,250,70) (−774,430,160) (−797,689,170) (−981,873,160) (−981,1113,36) (−95,957,240) (181,1005,220) (477,653,130) (1214,583,24) (1211,533,24) (961,533,50) (879,308,45) (682,273,60) (572,82,90) (347,0,160). Bbox ≈ E −1,000…1,240, N 0…1,120 (2.2 × 1.1 km).

### Flow
Lake-side main straight (≈ 850 m with the S/F, grid and pit) → **T1** heavy stop at the west end of the lake → **T2** left, the climb starts → **T3–T5** fast climbing esses up the valley side (+13 → +57 m) → **T6** tight uphill switchback (R 36) → long rising straight with the **210 m tunnel** bored through a rock spur → **T7** blind left crest at the summit (+86 m) → **T8** long fast downhill right → steep **blind descent** (≈ 11 %) into the valley → **T9** compression left at the foot → valley straight (DRS 2) → **T10 hairpin** (heaviest braking, main overtaking spot) → **T11–T14** medium-speed technical section dropping back toward the lake → **T15** fast kink onto the main straight (DRS 1).

### Corners (s on the 5,649 m polygon basis; arc start–end)
| T | Dir | s | Turn | R (m) | vApex (km/h, est.) | Character | Run-off / outside barrier |
|---|---|---|---|---|---|---|---|
| 1 | R | 530–577 | 90° | 30 | 95 | End of the lake straight, heavy braking, overtaking | painted → gravel; tecpro |
| 2 | L | 765–826 | 50° | 70 | 150 | Left onto the climb | gravel; armco |
| 3 | R | 1007–1132 | 45° | 160 | 230 | Climbing esses 1 | asphalt; armco |
| 4 | L | 1264–1382 | 40° | 170 | 235 | Climbing esses 2 (rock cutting on the right) | asphalt; armco |
| 5 | R | 1515–1640 | 45° | 160 | 225 | Climbing esses 3 | gravel; armco |
| 6 | R | 1771–1834 | 100° | 36 | 100 | Uphill switchback, cliff face outside | gravel; tyres |
| 7 | L | 2649–2732 | 20° | 240 | 285 | Blind summit crest after the tunnel | asphalt; armco |
| 8 | R | 2844–3073 | 60° | 220 | 250 | Long downhill right | gravel 30 m; tecpro |
| 9 | L | 3353–3454 | 45° | 130 | 190 | Compression at the foot of the descent | gravel; tyres |
| 10 | R | 4118–4196 | 175° | 24 | 70 | Valley hairpin: heaviest braking of the lap | painted → gravel; tecpro |
| 11 | L | 4388–4449 | 70° | 50 | 120 | Technical 1 | gravel; tyres |
| 12 | R | 4628–4675 | 60° | 45 | 115 | Technical 2 | gravel; tyres |
| 13 | L | 4821–4873 | 50° | 60 | 135 | Technical 3 | gravel; tyres |
| 14 | R | 5033–5096 | 40° | 90 | 165 | Technical exit | gravel; armco |
| 15 | R | 5274–5330 | 20° | 160 | 260 | Fast kink onto the straight | asphalt; armco |

**Sequence test: `R L R L R R L R L R L R L R R`.** Per-track thresholds: every corner > **15°** (T7 and T15 are 20° kinks; `TrackExpect.minTurn` 15), built `minRadius` > **20 m**.

## 3. Widths, banking
| s range | hw |
|---|---|
| default | 7 |
| main straight 5330 → 480 | 8 |
| T1 480–640 | 8 |
| tunnel 1990–2260 | 6.5 (13 m between the kerb-free edges) |
| hairpin 4040–4260 | 8.5 (two lines through the hairpin) |
Banking: T6 +2°, T8 +1.5°, T10 +2°, else 0.

## 4. Elevation
Authored profile `ELEV` (s, y), linear, then the standard build (Gaussian σ 40 m + vertical-curvature clamp):
0 (straight, lake level, lake surface −2.6 m) → +1.5 at T1 → +13 at T2 → +57 at T5 → +63 at T6 → +86 at the T7 summit → +68 at the T8 exit → +36 at s 3,353 (descent ≈ 11 %) → +30 at T9 → +13 at the hairpin → +3 at T14 → 0.
**Test: range 75–95 m, max |grade| < 12 %.**

## 5. Tunnel (s 2,020–2,230, 210 m)
- Straight, gently rising (≈ 2.6 %), bored through a rock spur (`tunnelRidge()`: ridge crest ≈ 45 m above the road, portals ≈ 15 m).
- Driving surface = the normal main ribbon (physics and `ground()` unchanged); barriers = concrete walls at hw + 1.5 on both sides (new optional authoring field `TUNNELS`, which also removes run-off and verges there).
- Presentation (`scenery/alpine.ts`): inner walls up to 5.5 m, a 7.5 m-high flattened arch roof, a lamp strip every 12 m on both shoulders (emissive, always on), concrete portal faces with the arch opening, and the rock overburden that closes the terrain cut over the tunnel. Trees, floodlight poles and boards are kept out of the tunnel range (blockers; new optional `THEME.lights.skip`).
- Test: every s in the tunnel range has `ground()` on the main ribbon at |d| ≤ hw − 1, walls ≤ hw + 2, and the roof is ≥ 6 m above the road.

## 6. Timing
- Finish s = 0. Sector 2 at **1,834** (T6 exit), sector 3 at **3,454** (T9 exit). Speed trap **450**.
- DRS 0 (main straight): detect 5,150, activate 5,360, end 480.
- DRS 1 (valley straight): detect 3,300, activate 3,480, end 4,080.

## 7. Pit lane and grid
- Pit on the right (inside of the loop, the side away from the lake). Lessons from the Ardennes pit-entry fix: **entry and exit are both on straights**.
- Entry: leaves the right edge at s 5,150 on the 180 m straight between T14 and T15 (not mid-corner); lane cuts inside T15. Exit: rejoins the right edge at s 345 on the main straight, 185 m before the T1 braking point.
- Authored as main-frame (s, d) control points `PIT_SD` (Catmull–Rom, 1 m): d −7.5 → −17.25 (parallel) → −7.5. Pit-wall face 11.5, fast lane 14.5, working lane 20, garage fronts 24.5 (Ardennes values). Pit length ≈ 850 m (test band 800–900).
- Grid: P_k at s = L − 12 − 8k, d ±2.4, pole on the right. Slots s ≈ 5,637 → 5,485, all on the straight after T15 and after the pit entry.

## 8. Walls, run-off, cut zones
- Mountain circuit: armco and tyre walls close to the road on the climb and the descent (verge 4 m), rock faces/cuttings beyond them; generous gravel only where the speed is high on the outside (T8, T10).
- Spectator walls (concrete + catch fence): main straight both sides, T1 outside, the hairpin outside.
- `cutZones`: T1 and T10 (inside kerbs), T12–T13 (the obvious technical-section cut).

## 9. Scenery and visual brief (reference-design contract, compact)
1. **Atmosphere:** bright alpine summer: deep blue lake with the paddock on its shore, green valley floor, dark spruce forests up the slopes, grey rock and snowfields above, sharp snowy peaks on every horizon.
2. **Color:** lake `#1d3f52` to `#2c6a86`; meadows lush green (theme `'alpine'` reuses the parkland lush tint); rock `#7d7a74`; snow `#eef2f6` above ≈ +330 m and on gentle high slopes; chalets dark larch wood with white plaster base and charcoal roofs. One accent: the red cable-car cabins.
3. **Typography:** n/a (no new UI; boards reuse the sponsor atlas).
4–5. **Layout & composition:** the straight's hero view looks west along the lake to T1 with the peaks behind; the climb shows rock cuttings on the uphill side and the valley dropping away on the other; the tunnel portal is a dark arch in a rock face; the summit view opens onto the descent and the far valley.
6. **Components:** terrain (procedural, `mountainField`), lake plane (EnvMode.Water), spruce forests (species 4), three chalet villages (instanced), a cable car (towers, two cables, cabins), tunnel set, grandstands at the straight (lake side) and the hairpin, bleachers at T1, barriers per §8.
7. **Motion:** cable-car cabins move on the render clock (never sim state); lake normals as the sea.
8. **Voice:** fictional, no real names or marks.
9. **Anti-patterns:** no copying a real pass circuit; no flat green "golf course" mountains (peaks must read as rock + snow); no unlit black tunnel; no terrain or trees inside the tunnel; no new shader programs.

Quality gate: screenshots (chase, cockpit, aerial) of straight, esses, tunnel entry/inside/exit, summit, descent, hairpin at day/sunset/night/rain; budgets §11.

## 10. AI calibration estimate (Sürüş)
Two heavy stops (T1, T10), three slow-medium corners, fast esses and a long climb. Estimated d = 100 lap **1:33–1:37** (average ≈ 215 km/h). **Measured 2026-10-25: 77.61 / 76.84 / 77.12 s (avg ≈ 265 km/h, top 332 km/h, T10 apex 87 km/h, sectors 33 / 27 / 40 %)**: the esses, T7, T8 and T15 are flat out, so the lap is much quicker than estimated; band ±1.5 % around 76.84 s. Checks: T10 minimum 60–80 km/h; T3–T5 near flat out in the dry; top speed at the end of the main straight with DRS 315–335 km/h. Suggested `aeroTrim` **0** (balanced: twisty sections plus two long straights).

## 11. Budgets (High; to be measured in `?scene=track&track=alpine`)
≤ 1.5 M tris and ≤ 200 draw calls per game view, programs ≤ 55, no new programs (everything uses the env families). Alpine extras budget: tunnel + cable car + chalets + lake ≤ 8 draws.

## 12. Acceptance tests (`src/track/__tests__/alpine.test.ts`)
Shared `trackSuite` (U-TR-01…12) with: length 5,600–5,700; sequence §2; minTurn 15; minRadius 20; heading −360; pit 800–900; elevation 75–95 m; grade < 12 %; attribution matches "HAIRPIN GP" (new optional `TrackExpect.attribution`, default /OpenStreetMap/). Plus: terrain below the driving surfaces (terrain.road.test pattern), tunnel drivable (§5), build ≤ 150 ms.

## 13. Change requests (others)
See the final report: TrackId `'alpine'` (Lead, contracts), `RACE_TRACKS`/`RACE_TRACK_INFO.alpine` (Lead), i18n `tracks.alpine` TR/EN (Grafik-UI/Lead), server `minLapMs.alpine` placeholder, AI calibration row (Sürüş).
