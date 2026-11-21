// Admin credential primitives (D-050): RFC 6238 vectors, base32, TOTP window/replay, scrypt, lockout, sessions, ring, IP hashing.
import { describe, expect, it } from 'vitest';
import { AUTH, LoginLimiter, Sessions } from '../admin/auth';
import { base32Decode, base32Encode, hashPassword, hotp, otpauthUri, safeEqual, totp, verifyPassword, verifyTotp } from '../admin/crypto';
import { EventRing } from '../admin/events';
import { logTag, netHash, netPrefix } from '../privacy';

const RFC_KEY = Buffer.from('12345678901234567890', 'ascii');

describe('TOTP (RFC 6238 appendix B, SHA-1)', () => {
  it.each([
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
    [20000000000, '65353130'],
  ])('T=%d → %s', (t, code) => {
    expect(totp(RFC_KEY, t * 1000, 8)).toBe(code);
  });

  it('HOTP RFC 4226 appendix D', () => {
    expect([0, 1, 2, 9].map((c) => hotp(RFC_KEY, c))).toEqual(['755224', '287082', '359152', '520489']);
  });

  it('base32 round trip and the RFC 4648 vector', () => {
    expect(base32Encode(Buffer.from('foobar'))).toBe('MZXW6YTBOI');
    const k = Buffer.from([1, 2, 3, 250, 251, 252, 253, 254, 255, 0, 7]);
    expect(base32Decode(base32Encode(k))).toEqual(k);
    expect(() => base32Decode('ABC1')).toThrow();
  });

  it('accepts ±1 step, refuses ±2 steps, malformed codes and replays', () => {
    const t = 1_700_000_000_000;
    const step = Math.floor(t / 30_000);
    const at = (ds: number): string => totp(RFC_KEY, t + ds * 30_000);
    expect(verifyTotp(RFC_KEY, at(0), t, -1)).toBe(step);
    expect(verifyTotp(RFC_KEY, at(-1), t, -1)).toBe(step - 1);
    expect(verifyTotp(RFC_KEY, at(1), t, -1)).toBe(step + 1);
    expect(verifyTotp(RFC_KEY, at(-2), t, -1)).toBe(-1);
    expect(verifyTotp(RFC_KEY, at(2), t, -1)).toBe(-1);
    expect(verifyTotp(RFC_KEY, '12345', t, -1)).toBe(-1);
    expect(verifyTotp(RFC_KEY, at(0) + '0', t, -1)).toBe(-1);
    // A used step (or an older one) never works again.
    expect(verifyTotp(RFC_KEY, at(0), t, step)).toBe(-1);
    expect(verifyTotp(RFC_KEY, at(-1), t, step)).toBe(-1);
  });

  it('otpauth URI', () => {
    expect(otpauthUri('ABC', 'admin', 'HAIRPIN GP')).toBe('otpauth://totp/HAIRPIN%20GP%3Aadmin?secret=ABC&issuer=HAIRPIN%20GP&algorithm=SHA1&digits=6&period=30');
  });
});

describe('scrypt passwords', () => {
  it('verifies the right password only; salts differ', async () => {
    const a = await hashPassword('correct horse battery');
    const b = await hashPassword('correct horse battery');
    expect(a.alg).toBe('scrypt');
    expect(a.N).toBe(1 << 15);
    expect(a.salt).not.toBe(b.salt);
    expect(a.hash).not.toBe(b.hash);
    expect(await verifyPassword('correct horse battery', a)).toBe(true);
    expect(await verifyPassword('correct horse batterY', a)).toBe(false);
    expect(await verifyPassword('', a)).toBe(false);
  });

  it('safeEqual', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
});

describe('LoginLimiter', () => {
  it('locks after 5 failures with doubling backoff up to 1 h; success resets', () => {
    let t = 0;
    const l = new LoginLimiter(AUTH, () => t);
    for (let i = 0; i < 4; i++) expect(l.fail('a')).toBe(0);
    expect(l.waitMs('a')).toBe(0);
    expect(l.fail('a')).toBe(60_000);
    expect(l.waitMs('a')).toBe(60_000);
    expect(l.waitMs('b')).toBe(0);
    t += 60_000;
    expect(l.waitMs('a')).toBe(0);
    expect(l.fail('a')).toBe(120_000);
    t += 120_000;
    expect(l.fail('a')).toBe(240_000);
    for (let i = 0; i < 10; i++) l.fail('a');
    expect(l.waitMs('a')).toBe(3_600_000);
    l.success('a');
    expect(l.waitMs('a')).toBe(0);
  });

  it('global cap locks every key', () => {
    let t = 0;
    const l = new LoginLimiter(AUTH, () => t);
    for (let i = 0; i <= AUTH.globalFails; i++) l.fail(`k${i}`);
    expect(l.waitMs('fresh')).toBe(AUTH.globalLockMs);
    t += AUTH.globalLockMs;
    expect(l.waitMs('fresh')).toBe(0);
  });
});

describe('Sessions', () => {
  it('idle timeout, touch, max age, destroy', () => {
    let t = 0;
    const s = new Sessions(AUTH, () => t);
    const { id } = s.create('n');
    t += AUTH.idleMs - 1;
    expect(s.get(id, false)).not.toBeNull();
    t += 1;
    expect(s.get(id, false)).toBeNull();

    const b = s.create('n').id;
    for (let i = 0; i < 23; i++) {
      t += 20 * 60_000;
      expect(s.get(b, true)).not.toBeNull();
    }
    t += 20 * 60_000; // 8 h since creation
    expect(s.get(b, true)).toBeNull();

    const c = s.create('n').id;
    s.destroy(c);
    expect(s.get(c, true)).toBeNull();
    expect(s.get('nonsense', true)).toBeNull();
  });
});

describe('privacy / events', () => {
  it('network prefixes and salted hashes', () => {
    expect(netPrefix('203.0.113.77')).toBe('203.0.113');
    expect(netPrefix('2001:db8:abcd:12::1')).toBe('2001:db8:abcd:12');
    expect(netPrefix('2001:db8::1')).toBe('2001:db8:0:0');
    expect(netHash('203.0.113.1', 's')).toBe(netHash('203.0.113.200', 's'));
    expect(netHash('203.0.113.1', 's')).not.toBe(netHash('203.0.114.1', 's'));
    expect(netHash('203.0.113.1', 's')).not.toBe(netHash('203.0.113.1', 't'));
    expect(logTag('203.0.113.1')).toMatch(/^[0-9a-f]{12}$/);
  });

  it('EventRing keeps the newest N, newest first', () => {
    const r = new EventRing(3);
    for (let i = 0; i < 5; i++) r.push(`e${i}`, {}, i);
    expect(r.recent().map((e) => e.event)).toEqual(['e4', 'e3', 'e2']);
  });
});
