// Integration tests against a real server on an ephemeral port (plain HTTP, temp dist dir).
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { resolveSafePath, securityHeaders } from '../http';
import { WS_LIMITS } from '../limits';
import { createApexServer, type ApexServer } from '../server';

let tmp: string;
let dist: string;
let apex: ApexServer;
let port: number;

beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-srv-'));
  dist = path.join(tmp, 'dist');
  fs.mkdirSync(path.join(dist, 'assets', 'env'), { recursive: true });
  fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>t</title>');
  fs.writeFileSync(path.join(dist, 'assets', 'index-AbC_12-x.js'), 'export {};');
  fs.writeFileSync(path.join(dist, 'assets', 'env', 'tex.jpg'), 'jpg');
  fs.writeFileSync(path.join(dist, '.env'), 'SECRET=1');
  fs.writeFileSync(path.join(tmp, 'secret.txt'), 'outside');
  apex = createApexServer({ distDir: dist, certDir: path.join(tmp, 'certs'), log: () => {} });
  await new Promise<void>((r) => apex.server.listen(0, '127.0.0.1', r));
  port = (apex.server.address() as AddressInfo).port;
});

afterAll(async () => {
  await apex.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

/** Raw request: the path is sent exactly as given (fetch would normalise `..`). */
function req(method: string, rawPath: string): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, method, path: rawPath }, (res) => {
      let body = '';
      res.on('data', (c: Buffer) => (body += c.toString()));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
    });
    r.on('error', reject);
    r.end();
  });
}

describe('resolveSafePath', () => {
  const root = path.resolve('/srv/dist');
  it('maps normal paths inside root', () => {
    expect(resolveSafePath(root, '/')).toBe(path.join(root, 'index.html'));
    expect(resolveSafePath(root, '/assets/a.js?v=1')).toBe(path.join(root, 'assets', 'a.js'));
    expect(resolveSafePath(root, '/a%20b.png')).toBe(path.join(root, 'a b.png'));
  });
  it.each([
    '/../package.json',
    '/assets/../../x',
    '/%2e%2e/package.json',
    '/%2E%2E%2Fpackage.json',
    '/..%5cpackage.json',
    '/a\\..\\..\\x',
    '/%00index.html',
    '/%E0%A4%A',
    '/.env',
    '/.git/config',
    'index.html',
    'http://evil/x',
    '/' + 'a'.repeat(3000),
  ])('rejects %s', (u) => {
    expect(resolveSafePath(root, u)).toBeNull();
  });
});

describe('securityHeaders', () => {
  it('adds HSTS and wss only over TLS', () => {
    expect(securityHeaders(true)['Strict-Transport-Security']).toBe('max-age=31536000');
    expect(securityHeaders(false)['Strict-Transport-Security']).toBeUndefined();
    expect(securityHeaders(true)['Content-Security-Policy']).toContain("connect-src 'self' https: wss:");
    expect(securityHeaders(false)['Content-Security-Policy']).toContain("connect-src 'self' https: ws:");
    expect(securityHeaders(false)['X-Content-Type-Options']).toBe('nosniff');
  });
});

