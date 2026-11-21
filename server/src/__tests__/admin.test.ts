// Admin panel integration (D-050) against a real server: login (scrypt + TOTP), lockout, session expiry/rotation, CSRF,
// cross-origin, kick, ban/expiry/unban, maintenance, notice, static asset paths, and no raw IP anywhere on disk or in logs.
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { PROTOCOL_VERSION } from '../../../src/contracts/net';
import { DEFAULT_SETTINGS } from '../../bots/bot';
import { COOKIE } from '../admin/admin';
import { AUTH } from '../admin/auth';
import { BanList } from '../admin/bans';
import { base32Decode, totp } from '../admin/crypto';
import { readJson } from '../admin/files';
import { writeAdminFile } from '../admin/setup';
import { parseClientMessage } from '../../../src/net/protocol';
import { CLOSE_BANNED, CLOSE_KICKED } from '../hub';
import { createApexServer, type ApexServer } from '../server';
import { bot, isType, sleep, startRace, type TestServer } from './helpers';

const PASSWORD = 'pit-lane hairpin 2026';
let tmp: string;
let dataDir: string;
let apex: ApexServer;
let port: number;
let key: Buffer;
let t = Date.now();
const logs: { event: string; data: Record<string, unknown> }[] = [];
let srv: TestServer;

beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-admin-'));
  dataDir = path.join(tmp, 'data');
  await writeAdminFile(path.join(dataDir, 'admin.json'), PASSWORD);
  key = base32Decode((readJson(path.join(dataDir, 'admin.json')) as { totpSecret: string }).totpSecret);
  apex = createApexServer({
    distDir: tmp, certDir: path.join(tmp, 'certs'), dataDir, log: (event, data = {}) => logs.push({ event, data }), adminNow: () => t, game: { maxRooms: 4 },
  });
  await new Promise<void>((r) => apex.server.listen(0, '127.0.0.1', r));
  port = (apex.server.address() as AddressInfo).port;
  srv = { apex, url: `ws://127.0.0.1:${port}/ws`, logs, stop: async () => {} };
});

afterAll(async () => {
  await apex.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

interface Res { status: number; headers: http.IncomingHttpHeaders; body: string; json: Record<string, unknown> }

function req(method: string, p: string, opts: { headers?: Record<string, string>; body?: unknown; cookie?: string; csrf?: string } = {}): Promise<Res> {
  const body = opts.body === undefined ? undefined : JSON.stringify(opts.body);
  const headers: Record<string, string> = { ...(body !== undefined ? { 'Content-Type': 'application/json', Origin: `http://127.0.0.1:${port}` } : {}) };
  if (opts.cookie) headers.Cookie = `${COOKIE}=${opts.cookie}`;
  if (opts.csrf) headers['X-CSRF-Token'] = opts.csrf;
  Object.assign(headers, opts.headers);
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, method, path: p, headers }, (res) => {
      let text = '';
      res.on('data', (c: Buffer) => (text += c.toString()));
      res.on('end', () => {
        let json: Record<string, unknown> = {};
        try {
          json = JSON.parse(text) as Record<string, unknown>;
        } catch { /* not JSON */ }
        resolve({ status: res.statusCode ?? 0, headers: res.headers, body: text, json });
      });
    });
    r.on('error', reject);
    r.end(body);
  });
}

const code = (dt = 0): string => totp(key, t + dt);
/** Each login needs a fresh TOTP step (a code works once), so the fake clock moves 30 s per login. */
async function login(): Promise<{ cookie: string; csrf: string; setCookie: string }> {
  t += 30_000;
  const r = await req('POST', '/admin/api/login', { body: { password: PASSWORD, code: code() } });
  expect(r.status).toBe(200);
  const setCookie = String(r.headers['set-cookie']?.[0] ?? '');
  const cookie = /=([^;]+)/.exec(setCookie)![1]!;
  return { cookie, csrf: r.json.csrf as string, setCookie };
}

