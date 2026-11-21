#!/usr/bin/env node
// HAIRPIN GP trailer audio (GRA, Sprint 5b; re-cut for D-047). Synthesizes the music and SFX (no third-party audio: CC0 by construction),
// mixes them with the game audio rendered offline from the replays (media/trailer/out/game.f32, from
// `node scripts/render-trailer.mjs audio`), normalises to -14 LUFS / TP -1.5 with a two-pass loudnorm and muxes the
// result onto a video.
//
//   node scripts/trailer-audio.mjs mix                     -> media/trailer/out/mix.wav (normalised)
//   node scripts/trailer-audio.mjs mux <video> <out.mp4>   -> H.264 crf 16 BT.709 TV range + AAC 256k, faststart
//
// Music: 120 BPM (beat 0.5 s), drop on lights out at 8.00 s (media/trailer/BEATMAP.md). Deterministic (seeded noise).

import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ffmpegPath from 'ffmpeg-static';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(root, 'media', 'trailer', 'out');
const SR = 48000;
const DUR = 30;
const N = SR * DUR;
const BEAT = 0.5;
const DROP = 8;
const LAMPS = [3.483, 4.483, 5.483, 6.483, 7.483]; // first lit frame of each lamp (replay 2.983 + 0.5)
const CUTS = [2, 5, 10, 12, 14, 16, 18, 20, 22]; // 8.5 (after the drop) has no whoosh: the drums carry it
const END = 26;

// ---- helpers ----
let seed = 0x5eed1234;
const rnd = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const L = new Float32Array(N), R = new Float32Array(N);
const add = (i, l, r = l) => {
  if (i >= 0 && i < N) {
    L[i] += l;
    R[i] += r;
  }
};
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const midi = (m) => 440 * 2 ** ((m - 69) / 12);

/** Kick: pitch-swept sine with a click. */
function kick(t0, g = 1) {
  let ph = 0;
  const n = Math.round(0.42 * SR);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const f = 48 + 110 * Math.exp(-t * 28);
    ph += (2 * Math.PI * f) / SR;
    const env = Math.exp(-t * 7.5) * (t < 0.002 ? t / 0.002 : 1);
    add(Math.round(t0 * SR) + i, Math.sin(ph) * env * 0.9 * g + (i < 60 ? (rnd() * 2 - 1) * 0.25 * g * (1 - i / 60) : 0));
  }
}
/** Clap / snare: band-passed noise bursts. */
function clap(t0, g = 1) {
  let lp = 0, hp = 0;
  const n = Math.round(0.3 * SR);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const x = rnd() * 2 - 1;
    lp += 0.35 * (x - lp);
    hp = x - lp;
    const env = (t < 0.012 ? 1 : t < 0.024 ? 0.6 : 1) * Math.exp(-t * 16);
    const s = hp * env * 0.42 * g;
    add(Math.round(t0 * SR) + i, s * 0.9, s);
  }
}
/** Hat: short high-passed noise. */
function hat(t0, g = 1, open = false) {
  let lp = 0;
  const n = Math.round((open ? 0.22 : 0.05) * SR);
  for (let i = 0; i < n; i++) {
    const x = rnd() * 2 - 1;
    lp += 0.6 * (x - lp);
    const env = Math.exp((-i / SR) * (open ? 14 : 70));
    const s = (x - lp) * env * 0.12 * g;
    add(Math.round(t0 * SR) + i, s, s * 0.8);
  }
}
/** Saw voice through a resonant low-pass (Chamberlin SVF); cutoff(t) in Hz. */
function saw(t0, dur, f, g, cutoff, { attack = 0.005, release = 0.06, detune = 0.006, pan = 0 } = {}) {
  const n = Math.round((dur + release) * SR);
  let p1 = rnd(), p2 = rnd(), low = 0, band = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    p1 = (p1 + (f * (1 + detune)) / SR) % 1;
    p2 = (p2 + (f * (1 - detune)) / SR) % 1;
    const x = p1 + p2 - 1;
    const fc = Math.min(0.99, 2 * Math.sin((Math.PI * Math.min(cutoff(t0 + t), 9000)) / SR));
    low += fc * band;
    const high = x - low - 0.35 * band;
    band += fc * high;
    const env = Math.min(1, t / attack) * (t > dur ? Math.exp(-(t - dur) / (release / 4)) : 1);
    const s = low * env * g;
    add(Math.round(t0 * SR) + i, s * (1 - pan * 0.5), s * (1 + pan * 0.5));
  }
}
/** Sine sub with soft attack. */
function sub(t0, dur, f, g) {
  const n = Math.round((dur + 0.05) * SR);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const env = Math.min(1, t / 0.01) * (t > dur ? Math.exp(-(t - dur) / 0.012) : 1);
    add(Math.round(t0 * SR) + i, Math.sin(2 * Math.PI * f * t) * env * g);
  }
}
/** Filtered noise sweep (riser / whoosh). */
function sweep(t0, dur, f0, f1, g, shape = (u) => u) {
  const n = Math.round(dur * SR);
  let low = 0, band = 0;
  for (let i = 0; i < n; i++) {
    const u = i / n;
    const f = f0 * (f1 / f0) ** u;
    const fc = Math.min(0.99, 2 * Math.sin((Math.PI * f) / SR));
    const x = rnd() * 2 - 1;
    low += fc * band;
    const high = x - low - 0.5 * band;
    band += fc * high;
    const s = band * shape(u) * g;
    add(Math.round(t0 * SR) + i, s, s * 0.92);
  }
}
/** Lamp blip: short sine beep with a soft body (start lights). */
function blip(t0, g) {
  const n = Math.round(0.16 * SR);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const env = Math.min(1, t / 0.002) * Math.exp(-t * 26);
    add(Math.round(t0 * SR) + i, (Math.sin(2 * Math.PI * 880 * t) * 0.6 + Math.sin(2 * Math.PI * 1760 * t) * 0.15) * env * g);
  }
}
/** Impact: low boom + noise thump. */
function impact(t0, g) {
  let ph = 0;
  const n = Math.round(1.8 * SR);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const f = 34 + 80 * Math.exp(-t * 10);
    ph += (2 * Math.PI * f) / SR;
    const env = Math.exp(-t * 2.4) * Math.min(1, t / 0.003);
    add(Math.round(t0 * SR) + i, (Math.sin(ph) * 0.9 + (rnd() * 2 - 1) * 0.2 * Math.exp(-t * 30)) * env * g);
  }
}

