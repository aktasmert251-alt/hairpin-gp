// ?scene=audio (Sürüş): engine synth bench. Live: lil-gui rpm / throttle / speed / ERS / slip / interior, a 4 s
// idle → limiter sweep, gear up/down (cut, thump, blip, crackle), bus meters and a live waveform. &offline=1
// renders 2 s of a scripted sweep on an OfflineAudioContext through the same createAudioGraph and plots the
// waveform and spectrogram. S2-S8/S9: &live=1 starts audio at once with 19 synthetic AI cars circling the listener
// (scene audio cost in the header, window.__audioBench); &replay=<s> records a 20-car race headless and renders <s> s
// of it twice with renderReplayAudio (time + sample hashes in window.__replayAudio); &dettest=1 renders the engine
// offline 4× and compares (window.__det); &clip=revs|shifts|flyby (+ &view=cockpit) renders a realism test clip offline
// through the game's own driveEngine / scene path and plots it (rev sweep 4k→12k→4k, up/downshift sequence, AI fly-by
// at 300 km/h 10 m from a trackside listener). Sandbox only (English labels allowed in sandbox GUIs).

import GUI from 'lil-gui';
import type { SandboxScene } from '../../contracts/debug';
import type { EngineParams } from '../engine/engineVoice';
import { BUS_IDS, createAudioGraph, type AudioGraph } from '../graph';
import { renderEngineOffline, renderReplayAudio } from '../offline';
import { driveEngine, engineEvent, newEngineDrive } from '../engineDrive';
import { createReplayRecorder, createSim, defaultSessionConfig } from '../../game/index';
import { createSceneAudio, type SceneAudio } from '../scene';
import type { CarRenderState, ListenerPose, RenderFrame, ViewId } from '../../contracts/render';

const BG = '#0A0C0F';
const PANEL = '#11151B';
const TEXT = '#F2F4F7';
const DIM = '#8A94A3';
const WAVE = '#4FC3F7';
const GRID = '#1E242D';

/** Scripted 2 s sweep: idle, full-throttle pull, upshift, limiter, lift with overrun pops. */
function sweepAt(t: number, p: EngineParams): void {
  let rpm: number;
  let thr: number;
  if (t < 0.15) {
    rpm = 4000;
    thr = 0;
  } else if (t < 0.9) {
    rpm = 4000 + (7800 * (t - 0.15)) / 0.75;
    thr = 1;
  } else if (t < 1.6) {
    rpm = 9300 + (3150 * (t - 0.9)) / 0.7;
    thr = 1;
  } else if (t < 1.8) {
    rpm = 12450 + 50 * Math.sin(t * 190);
    thr = 1;
  } else {
    rpm = 12000 - 7000 * (t - 1.8);
    thr = 0;
  }
  p.rpm = rpm;
  p.throttle = thr;
  p.speed = 20 + 30 * t;
  p.ersKw = thr > 0.9 ? 120 : -120;
  p.spool = Math.min(1, Math.max(0, (t - 0.15) / 0.5)) * (t < 1.8 ? 1 : 0.4);
  p.interior = false;
}

