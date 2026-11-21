# APEX GP: Online multiplayer (v1) design

> Owner: Planner. Status: **proposal, waiting for user answers (§16)**. Precedence as ARCHITECTURE.md (header). Nothing here changes `src/contracts/` by itself; contract changes are listed in §13 for the Lead.
> Scope: real-time online races between friends, **without rebuilding the game**. The engine, graphics, physics, controls and UI stay as they are; multiplayer is added as one more session mode next to Race and Time Trial.
> Honesty rule: every capacity number here is a **target to measure**, not a verified fact. Nothing has run on the server host yet. Binding user decisions: **free only**, **host = Oracle Cloud Always Free VM**, **real car-to-car contact in v1**. Unverified items are marked **[UNVERIFIED]**.

---

## 0. Answers in one page (the ten questions)

| # | Question | Short answer (details in §) |
|---|---|---|
| 1 | Technologies | TypeScript 6, Vite 8, three.js r186 + postprocessing + n8ao, GSAP (UI), WebAudio, DOM UI, Vitest + Playwright; no backend today. (§1) |
| 2 | Physics today | Deterministic fixed-step 240 Hz pure-TS sim (`createSim`): every car is fully simulated on the client (tyres, powertrain/ERS, aero, OBB collisions, race director). Rendering interpolates. (§2) |
| 3 | Files to change | About 20, all surgical: contracts, `createSim`, `session`, `loop`, `main`, `race/director`, `ai/aiSystem`, vehicle and collision systems, HUD presenter, results, launch params, debug API, menu/pause UI, i18n. (§9) |
| 4 | New modules | `contracts/net.ts`, `src/net/*`, `game/net/onlineSession.ts`, `physics/remote/{puppet,contact}.ts`, `ui/screens/{online,lobby}.ts`, `server/`, `tests/net/`. (§9) |
| 5 | Shared code | `src/net/protocol.ts`, the track registry + `TrackQuery`, `race/rules.ts`, `core/rng.ts`: all pure TS already. (§8) |
| 6 | Lightest server | One Node.js LTS process + `ws`, all rooms in RAM, no DB, no Docker. It serves the static game **and** `/ws` on one HTTPS port. It ships as one bundled `.mjs` and runs under systemd on an **Oracle Always Free ARM VM** (free). The Unisign/Termux path is kept as an optional appendix. (§10, §11) |
| 7 | Integration without breaking the game | Online is a separate session mode behind a new menu item. Remote cars are **puppets**: a new `control: 'remote'` value that the AI and vehicle systems skip, and the collision system treats as a kinematic partner. Offline paths stay byte-identical: the determinism hash tests and the contract baseline guard that. (§5, §12) |
| 8 | Where server authority is needed | Room membership, the start time (T0), the grid, lap counting and lap times, jump starts, the finish order and the results, disconnect/DNF, and validation of every state message (speed, teleport, track position). Clients own their own car's physics only. (§7) |
| 9 | Collisions and race rules | **Real contact in v1:** each client detects contact of its own car against latency-compensated (extrapolated) puppets and applies its half of the impulse. The server validates/clamps a `contact` message and relays it, so the other car gets the matching impulse; contacts soften with latency. Laps, times and jump starts are recomputed by the server; track-limit penalties are client-reported in v1. (§6) |
| 10 | Moving the server later | Single file + env config + `deploy.ps1`: re-run it against the new host and repoint DuckDNS; clients use their page origin. Later the pure-TS sim can run server-side (v2). (§15) |

---

## 1. What the game is built on (verified in the code)

- Versions: three 0.186.1, postprocessing 6.39.5, n8ao 2.0.1, gsap 3.15.0, TypeScript 6.0.3, Vite 8.3.2, Vitest 5, Playwright 1.63, Node 24 (dev PC).
- The **Sim** layer (`physics/ ai/ race/ game/sim/ track/{data,build,query}/ core/{math,rng}/ data/`) is pure TS with no three, no DOM and no `Math.random`/`Date.now`, so Node can import it unchanged.
- Static SPA `dist/` is ≈ 12 MB without source maps. There is no AudioWorklet, so a LAN page over plain `http://` works.

## 2. How the physics and vehicle movement work now

- **Loop** (`src/core/loop.ts`): `renderer.setAnimationLoop` → an accumulator → at most 12 fixed ticks of `SIM_DT = 1/240 s` per frame. When the cap is hit, the backlog is dropped and the game slows down. Rendering interpolates prev/current poses with `alpha` (`src/game/renderFrame.ts`).
- **World** (`src/game/createSim.ts`): `SimState { tick, time, cars[], race, conditions, rng }`. The player is always **car 0** (`PLAYER_CAR_ID`). The lineup is player + `aiCount` AI cars, picked by a seeded shuffle. Grid slots come from `track.data.grid`.
- **Systems per tick:** Conditions → PlayerInput (only `control==='player'`) → AI (every car with `control !== 'player'`) → Vehicle (**all cars**) → Collision (**all cars**: walls, car pairs with `CAR_J_MAX` 30 kN·s, resets with a 3 s ghost) → RaceDirector + Pit → Snapshot.
- Pose fields: `vehicle.{x,y,z,yaw,vx,vz,yawRate,speed,s,d,lapWraps,hint}`, with `progress = lapWraps·L + s`. The director treats > 50 m per tick as a teleport.
- Measured car envelope (physics benches): top speed 322–332 km/h with ERS, +9–15 km/h with DRS, plus slipstream. **Hard ceiling for validation: 105 m/s (378 km/h).**
- Weather: `generateWeatherTimeline(seed)` is deterministic. Line drying depends on traffic (all cars, puppets included), so it can drift slightly between clients (§6.4).

