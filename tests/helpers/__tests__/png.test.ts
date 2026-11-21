import { crc32, deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { assertNotBlank, decodePng, lumaStats } from '../png';

function chunk(type: string, data: Uint8Array): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), Buffer.from(data)]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0, 0);
  return Buffer.concat([len, body, crc]);
}

/** Encodes RGBA pixels as a PNG, using `filter` for every row (0 none, 1 sub, 2 up, 3 average, 4 paeth). */
function encodeRgba(width: number, height: number, rgba: Uint8Array, filter = 0): Buffer {
  const stride = width * 4;
  const rows = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    rows[y * (stride + 1)] = filter;
    for (let x = 0; x < stride; x++) {
      const cur = rgba[y * stride + x]!;
      const a = x >= 4 ? rgba[y * stride + x - 4]! : 0;
      const b = y > 0 ? rgba[(y - 1) * stride + x]! : 0;
      const c = x >= 4 && y > 0 ? rgba[(y - 1) * stride + x - 4]! : 0;
      let pred = 0;
      if (filter === 1) pred = a;
      else if (filter === 2) pred = b;
      else if (filter === 3) pred = (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      rows[y * (stride + 1) + 1 + x] = (cur - pred) & 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(rows)), chunk('IEND', new Uint8Array(0))]);
}

function solid(w: number, h: number, r: number, g: number, b: number): Uint8Array {
  const px = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) px.set([r, g, b, 255], i * 4);
  return px;
}

function gradient(w: number, h: number): Uint8Array {
  const px = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px.set([(x * 255) / (w - 1), (y * 255) / (h - 1), 128, 255], (y * w + x) * 4);
  return px;
}

describe('png helper (T3 not-blank check)', () => {
  it('round-trips pixels through every PNG row filter', () => {
    const src = gradient(17, 9);
    for (const filter of [0, 1, 2, 3, 4]) {
      const img = decodePng(encodeRgba(17, 9, src, filter));
      expect(img.width).toBe(17);
      expect(img.height).toBe(9);
      expect(Buffer.from(img.rgba).equals(Buffer.from(src))).toBe(true);
    }
  });

  it('reports ~0 deviation for a flat image and rejects it as blank', () => {
    const png = encodeRgba(64, 64, solid(64, 64, 10, 12, 15));
    expect(lumaStats(png).stdDev).toBeCloseTo(0, 6);
    expect(() => assertNotBlank(png, 'flat')).toThrow(/blank/);
  });

  it('accepts a gradient and a half black / half white image', () => {
    expect(assertNotBlank(encodeRgba(64, 64, gradient(64, 64)), 'gradient').stdDev).toBeGreaterThan(30);
    const half = solid(32, 32, 0, 0, 0);
    for (let i = 0; i < 32 * 16; i++) half.set([255, 255, 255, 255], i * 4);
    const s = assertNotBlank(encodeRgba(32, 32, half), 'half');
    expect(s.mean).toBeCloseTo(127.5, 0);
    expect(s.stdDev).toBeCloseTo(127.5, 0);
  });

  it('rejects data that is not a PNG', () => {
    expect(() => decodePng(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]))).toThrow(/not a PNG/);
  });
});
