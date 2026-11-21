// Admin panel (D-050): /admin (static page) and the same-origin JSON API under /admin/api/*.
// Security: scrypt password + TOTP, per-network lockout with backoff, one login check at a time (scrypt runs on the
// libuv pool, never on the game loop), HttpOnly/Secure/SameSite=Strict session cookie (30 min idle, 8 h max, new id on
// every login), CSRF token header + exact Origin check + JSON-only bodies on every POST, strict CSP, no-store.
// Audit: every login, failure, lockout and action goes to the JSONL audit log with a network hash, never an IP.
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { CLOSE_BANNED, CLOSE_KICKED, type Admission, type Hub } from '../hub';
import { normalizeIp } from '../limits';
import { clientIp, isSecure, type TrustProxy } from '../proxy';
import type { Player } from '../player';
import { AuditLog } from './audit';
import { AUTH, LoginLimiter, Sessions, type AuthConfig, type Session } from './auth';
import { BanList } from './bans';
import { base32Decode, safeEqual, verifyPassword, verifyTotp, type PasswordHash } from './crypto';
import type { EventRing } from './events';
import { readJson } from './files';
import panelHtml from './panel/index.html?raw';
import panelJs from './panel/panel.js?raw';
import panelCss from './panel/panel.css?raw';
import { TYPES, STATUSES, type ContactStore, type ContactType, type ContactStatus } from '../contact/index';

export const COOKIE = '__Host-hpadmin';
const MAX_BODY = 2048;
const NOTICE_MAX = 200;
export const BAN_DURATIONS: Readonly<Record<string, number | null>> = { '1h': 3_600_000, '24h': 86_400_000, '7d': 604_800_000, perm: null };

/** <dataDir>/admin.json, written by the setup CLI (setup.ts). */
export interface AdminFile {
  v: 1;
  password: PasswordHash;
  totpSecret: string;
  createdAt: string;
}

export interface AdminOptions {
  dataDir: string;
  hub: Hub;
  tls: boolean;
  health: () => Record<string, unknown>;
  events: EventRing;
  log: (event: string, data?: Record<string, unknown>) => void;
  now?: () => number;
  auth?: Partial<AuthConfig>;
  contacts?: ContactStore;
  /** TRUST_PROXY (proxy.ts): client IP and https scheme from the local tunnel. */
  trustProxy?: TrustProxy;
}

export interface Admin {
  handle(req: IncomingMessage, res: ServerResponse): void;
  readonly admission: Admission;
  readonly bans: BanList;
  readonly sessions: Sessions;
}

const STATIC: Readonly<Record<string, { type: string; body: string }>> = {
  '/admin': { type: 'text/html; charset=utf-8', body: panelHtml },
  '/admin/': { type: 'text/html; charset=utf-8', body: panelHtml },
  '/admin/panel.js': { type: 'text/javascript; charset=utf-8', body: panelJs },
  '/admin/panel.css': { type: 'text/css; charset=utf-8', body: panelCss },
};

export function adminHeaders(tls: boolean): Record<string, string> {
  const h: Record<string, string> = {
    'Content-Security-Policy':
      "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; " +
      "base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Cache-Control': 'no-store',
  };
  if (tls) h['Strict-Transport-Security'] = 'max-age=31536000';
  return h;
}

export function readCookie(req: IncomingMessage, name: string): string | null {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim() || null;
  }
  return null;
}

/** Exact same-origin check: the browser's Origin must be this server's scheme + Host. */
function sameOrigin(req: IncomingMessage, tls: boolean, trust: TrustProxy): boolean {
  const secure = isSecure(req, tls, trust);
  const host = req.headers.host;
  return host !== undefined && req.headers.origin === `${secure ? 'https' : 'http'}://${host}`;
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve) => {
    let size = 0;
    const chunks: Buffer[] = [];
    let done = false;
    const finish = (v: unknown): void => {
      if (!done) {
        done = true;
        resolve(v);
      }
    };
    req.on('data', (c: Buffer) => {
      size += c.length;
      // Too big: answer 400 and drain the rest without keeping it.
      if (size > MAX_BODY) finish(undefined);
      else chunks.push(c);
    });
    req.on('end', () => {
      if (done) return;
      try {
        const v = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
        finish(typeof v === 'object' && v !== null && !Array.isArray(v) ? v : undefined);
      } catch {
        finish(undefined);
      }
    });
    req.on('error', () => finish(undefined));
  });
}