---

## 3. Architecture overview

```
Browser (full game: own car simulated, others = puppets) ⇄ WSS 20 Hz ⇄ one Node process
(static dist/ + /health + /ws; rooms ×2 ≤ 4; validation + lap timing via TrackQuery) ⇄ other browsers
```

- **Client-server only** (no P2P). Each client simulates **only its own car**, at the existing 240 Hz, with the existing physics and controls. It sends a compact state at 20 Hz.
- The server relays states inside a room, owns the room/race lifecycle and recomputes timing from the stream. It never trusts a client-supplied lap, time or position without checks.
- No lockstep and no input replication: puppets are kinematic, so a desync is impossible by construction. Contact is resolved per client and synchronised by an impulse exchange (§6.2).

---

## 4. Room, lobby and race state machine (server-authoritative)

```
           create/join (code)                owner: start, all ready,      all 'loaded' or 30 s
 (none) ───────────────► LOBBY ──────────── n ≥ 1 (tests) / ≥ 2 ────────► LOADING ───────────────► COUNTDOWN
                          ▲  │ ready/unready, setCar, owner: settings              │ kick not-loaded → DNS
                          │  │                                                     │ T0 = now + 3000 ms
                          │  ▼ empty for 60 s → CLOSED                             ▼
                      RESULTS ◄──── all finished / DNF, or window ◄──── FINISHING ◄──── RACING (T0 reached)
                       │  'backToLobby' (ready flags reset)    expires (FINISH_WINDOW_MS)   first car takes the flag
                       └──► LOBBY      (room closes when everyone has left)
```

| State | Server holds | Allowed client messages |
|---|---|---|
| LOBBY | settings `{trackId, laps, tod, weather}`, players `{id, name, teamId, driverIdx, ready, connected, pingMs}`, ownerId | `setCar`, `setReady`, `setSettings` (owner), `start` (owner), `leave` |
| LOADING | `raceId`, the frozen config and roster, the grid | `loaded{trackHash}`, `leave` |
| COUNTDOWN / RACING / FINISHING | T0, per-player validator + timing state, standings | binary `state`, `report`, `retire`, `leave` |
| RESULTS | final classification | `backToLobby`, `leave` |

Rules:
- Room code: 5 characters from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (32⁵ ≈ 33 M codes). At most 5 failed joins per minute per IP.
- Limits (config constants): `MAX_ROOMS = 2`, `MAX_PLAYERS_PER_ROOM = 4`, `MAX_SOCKETS = 16` (unauthenticated sockets included). A socket that has not sent `hello` within 10 s is closed.
- Owner: the creator. If the owner leaves, ownership passes to the longest-connected remaining player. Car choice is unique per `(teamId, driverIdx)` (two seats per team, 10 teams).
- Grid: the server shuffles the slots with the room seed at LOADING and shows them in the lobby/loading screen. Slot k = `track.data.grid[k]`.
- The **3-2-1** the user asked for is shown on the client from T0−3 s to T0, synchronised by the clock offset (§5.3). At T0 the sim starts in its normal `grid` phase: 2 s grid hold, 5 red lights, then the seeded hold before lights out. Lights out lands at the same wall time on every client (± clock error).
- DNF: a disconnect not resumed within **60 s** during RACING (30 s in LOADING), a `retire`, or not finished when the finishing window ends.

---

## 5. Client integration

### 5.1 Online session config (what every client gets in `load`)

The server sends the **frozen race config**: `{raceId, trackId, laps, tod, weather, seed, roster[{playerId, name, teamId, driverIdx, gridSlot}], lightsOutAtMs}`. Each client builds its `SessionConfig` like this:
`mode 'race'`, `aiCount 0`, `flashbacks 0`, `mandatoryStop false`, `autodrive false` (true only when the room has the test flag `allowBots`), `trackId/laps/tod/weather/seed` from the server, and `assists`/`startCompound`/`steerSensitivity` from the local setup. Assists stay a personal choice, as offline.

Because the seed, track and weather preset are identical, every client generates the same weather timeline, the same lights-out hold and the same track. The server computes `lightsOutAtMs` from the same seed with a shared pure helper (CR-NET-6), so its jump-start check uses the client's number exactly.

**Lineup:** local player = car 0 (keeps `PLAYER_CAR_ID` and every presenter assumption intact). Remotes = cars 1..n−1 in roster order. `onlineSession` keeps a `playerId ↔ carId` map. `createSim` gets the lineup and grid slots through the new `CreateSimOptions.lineup` (CR-NET-1) instead of `buildLineup`/`assignGrid`.

### 5.2 Puppets (remote cars inside the local sim)

New value `SimCarState.control = 'remote'` (CR-NET-2). Per system:

