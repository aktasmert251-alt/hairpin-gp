# APEX GP — DESIGN.md

> **The single visual source of truth** for the HUD, menus, motion language, 3D art direction and trailer cards.
> Status: **v1.0 (Sprint 0)** · Owner: Grafik Dizaynlayıcı · Binding for `src/ui/**`, `src/graphics/**`, `src/trailer/**`.
> Companions: `design-contract.md` (evidence, keep/change/do-not-copy, risks, gates) · `implementation-handoff.md` (build notes) · `example.html` (preview).
> Evidence tags: **[P]** provided (brief, PLAN.md, planner-report, `src/contracts`) · **[O]** observed in this session (font binaries, contrast maths, cited web text) · **[I]** inferred design decision or recalled genre knowledge.
> All pixel values are **1080p values at `hud.scale = 1`**. They scale as described in §4.

**Direction in one line: "Pit-wall broadcast".** Graphite panels, white condensed type and tabular timing. Colour appears only when it means something. One vermilion brand signal lives outside the race HUD, and every diagonal is cut at 12°.

---

## 1. Visual Theme & Atmosphere

### 1.1 Stance [I]
APEX GP should look like a live race broadcast seen from the pit wall: a sober, engineered, information-first overlay on top of a rich, sunlit 3D world. The scene supplies the colour and the drama. The interface supplies clarity. The overlay is **dark, flat, sharp and quiet** until a race event needs attention; then a single semantic colour speaks (purple best, green improvement, yellow slower, red penalty, blue flag).

| Keep (from the reference) [P] | How APEX GP expresses it [I] |
|---|---|
| Broadcast-graphics clarity | Flat graphite panels, white type, no decoration, one idea per element |
| Dense but readable timing | Barlow Condensed with verified tabular figures; 30 px tower rows; fixed-width number slots |
| Functional team colour | A 4 px team strip per tower row, team bars on tiles. Team colour never fills a large area |
| Condensed uppercase rhythm | Labels are uppercase Barlow Condensed with positive tracking; data has no tracking |
| Dark translucent panels, sharp angles | `rgba(9,11,14,.88)` panels with 0 radius; short elements get 12° slanted ends |
| Purple / green / yellow sectors | Kept 1:1 as timing semantics, never reused for decoration |

### 1.2 Signature devices (what makes it APEX GP, not a clone) [I]
1. **The 12° slant.** Every diagonal in the system is 12° off vertical (`tan 12° = 0.2126`). It appears on banner ends, chips, the CTA, shift-LED segments, the focus notch, the GP block of the wordmark and trailer wipes. Tall panels never slant; they stay plain rectangles.
2. **The apex notch.** Focus is always a vermilion 12° parallelogram on the leading edge of the focused element. The same shape is the crossbar of the Λ in the wordmark: the brand *is* the focus indicator.
3. **Colour means something.** In the race HUD, colour only ever encodes state. The brand vermilion never appears in the race HUD.
4. **The white row.** "You" is always a white (`--apx-fg`) row with ink text: the player row in the tower and the focused row in navigation lists.

### 1.3 Mood words
Use: *engineered, clipped, nocturnal-graphite, broadcast, precise, fast, warm-lit world / cool UI.*
Never: *neon, holographic, glassy, bubbly, sci-fi, cyberpunk, glitch, playful.*

### 1.4 3D Art Direction

#### 1.4.1 Time of day and weather grading
Targets for ÇEV's `LightingRig` and GRA's LUTs. The UI is identical in every condition. Only the world changes. [P] Ek B sets the sun angles, cloud and fog behaviour; the colour targets are [I].

| | **Day** (`lut: day`) | **Sunset** (`lut: sunset`) | **Night** (`lut: night`) | **Rain** (overlay, `lut: overcast`) |
|---|---|---|---|---|
| Mood | late-summer afternoon: dry golden grass, bright asphalt, high clarity | golden-hour drama: long shadows, hot rims on the cars | floodlit spectacle: pools of white light, black sky, glossy paint | spray, reflections, grey density, red rain lights |
| Key light | sun ≈ 55°, `#FFF4E5` (~5800 K) | sun ≈ 6°, `#FFB36B` (~3000 K) | floodlight key, cool white `#E8F0FF` (~6000 K); moon fill `#A8C4FF` | sun × 0.25, cloud cover 1 |
| Sky | zenith `#7FB4E2` → horizon `#D8E6F1` | zenith `#2B3F6B` → `#E58A6A` → horizon `#FFA04D` | zenith `#05070D`, stars, sodium horizon glow `#3A2A1A` | flat overcast `#8E959D` → `#B7BDC3` |
| Grade (LUT) | neutral; saturation +4%; shadows lifted toward `#1C232C`; highlights warm | warm highlights, shadows desaturated **blue-grey** (not purple); saturation +8% | high contrast; cool mids; warm accents only near the horizon | saturation −20%; cool shift; contrast −10%; blacks lifted |
| Exposure (AgX) | 1.00 | 1.15 | 0.90 | 0.85 |
| Bloom | threshold 0.95, intensity 0.25 (specular only) | threshold 0.85, intensity 0.60 | threshold 0.90, intensity 0.80 (lamps, brake discs, rain lights) | threshold 0.90, intensity 0.50; vertical light streaks [P] §7.13 |
| Fog | thin warm haze, density low | warm haze, horizon only | thin cool haze | dense, `#9AA1A8` |
| Shadows | crisp, short | long, warm-tinted | soft, from the floodlight key | soft or none |
| Paint read | clearcoat shows sky gradient | rim highlights on sidepods | floodlight panels reflected in paint [P] §7.12 | wet sheen; spray hides the floor |

Rules:
- Grading never pushes the scene toward purple or blue glows.
- Floodlights are white, not cyan.
- Sodium warmth stays at the horizon.

#### 1.4.2 Livery design language [I]
1. **Zones:**
   - nose and front-wing mainplane
   - chassis spine (cockpit surround)
   - sidepods (the main canvas)
   - engine cover and fin (number and team mark)
   - rear-wing endplates (title sponsor)
   - floor edge and halo (carbon or accent)
2. **Coverage:**
   - Primary ≥ 50% of the painted area.
   - Secondary 20–40%, as large swept shapes.
   - Accent ≤ 10%: pinstripes, numbers, endplate edges.
3. **Exposed carbon** (2025-style weight saving) on the floor, diffuser, undercut, wing undersides, bargeboards and mirror stalks. It is identical on every team, so the liveries read as one series.
4. **Graphic flow:**
   - Shapes follow the airflow.
   - Sweeps rise rearward at 12° from the sidepod inlet toward the fin.
   - Splits are hard edges: no gradients, no camouflage, no noise patterns.
   - At most one signature motif per livery.
5. **Numbers:**
   - Barlow Condensed 800, on the nose top, the fin and the front-wing endplate.
   - Colour is white or ink, whichever gives ≥ 4.5:1 against the local body colour.
6. **T-cam:** driver 1 black, driver 2 yellow [P] `DriverDef.tcam`.
7. **Distance test:**
   - At LOD1 (≤ 120 m), each car must read as its dominant body colour.
   - No two teams share a dominant body colour (see the table: black, gunmetal and yellow are deliberately distinct).
8. **Wordmarks on cars** use only our two font families, so the world stays typographically coherent.

| Team [P] | Body (primary) | Secondary | Accent | **HUD strip (`ui`)** | Finish [P] | Signature motif [I] | Title sponsor [I] |
|---|---|---|---|---|---|---|---|
| Anka Racing (TR) | crimson `#C8102E` | white `#F4F4F2` | gold `#D4A72C` | `#E8213F` | gloss | three stacked gold feather-chevrons on the sidepod | Lale Çay |
| Aurora GP | ice white `#E8EEF4` | electric blue `#1E90FF` | ice blue `#9FD4FF` | `#2AA4FF` | gloss | blue aurora sweep from floor to fin | Kuzey Air |
| Vortex Motorsport | matte black `#121314` | neon green `#39F26A` | white `#F2F4F7` | `#3DF06A` | matte | one neon rim line wrapping the sidepod | Pulsar Tech |
| Solaris Racing | orange `#FF6A13` | deep purple `#3B1A6B` | white `#F2F4F7` | `#FF7A1A` | metallic | hard 12° orange/purple split ("flare") | Halcyon Energy |
| Kestrel Racing | navy `#13235B` | gold `#C9A227` | white `#F2F4F7` | `#6478F0` (lifted navy) | gloss | gold wing-stripe along the spine | Nexa Watches |
| Meridian Racing | teal `#0E8C82` | silver `#B9C0C7` | white `#F2F4F7` | `#14B8A6` | metallic | single silver meridian line nose to tail | Mavi Rota Lojistik |
| Titan Dynamics | gunmetal `#3A4048` | red `#D7262B` | silver `#B9C0C7` | `#9AA4AE` (steel) | matte | red blocks on nose tip and endplates | Vela Fuel |
| Zephyr Racing | sky blue `#6EC6F0` | pink `#FF5FA8` | white `#F2F4F7` | `#FF6FB5` | gloss | pink wind-stripes on the engine cover | Simit Express |
| Ironclad Racing | yellow `#FFD21A` | black `#111214` | white `#F2F4F7` | `#FFE01A` | gloss | black hard-edged plate blocks | Kervan Bank |
| Nova Corsa | white `#F4F5F7` | blue `#1F4FBF` | red `#D7262B` | `#F2F4F7` | gloss | twin blue/red heritage stripes nose to tail | none (heritage livery) |