// ---- arrangement ----
// Chords (A minor, i - VI - III - VII): bass roots per bar after the drop.
const ROOTS = [45, 41, 48, 43]; // A2 F2 C3 G2
const PAD = [[57, 60, 64], [53, 57, 60], [55, 60, 64], [55, 59, 62]];
const bar = (t) => Math.floor(t / (4 * BEAT));
// Low-pass on the whole drop section, opens up at the hero shot.
const cut = (t) => (t < 22 ? 1700 : 2600);

// Intro 0-8: drone pad + sub pulse, ticking hats from 2 s, heartbeat kick, riser, a breath before the drop.
saw(0, 7.75, midi(33), 0.16, (t) => 180 + 900 * smooth(0, 7.7, t), { attack: 0.02, release: 0.2, detune: 0.01 });
saw(0, 7.75, midi(45), 0.06, (t) => 300 + 1600 * smooth(2, 7.7, t), { attack: 0.5, release: 0.2, detune: 0.012, pan: 0.3 });
for (let t = 0; t < 7.75; t += BEAT / 2) sub(t, 0.18, midi(33), 0.22 * (0.5 + 0.5 * smooth(0, 7.5, t)));
for (let t = 2; t < 7.75; t += BEAT / 4) hat(t, 0.5 + 0.5 * smooth(2, 7.5, t) * (Math.round(t / (BEAT / 4)) % 2 ? 0.6 : 1));
for (let t = 2; t < 7.6; t += BEAT) kick(t, 0.45 + 0.35 * smooth(2, 7.5, t));
sweep(5.0, 2.75, 300, 7000, 0.5, (u) => u * u);
impact(0, 0.55); // the hook hits on frame 0
for (const t of LAMPS) blip(t, 0.32);

// Drop 8-26.
impact(DROP, 1.0);
for (let t = DROP; t < END; t += BEAT) {
  const b = Math.round((t - DROP) / BEAT);
  kick(t, 0.95);
  if (b % 2 === 1) clap(t, 0.9);
  for (let k = 0; k < 4; k++) hat(t + (k * BEAT) / 4, k === 2 ? 1 : 0.55, k === 2 && b % 2 === 1);
  // Bass: 8ths on the bar root, octave jump on the last 8th of every bar.
  const root = ROOTS[bar(t - DROP) % 4];
  for (let k = 0; k < 2; k++) {
    const tt = t + (k * BEAT) / 2;
    const m = b % 4 === 3 && k === 1 ? root + 12 : root;
    saw(tt, BEAT / 2 - 0.03, midi(m - 12), 0.24, (x) => cut(x) * 0.5 + 120, { detune: 0.004 });
    sub(tt, BEAT / 2 - 0.03, midi(m - 12), 0.2);
  }
}
for (let t = DROP; t < END; t += 4 * BEAT) {
  const ch = PAD[bar(t - DROP) % 4];
  for (const m of ch) saw(t, 4 * BEAT - 0.05, midi(m), 0.035, cut, { attack: 0.08, release: 0.25, detune: 0.008, pan: m % 2 ? 0.4 : -0.4 });
  // Stab on every bar line.
  for (const m of ch) saw(t, 0.12, midi(m + 12), 0.05, () => 3200, { release: 0.15 });
}
// Hero lift 22-26: a lead line on top.
const LEAD = [69, 72, 76, 74, 72, 69, 67, 69];
LEAD.forEach((m, i) => saw(22 + i * BEAT, BEAT - 0.04, midi(m), 0.05, () => 2400, { attack: 0.01, release: 0.12, detune: 0.004, pan: 0.2 }));
// Transitions: a whoosh into each cut, and the end hit with a long pad tail.
for (const c of CUTS) if (c !== DROP) sweep(c - 0.32, 0.4, 900, 5200, 0.22, (u) => Math.sin(Math.PI * u) ** 2);
impact(END, 0.95);
// End card assembly: the name slides out of the GP block (26.2-27.0), the apex marker lands on 27.0.
sweep(END + 0.15, 0.7, 4200, 500, 0.16, (u) => Math.sin(Math.PI * u) ** 2);
blip(END + 1.0, 0.2);
for (const m of [45, 52, 57, 60, 64]) saw(END, 3.4, midi(m), m === 45 ? 0.12 : 0.04, (t) => 2000 * Math.exp(-(t - END) * 0.7) + 200, { attack: 0.01, release: 0.6, detune: 0.01 });

