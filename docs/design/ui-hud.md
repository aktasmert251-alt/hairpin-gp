# UI and HUD: functional specification

> Owner: Planner. Implementers: **Grafik-UI** (`src/ui/**`), **Yönetici** (`src/game/hud/HudPresenter.ts`, notification queue, `notify` i18n namespace, input contexts).
> **Function only.** Every visual decision (colours, fonts, sizes, boxes, motion curves) lives in `docs/design/DESIGN.md` (§5 layout, §6 components, §7 motion, §8 copy). Binding decisions: `docs/sprints/DECISIONS.md` D-001…D-010.
> Contracts: `hud.ts` (`HudModel`), `ui.ts`, `settings.ts`, `input.ts`; pending additions CR-03, CR-05, CR-07, CR-11 (ARCHITECTURE §14).

## 1. Update model
- HudPresenter (YÖN) builds one long-lived `HudModel` at **30 Hz** of wall time and calls `ui.updateHud(model)`. The UI writes `textContent` only when the formatted string changes, bars via `scaleX`, LEDs via `data-on` (DESIGN §7.7).
- Discrete events (sector flash, tower Flip, banner in/out, start lights, MFD/flashback open) are driven by **model diffs** inside `updateHud` plus the bus events listed per widget. HUD numbers are never tweened.
- `HudModel.visible` (`full` | `minimal` | `off`) comes from `settings.hud.mode`, cycled by `H` (`hudCycle`) → `hud:mode` event. Mode content: DESIGN §5.1.
- Effective scale `k = settings.hud.scale` (default 1.0; 1.1 when `innerHeight < 900` and the user never set it, D-004). When `k > 1.1` the tower auto-collapses (D-005).
- Formatting lives only in `src/ui/format.ts`: `lap(ms) → "1:24.567"`, `sector(ms) → "28.415"`, `gap(ms) → "+1.234"`, `lapsDown(n) → "+1 TUR"/"+1 LAP"`, `delta(ms) → "−0.214"` (U+2212, D-007), `speed(kmh, units)`, `temp(c)`, `pct(x)`, `upper(text, lang)`.

## 2. HUD widgets