The HUD strip colour is tuned for legibility on graphite panels. It is the colour the presenter passes as `TowerRow.teamColor` and `minimap.teamColor`. See the change request in `design-contract.md` §7.

#### 1.4.3 Trackside branding [P] sponsor names · [I] treatment
- **Style:**
  - Flat, matte boards (`roughness 0.7`, no specular glare).
  - High-contrast two-colour wordmarks drawn on canvas with our fonts plus simple geometric marks. No photographic logos, no gradients.
- **Formats:**
  - Perimeter boards 6 × 1 m.
  - Braking-zone boards 4 × 2 m.
  - Overhead gantry banners 24 × 2 m (s ≈ 1,600 and 4,400 [P] §7.9).
  - Distance boards 150/100/50: white Barlow Condensed 800 digits on black.
- **Rhythm:**
  - Boards repeat in A-B-A triplets along a straight.
  - At most 3 sponsors per straight, and never more than 2 identical boards adjacent.
  - Run-off asphalt carries a painted APEX GP wordmark (white + vermilion) at T1 and T12.
- **Night:** boards are lit by the floodlight lightmap (emissive ≤ 0.15). They never glow on their own.
- **Display strings are pre-composed in their final case**: never upper-case them at runtime with the wrong locale (see §3.6).

| Sponsor [P] | Board colours [I] | Display string | Mark (geometry only) | Type treatment |
|---|---|---|---|---|
| Kuzey Air | navy `#0E2A47` / white / sky `#6EC1FF` | `KUZEY AIR` (EN casing for "Air") | north chevron, 12° | Condensed 700, +0.08em |
| Vela Fuel | black `#101214` / amber `#FFB000` | `VELA FUEL` | sail triangle | Condensed 800, skewed 12° |
| Halcyon Energy | deep green `#0B3D2E` / mint `#7CE0B5` | `HALCYON ENERGY` | two concentric half-arcs | Condensed 600, +0.10em |
| Pulsar Tech | white `#F5F6F8` / ink `#0A0C0F` / blue `#2F6BFF` | `PULSAR TECH` | single pulse line | Barlow 600, sentence-case variant `Pulsar Tech` allowed |
| Lale Çay | tulip red `#B3122E` / cream `#F4E9D0` | `LALE ÇAY` | tulip from three lancet shapes | Barlow 600 |
| Kervan Bank | burgundy `#4A1029` / gold `#D8B45A` | `KERVAN BANK` | caravanserai arch | Condensed 700, +0.06em |
| Mavi Rota Lojistik | blue `#0057B8` / white | `MAVİ ROTA` + small `LOJİSTİK` (TR casing, dotted İ) | route arrow | Condensed 800 |
| Nexa Watches | black `#0A0A0A` / silver `#C9CDD2` | `NEXA` | thin ring with one 12° hand | Condensed 500, +0.24em |
| Simit Express | sesame `#E8A33D` / brown `#5B3A1E` | `SİMİT EXPRESS` (TR casing for "Simit") | ring with sesame dots | Condensed 800, skewed 12° |
| APEX GP (series) | ink `#0A0C0F` / vermilion `#FF4B1F` / white | `APEX GP` wordmark (§8.1) | Λ + apex marker | wordmark only |
| Ak Lastik (tyre dealer, cars only) | black `#121212` / white / yellow `#FFC400` | `AK LASTİK` (TR casing) | notched tyre ring | Condensed 800, slanted 20°, stencil bridge + yellow underline |
| Ayro Oil (lubricant, cars only) | teal `#0A4D5C` / white / orange `#FF8A1F` | `AYRO OIL` | droplet | Condensed 800, orange drop shadow |
| Tevenin (consumer tech, cars only) | white `#F5F6F8` / indigo `#3A2E9C` | `TEVENİN` | dot in ring | Barlow 400, +0.34em |
| Göksu Havacılık (aviation, cars only) | blue `#1C6FB8` / white / ice `#BFE3FF` | `GÖKSU` + small `HAVACILIK` | three-part wing | Condensed 600, two-line |
| Lazerta (laser tech, cars only) | black `#0B0D10` / laser green `#4DFF7A` | `LAZERTA` | beam with diamond | Condensed 700, +0.18em, stencil |
| Voltara Enerji (energy, cars only) | yellow `#FFD400` / ink `#111111` | `VOLTARA` + small `ENERJİ` | lightning bolt | Condensed 800, slanted 8°, two-line |
| Korvis (telecom, cars only) | purple `#5B2A86` / white / lilac `#E6C8FF` | `KORVİS` | diamond in diamond | Barlow 600, outlined letters |
| Nevra Spor (sportswear, cars only) | coral `#FF5A4E` / white | `NEVRA SPOR` | three speed lines | Condensed 800, slanted 18° |
| Tarven Lojistik (logistics, cars only) | navy `#1B2A4A` / amber `#FFB547` | `TARVEN` + small `LOJİSTİK` | crate with arrow | Condensed 700, inline, two-line |

Car wordmarks (src/graphics/car/sponsors.ts) give every brand its own treatment (family / weight / tracking / slant / outline, inline, stencil, shadow or two-line set) plus an original geometric emblem. Each team carries a unique sponsor set (title + 2–3 secondary); a sponsor appears on at most two teams and is title sponsor on at most one. The nine "cars only" brands are not yet on the trackside boards (src/track/scenery/trackside.ts keeps its own list).

The tyre brand on sidewalls is `ORBIS`: white Condensed 700 letters plus a compound stripe in the tyre colour [P] Ek B.

#### 1.4.4 Paint finishes (three.js `MeshPhysicalMaterial`) [P] three finishes · [I] values

| Finish | metalness | roughness | clearcoat | clearcoatRoughness | envMapIntensity | Notes |
|---|---|---|---|---|---|---|
| **gloss** | 0.00 | 0.35 | 1.00 | 0.03 | 1.00 | crisp sky and floodlight reflections; the default |
| **matte** | 0.00 | 0.62 | 0.00 | — | 0.60 | `sheen 0.15` for a satin edge; never mirror-like |
| **metallic** | 0.65 | 0.30 | 1.00 | 0.05 | 1.10 | base colour 10% darker than the swatch; procedural flake normal on High/Ultra |
| carbon (all cars) | 0.00 | 0.32 | 0.85 | 0.06 | 0.90 | 2×2 twill normal; albedo `#121417` / `#1B1E22` |
| tyre rubber | 0.00 | 0.85 | 0.00 | — | 0.40 | sidewall text white; compound stripe S `#E8202A` M `#F2C200` H `#EDEFF2` I `#2DB55A` W `#2F6FE8` |

Decals (numbers and sponsors) are printed into the livery atlas *under* the clearcoat, never as floating planes.

#### 1.4.5 Showroom (main-menu backdrop) [I]
- **Stage:** the car sits on a dark matte turntable on dark glossy concrete, against an `#0A0C0F` → `#12161C` backdrop.
- **Camera:** 3/4 front, eye height 1.1 m, FOV 32° (long lens, no distortion). The car is centred at x ≈ 62% of the screen, so the left 40% stays free for menus.
- **Lights:**
  - key softbox front-left, neutral 5600 K
  - rim right, cool 7000 K
  - overhead strip light, which draws the long sidepod highlight
- **Turntable:** rotates at 6°/s. It is static at a 3/4 front pose under reduced motion.

---

## 2. Color

### 2.1 Rules
1. **Colour = meaning.** In the race HUD, every chromatic pixel encodes state, team or semantic class. Neutral graphite and white carry everything else.
2. **Text on any filled chip, bar or row is ink `#0A0C0F`, never white.** Every fill below was chosen so ink-on-fill is ≥ 4.5:1 [O].
3. **Never colour alone.** Every coloured state also has text, a letter, a sign or a shape:
   - sectors carry times
   - tyres carry the S/M/H/I/W letter
   - the delta carries its +/− sign
   - DRS carries its word
   - flags carry an icon and a word
4. **Brand vermilion is for brand moments and menus only:** the wordmark, focus notch, primary CTA, loading bar and trailer. It never appears in the race HUD, so it can never be mistaken for a state.
5. **A yellow flag is not a yellow sector.**
   - Timing sector bars show only timing semantics.
   - Flags show on the minimap, as a banner icon and as a word.
6. **No hue-shifting gradients anywhere in the UI.** The only gradients allowed are single-hue ink scrims for legibility over 3D (menus, title, trailer).
7. **Red is reserved for alarm:** penalty, slower delta, invalid lap, and the soft tyre in tyre context. Never use red for "highlight" or "selected". The reference broadcast's red P1 highlight was read by viewers as a red flag [O] (si.com, 2025).

### 2.2 Tokens (`src/ui/styles/tokens.css`)

