// Player engine voice (audio.md §2): V6 turbo-hybrid character, source-filter model.
// Source: one 4-stroke cycle (rpm/120) wavetable of six uneven exhaust pulses, so every half engine order is present
// and the 3rd (firing) order dominates; load and overrun tables crossfade by load. Cycle-to-cycle irregularity comes
// from slow noise on the oscillator detune (pitch wander) and band-limited noise amplitude modulation (roughness),
// plus firing-synchronous combustion noise (rasp). Then a tanh waveshaper (load drive), tone low-pass, a fixed exhaust
// / airbox resonance, turbo / MGU-H / MGU-K whines, shift cut + bark, downshift blip + crackle, overrun pops,
// wastegate chuff on lift, limiter gate, interior/exterior EQ. Every node is created once from a BaseAudioContext
// (works on OfflineAudioContext, deterministic: seeded noise buffers only); `set()` only writes AudioParams.

import { sumTree } from '../mix';
import type { NoiseBuffers } from '../noise';

export interface EngineParams {
  rpm: number;
  /** 0..1 */
  throttle: number;
  /** m/s */
  speed: number;
  /** + deploy / − harvest (kW) */
  ersKw: number;
  /** Turbo spool 0..1 (throttle smoothed τ 0.4 s up / 0.25 s down). */
  spool: number;
  interior: boolean;
}

const LIMITER_RPM = 12400;
/** Minimum smoothing (s) for the load-dependent timbre params. */
const TIMBRE_TAU = 0.06;
/** Per-cylinder pulse amplitude and timing (fraction of the 120° firing interval), in firing order: bank / runner
 *  asymmetry. Scaled by `spread` (overrun pulses are less even). */
const CYL_AMP = [1.0, 0.82, 0.96, 0.87, 1.04, 0.9];
const CYL_DT = [0, 0.04, -0.025, 0.035, -0.01, 0.03];
/** Harmonics in the cycle table: 128 × rpm/120 stays ≤ 13.3 kHz at the limiter (256 reached 26 kHz, past Nyquist). */
const CYCLE_H = 128;
/** Exterior high shelf at 4 kHz (dB); was +3, which lifted the rasp and pulse edges into fizz on headphones. */
const SHELF_EXT_DB = 1;
const CYCLE_M = 1024;

/**
 * PeriodicWave of one engine cycle (fundamental = rpm/120): six pulses of width `width` (fraction of the firing
 * interval; narrow = bright), each `(1 − cos 2πu)/2 · e^(−2.5u)`, with the per-cylinder offsets × `spread`.
 * Harmonic 6 = 3rd engine order (firing), harmonic 3 = 1.5 order (bank), odd harmonics = half orders.
 */
export function engineCycleWave(ctx: BaseAudioContext, width: number, spread: number): PeriodicWave {
  const x = new Float64Array(CYCLE_M);
  for (let c = 0; c < 6; c++) {
    const a = 1 + (CYL_AMP[c]! - 1) * spread;
    const c0 = (c + CYL_DT[c]! * spread) / 6;
    const w = width / 6;
    for (let m = 0; m < CYCLE_M; m++) {
      let u = (m / CYCLE_M - c0) / w;
      u -= Math.floor(u / (6 / width)) * (6 / width); // wrap round the cycle
      if (u < 1) x[m]! += a * 0.5 * (1 - Math.cos(2 * Math.PI * u)) * Math.exp(-2.5 * u);
    }
  }
  const cos = new Float64Array(CYCLE_M);
  for (let m = 0; m < CYCLE_M; m++) cos[m] = Math.cos((2 * Math.PI * m) / CYCLE_M);
  const real = new Float32Array(CYCLE_H + 1);
  const imag = new Float32Array(CYCLE_H + 1);
  for (let k = 1; k <= CYCLE_H; k++) {
    let re = 0;
    let im = 0;
    for (let m = 0; m < CYCLE_M; m++) {
      const i = (k * m) % CYCLE_M;
      re += x[m]! * cos[i]!;
      im += x[m]! * cos[(i + CYCLE_M - CYCLE_M / 4) % CYCLE_M]!; // sin(φ) = cos(φ − π/2)
    }
    real[k] = re / CYCLE_M;
    imag[k] = im / CYCLE_M;
  }
  return ctx.createPeriodicWave(real, imag, { disableNormalization: false });
}

