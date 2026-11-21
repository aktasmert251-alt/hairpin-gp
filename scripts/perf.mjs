#!/usr/bin/env node
// APEX GP FPS sampler (Testçi, T4). Protocol: docs/design/rendering.md §11.2 and docs/design/testing-qc.md §4.
// System Chrome via Playwright (channel 'chrome'), HEADED, GPU flags of the protocol; no browser download.
//
//   node scripts/perf.mjs --port 5177 --presets high,ultra --scenarios A,C          race scenarios A/B/C (20 cars, autodrive)
//   node scripts/perf.mjs --serve --sprint1                                          Sprint 1 scene-level smoke (track High, car Ultra)
//   node scripts/perf.mjs --port 5177 --url "/?scene=track&quality=high" --name track-high --min-fps 100
//
// Flags:
//   --port <n>           dev server port (default 5177); --serve starts `vite --port <n> --strictPort` when nothing answers there
//   --presets <list>     low,medium,high,ultra (default high)
//   --scenarios <list>   A (day dry), B (sunset light), C (night heavy) (default A)
//   --sprint1            scene-level runs: ?scene=track&quality=high (gate >= 100 fps) and ?scene=car&quality=ultra (gate >= 60 fps)
//   --url <path> --name <label> [--preset <id>] [--min-fps <n>]   one custom page (scene-level)
//   --runs <n>           runs per scenario, the LOWER fps is kept (default 2)
//   --warmup <s> --sample <s> --cooldown <s>     defaults 10 / 30 / 20
//   --gate               exit 1 when a valid run fails a hard gate (P1); exit 2 when a run is invalid (not the discrete GPU)
//   --report             regenerate docs/qa/test-perf.md from every JSON in test-results/perf/
//   --gpu <regex>        override the discrete-GPU pattern (default NVIDIA|RTX 4060)
//   --uncapped           add --disable-frame-rate-limit --disable-gpu-vsync (the display refresh, 144 Hz here, otherwise caps every number)
// Output: test-results/perf/<yyyymmdd-hhmm>-<preset>-<scenario>.json  { preset, scenario, url, gpu, valid, fps, frameMsAvg, frameMsP95,
//   frameMsMax, hitches, simOverrun, renderer: { calls, triangles, geometries, textures, programs }, heapMB, ... }
// A run is `valid: false` when __APEX__.gpu does not match the discrete GPU pattern; invalid runs never count towards a gate.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';
import { BLOCK_VITE_HMR } from '../tests/helpers/pageInit.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PERF_DIR = path.join(ROOT, 'test-results', 'perf');
export const REPORT_FILE = path.join(ROOT, 'docs', 'qa', 'test-perf.md');
export const DEFAULT_PORT = 5177;
export const DEFAULT_GPU_PATTERN = 'NVIDIA|RTX\\s*4060';

/** rendering.md §11.2 step 2. */
export const PERF_FLAGS = [
  '--use-angle=d3d11',
  '--ignore-gpu-blocklist',
  '--force-device-scale-factor=1',
  '--window-size=1920,1080',
  '--window-position=0,0',
  '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding',
  '--disable-backgrounding-occluded-windows',
  '--enable-precise-memory-info',
];
/** Optional: measure headroom beyond the display refresh rate. */
export const UNCAPPED_FLAGS = ['--disable-frame-rate-limit', '--disable-gpu-vsync'];
export const VIEWPORT = { width: 1920, height: 1080 };

export const PRESETS = ['low', 'medium', 'high', 'ultra'];
export const SCENARIOS = {
  A: { tod: 'day', weather: 'dry', label: 'A day dry' },
  B: { tod: 'sunset', weather: 'light', label: 'B sunset light' },
  C: { tod: 'night', weather: 'heavy', label: 'C night heavy' },
};

