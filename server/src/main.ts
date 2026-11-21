// Entry point (bundled to apex-server.mjs). Environment:
//   PORT      listen port (default 8787 = local dev; 443 on the VM via apex.service)
//   HOST      public host name, logged only (the Origin check compares against the request's Host header)
//   DIST_DIR  built game directory (default <cwd>/dist)
//   MAX_ROOMS (6), MAX_PLAYERS_PER_ROOM (20, max 20), MAX_SOCKETS_PER_IP (24)  capacity knobs (D-048)
//   CERT_DIR  directory with key.pem + cert.pem (default <cwd>/certs); missing files = plain HTTP
//   TRUST_PROXY  'cloudflare' = behind cloudflared on this machine (quick tunnel): client IP from CF-Connecting-IP and https
//             from X-Forwarded-Proto, only for loopback peers (proxy.ts). Default: no proxy headers are trusted.
//   DATA_DIR  admin panel data: admin.json, bans.json, audit/ (default <cwd>/data; /opt/apex/data on the VM, D-050)
// Admin setup: node apex-server.mjs admin-setup <DATA_DIR>/admin.json (password on stdin; see deploy/oracle/admin-setup.sh).
// Test options (never on the VM): --net-delay <ms> [--net-jitter <ms>] [--net-loss <percent>] add artificial latency to
// every socket in each direction (design §6.2 T13); env NET_DELAY_MS / NET_JITTER_MS / NET_LOSS_PCT do the same.
import path from 'node:path';
import type { NetDelayConfig } from './config';
import { runAdminSetup } from './admin/setup';
import { createApexServer } from './server';
import { trustProxyFrom } from './proxy';

if (process.argv[2] === 'admin-setup') process.exit(await runAdminSetup(process.argv[3]));

function log(event: string, data: Record<string, unknown> = {}): void {
  // One JSON line per event on stdout; journald (systemd) keeps and rotates it on the VM.
  process.stdout.write(JSON.stringify({ t: new Date().toISOString(), event, ...data }) + '\n');
}

const port = Number(process.env.PORT ?? 8787);
const distDir = path.resolve(process.env.DIST_DIR ?? 'dist');
const certDir = path.resolve(process.env.CERT_DIR ?? 'certs');
const dataDir = path.resolve(process.env.DATA_DIR ?? 'data');
const trustProxy = trustProxyFrom(process.env.TRUST_PROXY);

function arg(name: string, env: string): number {
  const i = process.argv.indexOf(name);
  const raw = i >= 0 ? process.argv[i + 1] : process.env[env];
  const v = Number(raw ?? 0);
  return Number.isFinite(v) && v > 0 ? v : 0;
}
const netDelay: NetDelayConfig = {
  delayMs: arg('--net-delay', 'NET_DELAY_MS'), jitterMs: arg('--net-jitter', 'NET_JITTER_MS'), lossPct: Math.min(100, arg('--net-loss', 'NET_LOSS_PCT')),
};

function envInt(name: string): number | undefined {
  const v = Number(process.env[name]);
  return Number.isInteger(v) && v > 0 ? v : undefined;
}
const maxRooms = envInt('MAX_ROOMS');
const maxPlayersPerRoom = envInt('MAX_PLAYERS_PER_ROOM');
const game = { ...(maxRooms ? { maxRooms } : {}), ...(maxPlayersPerRoom ? { maxPlayersPerRoom } : {}) };
const apex = createApexServer({ distDir, certDir, dataDir, log, netDelay, game, sockets: { perIp: envInt('MAX_SOCKETS_PER_IP') },
  contactOrigins: (process.env.CONTACT_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean), trustProxy });
apex.server.on('error', (err) => {
  log('listenError', { error: String(err) });
  process.exit(1);
});
apex.server.listen(port, () => {
  log('listening', { port, tls: apex.tls, host: process.env.HOST ?? null, distDir, dataDir, node: process.version, netDelay, trustProxy });
  if (!apex.tls && port === 443) log('warning', { message: `no key.pem/cert.pem in ${certDir}: serving plain HTTP on 443` });
});

let stopping = false;
function shutdown(signal: string): void {
  if (stopping) return;
  stopping = true;
  log('shutdown', { signal });
  // WebSocket close handshakes can take a moment; never hang a systemd restart for long.
  setTimeout(() => process.exit(0), 3000).unref();
  void apex.close().then(() => process.exit(0));
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