| Widget | `HudModel` fields | Rate | States | Notes |
|---|---|---|---|---|
| **Tower** (race only) | `tower[]` (`pos, code, teamColor, gapMs, lapsDown, compound, inPit, penaltySec, isPlayer, fastest, drs, status`), `towerExpanded`, `gapMode` | 30 Hz text; Flip on `position` events (≤ 1 Flip per 250 ms, batched) | expanded (20 rows) · collapsed (P1–P3 + player ±2, or P1–P8 when player is top 5) · auto-collapsed at k > 1.1 · minimal (ahead/you/behind) | `teamColor` = `colors.ui ?? colors.primary` (D-001). Gap text: leader row shows `LİDER`/`LEADER` in leader mode or `—` in interval mode; `gapMs` interval or to leader per `gapMode`; `lapsDown > 0` shows `+n TUR`. Badges: `PİT` when `inPit`, `+5s` when `penaltySec > 0` (unserved), fastest-lap mark, DNF row greyed at the bottom. No lap counter in the header (D-006) |
| **TT panel** (time trial, replaces tower) | `timing.bestLapMs`, local PB (from `tt` store), `notifications` | on change | no PB yet (empty state `—:——.———`) · PB set | shows ghost mode (`KİŞİSEL EN İYİ` / `RAKİP` / `KAPALI`) and last 5 laps with valid ✓/✗ |
| **Timing panel** | `lap`, `position`, `timing.*` | 30 Hz | normal · invalid lap (`timing.invalid` → current time struck, `GEÇERSİZ`) · pit · finished | Only place with the lap counter (D-006): `TUR x/y` (TT: `TUR x`). `P x/20` hidden in TT. Delta chip from `timing.deltaMs` vs `deltaRef` (CR-05: `pb` in TT, `best` in race, `rival`); hidden when null. Sector bars: completed sectors coloured by status (`purple`/`green`/`yellow`, `none` = neutral for invalid laps); flash on change (sector event) |
| **Start lights** | `startLights.visible/lit/out` | 30 Hz + `lightsOn`/`lightsOut` events | hidden · lighting 1–5 · out (all off same frame, housing exits after 800 ms) | Timing never reduced by motion settings |
| **Banners** | `notifications[]` | on model diff | ≤ 2 visible, newest on top; queue | §3 rules |
| **Wheel module** | `car.kmh, gear, rpm, rpmMax, shiftLeds, shiftNow, limiter, pitLimiter, drs, ers, brakeBias, throttle, brake` | 30 Hz | normal · shift-now (LEDs flash 8 Hz; steady under reduced motion) · limiter · pit limiter (`PİT` chip on) | Gear `N` for 0, `R` for −1. Units by `settings.hud.units`. DRS chip: `off` hidden · `unavailable` outlined dim · `available` lit · `open` filled · `disabled` struck. ERS bar = `ers.soc`, lap budget marker = `ers.lapUsed`, mode label; `overtake` highlights while F held. Brake bias as `57,5` (locale decimal) |
| **Shift LED rule** (presenter) | – | – | – | `shiftLeds = round(15·clamp((rpm − 10,000)/1,800, 0, 1))`; `shiftNow = rpm ≥ 11,800` (auto-gearbox up-shift point); `limiter = vehicle.limiterHit` |
| **Minimap** | `minimap.x/z` (car positions, world), `teamColor[]`, `player`, `inPit` | 30 Hz, canvas 2D | full only (hidden in minimal) | Track outline pre-rendered once from `TrackData` into an offscreen canvas; fixed north-up orientation (never rotates), S/F marked. Player dot larger with outline; cars in pit drawn inside the pit lane path at 50 % alpha. Disabled when `settings.hud.minimap` false |
| **Tyre widget** | `car.tyre.compound, ageLaps, wear[4], tempC[4], state[4]` | 30 Hz | per-tyre `cold`/`ok`/`hot`; wear bands | Presenter rule: `cold` if surface °C < tOpt − window, `hot` if > tOpt + window; wear shown as % remaining `round((1 − wear)·100)` |
| **Weather strip** | `weather.rain, wetness, airC, trackC` | 2 Hz | dry · damp · wet · raining | Wetness class: `< 0.1` KURU, `< 0.35` NEMLİ, `< 0.65` ISLAK, else ÇOK ISLAK; rain icon when `rain > 0.05` |
| **Flags** | `flags.yellow[3], blue, chequered, blackWhite` | on change | – | Rendered as banners (§3) plus a small flag chip in the timing panel for an active yellow in the player's current sector. Marshal panels in 3D come from `RenderFrame.yellowSectors` |
| **Pit panel** | `pit` (CR-05) | 30 Hz while non-null | approaching (box requested) · in lane (limit, speeding warning) · stationary (service countdown) · release | Shown inside the wheel module area as a chip row: `PİT 80`, box distance, service seconds |
| **MFD** | `mfd.*` | on change | closed · open(page) | §4 |
| **Flashback** | `flashback.*` | 30 Hz while open | closed · scrubbing · no flashbacks left | §5 |
| **Debug/FPS** | `__APEX__.getPerf()` | 4 Hz | F8 or `settings.graphics.showFps` | Owned by YÖN (`src/core/debug`), not part of HudModel |

**HUD by mode** (`full` / `minimal` / `off`): per DESIGN §5.1. Start lights always show in `full` and `minimal`; in `off` only the 3D gantry shows them. MFD and flashback open in every mode.

## 3. Notifications