/** ARCHITECTURE §12 / rendering.md §11: per preset. `soft` gates are P2 (the plan only makes High and Ultra hard). */
export const BUDGETS = {
  low: { fps: 140, soft: true, p95Ms: 9, calls: 250, tris: 1.2e6, programs: 45 },
  medium: { fps: 120, soft: true, p95Ms: 10, calls: 320, tris: 2.0e6, programs: 50 },
  high: { fps: 100, soft: false, p95Ms: 12, calls: 400, tris: 3.0e6, programs: 55 },
  ultra: { fps: 60, soft: false, p95Ms: 20, calls: 520, tris: 4.0e6, programs: 60 },
};
/** Night + heavy rain on Ultra is allowed 50 fps (ARCHITECTURE §12). */
export const ULTRA_C_MIN_FPS = 50;
export const HITCH_MS = 50;

// ---- URLs ----------------------------------------------------------------------------------------------------------------------

/** Race scenario URL of the protocol: seed=4242&ai=19&laps=3&autodrive=1&autostart=1&skipLights=1&cam=chaseNear&quality=<preset>. */
export function raceScenarioUrl(preset, scenario) {
  const s = SCENARIOS[scenario];
  if (!s) throw new Error(`unknown scenario "${scenario}" (use A, B or C)`);
  return `/?seed=4242&ai=19&laps=3&autodrive=1&autostart=1&skipLights=1&cam=chaseNear&quality=${preset}&tod=${s.tod}&weather=${s.weather}&mute=1`;
}

/** Sprint 1 scene-level smoke set (sprint-1.md §6 row 12). */
export const SPRINT1_SCENES = [
  { name: 'track-high', url: '/?scene=track&quality=high&tod=day', preset: 'high', minFps: 100 },
  { name: 'car-ultra', url: '/?scene=car&quality=ultra', preset: 'ultra', minFps: 60 },
];

// ---- statistics ----------------------------------------------------------------------------------------------------------------

export function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))))];
}

/** Summarises frame deltas (ms) measured with requestAnimationFrame. The first delta is dropped. */
export function summariseDeltas(deltas) {
  const d = deltas.slice(1).filter((x) => x > 0 && x < 10_000);
  if (d.length === 0) return { frames: 0, fps: 0, frameMsAvg: 0, frameMsP95: 0, frameMsMax: 0, hitches: 0 };
  const sorted = [...d].sort((a, b) => a - b);
  const avg = d.reduce((a, b) => a + b, 0) / d.length;
  return {
    frames: d.length,
    fps: 1000 / avg,
    frameMsAvg: avg,
    frameMsP95: percentile(sorted, 0.95),
    frameMsMax: sorted[sorted.length - 1],
    hitches: d.filter((x) => x > HITCH_MS).length,
  };
}

// ---- one measurement -----------------------------------------------------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Opens `url` in a fresh headed-capable context, waits for `__APEX__.sceneReady`, warms up, samples frame times for `sampleS`
 * seconds and returns the metrics. `browser` is a Playwright Browser (headed for real runs).
 * Returns `{ skipped: <reason> }` when the page is the router's "unknown scene" index.
 */
export async function measureUrl(browser, { baseUrl, url, warmupS = 10, sampleS = 30, viewport = VIEWPORT, readyTimeoutMs = 180_000 }) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  await context.addInitScript(BLOCK_VITE_HMR);
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  try {
    await page.goto(new URL(url, baseUrl).toString(), { waitUntil: 'load', timeout: 60_000 });
    await page.waitForFunction(() => Boolean(window.__APEX__ && window.__APEX__.sceneReady), undefined, { timeout: readyTimeoutMs });
    if (/[?&]scene=/.test(url)) {
      const found = await page.evaluate(() => document.title.startsWith('HAIRPIN GP · '));
      if (!found) return { skipped: 'scene not found (router index page)' };
    }
    await sleep(warmupS * 1000);
    const gpu = await page.evaluate(() => window.__APEX__.gpu);
    await page.evaluate(() => window.__APEX__.resetPerf());
    const deltas = await page.evaluate(
      (ms) =>
        new Promise((resolve) => {
          const out = [];
          let last = performance.now();
          const t0 = last;
          const tick = (now) => {
            out.push(now - last);
            last = now;
            if (now - t0 >= ms) resolve(out);
            else requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        }),
      sampleS * 1000,
    );
    const apex = await page.evaluate(() => {
      const p = window.__APEX__.getPerf();
      const mem = performance.memory ? performance.memory.usedJSHeapSize / 1048576 : null;
      return { perf: p, heapMB: mem, errors: [...window.__APEX__.errors], state: window.__APEX__.state() };
    });
    const m = summariseDeltas(deltas);
    return {
      gpu,
      ...m,
      apexFps: apex.perf.fps,
      apexFrames: apex.perf.frames,
      simOverrun: apex.perf.simOverrun,
      renderer: apex.perf.renderer,
      heapMB: apex.heapMB === null ? null : Math.round(apex.heapMB * 10) / 10,
      state: apex.state,
      pageErrors: [...new Set([...errors, ...apex.errors])],
    };
  } finally {
    await context.close();
  }
}

