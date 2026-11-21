// Scene audio beyond the player engine (S2-S8, audio.md §3–§8): AI voices with Doppler and panning, surfaces and
// kerbs, wet spray, impacts, rain bed + interior droplet ticks, crowd, UI / start / pit / DRS beeps, flashback and
// ducking. One instance per audio
// graph; `update(frame, listener, t, dt)` and the one-shot triggers take an explicit audio time `t`, so the live
// AudioSystem (t = ctx.currentTime) and the offline replay renderer (t = sample time) run the same code.
// Every node is created once; updates only write AudioParams (no allocation per frame).

import type { ListenerPose, RenderFrame } from '../contracts/render';
import type { PitPhase } from '../contracts/race';
import type { SimEvent } from '../contracts/sim';
import { crowdGain } from './ambience/stands';
import { engineCycleWave } from './engine/engineVoice';
import type { AudioGraph } from './graph';
import { sumTree } from './mix';
import { mulberry } from './noise';
import { activeVoices, dopplerRatio, MAX_AI_VOICES, newVoiceSelection, selectVoices } from './voices';

/** İstanbul main-track length (m) for the crowd ranges (the audio layer has no track query). */
const TRACK_L = 5338;
const TAU = 0.02;
const AI_LEVEL = 0.2;
/** AI roughness noise band (Hz). */
const AI_AM_LP = 150;

export type UiSoundKind = 'move' | 'confirm' | 'back' | 'error' | 'toggle' | 'open' | 'close';
export type NotifyLevel = 'info' | 'warn' | 'penalty' | 'good';

export interface SceneAudio {
  start(t: number): void;
  update(frame: RenderFrame, lis: ListenerPose, t: number, dt: number): void;
  event(e: SimEvent, playerId: number, t: number): void;
  ui(kind: UiSoundKind, t: number): void;
  notify(level: NotifyLevel, t: number): void;
  flashback(kind: 'open' | 'applied' | 'cancel', t: number): void;
  voices(): number;
  /** New session: forget the player's pit phase. */
  reset(): void;
  stop(t: number): void;
  disconnect(): void;
}

/** One-shot envelope on a gain param: 0 → peak in `a` s, exponential decay with time constant `d`. */
function env(p: AudioParam, t: number, peak: number, a: number, d: number): void {
  p.cancelScheduledValues(t);
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(peak, t + a);
  p.setTargetAtTime(0, t + a, d);
}

/**
 * `hrtf` (default false): HRTF panning for the 3 nearest voices. Offline renders must pass false: Chrome loads the HRTF database
 * asynchronously, so an OfflineAudioContext render could start before it is ready and two renders differed.
 */
