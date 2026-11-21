# Desert Cliff Circuit: design and build spec

Owner: Çevre-2. Status: **built and registered** (2026-10-25). Template: `tracks.md` §1 (shared pipeline) and `tracks-alpine.md` (authored procedural track). Only what differs is written here.

## 1. Identity
| | |
|---|---|
| Track id | `cliff`; no raw JSON: the raw track is generated at first use from `src/track/authoring/cliff-ctrl.ts` (`data/cliff-raw.ts`) |
| In-game name | TR `ÇÖL UÇURUMU CIRCUIT` / EN `DESERT CLIFF CIRCUIT` (`TrackData.name`: `Çöl Uçurumu Circuit` / `Desert Cliff Circuit`) |
| Inspiration | Riyadh-region desert cliff inspired: a circuit on top of and along a sheer limestone escarpment, with an elevated first corner. Original fictional layout; no real circuit, corner, place or brand names (T-numbers only). |

## 2. Layout (authored fillet polygon, map metres, world x = E, z = −N)
- **Anti-clockwise**, net heading +360°, **21 corners**, polygon basis **7,233 m** (built 7,233 m). S/F at (0, 0) heading east on the plateau, the escarpment 70 m to the south. Pit and pole on the **left** (inland, `PIT.side +1`).
- Vertices (E, N, r): (1000,0,45) (1100,−180,26) (1350,380,150) (1220,860,60) (1020,880,50) (900,1000,45) (860,1110,45) (450,1180,140) (100,1060,140) (−280,1180,140) (−900,1150,40) (−950,850,70) (−800,650,70) (−950,420,55) (−860,220,45) (−1060,40,35) (−1000,−220,28) (−650,−180,110) (−480,−280,90) (−360,−180,50) (−320,−10,40).

```
   N ↑          T10 ←──── back straight (DRS 3) ──── T9  T8   T7 ─ T6
  1150   T11 ┐                                                  T5 ┐
         T12 ┘ plateau  (+8 m)                                  T4 ┘
         T13 ┐ canyon descent                                      │ T3 (fast downhill left)
         T14 ┘                                                      │ plunge (DRS 2, −14 %)
         T15 ┐            paddock / pit (left)                     │
     0   T16 ┘  T21 ── S/F ── start straight → RAMP (+70 m) ─── T1 ┐
                T20  ← climb out                                  T2 ┘ cantilever over the cliff
  −280   T17 ── T18 ── T19   canyon floor (−38 m)       escarpment / canyon −112 m
```

### Corners (s on the polygon basis)
| T | Dir | Arc s | Turn | R | vApex (AI d100) | Character |
|---|---|---|---|---|---|---|
| 1 | R | 973–1021 | 61° | 45 | 196 | Top of the 70 m ramp, braking uphill, LED-lit |
| 2 | L | 1149–1206 | 127° | 26 | 108 | Hairpin on the cantilevered platform over the escarpment |
| 3 | L | 1714–1817 | 39° | 150 | ≈ 210 | Fast left half-way down the 14 % plunge |
| 4 | L | 2219–2292 | 69° | 60 | 130 | Onto the entertainment boulevard |
| 5–7 | R R L | 2433–2758 | 39/25/60° | 45–50 | 120–150 | Right-right-left complex (cut zones T5/T6) |
| 8–10 | L R L | 3112–3936 | 29/36/20° | 140 | 215–250 | Northern sweepers |
| 11 | L | 4499–4553 | 78° | 40 | 105 | End of the back straight: heavy braking, overtaking |
| 12–16 | L R L R L | 4795–5825 | 46–72° | 35–70 | 100–150 | Snaking descent into the canyon |
| 17 | L | 6046–6087 | 84° | 28 | 145 | Canyon floor at −38 m |
| 18–20 | R L L | 6378–6765 | 37–70° | 50–110 | 150–180 | The climb out of the canyon |
| 21 | R | 6891–6944 | 76° | 40 | 105 | Onto the start straight |

Sequence test: `R L L L R R L L R L L L R L R L L R L L R`, every corner > 15°, built min radius > 20 m.

