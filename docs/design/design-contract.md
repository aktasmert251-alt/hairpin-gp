# APEX GP — Design contract (decision record)

> Companion to `DESIGN.md` (the binding visual spec) and `implementation-handoff.md`. Owner: Grafik Dizaynlayıcı. Sprint 0, 2026-10-05.
> Confidence labels: **provided** = given by the brief or project documents · **observed** = verified in this session (files, maths, cited web text) · **inferred** = design decision or recalled genre knowledge that was not verified here.

## 1. Goal and target artifacts
- **Goal:** one reusable visual direction for APEX GP, a keyboard-only browser racing game. It runs on three.js/TypeScript, defaults to Turkish (TR) with English (EN) second, and plays on a PC at 1080p and above. Later agents should be able to build the UI and 3D look without guessing.
- **Governed surfaces:**
  - the in-race HUD (DOM over WebGL)
  - all menu screens (`ScreenId`)
  - notifications and start lights
  - the motion language
  - 3D art direction (time-of-day grading, liveries, trackside branding, paint finishes)
  - trailer title and end cards
- **First consumers:**
  - Grafik-UI: `src/ui/**`, `?scene=hud` and `?scene=menu` in Sprint 2.
  - Grafik-3B: car, liveries, post/LUT and showroom in Sprints 1–2.
  - Çevre: lighting rigs and trackside boards.
  - QC: the visual and UI checklists.

## 2. Audience
- **Players:** PC racing fans. They expect broadcast-grade, dense timing info, read in peripheral vision at speed, keyboard only. Turkish speakers come first.
- **Builders:** the agent team. The contract must be executable without a designer in the loop.

## 3. Evidence used

| # | Evidence | Kind | Confidence | What it gave us |
|---|---|---|---|---|
| E1 | Orchestrator brief (Sprint 0, Grafik) | text | provided | scope, constraints, keep/change/do-not-copy, deliverables, motion rules, voice |
| E2 | `docs/sprints/PLAN.md`: "Tasarım ve hareket dili", Ek B (render), Ek C (HUD and menus), Ek D (rules and keys) | text | provided | HUD regions, screens, render chain, TOD and weather, motion rules, tabular-nums, TR casing |
| E3 | `docs/design/planner-report.md` §3.10, §4, §7.6–7.9, §7.15 | text and data | provided | i18n rules, `HudModel`, `ScreenId`, `QualityPreset`, the 10 teams, sponsors, ORBIS, track geometry (used for the minimap), timing lines, DRS zones |
| E4 | `src/contracts/{hud,ui,settings,data,input}.ts` (Lead) | code | provided | `Settings.ui.animations: 'auto'\|'on'\|'off'`, `TeamDef.colors` (no `ui`), `KeyBindingsApi.label()`, `DriverDef.tcam` |
| E5 | Reference racing game HUD and menus (F1 25) | memory | inferred | genre conventions: tower top-left, rev lights and gear bottom-right, ERS bar, minimap, showroom menus. No screenshots were provided. |
| E6 | EA "F1 25 tips and tricks" via search: "speed, gear, RPM, fuel level, ERS, laptime and lap delta"; RPM lights customisable; display can flash at the shift point. EA forum: the timing tower appears in replays and highlights. https://www.ea.com/de/games/f1/news/f1-25-tips-and-tricks · https://forums.ea.com/discussions/f1-25-general-discussion-en/f1-timing-tower/12238622 | web text | observed | HUD element inventory; we deliberately keep a live tower (PLAN Ek C) |
| E7 | EA accessibility page for F1 25: HUD elements toggleable, a full-disable toggle, colour-blind options for the racing line, a motion-blur slider. https://www.ea.com/nb-no/able/resources/f1-25 | web text | observed | HUD modes (full/minimal/off) and accessibility expectations |
| E8 | Sector colour semantics: purple = fastest overall, green = personal improvement, yellow = slower than personal best. https://f1-dash.com/help · https://formulaonehistory.com/purple-sector-in-f1 | web text | observed | sector tokens (§2.3) |
| E9 | Steering wheel: 15 LEDs in blocks of five green-red-blue; the LEDs also flash for the pit limiter. https://f1technical.net/features/3492 | web text | observed | shift-LED spec (§6.3) |
| E10 | 2025 broadcast graphics reception: the red P1 highlight in replays was read as a red flag; the new pit icon was praised as visible. https://www.si.com/onsi/f1/news/f1-fans-rip-apart-2025-graphics-at-pre-season-testing-such-a-shame-01jn19jk806c | web text | observed | rule "red = alarm only" (§2.1.7) |
| E11 | ui-ux-pro-max `--design-system` and domain searches | tool output | observed | Adopted: the "Sports/Fitness" pairing Barlow Condensed + Barlow, the data-dense dashboard rules, and the UX rules (reduced motion, 150–300 ms, transform/opacity, visible focus, 4.5:1). **Rejected**: the generated "Retro-Futurism" style, the Russo One + Chakra Petch pairing, the gaming palette `#7C3AED`, and neon/CRT/glitch effects. |
| E12 | WOFF2 inspection of the shipped fonts (Node + Brotli, cmap/GSUB/hmtx parse) | binary | observed | Turkish glyphs present in all 6 weight sets; `tnum` uniform; ←→▲▼ and U+2007 missing; U+2212 = width of "+"; Saira Condensed has no `tnum`; Sofia Sans Condensed has no ₺ |
| E13 | WCAG contrast computation over the worst case (panel over a white sky) | maths | observed | panel alpha .88, the semantic hue values, the ink-on-fill rule, team-strip separation |
| E14 | Damped-spring step response (ζ 0.78, ωn 7.4) | maths | observed | `apex.settle` CustomEase path, 1.99% overshoot |