| System / module | Behaviour for `control === 'remote'` | Owner |
|---|---|---|
| ConditionsSystem | unchanged (puppets count as traffic for line drying, which is good) | YÖN |
| PlayerInputSystem | unchanged (already only `'player'`) | SÜR |
| AISystem `src/ai/aiSystem.ts` | **skip** (today it drives every non-player car) | SÜR |
| VehicleSystem `stepCar` | **skip** integration. `updateSlipstream` still reads puppet poses, so the tow works behind a human | SÜR |
| CollisionSystem | `needsReset`/`resetCar`/`walls`: **skip**. Local–remote pairs: two-body impulse, applied to the local car only, soft separation, latency softening (§6.2); emits `collision` with the normal (CR-NET-8). Remote–remote pairs: skip | SÜR |
| RaceDirector `processCar` | remote branch: update `progress` and the 10 m markers (so gaps/tower work), then **return**. No limits, cut zones, pit, wrong-way, sector/lap events | YÖN |
| Pit procedure | not reached (inside `processCar`) | YÖN |
| Snapshot/flashback | flashback disabled online. The 10 Hz snapshot still runs (cheap, unchanged) | YÖN |
| renderFrame / carVisuals / audio / VFX | unchanged: they read the vehicle fields the puppet writer fills | — |

**Puppet writer** (glue, a new row in ARCHITECTURE §4.3; runs in `beforeTick` right after `rf.savePrev()`): for each remote car it samples the puppet buffer at local sim time `t`. Then it writes `x,y,z,yaw,vx,vz,yawRate,speed,vLong,vLat,steerAngle,rpm,gear,drs.flap,compound,pitLimiterOn` and `input.throttle/brake`. It calls `TrackQuery.ground(x,z,hint)` for `y`, the normal, `s`, `d` and the hint; sets `lapWraps = floor(progress/L)`; sets wheel `omega = speed/r` with the spin integrated, `susp = 0` and `slip = 0`. All of this is allocation-free.

**Interpolation/extrapolation** (`src/physics/remote/puppet.ts`, Sürüş; pure, unit-tested):
- Sample times are on the **shared race clock**: each state carries the sender's `simMs`, and every client's sim clock is slaved to the server clock (§5.3). So remote samples and local sim time live on one timeline.
- Default: **extrapolate to the present** (not render-in-the-past). At 80 m/s, a 100 ms interpolation delay would put the puppet 8 m behind where its driver sees it, which breaks close racing and contact. Method: cubic Hermite between the last two samples when `t` ≤ newest, a constant-curvature arc (v, yawRate) for up to **250 ms** past the newest sample, then hold (and mark the car "stale": semi-transparent, no contact, tower shows `!`).
- Correction: when a new sample disagrees with the extrapolated pose, blend the error out over 150 ms (position), or 100 ms (yaw). Snap when the error is > 15 m (reset/teleport) and call `rf.snapPrev(car)`.
- Acceptance (Testçi measures it with bots): extrapolation position error p95 ≤ 0.5 m on LAN (RTT ≤ 10 ms) and ≤ 1.5 m at RTT 100 ms, at 20 Hz.

### 5.3 Clock sync and start

- Binary ping/pong every 1 s in the lobby and every 2 s in a race. Offset = NTP-style estimate from the 8 most recent samples, taking the one with the lowest RTT (`src/net/clock.ts`, pure). Expected error: ≤ RTT/2 of the best sample (≈ 1–5 ms on LAN) **[to be measured]**.
- At T0 (server time) the client starts its sim. Before T0 the session is loaded and rendered with `isRunning() = false`.
- **Clock slaving** (new optional `LoopHooks.targetTicks?()`, CR-NET-7): online, ticks per frame = `round((serverNow − T0)/SIM_DT − state.tick)`, clamped to [0, 48]. A stalled or hidden tab therefore catches up, at about 0.18 s of sim per 60 fps frame, instead of drifting behind. `timeScale` is forced to 1, auto-pause is off, and `__APEX__.step/setTimeScale/teleport/setConditions/setAutodrive` are refused online.

### 5.4 What changes in online mode (user-visible)

- **Off:** AI opponents (`aiCount 0`; the server has no sim for them); **flashback** (`flashbacks 0`; it would rewind only your car); restart, restart lap and Time Trial; the mandatory two-compound stop (the server cannot verify it yet).
- **Pause (Esc/P)** opens an **overlay** (Resume, Settings, Retire → DNF, Leave race). The sim keeps running and your car gets neutral controls, because no one can stop a shared race.
- **Kept:** pits, MFD, ERS, DRS and tyres (your own sim); track-limit/cut penalties (client-computed, sent as `report`, §7.3); local replay recording.
- Results are the server's classification (§6.3). Car-to-car contact is **on** (§6.2).

---

## 6. Race rules and collision synchronisation

### 6.1 Timing and order (server-authoritative)
- From each validated state the server keeps `(simMs, progress, projected s)`. It counts a **lap** when `progress` crosses a multiple of `L` *and* the car has crossed `sectors[0]` and `sectors[1]` in order since its last lap (no shortcuts through the infield). Crossing time = linear interpolation of `simMs` between the two samples that bracket the line (≤ ~5 ms error at 20 Hz and constant speed) **[to be measured]**.
- Lap time = crossing − previous crossing. Race time = finish crossing − `lightsOutAtMs` + penalty seconds. The client's own lap event is only used for its HUD. If the client's lap time and the server's differ by more than 150 ms, the server logs a `timingMismatch` and uses its own number.
- Floor: a lap faster than `0.95 × the track's best known AI lap at d100` is rejected and logged. Values: İstanbul 84 s → 79.8 s, Lombardia 77.9 s → 74.0 s, Bosphorus 69.9 s → 66.4 s (DECISIONS D-042).
- Standings: the server sends `standings` at 2 Hz (order, laps, gaps). Clients keep the local tower live from puppet progress, and the presenter prefers the server order when it is < 1 s old.
- Finish: the first car to complete `laps` starts FINISHING (`FINISH_WINDOW_MS` 120 s). The server broadcasts `finishing`, and the glue writes `race.phase='finishing'` locally, so every car finishes at its next line crossing, as in rules §9.