/** A raw client: resolves 'welcome' or the close code (banned hellos get no welcome). */
function hello(deviceId?: string, resume?: string): Promise<{ result: 'welcome' | number; ws: WebSocket; id: number; token: string }> {
  return new Promise((resolve) => {
    const ws = new WebSocket(srv.url);
    ws.on('open', () => ws.send(JSON.stringify({ type: 'hello', v: PROTOCOL_VERSION, build: 't', name: 'Racer', ...(deviceId ? { deviceId } : {}), ...(resume ? { resume } : {}) })));
    ws.on('message', (d: Buffer) => {
      const m = JSON.parse(d.toString()) as { type: string; id: number; resumeToken: string };
      if (m.type === 'welcome') resolve({ result: 'welcome', ws, id: m.id, token: m.resumeToken });
    });
    ws.on('close', (c) => resolve({ result: c, ws, id: -1, token: '' }));
  });
}
const auditText = (): string => fs.readdirSync(path.join(dataDir, 'audit')).map((f) => fs.readFileSync(path.join(dataDir, 'audit', f), 'utf8')).join('');
const closed = (ws: WebSocket): Promise<number> => new Promise((r) => (ws.readyState === WebSocket.CLOSED ? r(-1) : ws.once('close', (c) => r(c))));

describe('D-055 contact HTTP and guarded inbox', () => {
  const message = 'Private feedback <img src=x onerror=alert(1)> unused@example.test';
  const payload = { type: 'complaint', message, nickname: 'Sample', roomCode: 'ABCDE', deviceId: 'c'.repeat(22), website: '' };
  it('rejects invalid, cross-origin and oversized requests; silently drops the honeypot', async () => {
    expect((await req('POST', '/api/contact', { body: { ...payload, email: 'unused@example.test' } })).status).toBe(400);
    expect((await req('POST', '/api/contact', { body: payload, headers: { Origin: 'https://outside.test' } })).status).toBe(403);
    expect((await req('POST', '/api/contact', { body: { ...payload, message: 'x'.repeat(9000) } })).status).toBe(413);
    expect((await req('POST', '/api/contact', { body: { ...payload, website: 'bot' } })).status).toBe(200);
    const s = await login();
    expect((await req('GET', '/admin/api/inbox', s)).json.messages).toEqual([]);
  });
  it('lists and filters plain-text messages; requires session, CSRF and Origin for changes', async () => {
    for (const type of ['bug', 'suggestion', 'complaint']) {
      expect((await req('POST', '/api/contact', { body: { ...payload, type, ...(type === 'complaint' ? {} : { nickname: undefined, roomCode: undefined }) } })).status).toBe(200);
    }
    expect((await req('GET', '/admin/api/inbox')).status).toBe(401);
    expect((await req('GET', '/data/contact.jsonl')).status).toBe(404);
    const s = await login();
    const list = (await req('GET', '/admin/api/inbox?type=complaint&status=new', s)).json.messages as { id: string; message: string }[];
    expect(list).toHaveLength(1); expect(list[0]!.message).toBe(message);
    expect((await req('GET', '/admin/api/inbox?status=answered', s)).status).toBe(400);
    const body = { id: list[0]!.id, status: 'read' };
    expect((await req('POST', '/admin/api/contact', { ...s, body: { ...body, status: ['read'] } })).status).toBe(400);
    expect((await req('POST', '/admin/api/contact', { body })).status).toBe(401);
    expect((await req('POST', '/admin/api/contact', { cookie: s.cookie, body })).status).toBe(403);
    expect((await req('POST', '/admin/api/contact', { ...s, body, headers: { Origin: 'https://outside.test' } })).status).toBe(403);
    expect((await req('POST', '/admin/api/contact', { ...s, body })).status).toBe(200);
    expect(((await req('GET', '/admin/api/inbox?status=read', s)).json.messages as unknown[])).toHaveLength(1);
    expect((await req('POST', '/admin/api/contact', { ...s, body: { ...body, status: 'archived' } })).status).toBe(200);
    expect(((await req('GET', '/admin/api/inbox?status=archived', s)).json.messages as unknown[])).toHaveLength(1);
    expect((await req('POST', '/admin/api/contact', { ...s, body: { ...body, status: 'delete' } })).status).toBe(200);
    expect(((await req('GET', '/admin/api/inbox?type=complaint', s)).json.messages as unknown[])).toHaveLength(0);
    expect(JSON.stringify(logs)).not.toContain(message); expect(JSON.stringify(logs)).not.toContain('unused@example.test');
    expect(auditText()).not.toContain(message); expect(auditText()).not.toContain('unused@example.test');
  });
  it('rate limits repeated HTTP submissions', async () => {
    for (let i = 0; i < 5; i++) expect((await req('POST', '/api/contact', { body: { ...payload, deviceId: 'd'.repeat(22) } })).status).toBe(200);
    expect((await req('POST', '/api/contact', { body: { ...payload, deviceId: 'd'.repeat(22) } })).status).toBe(429);
  });
});