**Not available:** screenshots or video of the reference, its UI assets, and lost planner sections §8–§16 (e.g. §8.10 LightingRig values). Claims about exact reference layouts are **not** made.

## 4. Keep / Change / Do not copy

| Reference | Keep | Change | Do not copy |
|---|---|---|---|
| **Reference game HUD** (E5, E6) | Regions (tower top-left, timing top-right, rev/gear/speed bottom-right, minimap and tyres bottom-left); rev-light semantics; ERS bar; delta colours; HUD toggles and modes | Brand, fonts, palette, panel geometry (12° slants, apex notch, white player row), all sizes and positions, iconography, copy (TR first) | EA, Codemasters and F1 logos; the "Formula1" fonts; any HUD asset; its exact layout or pixel geometry |
| **Reference game menus** (E5) | 3D showroom behind menus; set-up flow conditions → team → settings → assists; keyboard/pad-first focus | Left vertical navigation list (no tile carousel); our copy, brand and stepper | Its tile and tab layouts, imagery, menu sounds and assets |
| **Broadcast timing graphics** (E8, E10) | Tower density; white on dark; team-colour strips; purple/green/yellow; interval/leader toggle; driver highlight; pit and penalty badges | Typeface (Barlow, not the broadcaster's face), brand colour, angles, badge shapes, red reserved for alarm | The F1 logo and brand red as our brand; exact tower graphics; sponsor slots in graphics ("powered by …") |
| **Real steering-wheel displays** (E9) | 15 LEDs in green/red/blue blocks; limiter flash | Flash ≤ 2 Hz (photosensitivity); `shiftNow` = all blue; a readable on-screen module instead of a wheel replica | Any manufacturer's wheel UI |
| **ui-ux-pro-max output** (E11) | Barlow pairing; dark data-dense rules; UX guidelines | — | The generated retro-futurism style, neon purple gaming palette, CRT/glitch effects |
| **Project docs** (E2–E4) | Everything functional (data, regions, flows, rules, contracts) | — | — (they are ours) |

## 5. Final design stance
**"Pit-wall broadcast."** APEX GP's interface is a sober, engineered broadcast layer over a warm, sunlit 3D world:
- **Surface:** flat graphite panels (`rgba(9,11,14,.88)`), white Barlow Condensed in uppercase rhythm, and tabular timing in fixed slots.
- **Colour:** used only when it means something: purple best, green improvement, yellow slower, red alarm, blue flag, amber energy.
- **Shape:** one geometric idea, the 12° slant, cut into short elements. The vermilion "apex notch" is both the focus indicator and the crossbar of the Λ wordmark.
- **Motion:** quick (140–220 ms), quintic ease-out, at most 2% settle. It runs only on discrete race events; numbers never animate.
- **3D world:** carries the drama (golden day, amber sunset, white floodlights, grey spray). Liveries follow one airflow-swept language over shared exposed carbon.

The result is recognisably in the reference's broadcast tradition, but its brand, type, colour logic, geometry and layouts are our own.

## 6. Decision log (alternatives considered)

| # | Decision | Alternatives rejected | Why |
|---|---|---|---|
| D1 | One stance: pit-wall broadcast | "Night-circuit neon" (cyan/purple glow); "Anatolian ornament" | Neon is the banned AI trope and fights the sector semantics; ornament adds HUD noise |
| D2 | Brand = vermilion `#FF4B1F`, menus and brand moments only | Reference red `#E10600`; teal; orange; white-only brand | Hue 12° separates it from the reference red (hue ~2°, darker) and the Turkish flag red. Keeping it out of the HUD removes clashes with the soft tyre, penalty and Solaris orange. |
| D3 | HUD panel alpha .88 | .78 / .84 | At .84, `fg-3` = 4.29:1 over white sky (fails); .88 passes every text token (E13) |
| D4 | Ink text on every fill | White text on dark fills | Dark purple, red and blue fills failed 4.5:1 with white; lighter fills plus ink pass and simplify the rule |
| D5 | Team strips spread on the hue wheel (Aurora cyan-blue, Kestrel lifted navy, Titan steel, Zephyr pink) | Literal primaries | Literal Solaris orange vs Kestrel gold were 11° apart at equal luminance (E13) |
| D6 | Barlow Condensed + Barlow | Saira Condensed, Sofia Sans Condensed, Titillium, Russo/Chakra | Verified `tnum` and full TR coverage, plus ₺; signage DNA unlike the reference's brand face (E12) |
| D7 | `--k`/`--u` scaling; HUD frame clamped to 16:9 | `transform: scale` per region; CSS `zoom` | Crisp text, layout-correct, one variable; equal eye travel on ultrawide |
| D8 | Timing uses dots in both languages; other decimals follow the locale | Comma lap times in TR | PLAN fixes `m:ss.mmm`; broadcast convention; TR `%57,5` and `5,349 km` stay correct |
| D9 | Tower auto-collapses when `hud.scale` > 1.1 | Overlapping regions | Keeps ≥ 24 px clearance at 1.25 |
| D10 | ≤ 2 banners visible; same key coalesces | Unlimited stack | Clutter and FPS gate (< 3% drop) |
| D11 | Pit-limiter LED alternation 2 Hz | 6–10 Hz realistic blink | WCAG 2.3.1 (≤ 3 flashes/s) |

## 7. Contract change requests (for the Lead)
1. **`TeamDef.colors.ui: string`**:
   - What: the HUD strip/dot colour, guaranteed ≥ 3:1 on the panel. Values are in `DESIGN.md` §1.4.2 (e.g. Kestrel `#6478F0`, Titan `#9AA4AE`).
   - The presenter passes it as `TowerRow.teamColor` and `minimap.teamColor`.
   - Interim fallback: `colors.ui ?? colors.primary`. In `src/data/teams.ts`, please use the table's body, secondary and accent as `primary`, `secondary` and `accent`.
2. **Convention, no type change:**
   - The presenter owns notification lifetime. A notification stays in `HudModel.notifications` for its `notify.ms`.
   - The UI animates in on a new `id` and out on removal.
   - The same `key` arriving again should reuse the `id`, so it coalesces.
3. **i18n keys, no type change:** pre-composed uppercase track names per language (`İSTANBUL CIRCUIT` / `ISTANBUL CIRCUIT`). Proper nouns are never uppercased with a single global locale.

## 8. Risks and explicit unknowns
- **No reference imagery.** Layout claims about the reference are recalled, not observed. Mitigation: we do not copy layouts; QC checks "similar in spirit, not 1:1".
- **LightingRig numbers (§8.10) were lost.** The grading targets in DESIGN §1.4.1 are art-direction targets; ÇEV tunes the final values.
- **Low resolutions** (1366 × 768): kView 0.71, so 13 px labels render at about 9 px. Suggest a default `hud.scale` of 1.1 when the viewport height is < 900 px (Lead's settings default).
- **Colour-vision deficiency:** Anka/Zephyr and Aurora/Kestrel strips are separated mostly by luminance. Codes always accompany strips; run a CVD simulation pass in Sprint 4.
- **`example.html` font loading** uses `../../public/...` file paths. This works in Chrome and Edge; Firefox's `security.fileuri.strict_origin_policy` may block it.
- **Sponsor and team names** are fictional per PLAN. A trademark search is out of scope; the marks are geometric originals.
- **Tone.** Panel opacity .88 reads as nearly opaque. This is an accepted trade for legibility; translucency is visible over dark scenery.

## 9. Quality gate (skill `references/checklist.md` P0 plus brief gates)

| Gate | Status |
|---|---|
| `DESIGN.md` exists with the nine standard headings, verbatim | PASS |
| This file names the target artifacts (§1), audience (§2) and evidence (§3) | PASS |
| Every reference split into Keep / Change / Do not copy (§4) | PASS |
| Inferences labelled; no unverified brand facts presented as truth (§3 confidence, [P]/[O]/[I] tags in DESIGN) | PASS |
| One coherent stance, not a moodboard menu (§5, D1) | PASS |
| `implementation-handoff.md` is short enough to paste into the next run | PASS |
| Anti-patterns name exact things (DESIGN §9: properties, values, strings) | PASS |
| The final report lists files and next steps | PASS (in the Sprint 0 report) |
| Fonts OFL, self-hosted woff2, `OFL.txt` and `CREDITS.part.md` present | PASS |
| Turkish glyphs and `tnum` verified on the shipped binaries | PASS (E12) |
| Tokens with semantic roles: sectors, tyres, flags, penalties, DRS, ERS, 10 teams | PASS |
| Scale (0.8–1.25), 1440p/4K, and safe areas defined | PASS |
| Motion: transform/opacity only, 140–220 ms controls, CustomEase family, ζ ≥ 0.72, no number tweening, Flip rules, reduced motion | PASS |
| `example.html` screenshot reviewed at 1920 × 1080 | see `test-results/screens/gra/design-example.png` |

**What would fail review of the first artifact** (Sprint 2 `?scene=hud` / `?scene=menu`):
- any §9 anti-pattern
- a number without `tnum`, or a tweened number
- wrong Turkish casing
- the brand colour inside the race HUD
- text on the scene without a panel
- the focus notch missing on any focusable element
- regions overlapping at `hud.scale` 1.25
