# Aegean Islands Circuit: design and build spec

Owner: Çevre-2. Status: **built and registered** (2026-10-26). Template: `tracks-alpine.md` / `tracks-cliff.md`.

## 1. Identity
id `aegean`; TR `EGE ADALAR CIRCUIT` / EN `AEGEAN ISLANDS CIRCUIT`. Original fictional layout and islands; no real
places, circuits or brands (T-numbers only). Raw track generated at first use (`data/aegean-raw.ts`, lazy).

## 2. Layout
Clockwise, **6,089 m**, **16 corners** (`R L R R L R L R R R L R R L R R`), sea level y −4 m (S/F on the main island).
About **54 %** of the lap is over the sea (5 spans, all bridge decks with concrete walls + catch fences):

| s (polygon) | Section |
|---|---|
| 0–250 | Start straight on the main island (pit right, grandstands sea side) |
| 251–649 | Low causeway to the windmill island (DRS 1 ends before T1) |
| 677–1298 | T1 heavy stop, T2–T3 flowing up the windmill island |
| 1331–1905 | **Cable-stayed bridge** (two H pylons 62 m above the deck, fans of stays, crest +19 m) — DRS 2 |
| 1868–2599 | T4 onto islet C, **fast esses** T5–T8 across the gap (T6 on a short bridge) to islet D |
| 2561–3507 | **Floating pontoon** 2.2 m above the sea along a rubble breakwater, T9 flat-out sweep |
| 3475–3999 | Headland island: T10–T11, **tunnel** (3775–3895), T12 hairpin (main braking/overtaking) |
| 4037–5257 | **Long sweeping bridge** (T13 r 810 m) back to the main island — DRS 3 |
| 5260–5673 | **Harbour**: T14–T16 past the mole and lighthouse onto the start straight |

Elevation −1.8…+18 m, max grade 5.8 %. Sectors 1,986 / 3,984; DRS (detect/activate/end) 5520/5720/600,
1240/1350/1820, 4010/4090/5180. Pit on the main island: entry 90 m after T16, exit at s 225, 10 garages / 20 cars.

## 3. AI and server
AI d = 100: 79.37 / 78.71 / 78.88 s (top 324 km/h, T12 apex 134 km/h); band 77.5–79.9 s asserted; server
`minLapMs.aegean` 74,770. Good human lap ≈ 1:20. aeroTrim 0.

## 4. Scenery (`scenery/aegean.ts`, shared `scenery/tunnel.ts`)
Sea grid with vertex colours (deep Aegean blue → shallow turquoise from the sea-floor depth, coast foam), foam rings at
piers, foam lines along the breakwater and the mole, a 40 km open-sea skirt; white bridge decks with walkways (floodlight
poles stand on them), warm LED edge lines, paired piers; pontoon floats; rubble breakwater; tunnel bore + headland rock;
harbour mole, lighthouse (lit), moored yachts; ferries, sailing yachts and speedboats moving; seagulls; villages of white
cubic houses (façade program, windows lit at night), blue domes, bougainvillea; four windmills; olive / cypress / pine
scatter (never in the water). Terrain theme `island` (straw and scrub, white limestone on slopes, sand coves, wet sand);
rig `aegean` (clear day, warm sunset over the sea, clear night). No new shader programs.

## 5. Tests
`aegean.test.ts` (U-TR-01…12 + bridges: decks 1.5–30 m above the sea, walls ≤ hw + 3, pontoon < 3 m above the sea),
`aegean.race.test.ts` (20 cars, 3 laps, one stop each, determinism), terrain-under-road, calibration row.

## 6. Polish pass (2026-10-27)
Bridges: 0.5 m parapets + slim railing instead of catch fences (`THEME.bridgeRailing`; physics walls unchanged), so the
sea stays in view from chase and cockpit. Seaside palette: blue / white kerbs and painted run-off. Roadside life: white
houses with blue doors / shutters and bougainvillea beside the road, olive groves, bunting, umbrellas and bathers on the
coves, more boards, grandstands at T1 and the harbour. Harbour: quay wall and promenade, cafés with awnings, quay lamps,
flags, fishing boats, quay houses, yachts moored off the quay. Cliffs: ochre limestone strata with scrub on the ledges
(island terrain + tunnel rock). Night: the sea takes almost no floodlight pool (flood 0.08). Surface chunks 400 m.