type ClipCar = { rpm: number; throttle: number; brake: number; speed: number; ersKw: number };
/** Rev sweep: idle 0.5 s, full throttle 4k → 12k over 4 s, hold 0.5 s, lift 12k → 4k over 3 s. */
function revsAt(t: number, c: ClipCar): number {
  if (t < 0.5) [c.rpm, c.throttle] = [4000, 0];
  else if (t < 4.5) [c.rpm, c.throttle] = [4000 + (8000 * (t - 0.5)) / 4, 1];
  else if (t < 5) [c.rpm, c.throttle] = [12000, 1];
  else if (t < 8) [c.rpm, c.throttle] = [12000 - (8000 * (t - 5)) / 3, 0];
  else [c.rpm, c.throttle] = [4000, 0];
  c.speed = 30 + c.rpm / 200;
  c.ersKw = c.throttle > 0.9 ? 120 : -60;
  return 3;
}
/** Upshifts 3 → 7 at 11.6k (drop to 9.4k), lift + braking downshifts 7 → 3 every 0.35 s, back on throttle. */
function shiftsAt(t: number, c: ClipCar): number {
  c.brake = 0;
  if (t < 3.2) {
    const k = Math.floor(t / 0.8);
    [c.rpm, c.throttle, c.speed, c.ersKw] = [9400 + (2200 * (t - 0.8 * k)) / 0.8, 1, 40 + 12 * t, 120];
    return 3 + k;
  }
  if (t < 3.4) {
    [c.rpm, c.throttle, c.speed, c.ersKw] = [11600, 1, 80, 120];
    return 7;
  }
  if (t < 5.4) {
    [c.throttle, c.brake, c.speed, c.ersKw] = [0, 1, 80 - 25 * (t - 3.4), -120];
    if (t < 3.6) {
      c.rpm = 11600 - 3000 * (t - 3.4);
      return 7;
    }
    if (t < 4.65) {
      c.rpm = 11000 - (2000 * ((t - 3.6) % 0.35)) / 0.35;
      return 6 - Math.floor((t - 3.6) / 0.35);
    }
    c.rpm = 11000 - (2500 * (t - 4.65)) / 0.75;
    return 3;
  }
  [c.rpm, c.throttle, c.speed, c.ersKw] = [Math.min(11800, 8000 + 3000 * (t - 5.4)), t < 5.6 ? 0.4 : 1, 30 + 10 * (t - 5.4), 100];
  return 3;
}

function fft(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i]!;
      re[i] = re[j]!;
      re[j] = tr;
      const ti = im[i]!;
      im[i] = im[j]!;
      im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const half = len / 2;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < half; k++) {
        const wr = Math.cos(ang * k);
        const wi = Math.sin(ang * k);
        const ar = re[i + k + half]!;
        const ai = im[i + k + half]!;
        const xr = ar * wr - ai * wi;
        const xi = ar * wi + ai * wr;
        re[i + k + half] = re[i + k]! - xr;
        im[i + k + half] = im[i + k]! - xi;
        re[i + k] = re[i + k]! + xr;
        im[i + k] = im[i + k]! + xi;
      }
    }
  }
}

