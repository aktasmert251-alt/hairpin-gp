#!/usr/bin/env node
// HAIRPIN GP trailer renderer (GRA, Sprint 5b; motion-design pipeline). Drives `?scene=trailer` with window.seek(t) in
// Chrome (GPU flags) and pipes screenshots into ffmpeg-static. Needs a dev server: npm run dev -- --port 5175.
//
//   node scripts/render-trailer.mjs stills 1 3.6 9 23          -> media/trailer/out/stills/s_<t>.png
//   node scripts/render-trailer.mjs draft                      -> media/trailer/out/draft.mp4   (960x540, 30 fps, 1 sample)
//   node scripts/render-trailer.mjs master [--from a --to b] [--sub 6]  -> media/trailer/out/master_<a>_<b>.mp4 (1080p60)
//   node scripts/render-trailer.mjs concat                     -> media/trailer/out/master.mp4 (joins the master parts)
//   node scripts/render-trailer.mjs audio                      -> media/trailer/out/game.f32 (48 kHz stereo game audio)
//   node scripts/render-trailer.mjs sheet <video> <png>        -> contact sheet (2 fps, 6x5)
// Flags: --port 5175, --headed, --lang tr|en, --quality ultra|high.
// Master: N sub-frames per frame over a 0.5 shutter (180°), blended by ffmpeg tmix; samples never cross a hard cut.

import { spawn } from 'node:child_process';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import ffmpegPath from 'ffmpeg-static';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(root, 'media', 'trailer', 'out');
const argv = process.argv.slice(2);
const mode = argv[0];
const flag = (k, d) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : d;
};
const PORT = Number(flag('port', 5175));
const LANG = flag('lang', 'tr');
const QUALITY = flag('quality', 'ultra');
const DURATION = 30;
const GPU_FLAGS = ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--force-color-profile=srgb', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'];

function run(args, input) {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: [input ? 'pipe' : 'ignore', 'inherit', 'inherit'] });
    p.on('error', reject);
    p.on('exit', (c) => (c === 0 ? resolve() : reject(new Error(`ffmpeg exit ${c}`))));
    if (input) input(p.stdin);
  });
}

async function openPage(w, h) {
  const browser = await chromium.launch({ channel: 'chrome', headless: !argv.includes('--headed'), args: GPU_FLAGS });
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.error('pageerror:', e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') console.error('console:', m.text());
  });
  const t0 = Date.now();
  await page.goto(`http://localhost:${PORT}/?scene=trailer&lang=${LANG}&quality=${QUALITY}`);
  await page.waitForFunction(() => window.trailerReady === true, null, { timeout: 600_000, polling: 500 });
  console.log(`scene ready in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  const cuts = await page.evaluate(() => window.trailerInfo.cuts);
  return { browser, page, cuts };
}

const seekShot = async (page, t) => {
  await page.evaluate((x) => window.seek(x), t);
  return page.screenshot({ type: 'png' });
};

/** Sub-frame sample times for frame time t (shutter 0.5 of 1/fps, centred), clamped to t's side of any cut. */
function samples(t, fps, n, cuts) {
  if (n <= 1) return [t];
  const span = 0.5 / fps;
  let lo = 0, hi = DURATION - 1e-4;
  for (const c of cuts) {
    if (c <= t) lo = Math.max(lo, c);
    else hi = Math.min(hi, c - 1e-4);
  }
  const out = [];
  for (let j = 0; j < n; j++) out.push(Math.min(hi, Math.max(lo, t - span / 2 + (span * (j + 0.5)) / n)));
  return out;
}

async function renderVideo(file, { w, h, fps, sub, from, to }) {
  const { browser, page, cuts } = await openPage(w, h);
  const f0 = Math.round(from * fps), f1 = Math.round(to * fps);
  const rate = fps * sub;
  // Sub-frames blended first, then sRGB PNG -> BT.709 TV range (tagged below).
  const blend = sub > 1 ? `tmix=frames=${sub}:weights='${Array(sub).fill(1).join(' ')}',select='not(mod(n+1\\,${sub}))',setpts=N/${fps}/TB,` : '';
  const vf = `${blend}scale=in_range=pc:out_range=tv:out_color_matrix=bt709,format=yuv420p`;
  const t0 = Date.now();
  await run(['-f', 'image2pipe', '-c:v', 'png', '-framerate', String(rate), '-i', '-', '-vf', vf, '-r', String(fps),
    '-c:v', 'libx264', '-preset', sub > 1 ? 'slow' : 'veryfast', '-crf', sub > 1 ? '12' : '20', '-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', file], async (stdin) => {
    for (let f = f0; f < f1; f++) {
      for (const t of samples(f / fps, fps, sub, cuts)) {
        const png = await seekShot(page, t);
        if (!stdin.write(png)) await new Promise((r) => stdin.once('drain', r));
      }
      if ((f - f0) % fps === 0) console.log(`  ${(f / fps).toFixed(1)} s  (${((Date.now() - t0) / 1000).toFixed(0)} s elapsed)`);
    }
    stdin.end();
  });
  await browser.close();
  console.log(`wrote ${file} in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}

