import { describe, expect, it } from 'vitest';
import { FloodGuard, IpCounter, TokenBucket, normalizeIp } from '../limits';
import { daysUntil } from '../certs';
import { originAllowed } from '../ws';

describe('TokenBucket', () => {
  it('allows the burst, then refills at the rate', () => {
    const b = new TokenBucket(30, 10, 0);
    let ok = 0;
    for (let i = 0; i < 20; i++) if (b.take(0)) ok++;
    expect(ok).toBe(10);
    expect(b.take(0)).toBe(false);
    // 100 ms at 30/s = 3 tokens.
    expect([b.take(100), b.take(100), b.take(100), b.take(100)]).toEqual([true, true, true, false]);
  });

  it('never exceeds the burst after a long idle', () => {
    const b = new TokenBucket(30, 10, 0);
    let ok = 0;
    for (let i = 0; i < 50; i++) if (b.take(60_000)) ok++;
    expect(ok).toBe(10);
  });

  it('sustains exactly the rate at 20 Hz input (no drops for a legit client)', () => {
    const b = new TokenBucket(30, 10, 0);
    for (let t = 0; t < 10_000; t += 50) expect(b.take(t)).toBe(true);
  });
});

describe('FloodGuard', () => {
  it('trips once the drops in one window reach the limit, and resets per window', () => {
    const g = new FloodGuard(90, 3000, 0);
    for (let i = 0; i < 89; i++) expect(g.drop(i)).toBe(false);
    expect(g.drop(100)).toBe(true);
    const h = new FloodGuard(3, 1000, 0);
    expect([h.drop(0), h.drop(0)]).toEqual([false, false]);
    expect(h.drop(1000)).toBe(false); // new window
  });
});

describe('IpCounter / normalizeIp', () => {
  it('counts per address and in total', () => {
    const c = new IpCounter();
    c.add('1.2.3.4');
    c.add('1.2.3.4');
    c.add('5.6.7.8');
    expect([c.count('1.2.3.4'), c.total]).toEqual([2, 3]);
    c.remove('1.2.3.4');
    c.remove('1.2.3.4');
    expect([c.count('1.2.3.4'), c.total]).toEqual([0, 1]);
  });
  it('maps IPv4-mapped IPv6 to IPv4', () => {
    expect(normalizeIp('::ffff:10.0.0.1')).toBe('10.0.0.1');
    expect(normalizeIp(undefined)).toBe('unknown');
  });
});

describe('originAllowed', () => {
  it('accepts same-origin and no Origin, rejects cross-origin', () => {
    expect(originAllowed(undefined, 'a.duckdns.org', true)).toBe(true);
    expect(originAllowed('https://a.duckdns.org', 'a.duckdns.org', true)).toBe(true);
    expect(originAllowed('http://a.duckdns.org', 'a.duckdns.org', true)).toBe(false);
    expect(originAllowed('https://evil.example', 'a.duckdns.org', true)).toBe(false);
    expect(originAllowed('null', 'a.duckdns.org', true)).toBe(false);
  });
  it('allows localhost dev origins only without TLS', () => {
    expect(originAllowed('http://localhost:5173', 'localhost:8787', false)).toBe(true);
    expect(originAllowed('http://localhost:5173', 'a.duckdns.org', true)).toBe(false);
    expect(originAllowed('http://192.168.1.9:5173', '192.168.1.9:8787', false)).toBe(false);
    expect(originAllowed('http://192.168.1.9:8787', '192.168.1.9:8787', false)).toBe(true);
  });
});

describe('daysUntil', () => {
  it('counts whole days to the X509 validTo date', () => {
    const now = Date.parse('2026-10-01T00:00:00Z');
    expect(daysUntil('Oct 11 00:00:00 2026 GMT', now)).toBe(10);
    expect(daysUntil('Sep 30 00:00:00 2026 GMT', now)).toBe(-1);
  });
});
