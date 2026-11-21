// createAudioGraph (audio.md §1, §8, §9): the single graph factory used by the live AudioSystem and by offline
// rendering. Only nodes that exist on OfflineAudioContext are used (Oscillator, Gain, BiquadFilter, WaveShaper,
// AudioBufferSource, DynamicsCompressor, ConstantSource-free); no AudioWorklet, media nodes or resume().
//
// Buses: engine, cars, sfx, ambience, ui → master → compressor (−14 dB, knee 6, 3:1, 5/120 ms) → limiter
// (−1 dB, 20:1, 1/50 ms) → destination. Sprint 1 voices: player engine, wind, tyre squeal. The cars bus is narrowed
// (35 % mono blend) so a hard-panned AI car is ≈ 13 dB, not 30+ dB, between the ears. A showroom bed (pink LP 200 Hz,
// audio.md §7) bypasses the session gate and plays only on the title / menu screens.

import type { AudioSettings } from '../contracts/audio';
import { applyLevel, volumeGain } from './volume';
import { createEngineVoice, type EngineVoice } from './engine/engineVoice';
import { sumTree } from './mix';
import { createNoiseBuffers, type NoiseBuffers } from './noise';

export type BusId = 'engine' | 'cars' | 'sfx' | 'ambience' | 'ui';
export const BUS_IDS: readonly BusId[] = ['engine', 'cars', 'sfx', 'ambience', 'ui'];

export interface AudioGraphOptions { offline?: boolean; seed?: number }

export interface AudioGraph {
  readonly ctx: BaseAudioContext;
  readonly master: GainNode;
  readonly buses: Readonly<Record<BusId, GainNode>>;
  /** Pause/menu low-pass on the game buses. */
  readonly gameLp: BiquadFilterNode;
  /** Flashback gate on the game buses (engine, cars, sfx, ambience). */
  readonly flashGate: GainNode;
  /** Notification ducking on cars and ambience. */
  readonly duck: GainNode;
  /** Session gate on the game buses (ui unaffected). Open (1) by default; the live AudioSystem closes it outside a
   *  session so the idle engine does not drone in menus. */
  readonly live: GainNode;
  readonly engine: EngineVoice;
  readonly noise: NoiseBuffers;
  /** Registers a source for a bus; `finalize()` wires every bus through a deterministic summing tree. */
  feed(bus: BusId, src: AudioNode): void;
  /** Call once after every voice is created (before start). */
  finalize(): void;
  start(t: number): void;
  /** Wind (pink noise, LP 300 + 10·v), gain 0.35·(v/90)² interior / 0.2·(v/90)² exterior. */
  setWind(speed: number, interior: boolean, t: number, tau: number): void;
  /** Tyre squeal from the maximum normalised slip σ (1 = peak) and speed. */
  setSqueal(sigma: number, speed: number, lock: boolean, t: number, tau: number): void;
  setVolumes(v: AudioSettings, t: number): void;
  /** Title / main-menu ambience bed on or off (audio.md §7). */
  setShowroom(on: boolean, t: number): void;
  /** Game buses fade to silence (with a 600 Hz low-pass) over ~150 ms; ui unaffected. User request: no engine drone
   *  behind the pause menu (was −18 dB). */
  setPaused(p: boolean, t: number): void;
  stop(t: number): void;
  disconnect(): void;
}

function smoothstep(a: number, b: number, x: number): number {
  const t = x <= a ? 0 : x >= b ? 1 : (x - a) / (b - a);
  return t * t * (3 - 2 * t);
}

/** Showroom bed level × ambience² (audio.md §7 spec 0.05); 0 = off, per user request. */
const MENU_BED_LEVEL = 0;

