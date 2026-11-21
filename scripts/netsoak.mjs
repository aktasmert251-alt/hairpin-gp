#!/usr/bin/env node
// Localhost only. Example: node scripts/netsoak.mjs --rooms 2 --bots 20 --minutes 5
// Delay is per direction; jitter is the server's extra 0..N ms, loss drops state batches only.
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const allowed = ['rooms', 'bots', 'minutes', 'hz', 'track', 'net-delay', 'net-jitter', 'net-loss', 'label'];
const options = {};
for (let i = 0; i < args.length; i += 2) {
  const name = args[i]?.replace(/^--/, '');
  if (!args[i]?.startsWith('--') || !allowed.includes(name) || !args[i + 1] || args[i + 1].startsWith('--')) {
    throw new Error(`Usage: --rooms N --bots M --minutes T [--hz 10|15|20] [--track ID] [--net-delay MS --net-jitter MS --net-loss PCT] [--label NAME]. Invalid: ${args[i]}`);
  }
  options[name] = args[i + 1];
}
function number(name, fallback, lo, hi, integer = false) {
  const v = Number(options[name] ?? fallback);
  if (!Number.isFinite(v) || v < lo || v > hi || (integer && !Number.isInteger(v))) throw new Error(`Invalid --${name}`);
  return v;
}
const profile = {
  rooms: number('rooms', 2, 1, 64, true), botsPerRoom: number('bots', 20, 1, 20, true),
  minutes: number('minutes', 5, 0.01, 1440), hz: number('hz', 20, 1, 20, true), track: options.track ?? 'bosphorus',
  delay: number('net-delay', 0, 0, 5000), jitter: number('net-jitter', 0, 0, 5000), loss: number('net-loss', 0, 0, 100),
};
const label = options.label ?? `${profile.rooms}x${profile.botsPerRoom}-${profile.minutes}m-d${profile.delay}`;
if (!/^[a-zA-Z0-9_.-]+$/.test(label)) throw new Error('Label must contain only letters, digits, dot, underscore and hyphen');

