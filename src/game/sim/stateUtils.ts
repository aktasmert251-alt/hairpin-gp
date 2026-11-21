// Pure SimState utilities (sim layer): deep-assign for restore/snapshots, canonical FNV-1a hash, NaN finder.

type Bag = Record<string, unknown>;

function isTypedArray(v: unknown): v is Float32Array | Float64Array | Int32Array | Uint32Array | Uint16Array | Int16Array | Uint8Array | Int8Array {
  return ArrayBuffer.isView(v) && !(v instanceof DataView);
}

function assignSlot(dst: Bag | unknown[], key: string | number, sv: unknown): void {
  const d = dst as Bag;
  if (sv === null || typeof sv !== 'object') {
    d[key as string] = sv;
    return;
  }
  const dv = d[key as string];
  if (isTypedArray(sv)) {
    if (isTypedArray(dv) && dv.length === sv.length && dv.constructor === sv.constructor) (dv as Float64Array).set(sv as Float64Array);
    else d[key as string] = sv.slice();
    return;
  }
  if (Array.isArray(sv)) {
    if (!Array.isArray(dv)) {
      d[key as string] = structuredClone(sv);
      return;
    }
    if (dv.length !== sv.length) dv.length = sv.length;
    for (let i = 0; i < sv.length; i++) assignSlot(dv, i, sv[i]);
    return;
  }
  if (dv !== null && typeof dv === 'object' && !Array.isArray(dv) && !isTypedArray(dv)) {
    deepAssign(dv as Bag, sv as Bag);
    return;
  }
  d[key as string] = structuredClone(sv);
}

/**
 * Copies `src` into `dst` in place, preserving the identity of every nested object, array and typed array
 * that already exists with a compatible shape (systems may hold references into the state).
 * Allocation-free when shapes match.
 */
export function deepAssign<T extends object>(dst: T, src: T): T {
  const s = src as unknown as Bag;
  for (const key in s) assignSlot(dst as unknown as Bag, key, s[key]);
  return dst;
}

// ---- FNV-1a hashing over a canonical numeric walk --------------------------------------------

const F64 = new Float64Array(1);
const U32 = new Uint32Array(F64.buffer);
const PRIME = 16777619;

interface HashAcc { a: number; b: number }

function mixByte(h: HashAcc, byte: number): void {
  h.a = Math.imul(h.a ^ byte, PRIME);
  h.b = Math.imul(h.b ^ byte, PRIME);
}

function mixWord(h: HashAcc, w: number): void {
  mixByte(h, w & 0xff);
  mixByte(h, (w >>> 8) & 0xff);
  mixByte(h, (w >>> 16) & 0xff);
  mixByte(h, (w >>> 24) & 0xff);
}

function mixNumber(h: HashAcc, v: number): void {
  if (v !== v) {
    // Canonical NaN.
    mixWord(h, 0x7ff80000);
    mixWord(h, 0);
    return;
  }
  F64[0] = v === 0 ? 0 : v; // fold -0 into +0
  mixWord(h, U32[0]!);
  mixWord(h, U32[1]!);
}

function mixString(h: HashAcc, s: string): void {
  mixWord(h, s.length);
  for (let i = 0; i < s.length; i++) mixWord(h, s.charCodeAt(i));
}

function walk(h: HashAcc, v: unknown): void {
  switch (typeof v) {
    case 'number':
      mixByte(h, 1);
      mixNumber(h, v);
      return;
    case 'boolean':
      mixByte(h, v ? 3 : 2);
      return;
    case 'string':
      mixByte(h, 4);
      mixString(h, v);
      return;
    case 'undefined':
      mixByte(h, 5);
      return;
    case 'object':
      break;
    default:
      mixByte(h, 6);
      return;
  }
  if (v === null) {
    mixByte(h, 7);
    return;
  }
  if (isTypedArray(v)) {
    mixByte(h, 8);
    mixWord(h, v.length);
    for (let i = 0; i < v.length; i++) mixNumber(h, v[i]!);
    return;
  }
  if (Array.isArray(v)) {
    mixByte(h, 9);
    mixWord(h, v.length);
    for (let i = 0; i < v.length; i++) walk(h, v[i]);
    return;
  }
  mixByte(h, 10);
  const obj = v as Bag;
  const keys = Object.keys(obj).sort();
  mixWord(h, keys.length);
  for (const k of keys) {
    mixString(h, k);
    walk(h, obj[k]);
  }
}

/** 64-bit (two independent FNV-1a lanes) hash of any plain-data value, as 16 hex chars. Stable across runs. */
export function hashState(value: unknown): string {
  const h: HashAcc = { a: 0x811c9dc5 | 0, b: 0x050c5d1f | 0 };
  walk(h, value);
  return (h.a >>> 0).toString(16).padStart(8, '0') + (h.b >>> 0).toString(16).padStart(8, '0');
}

/** Path of the first non-finite number in a plain-data value, or null. */
export function findNonFinite(value: unknown, path = 'state'): string | null {
  if (typeof value === 'number') return Number.isFinite(value) ? null : path;
  if (value === null || typeof value !== 'object') return null;
  if (isTypedArray(value)) {
    for (let i = 0; i < value.length; i++) if (!Number.isFinite(value[i]!)) return `${path}[${i}]`;
    return null;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const r = findNonFinite(value[i], `${path}[${i}]`);
      if (r) return r;
    }
    return null;
  }
  for (const [k, v] of Object.entries(value as Bag)) {
    // sp is NaN by contract on the main ribbon (TrackHint / GroundHit).
    if (k === 'sp' && typeof v === 'number' && v !== v) continue;
    const r = findNonFinite(v, `${path}.${k}`);
    if (r) return r;
  }
  return null;
}