### 3.1 Rules
- Sources: HudPresenter turns sim events and state checks into `notify` bus events; any glue code may emit `notify`. HudPresenter owns the queue and exposes it as `HudModel.notifications` (with `ms`, `priority`, CR-05).
- **Coalescing (D-002):** a repeated `key` reuses the existing entry's `id`, updates params and restarts its timer; the UI updates that banner in place.
- Visible ≤ 2 (DESIGN §6.7). Queue ≤ 4 waiting. When full, the lowest-priority, oldest waiting entry is dropped. A priority-3 entry is shown immediately, displacing the lower-priority visible banner (which re-queues if time remains).
- Lifetime `ms`: defaults info 3,000, warn and penalty 4,500 (DESIGN §6.7); table values below override.
- Player-only unless stated; AI events never create banners except fastest lap, flags and chequered.

### 3.2 Catalogue (`notify` namespace; title / detail)

| Key | TR | EN | Level | Prio | ms | Trigger |
|---|---|---|---|---|---|---|
| `notify.start.jumpStart` | ERKEN KALKIŞ / chip `+5 SN` | JUMP START / `+5 SEC` | penalty | 3 | 4,500 | `jumpStart` (player) |
| `notify.limits.warning` | PİST SINIRLARI {n}/3 / T{corner} | TRACK LIMITS {n}/3 / T{corner} | warn | 2 | 4,500 | `trackLimits` with count 1–3 |
| `notify.limits.blackWhite` | SİYAH-BEYAZ BAYRAK / BİR SONRAKİ İHLAL CEZA | BLACK AND WHITE FLAG / NEXT OFFENCE PENALISED | warn | 2 | 4,500 | 3rd strike |
| `notify.penalty.trackLimits` | CEZA · PİST SINIRLARI / `+5 SN` | PENALTY · TRACK LIMITS / `+5 SEC` | penalty | 3 | 4,500 | `penalty` reason `trackLimits` |
| `notify.penalty.cornerCut` | CEZA · VİRAJ KESME / `+5 SN` | PENALTY · CORNER CUTTING / `+5 SEC` | penalty | 3 | 4,500 | reason `cornerCut` |
| `notify.penalty.pitSpeeding` | CEZA · PİTTE HIZ İHLALİ / `+5 SN` | PENALTY · PIT LANE SPEEDING / `+5 SEC` | penalty | 3 | 4,500 | reason `pitSpeeding` |
| `notify.penalty.twoCompound` | CEZA · İKİ HAMUR KURALI / `+30 SN` | PENALTY · TWO-COMPOUND RULE / `+30 SEC` | penalty | 3 | 6,000 | at the player's finish |
| `notify.penalty.served` | CEZA ÇEKİLDİ / {s} SN | PENALTY SERVED / {s} SEC | info | 1 | 3,000 | `penaltyServed` (CR-06) |
| `notify.penalty.pending` | PİTTE ÇEKİLECEK CEZA / {s} SN | PENALTY TO SERVE / {s} SEC | warn | 2 | 4,500 | box requested while `penaltyToServeSec > 0` |
| `notify.lap.invalid` | GEÇERSİZ TUR / {reason} | LAP INVALID / {reason} | warn | 2 | 3,000 | `lapInvalidated` (CR-06); reason keys `notify.reason.{trackLimits,cornerCut,flashback,reset}` |
| `notify.lap.personalBest` | KİŞİSEL EN İYİ / {time} · {delta} | PERSONAL BEST / {time} · {delta} | good (green) | 1 | 3,000 | player `lap` valid and < own best |
| `notify.lap.fastest` | EN HIZLI TUR / {code} · {time} | FASTEST LAP / {code} · {time} | good (purple) | 1 | 3,000 | `fastestLap` (any car, race) |
| `notify.lap.final` | SON TUR | FINAL LAP | info | 1 | 3,000 | player starts the last lap |
| `notify.flag.yellow` | SARI BAYRAK / SEKTÖR {n} | YELLOW FLAG / SECTOR {n} | warn | 2 | 3,000 | `flag` yellow in the player's current or next sector |
| `notify.flag.blue` | MAVİ BAYRAK / ARKADAN GELEN: {code} | BLUE FLAG / CAR BEHIND: {code} | warn | 2 | 3,000 | `flag` blue for the player |
| `notify.flag.chequered` | DAMALI BAYRAK | CHEQUERED FLAG | info | 2 | 3,000 | leader finishes |
| `notify.drs.enabled` / `notify.drs.disabled` | DRS ETKİN / DRS DEVRE DIŞI | DRS ENABLED / DRS DISABLED | info | 0 | 2,500 | `drsEnabled` / `drsDisabled` |
| `notify.weather.rainSoon` | YAĞMUR {min} DK İÇİNDE / %{p} OLASILIK | RAIN IN {min} MIN / {p}% CHANCE | info | 1 | 4,500 | `weather` msg `rainSoon` |
| `notify.weather.rainStarted` | YAĞMUR BAŞLADI | RAIN STARTED | info | 1 | 3,000 | msg `rainStarted` |
| `notify.weather.drying` | PİST KURUYOR | TRACK DRYING | info | 1 | 3,000 | msg `drying` |
| `notify.weather.intersNow` | PİTE GİR / ARA LASTİK | BOX FOR INTERS | warn | 2 | 4,500 | msg `intersNow` and player on slicks |
| `notify.weather.wetsNow` | PİTE GİR / YAĞMUR LASTİĞİ | BOX FOR WETS | warn | 2 | 4,500 | msg `wetsNow` and player not on wets |
| `notify.weather.slicksNow` | PİTE GİR / KURU LASTİK | BOX FOR SLICKS | warn | 2 | 4,500 | msg `slicksNow` and player on inters/wets |
| `notify.pit.requested` / `notify.pit.cancelled` | PİT TALEBİ / {compound} · PİT TALEBİ İPTAL | BOX REQUESTED / {compound} · BOX CANCELLED | info | 1 | 2,500 | MFD strategy option 1 |
| `notify.pit.limiter` | PİT LİMİTÖRÜ | PIT LIMITER | warn | 3 | 1,500 (re-emitted while the condition holds) | in pit lane before the limit line with limiter off (pit assist off) |
| `notify.pit.stopTime` | PİT DURUŞU / {s} SN | PIT STOP / {s} SEC | info | 1 | 3,000 | leaving `stationary` |
| `notify.car.reset` | ARAÇ PİSTE ALINDI | CAR RESET TO TRACK | info | 1 | 2,500 | `carReset` (player) |
| `notify.flashback.used` | GERİ SARILDI / KALAN {n} | FLASHBACK USED / {n} LEFT | info | 1 | 2,500 | `flashback:applied` (`∞` when unlimited) |
| `notify.flashback.none` | GERİ SARMA HAKKI YOK | NO FLASHBACKS LEFT | warn | 1 | 2,500 | R pressed with 0 left or when unavailable |
| `notify.racingLine.mode` | YARIŞ ÇİZGİSİ: {mode} | RACING LINE: {mode} | info | 0 | 1,500 | `racingLine:mode` |
| `notify.settings.modifierRefused` | CTRL, ALT VE META ATANAMAZ | CTRL, ALT AND META CANNOT BE BOUND | warn | 2 | 3,000 | rebind refused (menus) |
| `notify.error.runtime` | BİR HATA OLUŞTU / OYUN DEVAM EDİYOR | SOMETHING WENT WRONG / GAME CONTINUES | warn | 3 | 6,000 | uncaught error in a session (planner-report §3.12) |