// ---- gates ---------------------------------------------------------------------------------------------------------------------

/** Keeps the run with the lowest fps (protocol step 5) and the worst values of the other metrics. */
export function combineRuns(runs) {
  const ok = runs.filter((r) => !r.skipped);
  if (ok.length === 0) return runs[0];
  const lowest = ok.reduce((a, b) => (b.fps < a.fps ? b : a));
  return {
    ...lowest,
    frameMsP95: Math.max(...ok.map((r) => r.frameMsP95)),
    frameMsMax: Math.max(...ok.map((r) => r.frameMsMax)),
    hitches: Math.max(...ok.map((r) => r.hitches)),
    simOverrun: Math.max(...ok.map((r) => r.simOverrun)),
    pageErrors: [...new Set(ok.flatMap((r) => r.pageErrors))],
  };
}

/**
 * Gate results for one combined run. `kind` 'race' applies every budget; 'scene' only the fps floor (`minFps`).
 * Returns [{ metric, value, limit, pass, severity }].
 */
export function evaluateGates({ preset, scenario, kind, metrics, minFps }) {
  const b = BUDGETS[preset];
  const out = [];
  const add = (metric, value, limit, pass, severity) => out.push({ metric, value, limit, pass, severity });
  const fpsLimit = minFps ?? (preset === 'ultra' && scenario === 'C' ? ULTRA_C_MIN_FPS : b.fps);
  add('fps', metrics.fps, `>= ${fpsLimit}`, metrics.fps >= fpsLimit, b.soft && minFps === undefined ? 'P2' : 'P1');
  out.push({ metric: 'pageErrors', value: metrics.pageErrors.length, limit: '= 0', pass: metrics.pageErrors.length === 0, severity: 'P0' });
  if (kind === 'race') {
    add('p95 frame ms', metrics.frameMsP95, `<= ${b.p95Ms}`, metrics.frameMsP95 <= b.p95Ms, 'P1');
    add('simOverrun', metrics.simOverrun, '= 0', metrics.simOverrun === 0, 'P1');
    add('hitches > 50 ms', metrics.hitches, '= 0', metrics.hitches === 0, 'P1');
    const r = metrics.renderer;
    add('draw calls', r.calls, `<= ${b.calls}`, r.calls <= b.calls, 'P1');
    add('triangles', r.triangles, `<= ${b.tris}`, r.triangles <= b.tris, 'P1');
    add('programs', r.programs, `<= ${b.programs}`, r.programs <= b.programs, 'P1');
    if (metrics.heapMB !== null) add('heap MB', metrics.heapMB, '<= 400', metrics.heapMB <= 400, 'P1');
  }
  return out;
}

export function isValidGpu(gpu, pattern = DEFAULT_GPU_PATTERN) {
  return new RegExp(pattern, 'i').test(gpu ?? '');
}

// ---- output --------------------------------------------------------------------------------------------------------------------

function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

