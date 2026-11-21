# Volcano Rim (`volcano`): layout proposal (step 1, awaiting approval)

Name: TR **ECELLE DANS – VOLKAN AĞZI** / EN **DANCE WITH DEATH – VOLCANO RIM**. Alternatives: *KRATER KIYISI / CRATER EDGE*, *ATEŞ ÇEMBERİ / RING OF FIRE*.
Original layout: the most fun and the hardest track; high risk, every danger readable.

## 1. Key figures
≈ **5.5 km**, clockwise, **23 corners**, elevation **≈ 180 m**. Max grade 11 %; crests have a radius of at least 700 m (the build clamp), so cars go light but never take off.
- Pit and start: on the ash plain at the foot of the volcano (pit on the left).
- Longest straight: S/F, 650 m. Rim straight: 480 m. Lava-bridge run: 300 m. Everything else is ≤ 220 m.
- DRS: zone 1 on S/F → T1; zone 2 on the rim straight → T14.
- Estimated AI d100 lap ≈ 1:40, average ≈ 200 km/h. That is quicker than Cappadocia; the difficulty comes from risk, not slowness.

## 2. Sketch (N up)
```
                 .-T11--T12-.            crater (lava lake)
          T10 .-'   ~~~~~~~~ '-. T13
   tunnel ==>|    ~~ LAVA ~~~    |  rim straight (DRS 2)
  T9 (exit)   '-.  ~~~~~~~~  .--'=========> T14 hairpin
        \        '--------'                    |
  bridge \ ~~lava river~~  T15/T16/T17 spiral  |
  T8 crest\                 (@) lava cone  <---'
     T7 /\T6 switchbacks       \ T18
     T5 \/                      \ T19-T22 sweepers down the slope
   T2-T4 /                       \
  T1 <=================================== T23
         S/F (650 m, DRS 1)    pit -> | 
```

## 3. Corners
| T | Type | km/h | Gear | Note |
|---|---|---|---|---|
| 1 | Right, 90° | 110 | 3 | Hard braking off S/F, **pass 1** |
| 2–4 | Climbing sweepers L-R-L | 190–230 | 5–6 | Flank |
| 5 / 6 | Switchback hairpins L / R | 65 / 70 | 2 | Climb, walls close |
| 7 | Fast left | 210 | 6 | Approach to the crest |
| 8 | Blind crest, slight right | 250 | 7 | Onto the **lava-river bridge** (deck 25 m over the lava) |
| 9 | Tight left | 95 | 3 | Off the bridge into the 320 m **tunnel through the crater wall**, **pass 2** |
| 10–13 | Rim corners R-L-R-R | 140–200 | 4–6 | Open edge, ash-slick patches |
| 14 | Hairpin, right | 70 | 2 | End of the rim straight, **pass 3** (main spot) |
| 15–17 | Spiral descent: three linked rights round a lava cone, radius 40 → 32 → 25 m | 120 → 80 | 3–4 | Downhill, the radius keeps tightening |
| 18 | Left, steam vents | 150 | 5 | |
| 19–22 | Fast sweepers down the slope | 230–270 | 6–7 | Flowing, little run-off |
| 23 | Slow right onto S/F | 90 | 3 | Exit sets up the DRS run |

## 4. Elevation (m)
```
200|                 ____rim________
150|            ___/   tunnel       \__ T14
100|        ___/ bridge               \__spiral
 50|   ___/ T5/T6                        \__ sweepers
  0|__/T1                                    \____S/F
   0      1      2      3      4      5   km
```

## 5. Deadly but fair
- **Crater rim (T10–T13), the proposed handling:** looks barrier-less, but there is an invisible wall. Outside the white line: a 3 m ash shoulder (low grip), then a **0.5 m basalt lip**. The lip is a physics wall of a "rock" kind that bleeds speed hard, about −40 % on contact. Beyond it the cliff drops into the lava lake.
  - The fall is visual only: no car ever leaves the map.
  - Optional "fall zones" (2 × 60 m at T11 and T13 only): crossing the lip there triggers the existing reset. The car goes back onto the track at the same point, stationary, after ≈ 4 s of black-and-lava fade, so ≈ 8–10 s lost. The AI is kept away from them with a minimum clearance in its line.
- **Lava edges** elsewhere (bridge, spiral): concrete walls with lava glow behind them, never open lava.
- **Ash-slick zones:** authored `ASH` ranges (like `PUDDLES` / `BUMPS`). The query returns a grip factor of ≈ 0.85 in those zones and they are shown as grey ash drifts. Clean implementation needs a contract change: either a new `'ash'` surface type in `SurfaceType` (μ 0.82), or a dry-grip hint added to `GroundHit`. Fallback with no contract change: map ash to the existing `'line'` surface (μ 0.92) inside the limits.
- **Readability:** braking boards at T1/T9/T14/T15, a red-white kerb at every apex, chevrons before blind T8 and T9, ash zones visibly grey. The AI must finish a 20-car race with 0 resets.

## 6. Graphics plan (volcano only, all gated by track id / THEME)
1. **Lava:** new env mode `Lava` (no extra program).
   - Emissive flow from scrolling noise; a dark crust that cracks and drifts; glowing seams; pulsing brightness.
   - Used for the lake, the river, small pools and the cone.
2. **Lava light:**
   - Baked into the existing floodlight light map in orange: lights the track and the cars' undersides near lava, day and night, at zero cost per frame.
   - Plus 2 dynamic point lights that follow the camera to the nearest lava (bridge, rim).
3. **Heat shimmer:** a screen-space distortion pass driven by a lava mask (lava pixels plus distance). 1 extra post pass, only on this track. Graphics team change request (src/graphics).
4. **Embers and ash:** one instanced GPU particle system (≈ 4 k points, CPU-free animation, 1 draw). Ash drifts near the rim; embers rise over the lava.
5. **Eruptions:** every 40–70 s, a burst from the crater. Lava bombs as particles, a flash in the light map, light camera shake (cosmetic, no effect on the sim).
6. **Volcanic sky:**
   - Ash plume: a 3 km soft cone mesh plus noise.
   - Clouds lit red from below at night; a dimmer, hazier sun by day.
   - Per-track rig.
7. **Materials:**
   - A `volcanic` terrain theme: black basalt, glossy obsidian outcrops, rust-coloured scoria, sulphur streaks.
   - Basalt column cliffs in the tunnel portal and at the spiral.
8. **Steam vents:** about 10 soft sprite columns (in the same particle draw) at T18 and the rim.

**Budgets (High, per view):** the scenery adds ≤ 14 draws, ≤ 250 k triangles and ≤ 2 programs (particles, shimmer). Target ≤ 180 draws, ≤ 1.3 M triangles, ≤ 54 programs.
- Distance culling; particles per preset (Low 1 k, no shimmer; Ultra 8 k).

## 7. Reuse
Turtle path (eifel/cappadocia), `DECKS` (bridge), `TUNNELS` + `tunnel.ts`, close walls, standard calibration/race/suite tests. No `BUMPS` (they caused porpoising on Cappadocia).
