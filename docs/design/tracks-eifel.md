# Eifel Forest Ring: design and build spec

Owner: Çevre-3. Status: **built and registered** (2026-10-26). Template: `tracks-alpine.md`; only what differs is written here.
Built L 20,450 m (authoring basis 20,453 m), 71 numbered corners, clockwise, elevation 287 m (−264 … +23 m), max grade 12 %.
AI d = 100 lap 270.36 s (band 266.3–274.4 s asserted), server `minLapMs.eifel` 256,800.

## 1. Identity
| | |
|---|---|
| Track id | `eifel`; no raw JSON: the raw track is generated lazily (`data/eifel-raw.ts`, first access) from `authoring/eifel-ctrl.ts` |
| In-game name | TR `EIFEL ORMAN RING` / EN `EIFEL FOREST RING`; `TrackData.name` `Eifel Orman Ring` / `Eifel Forest Ring` |
| IP | Original fictional layout inspired by the character of old 20 km forest rings (narrow road, relentless elevation, a banked bowl, a long straight). No real layout, corner or place names; corners are T-numbers only. |

## 2. Layout (turtle path)
- `SEGS` in `eifel-ctrl.ts`: straights and constant-radius arcs from the S/F (0, 0) heading east; `closeSegs()` closes the loop exactly (arc `fixH` takes the heading error, straights `fixA`/`fixB` the position error, 2 × 2 solve). Sampled at 1 m.
- Every arc ≥ 10° is a numbered corner; `CORNERS` in `eifel.ts` is derived from the arcs (vApex from the radius; GP-loop corners get gravel / painted run-off and impact barriers, ring corners a grass verge and armco close behind; the bowl a concrete wall).
- Sections (segment tags): GP loop with pit straight and a left hairpin (`sf`, T1–T8) → forest esses (`esses`, T9–T15) → the downhill rush (`rush`) with the compression (`dip`) → valley village and stream bridge (`valley`, `village`, `bridge`) → the climb with switchbacks and the banked bowl (`fixB`, `bowl`, T49, R 30, 170°, 14° banking) → blind crests (`crest`) → plateau (`fixH`, `hump`) → the 2.3 km straight with the hump (`fixA`) back to the GP loop.
- Widths: ring hw 4.75 (9.5 m), bowl 5.25, the long straight 5.5, GP loop 7 and pit straight 7.5.

## 3. Elevation
`ELEV_KEYS` (segment tag, metres past its start, y) → linear profile, then the standard build (σ 30 m, vertical-curvature clamp crest R ≥ 700 m / sag R ≥ 400 m). The clamp guarantees that no crest launches a car: in the 12-car race test the mechanical load g + v²κv dips to −0.12 g on the hump at 330 km/h (it goes light) while the total tyre load stays ≥ 1.13 g (downforce); compressions peak at 2.42 g.

## 4. Timing, pit, grid
S2 at the valley entry, S3 at the first blind crest; one DRS zone on the long straight (through the S/F to T1). Pit on the right of the GP pit straight (Alpine values, main-frame `PIT_SD_REL`), 843 m; grid on the straight before the line.

## 5. Scenery (`scenery/eifel.ts`)
Castle on a 120 m knoll inside the valley bend, half-timbered village on both sides of the road with a church, a stone road bridge in the village and one on the climb, four spectator footbridges, km boards every 1,000 m (right side), six camps (tents, vans, fans) in clearings, fans along the fences there, concrete slabs over the bowl, marshal posts every ≈ 450 m (shared trackside change). Forest: spruce/beech within 300 m of the road at 9 m spacing, beyond at 19 m from the DEM (`THEME.treeFar`), meadows by noise.

## 6. Modes
Time Trial first. Races: `RACE_TRACK_INFO.eifel` offers 1–3 laps (default 1) and at most 11 AI opponents (12-car field): the per-tick sim load and the 8-min replay cap stay in budget (a 1-lap race is ≈ 5 min).

## 7. Budgets (High, 1920 × 1080, measured over a full lap at 4× time scale)
Chase: ≤ 147 draws (avg 104), ≤ 0.83 M tris, 49 programs. Cockpit: ≤ 153 draws (avg 115), ≤ 0.86 M tris, 49 programs. Frame time steady (vsync 16.7 ms, p95 ≤ 17 ms).