```css
:root {
  /* Neutrals: graphite with a faint blue undertone */
  --apx-ink-950: #050608;   /* letterbox, lights housing */
  --apx-ink-900: #0A0C0F;   /* app background; ink text on fills */
  --apx-ink-850: #0F1216;   /* solid panel */
  --apx-ink-800: #151920;   /* raised: tiles, table header */
  --apx-ink-700: #1E242C;   /* hover-raised, control tracks */
  --apx-ink-600: #2A313B;
  --apx-ink-500: #3A4350;
  --apx-fg: #F2F4F7;        /* primary text, white row */
  --apx-fg-2: #B4BCC7;      /* secondary text */
  --apx-fg-3: #949EAB;      /* labels, units, tertiary */
  --apx-fg-disabled: #5E6773;
  --apx-line: rgba(242, 244, 247, 0.12);
  --apx-line-strong: rgba(242, 244, 247, 0.28);
  --apx-on-fill: #0A0C0F;   /* text on every fill */

  /* Surfaces */
  --apx-panel: rgba(9, 11, 14, 0.88);        /* every text-bearing HUD panel */
  --apx-panel-weak: rgba(9, 11, 14, 0.64);   /* menus only: decorative backplates over the dark showroom; never in the HUD */
  --apx-panel-raised: rgba(30, 36, 44, 0.92);/* menu tiles, focused setting row base */
  --apx-scrim: rgba(5, 6, 8, 0.72);          /* pause dim over the game */
  --apx-row-hi: rgba(242, 244, 247, 0.10);   /* focused setting row, player row in tables */

  /* Brand (menus and brand moments only) */
  --apx-brand: #FF4B1F;        /* "Apex vermilion" */
  --apx-brand-press: #E03A12;

  /* Semantic hues: each works as a fill (ink text) AND as text on panels */
  --apx-purple: #B470FF;   /* overall best: purple sector, fastest lap */
  --apx-green:  #2ED16B;   /* personal best, faster delta, DRS, inter, good */
  --apx-yellow: #FFD019;   /* slower sector, yellow flag, medium tyre */
  --apx-red:    #FF5C5C;   /* penalty, slower delta, invalid, soft tyre */
  --apx-blue:   #5C8FFF;   /* blue flag, wet tyre, pit limiter */
  --apx-amber:  #FFB21A;   /* ERS, warnings */

  /* Aliases (use these in components) */
  --apx-sector-purple: var(--apx-purple);
  --apx-sector-green:  var(--apx-green);
  --apx-sector-yellow: var(--apx-yellow);
  --apx-sector-none:   rgba(242, 244, 247, 0.18);
  --apx-tyre-soft:   var(--apx-red);
  --apx-tyre-medium: var(--apx-yellow);
  --apx-tyre-hard:   var(--apx-fg);
  --apx-tyre-inter:  var(--apx-green);
  --apx-tyre-wet:    var(--apx-blue);
  --apx-flag-green:  var(--apx-green);
  --apx-flag-yellow: var(--apx-yellow);
  --apx-flag-blue:   var(--apx-blue);
  --apx-delta-faster: var(--apx-green);
  --apx-delta-slower: var(--apx-red);
  --apx-level-info:    var(--apx-fg);
  --apx-level-good:    var(--apx-green);
  --apx-level-warn:    var(--apx-amber);
  --apx-level-penalty: var(--apx-red);
  --apx-drs: var(--apx-green);
  --apx-ers: var(--apx-amber);
  --apx-ers-none: var(--apx-fg-3);
  --apx-pit-limiter: var(--apx-blue);
  --apx-temp-cold: #5AA9FF;
  --apx-temp-ok:   var(--apx-green);
  --apx-temp-hot:  #FF7A45;

  /* Shift LEDs (emissive look, separate from semantics) */
  --apx-led-green: #22D36B;
  --apx-led-red:   #FF2D2D;
  --apx-led-blue:  #3D7BFF;
  --apx-led-off:   rgba(242, 244, 247, 0.10);
  --apx-lamp-on:   #FF2D2D;   /* start lights */
  --apx-lamp-off:  #2B1012;

  /* Team strips (HUD `ui` colour, see §1.4.2) */
  --apx-team-anka: #E8213F;     --apx-team-aurora: #2AA4FF;   --apx-team-vortex: #3DF06A;
  --apx-team-solaris: #FF7A1A;  --apx-team-kestrel: #6478F0;  --apx-team-meridian: #14B8A6;
  --apx-team-titan: #9AA4AE;    --apx-team-zephyr: #FF6FB5;   --apx-team-ironclad: #FFE01A;
  --apx-team-nova: #F2F4F7;
}
```

### 2.3 Semantic map

| Domain | State → token |
|---|---|
| Sector bar [P] [O] | purple = overall best · green = personal best · yellow = slower than personal best · none = `--apx-sector-none` · in progress = 1 px `--apx-fg` outline |
| Tyres [P] | S `red` · M `yellow` · H `fg` (white) · I `green` · W `blue`: a ring plus the letter, always together |
| Flags [P] | green / yellow / blue as fills with an icon · chequered = ink/white 2×2 pattern · black-and-white = diagonal ink/white split (track-limits warning) |
| Penalties | `red` chip "+5 SN" (ink text) · track-limit warnings 1/3 and 2/3 = `amber`, 3/3 = black-and-white flag icon |
| DRS | off = hidden · unavailable = `fg-3` text, `line-strong` outline · available = `green` text, 2 px `green` outline · open = `green` fill, ink text · disabled = `fg-3` text with a 2 px diagonal strike |
| ERS | bar `amber` (mode `none` → `fg-3`) · mode chip outline `amber` · overtake = `amber` fill, ink text |
| Delta | negative (faster) `green` · positive (slower) `red` · null = hidden |
| Notifications | stripe and icon colour: info `fg` · good `green` · warn `amber` · penalty `red`. Event overrides: fastest lap `purple`; flags use the flag colour |
| Tyre temps | cold `#5AA9FF` · ok `green` · hot `#FF7A45` (always paired with the °C number) |
| Shift LEDs [O] | 1–5 green · 6–10 red · 11–15 blue · `shiftNow` = all 15 blue · rev `limiter` = all 15 red · pit limiter = halves alternate blue/amber at 2 Hz |

### 2.4 Verified contrast [O] (WCAG 2.x; worst case = panel `.88` composited over a pure-white sky = `#27282B`)

| Token | On panel over black sky | On panel over **white sky** | Ink on fill |
|---|---|---|---|
| `fg` | 18.0 | 13.4 | 17.8 |
| `fg-2` | 10.4 | 7.7 | — |
| `fg-3` | 7.3 | 5.4 | — |
| `purple` | 6.3 | 4.7 | 6.3 |
| `green` | 9.9 | 7.3 | 9.7 |
| `yellow` | 13.5 | 10.0 | 13.3 |
| `red` | 6.6 | 4.9 | 6.5 |
| `blue` | 6.5 | 4.8 | 6.4 |
| `amber` | 11.0 | 8.2 | 10.9 |
| `brand` (menus, on `ink-900`) | 5.9 | n/a (never on HUD) | 5.9 |
| `fg-disabled` | 3.4 | (disabled text is exempt) | — |

Team strips: every value is ≥ 3:1 even over white sky. Anka is the lowest at 3.3. The closest chromatic pair is Anka/Zephyr at 20° hue apart, and their luminance ratio of 0.52 separates them. Panel opacity below `.88` is **not allowed** for text-bearing HUD panels: at `.84`, `fg-3` falls to 4.29.

---

## 3. Typography

### 3.1 Families [O] (verified from the shipped woff2 binaries)

| Role | Family | Weights shipped | Why |
|---|---|---|---|
| Display, labels, all HUD data, menus | **Barlow Condensed** | 500, 600, 700, 800 | condensed uppercase rhythm; signage DNA (road signs and plates), unlike the reference's wide brand face; `tnum`, `kern` and `locl` present |
| Running text (descriptions, tips, credits, sentence-case names in tables) | **Barlow** | 400, 600 | same skeleton at normal width, so it pairs perfectly |

- **Licence:** SIL OFL 1.1, © 2017 The Barlow Project Authors.
- **Source:** google/fonts via fontsource v5.3.0 (jsDelivr).
- **Files:** `public/assets/gra/fonts/{barlow-condensed,barlow}-{latin,latin-ext}-{weight}-normal.woff2` with `OFL.txt` beside them.
- **Payload:** ≈ 221 KB for 12 files.
- **Coverage verification [O]:**
  - All of `İ ı Ş ş Ğ ğ Ç ç Ö ö Ü ü Â â Î î Û û` are present in every shipped weight (latin + latin-ext together).
  - `₺ ° · × ± – — … ‹ › « » −` are present.
  - **`← ↑ → ↓ ▲ ▼` are missing**, so arrows and chevrons are always inline SVG. U+2007 (figure space) is missing too.
- **Tabular verification [O]:** with `tnum` every digit has one advance. Condensed: 500 = 0.457 em, 600 = 0.475, 700 = 0.498, 800 = 0.520. Barlow: 400 = 0.527, 600 = 0.538. Default figures are **proportional**, so `tnum` is mandatory on every number. U+2212 `−` has the same advance as `+`.
- **Rejected [O]:**
  - Saira Condensed: no `tnum`.
  - Sofia Sans Condensed: passes but has no `₺`; it is the documented runner-up.
  - Russo One / Chakra Petch (the ui-ux-pro-max "gaming" pick): sci-fi trope.

```css
/* One @font-face per weight × subset. Subset ranges come from fontsource. Example for 700: */
@font-face { font-family: 'Barlow Condensed'; font-style: normal; font-weight: 700; font-display: block;
  src: url('/assets/gra/fonts/barlow-condensed-latin-700-normal.woff2') format('woff2');
  unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD; }
@font-face { font-family: 'Barlow Condensed'; font-style: normal; font-weight: 700; font-display: block;
  src: url('/assets/gra/fonts/barlow-condensed-latin-ext-700-normal.woff2') format('woff2');
  unicode-range: U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF; }

:root {
  --font-cond: 'Barlow Condensed', 'Arial Narrow', 'Roboto Condensed', sans-serif;
  --font-text: 'Barlow', 'Segoe UI', system-ui, sans-serif;
}
.num, [data-num] { font-variant-numeric: tabular-nums; font-feature-settings: 'tnum' 1; }
```