export function createAudioGraph(ctx: BaseAudioContext, opts: AudioGraphOptions = {}): AudioGraph {
  const nodes: AudioNode[] = [];
  const keep = <T extends AudioNode>(n: T): T => {
    nodes.push(n);
    return n;
  };
  const noise = createNoiseBuffers(ctx, opts.seed ?? 0x5eed);
  const master = keep(new GainNode(ctx, { gain: 0.8 }));
  // Headphone pass (2026-10-20): a 5 ms attack / 120 ms release at 3:1 rode the engine's 40–100 Hz pulse train (gain
  // modulation inside the waveform = buzz); now 2.5:1, 10 ms / 250 ms, threshold −12 dB.
  const comp = keep(new DynamicsCompressorNode(ctx, { threshold: -12, knee: 6, ratio: 2.5, attack: 0.01, release: 0.25 }));
  const lim = keep(new DynamicsCompressorNode(ctx, { threshold: -1, knee: 0, ratio: 20, attack: 0.001, release: 0.05 }));
  master.connect(comp).connect(lim).connect(ctx.destination);
  const gameLp = keep(new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 20000, Q: 0.7 }));
  const gameGain = keep(new GainNode(ctx, { gain: 1 }));
  const live = keep(new GainNode(ctx, { gain: 1 }));
  gameLp.connect(gameGain).connect(live);
  const flashGate = keep(new GainNode(ctx, { gain: 1 }));
  flashGate.connect(gameLp);
  const duck = keep(new GainNode(ctx, { gain: 1 }));
  const buses = {} as Record<BusId, GainNode>;
  for (const id of BUS_IDS) buses[id] = keep(new GainNode(ctx, { gain: 1 }));
  // master ← live, ui, showroom (tree); flashGate ← duck, engine, sfx (tree); duck ← carsOut, ambience (2);
  // carsOut ← direct 0.65 + mono 0.35 (2).
  const carsOut = keep(new GainNode(ctx, { gain: 1 }));
  const carsDirect = keep(new GainNode(ctx, { gain: 0.65 }));
  const carsMono = keep(new GainNode(ctx, { gain: 0.35, channelCount: 1, channelCountMode: 'explicit', channelInterpretation: 'speakers' }));
  buses.cars.connect(carsDirect).connect(carsOut);
  buses.cars.connect(carsMono).connect(carsOut);
  carsOut.connect(duck);
  buses.ambience.connect(duck);
  sumTree(ctx, flashGate, [duck, buses.engine, buses.sfx], keep);
  const pending: Record<BusId, AudioNode[]> = { engine: [], cars: [], sfx: [], ambience: [], ui: [] };
  let finalized = false;

  // Showroom bed: pink noise LP 200 Hz, 0.05 × ambience², only while setShowroom(true).
  const bedSrc = keep(new AudioBufferSourceNode(ctx, { buffer: noise.pink, loop: true }));
  const bedLp = keep(new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 200, Q: 0.5 }));
  const bedG = keep(new GainNode(ctx, { gain: 0 }));
  bedSrc.connect(bedLp).connect(bedG);
  sumTree(ctx, master, [live, buses.ui, bedG], keep);
  let showroom = false;
  let ambVol = 1;

  const engine = createEngineVoice(ctx, noise);
  pending.engine.push(engine.output);

  // Wind.
  const pink = keep(new AudioBufferSourceNode(ctx, { buffer: noise.pink, loop: true }));
  const windLp = keep(new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 300, Q: 0.5 }));
  const windG = keep(new GainNode(ctx, { gain: 0 }));
  pink.connect(windLp).connect(windG);
  pending.ambience.push(windG);

  // Tyre squeal: noise band-pass (Q 6) + a 1.1 kHz tone with ±40 Hz jitter at 7 Hz.
  const white = keep(new AudioBufferSourceNode(ctx, { buffer: noise.white, loop: true, loopStart: 0.37 }));
  const sqBp = keep(new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 900, Q: 6 }));
  const sqTone = keep(new OscillatorNode(ctx, { type: 'sine', frequency: 1100 }));
  const sqJit = keep(new OscillatorNode(ctx, { type: 'sine', frequency: 7 }));
  const sqJitG = keep(new GainNode(ctx, { gain: 40 }));
  sqJit.connect(sqJitG).connect(sqTone.frequency);
  const sqToneG = keep(new GainNode(ctx, { gain: 0.35 }));
  const sqG = keep(new GainNode(ctx, { gain: 0 }));
  white.connect(sqBp).connect(sqG);
  sqTone.connect(sqToneG).connect(sqG);
  pending.sfx.push(sqG);

  const sources: AudioScheduledSourceNode[] = [pink, white, sqTone, sqJit, bedSrc];

  return {
    ctx, master, buses, gameLp, flashGate, duck, live, engine, noise,
    feed(bus, src) {
      pending[bus].push(src);
    },
    finalize() {
      if (finalized) return;
      finalized = true;
      for (const id of BUS_IDS) sumTree(ctx, buses[id], pending[id], keep);
    },
    start(t) {
      this.finalize();
      engine.start(t);
      for (const s of sources) s.start(t);
    },
    setWind(speed, interior, t, tau) {
      const r = speed / 90;
      windLp.frequency.setTargetAtTime(300 + 10 * speed, t, tau);
      windG.gain.setTargetAtTime((interior ? 0.35 : 0.2) * r * r, t, tau);
    },
    setSqueal(sigma, speed, lock, t, tau) {
      const inten = smoothstep(1.05, 1.5, sigma) * (speed < 15 ? speed / 15 : 1);
      sqBp.frequency.setTargetAtTime(lock ? 650 : 900 + 500 * (sigma - 1 > 0 ? sigma - 1 : 0), t, tau);
      sqTone.frequency.setTargetAtTime(lock ? 650 : 1100, t, tau);
      sqG.gain.setTargetAtTime(0.25 * inten, t, tau);
    },
    setVolumes(v, t) {
      const sq = volumeGain;
      // A slider at 0 is silence now, not a 50 ms glide (an exponential approach never reaches 0 exactly).
      const level = (p: AudioParam, g: number): void => applyLevel(p, g, t);
      level(master.gain, sq(v.master));
      level(buses.engine.gain, sq(v.engine));
      level(buses.cars.gain, sq(v.engine));
      level(buses.sfx.gain, sq(v.sfx));
      level(buses.ambience.gain, sq(v.ambience));
      level(buses.ui.gain, sq(v.ui));
      ambVol = sq(v.ambience);
      bedG.gain.setTargetAtTime(showroom ? 0.05 * ambVol : 0, t, 0.05);
    },
    setShowroom(on, t) {
      showroom = on;
      // Off by user preference: menus stay silent apart from ui sounds (the user disliked any menu drone).
      bedG.gain.setTargetAtTime(on ? MENU_BED_LEVEL * ambVol : 0, t, 0.3);
    },
    setPaused(p, t) {
      gameGain.gain.setTargetAtTime(p ? 0 : 1, t, 0.05);
      gameLp.frequency.setTargetAtTime(p ? 600 : 20000, t, 0.05);
    },
    stop(t) {
      engine.stop(t);
      for (const s of sources) {
        try {
          s.stop(t);
        } catch {
          /* already stopped */
        }
      }
    },
    disconnect() {
      engine.disconnect();
      for (const n of nodes) n.disconnect();
      nodes.length = 0;
    },
  };
}
