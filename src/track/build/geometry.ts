// Sim layer: plain numeric helpers for the track build (no three, no DOM). Build-time only (allocations are fine here).

export const TWO_PI = Math.PI * 2;

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

export function wrapAngle(a: number): number {
  a = a % TWO_PI;
  if (a <= -Math.PI) a += TWO_PI;
  else if (a > Math.PI) a -= TWO_PI;
  return a;
}

export function wrap(v: number, L: number): number {
  const r = v % L;
  return r < 0 ? r + L : r;
}

/** Shortest signed distance from a to b on a loop of length L, in (-L/2, L/2]. */
export function loopDelta(a: number, b: number, L: number): number {
  const d = wrap(b - a, L);
  return d > L / 2 ? d - L : d;
}

/** Polyline as separate coordinate arrays. */
export interface Poly { x: number[]; z: number[] }

export function polyLength(p: Poly, closed: boolean): number {
  let L = 0;
  const n = p.x.length;
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const j = (i + 1) % n;
    L += Math.hypot(p.x[j]! - p.x[i]!, p.z[j]! - p.z[i]!);
  }
  return L;
}

/**
 * Centripetal Catmull-Rom (α = 0.5) through the vertices, sampled about every `step` metres of chord.
 * Closed: wraps; open: end tangents use mirrored ghost points. The result contains every original vertex.
 */
export function catmullRomDense(p: Poly, closed: boolean, step: number): Poly {
  const n = p.x.length;
  const out: Poly = { x: [], z: [] };
  const get = (i: number): [number, number] => {
    if (closed) {
      const k = ((i % n) + n) % n;
      return [p.x[k]!, p.z[k]!];
    }
    if (i < 0) return [2 * p.x[0]! - p.x[1]!, 2 * p.z[0]! - p.z[1]!];
    if (i >= n) return [2 * p.x[n - 1]! - p.x[n - 2]!, 2 * p.z[n - 1]! - p.z[n - 2]!];
    return [p.x[i]!, p.z[i]!];
  };
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const p0 = get(i - 1);
    const p1 = get(i);
    const p2 = get(i + 1);
    const p3 = get(i + 2);
    const t0 = 0;
    const t1 = t0 + Math.max(1e-6, Math.sqrt(Math.hypot(p1[0] - p0[0], p1[1] - p0[1])));
    const t2 = t1 + Math.max(1e-6, Math.sqrt(Math.hypot(p2[0] - p1[0], p2[1] - p1[1])));
    const t3 = t2 + Math.max(1e-6, Math.sqrt(Math.hypot(p3[0] - p2[0], p3[1] - p2[1])));
    const len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const m = Math.max(1, Math.ceil(len / step));
    for (let k = 0; k < m; k++) {
      const t = t1 + ((t2 - t1) * k) / m;
      for (let c = 0; c < 2; c++) {
        const a1 = ((t1 - t) / (t1 - t0)) * p0[c]! + ((t - t0) / (t1 - t0)) * p1[c]!;
        const a2 = ((t2 - t) / (t2 - t1)) * p1[c]! + ((t - t1) / (t2 - t1)) * p2[c]!;
        const a3 = ((t3 - t) / (t3 - t2)) * p2[c]! + ((t - t2) / (t3 - t2)) * p3[c]!;
        const b1 = ((t2 - t) / (t2 - t0)) * a1 + ((t - t0) / (t2 - t0)) * a2;
        const b2 = ((t3 - t) / (t3 - t1)) * a2 + ((t - t1) / (t3 - t1)) * a3;
        (c === 0 ? out.x : out.z).push(((t2 - t) / (t2 - t1)) * b1 + ((t - t1) / (t2 - t1)) * b2);
      }
    }
  }
  if (!closed) {
    out.x.push(p.x[n - 1]!);
    out.z.push(p.z[n - 1]!);
  }
  return out;
}

/** Cumulative arc length per vertex (index 0 = 0). Closed: one extra entry = total length. */
export function cumulative(p: Poly, closed: boolean): number[] {
  const n = p.x.length;
  const c = [0];
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const j = (i + 1) % n;
    c.push(c[i]! + Math.hypot(p.x[j]! - p.x[i]!, p.z[j]! - p.z[i]!));
  }
  return c;
}

