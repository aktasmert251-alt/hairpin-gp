# Track visual briefs (Çevre)

One short contract per track before its visual pass. Evidence: the in-game sweeps (chase + cockpit every 150 m, day /
sunset / night / heavy rain) under `test-results/screens/cev/visual-*`. Real circuit names stay out of the game (D-037).
Shared rule for every track: improvements live in `src/track/**` and cost no new shader programs; budgets per game view on
High ≤ 1.5 M triangles, ≤ 200 draw calls, programs ≤ 55; the physics/track data (İstanbul hash b202b714) do not change.
Grading / LUT / post belong to Grafik.

## İstanbul (golden hills, east of the city)

**Mood.** A modern, purpose-built circuit dropped into dry, rolling Anatolian-side hills in late summer: big sky, hard
sun, pale dust, sparse stone pines and cypresses, the city sprawl and its high-rises on the horizon.

**Palette.** Straw / ochre ground (#B49A62 → #7C6A3E), olive scrub (#5E6A36), bleached concrete, dark fresh asphalt with a
grey-brown rubbered line; sponsor colour comes only from boards and stands. No lush green except irrigated verges.

**Landmark features.** The long main grandstand with its cantilever roof and the pit/paddock block; the anti-clockwise
multi-apex left (T8) bowl with stands; the hills ringing the site; a distant urban skyline (towers and minaret-like
spires) to the west.

**Audit (before).**
- The asphalt reads as one flat dark grey in both cameras. You can't see the rubbered line, patches or tyre marks.
- The terrain is one even olive-ochre. Nothing breaks it up near the track: no scrub clumps or bleached patches.
- The horizon is empty hills. Nothing says "city outskirts".
- Night coverage and rain are fine.
- There are only 10 board sponsors, and the 9 new car sponsors are missing.

**Keep.** Golden theme, stand placement, floodlight layout, kerb/run-off identity, the existing sponsor set and layout.
**Change.** Asphalt micro/macro detail, terrain variation, distant skyline, sponsor pool (+9 car sponsors).
**Do not.** Copy real logos or real circuit buildings; add green lushness; add per-frame cost to the asphalt shader beyond
a few noise taps.

**Accept when.** The same viewpoints before and after show:
- Asphalt: a readable rubbered line, repair patches and seams, and skid marks into braking zones, in both chase and cockpit views.
- Terrain: varied straw and scrub ground.
- Horizon: a city silhouette.
- Boards: all 19 sponsors appear.
- Limits: budgets met, no z-fighting, track tests and the hash unchanged.

**Result (2026-10-25).** Asphalt: dusty off-line, dark rubbered line that also mutes the IBL sky sheen (dry only), patches,
sealed cracks, tyre marks. Gravel traps: pebble grain, rake furrows, coarse patches, ruts near the edge. Painted green
verges: sun-fade, worn patches, smudges. Kerbs: rubber streaks and chipped paint. Terrain straw/scrub, outskirts estates +
mosques + mast (scenery/outskirts.ts), İstanbul day/sunset rig, 19-sponsor board pool. High: ≤ 192 calls, ≤ 0.79 M tris,
programs 50-51; hash unchanged. Shots `test-results/screens/cevre/ist-{wip,v3,sunset,night,rain}-*.png`.

## Lombardia (parkland, royal park north of the city)

(written before its pass)

## Lombardia — royal park

Tall mature plane trees form ordered avenues within mixed park woodland. A cream palazzo with terracotta roofs,
shuttered windows and a classical portico provides a distinct silhouette through a clearing. Preserve the existing
banked-oval remnants as scenery, adding moss, concrete seams and broken railing detail. Roofed stands receive
slender ribs and heritage green fascias; a podium pavilion and gate lodges complement the paddock. Existing fictional
straight billboards remain legible. Muted grass, leaf litter, asphalt repairs and braking rubber add surface variation.
Warm distant haze suggests the lowland valley; lamps and selected windows illuminate at night. All placement stays
outside driving surfaces and safety margins. Use the same 150 m chase/cockpit, four-condition sweep and High budgets
as the other briefs: <=200 calls, <=1.5 M triangles, <=55 programs, with deterministic instances and full disposal.

## Bosphorus — shore city

Warm plaster, painted timber bays and stone cornices alternate with modern glass balconies. Café awnings, flags,
benches and promenade railings establish a lived-in waterfront. Preserve the existing distant domes, minarets,
suspension bridges, moving ferries, yachts and reflective wave shader; add harbour detail and warm window light.
Road repairs and braking marks should read from cockpit height without obscuring driving edges. Night accents stay
warm and restrained. All additions are visual, deterministic and track-specific; repeated props are instanced.
Accept with identical-view chase/cockpit sweeps every 150 m in day, sunset, night and heavy rain, no road/pit intrusion,
no visible depth conflict, and High frame budgets <=200 calls, <=1.5 M triangles, <=55 programs.

## Ardennes — forest valley

Dense spruce and broadleaf woodland frames a damp, cool valley. Vary canopy height, foliage colour and forest-edge
scrub; keep every sightline inside the barriers open. Stone cottages, timber barns and a compact slate-roof village
provide human scale beyond the circuit. Mossy outcrops, muted wet ground and low valley mist reinforce elevation.
Roofed spectator areas at the first and second hairpins, timber marshal shelters and white night towers complete the
race venue. Existing kerbs, gravel, safety barriers and signs retain their positions. Add road repairs and braking
wear only as presentation overlays. Use the same sweep, disposal and High frame-budget gates as Bosphorus above.