export function createSceneAudio(g: AudioGraph, opts: { hrtf?: boolean } = {}): SceneAudio {
  // Default off since the 2026-10-20 headphone pass: Chrome's HRTF panner crossfades its impulse responses as a fast car
  // sweeps past (azimuth changes every frame), a comb-filtered crackle on headphones. Equal-power panning is clean.
  const hrtf = opts.hrtf ?? false;
  const ctx = g.ctx;
  const nodes: AudioNode[] = [];
  const srcs: AudioScheduledSourceNode[] = [];
  const keep = <T extends AudioNode>(n: T): T => {
    nodes.push(n);
    if (n instanceof AudioScheduledSourceNode) srcs.push(n);
    return n;
  };
  // Noise sources start at their own offset into the shared 2 s buffers, so no two layers play the same samples.
  const noiseSrcs: AudioBufferSourceNode[] = [];
  const noiseOff: number[] = [];
  const noiseSrc = (pink: boolean, offset: number): AudioBufferSourceNode => {
    const n = new AudioBufferSourceNode(ctx, { buffer: pink ? g.noise.pink : g.noise.white, loop: true });
    nodes.push(n);
    noiseSrcs.push(n);
    noiseOff.push(offset);
    return n;
  };

  // ---- AI voices (§5): engine-cycle wavetable at rpm/120 (same pulse model as the player), noise AM roughness,
  // low-pass = throttle brightness × air absorption by distance ----
  const wave = engineCycleWave(ctx, 0.42, 1);
  const vOsc: OscillatorNode[] = [];
  const vLp: BiquadFilterNode[] = [];
  const vAmD: GainNode[] = [];
  const vG: GainNode[] = [];
  const vPan: PannerNode[] = [];
  const amRms = 0.577 * Math.sqrt((1.11 * AI_AM_LP) / (ctx.sampleRate / 2));
  // Two shared roughness noise streams (voice k uses stream k & 1): adjacent slots never share one, at 1/4 the cost.
  const amLps: BiquadFilterNode[] = [];
  for (let i = 0; i < 2; i++) {
    const lp = keep(new BiquadFilterNode(ctx, { type: 'lowpass', frequency: AI_AM_LP, Q: 0.7 }));
    noiseSrc(false, 0.13 + 0.71 * i).connect(lp);
    amLps.push(lp);
  }
  for (let k = 0; k < MAX_AI_VOICES; k++) {
    const o = keep(new OscillatorNode(ctx, { frequency: 40 }));
    o.setPeriodicWave(wave);
    const lp = keep(new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 1200, Q: 0.7 }));
    const am = keep(new GainNode(ctx, { gain: 1 }));
    const amD = keep(new GainNode(ctx, { gain: 0.12 / amRms }));
    amLps[k & 1]!.connect(amD).connect(am.gain);
    const gn = keep(new GainNode(ctx, { gain: 0 }));
    const pn = keep(new PannerNode(ctx, {
      panningModel: hrtf && k < 3 ? 'HRTF' : 'equalpower', distanceModel: 'inverse', refDistance: 8, rolloffFactor: 1.2, maxDistance: 600,
    }));
    o.connect(lp).connect(am).connect(gn).connect(pn);
    vAmD.push(amD);
    g.feed('cars', pn);
    vOsc.push(o);
    vLp.push(lp);
    vG.push(gn);
    vPan.push(pn);
  }
  const sel = newVoiceSelection(64);
  const prevSlot = new Int32Array(MAX_AI_VOICES).fill(-1);

  // ---- Surfaces and kerbs (§3) ----
  const kerbOsc = keep(new OscillatorNode(ctx, { type: 'square', frequency: 30 }));
  const kerbLp = keep(new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 220 }));
  const kerbG = keep(new GainNode(ctx, { gain: 0 }));
  kerbOsc.connect(kerbLp).connect(kerbG);
  g.feed('sfx', kerbG);
  const gravelBp = keep(new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 1800, Q: 0.7 }));
  const gravelG = keep(new GainNode(ctx, { gain: 0 }));
  noiseSrc(false, 0.11).connect(gravelBp).connect(gravelG);
  g.feed('sfx', gravelG);
  const grassLp = keep(new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 400 }));
  const grassG = keep(new GainNode(ctx, { gain: 0 }));
  noiseSrc(true, 0.53).connect(grassLp).connect(grassG);
  g.feed('sfx', grassG);
  const sprayHp = keep(new BiquadFilterNode(ctx, { type: 'highpass', frequency: 2000 }));
  const sprayG = keep(new GainNode(ctx, { gain: 0 }));
  noiseSrc(false, 0.71).connect(sprayHp).connect(sprayG);
  g.feed('sfx', sprayG);
  // Kerb thump (60 Hz, 80 ms) and impact (noise LP 400 Hz + 1.2 / 2.7 / 4.1 kHz partials, 0.3 s).
  const thumpOsc = keep(new OscillatorNode(ctx, { frequency: 60 }));
  const thumpG = keep(new GainNode(ctx, { gain: 0 }));
  thumpOsc.connect(thumpG);
  g.feed('sfx', thumpG);
  const impLp = keep(new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 400 }));
  const impG = keep(new GainNode(ctx, { gain: 0 }));
  noiseSrc(false, 1.13).connect(impLp).connect(impG);
  g.feed('sfx', impG);
  const impPartG = keep(new GainNode(ctx, { gain: 0 }));
  g.feed('sfx', impPartG);
  sumTree(ctx, impPartG, [1200, 2700, 4100].map((f) => keep(new OscillatorNode(ctx, { frequency: f }))), keep);

  // ---- Rain, crowd (§4) ----
  const rainHp = keep(new BiquadFilterNode(ctx, { type: 'highpass', frequency: 1500 }));
  const rainG = keep(new GainNode(ctx, { gain: 0 }));
  noiseSrc(true, 0.29).connect(rainHp).connect(rainG);
  g.feed('ambience', rainG);
  // Interior droplet ticks on the helmet (§4): band-passed clicks, 20 + 60·rain per second (Poisson, seeded).
  const dropBp = keep(new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 3500, Q: 3 }));
  const dropG = keep(new GainNode(ctx, { gain: 0 }));
  noiseSrc(false, 1.71).connect(dropBp).connect(dropG);
  g.feed('ambience', dropG);
  const dropRng = { s: 0x0d40 };
  const crowdBp = keep(new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 700, Q: 0.6 }));
  const crowdAm = keep(new GainNode(ctx, { gain: 0.8 }));
  const crowdLfo = keep(new OscillatorNode(ctx, { frequency: 0.2 }));
  const crowdLfoG = keep(new GainNode(ctx, { gain: 0.2 }));
  crowdLfo.connect(crowdLfoG).connect(crowdAm.gain);
  const crowdG = keep(new GainNode(ctx, { gain: 0 }));
  noiseSrc(true, 1.37).connect(crowdBp).connect(crowdAm).connect(crowdG);
  g.feed('ambience', crowdG);
  const cheerG = keep(new GainNode(ctx, { gain: 0 }));
  crowdAm.connect(cheerG);
  g.feed('ambience', cheerG);

  // ---- UI and beeps (§6): a sine blip voice, a square (error) voice and a noise whoosh ----
  const blip = keep(new OscillatorNode(ctx, { frequency: 1000 }));
  const blipG = keep(new GainNode(ctx, { gain: 0 }));
  blip.connect(blipG);
  g.feed('ui', blipG);
  const sq = keep(new OscillatorNode(ctx, { type: 'square', frequency: 220 }));
  const sqLp = keep(new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 1000 }));
  const sqG = keep(new GainNode(ctx, { gain: 0 }));
  sq.connect(sqLp).connect(sqG);
  g.feed('ui', sqG);
  const whBp = keep(new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 1000, Q: 2 }));
  const whG = keep(new GainNode(ctx, { gain: 0 }));
  noiseSrc(false, 0.91).connect(whBp).connect(whG);
  g.feed('ui', whG);

  const tone = (t: number, fStart: number, fEnd: number, dur: number, peak: number): void => {
    blip.frequency.cancelScheduledValues(t);
    blip.frequency.setValueAtTime(fStart, t);
    if (fEnd !== fStart) blip.frequency.setValueAtTime(fEnd, t + dur / 2);
    blipG.gain.cancelScheduledValues(t);
    blipG.gain.setValueAtTime(0, t);
    blipG.gain.linearRampToValueAtTime(peak, t + 0.003);
    blipG.gain.setValueAtTime(peak, t + dur - 0.005);
    blipG.gain.linearRampToValueAtTime(0, t + dur);
  };
  const whoosh = (t: number, fStart: number, fEnd: number, dur: number, peak: number): void => {
    whBp.frequency.cancelScheduledValues(t);
    whBp.frequency.setValueAtTime(fStart, t);
    whBp.frequency.exponentialRampToValueAtTime(fEnd, t + dur);
    env(whG.gain, t, peak, dur * 0.3, dur * 0.3);
  };

  let lastLit = 0;
  let nextLimBeep = 0;
  let nextDrop = 0;
  let pitPhase: PitPhase = 'none';
  let duckUntil = -1;
  let flashMuted = false;

  const sa: SceneAudio = {
    start(t) {
      for (const s of srcs) s.start(t);
      for (let i = 0; i < noiseSrcs.length; i++) noiseSrcs[i]!.start(t, noiseOff[i]);
    },
    update(frame, lis, t, dt) {
      const cars = frame.cars;
      const n = cars.length;
      const player = cars[frame.playerId];
      const l = ctx.listener;
      if (l.positionX) {
        l.positionX.setTargetAtTime(lis.px, t, TAU);
        l.positionY.setTargetAtTime(lis.py, t, TAU);
        l.positionZ.setTargetAtTime(lis.pz, t, TAU);
        l.forwardX.setTargetAtTime(lis.fx, t, TAU);
        l.forwardY.setTargetAtTime(lis.fy, t, TAU);
        l.forwardZ.setTargetAtTime(lis.fz, t, TAU);
        l.upX.setTargetAtTime(lis.ux, t, TAU);
        l.upY.setTargetAtTime(lis.uy, t, TAU);
        l.upZ.setTargetAtTime(lis.uz, t, TAU);
      }
      // AI voices.
      selectVoices(sel, cars, n, lis, t);
      for (let k = 0; k < MAX_AI_VOICES; k++) {
        const ci = sel.slot[k]!;
        const gn = vG[k]!;
        if (ci < 0 || ci >= n) {
          gn.gain.setTargetAtTime(0, t, 0.05);
          prevSlot[k] = -1;
          continue;
        }
        const c = cars[ci]!;
        const thr = frame.paused ? 0 : c.throttle;
        const r = dopplerRatio(c, lis);
        const pn = vPan[k]!;
        // Reassignment crossfade (150 ms): jump the position, ramp the gain up from 0.
        const fresh = prevSlot[k] !== ci;
        prevSlot[k] = ci;
        const posTau = fresh ? 0.001 : TAU;
        pn.positionX.setTargetAtTime(c.px, t, posTau);
        pn.positionY.setTargetAtTime(c.py, t, posTau);
        pn.positionZ.setTargetAtTime(c.pz, t, posTau);
        vOsc[k]!.frequency.setTargetAtTime((c.rpm / 120) * r, t, 0.03);
        const dx = c.px - lis.px;
        const dy = c.py - lis.py;
        const dz = c.pz - lis.pz;
        const air = 1 / (1 + Math.sqrt(dx * dx + dy * dy + dz * dz) / 150);
        vLp[k]!.frequency.setTargetAtTime((1000 + 5500 * thr) * air, t, TAU);
        // Headphone pass: noise AM 0.12–0.22 (was 0.18–0.35, near-gating on lifts = crackle on every passing car).
        vAmD[k]!.gain.setTargetAtTime((0.12 + 0.1 * (1 - thr)) / amRms, t, 0.06);
        if (fresh) gn.gain.setValueAtTime(0, t);
        // §5 gain 0.5 + 0.5·throttle, scaled so one AI car at 10 m peaks near −16 dBFS (§8).
        gn.gain.setTargetAtTime(AI_LEVEL * (0.5 + 0.5 * thr), t, fresh ? 0.05 : TAU);
      }
      if (!player) return;
      // Player surfaces.
      let kerbF = 0;
      let kerbS = 0;
      let gravel = 0;
      let grass = 0;
      let ash = 0;
      for (let w = 0; w < 4; w++) {
        const s = player.wheelSurface[w];
        if (s === 'kerbFlat') kerbF++;
        else if (s === 'kerbSausage') kerbS++;
        else if (s === 'gravel') gravel++;
        else if (s === 'grass') grass++;
        else if (s === 'ash') ash++;
      }
      const v = frame.paused ? 0 : player.speed;
      const vr = v < 30 ? v / 30 : 1;
      kerbOsc.frequency.setTargetAtTime(kerbS > 0 ? v / 0.5 : v / 1.0, t, TAU);
      kerbG.gain.setTargetAtTime(kerbS > 0 ? 0.25 * vr : (0.12 * kerbF) / 2, t, TAU);
      // Volcanic ash: a soft grit hiss on the gravel voice.
      gravelG.gain.setTargetAtTime(gravel > 0 ? 0.3 * vr : ash > 0 ? 0.1 * vr : 0, t, TAU);
      grassG.gain.setTargetAtTime(grass > 0 ? 0.2 * vr : 0, t, TAU);
      const wet = frame.conditions.wetness;
      sprayG.gain.setTargetAtTime(0.15 * wet * (v / 80 < 1 ? v / 80 : 1), t, 0.05);
      const rain = frame.conditions.rain;
      rainG.gain.setTargetAtTime(0.25 * rain, t, 0.2);
      if (frame.view === 'cockpit' && rain > 0.02 && !frame.paused) {
        if (nextDrop < t) nextDrop = t;
        while (nextDrop < t + 0.1) {
          dropBp.frequency.setValueAtTime(2200 + 3800 * mulberry(dropRng), nextDrop);
          dropG.gain.setValueAtTime(0.06 + 0.12 * mulberry(dropRng), nextDrop);
          dropG.gain.setTargetAtTime(0, nextDrop + 0.0005, 0.004);
          nextDrop += -Math.log(1 - mulberry(dropRng) * 0.999) / (20 + 60 * rain);
        }
      }
      crowdG.gain.setTargetAtTime(crowdGain(frame.racingLine.playerS, TRACK_L), t, 0.5);
      // Start lights: 600 Hz, 80 ms per light; ambience −6 dB while lit.
      const lit = frame.lights.out ? 0 : frame.lights.lit;
      if (lit > lastLit) tone(t, 600, 600, 0.08, 0.25);
      lastLit = lit;
      // Pit limiter beep: 1 kHz, 40 ms, every 0.5 s while engaged.
      if (player.pitLimiter && !frame.paused) {
        if (t >= nextLimBeep) {
          tone(t, 1000, 1000, 0.04, 0.12);
          nextLimBeep = t + 0.5;
        }
      } else if (pitPhase === 'entry' && !frame.paused) {
        // In the pit entry with the limiter off: 1.6 kHz, 30 ms, 6 per second until engaged.
        if (t >= nextLimBeep) {
          tone(t, 1600, 1600, 0.03, 0.15);
          nextLimBeep = t + 1 / 6;
        }
      } else nextLimBeep = t;
      // Ducking release.
      if (duckUntil >= 0 && t >= duckUntil) {
        duckUntil = -1;
        g.duck.gain.setTargetAtTime(1, t, 0.08);
      }
      void dt;
    },
    event(e, playerId, t) {
      switch (e.type) {
        case 'collision': {
          if (e.a !== playerId && e.b !== playerId) return;
          const x = Math.log10(e.impulse / 200) / 2;
          const k = x < 0 ? 0 : x > 1 ? 1 : x;
          env(impG.gain, t, 0.9 * k, 0.003, 0.08);
          env(impPartG.gain, t, 0.08 * k, 0.003, 0.1);
          break;
        }
        case 'kerb':
          if (e.car === playerId) env(thumpG.gain, t, e.sausage ? 0.5 : 0.2, 0.004, 0.03);
          break;
        case 'drsAvailable':
          if (e.car === playerId) tone(t, 2000, 2000, 0.02, 0.15);
          break;
        case 'pit':
          if (e.car === playerId) pitPhase = e.phase;
          break;
        case 'lightsOut':
          env(cheerG.gain, t, 0.6, 1.0, 1.0);
          break;
        case 'finish':
          if (e.car === playerId) env(cheerG.gain, t, 0.6, 0.5, 1.5);
          break;
        default:
          break;
      }
    },
    ui(kind, t) {
      switch (kind) {
        case 'move': tone(t, 2400, 2400, 0.015, 0.1); break;
        case 'confirm': tone(t, 880, 1320, 0.06, 0.2); break;
        case 'back': tone(t, 1320, 880, 0.06, 0.2); break;
        case 'toggle': tone(t, 1800, 1800, 0.01, 0.2); break;
        case 'error':
          sq.frequency.setValueAtTime(220, t);
          env(sqG.gain, t, 0.15, 0.005, 0.03);
          break;
        case 'open': whoosh(t, 400, 3000, 0.12, 0.3); break;
        case 'close': whoosh(t, 3000, 400, 0.12, 0.3); break;
      }
    },
    notify(level, t) {
      if (level === 'info') tone(t, 1200, 1200, 0.05, 0.2);
      else if (level === 'warn') tone(t, 1000, 1000, 0.12, 0.2);
      else if (level === 'good') tone(t, 660, 990, 0.12, 0.2);
      else {
        sq.frequency.cancelScheduledValues(t);
        sq.frequency.setValueAtTime(220, t);
        sq.frequency.setValueAtTime(277, t + 0.06);
        sq.frequency.setValueAtTime(330, t + 0.12);
        env(sqG.gain, t, 0.15, 0.005, 0.06);
      }
      if (level === 'warn' || level === 'penalty') {
        // Duck the AI cars and ambience −4 dB (attack 30 ms, hold 400 ms, release 250 ms); the player engine stays.
        g.duck.gain.setTargetAtTime(0.63, t, 0.01);
        duckUntil = t + 0.43;
      }
    },
    flashback(kind, t) {
      whoosh(t, 4000, 400, 0.4, 0.4);
      if (kind === 'open' && !flashMuted) {
        flashMuted = true;
        g.flashGate.gain.setTargetAtTime(0, t, 0.025);
      } else if (kind !== 'open' && flashMuted) {
        flashMuted = false;
        g.flashGate.gain.setTargetAtTime(1, t, 0.07);
      }
    },
    voices: () => activeVoices(sel),
    reset() {
      pitPhase = 'none';
    },
    stop(t) {
      for (const s of [...srcs, ...noiseSrcs]) {
        try {
          s.stop(t);
        } catch {
          /* already stopped */
        }
      }
    },
    disconnect() {
      for (const nd of nodes) nd.disconnect();
      nodes.length = 0;
      srcs.length = 0;
      noiseSrcs.length = 0;
    },
  };
  return sa;
}