/** Narrow positive pulse at the firing rate (AM carrier for the combustion noise): harmonics 1..8, Hann-tapered. */
function firePulseWave(ctx: BaseAudioContext): PeriodicWave {
  const n = 9;
  const real = new Float32Array(n);
  const imag = new Float32Array(n);
  for (let k = 1; k < n; k++) real[k] = 0.5 + 0.5 * Math.cos((Math.PI * k) / n);
  return ctx.createPeriodicWave(real, imag, { disableNormalization: false });
}

function shaperCurve(): Float32Array<ArrayBuffer> {
  const n = 1024;
  const c = new Float32Array(new ArrayBuffer(n * 4));
  const k = Math.tanh(2.2);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.tanh(2.2 * x) / k;
  }
  return c;
}

/** RMS of white noise (uniform ±1) after a 2-pole low-pass at `fc` (noise bandwidth ≈ 1.11·fc). */
function lpNoiseRms(fc: number, sr: number): number {
  return 0.577 * Math.sqrt((1.11 * fc) / (sr / 2));
}

/** Deterministic 0..1 hash of a time (pop colour), so pops need no RNG state. */
function hash01(t: number): number {
  const s = Math.sin(t * 12.9898 + 78.233) * 43758.5453;
  return s - Math.floor(s);
}

export interface EngineVoice {
  readonly output: GainNode;
  start(t: number): void;
  set(p: EngineParams, t: number, tau: number): void;
  upshift(t: number): void;
  downshift(t: number, pops: number, rand: () => number): void;
  pop(t: number, gain: number): void;
  /** Wastegate / dump chuff after a lift from boost (amount 0..1). */
  lift(t: number, amount: number): void;
  stop(t: number): void;
  disconnect(): void;
}

