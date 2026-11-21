// Runtime-neutral randomness for the room logic (D-064): Web Crypto `getRandomValues` exists in Node 24 and in browsers / Web
// Workers alike, so the Hub and Room run unchanged on the Node server and inside a host's browser (host-in-browser rooms).

const u32 = new Uint32Array(1);

/** Uniform integer in [min, max) (like node:crypto randomInt), max − min ≤ 2^32. */
export function randomInt(min: number, max?: number): number {
  if (max === undefined) {
    max = min;
    min = 0;
  }
  const range = max - min;
  if (!(range > 0) || range > 0x1_0000_0000) throw new RangeError('randomInt range');
  // Rejection sampling: no modulo bias.
  const limit = 0x1_0000_0000 - (0x1_0000_0000 % range);
  for (;;) {
    globalThis.crypto.getRandomValues(u32);
    if (u32[0]! < limit) return min + (u32[0]! % range);
  }
}

/** `n` random bytes as lower-case hex (like randomBytes(n).toString('hex')). */
export function randomHex(n: number): string {
  const b = globalThis.crypto.getRandomValues(new Uint8Array(n));
  let s = '';
  for (let i = 0; i < b.length; i++) s += b[i]!.toString(16).padStart(2, '0');
  return s;
}