const scene: SandboxScene = {
  id: 'audio',
  title: 'Engine audio bench',
  async create({ canvas, uiRoot, params }) {
    const g = canvas.getContext('2d')!;
    const offline = params.get('offline') === '1';
    const state = { rpm: 6000, throttle: 0.5, speedKmh: 150, ersKw: 0, slip: 0.5, interior: false, rain: 0, aiCars: Number(params.get('cars') ?? 19), info: 'click "start audio" (browsers need a user gesture)' };
    // S2-S8: synthetic field for the scene audio (AI voices, Doppler fly-bys): cars on a 70 m circle round the listener.
    let sceneA: SceneAudio | null = null;
    const N_AI = 19;
    const mkCar = (id: number): Record<string, unknown> => ({
      id, visible: true, isPlayer: id === 0, px: 0, py: 0, pz: 0, fx: 1, fy: 0, fz: 0, speed: 0, rpm: 9000, gear: 6, throttle: 1, brake: 0,
      slip: [0, 0, 0, 0], wheelSurface: ['asphalt', 'asphalt', 'asphalt', 'asphalt'], ersKw: 0, pitLimiter: false,
    });
    const fakeCars = Array.from({ length: N_AI + 1 }, (_, i) => mkCar(i));
    const frame = {
      time: 0, frameDt: 0, alpha: 0, cars: fakeCars, playerId: 0, paused: false, view: 'tcam', lookBack: false,
      conditions: { tod: 'day', rain: 0, wetness: 0, lineWetness: 0, cloud: 0, time: 0 }, lights: { lit: 0, out: true },
      racingLine: { mode: 'off', profile: null, playerS: 0, playerSpeed: 0 }, yellowSectors: [false, false, false],
    } as unknown as RenderFrame;
    const lis: ListenerPose = { px: 0, py: 1, pz: 0, fx: 1, fy: 0, fz: 0, ux: 0, uy: 1, uz: 0, vx: 0, vy: 0, vz: 0, camera: 'tcam' };
    let simT = 0;
    let updMs = 0;
    let updN = 0;
    let ctx: AudioContext | null = null;
    let graph: AudioGraph | null = null;
    const analysers: AnalyserNode[] = [];
    let master: AnalyserNode | null = null;
    let sweepT = -1;
    let offlineBuf: AudioBuffer | null = null;
    const p: EngineParams = { rpm: 6000, throttle: 0.5, speed: 40, ersKw: 0, spool: 0, interior: false };
    let popSeed = 7;
    const rand = (): number => {
      popSeed = (popSeed * 16807) % 2147483647;
      return popSeed / 2147483647;
    };

    const startLive = async (): Promise<void> => {
      if (ctx) return;
      ctx = new AudioContext({ latencyHint: 'interactive' });
      graph = createAudioGraph(ctx);
      graph.setVolumes({ master: 0.9, engine: 1, sfx: 1, ambience: 1, ui: 1 }, ctx.currentTime);
      for (const id of BUS_IDS) {
        const a = new AnalyserNode(ctx, { fftSize: 1024 });
        graph.buses[id].connect(a);
        analysers.push(a);
      }
      master = new AnalyserNode(ctx, { fftSize: 2048 });
      graph.master.connect(master);
      sceneA = createSceneAudio(graph);
      graph.start(ctx.currentTime + 0.02);
      sceneA.start(ctx.currentTime + 0.02);
      await ctx.resume();
      offlineBuf = null;
      state.info = 'live';
    };

    const runOffline = async (): Promise<void> => {
      const t0 = performance.now();
      offlineBuf = await renderEngineOffline(2, { at: sweepAt, shifts: [{ t: 0.9, dir: 1 }], pops: [1.84, 1.87, 1.93, 1.97] });
      state.info = `offline render (OfflineAudioContext, same createAudioGraph): 2 s in ${(performance.now() - t0).toFixed(0)} ms`;
    };

    const gui = new GUI({ title: 'Engine audio', container: uiRoot });
    gui.domElement.style.cssText += ';position:absolute;right:8px;top:8px;z-index:10';
    gui.add({ start: () => void startLive() }, 'start').name('start audio');
    gui.add(state, 'rpm', 4000, 12500, 10).listen();
    gui.add(state, 'throttle', 0, 1, 0.01).listen();
    gui.add(state, 'speedKmh', 0, 340, 1).name('speed km/h');
    gui.add(state, 'ersKw', -120, 120, 1).name('ERS kW (+deploy)');
    gui.add(state, 'slip', 0, 2, 0.01).name('tyre slip σ');
    gui.add(state, 'interior');
    gui.add(state, 'rain', 0, 1, 0.01);
    gui.add(state, 'aiCars', 0, 19, 1).name('AI cars');
    gui.add({ ui: () => { if (sceneA && ctx) sceneA.ui('confirm', ctx.currentTime); } }, 'ui').name('ui: confirm');
    gui.add({ hit: () => { if (sceneA && ctx) sceneA.event({ type: 'collision', a: 0, b: 1, impulse: 8000, x: 0, y: 0, z: 0 }, 0, ctx.currentTime); } }, 'hit').name('impact 8 kN·s');
    gui.add({ sweep: () => { sweepT = 0; } }, 'sweep').name('4 s sweep idle → limiter');
    gui.add({ up: () => { if (graph && ctx) graph.engine.upshift(ctx.currentTime); } }, 'up').name('gear up');
    gui.add({ down: () => { if (graph && ctx) graph.engine.downshift(ctx.currentTime, 8, rand); } }, 'down').name('gear down');
    gui.add({ off: () => void runOffline() }, 'off').name('render 2 s offline');
    // Realism test clips through the game's engine driver / scene audio, 0.5 s pre-roll trimmed.
    const renderClip = async (kind: string, view: ViewId): Promise<void> => {
      const SR = 48000;
      const PRE = 0.5;
      const secs = kind === 'flyby' ? 6 : kind === 'shifts' ? 6.5 : 8.5;
      const octx = new OfflineAudioContext(2, Math.round((secs + PRE) * SR), SR);
      const og = createAudioGraph(octx, { offline: true });
      const cars = [mkCar(0), mkCar(1)] as unknown as CarRenderState[];
      const fr = { ...frame, cars, view } as RenderFrame;
      const pc = cars[0]!;
      const ai = cars[1]!;
      let sa: SceneAudio | null = null;
      const olis: ListenerPose = { ...lis, fx: 0, fz: 1 };
      if (kind === 'flyby') {
        sa = createSceneAudio(og, { hrtf: false });
        og.setVolumes({ master: 1, engine: 1, sfx: 0, ambience: 0, ui: 0 }, 0);
        og.buses.engine.gain.cancelScheduledValues(0);
        og.buses.engine.gain.value = 0;
        pc.visible = false;
      } else og.setVolumes({ master: 1, engine: 1, sfx: 1, ambience: 1, ui: 1 }, 0);
      const st = newEngineDrive();
      st.lastGear = 3;
      for (let i = 0; i <= (secs + PRE) * 60; i++) {
        const at = i / 60;
        const t = Math.max(0, at - PRE);
        if (sa) {
          ai.px = -83.3 * (secs / 2) + 83.3 * t;
          ai.pz = 10;
          ai.speed = 83.3;
          ai.rpm = 11500 + 150 * Math.sin(t * 3);
          ai.throttle = 1;
          sa.update(fr, olis, at, 1 / 60);
          continue;
        }
        const gear = (kind === 'shifts' ? shiftsAt : revsAt)(t, pc as unknown as ClipCar);
        if (at > PRE && gear !== st.lastGear) engineEvent(og, st, { type: 'gear', car: 0, gear }, 0, at);
        driveEngine(og, st, fr, pc, at, 1 / 60);
      }
      og.start(0);
      sa?.start(0);
      const full = await octx.startRendering();
      const skip = Math.round(PRE * SR);
      const out = new AudioBuffer({ numberOfChannels: 2, length: full.length - skip, sampleRate: SR });
      for (let ch = 0; ch < 2; ch++) out.copyToChannel(full.getChannelData(ch).subarray(skip), ch);
      offlineBuf = out;
      specLabel = kind === 'flyby' ? 'spectrogram 0–8 kHz: AI fly-by, 300 km/h, 10 m, trackside (Doppler, air absorption)'
        : kind === 'shifts' ? `spectrogram 0–8 kHz (${view}): 4 upshifts · lift + 4 downshifts under braking · back on throttle`
          : `spectrogram 0–8 kHz (${view}): rev sweep 4k → 12k (full throttle) → 4k (lift, overrun)`;
      state.info = `offline clip "${kind}" (${view}), ${secs} s`;
    };
    // S2-S9 (CR-08): record a 20-car replay headless, render `secs` of it offline twice (timing + sample hash).
    const runReplay = async (secs: number): Promise<void> => {
      const sim = createSim(defaultSessionConfig({ mode: 'race', aiCount: 19, seed: 7, laps: 3, autodrive: true }), { skipLights: true });
      const w = sim.world;
      const rec = createReplayRecorder();
      rec.begin(w);
      for (let i = 0; i < (secs + 1) * 240; i++) {
        sim.step();
        rec.sample(w);
        w.events.drain((e) => (rec as unknown as { event(w2: typeof w, e2: typeof e): void }).event(w, e));
      }
      const data = rec.end();
      const listener = (t: number, out: ListenerPose): ListenerPose => {
        // Follow the player car from 12 m behind (a TV-ish listener path).
        const f = Math.min(data.frameCount - 1, Math.floor(t * 60));
        const pid = Math.max(0, data.meta.findIndex((m) => m.isPlayer));
        const a = (f * data.meta.length + pid) * 44;
        out.px = data.cars[a]! - 12 * data.cars[a + 3]!;
        out.py = data.cars[a + 1]! + 3;
        out.pz = data.cars[a + 2]! - 12 * data.cars[a + 5]!;
        out.fx = data.cars[a + 3]!;
        out.fy = 0;
        out.fz = data.cars[a + 5]!;
        out.vx = data.cars[a + 3]! * data.cars[a + 9]!;
        out.vy = 0;
        out.vz = data.cars[a + 5]! * data.cars[a + 9]!;
        return out;
      };
      const opts = { from: 0.5, to: 0.5 + secs, sampleRate: 48000, listener, volumes: { master: 0.9, engine: 1, sfx: 1, ambience: 1, ui: 1 } };
      const hash = (b: AudioBuffer): string => {
        let h = 0x811c9dc5;
        for (let ch = 0; ch < b.numberOfChannels; ch++) {
          const u = new Uint32Array(b.getChannelData(ch).slice().buffer);
          for (let i = 0; i < u.length; i++) h = Math.imul(h ^ u[i]!, 0x01000193);
        }
        return (h >>> 0).toString(16);
      };
      const t0 = performance.now();
      const b1 = await renderReplayAudio(data, opts);
      const ms = performance.now() - t0;
      const b2 = await renderReplayAudio(data, opts);
      const h1 = hash(b1);
      const h2 = hash(b2);
      offlineBuf = b1;
      state.info = `replay audio: ${secs} s × 20 cars @ 48 kHz rendered in ${(ms / 1000).toFixed(2)} s; hashes ${h1} / ${h2} ${h1 === h2 ? '(identical)' : '(DIFFER)'}`;
      (window as unknown as { __replayAudio?: unknown }).__replayAudio = { secs, ms, h1, h2, length: b1.length };
    };
    gui.add({ rep: () => void runReplay(30) }, 'rep').name('render 30 s replay (20 cars)');
    let specLabel = 'spectrogram 0–8 kHz: idle · full-throttle pull · upshift cut · limiter · lift + overrun pops';
    if (offline) await runOffline();
    const clip = params.get('clip');
    if (clip) await renderClip(clip, (params.get('view') ?? 'chaseNear') as ViewId);
    if (params.get('replay')) await runReplay(Number(params.get('replay')));
    if (params.get('dettest') === '1') {
      const h = (b: AudioBuffer): string => { let x = 0x811c9dc5; const u = new Uint32Array(b.getChannelData(0).slice().buffer); for (let i = 0; i < u.length; i++) x = Math.imul(x ^ u[i]!, 0x01000193); return (x >>> 0).toString(16); };
      const sc = { at: sweepAt, shifts: [{ t: 0.9, dir: 1 as const }], pops: [1.84, 1.87] };
      const a1 = await renderEngineOffline(2, sc);
      const a2 = await renderEngineOffline(2, sc);
      const a3 = await renderEngineOffline(2, sc);
      const a4 = await renderEngineOffline(2, sc);
      const d1 = a1.getChannelData(0);
      const d2 = a2.getChannelData(0);
      let first = -1;
      let maxD = 0;
      for (let i = 0; i < d1.length; i++) {
        const dd = Math.abs(d1[i]! - d2[i]!);
        if (dd > 0 && first < 0) first = i;
        if (dd > maxD) maxD = dd;
      }
      (window as unknown as { __det?: unknown }).__det = { engine: [h(a1), h(a2), h(a3), h(a4)], first, maxD };
    }
    if (params.get('live') === '1') await startLive();

    const wave = new Float32Array(2048);
    const re = new Float32Array(1024);
    const im = new Float32Array(1024);
    const draw = (): void => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const W = Math.round(window.innerWidth * dpr);
      const H = Math.round(window.innerHeight * dpr);
      if (canvas.width !== W || canvas.height !== H) {
        canvas.width = W;
        canvas.height = H;
        canvas.style.width = '100%';
        canvas.style.height = '100%';
      }
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const w = W / dpr;
      const h = H / dpr;
      g.fillStyle = BG;
      g.fillRect(0, 0, w, h);
      g.fillStyle = TEXT;
      g.font = '700 22px "Segoe UI", system-ui, sans-serif';
      g.fillText('APEX GP · engine audio bench (V6 turbo hybrid)', 24, 40);
      g.font = '13px ui-monospace, Consolas, monospace';
      g.fillStyle = DIM;
      g.fillText(state.info, 24, 62);
      const pw = w - 340;
      if (offlineBuf) {
        const d0 = offlineBuf.getChannelData(0);
        const r = { x: 24, y: 90, w: pw, h: (h - 140) * 0.42 };
        g.fillStyle = PANEL;
        g.fillRect(r.x, r.y, r.w, r.h);
        g.strokeStyle = GRID;
        g.beginPath();
        g.moveTo(r.x, r.y + r.h / 2);
        g.lineTo(r.x + r.w, r.y + r.h / 2);
        g.stroke();
        g.strokeStyle = WAVE;
        g.beginPath();
        const per = d0.length / r.w;
        let peak = 0;
        let sum = 0;
        for (let i = 0; i < d0.length; i++) {
          const a = Math.abs(d0[i]!);
          if (a > peak) peak = a;
          sum += d0[i]! * d0[i]!;
        }
        for (let x = 0; x < r.w; x++) {
          let lo = 1;
          let hi = -1;
          for (let i = Math.floor(x * per); i < Math.floor((x + 1) * per); i++) {
            const s = d0[i]!;
            if (s < lo) lo = s;
            if (s > hi) hi = s;
          }
          g.moveTo(r.x + x, r.y + r.h / 2 - hi * r.h * 0.48);
          g.lineTo(r.x + x, r.y + r.h / 2 - lo * r.h * 0.48);
        }
        g.stroke();
        g.fillStyle = DIM;
        g.fillText(`waveform L · ${offlineBuf.duration.toFixed(1)} s @ ${offlineBuf.sampleRate} Hz · peak ${(20 * Math.log10(peak + 1e-9)).toFixed(1)} dBFS · RMS ${(10 * Math.log10(sum / d0.length + 1e-12)).toFixed(1)} dBFS`, r.x + 8, r.y + 18);
        const sr = { x: 24, y: r.y + r.h + 16, w: pw, h: (h - 140) * 0.55 };
        g.fillStyle = PANEL;
        g.fillRect(sr.x, sr.y, sr.w, sr.h);
        const N = 1024;
        const hop = 512;
        const frames = Math.floor((d0.length - N) / hop);
        const bins = Math.floor((8000 / offlineBuf.sampleRate) * N);
        const cw = sr.w / frames;
        const ch = sr.h / bins;
        for (let f = 0; f < frames; f++) {
          for (let i = 0; i < N; i++) {
            re[i] = d0[f * hop + i]! * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
            im[i] = 0;
          }
          fft(re, im);
          for (let b = 1; b < bins; b++) {
            const db = 10 * Math.log10(re[b]! * re[b]! + im[b]! * im[b]! + 1e-12);
            const v = Math.max(0, Math.min(1, (db + 30) / 70));
            g.fillStyle = `hsl(${220 - 200 * v},90%,${8 + 55 * v}%)`;
            g.fillRect(sr.x + f * cw, sr.y + sr.h - b * ch, cw + 0.6, ch + 0.6);
          }
        }
        g.fillStyle = TEXT;
        g.fillText(specLabel, sr.x + 8, sr.y + 18);
      } else if (master && graph) {
        master.getFloatTimeDomainData(wave);
        const r = { x: 24, y: 90, w: pw, h: h * 0.4 };
        g.fillStyle = PANEL;
        g.fillRect(r.x, r.y, r.w, r.h);
        g.strokeStyle = WAVE;
        g.beginPath();
        for (let i = 0; i < wave.length; i++) {
          const x = r.x + (r.w * i) / wave.length;
          const y = r.y + r.h / 2 - wave[i]! * r.h * 0.48;
          if (i === 0) g.moveTo(x, y);
          else g.lineTo(x, y);
        }
        g.stroke();
        BUS_IDS.forEach((id, k) => {
          const a = analysers[k]!;
          const buf = wave.subarray(0, 1024);
          a.getFloatTimeDomainData(buf);
          let s = 0;
          for (let i = 0; i < 1024; i++) s += buf[i]! * buf[i]!;
          const db = 10 * Math.log10(s / 1024 + 1e-12);
          const y = r.y + r.h + 30 + k * 30;
          g.fillStyle = PANEL;
          g.fillRect(24, y, pw, 20);
          g.fillStyle = WAVE;
          g.fillRect(24, y, (pw * Math.max(0, db + 60)) / 60, 20);
          g.fillStyle = TEXT;
          g.fillText(`${id} ${db.toFixed(1)} dB`, 30, y + 15);
        });
      }
    };

    return {
      update(dt) {
        if (sweepT >= 0) {
          sweepT += dt;
          const u = Math.min(1, sweepT / 4);
          state.rpm = 4000 + 8500 * u;
          state.throttle = u < 0.98 ? 1 : 0;
          if (sweepT > 4.5) {
            sweepT = -1;
            state.throttle = 0;
          }
        }
        if (graph && ctx) {
          p.rpm = state.rpm;
          p.throttle = state.throttle;
          p.speed = state.speedKmh / 3.6;
          p.ersKw = state.ersKw;
          p.spool += (state.throttle - p.spool) * Math.min(1, dt / (state.throttle > p.spool ? 0.4 : 0.25));
          p.interior = state.interior;
          const t = ctx.currentTime;
          graph.engine.set(p, t, 0.02);
          graph.setWind(p.speed, p.interior, t, 0.05);
          graph.setSqueal(state.slip, p.speed, false, t, 0.03);
          if (sceneA) {
            simT += dt;
            for (let i = 1; i <= N_AI; i++) {
              const c = fakeCars[i] as unknown as { visible: boolean; px: number; pz: number; fx: number; fz: number; speed: number; rpm: number; throttle: number };
              c.visible = i <= state.aiCars;
              const w = (0.6 + 0.04 * i) * (i % 2 === 0 ? 1 : -1);
              const a = w * simT + i;
              const R = 30 + 8 * i;
              c.px = R * Math.cos(a);
              c.pz = R * Math.sin(a);
              c.fx = -Math.sin(a) * Math.sign(w);
              c.fz = Math.cos(a) * Math.sign(w);
              c.speed = Math.abs(w) * R;
              c.rpm = 9000 + 2500 * Math.sin(simT + i);
              c.throttle = Math.sin(simT * 0.7 + i) > -0.3 ? 1 : 0;
            }
            const conds = frame.conditions as { rain: number; wetness: number };
            conds.rain = state.rain;
            conds.wetness = state.rain;
            const t0 = performance.now();
            sceneA.update(frame, lis, t, dt);
            updMs += performance.now() - t0;
            if (++updN >= 120) {
              state.info = `live · scene audio update ${(updMs / updN).toFixed(3)} ms/frame with ${state.aiCars} AI cars · voices ${sceneA.voices()}`;
              (window as unknown as { __audioBench?: number }).__audioBench = updMs / updN;
              updMs = 0;
              updN = 0;
            }
          }
        }
        draw();
      },
      dispose() {
        gui.destroy();
        if (sceneA && ctx) {
          sceneA.stop(ctx.currentTime);
          sceneA.disconnect();
        }
        if (graph && ctx) {
          graph.stop(ctx.currentTime);
          graph.disconnect();
        }
        if (ctx) void ctx.close();
      },
    };
  },
};

export default scene;