/** Writes test-results/perf/<yyyymmdd-hhmm>-<preset>-<scenario>.json and returns its path. */
export function writeResult(result) {
  mkdirSync(PERF_DIR, { recursive: true });
  // `scene:<name>` labels contain a colon, which NTFS would treat as an alternate data stream.
  const label = String(result.scenario).replace(/[^A-Za-z0-9_.-]+/g, '-');
  const file = path.join(PERF_DIR, `${stamp()}-${result.preset}-${label}.json`);
  writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`);
  return file;
}

export function loadResults() {
  if (!existsSync(PERF_DIR)) return [];
  return readdirSync(PERF_DIR)
    .filter((n) => n.endsWith('.json'))
    .sort()
    .map((n) => {
      try {
        return { file: n, ...JSON.parse(readFileSync(path.join(PERF_DIR, n), 'utf8')) };
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

const f1 = (x) => (typeof x === 'number' ? x.toFixed(1) : '-');

/** Markdown summary (docs/qa/test-perf.md): newest result per preset x scenario. */
export function renderReport(results) {
  const latest = new Map();
  for (const r of results) latest.set(`${r.preset}|${r.scenario}|${r.uncapped ? 'off' : 'on'}`, r);
  const rows = [...latest.values()].sort((a, b) => `${a.scenario}${PRESETS.indexOf(a.preset)}${a.uncapped ? 1 : 0}`.localeCompare(`${b.scenario}${PRESETS.indexOf(b.preset)}${b.uncapped ? 1 : 0}`));
  // File names carry the local run time (yyyymmdd-hhmm); the JSON field `when` is UTC.
  const whenOf = (r) => {
    const m = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})/.exec(r.file ?? '');
    return m ? `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}` : (r.when ?? r.file);
  };
  const gpus = [...new Set(rows.map((r) => r.gpu).filter(Boolean))];
  const lines = [
    '# Performance runs',
    '',
    'Generated by `node scripts/perf.mjs --report` from `test-results/perf/*.json` (newest run per preset, scenario and vsync mode; times are local). Protocol: `docs/design/rendering.md` §11.2, gates: ARCHITECTURE §12.',
    '',
    `GPU string(s): ${gpus.length ? gpus.map((g) => `\`${g}\``).join(', ') : '(no runs yet)'}`,
    '',
    '| When | Preset | Scenario | Vsync | Valid | FPS | p95 ms | max ms | Hitches | Overruns | Calls | Triangles | Programs | Heap MB | Gates |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|',
  ];
  for (const r of rows) {
    const failed = (r.gates ?? []).filter((g) => !g.pass).map((g) => `${g.metric} ${g.severity}`);
    const gate = !r.valid ? 'INVALID (not the discrete GPU)' : failed.length ? `FAIL: ${failed.join(', ')}` : 'pass';
    lines.push(
      `| ${whenOf(r)} | ${r.preset} | ${r.scenario} | ${r.uncapped ? 'off' : 'on'} | ${r.valid ? 'yes' : 'NO'} | ${f1(r.fps)} | ${f1(r.frameMsP95)} | ${f1(r.frameMsMax)} | ${r.hitches ?? '-'} | ${r.simOverrun ?? '-'} | ${r.renderer?.calls ?? '-'} | ${r.renderer?.triangles ?? '-'} | ${r.renderer?.programs ?? '-'} | ${r.heapMB ?? '-'} | ${gate} |`,
    );
  }
  lines.push('', 'Scenario `A` = day dry, `B` = sunset light rain, `C` = night heavy rain (race, 20 cars, autodrive); `scene:<name>` = sandbox scene at the stated preset. Vsync `on` means the 144 Hz display refresh caps the number; `off` was measured with `--uncapped`. Runs with `valid = NO` do not count (the page did not use the discrete GPU).', '');
  return lines.join('\n');
}

export function writeReport() {
  const text = renderReport(loadResults());
  mkdirSync(path.dirname(REPORT_FILE), { recursive: true });
  writeFileSync(REPORT_FILE, text);
  return REPORT_FILE;
}

// ---- matrix --------------------------------------------------------------------------------------------------------------------

/** Runs one scenario `runs` times (cool-down in between) and returns the combined, gated result (not yet written). */
export async function runScenario(browser, o) {
  const runs = [];
  for (let i = 0; i < o.runs; i++) {
    if (i > 0) await sleep(o.cooldownS * 1000);
    const r = await measureUrl(browser, { baseUrl: o.baseUrl, url: o.url, warmupS: o.warmupS, sampleS: o.sampleS });
    runs.push(r);
    if (r.skipped) break;
  }
  const first = runs[0];
  if (first.skipped) return { preset: o.preset, scenario: o.scenario, url: o.url, skipped: first.skipped, valid: false };
  const m = combineRuns(runs);
  const valid = isValidGpu(m.gpu, o.gpuPattern);
  const gates = evaluateGates({ preset: o.preset, scenario: o.scenarioId, kind: o.kind, metrics: m, minFps: o.minFps });
  return {
    preset: o.preset,
    scenario: o.scenario,
    url: o.url,
    when: new Date().toISOString().slice(0, 16).replace('T', ' '),
    gpu: m.gpu,
    valid,
    fps: m.fps,
    frameMsAvg: m.frameMsAvg,
    frameMsP95: m.frameMsP95,
    frameMsMax: m.frameMsMax,
    hitches: m.hitches,
    simOverrun: m.simOverrun,
    renderer: m.renderer,
    heapMB: m.heapMB,
    apexFps: m.apexFps,
    uncapped: Boolean(o.uncapped),
    runsFps: runs.map((r) => (r.skipped ? null : Math.round(r.fps * 10) / 10)),
    warmupS: o.warmupS,
    sampleS: o.sampleS,
    pageErrors: m.pageErrors,
    gates,
  };
}