**Loading:**
- `AssetLoader` awaits `document.fonts.load('700 16px "Barlow Condensed"', 'İŞĞÇÖÜışğçöü0123')`, and the same for 500, 600 and 800 and for Barlow 400/600, before the first UI paint. That forces both subsets.
- `font-display: block` plus that await means a fallback face never shows in the HUD.
- Preload the latin and latin-ext files for Condensed 600 and 700.

### 3.2 HUD scale (1080p, `hud.scale = 1`)

| Token | Size / line | Weight | Tracking | Case | Use |
|---|---|---|---|---|---|
| `hud-micro` | 13 / 1.0 | 600 | +0.08em | UPPER | units (KM/SA), S1/S2/S3, column heads, `ÖRNEK VERİ` |
| `hud-label` | 15 / 1.0 | 600 | +0.06em | UPPER | TUR, SON TUR, EN İYİ, chips (DRS, ORTA, PİT) |
| `hud-data-s` | 17 / 1.0 | 600 | 0 | tnum | tower gaps, sector times, wear %, temps |
| `hud-data` | 19 / 1.0 | 700 | 0 (codes +0.04em) | tnum / UPPER | tower position and code, last and best lap values |
| `hud-banner` | 22 / 1.0 | 700 | +0.04em | UPPER | notification title |
| `hud-lap` | 34 / 1.0 | 700 | 0 | tnum | current lap time |
| `hud-pos` | 40 / 1.0 | 800 | 0 | UPPER | P4 |
| `hud-speed` | 46 / 1.0 | 700 | 0 | tnum | speed |
| `hud-gear` | 116 / 0.9 | 800 | 0 | — | gear digit, N, R |

Minimum HUD text is 13 px. The one exception is the 11 px letter inside the 18 px tower tyre ring.

### 3.3 Menu scale (1080p)

| Token | Family | Size / line | Weight | Tracking | Case | Use |
|---|---|---|---|---|---|---|
| `display` | Condensed | 96 / 0.92 | 800 | −0.01em | UPPER | screen title (ZAMANA KARŞI) |
| `h1` | Condensed | 56 / 0.95 | 800 | 0 | UPPER | results title, section hero |
| `h2` | Condensed | 32 / 1.0 | 700 | +0.02em | UPPER | panel titles |
| `item` | Condensed | 30 / 1.0 | 700 | +0.02em | UPPER | navigation list rows |
| `control` | Condensed | 20 / 1.0 | 600 | +0.04em | UPPER | setting labels and values |
| `table` | Condensed | 20 / 1.0 | 600 | 0 | tnum | results cells |
| `meta` | Condensed | 14 / 1.2 | 600 | +0.10em | UPPER | eyebrows, key hints, table heads |
| `body` | Barlow | 19 / 1.45 | 400 | 0 | Sentence | descriptions, tips (max 60ch) |
| `body-strong` | Barlow | 19 / 1.45 | 600 | 0 | Sentence | emphasis inside body |
| `card-title` (trailer) | Condensed | 144 / 0.9 | 800 | −0.01em | UPPER | title and end cards |
| `card-sub` (trailer) | Condensed | 36 / 1.1 | 600 | +0.12em | UPPER | card subtitles |

### 3.4 Numbers [P] [I]
- **Lap times** are always `m:ss.mmm` [P] §3.10 (`1:25.612`; under a minute it is still `0:58.204`).
- **Sector times** are `ss.mmm`, or `m:ss.mmm` when ≥ 60 s.
- **Gaps:** `+s.mmm`; at ≥ 60 s, `+m:ss.mmm`. Lapped cars show `+1 TUR` / `+1 LAP`. The leader row shows `LİDER` / `LEADER`.
- **Delta:** always signed, 3 decimals. Use **U+2212 `−`**, never the hyphen, so `+0.214` and `−0.214` have the same width.
- **Timing values use a dot in both languages** (broadcast convention [I]).
- **Other decimals follow the locale:**
  - TR: `%57,5`, `5,349 km`, `24°C`
  - EN: `57.5%`, `5.349 km`, `24°C`
  - The Turkish percent sign comes **before** the number.
- **Position:** `P4` in both languages.
- **Speed:** an integer with unit `KM/SA` (TR) / `KM/H` (EN) / `MPH`.
- **Penalty:** `+5 SN` / `+5 SEC`.
- **Number boxes have fixed widths** (in `ch` of the tabular face), so changing values never reflow.
- **Formatting** lives in `src/ui/format.ts` [P]. The presenter passes raw ms.

### 3.5 Tracking and setting rules
- Uppercase labels get +0.04 to +0.10em tracking. Numbers get 0. Display sizes ≥ 56 px get −0.01em.
- Uppercase Turkish needs room for the İ dot and the Ş/Ç cedilla:
  - Single-line label boxes use `line-height ≥ 1.0`, **with no `overflow: hidden` clipping vertically**.
  - Test every label with `İŞĞÇÖÜ`.
- No italics are shipped. When slant is needed (sponsor wordmarks, trailer), use `skewX(-12deg)` on a block, never synthetic `font-style: italic`.

### 3.6 Turkish casing (critical) [P] §3.10 · [I] rules
- UI labels live in the i18n dictionaries in sentence case and are upper-cased by CSS `text-transform: uppercase` under the correct `lang`. `<html lang>` is set by I18n.
  - Under `lang="tr"`, "en iyi tur" → **EN İYİ TUR** and "pit" → **PİT**.
  - Under `lang="en"`, "pit" → PIT.
- **Proper nouns keep the casing rules of their origin language.** Wrap them in `lang`:
  - **Team names** are English-origin, so `lang="en"`: "Solaris Racing" → SOLARIS RACING. Turkish rules would wrongly give "SOLARİS RACİNG". This includes Anka Racing.
  - **Driver names:** `lang` follows nationality. `nat === 'TR'` → `tr` (Kerem Aydın → KEREM AYDIN); everyone else → `en` (Elias Norberg → ELIAS NORBERG, not "ELİAS").
  - **Mixed strings** such as the track name are pre-composed per language in i18n. TR uses **İSTANBUL CIRCUIT** (`İSTANBUL` Turkish-cased, `CIRCUIT` English-cased); EN uses **ISTANBUL CIRCUIT**.
  - **Key labels** come from `KeyBindingsApi`. Upper-case them with the *keyboard's* locale, so the TR-Q `i` key shows **İ**.
- JS fallback: `s.toLocaleUpperCase(lang === 'tr' ? 'tr-TR' : 'en-US')`. Never use bare `toUpperCase()` on user-facing strings.

---

## 4. Spacing & Grid

### 4.1 Base grid
- **8 px grid with a 4 px half-step.** Tokens: `--s-1: 4px` `--s-2: 8px` `--s-3: 12px` `--s-4: 16px` `--s-5: 24px` `--s-6: 32px` `--s-7: 48px` `--s-8: 64px` `--s-9: 96px`.
- **Radii:**
  - 0 for panels, rows, buttons and tiles.
  - 2 px for chips and key caps (anti-aliasing only).
  - 4 px for tyre glyphs.
  - 50% only for minimap dots, start-light lamps and tyre-compound rings.
- **Strokes:** 1 px hairline (`--apx-line`); 2 px for emphasis and focus. Nothing thicker except the 3 px slanted underline of the active step or tab.
- **Slant:** `--apx-slant: 12deg`. A slanted end on an element of height `h` cuts `0.2126·h` horizontally. Slants are used only on elements ≤ 64 px tall.
  - Filled shapes (banner, delta chip, notch) use `clip-path: polygon(...)`.
  - Outlined shapes (DRS available, ERS mode) use `transform: skewX(-12deg)` on the box, with the label counter-skewed `skewX(12deg)`, so the border survives on all four sides.
  - Both are static transforms, not animations.

### 4.2 HUD scale model [P] `Settings.hud.scale` 0.8–1.25 · [I] model
- **HUD frame:** a centred box of `W = min(vw, vh·16/9)` and `H = vh`.
  - On ultrawide (21:9, 32:9) the HUD stays inside the central 16:9 area, so eye travel stays the same as 16:9.
  - On 16:10 the frame is full width.
- `kView = min(W/1920, H/1080)`: 1 at 1080p, 1.333 at 1440p, 2 at 4K. `k = kView × hud.scale`.
- **Every HUD length** is written as `calc(N * var(--u))` with `--u: calc(var(--k) * 1px)`.
  - Text and layout scale together, crisply (no `transform: scale` on regions, no `zoom`).
  - `--k` is set once on the HUD root on resize and on settings change.
- **Safe-area insets scale with `kView` only**, not with `hud.scale`: `--safe-x: calc(48px * kView)` and `--safe-y: calc(40px * kView)`. Regions anchor to the safe rectangle; their contents grow from the anchored corner.
- At `hud.scale = 1.25` on 1080p, the regions must still not overlap. This is checked in §5.1: the tower's bottom edge and the bottom-left group's top edge keep ≥ 24 px clear.

### 4.3 Menu grid
- 1920 × 1080 baseline, scaled by `kView` the same way (menus ignore `hud.scale`).
- Outer margins 96 px left/right and 64 px top/bottom. 12 columns, 24 px gutters (column = 120 px).
- Navigation lists use columns 1–5. Showroom and info cards use columns 8–12.
- Bottom bar: 64 px tall, key hints left, version right.

### 4.4 Z-order
`canvas 0 · hud 10 · hud-overlay 20` (lights, banners) `· hud-modal 30` (MFD, flashback) `· screen 40 · pause 50 · toast 60 · debug 90`.

---

## 5. Layout & Composition

