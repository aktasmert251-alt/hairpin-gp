// Colour grades (docs/design/rendering.md §4.3 table, DESIGN.md §1.4.1 "Grade (LUT)" row).
// GRA records final tuned grades here. Parameters are interpolated, never the textures.

export interface GradeParams {
  /** White-balance temperature T and tint N. */
  temp: number;
  tint: number;
  contrast: number;
  saturation: number;
  shadowSat: number;
  slope: [number, number, number];
  offset: [number, number, number];
  power: [number, number, number];
  /** Linear-ish 0..1 colour of the shadow tint and its strength k_s. */
  shadowTint: [number, number, number];
  shadowK: number;
  highTint: [number, number, number];
  highK: number;
}

export type GradeId = 'day' | 'sunset' | 'night' | 'overcast';

/** sRGB hex → linear RGB triple (tints act on linear values). */
function hexLin(hex: number): [number, number, number] {
  const f = (c: number): number => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return [f((hex >> 16) & 255), f((hex >> 8) & 255), f(hex & 255)];
}

/** Normalises a tint so that tint·2 keeps mid luminance roughly stable (tint of grey 0.5 = identity). */
function tint(hex: number): [number, number, number] {
  const c = hexLin(hex);
  const l = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  const k = l > 0 ? 0.5 / l : 1;
  return [c[0] * k, c[1] * k, c[2] * k];
}

export const NEUTRAL_GRADE: Readonly<GradeParams> = {
  temp: 0, tint: 0, contrast: 1, saturation: 1, shadowSat: 1,
  slope: [1, 1, 1], offset: [0, 0, 0], power: [1, 1, 1],
  shadowTint: [0.5, 0.5, 0.5], shadowK: 0, highTint: [0.5, 0.5, 0.5], highK: 0,
};

export const GRADES: Readonly<Record<GradeId, Readonly<GradeParams>>> = {
  day: {
    temp: 0.02, tint: 0, contrast: 1.13, saturation: 1.03, shadowSat: 0.92,
    slope: [1, 1, 1], offset: [0.004, 0.004, 0.006], power: [1, 1, 1],
    shadowTint: tint(0x1c232c), shadowK: 0.12, highTint: tint(0xfff2dc), highK: 0.06,
  },
  sunset: {
    temp: 0.18, tint: 0, contrast: 1.1, saturation: 1.08, shadowSat: 0.75,
    slope: [1.04, 0.99, 0.95], offset: [0.004, 0.002, 0], power: [0.98, 1.0, 1.03],
    shadowTint: tint(0x26303a), shadowK: 0.15, highTint: tint(0xffb070), highK: 0.18,
  },
  night: {
    temp: -0.1, tint: 0, contrast: 1.18, saturation: 0.95, shadowSat: 0.9,
    slope: [0.97, 1.0, 1.04], offset: [0, 0.002, 0.006], power: [1.04, 1.02, 1.0],
    shadowTint: tint(0x0d1626), shadowK: 0.15, highTint: tint(0xe8f0ff), highK: 0.06,
  },
  overcast: {
    temp: -0.08, tint: 0, contrast: 0.9, saturation: 0.8, shadowSat: 1.0,
    slope: [1, 1, 1.01], offset: [0.015, 0.015, 0.017], power: [1, 1, 1],
    shadowTint: tint(0x20262c), shadowK: 0.1, highTint: tint(0xf0f2f4), highK: 0.04,
  },
};

function lerp3(a: readonly number[], b: readonly number[], t: number, out: [number, number, number]): [number, number, number] {
  out[0] = a[0]! + (b[0]! - a[0]!) * t;
  out[1] = a[1]! + (b[1]! - a[1]!) * t;
  out[2] = a[2]! + (b[2]! - a[2]!) * t;
  return out;
}

/** out = lerp(a, b, t) parameter-wise. */
export function lerpGrade(a: Readonly<GradeParams>, b: Readonly<GradeParams>, t: number, out: GradeParams): GradeParams {
  const l = (x: number, y: number): number => x + (y - x) * t;
  out.temp = l(a.temp, b.temp);
  out.tint = l(a.tint, b.tint);
  out.contrast = l(a.contrast, b.contrast);
  out.saturation = l(a.saturation, b.saturation);
  out.shadowSat = l(a.shadowSat, b.shadowSat);
  lerp3(a.slope, b.slope, t, out.slope);
  lerp3(a.offset, b.offset, t, out.offset);
  lerp3(a.power, b.power, t, out.power);
  lerp3(a.shadowTint, b.shadowTint, t, out.shadowTint);
  out.shadowK = l(a.shadowK, b.shadowK);
  lerp3(a.highTint, b.highTint, t, out.highTint);
  out.highK = l(a.highK, b.highK);
  return out;
}

export function cloneGrade(g: Readonly<GradeParams>): GradeParams {
  return { ...g, slope: [...g.slope], offset: [...g.offset], power: [...g.power], shadowTint: [...g.shadowTint], highTint: [...g.highTint] };
}

const smooth = (e0: number, e1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** Blend rule (§4.3): m = smoothstep(0.3, 0.9, cloud); night keeps its own temperature. */
export function gradeFor(tod: 'day' | 'sunset' | 'night', cloud: number, out: GradeParams): { m: number; id: GradeId } {
  const m = smooth(0.3, 0.9, cloud);
  if (tod === 'night') {
    lerpGrade(GRADES.night, GRADES.overcast, 0.5 * m, out);
    out.temp = GRADES.night.temp;
    return { m, id: 'night' };
  }
  lerpGrade(GRADES[tod], GRADES.overcast, m, out);
  return { m, id: m >= 0.5 ? 'overcast' : tod };
}