// ---- CLI -----------------------------------------------------------------------------------------------------------------------

function usage(msg) {
  if (msg) console.error(`perf: ${msg}`);
  console.error('usage: node scripts/perf.mjs [--port 5177 | --serve] [--uncapped] [--presets high,ultra] [--scenarios A,B,C] [--sprint1] [--url <path> --name <label> --preset <id> --min-fps <n>] [--runs 2] [--warmup 10] [--sample 30] [--cooldown 20] [--gate] [--report] [--gpu <regex>]');
  process.exit(64);
}

function parseArgs(argv) {
  const o = {
    port: DEFAULT_PORT, serve: false, presets: ['high'], scenarios: ['A'], sprint1: false, url: null, name: null, preset: 'high', minFps: undefined,
    runs: 2, warmupS: 10, sampleS: 30, cooldownS: 20, gate: false, report: false, gpuPattern: DEFAULT_GPU_PATTERN, uncapped: false,
    /** true once any flag that selects something to measure was given */
    explicitRun: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => {
      const v = argv[++i];
      if (v === undefined) usage(`missing value for ${a}`);
      return v;
    };
    switch (a) {
      case '--port': o.port = Number(val()); break;
      case '--serve': o.serve = true; break;
      case '--presets': o.explicitRun = true; o.presets = val().split(',').map((s) => s.trim()).filter(Boolean); break;
      case '--scenarios': o.explicitRun = true; o.scenarios = val().split(',').map((s) => s.trim().toUpperCase()).filter(Boolean); break;
      case '--sprint1': o.explicitRun = true; o.sprint1 = true; break;
      case '--url': o.explicitRun = true; o.url = val(); break;
      case '--name': o.name = val(); break;
      case '--preset': o.preset = val(); break;
      case '--min-fps': o.minFps = Number(val()); break;
      case '--runs': o.runs = Number(val()); break;
      case '--warmup': o.warmupS = Number(val()); break;
      case '--sample': o.sampleS = Number(val()); break;
      case '--cooldown': o.cooldownS = Number(val()); break;
      case '--gate': o.gate = true; break;
      case '--report': o.report = true; break;
      case '--gpu': o.gpuPattern = val(); break;
      case '--uncapped': o.uncapped = true; break;
      case '-h': case '--help': usage(); break;
      default: usage(`unknown flag ${a}`);
    }
  }
  for (const p of [...o.presets, o.preset]) if (!PRESETS.includes(p)) usage(`unknown preset "${p}"`);
  for (const s of o.scenarios) if (!SCENARIOS[s]) usage(`unknown scenario "${s}"`);
  if (!(o.runs >= 1)) usage('--runs must be >= 1');
  return o;
}

async function isServing(url) {
  try {
    const res = await fetch(url);
    return res.ok;
  } catch {
    return false;
  }
}