### 5.1 In-race HUD regions [P] Ek C · [I] boxes (1080p, k = 1, safe insets 48/40)

| Region | Anchor | Box (x, y, w × h) | Content |
|---|---|---|---|
| **Tower** (race) | top-left | 48, 40, 280 × 32 + 30·rows | header + 20 rows when expanded (≤ 632 px tall). Collapsed: P1–P3, a 6 px divider, then the player ±2 (or P1–P8 when the player is in the top 5) |
| **TT panel** (time trial, replaces the tower) | top-left | 48, 40, 280 × ≤ 300 | KİŞİSEL EN İYİ, ghost mode, last 5 laps (✓/✗ valid) |
| **Timing** | top-right | right 48, 40, 360 × 214 | P x/20 and TUR x/y; current lap; delta chip; SON / EN İYİ; 3 sector bars |
| **Start lights** | top-centre | centred, 40, 360 × 138 | 5 pods × 2 lamps |
| **Banners** | top-centre | centred, 40 (or 190 while the lights are shown), 480–720 × 56, stack ≤ 2, 8 px apart | notifications |
| **Wheel module** | bottom-right | right 48, bottom 40, 400 × 196 | 15 LEDs, speed, gear, DRS / PİT chips, ERS bar and mode, brake bias |
| **Bottom-left group** | bottom-left | 48, bottom 40, 400 × 240 | weather strip 400 × 32 on top; minimap 240 × 200 + tyre widget 152 × 200 below |
| **MFD** | centre | centred, 316, 720 × 352 | opened with Tab |
| **Flashback** | bottom-centre | centred, bottom 40, 880 × 112 | appears only while flashback is open |

Clearances at k = 1:
- tower bottom 672 vs bottom-left group top 800 (128 px)
- flashback 520–1400 vs side groups at ≤ 448 and ≥ 1472

At k = 1.25 the tower bottom is ≈ 830 px and the bottom-left top ≈ 740 px, so **with `hud.scale` > 1.1 the tower auto-collapses** [I].

**HUD modes** [P] `visible`:
- `full` — as above.
- `minimal`:
  - the tower becomes 3 rows (car ahead, you, car behind)
  - the timing panel shows only the lap/position row, the current lap and the delta
  - the wheel module stays
  - minimap, tyres and weather hide
- `off` — nothing in-race. The MFD and flashback still open on demand, and the 3D gantry still shows the lights.

**Cameras:** the layout is identical for every camera. In cockpit view the 3D wheel display sits bottom-centre and does not collide with the bottom-right module.

### 5.2 Screens [P] `ScreenId` · [I] composition

| Screen | Composition |
|---|---|
| `title` | Full-bleed showroom or cinematic 3D with a left ink scrim (`--apx-ink-950` 0.92 → 0 at 45% width). The wordmark (cap height 120) is at x 96, vertically centred. Below it, `BAŞLAMAK İÇİN BİR TUŞA BAS` in `meta` 22 px, +0.16em, `fg-2`. It fades in once and never pulses. Version bottom-right. |
| `mainMenu` | Left: wordmark top-left (cap height 40), then a navigation list at y 380 (64 px rows): ZAMANA KARŞI, HIZLI YARIŞ, AYARLAR, JENERİK. Below the list, a description of the focused item (`body`, `fg-2`, max 2 lines). Right-bottom: an info card 520 × 220 (track facts, personal best with sectors). Background: the showroom with the car at x ≈ 62%. Bottom bar: key hints. |
| `ttSetup` | Title `ZAMANA KARŞI`. Setting rows on the left (car/team, tyre, time of day, weather, ghost: KİŞİSEL EN İYİ / RAKİP / KAPALI). The showroom car on the right updates live. CTA `PİSTE ÇIK` bottom-left. |
| `raceConditions` → `teamSelect` → `raceSettings` → `assists` | Top stepper: `1 KOŞULLAR · 2 TAKIM · 3 AYARLAR · 4 YARDIMLAR`, with a 3 px slanted vermilion underline under the current step. Team select is a 5 × 2 grid of team tiles (300 × 176, 16 gaps) over the showroom. The focused team's car loads in the showroom. |
| `loading` | Ink background with a static large track outline (centre-right, 2 px `fg` at 20%). Session summary top-left in `meta` (`HIZLI YARIŞ · 29 TUR · GÜN BATIMI · DEĞİŞKEN`). Tip panel bottom-left (720 px wide). 4 px progress bar at the very bottom. |
| `pause` | `--apx-scrim` over the frozen game; the HUD stays visible underneath. Left panel 560 px full height with a navigation list: DEVAM ET, YENİDEN BAŞLAT, AYARLAR, YARIŞTAN ÇEKİL (race), MENÜYE DÖN. Right: session card (lap, position, best). |
| `settings` | Vertical tab list on the left (280 px): GRAFİK, SES, KONTROLLER, YARDIMLAR, HUD, DİL, ARAYÜZ. Content rows on the right (56 px each): label at x 0, control right-aligned at a fixed column. Focused-row description in a footer panel. |
| `results` | Title `YARIŞ SONUCU` (`h1`) plus a subline (`İSTANBUL CIRCUIT · 29 TUR`). Table 1440 wide, centred, 40 px rows. Bottom bar: YENİDEN BAŞLAT / MENÜYE DÖN. |
| `ttResults` | PB banner (new PB = `green` stripe) + table of laps (n, time, S1–S3 coloured by status, valid) + local top-10. |
| `credits` | Two text columns (`body`), keyboard-scrolled in 120 px steps; licences (OFL, CC0, OSM/ODbL) listed verbatim. |

### 5.3 Trailer cards [P] Sprint 5b · [I]
- **Canvas and safe areas:** 1920 × 1080; title-safe inset 192 × 108 (10%).
- **Title card:**
  - background `--apx-ink-950`, or gameplay with a left ink scrim
  - `card-title` left-aligned at x 192, baseline at 58% height
  - `card-sub` above it in `fg-2`
  - a 12° vermilion bar (8 × 120) left of the title
- **End card:**
  - wordmark centred (cap height 160)
  - one factual line below in `card-sub`, e.g. `İSTANBUL CIRCUIT · 20 ARAÇ · KLAVYEYLE`
  - nothing else
- Every on-screen claim must appear in `media/trailer/facts.md` [P].

---

## 6. Components

All dimensions are 1080p at k = 1. "Panel" means `--apx-panel`, 0 radius, no border, no shadow, `contain: layout paint style`.

### 6.1 Position tower row
- **Header** (32 px): label `SIRALAMA · ARALIK` or `SIRALAMA · LİDERE FARK` (`hud-micro`, `fg-3`) with a 12° right end. `gapMode` switches the label.
- **Row** (280 × 30; column widths, left to right):

  | Column | Width | Content |
  |---|---|---|
  | position | 36 | `hud-data`, right-aligned, tnum |
  | team strip | 4 | full height, the `ui` colour |
  | gap | 8 | — |
  | code | 52 | `hud-data`, +0.04em |
  | tyre ring | 18 | always on an 18 px `--apx-ink-900` disc; 2 px ring and 11 px letter in the compound colour |
  | gap | 6 | — |
  | badge slot | 44 | one badge, see below |
  | gap value | 104 | `hud-data-s`, right-aligned, tnum, `fg-2` |
  | padding | 8 | — |

- **Badge priority** (one badge only):

  | Priority | Badge |
  |---|---|
  | 1 | `+5` penalty (red fill, ink text) |
  | 2 | `DRS` (1 px green outline, green text) |
  | 3 | fastest-lap clock (purple icon) |
  | 4 | chequered icon (finished) |

- **States:**

  | State | Treatment |
  |---|---|
  | default | transparent row |
  | **player** | `--apx-fg` fill, ink text; the strip keeps its colour. On this white row, outline badges render **filled** (DRS = green fill, `PİT` = ink fill with `fg` text) and the fastest-lap clock sits on an ink disc, so every badge stays ≥ 3:1 |
  | in pit | text `fg-2`; the gap cell shows a `PİT` chip (1 px `fg` outline, `hud-micro`) instead of a time |
  | lapped | gap shows `+1 TUR` |
  | `dnf` / `dsq` | text `fg-disabled`, strip at 40%; gap `DNF` / `DSQ`; sorted last |
  | position gained / lost | a 10 px chevron (`green` up / `red` down, SVG) left of the position for 3 s |

- **Row divider:** 1 px `--apx-line` between rows. No zebra striping.

### 6.2 Timing panel and sector bars
- **Row A** (56): `P4` (`hud-pos`) + `/20` (`hud-data`, `fg-3`) on the left; `TUR` (`hud-label`, `fg-3`) + `12/29` (`hud-lap` at 28 px) on the right. In TT the position cell hides and the lap shows `TUR 7`.
- **Row B** (48): current lap `1:05.318` (`hud-lap`) on the left; delta chip on the right (64 × 28, slanted ends, ink text, `green`/`red` fill, `−0.214`). If `invalid`: the lap time turns `red` and a `GEÇERSİZ` chip (red fill) replaces the delta.
- **Row C** (40): `SON TUR` + value and `EN İYİ` + value (labels `hud-micro` `fg-3`, values `hud-data`).
- **Row D** (44): 3 equal sector cells, 4 px apart. Each has a 6 px bar on top and `S1` (`hud-micro`) plus the time (`hud-data-s`) beneath.
  - **States:** none (bar `--apx-sector-none`, time `—` in `fg-3`) · in progress (1 px `fg` outline, no time) · yellow / green / purple (bar filled, time in `fg`).
  - **Sector flash on completion:** see §7.

