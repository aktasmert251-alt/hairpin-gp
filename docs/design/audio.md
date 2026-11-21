# Audio specification

> Owner: Planner. Implementer: **Sürüş** (`src/audio/**`). Trailer use: **Grafik** (`scripts/trailer-audio.mjs`, `src/trailer/**`).
> Contracts: `audio.ts` (`AudioSystem`, `AudioSettings`), `render.ts` (`RenderFrame`, `ListenerPose`), `sim.ts` (`SimEvent`); pending CR-04 (`ersKw`, `pitLimiter`), CR-08 (offline render), CR-11 (`ui:sound`).
> Everything is synthesised (no samples), so there are no audio licences to track. No in-game music (music only in the trailer).

## 1. Architecture
- One graph factory: `createAudioGraph(ctx: BaseAudioContext, opts)` in `src/audio/graph.ts`. The live `AudioSystem` and the offline renderer (§9) both use it.
- `unlock()` creates/resumes the `AudioContext` on the title-screen key press, then emits `audio:unlocked`.
- `update(frame, listener, dt)` runs every frame: picks voices, writes parameters with `setTargetAtTime(v, now, 0.02)` (τ 20 ms). No allocation; voices and nodes are created at init and reused.
- Noise sources: looped `AudioBuffer`s (2 s white, 2 s pink) generated with mulberry32 from a fixed seed. Never `Math.random`.
- CPU budget: `update` ≤ 0.4 ms per frame; ≤ 220 nodes in total; 1 player voice + ≤ 8 AI voices.

## 2. Player engine (V6 turbo hybrid character)

| Element | Rule |
|---|---|
| Firing frequency | `f0 = rpm / 60 · 3` (6 cylinders, 4-stroke: 3 firings per revolution). Idle 4,000 rpm → 200 Hz; 12,000 rpm → 600 Hz |
| Base oscillator | `fb = f0 / 2 = rpm / 40`; two `OscillatorNode`s with custom `PeriodicWave`s at `fb` |
| Harmonic stack, **load** wave (harmonic n of `fb`: amplitude) | 1: 0.25 · 2: 1.00 · 3: 0.35 · 4: 0.55 · 5: 0.12 · 6: 0.30 · 8: 0.18 · 9: 0.08 · 10: 0.06 · 12: 0.08 · 16: 0.04 |
| Harmonic stack, **overrun** wave | 1: 0.35 · 2: 1.00 · 3: 0.15 · 4: 0.30 · 6: 0.10 · 8: 0.05 |
| Load mapping | `load = clamp(throttle · (0.6 + 0.4·rpm/12,500), 0, 1)`; equal-power crossfade load ⇄ overrun waves by `load`; during a shift cut `load = 0.2` |
| Waveshaper | `WaveShaperNode`, curve `tanh(2.2x)/tanh(2.2)` (1,024 points), `oversample '2x'`; pre-gain `0.6 + 1.6·load`, post-gain `1 / (0.6 + 1.6·load)^0.5` |
| Tone filter | lowpass, Q 0.8, cutoff `900 + 6,500·throttle^0.7 + 0.4·f0` Hz (× 0.6 interior) |
| Combustion noise | white noise → bandpass at `2·f0`, Q 1.4; gain `0.03 + 0.10·throttle` |
| Engine gain | `0.35` at idle, `0.55 + 0.45·throttle` above idle |
| Turbo whine | sine at `2,200 + 0.55·rpm·spool` Hz; `spool` = throttle smoothed τ 0.4 s up / 0.25 s down; gain `0.035·spool·rpm/12,500` |
| MGU-H whine | sine at `5,000 + 0.30·rpm` Hz; gain 0.012 (interior 0.02) when rpm > 9,000 and throttle > 0.8 |
| MGU-K whine | two sines at `fk = 900 + 18·v` (v in m/s) and `2.03·fk`; gain `0.05·|ersKw|/120` (CR-04 `ersKw`); deploy through a bandpass at `fk` (bright), harvest through a lowpass at `1.5·fk` (soft) |
| Upshift cut (`gear` up) | engine gain × 0.35 and tone cutoff × 0.5 for 35 ms, recover over 25 ms; 20 ms "thump" (noise lowpassed at 180 Hz, gain 0.25) |
| Downshift blip (`gear` down) | +2 dB for 60 ms and a crackle burst: 6–10 pops over 0.15 s, each a 3 ms noise burst bandpassed at 1.5 kHz, gain 0.3 |
| Overrun crackle | for 1.2 s after a lift (throttle < 0.05, rpm > 8,000): pops at 10–20 /s, gain 0.2 |
| Limiter | rpm ≥ 12,400: square LFO at 30 Hz gating engine gain between 0.5 and 1.0 |
| Pop timing | from a per-voice mulberry32 seeded by car id, so replays sound identical |