export function createAdmin(opts: AdminOptions): Admin {
  const now = opts.now ?? Date.now;
  const cfg: AuthConfig = { ...AUTH, ...opts.auth };
  const file = path.join(opts.dataDir, 'admin.json');
  const bans = new BanList(path.join(opts.dataDir, 'bans.json'), now);
  const audit = new AuditLog(path.join(opts.dataDir, 'audit'), now);
  const limiter = new LoginLimiter(cfg, now);
  const sessions = new Sessions(cfg, now);
  const hdr = adminHeaders(opts.tls);
  let loginBusy = false;
  let lastTotpStep = -1;
  let notice: { text: string; at: number } | null = null;

  const admission: Admission = {
    maintenance: false,
    banned: (keys) => bans.match(keys) !== null,
    notice: () => notice?.text ?? null,
  };
  opts.hub.admission = admission;

  const record = (event: string, data: Record<string, unknown>): void => {
    audit.write(event, data);
    opts.log(`admin.${event}`, data);
  };

  function send(res: ServerResponse, status: number, body: unknown, extra: Record<string, string> = {}): void {
    const buf = Buffer.from(JSON.stringify(body));
    res.writeHead(status, { ...hdr, ...extra, 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': buf.length });
    res.end(buf);
  }

  function cookie(id: string, maxAgeS: number): string {
    return `${COOKIE}=${id}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAgeS}`;
  }

  function loadCreds(): AdminFile | null {
    const f = readJson(file) as AdminFile | null;
    return f && f.v === 1 && f.password?.alg === 'scrypt' && typeof f.totpSecret === 'string' ? f : null;
  }

  async function login(req: IncomingMessage, res: ServerResponse, net: string): Promise<void> {
    const wait = limiter.waitMs(net);
    if (wait > 0) {
      record('loginLocked', { net: net.slice(0, 12) });
      return send(res, 429, { error: 'locked', retryS: Math.ceil(wait / 1000) });
    }
    if (loginBusy) return send(res, 429, { error: 'busy', retryS: 1 });
    const body = (await readBody(req)) as { password?: unknown; code?: unknown } | undefined;
    if (!body || typeof body.password !== 'string' || typeof body.code !== 'string' || body.password.length > 256) {
      return send(res, 400, { error: 'badRequest' });
    }
    const creds = loadCreds();
    if (!creds) return send(res, 503, { error: 'notConfigured' });
    loginBusy = true;
    let pwOk = false;
    try {
      pwOk = await verifyPassword(body.password, creds.password);
    } finally {
      loginBusy = false;
    }
    // Both factors are always checked, and the answer never says which one failed.
    const step = verifyTotp(base32Decode(creds.totpSecret), body.code.trim(), now(), lastTotpStep);
    if (!pwOk || step < 0) {
      const lock = limiter.fail(net);
      record('loginFail', { net: net.slice(0, 12), lockMs: lock });
      return send(res, 401, { error: 'invalid' });
    }
    lastTotpStep = step;
    limiter.success(net);
    sessions.destroy(readCookie(req, COOKIE));
    const { id, session } = sessions.create(net);
    record('login', { net: net.slice(0, 12) });
    send(res, 200, sessionInfo(session), { 'Set-Cookie': cookie(id, Math.floor(cfg.maxAgeMs / 1000)) });
  }

  function sessionInfo(s: Session): Record<string, unknown> {
    const t = now();
    return { csrf: s.csrf, idleLeftS: Math.round((cfg.idleMs - (t - s.lastSeen)) / 1000), maxLeftS: Math.round((cfg.maxAgeMs - (t - s.createdAt)) / 1000) };
  }

  function playerRow(p: Player): Record<string, unknown> {
    const car = p.room?.carOf(p);
    return {
      id: p.id, name: p.name, room: p.room?.code ?? null, pingMs: Math.round(p.peer?.pingMs ?? 0), connected: p.connected,
      stale: car?.stale ?? false, strikes: car?.strikes ?? 0, violations: car?.hardViolations ?? 0, device: bans.deviceTag(p.deviceId),
    };
  }

  function state(s: Session): Record<string, unknown> {
    const hub = opts.hub;
    return {
      session: sessionInfo(s),
      health: opts.health(),
      maintenance: admission.maintenance,
      notice,
      rooms: [...hub.rooms.values()].map((r) => ({
        code: r.code, ownerId: r.ownerId, track: r.settings.trackId, laps: r.settings.laps, ...r.stats(),
      })),
      players: [...hub.players.values()].map(playerRow),
      bans: bans.list().map((b) => ({
        id: b.id, name: b.name, reason: b.reason, createdAt: b.createdAt, expiresAt: b.expiresAt, device: b.device !== null, token: b.token !== null, network: b.net !== null,
      })),
      events: opts.events.recent().slice(0, 100),
    };
  }

  function action(name: string, body: Record<string, unknown>, s: Session): { status: number; body: unknown } {
    const net = s.net.slice(0, 12);
    const hub = opts.hub;
    switch (name) {
      case 'contact': {
        if (!opts.contacts || typeof body.id !== 'string' || typeof body.status !== 'string' || !['read', 'archived', 'delete'].includes(body.status)) return { status: 400, body: { error: 'badRequest' } };
        const ok = opts.contacts.change(body.id, body.status as ContactStatus | 'delete');
        if (ok) record('contactAction', { id: body.id, status: body.status });
        return { status: ok ? 200 : 404, body: { ok } };
      }
      case 'kick':
      case 'ban': {
        const p = typeof body.id === 'number' ? hub.playerById(body.id) : undefined;
        if (!p) return { status: 404, body: { error: 'noPlayer' } };
        if (name === 'kick') {
          hub.kick(p, CLOSE_KICKED, 'kicked');
          record('kick', { net, id: p.id, name: p.name });
          return { status: 200, body: { ok: true } };
        }
        const dur = typeof body.duration === 'string' && Object.hasOwn(BAN_DURATIONS, body.duration) ? BAN_DURATIONS[body.duration]! : undefined;
        if (dur === undefined) return { status: 400, body: { error: 'badDuration' } };
        const reason = typeof body.reason === 'string' ? body.reason.slice(0, 100) : '';
        const ban = bans.add(
          { deviceId: p.deviceId, token: p.token, ip: p.lastIp },
          { name: p.name, reason, durationMs: dur, network: body.network !== false },
        );
        hub.kick(p, CLOSE_BANNED, 'banned', ban.expiresAt);
        record('ban', { net, id: p.id, name: p.name, ban: ban.id, duration: body.duration, network: ban.net !== null, device: ban.device !== null, reason });
        return { status: 200, body: { ok: true, ban: ban.id } };
      }
      case 'unban': {
        const b = typeof body.banId === 'string' ? bans.remove(body.banId) : null;
        if (!b) return { status: 404, body: { error: 'noBan' } };
        record('unban', { net, ban: b.id, name: b.name });
        return { status: 200, body: { ok: true } };
      }
      case 'notice': {
        if (typeof body.text !== 'string' || body.text.length > NOTICE_MAX) return { status: 400, body: { error: 'badText' } };
        const text = body.text.replace(/[\u0000-\u001f\u007f‪-‮⁦-⁩]/g, ' ').trim();
        notice = text ? { text, at: now() } : null;
        hub.broadcastNotice(text);
        record('notice', { net, text });
        return { status: 200, body: { ok: true, notice } };
      }
      case 'maintenance': {
        if (typeof body.on !== 'boolean') return { status: 400, body: { error: 'badRequest' } };
        admission.maintenance = body.on;
        record('maintenance', { net, on: body.on });
        return { status: 200, body: { ok: true } };
      }
      default:
        return { status: 404, body: { error: 'notFound' } };
    }
  }

  async function api(req: IncomingMessage, res: ServerResponse, route: string): Promise<void> {
    const post = req.method === 'POST';
    if (!post && req.method !== 'GET') return send(res, 405, { error: 'method' }, { Allow: 'GET, POST' });
    // Browsers mark cross-site requests; refuse them outright (state reads included).
    const site = req.headers['sec-fetch-site'];
    if (site !== undefined && site !== 'same-origin' && site !== 'none') return send(res, 403, { error: 'crossSite' });
    if (post && (!sameOrigin(req, opts.tls, opts.trustProxy ?? 'none') || !(req.headers['content-type'] ?? '').startsWith('application/json'))) {
      return send(res, 403, { error: 'origin' });
    }
    const net = bans.net(clientIp(req, opts.trustProxy ?? 'none'));
    if (route === 'login') return post ? login(req, res, net) : send(res, 405, { error: 'method' });

    const sid = readCookie(req, COOKIE);
    // Background polling (GET state) does not count as activity; the idle timer runs on actions and page loads.
    const s = sessions.get(sid, post || route === 'session');
    if (!s) return send(res, 401, { error: 'auth' });
    if (!post) {
      if (route === 'inbox' && opts.contacts) {
        const query = new URL(req.url!, 'http://localhost').searchParams;
        const type = query.get('type') || undefined;
        const status = query.get('status') || undefined;
        if ((type && !TYPES.includes(type as ContactType)) || (status && !STATUSES.includes(status as ContactStatus))) return send(res, 400, { error: 'filter' });
        return send(res, 200, { messages: opts.contacts.list(type as ContactType | undefined, status as ContactStatus | undefined) });
      }
      if (route === 'session') return send(res, 200, sessionInfo(s));
      if (route === 'state') return send(res, 200, state(s));
      return send(res, 404, { error: 'notFound' });
    }
    if (!safeEqual(String(req.headers['x-csrf-token'] ?? ''), s.csrf)) {
      record('csrfFail', { net: net.slice(0, 12), route });
      return send(res, 403, { error: 'csrf' });
    }
    if (route === 'logout') {
      sessions.destroy(sid);
      record('logout', { net: net.slice(0, 12) });
      return send(res, 200, { ok: true }, { 'Set-Cookie': cookie('', 0) });
    }
    const body = (await readBody(req)) as Record<string, unknown> | undefined;
    if (!body) return send(res, 400, { error: 'badRequest' });
    const r = action(route, body, s);
    send(res, r.status, r.body);
  }

  function handle(req: IncomingMessage, res: ServerResponse): void {
    const url = req.url ?? '/';
    const q = url.search(/[?#]/);
    const p = q === -1 ? url : url.slice(0, q);
    if (p.startsWith('/admin/api/')) {
      const route = p.slice('/admin/api/'.length);
      api(req, res, /^[a-z]+$/.test(route) ? route : '').catch((err: unknown) => {
        opts.log('adminError', { error: String(err) });
        if (!res.headersSent) send(res, 500, { error: 'internal' });
      });
      return;
    }
    // Static files: an exact lookup in a fixed table, so no request path ever reaches the file system.
    const asset = Object.hasOwn(STATIC, p) ? STATIC[p] : undefined;
    const head = req.method === 'HEAD';
    if (!asset || (req.method !== 'GET' && !head)) {
      res.writeHead(asset ? 405 : 404, { ...hdr, 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(asset ? 'Method Not Allowed\n' : 'Not Found\n');
      return;
    }
    const buf = Buffer.from(asset.body);
    res.writeHead(200, { ...hdr, 'Content-Type': asset.type, 'Content-Length': buf.length });
    res.end(head ? undefined : buf);
  }

  return { handle, admission, bans, sessions };
}
