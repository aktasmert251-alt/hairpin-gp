// Builds the one-process server: HTTPS when <certDir> has key.pem + cert.pem (hot-reloaded), plain HTTP otherwise.
import http from 'node:http';
import https from 'node:https';
import { daysUntil, loadCerts, watchCerts, type CertFiles } from './certs';
import type { GameConfig, NetDelayConfig } from './config';
import { createAdmin, type Admin } from './admin/admin';
import type { AuthConfig } from './admin/auth';
import { EventRing } from './admin/events';
import { createRequestHandler } from './http';
import { Hub } from './hub';
import { Metrics } from './metrics';
import { WS_LIMITS } from './limits';
import { attachWs } from './ws';
import type { TrustProxy } from './proxy';
import path from 'node:path';
import { ContactStore, contactHandler } from './contact/index';

export interface ServerOptions {
  distDir: string;
  certDir: string;
  log: (event: string, data?: Record<string, unknown>) => void;
  /** Game config overrides (tests: short timeouts; capacities stay D-043 defaults otherwise). */
  game?: Partial<GameConfig>;
  /** Artificial latency (--net-delay). */
  netDelay?: NetDelayConfig;
  /** Socket caps; default total = maxRooms × maxPlayersPerRoom + 8 headroom, per IP = WS_LIMITS.maxSocketsPerIp (24). */
  sockets?: { total?: number; perIp?: number };
  /** Admin panel (D-050): admin.json, bans.json and audit/ live here. Omitted = no /admin. */
  dataDir?: string;
  /** Tests: admin clock and session/lockout timings. */
  adminNow?: () => number;
  adminAuth?: Partial<AuthConfig>;
  contactOrigins?: readonly string[];
  /** TRUST_PROXY=cloudflare: client IP / https scheme from cloudflared on this machine (loopback peers only; proxy.ts). */
  trustProxy?: TrustProxy;
}

export interface ApexServer {
  server: http.Server;
  tls: boolean;
  metrics: Metrics;
  hub: Hub;
  admin: Admin | null;
  close: () => Promise<void>;
}

/** Slow-loris and idle limits (deploy doc §1.3). Upgraded WebSocket sockets are exempt (ws clears the socket timeout). */
const TIMEOUT_MS = 10_000;
/** Sockets beyond the seats: lobby browsers, reconnects racing their own old socket. */
const SOCKET_HEADROOM = 8;

export function createApexServer(opts: ServerOptions): ApexServer {
  let certs: CertFiles | null = loadCerts(opts.certDir);
  const tls = certs !== null;
  const metrics = new Metrics();
  // Every log line also lands in the admin panel's recent-events ring.
  const events = new EventRing();
  const log = (event: string, data: Record<string, unknown> = {}): void => {
    events.push(event, data);
    opts.log(event, data);
  };
  const hub = new Hub(log, opts.game);
  const health = (): Record<string, unknown> => ({ ...metrics.snapshot(tls, certs ? daysUntil(certs.validTo) : null), ...hub.stats() });
  const contacts = opts.dataDir ? new ContactStore(path.join(opts.dataDir, 'contact.jsonl'), opts.adminNow) : undefined;
  const admin = opts.dataDir
    ? createAdmin({ dataDir: opts.dataDir, hub, tls, health, events, log, now: opts.adminNow, auth: opts.adminAuth, contacts, trustProxy: opts.trustProxy })
    : null;
  const handler = createRequestHandler({ distDir: opts.distDir, tls, health, admin: admin?.handle, privateDir: opts.dataDir, trustProxy: opts.trustProxy,
    contact: contacts ? contactHandler(contacts, tls, opts.contactOrigins, opts.trustProxy) : undefined });

  const server: http.Server = certs
    ? https.createServer({ key: certs.key, cert: certs.cert, minVersion: 'TLSv1.2' }, handler)
    : http.createServer(handler);
  server.headersTimeout = TIMEOUT_MS;
  server.requestTimeout = TIMEOUT_MS;
  server.keepAliveTimeout = 5_000;
  server.timeout = TIMEOUT_MS;

  const unwatch = tls
    ? watchCerts(server as https.Server, opts.certDir, (c) => (certs = c), log)
    : () => {};
  const closeWs = attachWs(server, metrics, tls, log, hub, opts.netDelay, {
    total: opts.sockets?.total ?? hub.cfg.maxRooms * hub.cfg.maxPlayersPerRoom + SOCKET_HEADROOM,
    perIp: opts.sockets?.perIp ?? WS_LIMITS.maxSocketsPerIp,
  }, opts.trustProxy);

  return {
    server,
    tls,
    metrics,
    hub,
    admin,
    close: () =>
      new Promise<void>((resolve) => {
        unwatch();
        contacts?.close();
        closeWs();
        hub.dispose();
        metrics.dispose();
        server.close(() => resolve());
        server.closeIdleConnections();
      }),
  };
}
