# APEX GP: New tracks build spec (D-034)

Owner: Planlayıcı. Status: **ready to build**. Readers: Çevre, Yönetici, Sürüş, Grafik-UI, Testçi.

**Scope (user, 2026-10-11):** two new tracks now.

| Id | In-game name (TR / EN, pre-composed uppercase per D-003) | Inspired by | Geometry source |
|---|---|---|---|
| `lombardia` | `LOMBARDİYA PARK CIRCUIT` / `LOMBARDY PARK CIRCUIT` | a fast parkland circuit in northern Italy | OSM relation + EU-DEM |
| `bosphorus` | `BOĞAZ SAHİL CIRCUIT` / `BOSPHORUS SHORE CIRCUIT` | original street circuit on the İstanbul Bosphorus shore | authored centreline + OSM/EU-DEM backdrop |

Two more real-inspired tracks are deferred to **Ek C**. `TrackData.name` (sentence case): `Lombardiya Park Circuit` / `Lombardy Park Circuit` and `Boğaz Sahil Circuit` / `Bosphorus Shore Circuit`. Real circuit and corner names **never** appear in `src/**` or `public/**` (Ek A).

Reference: İstanbul (planner-report §7). Only what differs is specified.

---

## 1. Pipeline generalisation

### 1.1 What is İstanbul-only today

| Concern | Today | Change | Owner / files |
|---|---|---|---|
| Track id | `TrackId = 'istanbul' \| 'oval' \| 'straight'` | add `'lombardia' \| 'bosphorus'` (CR-TRK-1) | Lead: `src/contracts/track.ts` |
| Loading | `loadTrack()` → İstanbul only | `loadTrack(id = 'istanbul')`, per-id cache (CR-TRK-2) | Çevre: `src/track/index.ts`, new `src/track/registry.ts` |
| Session | no track in `SessionConfig` | `SessionConfig.trackId` (CR-TRK-3); `createSim` uses `opts.track ?? loadTrack(cfg.trackId)` | Lead: `contracts/race.ts`, `src/game/createSim.ts` |
| URL | no `?track=` | `LaunchParams.track` (CR-TRK-4) | Lead: `contracts/debug.ts`, launch parser |
| Authoring | `buildTrackData.ts` does `import * as A from '../authoring/istanbul'` | `buildTrackData(raw, A: TrackAuthoring)`; one authoring module per track | Çevre: `src/track/build/buildTrackData.ts`, `src/track/authoring/{types,istanbul,lombardia,bosphorus}.ts` |
| Pit side | pit is hard-wired on the **left** (pit wall at +d, `isBlocked` lateral sign, pit building side, grid pole `d > 0`) | `PIT.side: 1 \| -1` and `GRID.poleSide: 1 \| -1` in authoring. Lombardia needs the right side | Çevre: `buildTrackData.ts`, `scenery/environment.ts` (`isBlocked`), `scenery/pitBuilding.ts`, `scenery/barriers.ts` |
| Raw data | `istanbul.raw.json` + `raw.ts` exports `ISTANBUL_RAW` | `src/track/data/<id>.raw.json`; `raw.ts` keeps the `RawTrack` type plus one export per track | Çevre |
| Fallback | `data/fallback.ts` (İstanbul) | `data/fallback-lombardia.ts` (§2.12). Bosphorus needs no fallback because its centreline is authored | Çevre |
| Fetch script | constants for one track | `--track <id>` selects a config entry (§1.3) | Çevre: `scripts/fetch-track.mjs` |
| Trackside tables | `scenery/trackside.ts` hard-codes İstanbul s ranges (board straights, gantries at 1,600/4,400, distance boards before T1/T4/T9/T12) | move them to `A.TRACKSIDE` | Çevre |
| Scenery theme | pines/cypress/oak, golden grass, 18 m floodlight poles | `A.THEME` (§1.4) | Çevre |
| Sky / TOD | `BASE_RIGS` in the world frame | **no change** (§1.5) | — |
| i18n | `tracks.istanbul` used in loading, main menu, pause, results, TT | `tracks.<cfg.trackId>` everywhere, plus 2 new keys | Lead (i18n), Grafik-UI (screens) |
| Minimap | `Hud.ts` calls `loadTrack().data` | use the session's `TrackData` (`world.static.track.data`) | Grafik-UI: `src/ui/hud/Hud.ts` |
| PB / ghost | `STORAGE_KEYS.tt(trackId)` and `ghost(trackId)` are already keyed by track | `rivalGhost(buildHash)` → `rivalGhost(trackId, buildHash)` (CR-TRK-5) | Lead: `src/core/settings/defaults.ts`, `src/game/timeTrial.ts`, `src/game/ghost/rival.ts` |
| Replay | header has `trackId` | load with `loadTrack(header.trackId)` | Lead |
| AI line | built at session start from `TrackQuery` | no cache; per-track calibration (§1.6) | Sürüş |
| Track facts | `loadTrack().data` | `loadTrack(selectedId).data` | Grafik-UI |
| Perf | race scenario on İstanbul | `scripts/perf.mjs` accepts `--track` and adds `&track=` | Testçi |

### 1.2 Contract change requests (Lead)

```ts
// CR-TRK-1  src/contracts/track.ts
export type TrackId = 'istanbul' | 'lombardia' | 'bosphorus' | 'oval' | 'straight';
export type RaceTrackId = Exclude<TrackId, 'oval' | 'straight'>;

// CR-TRK-2  src/contracts/modules.ts (TrackModule)
loadTrack(id?: TrackId): TrackBundle;          // default 'istanbul'; sync; cached per id; 'oval' → createOvalTrack()

// CR-TRK-3  src/contracts/race.ts (SessionConfig)
trackId: RaceTrackId;                           // defaultSessionConfig: 'istanbul'; persisted in lastRaceSetup

// CR-TRK-4  src/contracts/debug.ts (LaunchParams)
track: RaceTrackId | null;                      // ?track=lombardia; invalid → null + console warning

// CR-TRK-5  src/core/settings/defaults.ts
rivalGhost: (trackId: string, buildHash: string) => `apexgp:v1:rivalGhost:${trackId}:${buildHash}`,
```