## 3. Elevation (authored y(s), smooth by construction, build σ 15 m)
`70·ss(250, 960)` up the ramp → +70 m platform (T1, T2) → `70·(1 − ss(1230, 1950))` plunge → plateau 0 → +8 m (north) → `8 − 46·ss(4600, 5900)` canyon descent → −38 m canyon floor (T17) → `−38 + 38·ss(6150, 7000)` climb out. Range **108 m** (−38…+70), max grade **14.8 %** (ramp and plunge).

**Physics:** the smoothsteps cap the vertical curvature at **1/1,324 m** (build clamp 1/400 compression, 1/700 crest never engages): at the T1 crest the car is already braking, at 300 km/h the crest would still only unload ≈ 0.5 g. Measured in the 20-car race: summed wheel load on the ramp 1.1…4.4 g·m (no launch, no bottoming); AI brakes uphill into T1 and downhill into T3 without resets.

## 4. Widths, walls, decks
- hw 7.5 (default), 8.5 on the start straight, 9 on the T1–T2 platform.
- `DECKS` (new optional authoring field): the ramp leg (s 340–930) and the plunge leg (1260–1900) have concrete walls with catch fences at hw + 2.5 and no run-off (`wallD`), the platform (930–1260) keeps corner run-off (asphalt, tecpro). Under every deck the ground height keeps the natural terrain (`height.ts`: `GroundInfo.below`), so there is no embankment.
- Spectator walls: start straight cliff side, both sides of the platform, T11 and T17 outsides.

## 5. Timing, DRS, pit, grid
- Sectors at 2,300 and 4,900; speed trap 850 (on the ramp).
- DRS 1 start straight: detect 6,700, activate 7,000, end 900. DRS 2 plunge: 1,100 / 1,300 / 1,640. DRS 3 back straight: 3,850 / 4,000 / 4,430.
- Pit (left): entry after T20 (s 6,790), round the outside of T21, beside the start straight, exit at s 270 before the ramp starts. Built lane ≈ 720 m (test 650–800 m), 10 garages / 20 cars, limit 150–620 m. Grid 20 slots from s L − 12 m, 8 m spacing, pole on the left.

## 6. AI and server
AI d = 100 laps 99.04 / 98.69 / 98.81 s (top 325 km/h): band 97.2–100.2 s asserted in `calibration.test.ts`; server `minLapMs.cliff` 93,760 (0.95 ×). Good human lap estimate ≈ 1:40–1:41. `aeroTrim −0.2`.

## 7. Ramp structure and lighting (night race look)
- Deck slab with a 3.6 m service walkway beyond each barrier (carries the floodlight poles), 1.6 m deep on the plateau, a 5 m box girder where it overhangs the escarpment (cantilever, no columns there); paired columns every 24 m where the plateau is below.
- **Lighting:** floodlights on both sides every 28 m on the whole lap **including the ramp** (poles stand on the deck edge, `floodlights.ts` uses the deck height on DECKS); continuous LED strips along the deck fascias (cyan, magenta accents), along the catch-fence tops (white, facing the road) and two lines under the deck; brighter at sunset and night. Checked with a night + sunset sweep (cockpit and chase) every 50 m from s 350 to 1,950.

## 8. Scenery
Terrain theme `desert` (shader branch 4: rippled sand, pale compact sand near the track, limestone with strata on steep faces, dark wadi gravel on the canyon floor), procedural escarpment field (`desertField`: plateau with low dunes, ≈ 110 m sheer cliff, canyon floor, far mesas), sparse acacia-like trees (species 0), palms along the paddock and T11, entertainment-city towers (façade program, lit windows at night) in three clusters, a rollercoaster on the plateau east of the plunge, glass grandstands on the cliff side of the start straight, over T11 and at T17. Per-track rig `cliff`: hot hazy day (fog 0xe2cda6), orange sunset, dusty violet night. No new shader programs.

## 9. Tests
`src/track/__tests__/cliff.test.ts` (shared U-TR-01…12 + ramp crest/vertical curvature), `cliff.race.test.ts` (20 cars, 3 laps, one stop each, ramp wheel loads, determinism), `terrain.road.test.ts` (cliff added), calibration row.
