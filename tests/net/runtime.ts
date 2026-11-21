import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { HealthSnapshot } from '../../server/src/metrics';

// Works from the source and the support bundle (one directory deeper).
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), import.meta.url.includes('.generated/') ? '../../..' : '../..');
export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export async function until<T>(read: () => T | undefined | false | null, timeoutMs = 10_000, label = 'condition'): Promise<T> {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    const value = read();
    if (value !== undefined && value !== false && value !== null) return value;
    await sleep(20);
  }
  throw new Error(`Timed out after ${timeoutMs} ms: ${label}`);
}

export async function buildServer(): Promise<void> {
  // npm.cmd is a batch file: Windows requires cmd.exe. This constant command has no interpolated shell text.
  const command = process.platform === 'win32' ? 'cmd.exe' : 'npm';
  const args = process.platform === 'win32' ? ['/d', '/s', '/c', 'npm.cmd run server:build -- --configLoader runner'] : ['run', 'server:build', '--', '--configLoader', 'runner'];
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { cwd: ROOT, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (b: Buffer) => { output += b.toString(); });
    child.stderr.on('data', (b: Buffer) => { output += b.toString(); });
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`server:build exit ${code}\n${output}`)));
  });
}

export interface LogRow { event: string; [key: string]: unknown }
export type Health = HealthSnapshot & { players: number; rooms: { phase: string; humans: number; ai: number; droppedSteps: number }[] };
const leased = new Set<number>();

async function freePort(unavailable: ReadonlySet<number>): Promise<number> {
  for (let port = 8800; port <= 8899; port++) {
    if (leased.has(port) || unavailable.has(port)) continue;
    leased.add(port);
    const available = await new Promise<boolean>((resolve) => {
      const probe = createServer();
      probe.once('error', () => resolve(false));
      probe.listen({ port, host: '::', exclusive: true }, () => probe.close(() => resolve(true)));
    });
    if (available) return port;
    leased.delete(port);
  }
  throw new Error('No free test port in 8800-8899');
}

export class ServerProcess {
  readonly logs: LogRow[] = [];
  readonly stderr: string[] = [];
  private constructor(readonly child: ChildProcess, readonly port: number,
    readonly environment: { MAX_SOCKETS_PER_IP: string; MAX_PLAYERS_PER_ROOM: string; MAX_ROOMS: string }) {}
  get url(): string { return `ws://127.0.0.1:${this.port}/ws`; }

  static async start(net: { delay?: number; jitter?: number; loss?: number; rooms?: number } = {},
    unavailable = new Set<number>()): Promise<ServerProcess> {
    const port = await freePort(unavailable);
    const env: NodeJS.ProcessEnv = {
      ...process.env, MAX_SOCKETS_PER_IP: '64', PORT: String(port), CERT_DIR: path.join(ROOT, 'tests/net/.no-certs'),
    };
    // Acceptance cases exercise the committed room defaults, independent of a developer shell's capacity overrides.
    delete env.MAX_PLAYERS_PER_ROOM;
    delete env.MAX_ROOMS;
    if (net.rooms !== undefined) env.MAX_ROOMS = String(net.rooms);
    const child = spawn(process.execPath, ['server/dist/apex-server.mjs', '--net-delay', String(net.delay ?? 0),
      '--net-jitter', String(net.jitter ?? 0), '--net-loss', String(net.loss ?? 0)], {
      cwd: ROOT, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
      env,
    });
    const srv = new ServerProcess(child, port, {
      MAX_SOCKETS_PER_IP: '64', MAX_PLAYERS_PER_ROOM: '(server default)', MAX_ROOMS: env.MAX_ROOMS ?? '(server default)',
    });
    let pending = '';
    let spawnError: Error | undefined;
    child.once('error', (err) => { spawnError = err; });
    child.stdout!.on('data', (b: Buffer) => {
      pending += b.toString();
      const lines = pending.split('\n'); pending = lines.pop()!;
      for (const line of lines) {
        try { srv.logs.push(JSON.parse(line) as LogRow); } catch { srv.stderr.push(line); }
      }
    });
    child.stderr!.on('data', (b: Buffer) => srv.stderr.push(b.toString()));
    try {
      await until(() => {
        if (spawnError) throw spawnError;
        if (child.exitCode !== null) throw new Error(`Server exited ${child.exitCode}: ${JSON.stringify(srv.logs)} ${srv.stderr.join('')}`);
        return srv.logs.some((l) => l.event === 'listening') || undefined;
      }, 15_000, 'server listening');
      await srv.health();
      return srv;
    } catch (err) {
      await srv.stop();
      // Another test process can bind between the probe closing and this child listening.
      if (srv.logs.some((l) => l.event === 'listenError' && String(l.error).includes('EADDRINUSE'))) {
        unavailable.add(port);
        return ServerProcess.start(net, unavailable);
      }
      throw err;
    }
  }

  async health(): Promise<Health> {
    const res = await fetch(`http://127.0.0.1:${this.port}/health`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) throw new Error(`health HTTP ${res.status}`);
    return await res.json() as Health;
  }

  async stop(): Promise<void> {
    if (this.child.exitCode === null && this.child.signalCode === null && this.child.pid) {
      const exited = new Promise<void>((resolve) => this.child.once('exit', () => resolve()));
      this.child.kill('SIGTERM');
      const watchdog = setTimeout(() => this.child.kill('SIGKILL'), 4000);
      try { await exited; } finally { clearTimeout(watchdog); }
    }
    leased.delete(this.port);
  }
}

export async function writeEvidence(name: string, value: unknown): Promise<void> {
  const dir = path.join(ROOT, 'test-results/net');
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, `${name}.json`), JSON.stringify(value, null, 2) + '\n');
}