mkdirSync(OUT, { recursive: true });
if (mode === 'stills') {
  const ts = [];
  for (let i = 1; i < argv.length; i++) {
    if (argv[i].startsWith('--')) i++;
    else ts.push(Number(argv[i]));
  }
  const dir = path.join(OUT, 'stills');
  mkdirSync(dir, { recursive: true });
  const { browser, page } = await openPage(Number(flag('w', 1920)), Number(flag('h', 1080)));
  for (const t of ts) {
    const png = await seekShot(page, t);
    const f = path.join(dir, `s_${t.toFixed(2)}.png`);
    writeFileSync(f, png);
    console.log(f);
  }
  await browser.close();
  // Contact sheet of this batch (3 columns, 640 px wide tiles).
  const list = path.join(dir, 'list.txt');
  writeFileSync(list, ts.map((t) => `file '${path.join(dir, `s_${t.toFixed(2)}.png`).split(path.sep).join('/')}'`).join('\n'));
  await run(['-f', 'concat', '-safe', '0', '-i', list, '-vf', `scale=640:-1,tile=3x${Math.ceil(ts.length / 3)}`, '-frames:v', '1', path.join(OUT, 'stills-sheet.png')]);
} else if (mode === 'draft') {
  await renderVideo(path.join(OUT, 'draft.mp4'), { w: 960, h: 540, fps: 30, sub: 1, from: Number(flag('from', 0)), to: Number(flag('to', DURATION)) });
} else if (mode === 'master') {
  const from = Number(flag('from', 0)), to = Number(flag('to', DURATION));
  await renderVideo(path.join(OUT, `master_${String(from).padStart(5, '0')}_${String(to).padStart(5, '0')}.mp4`), { w: 1920, h: 1080, fps: 60, sub: Number(flag('sub', 6)), from, to });
} else if (mode === 'concat') {
  const parts = readdirSync(OUT).filter((f) => /^master_[\d.]+_[\d.]+\.mp4$/.test(f)).sort();
  const list = path.join(OUT, 'parts.txt');
  writeFileSync(list, parts.map((p) => `file '${path.join(OUT, p).split(path.sep).join('/')}'`).join('\n'));
  await run(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', path.join(OUT, 'master.mp4')]);
  console.log(`joined ${parts.join(', ')}`);
} else if (mode === 'audio') {
  const { browser, page } = await openPage(640, 360);
  const b64 = await page.evaluate(() => window.trailerAudio(48000));
  writeFileSync(path.join(OUT, 'game.f32'), Buffer.from(b64, 'base64'));
  await browser.close();
  console.log('wrote game.f32 (48 kHz, stereo interleaved float32)');
} else if (mode === 'sheet') {
  await run(['-i', argv[1], '-vf', `fps=${flag('fps', 2)},scale=${flag('scale', 320)}:-1,tile=${flag('tile', '6x5')}`, '-frames:v', '1', argv[2]]);
} else {
  console.error('usage: node scripts/render-trailer.mjs stills <t...> | draft | master [--from a --to b --sub n] | concat | audio | sheet <in> <out>');
  process.exit(64);
}