// ---- mix with the game audio ----
const gamePath = path.join(OUT, 'game.f32');
if (existsSync(gamePath)) {
  const g = new Float32Array(readFileSync(gamePath).buffer.slice(0));
  // Game level: loud in the hook and on board, under the music after the drop; ducked under the end card.
  const gGain = (t) => (t < 2 ? 1.0 : t < DROP ? 0.85 : t < 10 ? 0.7 : t < 12 ? 0.75 : t < END ? 0.45 : 0.3 * (1 - smooth(END, END + 1.5, t)));
  for (let i = 0; i < N && 2 * i + 1 < g.length; i++) {
    const k = gGain(i / SR);
    L[i] += g[2 * i] * k;
    R[i] += g[2 * i + 1] * k;
  }
} else console.warn('no game.f32: music + SFX only');
// Music bed level under the hook (engine first), final fade.
for (let i = 0; i < N; i++) {
  const t = i / SR;
  const f = t > DUR - 0.6 ? (DUR - t) / 0.6 : 1;
  L[i] *= f;
  R[i] *= f;
}

// Bus limiter (lookahead 5 ms, release 120 ms, ceiling 0.35) so the second loudnorm pass can stay linear.
{
  const CEIL = 0.35, LA = Math.round(0.005 * SR), REL = Math.exp(-1 / (0.12 * SR));
  const need = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const p = Math.max(Math.abs(L[i]), Math.abs(R[i]));
    need[i] = p > CEIL ? CEIL / p : 1;
  }
  // Gain = minimum over the lookahead window (instant attack), released exponentially.
  let env = 1;
  for (let i = 0; i < N; i++) {
    let m = 1;
    for (let k = 0; k <= LA && i + k < N; k++) m = Math.min(m, need[i + k]);
    env = m < env ? m : 1 - (1 - env) * REL;
    L[i] *= Math.min(env, need[i]);
    R[i] *= Math.min(env, need[i]);
  }
}

function wav(file, l, r) {
  const n = l.length;
  const buf = Buffer.alloc(44 + n * 8);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 8, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(3, 20); // float
  buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 8, 28);
  buf.writeUInt16LE(8, 32);
  buf.writeUInt16LE(32, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 8, 40);
  for (let i = 0; i < n; i++) {
    buf.writeFloatLE(l[i], 44 + i * 8);
    buf.writeFloatLE(r[i], 48 + i * 8);
  }
  writeFileSync(file, buf);
}

function ff(args) {
  return new Promise((resolve, reject) => {
    let err = '';
    const p = spawn(ffmpegPath, ['-hide_banner', '-y', ...args], { stdio: ['ignore', 'ignore', 'pipe'] });
    p.stderr.on('data', (d) => (err += d));
    p.on('exit', (c) => (c === 0 ? resolve(err) : reject(new Error(err.slice(-2000)))));
  });
}

const mode = process.argv[2];
if (mode === 'mix') {
  const raw = path.join(OUT, 'mix-raw.wav');
  wav(raw, L, R);
  const target = 'I=-14:TP=-1.5:LRA=11';
  const p1 = await ff(['-i', raw, '-af', `loudnorm=${target}:print_format=json`, '-f', 'null', '-']);
  const m = JSON.parse(p1.slice(p1.lastIndexOf('{'), p1.lastIndexOf('}') + 1));
  const af = `loudnorm=${target}:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true:print_format=json`;
  const p2 = await ff(['-i', raw, '-af', `${af},aresample=48000`, '-c:a', 'pcm_s24le', path.join(OUT, 'mix.wav')]);
  const m2 = JSON.parse(p2.slice(p2.lastIndexOf('{'), p2.lastIndexOf('}') + 1));
  console.log(`pass 1: I ${m.input_i} LUFS, TP ${m.input_tp}; pass 2 output: I ${m2.output_i} LUFS, TP ${m2.output_tp} dBTP (${m2.normalization_type})`);
} else if (mode === 'mux') {
  const [video, out] = process.argv.slice(3);
  await ff(['-i', video, '-i', path.join(OUT, 'mix.wav'), '-map', '0:v:0', '-map', '1:a:0',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p',
    '-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
    '-c:a', 'aac', '-b:a', '256k', '-ar', '48000', '-movflags', '+faststart', '-t', String(DUR), out]);
  console.log(`wrote ${out}`);
} else {
  console.error('usage: node scripts/trailer-audio.mjs mix | mux <video> <out.mp4>');
  process.exit(64);
}