// Use the installed Vite directly, with runner config loading (node_modules is a read-only worktree junction).
await new Promise((resolve, reject) => {
  const build = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--config', 'tests/net/bundle.config.ts', '--configLoader', 'runner'],
    { cwd: root, windowsHide: true, stdio: 'inherit' });
  build.once('error', reject); build.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`Bot support build exit ${code}`)));
});
const { buildServer, ServerProcess, Fleet, DEFAULT_SETTINGS, makeLobby, startLobby, sleep, until } = await import('../tests/net/.generated/support.mjs');
await buildServer();
let srv;
let fleet;
let interrupted = false;
const interrupt = () => { interrupted = true; };
process.on('SIGINT', interrupt); process.on('SIGTERM', interrupt);
const samples = [];
const admissionErrors = [];
const groups = [];
const started = new Date().toISOString();
let failure;
let runningAt;
let completedMs = 0;
let previous;
let stopConfirmed = false;
const totals = () => {
  const out = { txMessages: 0, txBytes: 0, rxMessages: 0, rxBytes: 0, maxTxBytes: 0, maxRxBytes: 0 };
  for (const b of fleet?.bots ?? []) {
    out.txMessages += b.tx.messages; out.txBytes += b.tx.bytes;
    out.rxMessages += b.rx.messages; out.rxBytes += b.rx.bytes;
    out.maxTxBytes = Math.max(out.maxTxBytes, b.tx.maxBytes); out.maxRxBytes = Math.max(out.maxRxBytes, b.rx.maxBytes);
  }
  return out;
};
async function sample() {
  const at = performance.now();
  const health = await srv.health();
  const total = totals();
  const dt = previous ? (at - previous.at) / 1000 : 0;
  const window = {};
  for (const key of ['txMessages', 'txBytes', 'rxMessages', 'rxBytes']) window[`${key}PerS`] = dt ? (total[key] - previous.total[key]) / dt : 0;
  samples.push({ elapsedS: runningAt ? (at - runningAt) / 1000 : 0, health, traffic: window, total });
  previous = { at, total };
  console.log(JSON.stringify({ event: 'sample', elapsedS: samples.at(-1).elapsedS, sockets: health.sockets,
    cpuPct: health.cpuPct, rssMb: health.rssMb, lagP99Ms: health.lagP99Ms, ...window }));
}
try {
  srv = await ServerProcess.start(profile);
  fleet = new Fleet(srv.url);
  // Admit incrementally: a failed join is recorded at its actual seat, without silently reducing the requested load.
  for (let room = 0; room < profile.rooms; room++) {
    const bots = [];
    groups.push(bots);
    let code;
    for (let seat = 0; seat < profile.botsPerRoom; seat++) {
      try {
        const b = await fleet.add(`Load ${room + 1}-${seat + 1}`, { hz: profile.hz });
        if (seat === 0) code = await makeLobby([b], { ...DEFAULT_SETTINGS, trackId: profile.track, laps: 10 });
        else {
          const reply = b.next((m) => m.type === 'room' || m.type === 'error');
          b.send({ type: 'join', code });
          const m = await reply;
          if (m.type !== 'room') throw new Error(`Join ${code}: ${JSON.stringify(m)}`);
          b.send({ type: 'setReady', ready: true });
          await bots[0].waitFor((m) => m.type === 'room' && m.players.some((p) => p.id === b.id && p.ready));
        }
        bots.push(b);
      } catch (err) { admissionErrors.push({ room: room + 1, seat: seat + 1, error: String(err) }); throw err; }
    }
  }
  for (const group of groups) await startLobby(group);
  await until(() => groups.flat().every((b) => b.sent >= 1), 30_000, 'all requested bots driving');
  runningAt = performance.now(); await sample();
  while (!interrupted && performance.now() - runningAt < profile.minutes * 60_000) {
    await sleep(Math.min(10_000, profile.minutes * 60_000 - (performance.now() - runningAt)));
    if (interrupted) break;
    await sample();
    for (const group of groups) {
      if (!group[0].results) continue;
      const lobby = group[0].next((m) => m.type === 'room' && m.phase === 'lobby');
      group[0].send({ type: 'backToLobby' }); await lobby;
      for (const b of group) { b.results = null; b.send({ type: 'setReady', ready: true }); }
      await group[0].waitFor((m) => m.type === 'room' && m.phase === 'lobby' && m.players.every((p) => p.ready));
      await startLobby(group);
    }
    if (fleet.bots.some((b) => b.disconnects || b.errors.length)) throw new Error('Unexpected bot disconnect/error');
    if (srv.logs.some((l) => ['roomError', 'messageError'].includes(l.event))) throw new Error('Server exception');
  }
  completedMs = performance.now() - runningAt;
  if (interrupted) throw new Error('Interrupted before requested duration');
} catch (err) {
  failure = String(err instanceof Error ? err.stack : err);
  if (runningAt) completedMs = performance.now() - runningAt;
  if (srv) await sample().catch(() => {});
} finally {
  await fleet?.dispose();
  await srv?.stop();
  stopConfirmed = !srv || srv.child.exitCode !== null || srv.child.signalCode !== null;
  process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt);
}
const stats = (values) => values.length ? { min: Math.min(...values), mean: values.reduce((a, b) => a + b, 0) / values.length, max: Math.max(...values) } : null;
const steady = samples.slice(1);
const strikes = srv?.logs.filter((l) => l.event === 'strike') ?? [];
const summary = {
  status: failure ? 'failed' : strikes.length ? 'failed-strikes' : 'passed', machine: 'Windows dev PC, not the VM',
  host: { platform: process.platform, arch: process.arch, node: process.version, cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length },
  started, profile, requestedBots: profile.rooms * profile.botsPerRoom, admittedPerRoom: groups.map((g) => g.length),
  durationS: completedMs / 1000, port: srv?.port, serverPid: srv?.child.pid, serverEnvironment: srv?.environment,
  stopConfirmed, failure, admissionErrors,
  metrics: Object.fromEntries(['cpuPct', 'rssMb', 'lagP99Ms', 'msgInPerS', 'msgOutPerS'].map((key) => [key, stats(steady.map((s) => s.health[key]))])),
  traffic: Object.fromEntries(['txMessagesPerS', 'txBytesPerS', 'rxMessagesPerS', 'rxBytesPerS'].map((key) => [key, stats(steady.map((s) => s.traffic[key]))])),
  totals: totals(), strikes: strikes.length, strikeReasons: strikes.reduce((out, l) => ({ ...out, [l.reason]: (out[l.reason] ?? 0) + 1 }), {}),
  disconnects: fleet?.bots.reduce((n, b) => n + b.disconnects, 0) ?? 0,
  bots: fleet?.bots.map((b) => ({ id: b.id, name: b.opts.name, sent: b.sent, batches: b.batches, errors: b.errors, disconnects: b.disconnects, closeCode: b.closeCode })),
  samples, logs: srv?.logs, stderr: srv?.stderr,
  notes: ['CPU percent is server process percent of one core; bots run in this runner process.',
    'RSS is server RSS in MiB. Loop lag p99 is the server 10 s window p99 minus its 10 ms sampling resolution.',
    'Traffic measures application payload bytes at bot sockets, excludes WebSocket/TCP/IP framing; tx is client -> server, rx is server -> client.',
    'Per-window lag p99 maximum is not a percentile of all events. Admission failure is not a completed soak.',
    'Short PC runs do not satisfy the 2 h PC / 8 h VM capacity gate.'],
};
const fmt = (v) => v ? `${v.mean.toFixed(2)} / ${v.max.toFixed(2)}` : 'not measured';
const markdown = `# HAIRPIN GP network soak\n\nWindows dev PC, not the VM\n\nStatus: **${summary.status}**. Requested ${profile.rooms} rooms x ${profile.botsPerRoom} bots x ${profile.minutes} min; admitted [${summary.admittedPerRoom.join(', ')}]; driven ${(completedMs / 1000).toFixed(1)} s.\n\n` +
  `Requested server environment: ${JSON.stringify(summary.serverEnvironment)}.\n\n` +
  `| Metric | Mean / max |\n|---|---:|\n` +
  Object.entries(summary.metrics).map(([k, v]) => `| ${k} | ${fmt(v)} |`).join('\n') + '\n' +
  Object.entries(summary.traffic).map(([k, v]) => `| ${k} | ${fmt(v)} |`).join('\n') +
  `\n\nMax payload: client ${summary.totals.maxTxBytes} B; server ${summary.totals.maxRxBytes} B. Strikes: ${summary.strikes}; disconnects: ${summary.disconnects}. Server stopped: ${stopConfirmed}.\n\n` +
  (failure ? `Failure: ${failure.split('\n')[0]}\n\n` : '') + summary.notes.map((n) => `- ${n}`).join('\n') + '\n';
const output = path.join(root, 'test-results/net');
await mkdir(output, { recursive: true });
await writeFile(path.join(output, `soak-${label}.json`), JSON.stringify(summary, null, 2) + '\n');
await writeFile(path.join(output, `soak-${label}.md`), markdown);
console.log(markdown);
if (summary.status !== 'passed') process.exitCode = 1;