/** Resample to `count` points at uniform arc-length spacing starting at arc length `start` (closed: wraps). */
export function resampleUniform(p: Poly, closed: boolean, count: number, spacing: number, start = 0): Poly {
  const n = p.x.length;
  const cum = cumulative(p, closed);
  const L = cum[cum.length - 1]!;
  const out: Poly = { x: new Array<number>(count), z: new Array<number>(count) };
  let seg = 0;
  for (let k = 0; k < count; k++) {
    let s = start + k * spacing;
    if (closed) s = wrap(s, L);
    else s = clamp(s, 0, L);
    if (cum[seg]! > s) seg = 0;
    while (seg < cum.length - 2 && cum[seg + 1]! < s) seg++;
    const a = seg;
    const b = (seg + 1) % n;
    const len = cum[seg + 1]! - cum[seg]!;
    const t = len > 0 ? (s - cum[seg]!) / len : 0;
    out.x[k] = p.x[a]! + (p.x[b]! - p.x[a]!) * t;
    out.z[k] = p.z[a]! + (p.z[b]! - p.z[a]!) * t;
  }
  return out;
}

/** Gaussian kernel (normalised) with radius ceil(3σ) samples. */
export function gaussianKernel(sigmaSamples: number): number[] {
  const r = Math.max(1, Math.ceil(3 * sigmaSamples));
  const k: number[] = [];
  let sum = 0;
  for (let i = -r; i <= r; i++) {
    const w = Math.exp(-(i * i) / (2 * sigmaSamples * sigmaSamples));
    k.push(w);
    sum += w;
  }
  return k.map((w) => w / sum);
}

/** Gaussian smoothing; closed wraps, open clamps the ends (end samples are kept fixed). */
/** Copy of `a` padded by `r` samples on both sides (wrapped when closed, clamped when open). */
function padded(a: readonly number[], r: number, closed: boolean): Float64Array {
  const n = a.length;
  const p = new Float64Array(n + 2 * r);
  for (let i = -r; i < n + r; i++) {
    let idx = i;
    if (closed) idx = ((idx % n) + n) % n;
    else idx = idx < 0 ? 0 : idx >= n ? n - 1 : idx;
    p[i + r] = a[idx]!;
  }
  return p;
}

export function gaussianSmooth(a: readonly number[], sigmaSamples: number, closed: boolean): number[] {
  if (sigmaSamples <= 0) return a.slice();
  const k = Float64Array.from(gaussianKernel(sigmaSamples));
  const r = (k.length - 1) / 2;
  const n = a.length;
  const p = padded(a, r, closed);
  const out = new Array<number>(n);
  const kl = k.length;
  for (let i = 0; i < n; i++) {
    let acc = 0;
    for (let j = 0; j < kl; j++) acc += k[j]! * p[i + j]!;
    out[i] = acc;
  }
  if (!closed) {
    out[0] = a[0]!;
    out[n - 1] = a[n - 1]!;
  }
  return out;
}

/** Sliding-window maximum (radius in samples). */
export function maxFilter(a: readonly number[], radius: number, closed: boolean): number[] {
  const n = a.length;
  const p = padded(a, radius, closed);
  if (!closed) {
    for (let i = 0; i < radius; i++) {
      p[i] = -Infinity;
      p[n + radius + i] = -Infinity;
    }
  }
  const out = new Array<number>(n);
  const w = 2 * radius + 1;
  for (let i = 0; i < n; i++) {
    let m = -Infinity;
    for (let j = 0; j < w; j++) if (p[i + j]! > m) m = p[i + j]!;
    out[i] = m;
  }
  return out;
}

/** Linear interpolation in a sample table (xs ascending). Closed tables wrap with period `period`. */
export function interpTable(xs: readonly number[], ys: readonly number[], x: number, period = 0): number {
  const n = xs.length;
  if (period > 0) {
    x = wrap(x, period);
    if (x < xs[0]!) {
      const x0 = xs[n - 1]! - period;
      const t = (x - x0) / (xs[0]! - x0);
      return ys[n - 1]! + (ys[0]! - ys[n - 1]!) * t;
    }
    if (x >= xs[n - 1]!) {
      const x1 = xs[0]! + period;
      const t = (x - xs[n - 1]!) / (x1 - xs[n - 1]!);
      return ys[n - 1]! + (ys[0]! - ys[n - 1]!) * t;
    }
  } else {
    if (x <= xs[0]!) return ys[0]!;
    if (x >= xs[n - 1]!) return ys[n - 1]!;
  }
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid]! <= x) lo = mid;
    else hi = mid;
  }
  const t = (x - xs[lo]!) / (xs[hi]! - xs[lo]!);
  return ys[lo]! + (ys[hi]! - ys[lo]!) * t;
}

/** FNV-1a over the raw bytes of typed arrays (determinism tests). */
export function hashArrays(arrays: readonly ArrayBufferView[]): string {
  let h = 0x811c9dc5;
  for (const a of arrays) {
    const u8 = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
    for (let i = 0; i < u8.length; i++) {
      h ^= u8[i]!;
      h = Math.imul(h, 0x01000193);
    }
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