### 6.3 Steering-wheel display (wheel module, 400 × 196, padding 16)
- **Shift LEDs:**
  - 15 segments, each 20 × 12, skewed −12°, 4 px apart, centred in one row.
  - Lit count = `shiftLeds`. Colours 5 green / 5 red / 5 blue [O]; unlit `--apx-led-off`.
  - `shiftNow` → all blue. `limiter` → all red (steady).
  - Pit limiter → left half blue / right half amber, swapping at **2 Hz** (≤ 3 Hz photosensitivity rule; steady under reduced motion).
- **Centre row:** speed column 120 (`hud-speed`, right-aligned, unit `KM/SA` in `hud-micro` below) · gear column 112 (`hud-gear`, centred; `N` and `R` literal) · right column 120 with stacked chips.
- **Chips** (64 × 28, slanted ends):
  - `DRS` (states in §2.3)
  - `PİT` (`blue` fill, ink text, only while the pit limiter is on)
  - brake bias `FREN %57,5` (`hud-micro` label, `hud-data-s` value)
- **ERS row:**
  - label `ERS` (`hud-micro`)
  - bar 240 × 8: track `--apx-line`, fill `--apx-ers`, `transform: scaleX(soc)` written directly with no tween
  - `%62` (`hud-data-s`)
  - mode chip: `KAPALI` / `ORTA` / `HIZLI TUR` / `SOLLAMA`; `overtake` = amber fill
  - a 2 px `lapUsed` line under the bar (`fg-3` track, `fg-2` fill)

### 6.4 Tyre widget (152 × 200)
- **Header:** compound ring 28 px (3 px stroke + letter `hud-label` 800) + `ORTA · 9 TUR` (`hud-label`).
- **Body:** 4 tyre glyphs (24 × 40, radius 4) in car layout (FL FR / RL RR) around a 1 px chassis outline.
  - Fill: state colour at 22% alpha. Border: 2 px state colour.
  - Beside each tyre: wear `18` (`hud-data-s`, `fg`) and temperature `98°` (`hud-micro`, in the state colour).
  - Column head: `AŞINMA %`.

### 6.5 Minimap (240 × 200, `--apx-panel`; the weak .64 backplate let kerb stripes bleed through in the preview, so it is not allowed here)
- **Track:** the main track (from `TrackData`) as a 3 px `fg` stroke at 85% over a 7 px ink under-stroke at 60%.
  - Pit lane: 2 px `fg` at 30%, dashed 6/4.
  - DRS zones: 3 px `green` at 70%.
  - S/F: 6 px chequered tick. Sector boundaries: 2 px `fg-3` ticks.
- **Cars:** dots r 4.5 in the team colour with a 1.5 px ink stroke.
  - Player: r 6.5, `fg` fill with a 2.5 px team-colour ring, drawn last.
  - In-pit cars at 50%. Hidden when `dnf`.
- **Flags:** a yellow flag repaints that sector's stroke `yellow` at 4 px.
- Positions are written directly every HUD update. North is up; the projection is screen-y = world +Z.

### 6.6 Weather strip (400 × 32)
Content: `HAVA 24°` · `PİST 38°` · `ISLAKLIK %0` · rain icon.
- Values in `hud-data-s`, labels in `hud-micro` `fg-3`.
- When rain > 0 the drop icon fills `blue`.

### 6.7 Notification banner
- **Size:** 56 tall (72 with a sub-line), 480–720 wide; the right end slants 12°.
- **Anatomy:**
  - 6 px level stripe
  - 24 px icon
  - title (`hud-banner`)
  - a 1 px `--apx-line` divider
  - detail (`hud-data-s`, tnum)
  - optional right chip (e.g. `+5 SN`)
- **Queue:**
  - at most 2 visible; the newest is on top and pushes the older one down
  - a third waits in the queue
  - the same `key` coalesces (it updates in place and restarts its timer)
- **Lifetime:** `ms` from the `notify` event; defaults are 3,000 for info and 4,500 for warn and penalty.
- **Stripe and icon colours:** see §2.3. Examples in §8.3.

### 6.8 Start lights (360 × 138)
- **Housing:** `--apx-ink-950` at 0.92, padding 16.
- **Pods:** 5 pods of 56 × 106, 12 px apart. Each holds 2 lamps of Ø40, 10 px apart.
- **Lamps:** off `--apx-lamp-off` with a 3 px transparent border; on `--apx-lamp-on` with a 3 px `#FF7A72` border ring as the highlight. **No outer glow and no `box-shadow`** (§7.7).
- **Sequence:** `lit` pods light up left → right (both lamps per pod).
- **Lights out:** all off in the same frame. The housing exits after 800 ms.
- **Jump start:** a penalty banner.

### 6.9 MFD panel (720 × 352)
- **Header (48):** 5 slanted page ticks plus the page title (`h2` at 24 px).
- **Body:** up to 4 option rows (64 each). Each row has a key chip (`1`–`4`), a label (`control`) and a value or state on the right.
- **Footer hints:** `TAB SONRAKİ SAYFA · 1–4 SEÇ`.
- **Pages:** STRATEJİ (pit request `PİTE GİR`, next tyre), ERS (modes), FREN (brake bias ±), HAVA (forecast cells `+5 DK %20`), LASTİK (4-tyre detail with °C).
- **Tab cycle:** STRATEJİ → … → LASTİK → closed.

### 6.10 Flashback timeline (880 × 112)
- **Top row:**
  - left: `GERİ SAR` (`hud-banner`) + `KALAN 2` (`hud-label`, `fg-3`)
  - right: offset `−4.6 SN` (`hud-data`)
- **Track:** 840 × 24 with 15 one-second ticks. The discarded span (head → now) fills `fg` at 30%.
- **Head:** a 3 px `fg` bar with a 12° top notch, positioned directly (no tween).
- **Hints:** `← → SAR · ENTER UYGULA · ESC İPTAL` (key chips).

### 6.11 Menu navigation list row and tile
- **List row:**
  - 64 tall, label in `item`, left padding 32 (the notch zone is 8 + 24)
  - optional right meta (`meta`, `fg-2`)
  - **States:**

    | State | Treatment |
    |---|---|
    | default | `fg` text, transparent |
    | **focused** | `--apx-fg` fill, ink text, vermilion apex notch (8 × 64, slanted 12°) |
    | pressed | fill `#DCE1E7` for the 140 ms press |
    | disabled | `fg-disabled`, skipped by focus |

- **Tile:**
  - team tile 300 × 176; mode tile 400 × 220
  - `--apx-panel-raised`, with a 6 px top bar in the team or brand colour
  - title bottom-left (`h2` 24 px, `lang="en"` for team names)
  - meta `AYD 7 · ARS 34` (`meta`, tnum)
  - **Focused:** 2 px `fg` outline, the apex notch on the left edge, and `translateY(-4px)`.

### 6.12 Toggle, slider, select (setting rows 56 tall)
- **Focused setting row:** `--apx-row-hi` background with the apex notch. Labels in `control`.
- **Toggle:**
  - a segmented `KAPALI | AÇIK` control, 2 × 96 × 40
  - active segment: `fg` fill, ink text; inactive: `fg-2` text; outline 1 px `--apx-line-strong`
  - ← / → or Enter flips it
- **Slider:**
  - track 280 × 4 (`--apx-line-strong`), fill `fg`, thumb 4 × 20 `fg` (6 × 24 `brand` on the focused row)
  - value in a 48 px box (`control`, tnum)
  - ← / → step; the step is set per setting
- **Select (stepper):**
  - `‹ YÜKSEK ›`, 280 wide, with 16 px SVG chevrons
  - chevrons dim to `fg-disabled` at the ends of ordered scales; unordered sets wrap
  - option-index ticks below (n × 6 × 2, the active one `fg`)

### 6.13 Key-binding chip
- **Size:** min 32 × 32, 0 10 padding, 1 px `fg-3` border plus a 3 px bottom border (key-cap depth), radius 2. Text `hud-label` 700 in the keyboard-locale casing.
- **Arrows** are SVG.
- **TR names:** `BOŞLUK`, `ESC`, `ENTER`, `TAB`, `BACKSPACE`, `SOL SHIFT`.
- **States:**

  | State | Treatment |
  |---|---|
  | default | as above |
  | focused | `fg` border |
  | listening | `TUŞA BAS…`, `brand` border and text |
  | replaced | the action that lost the key shows an empty chip with a `red` border until it is rebound, plus the warn banner `C TUŞU KAMERA'DAN ALINDI` |

- **Labels:** chips always show `KeyBindingsApi.label(code)` [P] (layout-aware via `getLayoutMap()`).
- **Rebind results:** `RebindResult.reason`:
  - `modifier` → warn banner `CTRL / ALT / META ATANAMAZ`
  - `reserved` → `BU TUŞ AYRILMIŞ`
  - `cancelled` → no banner
- **Never offer Ctrl, Alt or Meta [P].**

### 6.14 Results table
- **Size:** 1440 wide, 40 px rows, header row 40 in `meta` `fg-3`.
- **Columns:**

  | Column | Width | Content |
  |---|---|---|
  | POS | 64 | `hud-data` 22 px 800, centred |
  | strip | 4 | team `ui` colour |
  | PİLOT | 360 | name in `table` 700 UPPER, origin `lang`; code `meta` `fg-3` |
  | TAKIM | 280 | `meta`, `fg-2`, `lang="en"` |
  | SÜRE / FARK | 200 | right-aligned: the winner's total `1:02:14.512`; others `+3.204`, `+1 TUR`, `ÇEKİLDİ` |
  | EN İYİ TUR | 160 | right-aligned; the fastest lap is `purple` with a clock icon |
  | PİT | 64 | centred |
  | CEZA | 80 | `red` `+5 SN` |
  | PUAN | 80 | right-aligned, 800 |