## 4. MFD (Tab)

- `Tab` (`mfdNext`): closed → STRATEJİ → ERS → FREN → HAVA → LASTİK → closed (DESIGN §6.9). In Time Trial STRATEJİ is skipped. Emits `mfd:changed`.
- `1`–`4` (`mfd1`…`mfd4`) act only on the open page; when closed they do nothing. Driving input continues while the MFD is open.
- Auto-close after 8 s without MFD input. Every option press restarts the timer and emits `ui:sound` `toggle` (CR-11).
- Choices go to a glue-side `PlayerStrategy` store and reach the sim through `DriverControls` (CR-03), latched every tick, so replays and flashback stay deterministic.

| Page (`mfd.page`) | Shows | 1 | 2 | 3 | 4 |
|---|---|---|---|---|---|
| `strategy` STRATEJİ | next compound, box state, pit loss `mfd.pitLossS`, predicted rejoin `mfd.rejoinPos`, penalty to serve, two-compound status ✓/✗ | PİTE GİR toggle (`boxRequest`) | next compound: cycles S → M → H → I → W | gap mode interval ⇄ leader | tower expanded ⇄ collapsed |
| `ers` ERS | `ers.soc`, lap budget used, mode | KAPALI (`none`) | ORTA (`medium`) | HIZLI TUR (`hotlap`) | OTOMATİK (`auto`, ERS assist) |
| `brakes` FREN | bias % | −0.5 % | +0.5 % | default 57.5 % | – |
| `weather` HAVA | `mfd.forecast` cells: +5, +10, +15, +30 min (rain %, probability %) | – | – | – | – |
| `tyres` LASTİK | per tyre wear %, surface °C, state; compound; age (laps); compounds used | – | – | – | – |