Lead data (not a contract): `src/data/tracks.ts` → `export const RACE_TRACKS: readonly RaceTrackId[] = ['istanbul', 'lombardia', 'bosphorus'];`, plus i18n keys `tracks.lombardia` and `tracks.bosphorus` with the strings in the scope table. After the change, re-record the contract baseline (D-025 procedure).

No change to `TrackData`, `TrackQuery`, `PitLaneData`, `LightingRig` or `BuildEnvironment`.

### 1.3 Çevre internals (no contract impact)

**`src/track/authoring/types.ts`** holds the shape that `istanbul.ts` already has, extracted:

```ts
export interface TrackAuthoring {
  id: RaceTrackId; name: { tr: string; en: string };
  OSM_LENGTH: number;                              // basis length of every s in this file
  CORNERS: readonly CornerDef[]; WIDTHS: readonly { from: number; to: number; hw: number }[]; WIDTH_BLEND: number;
  SECTOR2_S: number; SECTOR3_S: number; SPEED_TRAP_S: number;
  DRS_ZONES: readonly { id: number; detect: number; activate: number; end: number }[];
  PIT: PitAuthoring & { side: 1 | -1 };            // existing PIT fields; distances are magnitudes, side gives the sign
  GRID: { first: number; spacing: number; d: number; slots: 20; poleSide: 1 | -1 };
  VERGE; KERB; SPECTATOR_WALLS; PUDDLES; BOX_TEAMS;  // as istanbul.ts
  EXTRA_WALLS: readonly { from: number; to: number; kind: WallKind; side: 1 | -1 }[];   // replaces T8_EXIT_WALL
  TRACKSIDE: { boardStraights: { from: number; to: number; side: 1 | -1 }[]; gantries: number[]; distanceBoardCorners: number[] };
  THEME: TrackTheme;
}
```

Sponsor order on the boards is chosen inside `trackside.ts` (seeded by track id), so authoring files do not repeat sponsor indices.

**`src/track/registry.ts`** maps `RaceTrackId → { raw: RawTrack; authoring: TrackAuthoring }`. It has static JSON imports (each raw file is ≤ 80 KB; three tracks add about 200 KB to the bundle, about 60 KB gzipped). Switching to lazy `import()` is deferred until a bundle budget actually fails.

**`scripts/fetch-track.mjs --track <id>`** reads a config table at the top of the script:

| id | geometry | out | scenery bbox (lon/lat) | terrain |
|---|---|---|---|---|
| `istanbul` | ways 179048507 (main) + 295742111 (pit), S/F node 1893855303 | `istanbul.raw.json` | unchanged | 3 × 3 km at 50 m |
| `lombardia` | **relation 284565** (`type=circuit`), member role `start` = node 1828499259 (S/F), role `pit_lane` = way 38168747 | `lombardia.raw.json` | 9.2755, 45.6083 → 9.3020, 45.6350 | 3 × 3 km at 50 m, centred on the track bbox centre (x 592, z −294) |
| `bosphorus` | authored: `src/track/authoring/bosphorus-ctrl.ts` (pure data plus a `filletPolygon()` function with no imports, so Node type-stripping can load it like `fallback.ts`) | `bosphorus.raw.json` | 29.000, 41.030 → 29.080, 41.090 | 6 × 6 km at 100 m (sea and both shores) |

Relation path:
1. Call `https://api.openstreetmap.org/api/0.6/relation/<id>/full.json`. This is one call and is the most reliable route; Overpass was overloaded several times on 2026-10-11. Fall back to Overpass `relation(<id>);way(r);out geom;`.
2. Chain the non-pit member ways by shared end nodes, each in its own node order (all are `oneway=yes` in the driving direction).
3. Rotate the loop so it starts at the `start` node.
4. **Fail closed:** if the chain does not close back on the start node, use the fallback.

**Strip OSM `name` tags** from every stored feature (all tracks) so no real names reach `src/**` (Ek A).

**Ruins (lombardia only):** also store `highway=raceway` + `historic=ruins` ways in the bbox as a new raw feature kind `'ruin'` (polyline + `bridge` flag) for the banking scenery (§2.10).

### 1.4 `TrackTheme` (only fields that are used)

```ts
export interface TrackTheme {
  ground: 'golden' | 'green' | 'urban';            // terrain splat palette; 'urban' = paving + sparse grass verges
  forestMix: [pine: number, cypress: number, oak: number, broadleaf: number];  // weights in OSM forest polygons
  openTreeSpacing: number;                         // scatter spacing outside forests (İstanbul 22 m); 0 = none
  treeSetback: number;                             // min distance from barriers (İstanbul 25–30 m)
  lights: { height: number; spacing: number; bothSides: boolean; head: 'flood' | 'street' };
  backdrop: 'residential' | 'parkland' | 'city';
  sea: null | { y: number };                       // water plane height (bosphorus only)
}
```

Add tree species 3, **broadleaf** (18–25 m deciduous crown on a visible trunk; one more 256² billboard cell). Lombardia and Bosphorus need it. İstanbul keeps `forestMix [0.78, 0.11, 0.11, 0]`.

### 1.5 Sky and time of day per location

The world frame is geographic for every track (+X east, −Z north; §7.1 projection with φ = origin latitude; Bosphorus (u, v) is rotated into it, §3.2), so `BASE_RIGS.sunDir` is already right everywhere. Latitude differences (41.06°, 45.62° vs 40.95°) move noon sun elevation ≤ 5°, below what the grading shows.

**No per-track rig values.** The only per-track sky difference is the night horizon glow strength: Bosphorus uses a city glow ×1.6 (`THEME.backdrop === 'city'` scales the existing sodium horizon band in `sky.ts`).

### 1.6 Other owners

- **Grafik-UI.**
  - Add a **PİST / TRACK** stepper row (first row) to `ttSetup` and `raceConditions`, cycling through `RACE_TRACKS`. No new screen.
  - The main-menu info card shows facts and PB for the focused track's last selection.
  - The minimap stays north-up (ui-hud §2). Fit the longer bbox side: Lombardia is tall (1.26 × 2.17 km), Bosphorus is wide.
  - The Planner updates `ui-hud.md` §6 when the Lead accepts CR-TRK-3.