- **Player row:** `--apx-row-hi` with the apex notch.
- No podium colours (no gold/silver/bronze).

### 6.15 Loading tip and progress
- **Tip panel:**
  - 720 wide
  - label `İPUCU` (`meta`, `brand`) above the tip (`body` at 22 px, `fg`, ≤ 2 lines)
  - tips rotate every 7 s with a crossfade
- **Progress:** a 4 px full-width bar at the bottom. Track `--apx-line`, fill `brand`, `scaleX(progress)` written directly.
- **Stage text:** right-aligned, `PİST YÜKLENİYOR · %62` (`meta`).

### 6.16 Icons and focus
- **Icons:** custom inline SVG on a 24 grid, 2 px stroke, square caps, miter joins, `currentColor`.
  - Set: flag, chequered flag, black-and-white flag, tyre ring, pit, penalty stopwatch, clock, drop, thermometer, wet road, ERS bolt, chevron up/down/left/right, arrow keys, check, cross.
  - No icon fonts, no emoji.
- **Focus:**
  - Always visible; never `outline: none` without the notch or outline replacement.
  - One focus at a time. Mouse hover moves focus.

---

## 7. Motion & Interaction

### 7.1 Principles [P] PLAN motion rules
- Animate **only `transform` and `opacity`**.
- Use one easing family (below), defined with GSAP `CustomEase`.
- Springs need a damping ratio ≥ 0.72. Never bounce.
- GSAP runs **only on discrete events**. **HUD numbers are never tweened**: speed, rpm, gear, LEDs, every time, gap, delta, ERS, tyre value, minimap dot and flashback head is written directly at 30 Hz.
- Every tween and timeline is killed in `dispose()`.

### 7.2 Tokens

| Token | Value | Use |
|---|---|---|
| `--apx-dur-fast` | 140 ms | exits, presses, focus notch, stepper value |
| `--apx-dur-base` | 180 ms | toggles, MFD and flashback open |
| `--apx-dur-slow` | 220 ms | screen enter, control enter |
| `apex.out` | `CustomEase.create('apex.out', '0.22,1,0.36,1')` | everything that enters or reveals |
| `apex.inOut` | `CustomEase.create('apex.inOut', '0.65,0,0.35,1')` | on-screen moves (Flip, tab underline, toggle thumb) |
| `apex.in` | `CustomEase.create('apex.in', '0.64,0,0.78,0')` | exits only, always ≤ 160 ms |
| `apex.settle` | spring ζ = 0.78 (≈ 2% overshoot at t ≈ 0.68): `CustomEase.create('apex.settle', 'M0,0 L0.042,0.040 L0.083,0.137 L0.125,0.262 L0.167,0.394 L0.208,0.521 L0.250,0.636 L0.292,0.734 L0.333,0.814 L0.375,0.878 L0.417,0.926 L0.458,0.962 L0.500,0.987 L0.542,1.003 L0.583,1.013 L0.625,1.018 L0.667,1.020 L0.708,1.019 L0.750,1.018 L0.792,1.015 L0.833,1.013 L0.875,1.010 L0.917,1.008 L0.958,1.006 L1,1')` | notification enter |
| CSS mirrors | `--apx-ease-out: cubic-bezier(.22,1,.36,1)` · `--apx-ease-in-out: cubic-bezier(.65,0,.35,1)` · `--apx-ease-in: cubic-bezier(.64,0,.78,0)` · `--apx-ease-settle: linear(0, .137 8%, .394 17%, .636 25%, .814 33%, .926 42%, .987 50%, 1.013 58%, 1.02 67%, 1.018 75%, 1.013 83%, 1.008 92%, 1)` | CSS-only micro states |

Controls (focus, toggle, slider, select, press) stay inside **140–220 ms** [P].

### 7.3 What animates (the complete list)

| Event | Animation | Timing | Reduced |
|---|---|---|---|
| Notification in | y −12→0 (×u) + opacity 0→1 | 260 ms `apex.settle` | opacity, 120 ms |
| Notification out | opacity → 0, y 0 → −6 | 160 ms `apex.in` | opacity, 120 ms |
| Banner stack shift | Flip y | 220 ms `apex.inOut` | instant |
| **Tower re-order** | FLIP (plain GSAP tweens, §7.4), y only | 360 ms `apex.inOut` | instant |
| Position-change chevron | opacity in 120 ms, hold 3 s, out 200 ms | `apex.out` / `apex.in` | static for 3 s |
| Overtake wash | team-colour overlay opacity .35 → 0 on the row that gained | 600 ms `apex.out` | none |
| **Sector flash** | white overlay on the completed cell, opacity .85 → 0 (once) | 480 ms `apex.out` | the cell outline turns `fg` for 1 s |
| Start lamp on | opacity 0 → 1 | 60 ms linear | instant |
| **Lights out** | all lamps off | 0 ms (same frame) | same |
| Lights housing exit | 800 ms after lights out: opacity → 0, y → −8 | 200 ms `apex.in` | opacity, 120 ms |
| Screen enter | panel x −24 → 0 + opacity; list items stagger 24 ms (≤ 8 items) | 220 ms `apex.out` | opacity, 120 ms, no stagger |
| Screen exit | opacity → 0, x 0 → −12 | 140 ms `apex.in` | opacity, 100 ms |
| Focus move | fill and text swap **instantly**; the notch goes scaleY .4 → 1 | 140 ms `apex.out` | instant |
| Tile focus | y 0 → −4 | 160 ms `apex.out` | none |
| Toggle | thumb or segment fill x | 180 ms `apex.inOut` | instant |
| Stepper change | value x ±8 → 0 + opacity | 140 ms `apex.out` | instant |
| MFD and flashback open / close | y 16 → 0 + opacity / reverse | 180 ms `apex.out` / 140 ms `apex.in` | opacity |
| Results reveal | rows y 8 → 0 + opacity, P1 first, 30 ms stagger | 220 ms each, ≤ 900 ms total | opacity, no stagger |
| Loading tip swap | crossfade | 220 ms | 120 ms |
| Title prompt | opacity 0 → 1, once | 400 ms `apex.out` | 120 ms |
| Boot logo (title intro, once per load) | Λ, PEX and the GP block slide in as whole segments (x ∓, 80–100 ms apart, 360–400 ms `apex.out`), the apex marker cuts in (scaleX, 220 ms), a soft vermilion light blooms behind (opacity/scale only; the mark never glows), tagline rises, cover fades at 2.15 s; ≤ 2.45 s total; any key skips and goes on to the menu (audio unlock) [P] | — | no intro: static title wordmark, 120 ms fade |

**Never animated:**
- any HUD number
- the LED fill
- bar widths (set `scaleX` directly)
- minimap dots
- the flashback head
- the loading progress
- layout properties (`width`, `height`, `top`, `left`, `margin`)
- `filter`, `clip-path`, `box-shadow`, colours via JS tweens

**No infinite loops**, except the pit-limiter LED alternation (2 Hz steps). Nothing flashes faster than 3 Hz.

### 7.4 FLIP rules for the tower [P] Flip · [I] rules (hand-rolled FLIP, see 1)
1. On a HUD update where `tower` order differs from the DOM order (a y-only FLIP with plain GSAP tweens):
   1. "first": each visible row's y = its computed slot (rows 30u, divider 6u, border-box) + its in-flight tween y, read before the update writes anything
   2. re-order the DOM, moving only the rows that are out of place (`insertBefore`)
   3. "last" = the new computed slot; `gsap.fromTo(row, { y: first − last }, { y: 0, duration: .36, ease: 'apex.inOut', overwrite: true })`
   - **Why not the Flip plugin (Sprint 2, U6, measured):** `Flip.getState` + `Flip.from` on 20 rows cost 14–27 ms of main thread per re-order on the reference laptop (per-element matrix walks), against the ≤ 2 ms gate. Re-appending every row cost another ~10 ms (layout objects rebuilt), and `clearProps: 'transform'` forced a computed-style parse per row on each re-order. The hand-rolled FLIP measures 1.3 ms median, 2.1 ms p90 for the whole `updateHud` that starts a 5-place re-order, with no layout reads.
2. Only `y` moves. The player row's contents never scale.
3. **Throttle:** at most 1 Flip start per 250 ms; later changes wait for the next slot. An interrupting re-order starts from the in-flight y (`gsap.getProperty(row, "y")`).
4. **Chaos guard:** if more than 6 rows change in one update (lap-1 start), apply instantly and skip the wash.
5. **Collapsed window:**
   - rows entering fade in over 120 ms
   - rows leaving are removed instantly
   - the 6 px divider never animates
6. Reduced motion: no Flip at all.

### 7.5 Reduced motion and `Settings.ui.animations` [P] `'auto' | 'on' | 'off'`
- **Effective "reduced"** = `animations === 'off'`, or `animations === 'auto'` while `(prefers-reduced-motion: reduce)` matches.
- `'on'` forces full motion.
- **Implementation:**
  - `gsap.matchMedia()` with the media query, combined with the settings store.
  - In reduced mode the "Reduced" column of §7.3 applies: no translation, no Flip, no stagger, opacity fades ≤ 120 ms, no flashing (steady LEDs).
  - Gameplay-critical timing (start lights) is unchanged.
- **Showroom turntable:** static under reduced motion.