describe('static + health over HTTP', () => {
  it('serves index.html with security headers', async () => {
    const r = await req('GET', '/');
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(r.headers['content-security-policy']).toContain("default-src 'self'");
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['strict-transport-security']).toBeUndefined();
    expect(r.headers['cache-control']).toBe('no-cache');
    expect(r.body).toContain('<title>t</title>');
  });
  it('caches hashed chunks as immutable, public files as no-cache', async () => {
    expect((await req('GET', '/assets/index-AbC_12-x.js')).headers['cache-control']).toContain('immutable');
    expect((await req('GET', '/assets/env/tex.jpg')).headers['cache-control']).toBe('no-cache');
  });
  it('HEAD has headers and no body', async () => {
    const r = await req('HEAD', '/');
    expect(r.status).toBe(200);
    expect(r.headers['content-length']).toBe('31');
    expect(r.body).toBe('');
  });
  it.each(['POST', 'PUT', 'DELETE', 'OPTIONS'])('%s → 405', async (m) => {
    const r = await req(m, '/');
    expect(r.status).toBe(405);
    expect(r.headers.allow).toBe('GET, HEAD');
  });
  it.each(['/../secret.txt', '/%2e%2e/secret.txt', '/..%5csecret.txt', '/.env', '/%00'])('blocks %s', async (p) => {
    const r = await req('GET', p);
    expect(r.status).toBe(400);
    expect(r.body).not.toContain('outside');
    expect(r.body).not.toContain('SECRET');
  });
  it('404 for missing files and directories (no listing)', async () => {
    expect((await req('GET', '/nope.js')).status).toBe(404);
    expect((await req('GET', '/assets')).status).toBe(404);
    expect((await req('GET', '/assets/')).status).toBe(404);
  });
  it('/health returns the coarse numbers', async () => {
    const r = await req('GET', '/health');
    expect(r.status).toBe(200);
    expect(r.headers['cache-control']).toBe('no-store');
    const h = JSON.parse(r.body) as Record<string, unknown>;
    for (const k of ['cpuPct', 'rssMb', 'lagP99Ms', 'sockets', 'msgInPerS', 'msgOutPerS', 'uptimeS']) expect(typeof h[k]).toBe('number');
    expect(h.tls).toBe(false);
    expect(h.certDaysLeft).toBeNull();
  });
  it('applies the 10 s request/header timeouts', () => {
    expect(apex.server.headersTimeout).toBe(10_000);
    expect(apex.server.requestTimeout).toBe(10_000);
  });
});

function open(pathName = '/ws', headers: Record<string, string> = {}): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${pathName}`, { headers });
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

function closed(ws: WebSocket): Promise<number> {
  return new Promise((resolve) => ws.once('close', (code) => resolve(code)));
}

function rejectedStatus(pathName: string, headers: Record<string, string> = {}): Promise<number> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${pathName}`, { headers });
    ws.once('unexpected-response', (_req, res) => {
      resolve(res.statusCode ?? 0);
      ws.terminate();
    });
    ws.once('error', () => resolve(-1));
  });
}

describe('WebSocket /ws', () => {
  it('answers a binary ping with a pong and a non-JSON text with error badMessage', async () => {
    const ws = await open();
    const got = new Promise<string>((r) => ws.once('message', (d) => r(d.toString())));
    ws.send('ping');
    expect(JSON.parse(await got)).toEqual({ type: 'error', code: 'badMessage' });
    const ping = Buffer.alloc(12);
    ping[0] = 0x01;
    const gotBin = new Promise<[number, number]>((r) => ws.once('message', (d: Buffer, bin) => r([bin ? 1 : 0, d.length])));
    ws.send(ping);
    expect(await gotBin).toEqual([1, 20]);
    ws.close();
    await closed(ws);
  });
  it('closes with 1009 on a message over 1024 B', async () => {
    const ws = await open();
    const code = closed(ws);
    ws.send(Buffer.alloc(WS_LIMITS.maxPayloadBytes + 1));
    expect(await code).toBe(1009);
  });
  it('drops over-rate messages and closes a flooder with 1008', async () => {
    const ws = await open();
    let replies = 0;
    ws.on('message', () => replies++);
    const code = closed(ws);
    for (let i = 0; i < 200; i++) ws.send('x');
    expect(await code).toBe(1008);
    expect(replies).toBeLessThanOrEqual(WS_LIMITS.controlBurst + 2);
  });
  it('rejects wrong paths and cross-origin pages', async () => {
    expect(await rejectedStatus('/other')).toBe(404);
    expect(await rejectedStatus('/ws', { Origin: 'https://evil.example' })).toBe(403);
    const ok = await open('/ws', { Origin: `http://127.0.0.1:${port}` });
    ok.close();
    await closed(ok);
  });
  it('allows 24 sockets per IP, rejects the 25th with 429, and frees slots on close', async () => {
    const socks: WebSocket[] = [];
    for (let i = 0; i < WS_LIMITS.maxSocketsPerIp; i++) socks.push(await open());
    expect(await rejectedStatus('/ws')).toBe(429);
    expect(apex.metrics.sockets).toBe(WS_LIMITS.maxSocketsPerIp);
    const last = socks.pop()!;
    last.close();
    await closed(last);
    await new Promise((r) => setTimeout(r, 50));
    socks.push(await open());
    await Promise.all(socks.map((s) => (s.close(), closed(s))));
  });
});
