// Minimal PNG decoder + luminance statistics (no dependencies; Node zlib only).
// Supports non-interlaced 8-bit greyscale, RGB, palette, grey+alpha and RGBA, which is what Chrome screenshots produce.

import { inflateSync } from 'node:zlib';

export interface DecodedPng { width: number; height: number; /** RGBA, 4 bytes per pixel */ rgba: Uint8Array }

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export function decodePng(buf: Uint8Array): DecodedPng {
  for (let i = 0; i < 8; i++) if (buf[i] !== SIGNATURE[i]) throw new Error('not a PNG (bad signature)');
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let width = 0;
  let height = 0;
  let depth = 0;
  let colorType = 0;
  let interlace = 0;
  let palette: Uint8Array | null = null;
  const idat: Uint8Array[] = [];
  let pos = 8;
  while (pos + 8 <= buf.length) {
    const len = view.getUint32(pos);
    const type = String.fromCharCode(buf[pos + 4]!, buf[pos + 5]!, buf[pos + 6]!, buf[pos + 7]!);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = view.getUint32(pos + 8);
      height = view.getUint32(pos + 12);
      depth = buf[pos + 16]!;
      colorType = buf[pos + 17]!;
      interlace = buf[pos + 20]!;
    } else if (type === 'PLTE') palette = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (width === 0 || height === 0) throw new Error('PNG without IHDR');
  if (depth !== 8) throw new Error(`unsupported PNG bit depth ${depth}`);
  if (interlace !== 0) throw new Error('interlaced PNG is not supported');
  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[colorType];
  if (channels === undefined) throw new Error(`unsupported PNG colour type ${colorType}`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  if (raw.length < (stride + 1) * height) throw new Error('PNG data truncated');

  const px = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? px[dst + x - channels]! : 0;
      const b = y > 0 ? px[dst - stride + x]! : 0;
      const c = x >= channels && y > 0 ? px[dst - stride + x - channels]! : 0;
      const v = raw[src + x]!;
      let out: number;
      switch (filter) {
        case 0: out = v; break;
        case 1: out = v + a; break;
        case 2: out = v + b; break;
        case 3: out = v + ((a + b) >> 1); break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          out = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default: throw new Error(`bad PNG filter ${filter}`);
      }
      px[dst + x] = out & 255;
    }
  }

  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0, n = width * height; i < n; i++) {
    const o = i * 4;
    switch (colorType) {
      case 0: rgba[o] = rgba[o + 1] = rgba[o + 2] = px[i]!; rgba[o + 3] = 255; break;
      case 2: rgba[o] = px[i * 3]!; rgba[o + 1] = px[i * 3 + 1]!; rgba[o + 2] = px[i * 3 + 2]!; rgba[o + 3] = 255; break;
      case 3: {
        const k = px[i]! * 3;
        rgba[o] = palette?.[k] ?? 0; rgba[o + 1] = palette?.[k + 1] ?? 0; rgba[o + 2] = palette?.[k + 2] ?? 0; rgba[o + 3] = 255;
        break;
      }
      case 4: rgba[o] = rgba[o + 1] = rgba[o + 2] = px[i * 2]!; rgba[o + 3] = px[i * 2 + 1]!; break;
      default: rgba[o] = px[i * 4]!; rgba[o + 1] = px[i * 4 + 1]!; rgba[o + 2] = px[i * 4 + 2]!; rgba[o + 3] = px[i * 4 + 3]!;
    }
  }
  return { width, height, rgba };
}

export interface LumaStats {
  width: number;
  height: number;
  /** 0..255 */
  mean: number;
  /** Population standard deviation of Rec.709 luma on 0..255 (the "not blank" metric, threshold > 8). */
  stdDev: number;
  min: number;
  max: number;
}

/** Luma statistics over every pixel of a decoded image. */
export function lumaStatsOf(img: DecodedPng): LumaStats {
  const { rgba, width, height } = img;
  const n = width * height;
  let sum = 0;
  let min = 255;
  let max = 0;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const y = 0.2126 * rgba[o]! + 0.7152 * rgba[o + 1]! + 0.0722 * rgba[o + 2]!;
    sum += y;
    if (y < min) min = y;
    if (y > max) max = y;
  }
  const mean = sum / n;
  // Two-pass variance: the one-pass sum-of-squares form loses precision on flat images.
  let sq = 0;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const d = 0.2126 * rgba[o]! + 0.7152 * rgba[o + 1]! + 0.0722 * rgba[o + 2]! - mean;
    sq += d * d;
  }
  const variance = sq / n;
  return { width, height, mean, stdDev: Math.sqrt(variance), min, max };
}

/** Threshold of testing-qc.md E-SH-01 / sprint-1.md T3: luminance standard deviation must exceed this. */
export const NOT_BLANK_MIN_STDDEV = 8;

export function lumaStats(png: Uint8Array): LumaStats {
  return lumaStatsOf(decodePng(png));
}

/** Throws a descriptive error when the image is (nearly) one flat colour. Returns the stats otherwise. */
export function assertNotBlank(png: Uint8Array, label: string, minStdDev = NOT_BLANK_MIN_STDDEV): LumaStats {
  const s = lumaStats(png);
  if (!(s.stdDev > minStdDev)) {
    throw new Error(`screenshot "${label}" looks blank: luma stdDev ${s.stdDev.toFixed(2)} <= ${minStdDev} (mean ${s.mean.toFixed(1)}, min ${s.min.toFixed(0)}, max ${s.max.toFixed(0)})`);
  }
  return s;
}