describe('static admin assets', () => {
  it('serves the fixed files with a strict CSP', async () => {
    for (const p of ['/admin', '/admin/', '/admin?x=1', '/admin/panel.js', '/admin/panel.css']) {
      const r = await req('GET', p);
      expect(r.status, p).toBe(200);
      expect(r.headers['content-security-policy']).toContain("default-src 'none'");
      expect(r.headers['content-security-policy']).toContain("frame-ancestors 'none'");
      expect(r.headers['cache-control']).toBe('no-store');
      expect(r.headers['x-frame-options']).toBe('DENY');
    }
    expect((await req('GET', '/admin')).body).toContain('/admin/panel.js');
    // The page loads nothing from another origin.
    for (const p of ['/admin', '/admin/panel.js', '/admin/panel.css']) expect((await req('GET', p)).body).not.toMatch(/https?:\/\/|\/\/[a-z]/i);
  });

  it.each([
    '/admin/../index.html', '/admin/%2e%2e/index.html', '/admin/..%2f..%2fpackage.json', '/admin/panel.js/../../admin.json',
    '/admin/panel.js%00', '/admin/./panel.js', '/admin//panel.js', '/admin/admin.json', '/admin/data/admin.json', '/admin/panel.JS',
    '/admin/..\\..\\x', '/admin/api/../../admin.json',
  ])('404 for %s', async (p) => {
    const r = await req('GET', p);
    expect([400, 401, 404]).toContain(r.status);
    expect(r.body).not.toContain('totpSecret');
  });

  it('POST to a static path is refused', async () => {
    expect((await req('POST', '/admin', { body: {} })).status).toBe(405);
  });
});