- Brake bias range 50.0–70.0 %. Picking 1–3 on the ERS page turns ERS auto off for this session; 4 turns it back on.
- Suggested next compound (presenter; pre-selected each time the box is requested): `wetness ≥ 0.62` → W; else `wetness ≥ 0.12` → I; else by laps left: ≤ 12 → S, ≤ 25 → M, else H. When the two-compound rule applies and only one dry compound has been used, suggest the other dry compound.

## 5. Flashback UI
- **Open:** `R` (`flashback`) while driving, race phase `running`, `flashbacksLeft ≠ 0`, at least 1 s of history, player not finished. Otherwise `notify.flashback.none`. On open: sim pauses, input context `flashback`, `flashback:open`, audio rewind state (audio.md §7).
- **Range:** offset ∈ [−maxSec, 0] with `maxSec = min(15, history span)`. The timeline opens at `−min(3, maxSec)` s.
- **Scrub:** `←`/`A` back, `→`/`D` forward. A tap moves 0.5 s; holding moves 5 s per second after a 250 ms delay. Granularity 0.1 s (10 Hz snapshots). The world shows the restored frame while scrubbing (preview restore, no stepping).
- **Apply:** `Enter`, `Space` or `R` → `flashback:applied`, `flashbacksLeft − 1` (unless unlimited); resume with time scale ramping 0.25 → 1 over 0.8 s (wall-clock pacing only; sim results unaffected). In Time Trial the lap becomes invalid (`lapInvalidated`, reason `flashback`).
- **Cancel:** `Esc` or `Backspace` → the "now" snapshot is restored, `flashback:cancel`, nothing consumed.
- **Display** (`HudModel.flashback`): `offsetSec`, `maxSec`, `left` (−1 shows `∞`). Visual: DESIGN §6.10.

## 6. Screens

Navigation (DESIGN §7.6): arrows or WASD move, Enter/Space confirm, Esc/Backspace back, Home/End jump. Lists do not wrap; steppers over unordered sets wrap. The first item is focused on entry; the last focused index is restored on back. Every interactive element has a stable `data-focus-id` (E2E reads it via CR-07). Transitions: DESIGN §7.3; under reduced motion only opacity ≤ 120 ms.