### 6.2 Collisions: real-time contact between players (required in v1)
**Model: local detection against latency-compensated puppets + a symmetric impulse exchange through the server.**
1. **Detect locally.** Each client's CollisionSystem tests its own car against every puppet, extrapolated to the present (§5.2), with the existing SAT pair code.
2. **Respond locally, own car only.** The client computes the full two-body impulse `j` (both masses from `params`, the puppet velocity from its samples, the existing `CAR_E` 0.15 / `CAR_MU` 0.25) and applies **only the local car's half**: −j·n and its yaw term, plus its inverse-mass share of the separation. The puppet is never moved locally; its owner moves it.
3. **Exchange.** The client sends `contact` (0x11, §8.2) with `{other, simMs, j, n, point, vRelN}`. The server validates and clamps it (§7.2), then relays `contact` (0x91) to the other car's owner, who applies `+j·n` at `point` to **its own** car through a glue writer before the next tick (`applyContactImpulse`, Sürüş). Both cars feel one consistent hit.
4. **Dedup / merge.** A contact *episode* is the pair plus a 200 ms window. Each client applies at most one impulse per episode: whichever of its own detection or the relayed one comes first. If the later one is larger, it applies the difference (a top-up). It never applies both in full.
5. **Persistent overlap** (side by side, leaning): the separation is soft (30 % of the penetration per tick, capped at 0.5 m/s of push velocity), so neither car is launched. Sustained rubbing becomes friction, as offline.

