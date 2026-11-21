# APEX GP — Implementation handoff (paste into the next build run)

**Read first:** `docs/design/DESIGN.md` (binding) → `docs/design/example.html` (open it in Chrome) → `src/contracts/{hud,ui,settings,input,data}.ts`.
**Direction:** "pit-wall broadcast":
- graphite panels, white Barlow Condensed, tabular timing
- colour only for meaning
- 12° slants on short elements
- a vermilion apex notch for focus
- no glow, no glass, no blobs

## Build order (Grafik-UI, Sprint 2)
1. **Tokens.**
   - Copy DESIGN §2.2 verbatim into `src/ui/styles/tokens.css`.
   - Add `@font-face` rules for 12 files: Barlow Condensed 500/600/700/800 and Barlow 400/600, each in latin and latin-ext. Use the unicode ranges from DESIGN §3.1 and `font-display: block`.
2. **Fonts gate.**
   - `AssetLoader` awaits `document.fonts.load('<w> 16px "Barlow Condensed"', 'İŞĞÇÖÜışğçöü0123')` for each weight before the first UI paint.
   - Preload the Condensed 600 and 700 files (latin and latin-ext).
3. **Scale.**
   - The HUD root sets `--k = min(W/1920, H/1080) × hud.scale`, where the frame `W = min(vw, vh·16/9)`, centred.
   - Every HUD length is `calc(N * var(--u))`, with `--u: calc(var(--k)*1px)`.
   - Safe insets are 48/40 × kView.
   - When `hud.scale` > 1.1, the tower auto-collapses.
4. **`src/ui/format.ts`.**
   - Lap times: `m:ss.mmm`. Sectors: `ss.mmm`.
   - Gaps: `+s.mmm`, `+1 TUR`, `LİDER`. Delta: signed, using U+2212.
   - Locale decimals: TR `%57,5` and `5,349 km`; EN `57.5%` and `5.349 km`.
   - Units: `KM/SA` / `KM/H` / `MPH`.
5. **HUD components.** Follow DESIGN §6.1–6.10 (boxes in §5.1) and the motion in §7.3/§7.4.
6. **Menus.** Follow DESIGN §6.11–6.15 and the screens in §5.2. The focus model is §7.6.

## Hard constraints (review fails if broken)
- **Text and fills:**
  - Text sits only on panels (`--apx-panel` .88).
  - Text on fills is ink `#0A0C0F`.
  - The brand vermilion **never** appears in the race HUD.
- **Numbers:**
  - Every number gets `font-variant-numeric: tabular-nums` and sits in a fixed-width box.
  - No GSAP or CSS transition on any HUD number, bar width, LED or minimap dot. Write them directly at 30 Hz, and only when the string changes.
- **Allowed CSS:**
  - Animate only `transform` and `opacity`.
  - No `backdrop-filter`, `filter`, `box-shadow` or `mix-blend-mode` on the HUD.
  - No radius above 4 px.
- **Motion:**
  - Register the eases `apex.out`, `apex.inOut`, `apex.in` and `apex.settle` exactly as in DESIGN §7.2.
  - Controls take 140–220 ms.
  - Use a y-only FLIP for the tower (360 ms, throttled to 250 ms, instant if more than 6 rows change); the Flip plugin was too slow (DESIGN §7.4).
  - Kill every tween and timeline in `dispose()`.
- **Reduced motion:** reduced = `ui.animations === 'off'`, or `'auto'` plus `prefers-reduced-motion: reduce`. Then apply opacity ≤ 120 ms only: no movement, no Flip, no flashing. Use `gsap.matchMedia()`.
- **Turkish casing:**
  - CSS uppercase under `lang`.
  - Team names `lang="en"`.
  - Driver names take `lang` from `nat` (`TR` → `tr`).
  - The track name is pre-composed (`İSTANBUL CIRCUIT`).
  - Never use bare `toUpperCase()`.
- **Icons and keys:**
  - Arrows and chevrons are inline SVG; the font has no ←→▲▼.
  - Key chips use `KeyBindingsApi.label(code)`.
  - Ctrl, Alt and Meta are never bindable.
- **Flashing:** nothing flashes faster than 3 Hz. The pit-limiter LED alternation is 2 Hz and is steady under reduced motion.
- **Data:**
  - Mock data in sandboxes is labelled `Örnek veri`.
  - Strings go only through i18n (TR default, EN parity).

## Assets
- Fonts are already in `public/assets/gra/fonts/` (OFL, see `public/assets/gra/CREDITS.part.md`). Do not add other fonts.
- The wordmark, icons, sponsor marks and liveries are original SVG, canvas or CSS geometry. There are no bitmaps of real logos.
- 3D (Grafik-3B / Çevre):
  - TOD grading targets: DESIGN §1.4.1
  - livery table: §1.4.2
  - trackside boards and display strings: §1.4.3
  - PBR finishes: §1.4.4
  - showroom: §1.4.5

## Responsive requirements
- Must hold at 1920×1080 (baseline), 2560×1440 (k 1.333), 3840×2160 (k 2), 2560×1080 (21:9: the HUD stays in the central 16:9) and 1920×1200 (16:10).
- At every `hud.scale` from 0.8 to 1.25: no overlap, no clipped `İ` dots or `Ş` cedillas.

## The first artifact (`?scene=hud`, `?scene=menu`) must prove
1. **HUD at 1080p:**
   - full tower (20 rows) with the white player row
   - timing panel with purple, green and in-progress sectors and a −delta chip
   - wheel module with 11 lit LEDs, gear, speed, DRS available and ERS ORTA
   - bottom-left minimap, tyres and weather
   - a FASTEST LAP banner
   - all of it matching `example.html` within the token rules
2. **Same scene with these switches:**
   - `hud.scale` 0.8 and 1.25 (tower collapses at 1.25)
   - `visible: 'minimal'`
   - EN language
3. **Motion:**
   - a tower re-order via Flip and a sector flash
   - notification enter and exit
   - reduced-motion mode visibly removes movement
4. **Menu:**
   - main menu over the showroom placeholder, navigated by keyboard only
   - focus always visible (white row and vermilion notch)
   - a settings screen showing the toggle, slider, stepper and key chip states
5. **Screenshots** via `scripts/shot.mjs`, looked at with Read, before reporting.