export function createEngineVoice(ctx: BaseAudioContext, noise: NoiseBuffers): EngineVoice {
  const nodes: AudioNode[] = [];
  const keep = <T extends AudioNode>(n: T): T => {
    nodes.push(n);
    return n;
  };
  const keepAny = (n: AudioNode): void => {
    nodes.push(n);
  };
  const osc = (type: OscillatorType, f: number): OscillatorNode => keep(new OscillatorNode(ctx, { type, frequency: f }));
  const gain = (g: number): GainNode => keep(new GainNode(ctx, { gain: g }));
  const biquad = (type: BiquadFilterType, f: number, q: number, g = 0): BiquadFilterNode => keep(new BiquadFilterNode(ctx, { type, frequency: f, Q: q, gain: g }));
  const sr = ctx.sampleRate;

  // ---- Source: cycle wavetables (load: narrow even pulses; overrun: wide, uneven, weaker) ----
  const oLoad = osc('sine', 40);
  oLoad.setPeriodicWave(engineCycleWave(ctx, 0.42, 1));
  const oOver = osc('sine', 40);
  oOver.setPeriodicWave(engineCycleWave(ctx, 0.75, 2.2));
  const gLoad = gain(0.5);
  const gOver = gain(0.5);
  oLoad.connect(gLoad);
  oOver.connect(gOver);
  // Noise streams: `white` (start offset 0) and `white2` (offset 1.21 s) are decorrelated; `pink` for the chuff.
  const white = keep(new AudioBufferSourceNode(ctx, { buffer: noise.white, loop: true }));
  const white2 = keep(new AudioBufferSourceNode(ctx, { buffer: noise.white, loop: true }));
  const pink = keep(new AudioBufferSourceNode(ctx, { buffer: noise.pink, loop: true }));
  // Pitch wander: white2 → LP 7 Hz → detune (cents) on both tables.
  const wanderLp = biquad('lowpass', 7, 0.7);
  const wander = gain(0);
  white2.connect(wanderLp).connect(wander);
  wander.connect(oLoad.detune);
  wander.connect(oOver.detune);
  const pre = gain(1);
  sumTree(ctx, pre, [gLoad, gOver], keepAny);
  const shaper = keep(new WaveShaperNode(ctx, { curve: shaperCurve(), oversample: '4x' }));
  const post = gain(1);
  pre.connect(shaper).connect(post);

  // ---- Combustion noise, firing-synchronous: white → HP → gain AM'd by a pulse at the firing rate ----
  // Band-pass (not high-pass): the rasp stays a firing-rate 'bark' band instead of broadband hiss up to the tone LP.
  const fireHp = biquad('bandpass', 1500, 0.7);
  // Headphone pass (2026-10-20): the rasp band is also low-passed, so no fizz above ~2.5 kHz rides on the firing pulse.
  const fireLp = biquad('lowpass', 2500, 0.7);
  const fireG = gain(0);
  const oFire = osc('sine', 200);
  oFire.setPeriodicWave(firePulseWave(ctx));
  const fireMod = gain(0);
  oFire.connect(fireMod).connect(fireG.gain);
  white.connect(fireHp).connect(fireLp).connect(fireG);
  const tone = biquad('lowpass', 4000, 0.8);
  post.connect(tone);
  fireG.connect(tone);

  // ---- Roughness: band-limited noise AM (cycle-to-cycle combustion variation) ----
  const rough = gain(1);
  const roughLp = biquad('lowpass', 60, 0.7);
  const roughDepth = gain(0);
  white.connect(roughLp).connect(roughDepth).connect(rough.gain);

  // ---- Shift cut / limiter gate / engine gain ----
  const cut = gain(1);
  const gate = gain(1);
  const lfo = osc('square', 22);
  // The limiter stutter keeps its 22 Hz square, but with rounded edges (LP 150 Hz): the raw square stepped the gain twice
  // per cycle, a click train heard as buzz.
  const lfoLp = biquad('lowpass', 150, 0.7);
  const lfoDepth = gain(0);
  lfo.connect(lfoLp).connect(lfoDepth).connect(gate.gain);
  const engGain = gain(0.35);
  tone.connect(rough).connect(cut).connect(gate).connect(engGain);

  // ---- Interior / exterior EQ: one resonance (exterior tailpipe 1.15 kHz / interior airbox 280 Hz) ----
  const reson = biquad('peaking', 1150, 1.4, 3);
  const exhaustLp = biquad('lowpass', 20000, 0.7);
  const shelf = biquad('highshelf', 4000, 0.7, SHELF_EXT_DB);
  // DC blocker: the pulse tables, AM and the shaper left a −0.02 offset (lost headroom, thumps on gain jumps).
  const dcBlock = biquad('highpass', 25, 0.7);
  engGain.connect(reson).connect(exhaustLp).connect(shelf).connect(dcBlock);
  // Nominal level (audio.md §8): full throttle 12k rpm exterior ≈ −10 dBFS peak at setting 1.0.
  // 0.37 (was 0.32): keeps the loudness after the darker tone / lower rasp of the 2026-10-20 headphone pass.
  const output = gain(0.37);
  const outIn: AudioNode[] = [dcBlock];

  // ---- Whines: turbo, MGU-H, MGU-K ----
  const oTurbo = osc('sine', 2200);
  const gTurbo = gain(0);
  oTurbo.connect(gTurbo);
  outIn.push(gTurbo);
  const oH = osc('sine', 5000);
  const gH = gain(0);
  oH.connect(gH);
  outIn.push(gH);
  const oK1 = osc('sine', 900);
  const oK2 = osc('sine', 1827);
  const gK = gain(0);
  oK1.connect(gK);
  oK2.connect(gK);
  const kDeploy = biquad('bandpass', 900, 2);
  const kHarvest = biquad('lowpass', 1350, 0.7);
  const gKDeploy = gain(0);
  const gKHarvest = gain(0);
  gK.connect(kDeploy).connect(gKDeploy);
  outIn.push(gKDeploy);
  gK.connect(kHarvest).connect(gKHarvest);
  outIn.push(gKHarvest);

  // ---- Event layers: thump (noise LP 180 Hz), pops / crackle (noise BP, colour per pop), wastegate chuff ----
  const thumpLp = biquad('lowpass', 180, 0.7);
  const thumpG = gain(0);
  white.connect(thumpLp).connect(thumpG);
  outIn.push(thumpG);
  const popBp = biquad('bandpass', 1500, 0.9);
  const popG = gain(0);
  white2.connect(popBp).connect(popG);
  outIn.push(popG);
  const wgBp = biquad('bandpass', 3200, 0.8);
  const wgG = gain(0);
  pink.connect(wgBp).connect(wgG);
  outIn.push(wgG);
  sumTree(ctx, output, outIn, keepAny);

  const sources: AudioScheduledSourceNode[] = [oLoad, oOver, oFire, lfo, oTurbo, oH, oK1, oK2];
  let interior = false;
  let limiting = false;
  const WANDER_REF = lpNoiseRms(7, sr);

  return {
    output,
    start(t) {
      for (const s of sources) s.start(t);
      white.start(t);
      white2.start(t, 1.21);
      pink.start(t, 0.61);
    },
    set(p, t, tau) {
      const rpm = p.rpm < 1000 ? 1000 : p.rpm;
      const thr = p.throttle < 0 ? 0 : p.throttle > 1 ? 1 : p.throttle;
      const f0 = (rpm / 60) * 3;
      const fc = rpm / 120;
      oLoad.frequency.setTargetAtTime(fc, t, tau);
      oOver.frequency.setTargetAtTime(fc, t, tau);
      oFire.frequency.setTargetAtTime(f0, t, tau);
      let load = thr * (0.6 + (0.4 * rpm) / 12500);
      load = load > 1 ? 1 : load;
      const a = Math.sqrt(load);
      const b = Math.sqrt(1 - load);
      // Timbre follows load with τ ≥ 60 ms: autodrive / AI-style throttle flicker (1 ↔ 0.7 several times a second)
      // otherwise toggles drive, rasp and roughness at frame rate, heard as a gargle (Boğaz live capture).
      const tl = tau > TIMBRE_TAU ? tau : TIMBRE_TAU;
      gLoad.gain.setTargetAtTime(0.62 * a, t, tl);
      gOver.gain.setTargetAtTime(0.5 * b, t, tl);
      const drive = 0.7 + 1.7 * load;
      pre.gain.setTargetAtTime(drive, t, tl);
      post.gain.setTargetAtTime(1 / Math.sqrt(drive), t, tl);
      // Tone: 700 + 6000·thr^0.7 + 0.6·f0 (7 kHz at full throttle) read as fizz on headphones; now ≈ 5 kHz.
      const cutoff = (650 + 4200 * Math.pow(thr, 0.7) + 0.5 * f0) * (p.interior ? 0.6 : 1);
      tone.frequency.setTargetAtTime(cutoff, t, tau);
      // Rasp: firing-synchronous noise, louder and brighter under load.
      const rasp = 0.008 + 0.035 * load;
      fireG.gain.setTargetAtTime(rasp, t, tl);
      fireMod.gain.setTargetAtTime(rasp, t, tl);
      fireHp.frequency.setTargetAtTime(700 + 1.5 * f0, t, tau);
      // Roughness: AM index 0.07 under load → 0.3 on overrun (burble); noise band 0.8 × the cycle rate. (Was 0.18 / 1.6 ×:
      // broadband amplitude flutter heard as a growl on long full-throttle runs.)
      const rf = 0.8 * fc;
      roughLp.frequency.setTargetAtTime(rf, t, tau);
      // Headphone pass: 0.07 → 0.3 noise AM reached near-gating peaks (3σ) on overrun, heard as crackle; now 0.05 → 0.15.
      roughDepth.gain.setTargetAtTime((0.05 + 0.1 * (1 - load)) / lpNoiseRms(rf, sr), t, tl);
      // Pitch wander ±~4 cents (more on overrun / idle).
      wander.gain.setTargetAtTime((3 + 4 * (1 - load)) / WANDER_REF, t, tau);
      const idle = rpm < 4300 && thr < 0.05;
      const eg = (idle ? 0.35 : 0.55 + 0.45 * thr) * (p.interior ? 0.708 : 1);
      engGain.gain.setTargetAtTime(eg, t, tau);
      // Limiter (ignition cut): 22 Hz square gating the engine between 0.2 and 1.0.
      const lim = rpm >= LIMITER_RPM && thr > 0.5;
      if (lim !== limiting) {
        limiting = lim;
        gate.gain.setTargetAtTime(lim ? 0.6 : 1, t, 0.005);
        lfoDepth.gain.setTargetAtTime(lim ? 0.4 : 0, t, 0.005);
      }
      // Whines.
      const spool = p.spool < 0 ? 0 : p.spool > 1 ? 1 : p.spool;
      oTurbo.frequency.setTargetAtTime(2200 + 0.55 * rpm * spool, t, tau);
      gTurbo.gain.setTargetAtTime((0.035 * spool * rpm) / 12500, t, tau);
      // MGU-H whistle: was 5–8.7 kHz at 0.012/0.02, a piercing tone on headphones; now 3.5–6.6 kHz at half the level.
      oH.frequency.setTargetAtTime(3500 + 0.25 * rpm, t, tau);
      gH.gain.setTargetAtTime(rpm > 9000 && thr > 0.8 ? (p.interior ? 0.01 : 0.006) : 0, t, tau);
      const fk = 900 + 18 * (p.speed > 0 ? p.speed : 0);
      oK1.frequency.setTargetAtTime(fk, t, tau);
      oK2.frequency.setTargetAtTime(2.03 * fk, t, tau);
      kDeploy.frequency.setTargetAtTime(fk, t, tau);
      kHarvest.frequency.setTargetAtTime(1.5 * fk, t, tau);
      const ek = p.ersKw < 0 ? -p.ersKw : p.ersKw;
      gK.gain.setTargetAtTime((0.05 * (ek > 120 ? 120 : ek)) / 120, t, tau);
      gKDeploy.gain.setTargetAtTime(p.ersKw > 0 ? 1 : 0, t, tau);
      gKHarvest.gain.setTargetAtTime(p.ersKw < 0 ? 1 : 0, t, tau);
      // Interior / exterior crossfade (≈ 120 ms): cockpit = airbox resonance + helmet low-pass; outside = tailpipe.
      if (p.interior !== interior) {
        interior = p.interior;
        const tv = 0.04;
        reson.frequency.setTargetAtTime(interior ? 280 : 1150, t, tv);
        reson.Q.setTargetAtTime(interior ? 1.2 : 1.4, t, tv);
        reson.gain.setTargetAtTime(interior ? 4 : 3, t, tv);
        exhaustLp.frequency.setTargetAtTime(interior ? 3500 : 20000, t, tv);
        shelf.gain.setTargetAtTime(interior ? 0 : SHELF_EXT_DB, t, tv);
      }
    },
    upshift(t) {
      // Cut / thump edges are ramped (3–8 ms): the instant gain steps were clicks at every shift.
      cut.gain.cancelScheduledValues(t);
      cut.gain.setTargetAtTime(0.3, t, 0.004);
      cut.gain.setTargetAtTime(1, t + 0.03, 0.008);
      thumpG.gain.cancelScheduledValues(t);
      thumpG.gain.setValueAtTime(0, t);
      thumpG.gain.linearRampToValueAtTime(0.3, t + 0.003);
      thumpG.gain.setTargetAtTime(0, t + 0.003, 0.01);
      // Bark: re-ignition crack at the end of the cut.
      this.pop(t + 0.03, 0.3);
    },
    downshift(t, pops, rand) {
      cut.gain.cancelScheduledValues(t);
      cut.gain.setTargetAtTime(1.26, t, 0.006);
      cut.gain.setTargetAtTime(1, t + 0.06, 0.012);
      for (let i = 0; i < pops; i++) this.pop(t + rand() * 0.15, 0.3);
    },
    pop(t, g) {
      // A crack (band-passed noise, colour and level varied per pop) with ~5 ms decay.
      // Headphone pass: a 0.8 ms attack ramp (the instant step was a full-band click), a darker colour (600–1800 Hz), and the
      // band-pass centre glides (1 ms) instead of jumping while the previous pop still rings.
      const h = hash01(t);
      popBp.frequency.setTargetAtTime(600 + 1200 * h, t > 0.002 ? t - 0.002 : 0, 0.001);
      popG.gain.cancelScheduledValues(t);
      popG.gain.setValueAtTime(0, t);
      popG.gain.linearRampToValueAtTime(g * (0.6 + 0.8 * hash01(t + 0.5)), t + 0.0008);
      popG.gain.setTargetAtTime(0, t + 0.0008, 0.006);
    },
    lift(t, amount) {
      wgG.gain.cancelScheduledValues(t);
      wgG.gain.setValueAtTime(0, t);
      wgG.gain.linearRampToValueAtTime(0.25 * amount, t + 0.01);
      wgG.gain.setTargetAtTime(0, t + 0.01, 0.09);
    },
    stop(t) {
      for (const s of [...sources, white, white2, pink]) {
        try {
          s.stop(t);
        } catch {
          /* already stopped */
        }
      }
    },
    disconnect() {
      for (const n of nodes) n.disconnect();
      nodes.length = 0;
    },
  };
}