- **Sürüş.**
  - Make `calibration.test.ts` table-driven per track (§2.11, §3.11).
  - `EDGE_MARGIN` 1.3 m stays. If Bosphorus AI touches walls more than once per 10 laps, use a 1.6 m margin wherever `wall − halfWidth < 2.5 m` (computed from `TrackData`, no new data).
- **Testçi.**
  - `tests/sim/tracks.spec.ts`: 20 AI × 3 laps per track.
  - Perf run per track.
  - The banned-words test (Ek A).

---

## 2. Lombardia (parkland, fast, flat, clockwise)

### 2.1 Facts
- OSM main loop **5,798 m** (real reference 5,793 m). The OSM pit way is 742 m.
- Direction **clockwise**: net heading **−360°** in the U-TR-04 convention (İstanbul is +360°).
- **11 corners**. Origin = S/F node 1828499259 at 45.6189632 N, 9.2811729 E.
- The main straight runs north from the S/F. The pit lane is on its **right (east)**.
- Track bbox in world metres: x −38…1,223, z −1,378…790.
- Projection: §7.1 formulas with φ = 45.6189632°.
- Elevation: `y = EU-DEM − DEM(S/F)`.

### 2.2 Corners
s is on the OSM basis of 5,798 m; rescale like İstanbul. Radii were measured from OSM nodes; the racing line is wider. vApex is used only for run-off width.

| T | Dir | entry–exit (apex) | Turn | Min R | vApex km/h | Character | Run-off / outside wall |
|---|---|---|---|---|---|---|---|
| 1 | R | 600–640 (615) | ~100° | 18 | 85 | First chicane: heaviest braking of the lap (≈ 345 → 85) | painted asphalt, then gravel; tecpro; sausage |
| 2 | L | 640–690 (660) | ~120° | 16 | 80 | Chicane exit | painted asphalt; armco; sausage |
| 3 | R | 990–1,400 (1,180) | ~65° | 250 | 285 | Long flat-out right sweep | gravel 40 m; armco |
| 4 | L | 1,815–1,860 (1,835) | ~70° | 26 | 100 | Second chicane, left part | painted asphalt; tecpro; sausage |
| 5 | R | 1,860–1,900 (1,880) | ~60° | 28 | 105 | Second chicane, right part | asphalt; armco |
| 6 | R | 2,180–2,320 (2,250) | ~105° | 72 | 185 | First forest right, slightly downhill | gravel 25 m; tyres |
| 7 | R | 2,540–2,610 (2,570) | ~65° | 34 | 170 | Second forest right; exit onto the long run under the old-banking bridge | gravel 20 m; tyres |
| 8 | L | 3,620–3,670 (3,645) | ~55° | 35 | 200 | Fast chicane, left entry | gravel; tecpro |
| 9 | R | 3,680–3,800 (3,740) | ~55° | 100 | 215 | Fast chicane, long right middle | gravel; armco |
| 10 | L | 3,800–3,860 (3,830) | ~45° | 43 | 235 | Fast chicane, left exit onto the back straight | asphalt; armco; sausage |
| 11 | R | 4,810–5,250 (4,880) | ~180° | 70 → 150 | 200 | Long tightening-then-opening right onto the main straight (the signature corner) | 3 m asphalt band, then gravel to 45 m; tyres + tecpro |