**Latency handling** (`age` = local time − the puppet's newest sample time):

| age | Contact behaviour |
|---|---|
| ≤ 120 ms | full: restitution 0.15, impulse as computed |
| 120–250 ms | **soft**: impulse × `clamp(1 − (age−120)/130, 0.3, 1)`; overlap tolerance grows from 0.05 m to 0.4 m (overlap below the tolerance is ignored, which avoids phantom hits from extrapolation error) |
| > 250 ms (stale) or reconnecting | no contact; the puppet is drawn semi-transparent |

**Anti-abuse** (server, plus the same clamps on every receiving client): `j ≤ 15 kN·s` (≈ Δv ≤ 19 m/s at 800 kg; offline `CAR_J_MAX` is 30 kN·s); `j ≤ (1+e)·max(0,−vRelN)·m_red·1.5 + 500 N·s`, with `vRelN` recomputed from the server's own copies of both cars' states at `simMs`; the two cars' server poses must be within OBB overlap + `0.3 m + 0.15 s × closing speed`; at most 4 contacts/s per pair and 10/s per player. **No contact** during the 3 s reset ghost (`aux.ghostT`), in the first 2 s after a (re)connect or resume, before lights out + 1 s (the grid start), or while either car is lagging/stale. Rejected contacts are logged; 5 rejections in 10 s count as one strike (§7.2).

**Honest limits.** Under latency the two players see the hit at slightly different moments, so a hit can feel "early" or "late" by up to RTT/2. Shunts at > 150 ms RTT are deliberately softened. This is the standard trade-off without a server-side sim. Full contact fidelity (the server simulating every car from inputs) is the v2 path (§15).

**Test (P5, T13):** a 2-client harness with artificial latency **0 / 50 / 100 / 150 ms** (± 10 ms jitter, 1 % loss) injected by a test-only server option `--net-delay` (send queues per socket). Scripted scenarios use test-only `__APEX__` teleports, allowed only in `allowBots` rooms: side-swipe at 150 km/h, rear-end with Δv 30 km/h, a dive-bomb at a hairpin, and 5 s of side-by-side rubbing. Pass criteria: both clients register the episode (≥ 95 % at ≤ 100 ms, ≥ 85 % at 150 ms); each car's Δv is within ± 25 % of the offline two-body result; phantom contacts (applied while the server poses are > 0.5 m apart) ≤ 5 % at 100 ms; no overlap lasting > 300 ms; no |Δv| > 20 m/s; and a 0 % abuse pass rate for tampered `contact` messages (huge j, far away, during ghost).

### 6.3 Start, penalties and results
- Jump start: the server checks that `progress` moved by no more than `JUMP_START_M` (0.5 m) before `lightsOutAtMs + 100 ms`. Otherwise it applies `PENALTY_S` (5 s) and sends `penalty`.
- Client-reported penalties (track limits strikes, cut-zone, pit speeding) arrive as `report{kind,seconds}` and are added to the results. A client that never reports cannot be caught in v1 (stated limitation; friends only).
- Results rows reuse `ResultsModel` (name = the player's nickname). `points` use the same table as offline races.

### 6.4 Conditions
- Weather comes from the seed and is identical everywhere. `lineWetness` (traffic drying) can differ slightly per client. Accepted for v1. If a test shows visible grip differences, the server can broadcast `{rain, wetness, lineWetness}` at 1 Hz from the owner's client.

---

## 7. Server authority, validation and anti-cheat

### 7.1 Per-connection limits
- WebSocket `maxPayload` 1024 B. Binary `state` must be **exactly 40 B**; JSON control messages ≤ 1024 B, parsed with try/catch and a hand-written schema check (types, enum values, ranges, string lengths). Unknown types → `error{code:'badMessage'}`. 5 bad messages in 10 s → close 1008.
- Rate limits (token buckets): `state` 30/s, burst 10. Control 5/s, burst 10. Ping 4/s. Sustained > 2× the limit for 3 s → close.
- At most **8 sockets per IP** (friends behind one router share an IP over the internet) and 16 in total.
- Idle: protocol ping every 15 s; 2 missed pongs → terminate. No `hello` within 10 s → close.
- Identity: `hello` returns `{playerId, resumeToken (128-bit random)}`. Every later message is bound to the socket, never to an id inside the message, so impersonation is impossible. `resume{token}` re-binds after a reconnect.
- Names: NFC-normalised and trimmed; 2–16 characters from letters (Turkish included), digits, space, `_ - .`; control characters and bidi overrides rejected. They are rendered only with `textContent` (the UI `h()` helper). The server never echoes HTML.

### 7.2 State validation thresholds (shared constants in `src/net/protocol.ts` → `NET_LIMITS`)

| Check | Threshold | Action |
|---|---|---|
| finite numbers, \|x\|,\|z\| | all f32 finite, \|x\|,\|z\| ≤ 20 000 m | drop + strike |
| `seq` | newer than the last (u16 wrap) | drop silently |
| `simMs` | monotonic; ≤ server race clock + 250 ms; ≥ server race clock − 3000 ms (otherwise the car is marked **lagging**) | drop + strike / flag |
| speed \|(vx,vz)\| | ≤ **105 m/s**; > 150 m/s = hard violation | drop + strike / hard |
| displacement between accepted states | ≤ 105 m/s × Δt + 3 m (Δt from `simMs`); > 50 m without the `reset` flag = hard | drop + strike / hard |
| `reset` flag (carReset) | new pose on track (\|d\| ≤ half-width) and progress not increased by > 10 m | accept / strike |
| track position | `TrackQuery.project(x,z,hint)`; \|deltaS(project.s, progress mod L)\| ≤ 25 m; \|d\| ≤ wall distance + 5 m (`ESCAPE_M`) on the main ribbon; the pit ribbon is accepted via `ground().ribbon` | strike |
| progress | increase per state ≤ 105 × Δt + 3 m; decreases allowed (reverse gear, D-040); laps need the sector order (§6.1) | no lap credit |
| pre-start | §6.3 | 5 s penalty |
| `contact` | §6.2 anti-abuse (j cap 15 kN·s, plausibility vs server poses, rates, ghost windows) | clamp / reject; 5 rejects in 10 s = 1 strike |

- Strikes: 3 within 10 s → the player's states are not relayed for 1 s (others see it as stale) and it is logged. **2 hard violations → DSQ** for that race (room setting `strict`, default on). Thresholds stay configurable and are tuned with legit bot data so there are **0 false positives** over a 2 h soak (§14).
- Cost: `project` is a hinted ±40 m search (≤ 1 µs on the dev PC), so it is negligible at 160 states/s.

### 7.3 What stays client-trusted in v1 (stated, not hidden)
The car's physics (a modified client could drive "faster but plausible", under 105 m/s), the track-limit/cut reports, and the tyre/fuel/ERS state. This is acceptable for a friends-only v1. Full trust needs the server sim (§15).

---

## 8. Protocol

### 8.1 Transport
- One WebSocket per client at `wss://<host>/ws` (or `ws://<lan-ip>:8080/ws` on LAN). Binary frames for ping/pong/state; UTF-8 JSON for lobby and race events (rare, readable, easy to validate).
- `hello` carries `{v: PROTOCOL_VERSION, build, name, resume?}`. A version mismatch → `error{code:'version'}` and the UI says "refresh the page". `loaded{trackHash}` is checked against the server's hash of the built track, so a mismatched build cannot race (it would mean different geometry).

### 8.2 Binary messages (little-endian; DataView; `src/net/protocol.ts`)

**0x10 `state` C→S, 40 bytes** (20 Hz; tested at 10/15/20)

| Off | Type | Field | Encoding |
|---|---|---|---|
| 0 | u8 | type | 0x10 |
| 1 | u8 | flags | b0 pitLimiter, b1 drsOpen, b2 pitRibbon, b3 inPitBox, b4 reset (carReset this period), b5 wrongWay, b6 finished, b7 reverse |
| 2 | u16 | seq | wraps |
| 4 | u32 | simMs | `round(state.time·1000)`, shared race clock |
| 8 | f32 | x | m (world, as `vehicle.x`) |
| 12 | f32 | y | m |
| 16 | f32 | z | m |
| 20 | f32 | progress | m (`lapWraps·L + s`; f32 step ≤ 0.016 m at 174 km) |
| 24 | i16 | yaw | rad × 32768/π |
| 26 | i16 | vx | cm/s (±327 m/s) |
| 28 | i16 | vz | cm/s |
| 30 | i16 | yawRate | mrad/s |
| 32 | i8 | steerAngle | rad × 300 (±0.42 rad, maxSteer 0.384) |
| 33 | u8 | throttle | ×255 |
| 34 | u8 | brake | ×255 |
| 35 | i8 | gear | −1..8 |
| 36 | u16 | rpm | rpm |
| 38 | u8 | drsFlap | ×255 |
| 39 | u8 | compound | 0..4 (low 3 bits), ers sign in b3 |

Pitch, roll, wheel data and slip are not sent; the puppet writer derives them (§5.2). That is 4.4× smaller than a replay frame (176 B/car).

**0x90 `states` S→C** (room tick 20 Hz): `u8 type, u8 count, u16 serverSeq, u32 serverMs` + `count × (u8 playerId + bytes 1..39 of the client state)` = 8 + 40·k bytes. With 3 opponents that is **128 B**.

**0x11 `contact` C→S, 28 bytes:** `u8 type, u8 otherPlayerId, u16 seq, u32 simMs, f32 j (N·s), i16 nx, i16 nz (×32767, from sender to other), f32 px, f32 pz (world contact point), i16 vRelN (cm/s), u16 episode` (= 28 B). **0x91 `contact` S→C** has the same layout, with the byte at offset 1 = the source player and `j` as clamped by the server.

**0x01 `ping` C→S** `{u8, u8 pad, u16 seq, f64 clientMs}` = 12 B. **0x02 `pong` S→C** `{u8, u8, u16 seq, f64 clientMs, f64 serverMs}` = 20 B.

Bandwidth at 20 Hz: per player up ≈ 0.9 KB/s, down ≈ 2.7 KB/s (4-player room); about 29 KB/s through the server for 8 players. Contacts add a few 28-byte messages per incident.

Server relay policy: a fixed **20 Hz room tick** sends the newest accepted state of every other player in one batch. Load is bounded and predictable (≤ 4 sends per room tick), at a cost of ≤ 50 ms (mean 25 ms) of extra delay. Puppet extrapolation hides it.

### 8.3 JSON messages
Control messages are JSON, ≤ 1 KB, bound to the socket. C→S: `hello, create, join, leave, setCar, setReady, setSettings (owner), start (owner), loaded{trackHash}, report, retire, backToLobby`. S→C: `welcome, room (full snapshot), error{code}, load, start{t0ServerMs}, lap, penalty, standings (2 Hz), finishing, player{connected,stale}, results`. The full field table is in **`docs/team/multiplayer-tasks.md` §C**.

## 9. Files to change and new modules (summary)

Full per-file tables (existing files, new files, owners) and the dependency request are in **`docs/team/multiplayer-tasks.md` §A**. In short:
- **Changed (surgical):** contracts `sim/ui/debug/events/hud` (CR-NET, §13), `game/createSim.ts` (lineup), `game/session.ts` (online options), `core/loop.ts` (`targetTicks`), `main.ts` (online flow), `race/director.ts` + `race/state.ts`, `ai/aiSystem.ts`, `physics/vehicle/vehicleSystem.ts`, `physics/collision/collisionSystem.ts`, `game/hud/presenter.ts`, `game/results.ts`, `core/launchParams.ts`, `core/debug/apexApi.ts`, UI `mainMenu/pause/results/tower` + i18n, `tests/arch`.
- **New:** `src/contracts/net.ts`, `src/net/{protocol,clock,netClient}.ts`, `src/game/net/onlineSession.ts`, `src/physics/remote/{puppet,contact}.ts`, `src/ui/screens/{online,lobby}.ts`, `server/**` (main, rooms, room FSM, validate, timing, limits, log, metrics, certs, contact, replay bots, Oracle deploy scripts), `tests/net/**`, `tests/e2e/online.spec.ts`, `scripts/netsoak.mjs`.
- **New role Sunucu (SRV)** owns `server/**` (TEAM-RULES change + agent file by the orchestrator).
- **Dependency request:** `ws@^8` (server runtime, pure JS) + `@types/ws`. The server is bundled to one `apex-server.mjs` with the repo's Vite (`vite build --ssr`).

## 10. Server platform (user decision: Oracle Cloud Always Free)

### 10.1 Choice
**Node.js LTS + `ws`** in one process for all rooms, state in RAM, no DB and no Docker. It runs as a **systemd service** on an **Oracle Cloud Always Free Ampere A1 VM** (ARM64, Ubuntu 24.04, 1–2 OCPU / 6–12 GB). It is free with card verification only.
- Why Node: the server reuses the game's TypeScript track geometry and `TrackQuery` for validation, lap timing and contact plausibility (§6.2) as a direct import. Python would need a second geometry port.
- Why Oracle over the Unisign: a patched Linux on a public IPv4 (no CGNAT, no port forwarding, nothing exposed inside the home), ARM64 Node from NodeSource, systemd restarts, far more CPU/RAM than the RK3288, and RTT to Turkey of about 40–70 ms from Frankfurt/Marseille **[UNVERIFIED; T9]**.
- Expected footprint: RSS 50–100 MB, idle CPU ≈ 0 **[to be measured, T8]**.
- One pre-bundled file `apex-server.mjs` (built with the repo's Vite `--ssr`) plus `dist/`. The same file runs on the Windows PC (dev/LAN), the VM, the Unisign (Termux, appendix) or a later Mac/mini PC.
- **User steps** (account, home region, `VM.Standard.A1.Flex`, SSH key, ingress rules, DuckDNS) and **agent deliverables** (`setup.sh`, the systemd unit, acme.sh renewal, `deploy.ps1`) are written out in **`docs/team/multiplayer-deploy.md` Part 1**. Caveats there: idle reclamation, capacity errors, and the home region cannot be changed later.

### 10.2 Unisign (optional, secondary)
The Termux path (F-Droid Termux + Termux:Boot, `nodejs-lts` on ARMv7, wake-lock, supervise loop, ports 8443/8080), its direct-address setup and the Android 8.1 hardening checklist are kept as **Appendix A** of the deploy doc. Uses: a LAN server at home, or the internet host only if the line has no CGNAT and the user accepts the residual risk of exposing an unpatched Android 8.1 box.

## 11. Network path and hosting (free only)

### 11.1 Primary: one address on the VM
```
browser ──https://<name>.duckdns.org──► Oracle VM public IPv4 :443
           (VCN security list: 443 from anywhere, 22 from home IP/32 only; iptables: same)
           node (systemd, CAP_NET_BIND_SERVICE) → static dist/ + wss://<name>.duckdns.org/ws
```
- The free **DuckDNS** name points at the VM. The **Let's Encrypt** cert comes from **acme.sh DNS-01 (`dns_duckdns`)**, so port 80 stays closed. Renewal runs from cron and the server hot-reloads the cert. Certbot HTTP-01 is the alternative if port 80 is opened.
- **One origin:** the page and the socket share the host, so the client derives `wss://host/ws` from `location`. No mixed content and no CORS.

### 11.2 Free fallbacks (in order)
1. **Unisign at home with a direct address** (deploy doc Appendix A): needs a public IPv4 (no CGNAT; some ISPs remove CGNAT free on request, not guaranteed), one port forward 443 → 8443, DuckDNS and acme.sh. Higher security risk.
2. **Cloudflare quick tunnel** (`cloudflared tunnel --url http://localhost:8080`, no account): free, but the URL is a random `*.trycloudflare.com` on every run.
3. **Windows PC** for LAN-only sessions.
- **Not needed:** a paid VPS, static IP, domain or tunnel plan. Static files can also go on free GitHub/Cloudflare Pages if ever needed (`?server=wss://…`), but one address is preferred.

### 11.3 Server address in the client
The default is same origin. The override is `?server=wss://host/ws` (LaunchParams, CR) plus an "advanced" field on the online screen. An HTTPS page may only use `wss://`, and the UI rejects `ws://` there. Dev: `npm run dev` + `ws://localhost:8080/ws`.

### 11.4 Static load
Each friend downloads about 12 MB once (hashed assets are served `immutable`, without source maps). The VM uplink is not a constraint for a handful of players **[UNVERIFIED for the free tier's bandwidth shaping; 10 TB/month egress is included]**.

## 12. Not breaking the existing game

- Online code runs only when `SessionOptions.online` is set. `createSim` without `opts.lineup` and the loop without `targetTicks` behave exactly as today.
- Guards: determinism hashes unchanged, all existing suites green, contract baseline re-recorded once after CR-NET.
- The arch test keeps the server honest: `server/**` may import only `src/contracts/**`, sim-layer files and `src/net/{protocol,clock}.ts` (never `three` or DOM).
- Online UI and `netClient` are dynamic-imported, so offline players do not load them.

---

## 13. Contract change requests (for the Lead)

- **CR-NET-1** `CreateSimOptions.lineup?: { teamId: string; driverIdx: 0 | 1; gridSlot: number; remote: boolean }[]` (index 0 = local player).
- **CR-NET-2** `SimCarState.control: 'player' | 'ai' | 'pitAuto' | 'remote'`.
- **CR-NET-3** `ScreenId` + `'online' | 'lobby'`; new `UiAction`s (§9.1); `UiDeps.net: Store<NetLobbyModel>`.
- **CR-NET-4** `LaunchParams.server: string | null; room: string | null; name: string | null`; `ApexDebugApi.net(): NetStats | null` (`{ state, rttMs, offsetMs, sent, recv, dropped, staleCars }`).
- **CR-NET-5** `EventMap` + `net:status`, `net:error`; `TowerRow.net?`; `HudModel.net`.
- **CR-NET-6** pure `lightsOutAtMsFor(seed): number` exported from `src/race`; `createSim` uses it (no behaviour change).
- **CR-NET-7** `LoopHooks.targetTicks?(): number | null`.
- **CR-NET-8** `SimEvent` `collision` gains `nx, nz` (contact normal, a→b) so the glue can send `contact`; a glue writer `applyContactImpulse` (new ARCHITECTURE §4.3 row).
- **CR-NET-9** new `src/contracts/net.ts` with runtime constants `PROTOCOL_VERSION`, `NET_STATE_BYTES = 40`, `NET_HZ = 20` (like D-025 for the replay constants; arch rule 4 exception).

---

## 14. Test plan (summary)
Full table: **`docs/team/multiplayer-tasks.md` §B**. T1 one client connects · T2 two see each other (Playwright, `autodrive=1` in an `allowBots` room) · T3 four in one race · T4 two rooms at once (Node replay bots) · T5 disconnect/reconnect (5 s seamless, 70 s DNF, reload rejoin) · T6 malformed/fuzz/XSS names · T7 cheat bots flagged, legit bots **0 strikes** · T8 CPU/RAM/loop-lag at 2/4/8 players and 10/15/20 Hz · T9 latency/loss (puppet error p95 ≤ 0.5 m at 0 ms, ≤ 1.5 m at 100 ms) · T10 soak 2 h on the PC, then 8 h on the VM · T11 internet with real friends · T12 full regression unchanged · **T13 contact harness at 0/50/100/150 ms (§6.2)**. Order: PC LAN → Oracle VM; 2 → 4 → 8 players. **A capacity is "verified" only after T8 + T10 pass on that host at that player count.**

## 15. Phased plan and effort (agent-days; one agent-day ≈ one full role session including tests)

| Phase | Content | Owners | Effort | Gate |
|---|---|---|---|---|
| P0 Host | User: Oracle account, region, A1 VM, SSH key, ingress, DuckDNS (deploy doc §1.1). SRV: `setup.sh`, systemd unit, acme.sh, `deploy.ps1`, echo server | User + SRV | 0.5 + user ≈ 1 h | `https://<name>.duckdns.org/health` reachable from mobile data |
| P1 Protocol & contracts | CR-NET-1..9, `src/net/protocol.ts` (state, batch, contact, ping), `clock.ts`, unit tests | YÖN, TEST | 1 | round-trip tests; arch green |
| P2 Server MVP | rooms/FSM, lobby, ready, load/start, relay, ping, limits, validation, timing, results, contact validate/relay, static + /health, `--net-delay`, replay bots | SRV | 3.5 | T1, T4, T6, T7 on the PC |
| P3 Client integration | createSim lineup, puppets, puppet.ts, onlineSession, loop slaving, session/main online flow, HUD/results | YÖN, SÜR | 3 | T2, T3, T12 on the PC |
| P3c Contact | collision pair with remotes, soft separation, latency softening, `applyContactImpulse`, episode dedup, ghost windows | SÜR (+ YÖN glue) | 2.5 | T13 at 0/50 ms |
| P4 Lobby UI | online/lobby screens, 3-2-1 overlay, pause overlay, tower badges, i18n TR/EN | GRA-UI | 2 | menu E2E; screenshots reviewed |
| P5 Harness & soak | Playwright 2/4/8, netsoak, T5, T8–T10, **T13 at 0/50/100/150 ms** | TEST | 3 | report `docs/qa/test-net.md` |
| P6 Deploy & internet | deploy to the VM, T8/T10 on the VM, T11 with friends, contact tuning from T13/T11 | SRV, SÜR + user | 1.5 | measured numbers published |
| P7 Optional | page-reload rejoin mid-race, Unisign appendix path, standings polish | YÖN, SRV | 2 | — |

Total ≈ 17 agent-days for P0–P6 (+2 optional), plus about 1 h of user time for Oracle and the friends' test sessions. After P1, P2, P3/P3c and P4 can run in parallel.

### Migrating later (stronger host / more players)
- **Move:** run `deploy.ps1` against the new host (Mac M1, Linux mini PC, a second Oracle VM) and point DuckDNS at it. No client change (same origin).
- **More players:** `MAX_ROOMS` / `MAX_PLAYERS_PER_ROOM` are config values; 4×4 and 8×4 need their own T8/T10/T13 runs before they are claimed. Beyond one core, shard rooms across worker processes by room code.
- **v2 authority:** `createSim` is pure TS, so the server can simulate every car from client inputs (prediction + reconciliation). That gives exact contact physics, online AI opponents and full anti-cheat. The A1 VM has the cores for it **[to be measured]**; ≈ 10+ agent-days.
- **Accounts/standings:** SQLite (`node:sqlite`) on the VM. Not in v1.

---

## 16. Risks and open questions for the user

**Risks**
1. Oracle account/capacity: sign-up checks, "out of host capacity" in the home region, and **idle reclamation** of Always Free VMs (deploy doc §1.5). Mitigation: scripted re-create (≈ 20 min).
2. Contact under latency: hits feel up to RTT/2 early or late; at > 150 ms RTT they are softened (§6.2). T13 quantifies this; tuning may take extra iterations.
3. Client-trusted physics: a modified client can still cheat within plausible limits (§7.3); friends-only v1.
4. RTT from Turkey to the VM region (≈ 40–70 ms expected) is **unmeasured**.
5. The Unisign path (appendix) keeps its own risks: an unpatched OS, CGNAT and background kills.

**Questions (EN / TR)**
1. Which Oracle home region can you get (Istanbul if offered, else Frankfurt/Marseille/Milan)? — *Oracle'da hangi ana bölgeyi seçebildiniz (varsa İstanbul, yoksa Frankfurt/Marsilya/Milano)?*
2. Is the free DuckDNS name OK, and which name do you want? — *Ücretsiz DuckDNS adı uygun mu, hangi adı istersiniz?*
3. Idle reclamation: accept occasional re-creation (zero cost), or upgrade to Pay As You Go with a budget alert (still free if you stay in Always Free)? — *Boşta kalınca VM geri alınabilir: arada yeniden kurulum mu, yoksa bütçe uyarılı Kullandıkça Öde (Always Free'de kaldıkça ücretsiz) mi?*
4. Nicknames only in v1 (no accounts), 2–16 characters? — *v1'de yalnızca takma ad (hesap yok) uygun mu?*
5. Humans only in v1 (no AI cars online)? — *v1 çevrim içi yarışlarda yapay zekâ araç olmasın mı?*
6. Should the room owner choose track/laps/weather, with laps 1/3/5/10? — *Pist/tur/hava seçimini oda sahibi mi yapsın; tur seçenekleri 1/3/5/10 uygun mu?*
7. Assists free per player, or a room rule? — *Sürüş yardımları oyuncuya mı serbest, oda kuralı mı olsun?*
8. Confirm online pause (the race does not stop) and flashback (off). — *Çevrim içinde duraklatmanın yarışı durdurmaması ve geri sarmanın kapalı olması onaylı mı?*
9. Contact strength: realistic (offline-like) or slightly softened for fairness under lag? — *Temas sertliği: gerçekçi mi, gecikmede adalet için biraz yumuşatılmış mı?*