| Screen | Purpose | Fields / items (defaults) | Keys | Entry → exit |
|---|---|---|---|---|
| intro (part of `title`) | logo animation ≤ 2.5 s | – | any key skips | first boot of the page → title prompt |
| `title` | press any key; unlocks audio | wordmark, prompt, version | any non-modifier key → `audio.unlock()` | boot → `mainMenu` |
| `mainMenu` | hub | ZAMANA KARŞI, HIZLI YARIŞ, AYARLAR, JENERİK; info card (track facts, PB with sectors or empty state) | ↑/↓, Enter; Esc does nothing | from title, results, ttResults, sub-screens |
| `ttSetup` | configure Time Trial | team livery (10, perf 0 for all), tyre S/M/H (S), time of day (day), weather KURU/HAFİF/YOĞUN (dry; no variable), ghost KİŞİSEL EN İYİ/RAKİP/KAPALI (pb); CTA PİSTE ÇIK | ↑/↓ rows, ←/→ values, Enter on CTA → `startTimeTrial` | mainMenu → loading |
| `raceConditions` (step 1) | conditions | time of day (day), weather KURU/HAFİF YAĞMUR/YOĞUN YAĞMUR/DEĞİŞKEN (dry), laps 3/5/10/15/29 (5) | ↑/↓, ←/→, Enter next | mainMenu → teamSelect; prefilled from `apexgp:v1:lastRaceSetup` |
| `teamSelect` (step 2) | team and driver | 5 × 2 team tiles (Anka Racing first), then driver 1 / 2 | arrows in the grid; Enter → driver choice (←/→, Enter) | → raceSettings |
| `raceSettings` (step 3) | race parameters | opponents 0–19 (19), difficulty 0–110 step 5 (`gameplay.difficulty`), grid slot 1–20 / RASTGELE (RASTGELE), start tyre OTOMATİK/S/M/H/I/W (OTOMATİK), flashbacks 0/3/5/∞ (`gameplay.flashbacks`), two-compound rule (read-only: active for dry or variable weather with ≥ 10 laps, rules.md §8) | as above | → assists |
| `assists` (step 4) | assists for this race | preset BAŞLANGIÇ/ORTA/UZMAN/ÖZEL + the 10 `AssistSettings` rows (§7); CTA YARIŞA BAŞLA | editing a row sets ÖZEL | → loading (`startRace`) |
| `loading` | build the session | summary, tip rotating every 6 s (≥ 12 tips `loading.tips.*`), progress from the `loading` store | none | → session; failure → mainMenu + error banner |
| `pause` | in-session menu | DEVAM ET, YENİDEN BAŞLAT, (TT) TURU YENİDEN BAŞLAT, AYARLAR, (race) YARIŞTAN ÇEKİL, MENÜYE DÖN; session card | Esc/P resume; destructive items open a confirm (EVET/HAYIR, HAYIR focused) | from Esc/P, window blur, tab hidden; quit → mainMenu (race) or ttResults (TT); retire → results (projected, rules.md §9) |
| `settings` | all settings (§7) | tabs GRAFİK, SES, KONTROLLER, YARDIMLAR, HUD, DİL, ARAYÜZ | ↑/↓, →/Enter into a tab, ←/Esc out | from mainMenu or pause, back returns there |
| `results` | classification | 20 rows (rules.md §8): pos, team strip, driver, laps/time/gap, best lap (fastest marked), stops, penalty, points, status; YENİDEN BAŞLAT, MENÜYE DÖN | ↑/↓ scroll, Enter | 4 s after the player finishes (TV camera) or on retire → loading (restart) or mainMenu |
| `ttResults` | Time Trial summary | PB banner, laps (n, time, S1–S3 by status, valid), local top-10 | ↑/↓, Enter | quit from TT → mainMenu |
| `credits` | licences | OFL, CC0, OSM/ODbL, EU-DEM, GSAP licence lines verbatim | ↑/↓ scroll 120 px, Esc | mainMenu ⇄ |

Time Trial: `Backspace` (`restartLap`) restarts at s = L − 200 m with a 200 km/h flying start, no confirmation.

