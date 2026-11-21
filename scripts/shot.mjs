#!/usr/bin/env node
// APEX GP screenshot tool (YÖN). System Chrome via Playwright (channel 'chrome'); no browser download.
//
//   node scripts/shot.mjs --port 5173 --url "/?scene=skeleton" --out test-results/screens/yon/skeleton.png
//
// Flags:
//   --port <n>            dev server port (required unless --serve)
//   --url "<path+query>"  page to open (default "/")
//   --out <png>           output file; missing directories are created (default test-results/screens/shot.png)
//   --width/--height      viewport, default 1920 x 1080
//   --wait ready|sceneReady|<ms>   default sceneReady; 60 s timeout
//   --delay <ms>          extra wait after ready (after --press/--eval)
//   --press <keys>        extra: comma-separated Playwright key names pressed after ready, e.g. "Enter" or "KeyC,KeyC"
//   --eval "<js>"         JS run in the page before capture (awaited if it returns a promise)
//   --headed              visible window (default headless)
//   --serve               start `vite --port <port> --strictPort` itself and stop it afterwards
//   --fail-on-errors      exit 1 when the page logged errors (console.error, pageerror, __APEX__.errors)
// Exit codes: 0 ok · 1 page errors with --fail-on-errors · 2 navigation/launch failure · 3 wait timeout · 4 eval failure · 64 bad usage

import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GPU_FLAGS = ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'];
const WAIT_TIMEOUT_MS = 60_000;

function usage(msg) {
  if (msg) console.error(`shot: ${msg}`);
  console.error('usage: node scripts/shot.mjs (--port <n> | --serve [--port <n>]) [--url "/?scene=id"] [--out file.png] [--width 1920 --height 1080] [--wait ready|sceneReady|<ms>] [--delay <ms>] [--press Enter] [--eval "<js>"] [--headed] [--fail-on-errors]');
  process.exit(64);
}

function parseArgs(argv) {
  const o = { port: null, url: '/', out: 'test-results/screens/shot.png', width: 1920, height: 1080, wait: 'sceneReady', delay: 0, press: [], eval: null, headed: false, serve: false, failOnErrors: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => {
      const v = argv[++i];
      if (v === undefined) usage(`missing value for ${a}`);
      return v;
    };
    switch (a) {
      case '--port': o.port = Number(val()); break;
      case '--url': o.url = val(); break;
      case '--out': o.out = val(); break;
      case '--width': o.width = Number(val()); break;
      case '--height': o.height = Number(val()); break;
      case '--wait': o.wait = val(); break;
      case '--delay': o.delay = Number(val()); break;
      case '--press': o.press = val().split(',').map((k) => k.trim()).filter(Boolean); break;
      case '--eval': o.eval = val(); break;
      case '--headed': o.headed = true; break;
      case '--serve': o.serve = true; break;
      case '--fail-on-errors': o.failOnErrors = true; break;
      case '-h': case '--help': usage(); break;
      default: usage(`unknown flag ${a}`);
    }
  }
  if (!o.serve && !(o.port > 0)) usage('--port is required unless --serve is given');
  if (!(o.width > 0 && o.height > 0)) usage('bad --width/--height');
  if (!['ready', 'sceneReady'].includes(o.wait) && !(Number(o.wait) >= 0)) usage('bad --wait');
  return o;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

async function waitForServer(url, timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`dev server did not answer at ${url} within ${timeoutMs} ms`);
}

function startVite(port) {
  const vite = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
  const child = spawn(process.execPath, [vite, '--port', String(port), '--strictPort'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stderr.on('data', (d) => process.stderr.write(`[vite] ${d}`));
  return child;
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const t = { start: Date.now() };
  let server = null;
  let browser = null;
  let exitCode = 0;
  const errors = [];
  try {
    if (o.serve) {
      if (!(o.port > 0)) o.port = await freePort();
      server = startVite(o.port);
      await waitForServer(`http://localhost:${o.port}/`, 30_000);
      t.served = Date.now();
    }
    const target = new URL(o.url, `http://localhost:${o.port}`).toString();
    try {
      browser = await chromium.launch({ channel: 'chrome', headless: !o.headed, args: GPU_FLAGS });
    } catch (err) {
      console.error(`shot: could not launch system Chrome: ${err.message}`);
      return 2;
    }
    t.launched = Date.now();
    const page = await browser.newPage({ viewport: { width: o.width, height: o.height }, deviceScaleFactor: 1 });
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
    });
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('requestfailed', (r) => errors.push(`requestfailed: ${r.url()} (${r.failure()?.errorText ?? '?'})`));

    try {
      const res = await page.goto(target, { waitUntil: 'load', timeout: WAIT_TIMEOUT_MS });
      if (!res || !res.ok()) throw new Error(`HTTP ${res ? res.status() : 'no response'}`);
    } catch (err) {
      console.error(`shot: navigation to ${target} failed: ${err.message}`);
      return 2;
    }
    t.loaded = Date.now();

    try {
      if (o.wait === 'ready' || o.wait === 'sceneReady') {
        const flag = o.wait;
        await page.waitForFunction((f) => Boolean(window.__APEX__ && window.__APEX__[f]), flag, { timeout: WAIT_TIMEOUT_MS });
      } else {
        await page.waitForTimeout(Number(o.wait));
      }
    } catch {
      console.error(`shot: timed out after ${WAIT_TIMEOUT_MS} ms waiting for ${o.wait}`);
      exitCode = 3;
    }
    t.ready = Date.now();

    for (const key of o.press) {
      await page.keyboard.press(key);
      await page.waitForTimeout(80);
    }
    if (o.eval) {
      try {
        const r = await page.evaluate(o.eval);
        if (r !== undefined) console.log(`eval → ${JSON.stringify(r)}`);
      } catch (err) {
        console.error(`shot: --eval failed: ${err.message}`);
        exitCode = exitCode || 4;
      }
    }
    if (o.delay > 0) await page.waitForTimeout(o.delay);
    // Two animation frames so the last change is presented.
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

    const out = path.resolve(root, o.out);
    mkdirSync(path.dirname(out), { recursive: true });
    await page.screenshot({ path: out, type: 'png' });
    t.shot = Date.now();

    const info = await page.evaluate(() => {
      const apex = window.__APEX__;
      return { gpu: apex?.gpu ?? '', errors: apex?.errors ?? [], state: apex?.state ? apex.state() : '?', sceneReady: apex?.sceneReady ?? false };
    });
    for (const e of info.errors) if (!errors.some((x) => x.includes(e.slice(0, 80)))) errors.push(`__APEX__: ${e}`);

    console.log(`url       ${page.url()}`);
    console.log(`out       ${path.relative(root, out)}`);
    console.log(`webgl     ${info.gpu || '(unknown)'}`);
    console.log(`state     ${info.state} (sceneReady=${info.sceneReady})`);
    const ms = (a, b) => (a && b ? `${b - a} ms` : '-');
    console.log(`timings   ${o.serve ? `serve ${ms(t.start, t.served)} · ` : ''}launch ${ms(t.served ?? t.start, t.launched)} · load ${ms(t.launched, t.loaded)} · ready ${ms(t.loaded, t.ready)} · capture ${ms(t.ready, t.shot)} · total ${ms(t.start, t.shot)}`);
    console.log(`errors    ${errors.length}`);
    for (const e of errors) console.log(`  - ${e}`);
    if (o.failOnErrors && errors.length > 0 && exitCode === 0) exitCode = 1;
    return exitCode;
  } catch (err) {
    console.error(`shot: ${err.stack ?? err}`);
    return 2;
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (server) server.kill();
  }
}

main().then((code) => process.exit(code));