### 7.6 Interaction model [P] Ek C
- **Keys:**
  - arrows or WASD move
  - Enter or Space confirm
  - Esc or Backspace go back
  - Home / End jump to the ends of a list
- **Focus:**
  - The first item is focused on entry; the last focused index is restored on back.
  - Focus moves are never queued behind an animation; a new input interrupts the running tween.
- **Lists do not wrap.** Steppers over unordered sets wrap.
- **Rebinding:**
  - Enter on a binding → `TUŞA BAS…` → the next `KeyboardEvent.code` is assigned.
  - Esc cancels. Ctrl, Alt and Meta are refused with a warn banner.

### 7.7 Performance rules
- **HUD writes:**
  - The HUD updates at 30 Hz [P].
  - Write `textContent` only when the formatted string changes.
  - No layout reads in the update path. Bars use `scaleX`; LEDs use a `data-on` attribute.
- **Containment:** `contain: layout paint style` on each region. The HUD DOM stays ≤ 450 nodes in `full` mode.
- **Forbidden on the HUD:** `backdrop-filter`, `filter`, `box-shadow`, `mix-blend-mode` and animated gradients.
- **Compositing:** `will-change` is only added by GSAP during a tween, never left permanently.
- Gate [P]: frequent notifications cost < 3% FPS.

---

## 8. Voice & Brand

### 8.1 Wordmark (SVG geometry and our font only) [I]
- **The mark:**
  - A **Λ** (apex) replaces the A. Its crossbar becomes the vermilion **apex marker**: a 12° parallelogram, the "clipping point" of a corner.
  - Then `PEX` in Barlow Condensed 800.
  - Then `GP` in ink on a vermilion 12° parallelogram block.
- **Geometry** (`viewBox 0 0 474 120`, cap height 100, baseline y 110; verified in `example.html`):
  - **Λ:** `polygon 0,110 28,10 48,10 76,110 56,110 38,46 20,110` in `fg` (or ink on light). This matches Barlow Condensed 800's A width (0.508 em) and stem weight.
  - **Apex marker:** `polygon 31.2,100 35,82 45,82 41.2,100` in `brand`.
  - **`PEX`:** text at x 82, font-size 143 (cap 700/1000 → 100), weight 800, letter-spacing −1.4.
  - **`GP` block:** `polygon 323,10 473,10 452,110 302,110` in `brand`.
  - **`GP` letters:** text-anchor middle at x 387.5, baseline y 100, font-size 115 (cap 80, so 10 units of padding top and bottom), weight 800, ink.
- **Lockups:**
  - horizontal (default)
  - monogram: Λ + marker, for the favicon and loading tick
- **Clear space:** 0.5 × cap height.
- **Minimum cap height:** 24 px for the horizontal lockup (below that the marker disappears); 16 px for the monogram.
- **Usage:**
  - On dark: `fg` + `brand` marker + `brand` block with ink letters.
  - On light boards: ink + `brand`.
  - Never on a busy photo without a scrim. Never outlined, glowing, gradient-filled or animated letter by letter.

### 8.2 Copy tone [P] [I]
- **Labels:** short, broadcast-style, uppercase, Turkish first.
  - Nouns over sentences; no exclamation marks; no "lütfen" in HUD; no emoji.
  - Body copy (tips, descriptions) is calm sentence case, ≤ 2 lines, second person singular ("Fren noktanı…").

| TR | EN | TR | EN |
|---|---|---|---|
| TUR | LAP | SEKTÖR | SECTOR |
| PİT | PIT | CEZA | PENALTY |
| EN İYİ TUR | BEST LAP | SON TUR | LAST LAP |
| EN HIZLI TUR | FASTEST LAP | KİŞİSEL EN İYİ | PERSONAL BEST |
| ARALIK | INTERVAL | LİDERE FARK | GAP TO LEADER |
| LİDER | LEADER | GEÇERSİZ TUR | LAP INVALID |
| PİST SINIRLARI | TRACK LIMITS | ERKEN KALKIŞ | JUMP START |
| PİTTE HIZ İHLALİ | PIT LANE SPEEDING | VİRAJ KESME | CORNER CUTTING |
| İKİ HAMUR KURALI | TWO-COMPOUND RULE | SARI / MAVİ BAYRAK | YELLOW / BLUE FLAG |
| DAMALI BAYRAK | CHEQUERED FLAG | DRS ETKİN / DEVRE DIŞI | DRS ENABLED / DISABLED |
| ERS: KAPALI · ORTA · HIZLI TUR · SOLLAMA | ERS: NONE · MEDIUM · HOTLAP · OVERTAKE | PİT LİMİTÖRÜ | PIT LIMITER |
| FREN DENGESİ | BRAKE BIAS | YUMUŞAK · ORTA · SERT · ARA · YAĞMUR | SOFT · MEDIUM · HARD · INTER · WET |
| PİTE GİR | BOX THIS LAP | GERİ SAR · KALAN | FLASHBACK · LEFT |
| ZAMANA KARŞI · HIZLI YARIŞ | TIME TRIAL · QUICK RACE | AYARLAR · JENERİK | SETTINGS · CREDITS |
| DEVAM ET · YENİDEN BAŞLAT | RESUME · RESTART | MENÜYE DÖN · YARIŞTAN ÇEKİL | QUIT TO MENU · RETIRE |
| BAŞLAMAK İÇİN BİR TUŞA BAS | PRESS ANY KEY | İPUCU · YÜKLENİYOR | TIP · LOADING |
| YARIŞ SONUCU · PUAN | RACE RESULT · PTS | ÇEKİLDİ (table) / DNF (tower) | RETIRED / DNF |

### 8.3 Notification examples
| Level / colour | Title | Detail |
|---|---|---|
| good · `purple` | EN HIZLI TUR | GRA · 1:25.612 |
| good · `green` | KİŞİSEL EN İYİ | 1:25.890 · −0.214 |
| warn · `amber` | PİST SINIRLARI 2/3 | T9 · BİR SONRAKİ İHLAL CEZA |
| penalty · `red` | ERKEN KALKIŞ | chip `+5 SN` |
| warn · flag `yellow` | SARI BAYRAK | SEKTÖR 3 |
| warn · flag `blue` | MAVİ BAYRAK | ARKADAN GELEN: NRB |
| info · `fg` | DRS ETKİN | — |
| info · `fg` | YAĞMUR 5 DK İÇİNDE | %70 OLASILIK |
| warn · `amber` | PİTE GİR | ARA LASTİK |

EN mirrors: FASTEST LAP · PERSONAL BEST · TRACK LIMITS 2/3 · JUMP START `+5 SEC` · YELLOW FLAG · SECTOR 3 · BLUE FLAG · DRS ENABLED · RAIN IN 5 MIN · BOX FOR INTERS.

### 8.4 Brand claims and IP [P]
- The series is **APEX GP**. The words "Formula 1" or "F1" never appear in the game, in trailer copy or in UI strings.
- No real teams, drivers, sponsors, logos or fonts.
- Trailer copy states only facts listed in `facts.md`.

---

## 9. Anti-patterns

**Never ship any of these. QC rejects them on sight.**

1. **Trope glow:**
   - purple-to-blue or cyan glow gradients
   - `text-shadow` or `box-shadow` glows on text, panels or numbers
   - neon outlines
   - the only lit-looking element is a start-light lamp, and it gets a border-ring highlight, never an outer glow
2. **Glass everywhere:** `backdrop-filter: blur()` on any element (HUD or menus), frosted cards, glass gradients over the WebGL canvas.
3. **Over-rounded UI:** `border-radius` > 4 px on any rectangle; pill buttons; circular avatars or badges (circles only for minimap dots and lamps).
4. **Decorative filler:** blobs, mesh gradients, noise/grain overlays, scanlines, glitch, light leaks, particle backgrounds behind menus, 3D-tilted cards.
5. **Copying the reference:**
   - the reference's logo, brand font or official race-graphics font
   - its menu tiles or HUD assets
   - its exact tower geometry or exact screen layouts
   - its red brand colour as our brand
   - real team colours as pairs with real names
6. **Untabular numbers:** any number rendered without `tnum`; a hyphen `-` used as a minus sign; reflowing number boxes; tweening a HUD number (count-up animations, odometer rolls).
7. **Turkish casing bugs:** `toUpperCase()` without a locale; `RACİNG`, `ELİAS`, `CİRCUİT`; `PIT` in TR UI (must be `PİT`); `İ` dot or `Ş`/`Ç` cedilla clipped by `overflow: hidden`.
8. **Colour-only meaning:** a tyre dot with no letter; a delta with no sign; a sector status with no time or outline; DRS as a lamp with no word.
9. **Semantic leaks:**
   - brand vermilion in the race HUD
   - red used to highlight P1 or a selection
   - yellow-flag state painted into sector timing bars
   - gold/silver/bronze podium colours
   - team colour filling large panels
10. **Motion sins:**
    - animating `width`, `height`, `top`, `left`, `clip-path` or `filter`
    - durations over 220 ms on controls
    - overshoot beyond ζ 0.72 (no bounce or elastic eases)
    - infinite pulses on prompts
    - flashing faster than 3 Hz
    - stagger chains longer than 8 items
    - focus that waits for an animation
11. **Layout sins:** HUD text directly on the 3D scene without a panel; panel opacity under `.88` behind text; HUD outside the 16:9 safe frame on ultrawide; overlapping regions at `hud.scale` 1.25.
12. **Generic web chrome:** emoji icons, icon fonts, default browser focus rings left unstyled, hover-only affordances, lorem ipsum, mock data not marked `Örnek veri`.