### 2.1 Interior vs exterior
- **Interior** = view `cockpit`: exhaust path lowpass 3.5 kHz, peaking EQ 280 Hz +4 dB Q 1.2 (airbox), MGU-H gain as above, wind louder (§4), engine −3 dB.
- **Exterior** = `tcam`, `nose`, `chaseNear`, `chaseFar`: highshelf +3 dB at 4 kHz, crackles +3 dB; the player engine stays centred (not panned); `chaseFar` −2 dB.
- **Spectator views** (`tv`, `orbit`, `trailer`; CR-02 `RenderFrame.view`): the player car becomes a positional voice like the AI (§5) but with the full synth.
- View changes crossfade over 120 ms.

## 3. Tyres, surfaces and impacts
| Sound | Source data | Synthesis | Level |
|---|---|---|---|
| **Squeal** | `σ = max(slip[0..3])` (combined normalised slip, 1 = peak) | intensity `smoothstep(1.05, 1.5, σ)·min(1, v/15)`; noise bandpass at `900 + 500·(σ − 1)` Hz, Q 6, plus a 1,100 Hz sine with ±40 Hz jitter at 7 Hz; lock-up (`slipRatio < −0.2`, physics): 650 Hz, more noise | gain `0.25·intensity` |
| **Scrub** (understeer) | front σ > 1.1 while rear σ < 0.9 | noise lowpass 300 Hz | 0.10 |
| **Wet tyres** | `wetness`, speed | squeal × 0.2; spray hiss: noise highpass 2 kHz | `0.15·wetness·min(1, v/80)` |
| **Flat kerb** | wheels on `kerbFlat` (`wheelSurface`) | square oscillator at `f = v / 1.0 m`, lowpass 220 Hz | `0.12 · wheelsOnKerb / 2` |
| **Sausage kerb** | wheels on `kerbSausage` | square at `f = v / 0.5 m`, lowpass 220 Hz; `kerb` event thump: 60 Hz sine, 80 ms | 0.25; thump 0.5 (flat-kerb thump 0.2) |
| **Gravel** | wheels on `gravel` | noise bandpass 1.8 kHz Q 0.7 + stone ticks at 8–40 /s ∝ speed | `0.3·min(1, v/30)` |
| **Grass** | wheels on `grass` | noise lowpass 400 Hz + swish (AM 3 Hz) | `0.2·min(1, v/30)` |
| **Impact** | `collision` event | noise burst lowpass 400 Hz + 3 detuned sines (1.2, 2.7, 4.1 kHz, decay 0.3 s) | `min(1, log10(impulse/200)/2)` |

Player tyres use the full model. AI tyres: only the 3 nearest AI cars get squeal (one shared simple noise voice each).

## 4. Wind, rain, crowd
- **Wind:** pink noise → lowpass `300 + 10·v` Hz; gain `0.35·(v/90)²` interior, `0.2·(v/90)²` exterior.
- **Rain bed:** pink noise highpass 1.5 kHz, gain `0.25·rain`. Interior adds droplet ticks on the helmet at `20 + 60·rain` /s.
- **Crowd:** two looped murmurs (filtered pink noise, slow AM at 0.2 Hz). Gain by listener track position: inside the main-grandstand range (s 5,089 → 130) 0.30; within 60 m of another bleacher range (report §7.9, copied as constants in `src/audio/ambience/stands.ts`) 0.15; elsewhere 0.03. Cheers: `lightsOut` +6 dB swell over 3 s; a player overtake (`position` improving) within 150 m of a stand +3 dB for 1.5 s; player `finish` +6 dB.

## 5. AI voices
- **Count:** up to **8** AI cars, the nearest to the listener; re-ranked every 0.25 s with 15 % distance hysteresis; reassignment crossfades over 150 ms.
- **Synth:** one oscillator with the load `PeriodicWave` at `fb`, load crossfade by throttle, lowpass `800 + 5,000·throttle` Hz, gain `0.5 + 0.5·throttle`; gear events give the upshift cut only. No noise, turbo or MGU layers.
- **Spatialisation:** `PannerNode`, `panningModel 'HRTF'` for the 3 nearest, `'equalpower'` for the rest; `distanceModel 'inverse'`, `refDistance 8`, `rolloffFactor 1.2`, `maxDistance 600`; position from `CarRenderState` (engine at model z −1.2); listener from `ListenerPose`.
- **Doppler** (manual; WebAudio has none): `n = normalize(listener − source)`; `ratio = (c + (−vL·n)) / (c − vS·n)`, `c = 343 m/s`, clamped to [0.6, 1.6], multiplied into the oscillator frequency, smoothed τ 30 ms. Listener velocity from `ListenerPose.v*`; source velocity from the car's forward vector × speed.