describe('login', () => {
  beforeEach(() => {
    t += AUTH.maxLockMs + AUTH.globalLockMs; // clear lockouts from earlier tests
  });

  it('wrong password or code → 401 without saying which; right → cookie with all flags', async () => {
    t += 30_000;
    expect((await req('POST', '/admin/api/login', { body: { password: 'nope', code: code() } })).json).toEqual({ error: 'invalid' });
    expect((await req('POST', '/admin/api/login', { body: { password: PASSWORD, code: '000000' === code() ? '111111' : '000000' } })).json).toEqual({ error: 'invalid' });
    const { setCookie, csrf } = await login();
    expect(setCookie).toMatch(new RegExp(`^${COOKIE.replace('-', '\\-')}=`));
    for (const flag of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/']) expect(setCookie).toContain(flag);
    expect(csrf.length).toBeGreaterThan(30);
  });

  it('a TOTP code works only once', async () => {
    t += 30_000;
    const c = code();
    expect((await req('POST', '/admin/api/login', { body: { password: PASSWORD, code: c } })).status).toBe(200);
    expect((await req('POST', '/admin/api/login', { body: { password: PASSWORD, code: c } })).status).toBe(401);
  });

  it('locks out after 5 failures with backoff, even for the right credentials', async () => {
    for (let i = 0; i < AUTH.freeFails; i++) expect((await req('POST', '/admin/api/login', { body: { password: 'x', code: '123456' } })).status).toBe(401);
    t += 30_000;
    const locked = await req('POST', '/admin/api/login', { body: { password: PASSWORD, code: code() } });
    expect(locked.status).toBe(429);
    expect(locked.json.error).toBe('locked');
    t += AUTH.baseLockMs;
    expect((await req('POST', '/admin/api/login', { body: { password: 'x', code: '123456' } })).status).toBe(401);
    // 6th failure: 2 min lock now.
    t += AUTH.baseLockMs;
    expect((await req('POST', '/admin/api/login', { body: { password: PASSWORD, code: code() } })).status).toBe(429);
    t += AUTH.baseLockMs;
    expect((await req('POST', '/admin/api/login', { body: { password: PASSWORD, code: code() } })).status).toBe(200);
    expect(auditText()).toContain('"event":"loginFail"');
    expect(auditText()).toContain('"event":"loginLocked"');
  });

  it('rejects malformed bodies', async () => {
    expect((await req('POST', '/admin/api/login', { body: { password: 1, code: '1' } })).status).toBe(400);
    expect((await req('POST', '/admin/api/login', { body: { password: 'x'.repeat(5000), code: '1' } })).status).toBe(400);
  });
});

describe('sessions, CSRF, origin', () => {
  it('no cookie / bad cookie → 401', async () => {
    expect((await req('GET', '/admin/api/state')).status).toBe(401);
    expect((await req('GET', '/admin/api/state', { cookie: 'forged' })).status).toBe(401);
  });

  it('rotates the session id on login and ends the old one', async () => {
    const a = await login();
    t += 30_000;
    const r = await req('POST', '/admin/api/login', { body: { password: PASSWORD, code: code() }, cookie: a.cookie });
    const b = /=([^;]+)/.exec(String(r.headers['set-cookie']?.[0]))![1]!;
    expect(b).not.toBe(a.cookie);
    expect((await req('GET', '/admin/api/state', { cookie: a.cookie })).status).toBe(401);
    expect((await req('GET', '/admin/api/state', { cookie: b })).status).toBe(200);
  });

  it('idle expiry (polling does not extend it), actions do; 8 h max age', async () => {
    const s = await login();
    t += AUTH.idleMs - 1000;
    expect((await req('GET', '/admin/api/state', { cookie: s.cookie })).status).toBe(200);
    t += 1000;
    expect((await req('GET', '/admin/api/state', { cookie: s.cookie })).status).toBe(401);

    const m = await login();
    for (let elapsed = 0; elapsed + 20 * 60_000 < AUTH.maxAgeMs; elapsed += 20 * 60_000) {
      t += 20 * 60_000;
      expect((await req('POST', '/admin/api/maintenance', { cookie: m.cookie, csrf: m.csrf, body: { on: false } })).status).toBe(200);
    }
    t += 20 * 60_000;
    expect((await req('GET', '/admin/api/session', { cookie: m.cookie })).status).toBe(401);
  });

  it('CSRF token required on state-changing calls', async () => {
    const s = await login();
    expect((await req('POST', '/admin/api/maintenance', { cookie: s.cookie, body: { on: false } })).status).toBe(403);
    expect((await req('POST', '/admin/api/maintenance', { cookie: s.cookie, csrf: 'x' + s.csrf.slice(1), body: { on: false } })).status).toBe(403);
    expect((await req('POST', '/admin/api/maintenance', { cookie: s.cookie, csrf: s.csrf, body: { on: false } })).status).toBe(200);
    // logout needs it too, and ends the session.
    expect((await req('POST', '/admin/api/logout', { cookie: s.cookie, body: {} })).status).toBe(403);
    expect((await req('POST', '/admin/api/logout', { cookie: s.cookie, csrf: s.csrf, body: {} })).status).toBe(200);
    expect((await req('GET', '/admin/api/state', { cookie: s.cookie })).status).toBe(401);
    expect(auditText()).toContain('"event":"csrfFail"');
    expect(auditText()).toContain('"event":"logout"');
  });

  it('cross-origin and non-JSON requests are refused', async () => {
    const s = await login();
    const base = { cookie: s.cookie, csrf: s.csrf, body: { on: false } };
    expect((await req('POST', '/admin/api/maintenance', { ...base, headers: { Origin: 'https://evil.example' } })).status).toBe(403);
    expect((await req('POST', '/admin/api/maintenance', { ...base, headers: { Origin: 'null' } })).status).toBe(403);
    expect((await req('POST', '/admin/api/maintenance', { ...base, headers: { Origin: `https://127.0.0.1:${port}` } })).status).toBe(403);
    expect((await req('POST', '/admin/api/maintenance', { ...base, headers: { 'Content-Type': 'text/plain' } })).status).toBe(403);
    expect((await req('GET', '/admin/api/state', { cookie: s.cookie, headers: { 'Sec-Fetch-Site': 'cross-site' } })).status).toBe(403);
    expect((await req('POST', '/admin/api/login', { body: { password: PASSWORD, code: code() }, headers: { Origin: 'https://evil.example' } })).status).toBe(403);
    // No Origin at all.
    const noOrigin = await new Promise<number>((resolve) => {
      const r = http.request({ host: '127.0.0.1', port, method: 'POST', path: '/admin/api/maintenance', headers: { 'Content-Type': 'application/json', Cookie: `${COOKIE}=${s.cookie}`, 'X-CSRF-Token': s.csrf } }, (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      });
      r.end('{"on":false}');
    });
    expect(noOrigin).toBe(403);
    expect((await req('PUT', '/admin/api/state', { cookie: s.cookie })).status).toBe(405);
  });
});

describe('moderation', () => {
  let adm: { cookie: string; csrf: string };
  const post = (route: string, body: unknown): Promise<Res> => req('POST', `/admin/api/${route}`, { cookie: adm.cookie, csrf: adm.csrf, body });
  const state = async (): Promise<Record<string, unknown> & { players: { id: number; name: string; device: string; room: string | null; strikes: number }[]; bans: { id: string }[] }> =>
    (await req('GET', '/admin/api/state', { cookie: adm.cookie })).json as never;

  beforeAll(async () => {
    adm = await login();
  });

  it('hello.deviceId is part of the shared protocol (D-050): validated on hello, refused elsewhere', () => {
    expect(parseClientMessage('{"type":"hello","v":1,"build":"t","name":"Racer","deviceId":"abcdefghijklmnop"}')).toMatchObject({ deviceId: 'abcdefghijklmnop' });
    expect(parseClientMessage('{"type":"hello","v":1,"build":"t","name":"Racer","deviceId":"<bad>"}')).toBeNull();
    expect(parseClientMessage('{"type":"join","code":"ABCDE","deviceId":"abcdefghijklmnop"}')).toBeNull();
  });

  it('state lists rooms, players (with device hash) and health', async () => {
    const a = await bot(srv, 'Alpha', { deviceId: 'device-alpha-0000001' });
    a.send({ type: 'create', settings: DEFAULT_SETTINGS });
    await a.waitFor(isType('room'));
    const s = await state();
    const row = s.players.find((p) => p.id === a.id)!;
    expect(row).toMatchObject({ name: 'Alpha', strikes: 0 });
    expect(row.room).toMatch(/^[A-Z0-9]{5}$/);
    expect(row.device).toMatch(/^[0-9a-f]{8}$/);
    expect((s.rooms as unknown[]).length).toBe(1);
    expect(s.health).toMatchObject({ ok: true });
    expect((s.events as { event: string }[]).some((e) => e.event === 'roomCreate')).toBe(true);
    a.send({ type: 'leave' });
    a.close();
    await sleep(50);
  });

  it('kick closes the socket with 4001, removes the player and voids its resume token', async () => {
    const a = await bot(srv, 'Kicked');
    expect((await post('kick', { id: a.id })).status).toBe(200);
    await expect.poll(() => a.closeCode, { timeout: 5000 }).toBe(CLOSE_KICKED);
    expect(a.msgs.some((m) => m.type === 'kicked' && m.reason === 'kicked')).toBe(true); // D-050: the reason precedes the close
    expect((await state()).players.some((p) => p.id === a.id && p.name === 'Kicked')).toBe(false);
    const again = await hello(undefined, a.token);
    expect(again.result).toBe('welcome');
    expect(again.token).not.toBe(a.token);
    again.ws.close();
    expect((await post('kick', { id: 999 })).status).toBe(404);
  });

  it('ban by device: refused at hello, other devices on the network too (network on); expiry and unban', async () => {
    const v = await hello('banned-device-00000001');
    expect(v.result).toBe('welcome');
    const r = await post('ban', { id: v.id, duration: '1h', network: true, reason: 'test' });
    expect(r.status).toBe(200);
    expect(await closed(v.ws)).toBe(CLOSE_BANNED);
    expect((await hello('banned-device-00000001')).result).toBe(CLOSE_BANNED);
    expect((await hello('other-device-000000001')).result).toBe(CLOSE_BANNED); // same /24
    expect((await state()).bans.length).toBe(1);
    // Persisted: a fresh reader of bans.json sees the ban (only hashes inside).
    const file = path.join(dataDir, 'bans.json');
    expect(new BanList(file, () => t).list().length).toBe(1);
    // Expiry.
    t += 3_600_000 + 1;
    adm = await login(); // the jump also ended the admin session
    const after = await hello('banned-device-00000001');
    expect(after.result).toBe('welcome');
    expect((await state()).bans.length).toBe(0);

    // Permanent device-only ban (LAN party): same network stays allowed; unban lifts it.
    const r2 = await post('ban', { id: after.id, duration: 'perm', network: false, reason: '' });
    const banId = r2.json.ban as string;
    expect(await closed(after.ws)).toBe(CLOSE_BANNED);
    expect((await hello('banned-device-00000001')).result).toBe(CLOSE_BANNED);
    const other = await hello('other-device-000000001');
    expect(other.result).toBe('welcome');
    other.ws.close();
    t += 365 * 86_400_000;
    adm = await login();
    expect((await hello('banned-device-00000001')).result).toBe(CLOSE_BANNED);
    expect((await post('unban', { banId })).status).toBe(200);
    expect((await post('unban', { banId })).status).toBe(404);
    const back = await hello('banned-device-00000001');
    expect(back.result).toBe('welcome');
    back.ws.close();
  });

  it('ban without a device id falls back to the resume token', async () => {
    const v = await hello();
    await post('ban', { id: v.id, duration: '24h', network: false });
    expect(await closed(v.ws)).toBe(CLOSE_BANNED);
    expect((await hello(undefined, v.token)).result).toBe(CLOSE_BANNED);
    const bans = (await state()).bans;
    await post('unban', { banId: bans[0]!.id });
    expect((await post('ban', { id: 63, duration: '1h' })).status).toBe(404);
  });

  it('bad durations are refused', async () => {
    const v = await hello();
    expect((await post('ban', { id: v.id, duration: '2h' })).status).toBe(400);
    expect((await post('ban', { id: v.id, duration: 'constructor' })).status).toBe(400);
    v.ws.close();
  });

  it('maintenance refuses new rooms and joins; a running race continues', async () => {
    const [a, b] = [await bot(srv, 'MA'), await bot(srv, 'MB')];
    await startRace([a!]);
    expect((await post('maintenance', { on: true })).status).toBe(200);
    b!.send({ type: 'create', settings: DEFAULT_SETTINGS });
    expect(await b!.next(isType('error'))).toMatchObject({ code: 'maintenance' });
    b!.send({ type: 'join', code: a!.room!.code });
    expect(await b!.next(isType('error'))).toMatchObject({ code: 'maintenance' });
    // The race goes on: the room still exists and gets its start.
    await a!.waitFor(isType('start'));
    expect(apex.hub.rooms.has(a!.room!.code)).toBe(true);
    expect((await state()).maintenance).toBe(true);
    await post('maintenance', { on: false });
    b!.send({ type: 'create', settings: DEFAULT_SETTINGS });
    await b!.next(isType('room'));
    a!.close();
    b!.close();
    await sleep(50);
  });

  it('notice is stored, cleaned and length-limited', async () => {
    expect((await post('notice', { text: ' Server restarts at 22:00 ‮' })).json).toMatchObject({ ok: true });
    expect((await state()).notice).toMatchObject({ text: 'Server restarts at 22:00' });
    expect((await post('notice', { text: 'x'.repeat(201) })).status).toBe(400);
    // D-050: broadcast to connected players and sent after every welcome.
    const n1 = await bot(srv, 'NoticeA');
    expect((await post('notice', { text: 'Back in 5' })).status).toBe(200);
    expect(await n1.waitFor((m) => m.type === 'notice' && m.text === 'Back in 5')).toBeTruthy();
    const n2 = await bot(srv, 'NoticeB');
    expect(await n2.waitFor((m) => m.type === 'notice' && m.text === 'Back in 5')).toBeTruthy();
    await post('notice', { text: '' });
    expect(await n1.waitFor((m) => m.type === 'notice' && m.text === '')).toBeTruthy();
    expect((await state()).notice).toBeNull();
    n1.close();
    n2.close();
  });

  it('audit log has the logins, failures and actions; no raw IP is logged or stored anywhere', async () => {
    const files = fs.readdirSync(path.join(dataDir, 'audit'));
    expect(files.every((f) => /^audit-\d{4}-\d{2}-\d{2}\.jsonl$/.test(f))).toBe(true);
    const audit = files.map((f) => fs.readFileSync(path.join(dataDir, 'audit', f), 'utf8')).join('');
    const events = new Set(audit.trim().split('\n').map((l) => (JSON.parse(l) as { event: string }).event));
    // (older days were pruned by the 365-day jump; login failures/csrf/logout are checked in their own tests)
    for (const e of ['login', 'ban', 'unban', 'maintenance', 'notice']) expect(events, e).toContain(e);
    // Everything the server wrote: audit, bans, admin.json, every log line (and the events ring the panel shows).
    const all = [audit, fs.readFileSync(path.join(dataDir, 'bans.json'), 'utf8'), fs.readFileSync(path.join(dataDir, 'admin.json'), 'utf8'), JSON.stringify(logs)].join('\n');
    expect(all).not.toContain('127.0.0');
    expect(all).not.toMatch(/::ffff:/);
    expect(all).not.toMatch(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/);
  });

  it('audit files older than 14 days are deleted', async () => {
    const dir = path.join(dataDir, 'audit');
    fs.writeFileSync(path.join(dir, 'audit-2000-01-01.jsonl'), '{}\n');
    t += 86_400_000; // a new day → prune on the next write
    adm = await login();
    await post('maintenance', { on: false });
    expect(fs.existsSync(path.join(dir, 'audit-2000-01-01.jsonl'))).toBe(false);
  });
});

describe('no admin without a data dir', () => {
  it('/admin is the plain static 404 when the panel is off', async () => {
    const other = createApexServer({ distDir: tmp, certDir: path.join(tmp, 'certs'), log: () => {} });
    await new Promise<void>((r) => other.server.listen(0, '127.0.0.1', r));
    const p = (other.server.address() as AddressInfo).port;
    const status = await new Promise<number>((resolve) => http.get({ host: '127.0.0.1', port: p, path: '/admin/api/state' }, (res) => (res.resume(), resolve(res.statusCode ?? 0))));
    expect(status).toBe(404);
    await other.close();
  });
});
