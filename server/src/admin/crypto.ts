// Admin credentials (D-050): scrypt password hashes and TOTP (RFC 6238 over RFC 4226 HOTP), node:crypto only.
import { createHash, createHmac, randomBytes, scrypt, timingSafeEqual, type BinaryLike, type ScryptOptions } from 'node:crypto';

// ---- base32 (RFC 4648, no padding: what authenticator apps expect in otpauth URIs) ---------------------------------------

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Uint8Array): string {
  let out = '';
  let bits = 0;
  let value = 0;
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[\s=]/g, '');
  const out: number[] = [];
  let bits = 0;
  let value = 0;
  for (const ch of clean) {
    const v = B32.indexOf(ch);
    if (v < 0) throw new Error('invalid base32');
    value = (value << 5) | v;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

// ---- HOTP / TOTP -----------------------------------------------------------------------------------------------------------

export const TOTP_STEP_S = 30;
export const TOTP_DIGITS = 6;

/** RFC 4226 HOTP with HMAC-SHA1 (the algorithm every authenticator app supports by default). */
export function hotp(key: Uint8Array, counter: number, digits = TOTP_DIGITS): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac('sha1', key).update(msg).digest();
  const off = h[h.length - 1]! & 0x0f;
  const bin = ((h[off]! & 0x7f) << 24) | (h[off + 1]! << 16) | (h[off + 2]! << 8) | h[off + 3]!;
  return String(bin % 10 ** digits).padStart(digits, '0');
}

export function totpStep(unixMs: number): number {
  return Math.floor(unixMs / 1000 / TOTP_STEP_S);
}

export function totp(key: Uint8Array, unixMs: number, digits = TOTP_DIGITS): string {
  return hotp(key, totpStep(unixMs), digits);
}

/**
 * Checks a code against steps now−1, now, now+1 (clock drift). Every candidate is compared in constant time and all three
 * are always computed. Returns the matched step, or −1. Steps ≤ `lastStep` are refused (a code works once).
 */
export function verifyTotp(key: Uint8Array, code: string, unixMs: number, lastStep: number): number {
  const want = Buffer.from(/^\d{6}$/.test(code) ? code : '------');
  const now = totpStep(unixMs);
  let hit = -1;
  for (let s = now - 1; s <= now + 1; s++) {
    const ok = timingSafeEqual(Buffer.from(hotp(key, s)), want);
    if (ok && s > lastStep && hit < 0) hit = s;
  }
  return hit;
}

export function newTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function otpauthUri(secretB32: string, account: string, issuer: string): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secretB32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_STEP_S}`;
}

// ---- scrypt password hashes --------------------------------------------------------------------------------------------------

export interface PasswordHash {
  alg: 'scrypt';
  /** Cost parameters (N = 2^15, r = 8, p = 1: ~32 MB and ~0.1 s per check on an A1 core). */
  N: number;
  r: number;
  p: number;
  salt: string;
  hash: string;
}

const KEYLEN = 32;
export const SCRYPT_DEFAULTS = { N: 1 << 15, r: 8, p: 1 } as const;

function scryptAsync(pw: BinaryLike, salt: BinaryLike, opts: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => scrypt(pw, salt, KEYLEN, opts, (err, key) => (err ? reject(err) : resolve(key))));
}

const maxmem = (N: number, r: number): number => 128 * N * r * 2 + 1024 * 1024;

export async function hashPassword(password: string, params: { N: number; r: number; p: number } = SCRYPT_DEFAULTS): Promise<PasswordHash> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password.normalize('NFC'), salt, { ...params, maxmem: maxmem(params.N, params.r) });
  return { alg: 'scrypt', ...params, salt: salt.toString('base64'), hash: key.toString('base64') };
}

export async function verifyPassword(password: string, h: PasswordHash): Promise<boolean> {
  const want = Buffer.from(h.hash, 'base64');
  const got = await scryptAsync(password.normalize('NFC'), Buffer.from(h.salt, 'base64'), { N: h.N, r: h.r, p: h.p, maxmem: maxmem(h.N, h.r) });
  return want.length === got.length && timingSafeEqual(want, got);
}

/** Constant-time string compare (CSRF tokens, session ids). */
export function safeEqual(a: string, b: string): boolean {
  // Hash first so the compare is constant-time in the length too.
  const x = createHash('sha256').update(a).digest();
  const y = createHash('sha256').update(b).digest();
  return timingSafeEqual(x, y);
}
