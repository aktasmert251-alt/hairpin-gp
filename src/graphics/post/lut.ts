// Procedural 3D LUT (docs/design/rendering.md §4.3): 32³ RGBA8, lattice points are sRGB-encoded inputs,
// outputs are sRGB-encoded graded colours. buildLutData is pure (unit-tested for identity).

import { LinearFilter, NoColorSpace, UnsignedByteType } from 'three';
import { LookupTexture } from 'postprocessing';
import type { GradeParams } from './lutPresets';

export const LUT_SIZE = 32;

const srgbToLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const linearToSrgb = (c: number): number => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);
const smooth = (e0: number, e1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
const LOG_MID = Math.log2(0.18);

/** Grades one sRGB-encoded colour in place (`c` = [r, g, b] 0..1). */
export function gradeColor(g: Readonly<GradeParams>, c: [number, number, number]): [number, number, number] {
  // 1. to linear
  let r = srgbToLinear(c[0]);
  let gg = srgbToLinear(c[1]);
  let b = srgbToLinear(c[2]);
  // 2. white balance
  r *= 1 + 0.1 * g.temp + 0.02 * g.tint;
  gg *= 1 - 0.02 * g.tint;
  b *= 1 - 0.1 * g.temp;
  // 3. contrast around mid grey in log space (skipped when neutral so identity is exact)
  if (g.contrast !== 1) {
    const k = (v: number): number => 2 ** ((Math.log2(v + 1e-4) - LOG_MID) * g.contrast + LOG_MID);
    r = Math.max(0, k(r));
    gg = Math.max(0, k(gg));
    b = Math.max(0, k(b));
  }
  // 4. ASC CDL
  r = Math.max(0, r * g.slope[0] + g.offset[0]) ** g.power[0];
  gg = Math.max(0, gg * g.slope[1] + g.offset[1]) ** g.power[1];
  b = Math.max(0, b * g.slope[2] + g.offset[2]) ** g.power[2];
  // 5. saturation
  let luma = 0.2126 * r + 0.7152 * gg + 0.0722 * b;
  r = luma + (r - luma) * g.saturation;
  gg = luma + (gg - luma) * g.saturation;
  b = luma + (b - luma) * g.saturation;
  // 6. shadow desaturation
  const ws = 1 - smooth(0, 0.35, luma);
  const sd = ws * (1 - g.shadowSat);
  r += (luma - r) * sd;
  gg += (luma - gg) * sd;
  b += (luma - b) * sd;
  // 7. split toning
  luma = 0.2126 * r + 0.7152 * gg + 0.0722 * b;
  const wh = smooth(0.55, 1, luma);
  const ks = ws * g.shadowK;
  r += (r * g.shadowTint[0] * 2 - r) * ks;
  gg += (gg * g.shadowTint[1] * 2 - gg) * ks;
  b += (b * g.shadowTint[2] * 2 - b) * ks;
  const kh = wh * g.highK;
  r += (r * g.highTint[0] * 2 - r) * kh;
  gg += (gg * g.highTint[1] * 2 - gg) * kh;
  b += (b * g.highTint[2] * 2 - b) * kh;
  // 8. back to sRGB, clamped
  c[0] = Math.min(1, Math.max(0, linearToSrgb(Math.max(0, r))));
  c[1] = Math.min(1, Math.max(0, linearToSrgb(Math.max(0, gg))));
  c[2] = Math.min(1, Math.max(0, linearToSrgb(Math.max(0, b))));
  return c;
}

/** Fills (or allocates) RGBA8 lattice data, r fastest, then g, then b. */
export function buildLutData(g: Readonly<GradeParams>, size = LUT_SIZE, out?: Uint8Array): Uint8Array {
  const data = out ?? new Uint8Array(size * size * size * 4);
  const c: [number, number, number] = [0, 0, 0];
  const inv = 1 / (size - 1);
  let i = 0;
  for (let bz = 0; bz < size; bz++) {
    for (let gy = 0; gy < size; gy++) {
      for (let rx = 0; rx < size; rx++) {
        c[0] = rx * inv;
        c[1] = gy * inv;
        c[2] = bz * inv;
        gradeColor(g, c);
        data[i++] = Math.round(c[0] * 255);
        data[i++] = Math.round(c[1] * 255);
        data[i++] = Math.round(c[2] * 255);
        data[i++] = 255;
      }
    }
  }
  return data;
}

export function createLutTexture(g: Readonly<GradeParams>): LookupTexture {
  const tex = new LookupTexture(buildLutData(g), LUT_SIZE);
  tex.type = UnsignedByteType;
  tex.colorSpace = NoColorSpace; // data texture: values are already sRGB-encoded outputs
  tex.minFilter = LinearFilter;
  tex.magFilter = LinearFilter;
  tex.name = 'apex.lut';
  tex.needsUpdate = true;
  return tex;
}

/** Rewrites an existing LUT texture in place (no new GPU object). */
export function updateLutTexture(tex: LookupTexture, g: Readonly<GradeParams>): void {
  const img = tex.image as unknown as { data: Uint8Array };
  buildLutData(g, LUT_SIZE, img.data);
  tex.needsUpdate = true;
}