## 7. Settings catalogue

"Live" = applied immediately (`settings:changed`); "next" = applied at the next session start.

| Tab | Setting (path) | Control | Values | Default | Apply |
|---|---|---|---|---|---|
| GRAFİK | `graphics.preset` | select | DÜŞÜK/ORTA/YÜKSEK/ULTRA/ÖZEL | YÜKSEK | live |
| GRAFİK | custom `renderScale` | slider | 0.50–1.00 step 0.05 | preset | live |
| GRAFİK | custom `aa` + `smaa` | select | FXAA / SMAA ORTA / YÜKSEK / ULTRA | preset | live |
| GRAFİK | custom `shadowSize` | select | 1024 / 2048 / 4096 | preset | live |
| GRAFİK | custom `ao` | select | KAPALI / YARIM / TAM | preset | live |
| GRAFİK | custom `bloom` | toggle | – | preset | live |
| GRAFİK | custom `mirrors` | select | STATİK / 30 Hz / 60 Hz | preset | live |
| GRAFİK | custom `treeDensity`, `crowdDensity` | slider | 0.2–1.3 / 0.2–1.0 step 0.1 | preset | next |
| GRAFİK | `graphics.fovOffset` | slider | −10…+10° | 0 | live |
| GRAFİK | `graphics.cameraShake` | slider | 0–100 % step 10 | 60 % | live |
| GRAFİK | `graphics.motionEffects` | toggle | speed FOV, CA, head motion | on | live |
| GRAFİK | `graphics.showFps` | toggle | – | off | live |
| GRAFİK | `camera.default` | select | KOKPİT / T-KAMERA / BURUN / YAKIN TAKİP / UZAK TAKİP | YAKIN TAKİP | next |
| SES | `audio.master/engine/sfx/ambience/ui` | slider | 0–100 % step 5 | 80/90/80/60/60 | live |
| KONTROLLER | `controls.layout` | select | BİRLEŞİK / WASD / OKLAR | BİRLEŞİK | live |
| KONTROLLER | `controls.steerSensitivity` | slider | 0.50–1.50 step 0.05 | 1.00 | live |
| KONTROLLER | `controls.bindings.<action>` | 2 key chips | Enter → `TUŞA BAS…`; Esc cancels; `Delete` clears slot 2; Ctrl/Alt/Meta refused | ARCHITECTURE §10.2 | live |
| KONTROLLER | reset bindings | button + confirm | – | – | live |
| YARDIMLAR | assist preset | select | BAŞLANGIÇ / ORTA / UZMAN / ÖZEL | ORTA | next |
| YARDIMLAR | `assists.steering/abs/pit/ers/drs/kbBrakeLimiter` | toggle | – | on/on/on/on/off/on | next |
| YARDIMLAR | `assists.braking` | select | KAPALI / DÜŞÜK / ORTA / YÜKSEK | KAPALI | next |
| YARDIMLAR | `assists.tc` | select | KAPALI / ORTA / TAM | ORTA | next |
| YARDIMLAR | `assists.gearbox` | select | OTOMATİK / MANUEL | OTOMATİK | next |
| YARDIMLAR | `assists.racingLine` | select | KAPALI / VİRAJLAR / TAM | VİRAJLAR | live (also `Y`) |
| YARDIMLAR | `gameplay.difficulty`, `gameplay.flashbacks` | slider / select | 0–110 step 5 / 0,3,5,∞ | 70 / 5 | next |
| HUD | `hud.mode` | select | TAM / SADE / KAPALI | TAM | live (also `H`) |
| HUD | `hud.minimap` | toggle | – | on | live |
| HUD | `hud.units` | select | KM/SA / MPH | KM/SA | live |
| HUD | `hud.scale` | slider | 0.80–1.25 step 0.05 | 1.00; 1.10 below 900 px height (D-004) | live |
| DİL | `lang` | select | TÜRKÇE / ENGLISH | TÜRKÇE | live |
| ARAYÜZ | `ui.animations` | select | OTOMATİK / AÇIK / KAPALI | OTOMATİK | live |