- Unnumbered: a −12° left kink at 2,900–3,050 (flat out, under the ruin bridge).
- **Sequence test: `R L R L R R R L R L R`.**
- Per-track test thresholds: every corner turns > 25°; `minRadius` > **14 m** (T2 is ~16 m on the OSM nodes, which is below İstanbul's 17 m).

### 2.3 Elevation
- EU-DEM, 100 m samples, relative to S/F (fallback array in §2.12).
- Shape of the lap:
  1. Flat to T1.
  2. A gentle climb through T3 to about +9 m (T4–T5 at +9.5).
  3. +7…+10 m through T6, T7 and the kink.
  4. Falling through T8–T10 (+4 → 0).
  5. The lowest section, −4…−8 m, on the back straight and into T11.
  6. Back to 0 on the main straight.
- The park canopy contaminates EU-DEM (dips of −6 m at 2,400–2,500 are artefacts). Use Gaussian **σ = 80 m** (İstanbul 40 m) and the same vertical-curvature clamp.
- Test: built elevation range **10–20 m**, max |grade| < 3 %.
- Terrain is near flat: the splat uses `ground: 'green'`.

### 2.4 Widths and banking
| s range | hw L/R |
|---|---|
| default | 7 / 7 |
| main straight 5,300 → 480 | 9 / 9 |
| T1 braking 480–600 | 10 / 10 |
| T1–T2 600–700 | 8 / 8 |
| T3 990–1,400 | 7.5 / 7.5 |
| T4 braking 1,700–1,815 | 8.5 / 8.5 |
| run under the bridge 2,620–3,560 | 7.5 / 7.5 |
| T8 braking 3,500–3,620 | 8.5 / 8.5 |
| T11 4,810–5,300 | 8 / 8 |

Banking (+ = into the corner): T11 +1.5°, T6 +1°, T3 +0.5°, everything else 0.

### 2.5 Timing
- Finish at s = 0.
- Sector 2 starts at **1,700**, sector 3 at **3,950**.
- Speed trap at **450**.
- DRS zone 0 (main straight): detect 4,790, activate 5,370, end 470.
- DRS zone 1 (after T7): detect 2,700, activate 2,820, end 3,560.

### 2.6 Pit lane and grid
- The pit is on the **right** (`PIT.side = −1`).
- Split at main s ≈ **5,240** (inside T11 exit); merge at main s ≈ **184**. The OSM pit length is 742 m. **Test band 700–790 m.**
- The pit runs parallel at about 18.4 m right of the centreline from main s 5,470 to 20.
- Lateral magnitudes:

  | Item | Main d |
  |---|---|
  | pit-wall face | 12.6 |
  | fast lane | 15.6 |
  | working lane | 21.1 |
  | garage fronts | 25.6 |

- Limiter from sp **100 to 660**.
- 10 boxes at sp = 280 + 28k, all inside the parallel section.
- The pit-exit line runs to s ≈ 300.
- Target pit loss 19–23 s.
- **Grid:** P_k at s = L − 12 − 8k, d = −2.4 (k even) / +2.4 (k odd). The pole is on the **right**, the inside of T1 (`GRID.poleSide = −1`). Slots span s ≈ 5,786 → 5,634, all after the pit split.

### 2.7 Track limits and cut zones
- `cutZones`:
  - T1–T2 (both insides; gates at both apexes). This is the obvious chicane cut.
  - T4–T5 (both insides).
  - T8–T10 (insides of T8 and T10).
- T11 exit uses track limits only (D-033): no cut zone, but the outside run-off is wide, so the excursion test is what matters there.
- Walls:
  - Concrete + catch fence on both sides of the main straight. The left (west) side is the main grandstand; on the right the pit wall is at 12.6.
  - Concrete + fence at the T1, T4, T11 spectator areas. Armco elsewhere.
  - Clearance at least 40 m outside T3 and at least 45 m outside T11.
  - Continuous chains; gaps only at pit entry and exit.

### 2.8 Data source and verification (done 2026-10-11)
- Relation **284565**, `type=circuit`, has 20 main member ways plus pit way 38168747 (`pit_lane`) and node 1828499259 in roles `start`/`finish`.
- Chained in member order (reverse-linked; each way's last node = the next-listed way's first node), they close on the start node: 293 nodes, 5,798.2 m.
- Pit endpoints: split node 616124945 (main s 5,241) and merge node 616124943 (main s 184), both on the main loop.
- EU-DEM sample at S/F: 188.7 m.

### 2.9 Elevation and terrain pipeline
- As İstanbul (25 m centreline, 3 × 3 km grid at 50 m, `eudem25m`). Scenery from OSM API `map.json` (bbox §1.3); on a 509, use Overpass.

### 2.10 Scenery theme: royal parkland
- **`THEME`:**
  - `ground 'green'`, `forestMix [0.05, 0, 0.15, 0.80]`, `openTreeSpacing 18`.
  - `treeSetback 18` (forest crowds T6–T7 and the run under the bridge; that is the character).
  - `lights { height 18, spacing 30, bothSides false, head 'flood' }`.
  - `backdrop 'parkland'`, `sea null`.
- **Forest:** OSM `landuse=forest` / `natural=wood` polygons inside the park, at a dense fill spacing of 8 m (İstanbul 8.5 m).
  - Avenues of broadleaf trees line both sides of the main straight beyond the grandstands.
  - Tree budget: ≤ 2,500 3D instances within 150 m and ≤ 25,000 billboards. Cut billboard density before raising the triangle budget.
- **Old banking ruins** (generic, no names):
  - `'ruin'` polylines → 12 m weathered, moss-tinted concrete ribbon banked 0° → 28° by curvature, broken railings.
  - A `bridge=yes` ruin way crossing the circuit (expected on the T7–T8 run) → concrete overpass, 6 m clearance, piers ≥ 3 m behind the walls.
  - ≤ 60 k triangles, ≤ 4 draws (counted under "buildings").
- **Grandstands:** main grandstand on the **left** of the main straight (s 5,500 → 300, setback 30–40 m, 3 tiers with roof). Bleachers from OSM `leisure=bleachers` / `building=grandstand`. Where OSM has none, add them at T1 outside, T4, T6 outside, T8 and T11 outside.
- **Pit building:** on the right, 2 floors plus a podium terrace; same team-coloured garages.
- Backdrop: villa-style generic buildings from OSM `building=*` (low, ochre and cream palette), a residential fringe beyond the park, and no hills.
- **Budgets:** §7.14 unchanged (High ≤ 1.5 M triangles / 200 draws). Rebalance: trees ≤ 500 k, buildings + ruins ≤ 150 k, terrain ≤ 150 k (flat).

### 2.11 AI calibration
- **Ratio** `k = 86.4 / 82.868 = 1.0426` (game İstanbul d = 100 target over the real İstanbul qualifying record 1:22.868, 2021). Reference here: pole 1:18.792 (2025).
- **Target 1:22.1; band = target × [0.972, 1.007] = 1:19.9–1:22.7** (İstanbul's 84.0–87.0 window around 86.4).
- Other checks:
  - Top speed on the main straight 335–350 km/h (DRS on).
  - T11 minimum 190–215 km/h.
  - Sector time shares 33/35/32 % ± 3.
- **Risk:** the game uses one aero setup. If the band cannot be reached without breaking İstanbul, Sürüş reports the measured lap and the Planner re-bands. No per-track car parameters without an orchestrator decision.
- **Wet:**
  - Puddles at s 2,560 (d +5), 3,700 (d −5), 4,900 (d +6) and 540 (d −4).
  - Spray on the long straights matters most for visibility; no other changes.
  - Inters at W 0.5 cost +8–13 % (as İstanbul).

### 2.12 Fallback geometry (world XZ m, S/F origin, driving order; derived from OSM, ODbL)
Main loop: 111 points (Douglas–Peucker 0.6 m), closed, length ≈ 5,795 m.
```
[0.0,0.0],[8.2,-67.7],[56.9,-614.5],[59.2,-619.0],[64.1,-621.9],[67.1,-622.4],[73.4,-621.4],[84.0,-617.8],[92.3,-618.0],[98.1,-622.5],[101.2,-630.7],[100.6,-638.7],[98.2,-649.2],[79.4,-721.1],[75.0,-742.1],[72.3,-759.4],[70.8,-778.7],[70.3,-803.3],[81.9,-945.1],[87.0,-972.8],[91.1,-988.1],[97.9,-1007.8],[109.0,-1033.5],[121.4,-1056.8],[135.7,-1078.1],[160.8,-1107.6],[174.3,-1120.6],[187.9,-1132.4],[219.5,-1155.4],[234.7,-1164.9],[256.8,-1176.8],[287.2,-1190.4],[312.9,-1199.0],[356.9,-1210.4],[382.3,-1215.0],[419.5,-1219.4],[578.2,-1232.1],[659.5,-1238.0],[792.1,-1245.0],[797.8,-1247.1],[801.2,-1250.8],[803.8,-1256.2],[812.3,-1282.4],[814.6,-1285.7],[819.3,-1288.9],[862.0,-1297.0],[889.0,-1303.5],[1105.3,-1374.3],[1115.4,-1376.8],[1129.7,-1378.1],[1142.3,-1376.6],[1151.0,-1374.1],[1161.3,-1369.8],[1172.6,-1362.8],[1182.5,-1353.5],[1188.2,-1346.4],[1194.1,-1336.4],[1198.6,-1324.8],[1202.2,-1302.3],[1222.9,-1078.7],[1223.1,-1069.6],[1221.9,-1062.1],[1218.7,-1053.9],[1214.7,-1048.4],[1206.8,-1042.2],[917.0,-880.9],[882.1,-859.0],[852.7,-838.1],[827.6,-817.8],[379.1,-426.6],[368.6,-414.6],[366.7,-410.0],[365.9,-401.6],[369.7,-365.8],[370.1,-344.9],[368.3,-331.3],[363.5,-314.6],[354.4,-295.9],[348.0,-286.9],[334.5,-273.0],[308.9,-252.7],[303.2,-244.0],[299.9,-234.0],[273.7,-25.1],[195.8,722.7],[194.1,731.7],[190.2,742.2],[185.8,750.1],[176.6,762.4],[165.3,772.6],[154.9,779.1],[139.7,785.5],[126.3,788.8],[115.1,789.7],[103.0,788.7],[77.2,781.1],[65.8,776.3],[52.2,768.5],[41.0,760.6],[28.6,750.0],[18.8,739.7],[8.7,727.1],[-4.4,706.7],[-12.8,689.8],[-22.5,663.5],[-28.3,641.7],[-32.3,617.6],[-34.9,592.3],[-37.6,412.5],[-36.7,369.7],[-31.5,307.9]
```
Pit lane, 10 points, split → merge:
```
[-35.5,555.6],[-30.0,503.2],[-27.6,465.4],[-19.6,396.5],[-15.2,329.2],[20.1,-19.5],[20.5,-35.6],[19.1,-63.7],[19.5,-143.0],[18.4,-183.1]
```
Elevation: 58 EU-DEM samples at s_k = 100·k (OSM basis), y relative to S/F, unsmoothed:
```
0.0 -1.6 -0.1 0.5 1.1 -0.7 1.7 3.1 4.3 6.7 8.1 8.6 4.0 7.6 7.4 6.3 8.2 9.5 8.8 6.7 6.3 7.4 10.6 9.2 3.2 2.4 7.9 10.5 9.5 10.2
9.3 9.5 9.0 6.1 9.3 7.6 5.1 3.9 4.1 3.3 -0.4 -2.0 -4.4 -5.9 -3.7 -2.1 -4.3 -6.4 -6.7 -5.5 -5.5 -7.9 -6.2 -5.0 -3.4 -3.3 -2.1 -1.4
```
Checked: the pit leaves the main line at (−35.5, 555.6), runs ≈ 17.7 m east (= right when driving north, −z) and rejoins at (18.4, −183.1). OSM state 2026-10-11; the live fetch replaces these.

---

## 3. Bosphorus Shore (original street circuit, night showcase, anti-clockwise)

### 3.1 Concept
- Fast street circuit on the European shore between the two older suspension bridges: a 1.56 km waterfront straight (grandstand on a pier between track and sea), 90° city corners up to a ridge boulevard, a sweeping descent to a waterfront hairpin, a bus-stop chicane back onto the straight.
- Walls everywhere. Built for night: lit bridges, skyline on both shores, ferries, reflections.
- **Length 4,978 m**, **11 corners**, anti-clockwise, net heading **+360°**. The pit is on the **left** (inland), the same as the İstanbul code path.

### 3.2 Local frame and placement
- The authoring frame is (u, v) in metres:
  - u runs along the shore, northward-ish;
  - v points inland, to the left of +u;
  - S/F is at (0, 40), heading +u.
- World mapping, with β = coast bearing (default **15°**, measured from OSM coastline way 671228671 between 41.0504 N and 41.0600 N):
  - `x = u·sinβ − v·cosβ`
  - `z = −u·cosβ − v·sinβ`
  - (u ↦ bearing β, v ↦ bearing β − 90°)
- The origin (u, v) = (0, 0) is a point 14 m inland of the coastline. Default anchor **41.0553 N, 29.0355 E**.
- **Placement rules, checked by the fetch script, which shifts the anchor along the coast in 50 m steps until all hold:**
  - (a) Each bridge tower (from OSM bridges 403255158 and 403376607) is ≥ 150 m from any track or wall point.
  - (b) The authored seawall (v = −14 for u ∈ [−1,150, 1,150]) lies on or inland of the OSM coastline ± 20 m everywhere, so the track is never over water.
  - (c) The hairpin T9 is ≥ 250 m from the southern bridge axis. It may sit under the bridge's line of sight; that is the intended shot.
- Land between the authored seawall and the real coast becomes promenade (paving and plane trees).
- **The world frame stays geographic**, so the sun directions (§1.5) and the bridge/Asian-shore positions are real.

### 3.3 Centreline (fillet polygon)
A closed polygon whose vertices carry a corner radius. Each vertex becomes tangent arcs joined by straights (`filletPolygon(ctrl, step = 1 m)`, about 40 lines, no imports). Vertices are (u, v, r) in driving order:

```
[950,40,22], [950,200,30], [1150,200,25], [1150,440,40], [850,440,90], [720,340,90],
[-520,340,50], [-740,120,40], [-1080,50,25], [-1080,0,25], [-700,0,40], [-640,40,40]
```

- The raw polyline starts at (0, 40) (S/F) and runs +u.
- Pre-smoothing length 4,978 m. **Test band 4,940–5,020 m.**
- Verified by script (2026-10-11): no fillet overlap; net turn +360.0°.

### 3.4 Corners
s values below are measured from S/F (s = 0 at u = 0 on the main straight).

| T | Dir | entry–exit (apex) | Turn | R | vApex | Character | Outside |
|---|---|---|---|---|---|---|---|
| 1 | L | 928–963 (945) | 90° | 22 | 85 | End of the 1.5 km straight; brake from ~315 km/h; escape road straight on along the shore (70 m, tecpro at the end) | escape road |
| 2 | R | 1,071–1,118 (1,094) | 90° | 30 | 100 | City block corner | concrete, d = hw + 2.5 |
| 3 | L | 1,263–1,302 (1,282) | 90° | 25 | 90 | Uphill 90° into the climb (6 % grade) | concrete + tecpro |
| 4 | L | 1,477–1,540 (1,508) | 90° | 40 | 120 | Blind crest at the top (+20 m), onto the ridge | concrete + tecpro |
| 5 | L | 1,769–1,828 (1,799) | 38° | 90 | 200 | Fast ridge sweep, left | concrete, hw + 3 |
| 6 | R | 1,931–1,990 (1,960) | 38° | 90 | 200 | Fast ridge sweep, right, then 1.19 km flat out | concrete, hw + 3 |
| 7 | L | 3,179–3,218 (3,198) | 45° | 50 | 140 | Heavy braking, turn down toward the sea; escape road straight on (60 m) | escape road |
| 8 | R | 3,496–3,520 (3,508) | 33° | 40 | 150 | Downhill (−5.5 %) right kink, walls close | concrete + tecpro |
| 9 | L | 3,834–3,913 (3,873) | 168° | 25 | 70 | Waterfront hairpin; overtaking spot; 25 m asphalt run-off | tecpro |
| 10 | L | 4,255–4,279 (4,267) | 34° | 40 | 155 | Bus-stop chicane, left | concrete |
| 11 | R | 4,327–4,350 (4,339) | 34° | 40 | 155 | Bus-stop chicane, right; 628 m to S/F | concrete |

**Sequence test: `L R L L L R L R L L R`.** Every corner turns > 25°; `minRadius` > 17 m.

### 3.5 Elevation (authored)
- `y(v) = 20 · smoothstep(80, 420, v)` m, with the sea plane at **y = −2.0** and the seawall top at 0.
- Ranges: waterfront 0 m; T2–T3 street about +6 m; the ridge boulevard (v 340–440) +17 to +20 m.
- Grades: climb T3→T4 ≈ 6 %, descent T7→T8 ≈ 5.5 %.
- Apply the same vertical-curvature clamp as İstanbul; T4 is a crest (watch `vCurvature` ≥ −1/700).
- **Test: range 18–21 m.**
- Terrain backdrop: EU-DEM 6 × 6 km at 100 m, `y = DEM − 2.0`. Within 250 m of any track, pit or wall point the authored street plateau (`y(v)` plus 0.15 m kerb height for pavements) overrides the DEM, blended over 250–400 m.

### 3.6 Widths and banking
| s range | hw L/R |
|---|---|
| default | 6.5 / 6.5 |
| main straight 4,350 → 760 | 7.5 / 7.5 |
| T1 braking 760–930 | 8.5 / 8.5 |
| ridge boulevard 1,540 → 3,180 | 7 / 7 |
| T9 hairpin 3,780–3,960 | 8 / 8 |

- Banking 0 everywhere (street crown 1.5 % visual only, crossSlope 0).
- Run-off defaults for a street circuit: no gravel, no astroturf. Inside kerbs are flat 1.0 m (no sawtooth). Walls are at **hw + 2.0** on straights and **hw + 2.5…3** outside corners, except at the escape roads and T9.
- `VERGE.straight` = 2.0 (pavement surface `'concrete'`).

### 3.7 Timing
- Finish at s = 0.
- Sector 2 starts at **1,700** (after T4), sector 3 at **3,300** (after T7). Shares by distance 34/32/34 %.
- Speed trap at **800**.
- DRS zone 0 (main straight): detect 4,300, activate 4,420, end 780.
- DRS zone 1 (ridge): detect 1,900, activate 2,050, end 3,120.

### 3.8 Pit lane and grid
- The pit is on the **left / inland** (`PIT.side = 1`). It is authored as main-frame (s, d) control points and converted to world XZ by the fetch script.
- `PIT_SD = [[4600,7.5],[4660,12],[4720,16],[380,16],[450,12],[520,7.5]]`, Catmull–Rom at 1 m.
- Pit length ≈ 900 m (**test band 870–930**).
- Lateral layout:

  | Item | Main d |
  |---|---|
  | pit-wall face | 9.5 |
  | fast lane | 13.5 |
  | working lane | 18.5 |
  | garage fronts | 23 |

- Limiter from sp **100 to 800**. 10 boxes at sp = 300 + 28k.
- Target pit loss 20–24 s.
- **Grid:** P_k at s = L − 12 − 8k, d = +2.4 / −2.4. The pole is on the **left**, the inside of T1. Slots span s 4,966 → 4,814, after the pit split.

### 3.9 Cut zones and walls
- `cutZones`: T10–T11 (both insides) and the T9 inside.
- Everything else is wall-bounded, so no cut is possible.
- Walls:
  - Concrete blocks + debris fence on both sides along the whole lap.
  - Tecpro at T1, T3, T4, T7, T8 and T9 impact faces and at the end of the escape roads.
- Chains are continuous. Gaps only at pit entry/exit and the two escape-road mouths. An escape road is a wall pocket (an asphalt rectangle 14 m wide × 60–70 m long with closed walls), not a gap.
- Test: wall–edge clearance ≥ 1.5 m everywhere.

### 3.10 Scenery theme: waterfront city at night
- **`THEME`:**
  - `ground 'urban'`, `forestMix [0.2, 0.1, 0, 0.7]`, `openTreeSpacing 0`, `treeSetback 4`.
  - Street trees are placed by rule instead: plane trees every 12 m along the ridge boulevard and the promenade.
  - `lights { height 10, spacing 25, bothSides true, head 'street' }`: warm 3,000 K street heads. Feed them into the existing floodlight lightmap; the lightmap covers the track bbox, which here is 2.3 × 1.0 km.
  - `backdrop 'city'`, `sea { y: −2 }`.

| Element | Spec | Budget (High) |
|---|---|---|
| **Water** (`scenery/water.ts`, new) | Plane clipped to the OSM coastline polygon plus the authored seawall, 8 km across. Two scrolling normal maps (procedural), env reflection; at night, vertical light-streak billboards under the bridges, ferries and shore lamps (reuse the §7.13 streaks) | ≤ 20 k tris, 2 draws |
| **Bridges** (`scenery/bridges.ts`, new) | Two generic suspension bridges at the OSM positions: towers 165 m, deck 64 m above water, main span ≈ 1,070 m, two cable catenaries plus hangers as one alpha-tested strip mesh. Night: emissive deck and cable lights with a slow colour cycle (generic, no pattern copying) | ≤ 60 k tris, 6 draws |
| **Skyline** | OSM `building=*` within 3 km on **both** shores, extruded with `levels` (default 5). Window texture with 45 % lit cells at night | ≤ 300 k tris, ≤ 12 draws |
| **Generic domed silhouettes** | 4 instanced generic mosques (dome, half-domes and 2 or 4 slim minarets), ≤ 2 k tris each, on the ridge lines of both shores, floodlit warm at night. **No replica of any specific building** | ≤ 10 k tris, 1 draw |
| **Ferries** | 3 instances on deterministic loops (`t` from the render clock, never sim state) between both shores; lit windows at night | ≤ 15 k tris, 1 draw |
| **Moored yachts** | 10 instances at the pier | ≤ 20 k, 1 draw |
| **Street buildings** | Rows of 4–6-storey facades along the inland streets (T2–T4, the ridge), set back 6–10 m behind the walls; pastel and timber palette; shopfront emissive at night | inside the skyline budget |
| **Grandstands** | Main pier grandstand on the right (sea side) s 4,700 → 200, setback 12–35 m. Temporary bleachers at T1 (outside, on the escape road side), T4 crest and T9 | §7.14 |
| **Pit building** | Inland on the left, 2 floors, roof terrace | §7.14 |

- **Rebalanced totals (High):**

  | Component | Triangles | Draws |
  |---|---|---|
  | ribbon | 180 k | 50 |
  | terrain | 120 k | 12 |
  | trees | 120 k | 6 |
  | stands + crowd | 230 k | 28 |
  | skyline + buildings | 300 k | 12 |
  | bridges | 60 k | 6 |
  | water | 20 k | 2 |
  | barriers + fences | 230 k | 44 |
  | misc (ferries, yachts, domes, lights) | 60 k | 10 |
  | **total** | **≤ 1.32 M** | **≤ 170** |

- Shader programs ≤ 55 (D-027): water is the only new program.

### 3.11 AI calibration and wet
- There is no real reference.
- **Derived estimate:** street circuits with long straights average about 205 km/h at real pole pace (city circuits with 1.2–2 km straights range 199–254). 4,978 m / 205 km/h = 87.4 s; × k 1.0426 = 91.1 s.
- **Provisional band 1:28.6–1:31.8** (×[0.972, 1.007]). After the first green 20-car run Sürüş reports the measured d = 100 lap. If it is outside the band, the Planner moves the band to the measurement ± the same window, once, and logs it in DECISIONS.
- Checks:
  - T1 entry 305–320 km/h.
  - T9 apex 65–80 km/h.
  - No wall contact > 2 kN·s by the d = 100 AI in 10 laps.
- **Wet:**
  - Puddles at the T9 hairpin (s 3,870, d −4), the waterfront low (s 4,050, d +3), T1 braking (s 880, d −4) and T3 (s 1,290, d +3).
  - Painted road markings (zebra crossings at 3 spots and lane lines on the straights) get the glossier wet look from §7.13. This is visual only; no new `SurfaceType`.

### 3.12 Data
`bosphorus.raw.json`:
- `source: 'authored+osm'`
- `main.xz` comes from §3.3 and `pit.xz` from §3.8, both mapped by §3.2.
- `elevation` is from §3.5.
- `terrain` is the DEM grid.
- `features` hold buildings, coastline and bridges (new raw kinds `'coast'` and `'bridge'`), with names stripped.
- Overpass/OSM queries for the 41.030–41.090 N × 29.000–29.080 E bbox:
  - `way["natural"="coastline"]`
  - `way["building"]`
  - `way["man_made"="bridge"]["bridge:structure"="suspension"]`
  - verified 2026-10-11: ids 403255158 (southern bridge, 41.0455 N 29.0344 E, height 65 m) and 403376607 (northern bridge, 41.0913 N 29.0612 E, height 64 m).
- Overpass only (bbox exceeds the OSM API limit), 3 retries, 60 s backoff. **If Overpass is down the track still builds:** skyline → procedural blocks; water → straight seawall plus a far shore at v = −850.

---

## 4. Acceptance tests (per track; `src/track/__tests__/<id>.test.ts` through a shared `trackSuite(id, expect)` helper)

| # | Test | lombardia | bosphorus |
|---|---|---|---|
| U-TR-01 | Closure: end gap < 0.5 m, tangent jump < 1° | ✓ | ✓ |
| U-TR-02 | Length band | 5,760–5,840 m | 4,940–5,020 m |
| U-TR-03 | Turn sequence; each turn > 25°; minRadius | `R L R L R R R L R L R`; > 14 m | `L R L L L R L R L L R`; > 17 m |
| U-TR-04 | Net heading | −360° ± 1° | +360° ± 1° |
| U-TR-05 | `worldFromSD` → `project` round trip | < 2 cm, 10 k seeded samples | same |
| U-TR-06 | Walls continuous; ≥ 1 m outside the outermost band; gaps only at pit entry/exit | ✓ | ✓, plus escape pockets closed and clearance ≥ 1.5 m |
| U-TR-07 | Grid inside limits on asphalt; pole side; pit ribbon joins the main edge on `PIT.side` (< 1 m, Δy < 0.1 m); pit length band; 10 boxes inside the limiter on concrete | pole d < 0; 700–790 m | pole d > 0; 870–930 m |
| U-TR-08 | `ground()` ≤ 1 µs mean | ✓ | ✓ |
| U-TR-09 | Deterministic; build ≤ 150 ms | ✓ | ✓ |
| U-TR-10 | Elevation range; max \|grade\| | 10–20 m; < 3 % | 18–21 m; < 7 % |
| U-TR-11 | Timing order: sectors, DRS, speed trap inside [0, L); DRS activation lies on a straight (\|κ\| < 1/400) | ✓ | ✓ |
| U-TR-12 | No banned word in `TrackData.name`, `attribution` or raw features | ✓ | ✓ |
| S-TRK-1 (Testçi) | 20 AI × 3 laps, seed 1234: all finish, no car `stuckT` > 5 s, 0 contacts > 5 kN·s on lap 1 | ✓ | ✓ |
| S-TRK-2 (Sürüş) | d = 100 perfect-driver lap in band | 1:19.9–1:22.7 | 1:28.6–1:31.8 (provisional) |
| P-TRK (Testçi) | `perf.mjs --track <id>`: High 1080p race start, 20 cars ≥ the İstanbul FPS gate; env ≤ 1.5 M tris / 200 draws | ✓ | ✓ |
| V-TRK (Çevre) | Screenshots looked at (Read): see `docs/team/track-designer.md` | day, sunset, night, rain | night first |

**İstanbul regression:**
- U-TR-01…09 must stay green after the generalisation.
- The İstanbul `TrackData` arrays hash identically before and after G1 (record the hash first).

---

## 5. Build order and parallel work

1. **Lead L-T1 (small, first):** CR-TRK-1…5, the i18n keys, `RACE_TRACKS`, and `createSim`/launch wiring with `loadTrack(id)` falling back to İstanbul for unknown ids. Re-record the contract baseline. *Files: contracts, core, game, data, main.ts.*
2. **Çevre G1 (generalise, no new track yet):**
   - `authoring/types.ts`, `buildTrackData(raw, A)`, `registry.ts`, `PIT.side` / `GRID.poleSide`, `TRACKSIDE`/`THEME` tables.
   - `fetch-track.mjs --track`, broadleaf species, the `trackSuite` helper.
   - **Gate:** İstanbul hash unchanged, every existing test green.
3. **Çevre T-A, Lombardia (first: real data, flat terrain, the lowest pipeline risk).** It is also the only consumer of the right-side pit, so it validates G1:
   - fetch, then authoring, then U-TR-01…12;
   - then the H-A hand-off (`loadTrack('lombardia')` works);
   - then scenery and screenshots.
4. **Çevre T-B, Bosphorus:**
   - `bosphorus-ctrl.ts` + `filletPolygon`, placement fit, authoring, tests;
   - then the H-B hand-off;
   - then `water.ts`, `bridges.ts`, skyline, street lights, night shots.
5. **In parallel once each H-hand-off lands:**
   - Sürüş: calibration per track (`src/ai/**`).
   - Grafik-UI: track row, minimap fit, info card (`src/ui/**`). It can start right after L-T1 against İstanbul and the oval.
   - Testçi: S-TRK-1, P-TRK, the banned-words test (`tests/**`).
6. **QC pass** per track: the visual checklist and §4.

No two roles share a file. Çevre must not touch `src/ui/**` or contracts. Grafik-UI reads track data only through `TrackData`.

---

## Ek A: IP name check

| Item | Rule | Status |
|---|---|---|
| Track names | Lombardy Park / Lombardiya Park; Bosphorus Shore / Boğaz Sahil. Region and waterway names are geographic, not circuit trademarks | OK |
| Track ids | `lombardia`, `bosphorus` (appear in URLs and storage keys) | OK |
| Corner names | Only T-numbers in game. Real corner names (the Italian chicane, curve and forest names, or anything named after a person) never appear | OK |
| Raw data | OSM `name` tags stripped; OSM relation tags not stored; raw file names use the fictional id | Çevre G1 |
| Landmarks | Bridges and mosques are generic low-poly forms. No logos, no replica of a specific building, no real sponsor | Çevre T-B |
| Banned-word test (Testçi) | Case-insensitive scan of `src/**` (code, i18n, JSON) and `public/**` for: `monza`, `autodromo nazionale`, `parabolica`, `lesmo`, `ascari`, `rettifilo`, `spa-francorchamps`, `francorchamps`, `eau rouge`, `raidillon`, `silverstone`, `istanbul park`, `f1`, `formula 1`, `formula one`. Allowed only in `docs/**` and `scripts/**` (the fetch-script config comments). Match `f1` only as a whole word | new test |

## Ek B: CREDITS lines (`public/assets/env/CREDITS.part.md`, the UI credits screen, `TrackData.attribution`)

- Lombardy Park Circuit: track geometry and scenery footprints derived from OpenStreetMap data © OpenStreetMap contributors (ODbL 1.0). The derived file lombardia.raw.json is also provided under ODbL. (Source: OSM relation 284565 and way 38168747 via api.openstreetmap.org; scenery via map.json bbox 9.2755,45.6083,9.3020,45.6350.)
- Lombardy Park Circuit elevation: EU-DEM v1.1, produced using Copernicus data and information funded by the European Union; served via OpenTopoData.
- Bosphorus Shore Circuit: original layout by the APEX GP team. Shoreline, buildings and bridge positions derived from OpenStreetMap data © OpenStreetMap contributors (ODbL 1.0). The derived file bosphorus.raw.json is also provided under ODbL.
- Bosphorus Shore Circuit terrain: EU-DEM v1.1, produced using Copernicus data and information funded by the European Union; served via OpenTopoData.

## Ek C: Later (not in this build)

- **Ardennes-forest track (Spa-inspired).**
  - OSM relation **284560** (`type=circuit`), verified 2026-10-11: 30 member ways, main ≈ 6,995 m (real 7,004 m), pit way 323851541 (719 m).
  - Clockwise, 19 corners, about 100 m of elevation change (the hardest terrain: 5 × 4 km DEM grid, dense spruce forest).
  - Calibration reference: pole 1:40.562 (2025) × k → 1:44.9.
  - Needs the G1 pipeline unchanged plus a larger terrain grid.
- **Airfield track (Silverstone-inspired).**
  - OSM relation **51160** (`type=circuit`, "Grand Prix" layout) exists; its member list was not yet fetched (Overpass overloaded).
  - Clockwise, 18 corners, ≈ 5,891 m, flat former airfield (≈ 15 m range), open fields, few trees, big grandstands.
  - Calibration: pole 1:24.892 (2025) × k → 1:28.5.
  - Lowest scenery cost of all; a good third track.
