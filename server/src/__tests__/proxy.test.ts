// TRUST_PROXY=cloudflare (local quick tunnel): client IP from CF-Connecting-IP and https from X-Forwarded-Proto, only for loopback
// peers; never from remote peers or in the default mode.
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { Socket } from 'node:net';
import { afterAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { clientIp, isLoopback, isSecure, trustProxyFrom } from '../proxy';
import { createApexServer, type ApexServer } from '../server';

function req(remote: string, headers: Record<string, string | string[]>): http.IncomingMessage {
  return { socket: { remoteAddress: remote } as Socket, headers } as unknown as http.IncomingMessage;
}

describe('proxy headers', () => {
  it('mode parsing and loopback detection', () => {
    expect(trustProxyFrom('cloudflare')).toBe('cloudflare');
    expect(trustProxyFrom(' Cloudflare ')).toBe('cloudflare');
    expect(trustProxyFrom(undefined)).toBe('none');
    expect(trustProxyFrom('yes')).toBe('none');
    for (const a of ['127.0.0.1', '::1', '::ffff:127.0.0.1', '127.1.2.3']) expect(isLoopback(a), a).toBe(true);
    for (const a of ['10.0.0.1', '192.168.1.5', '::ffff:8.8.8.8', '2001:db8::1', undefined]) expect(isLoopback(a), String(a)).toBe(false);
  });

  it('CF-Connecting-IP only from a loopback peer in cloudflare mode, and only when it is an IP', () => {
    const cf = { 'cf-connecting-ip': '203.0.113.7', 'x-forwarded-proto': 'https' };
    expect(clientIp(req('127.0.0.1', cf), 'cloudflare')).toBe('203.0.113.7');
    expect(clientIp(req('::1', { 'cf-connecting-ip': '2001:DB8::5' }), 'cloudflare')).toBe('2001:db8::5');
    expect(clientIp(req('127.0.0.1', cf), 'none')).toBe('127.0.0.1'); // default: headers ignored
    expect(clientIp(req('198.51.100.9', cf), 'cloudflare')).toBe('198.51.100.9'); // remote peer: never trusted
    for (const bad of ['not-an-ip', '1.2.3.4, 5.6.7.8', '<script>', '']) expect(clientIp(req('127.0.0.1', { 'cf-connecting-ip': bad }), 'cloudflare')).toBe('127.0.0.1');
    expect(clientIp(req('127.0.0.1', { 'cf-connecting-ip': ['1.1.1.1', '2.2.2.2'] }), 'cloudflare')).toBe('127.0.0.1');
    expect(isSecure(req('127.0.0.1', cf), false, 'cloudflare')).toBe(true);
    expect(isSecure(req('127.0.0.1', cf), false, 'none')).toBe(false);
    expect(isSecure(req('198.51.100.9', cf), false, 'cloudflare')).toBe(false);
    expect(isSecure(req('127.0.0.1', {}), true, 'none')).toBe(true);
  });
});

describe('server behind the tunnel', () => {
  const servers: { apex: ApexServer; tmp: string }[] = [];
  afterAll(async () => {
    for (const s of servers) {
      await s.apex.close();
      fs.rmSync(s.tmp, { recursive: true, force: true });
    }
  });

  async function start(trust: 'cloudflare' | 'none'): Promise<number> {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-proxy-'));
    fs.writeFileSync(path.join(tmp, 'index.html'), '<!doctype html><title>HAIRPIN GP</title>');
    const apex = createApexServer({ distDir: tmp, certDir: path.join(tmp, 'certs'), log: () => {}, trustProxy: trust, sockets: { perIp: 1 } });
    await new Promise<void>((r) => apex.server.listen(0, '127.0.0.1', r));
    servers.push({ apex, tmp });
    return (apex.server.address() as AddressInfo).port;
  }

  /** WebSocket handshake as the tunnel forwards a browser: tunnel Host, https Origin, CF headers. Resolves 'open' or the HTTP status. */
  function connect(port: number, headers: Record<string, string>): Promise<{ result: 'open' | number; ws: WebSocket }> {
    return new Promise((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { Host: 'quick-test.trycloudflare.com', ...headers } });
      ws.on('open', () => resolve({ result: 'open', ws }));
      ws.on('unexpected-response', (_r, res) => resolve({ result: res.statusCode ?? 0, ws }));
      ws.on('error', () => {});
    });
  }

  const tunnel = (ip: string): Record<string, string> => ({
    Origin: 'https://quick-test.trycloudflare.com', 'X-Forwarded-Proto': 'https', 'CF-Connecting-IP': ip,
  });

  it('accepts the https tunnel origin and limits sockets per real client IP', async () => {
    const port = await start('cloudflare');
    const a = await connect(port, tunnel('203.0.113.1'));
    const b = await connect(port, tunnel('203.0.113.2'));
    const c = await connect(port, tunnel('203.0.113.1'));
    expect([a.result, b.result, c.result]).toEqual(['open', 'open', 429]); // perIp = 1, counted by CF-Connecting-IP
    const plain = await connect(port, { Origin: 'https://quick-test.trycloudflare.com', 'CF-Connecting-IP': '203.0.113.3' });
    expect(plain.result).toBe(403); // https origin without the proxy's https marker: not same-origin
    for (const x of [a, b, c, plain]) x.ws.close();
  });

  it('without TRUST_PROXY the tunnel headers are ignored (all clients share 127.0.0.1, https origin refused)', async () => {
    const port = await start('none');
    expect((await connect(port, tunnel('203.0.113.1'))).result).toBe(403);
    const a = await connect(port, {});
    const b = await connect(port, {});
    expect([a.result, b.result]).toEqual(['open', 429]);
    a.ws.close();
    b.ws.close();
  });

  it('pages served through the tunnel get a wss: CSP; plain local pages keep ws:', async () => {
    const port = await start('cloudflare');
    const csp = (headers: Record<string, string>): Promise<string> => new Promise((resolve) => {
      http.get({ host: '127.0.0.1', port, path: '/', headers: { Host: 'quick-test.trycloudflare.com', ...headers } }, (res) => {
        res.resume();
        resolve(String(res.headers['content-security-policy']));
      });
    });
    expect(await csp({ 'X-Forwarded-Proto': 'https' })).toContain('wss:');
    expect(await csp({})).toContain(' ws:');
  });
});