async function waitForServer(url, timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (await isServing(url)) return;
    await sleep(250);
  }
  throw new Error(`dev server did not answer at ${url} within ${timeoutMs} ms`);
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.report && !o.explicitRun) {
    console.log(`wrote ${path.relative(ROOT, writeReport())}`);
    return 0;
  }
  const baseUrl = `http://localhost:${o.port}`;
  let server = null;
  let browser = null;
  let exit = 0;
  try {
    if (!(await isServing(`${baseUrl}/`))) {
      if (!o.serve) {
        console.error(`perf: nothing answers at ${baseUrl}. Start the dev server (npm run dev -- --port ${o.port} --strictPort) or pass --serve.`);
        return 2;
      }
      const vite = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
      server = spawn(process.execPath, [vite, '--port', String(o.port), '--strictPort'], { cwd: ROOT, stdio: ['ignore', 'ignore', 'pipe'] });
      server.stderr.on('data', (d) => process.stderr.write(`[vite] ${d}`));
      await waitForServer(`${baseUrl}/`, 30_000);
    }
    browser = await chromium.launch({ channel: 'chrome', headless: false, args: o.uncapped ? [...PERF_FLAGS, ...UNCAPPED_FLAGS] : PERF_FLAGS });
    console.log(`chrome ${browser.version()} (headed${o.uncapped ? ', uncapped' : ', vsync as configured'}), ${o.runs} run(s) per scenario, warm-up ${o.warmupS} s, sample ${o.sampleS} s`);

    const jobs = [];
    if (o.url) jobs.push({ kind: 'scene', preset: o.preset, scenario: `scene:${o.name ?? 'custom'}`, scenarioId: undefined, url: o.url, minFps: o.minFps });
    if (o.sprint1) for (const s of SPRINT1_SCENES) jobs.push({ kind: 'scene', preset: s.preset, scenario: `scene:${s.name}`, scenarioId: undefined, url: s.url, minFps: o.minFps ?? s.minFps });
    if (!o.url && !o.sprint1) {
      for (const preset of o.presets) for (const sc of o.scenarios) jobs.push({ kind: 'race', preset, scenario: sc, scenarioId: sc, url: raceScenarioUrl(preset, sc), minFps: o.minFps });
    }

    let invalid = 0;
    let failed = 0;
    for (const job of jobs) {
      console.log(`\n== ${job.preset} / ${job.scenario}: ${job.url}`);
      const result = await runScenario(browser, { ...job, uncapped: o.uncapped, baseUrl, runs: o.runs, warmupS: o.warmupS, sampleS: o.sampleS, cooldownS: o.cooldownS, gpuPattern: o.gpuPattern });
      if (result.skipped) {
        console.log(`   skipped: ${result.skipped}`);
        continue;
      }
      const file = writeResult(result);
      console.log(`   GPU       ${result.gpu}`);
      console.log(`   valid     ${result.valid}${result.valid ? '' : '  (does not match the discrete GPU pattern; this run does not count)'}`);
      console.log(`   fps       ${result.fps.toFixed(1)}  (runs: ${result.runsFps.join(', ')}; kept the lower)`);
      console.log(`   frame ms  avg ${result.frameMsAvg.toFixed(2)}  p95 ${result.frameMsP95.toFixed(2)}  max ${result.frameMsMax.toFixed(1)}  hitches ${result.hitches}  simOverrun ${result.simOverrun}`);
      console.log(`   renderer  calls ${result.renderer.calls}  tris ${result.renderer.triangles}  programs ${result.renderer.programs}  geometries ${result.renderer.geometries}  textures ${result.renderer.textures}  heap ${result.heapMB ?? '-'} MB`);
      for (const g of result.gates) console.log(`   ${g.pass ? 'pass' : 'FAIL'}  ${g.metric} ${typeof g.value === 'number' ? Number(g.value.toFixed(2)) : g.value} (${g.limit}) ${g.pass ? '' : g.severity}`);
      console.log(`   json      ${path.relative(ROOT, file)}`);
      if (!result.valid) invalid++;
      else if (result.gates.some((g) => !g.pass && g.severity !== 'P2')) failed++;
    }
    if (o.report) console.log(`\nwrote ${path.relative(ROOT, writeReport())}`);
    if (o.gate) exit = invalid > 0 ? 2 : failed > 0 ? 1 : 0;
  } catch (err) {
    console.error(`perf: ${err.stack ?? err}`);
    exit = 2;
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (server) server.kill();
  }
  return exit;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().then((code) => process.exit(code));
}