## 6. UI, start and pit sounds (bus `ui`)
| Trigger | Sound |
|---|---|
| `ui:sound move` | sine 2.4 kHz, 15 ms, −20 dB |
| `ui:sound confirm` / `back` | two tones 880 → 1,320 Hz / 1,320 → 880 Hz, 60 ms |
| `ui:sound error` | square 220 Hz lowpassed 1 kHz, 90 ms |
| `ui:sound toggle` | click 1.8 kHz, 10 ms |
| `ui:sound open` / `close` | noise whoosh, bandpass sweeping up / down over 120 ms |
| `notify` info / warn / penalty / good | blip 1.2 kHz / double blip 1.0 kHz / low triad 220-277-330 Hz 180 ms / rising 660 → 990 Hz |
| `lightsOn` | beep 600 Hz, 80 ms per light; `lightsOut` has no beep (crowd roar instead) |
| Pit limiter on, in the limit zone | 1 kHz, 40 ms, every 0.5 s |
| In `entry` with the limiter off | 1.6 kHz, 30 ms, 6 per second until engaged |
| `drsAvailable` (player) | tick 2 kHz, 20 ms |

## 7. States: pause, flashback, menus
- `setPaused(true)`: buses engine, cars, sfx, ambience ramp to −18 dB with a 600 Hz lowpass over 150 ms; `ui` unaffected. Reverse on resume.
- Flashback open: game buses muted over 80 ms; rewind whoosh (noise sweeping 4 kHz → 400 Hz over 0.4 s) on open and on apply; game buses return over 200 ms after apply/cancel.
- Menus and results: game buses −10 dB (results keep the live TV-camera scene audible); title and main menu: ambience bed only (showroom hum: pink noise lowpass 200 Hz, gain 0.05).

## 8. Buses, levels, ducking
- Buses: `engine` (player engine), `cars` (AI voices), `sfx` (tyres, kerbs, surfaces, impacts), `ambience` (wind, rain, crowd), `ui` (UI, notifications, start and pit beeps) → master.
- Settings mapping (`AudioSettings`, 0–1, applied as gain² for a perceptual curve): `engine` scales `engine` and `cars`; `sfx`, `ambience`, `ui` map 1:1; `master` on the master gain. `?mute=1` → master 0.
- Nominal levels at setting 1.0 (dBFS peak): player engine at full throttle 12k rpm exterior −10; AI car at 10 m −16; squeal −14; kerbs −16; impacts −8; wind at 300 km/h interior −18; heavy rain −20; crowd −24 (−18 near stands); UI −14; notifications −12.
- Master chain: `DynamicsCompressor` (threshold −14 dB, knee 6, ratio 3, attack 5 ms, release 120 ms) → limiter (`DynamicsCompressor` threshold −1 dB, ratio 20, attack 1 ms, release 50 ms) → destination.
- Ducking: warn/penalty notification → engine, cars, ambience −4 dB (attack 30 ms, hold 400 ms, release 250 ms); during the start lights ambience −6 dB.

## 9. OfflineAudioContext requirement (trailer)
- The graph uses only nodes that exist in `OfflineAudioContext`: Oscillator, Gain, BiquadFilter, WaveShaper, Panner, StereoPanner, AudioBufferSource, DynamicsCompressor, ConstantSource. **No** AudioWorklet, MediaElement/MediaStream nodes or `resume()` dependence.
- `renderReplayAudio(replay, { from, to, sampleRate: 48000, listener, volumes })` (CR-08):
  1. Create `new OfflineAudioContext(2, (to − from + 2)·48000, 48000)` (2 s pre-roll for filter warm-up, trimmed afterwards).
  2. Build the graph with `createAudioGraph(ctx, { offline: true })`.
  3. For each 1/60 s replay sample, schedule every live parameter with `setValueAtTime` (discrete) or `linearRampToValueAtTime` (continuous): rpm-derived frequencies, gains, filters, panner positions, Doppler ratios. Voice selection is recomputed per 0.25 s window exactly as live.
  4. Schedule `replay.events` (gear, kerb, collision, lightsOn/Out, position, finish) at their times.
  5. Listener path from the trailer camera timeline via `listener(t, out)`.
  6. `startRendering()` → `AudioBuffer`.
- `scripts/trailer-audio.mjs` (Grafik) drives this through Playwright (`?scene=trailer`), transfers the buffer as base64, writes 48 kHz 24-bit WAV to `media/trailer/`, then mixes music and SFX and runs two-pass loudnorm to −14 LUFS with ffmpeg.
- Render ≤ 35 s per call; 30 s with 20 voices must finish in ≤ 20 s wall time.
- Determinism: rendering the same replay twice gives bit-identical buffers (test E-AU-02 in `tests/e2e/audio.spec.ts`).

## 10. Sandbox `?scene=audio` (SÜR, port 5176)
rpm/throttle sliders, 4 s sweep idle → limiter, gear up/down buttons, surface selector, slip slider, rain slider, voice-count and Doppler fly-by test (AI car passing at 300 km/h), bus meters, `&offline=1` renders 2 s offline and plots the waveform.