Changing any custom graphics field sets `graphics.preset = 'custom'`. Assist changes from the pause menu apply at the next session (session config is immutable for determinism); the row shows `BİR SONRAKİ OTURUMDA` / `FROM NEXT SESSION`.

## 8. Input contexts

| Context | Active actions |
|---|---|
| `menu` | menuUp/Down/Left/Right, menuConfirm, menuBack (any key on `title`) |
| `driving` | driving actions, cameraNext, lookBack, flashback, pause, mfdNext, mfd1–4, racingLine, hudCycle, restartLap (TT), debugOverlay |
| `flashback` | menuLeft/Right (scrub), menuConfirm or flashback (apply), menuBack (cancel) |
| `rebind` | next key press captured; Escape cancels |

Shared codes (W/S/A/D, arrows, Space, Escape, Backspace) resolve by context, never both at once.

## 9. Accessibility
- **Reduced motion:** effective reduced = `ui.animations === 'off'`, or `'auto'` with `prefers-reduced-motion: reduce` (DESIGN §7.5): no translation, Flip or stagger; opacity fades ≤ 120 ms; steady LEDs and banners; static showroom. A first run under reduced motion also sets `cameraShake 0` and `motionEffects off`. Start-light timing never changes.
- **Focus:** always visible (DESIGN apex notch); one focused element per screen; never lost after a transition; no traps; confirm dialogs keep focus inside and return it on close.
- **Contrast:** body text ≥ 4.5:1; large numerals and team strips ≥ 3:1 (DESIGN §2.4, D-001); colour-vision check in Sprint 4 (D-010).
- **Colour is never the only carrier:** sector status also shows in the delta sign and banners; compounds always print S/M/H/I/W; flags carry text; team strips sit beside 3-letter codes; DRS states differ in shape.
- **Flashing:** only the LED strip flashes, ≤ 8 Hz, off under reduced motion.
- **Semantics:** banner region `role="status"`, `aria-live="polite"` (penalties `assertive`); menus are lists of buttons with `aria-current`; `<html lang>` follows the language; team names `lang="en"` (D-008); driver names `lang` from `DriverDef.nat`.
- **Scale:** `hud.scale` 0.80–1.25 stays overlap-free (D-005).

## 10. Copy guidelines (TR/EN)
- Tone and glossary: DESIGN §8.2–§8.3. TR is the source; EN mirrors meaning, not word order.
- HUD labels: uppercase nouns, no exclamation marks, no "lütfen", no emoji. Body copy (tips, descriptions): sentence case, ≤ 2 lines, second person singular.
- Limits: banner title ≤ 22 characters, detail ≤ 32, menu item ≤ 18, tip ≤ 140; EN ≤ TR + 20 %; check both languages at 1280 × 720 and 1920 × 1080.
- **Casing:** store sentence/proper case; upper-case through CSS under the right `lang` or `format.upper()` with `toLocaleUpperCase('tr-TR')` (`i → İ`, `ı → I`). Exceptions: track names pre-composed per language (`İSTANBUL CIRCUIT` / `ISTANBUL CIRCUIT`, D-003); team names never Turkish-cased (D-008); sponsor strings pre-composed (DESIGN §1.4.3).
- **Numbers:** tabular figures; times `m:ss.mmm` with a full stop in both languages; other decimals per locale (TR `57,5`); minus U+2212; arrows as SVG (D-007); TR `%20`, EN `20%`; units `km/sa`/`km/h`, `SN`/`SEC`, `DK`/`MIN`.
- **IP:** never "F1", "Formula 1", real teams, drivers, sponsors or logos.
- Every string through `t()`; identical `{param}` names in TR and EN; namespaces per ARCHITECTURE §10.3.
