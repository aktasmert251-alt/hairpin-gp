// Per-track "look" (tracks-visual pass, 2026-10): a small grade / exposure / bloom offset applied on top of the time-of-day
// grade (lutPresets.ts) so each venue has its own mood. Pure data + math; the post chain applies it when the LUT is
// rebuilt (never per frame). The track id reaches the renderer via `envScene.userData.trackId` (set by the environment)
// or GraphicsSystem `setTrackLook`; unknown ids / null = no offset.

import type { GradeParams } from './lutPresets';

type Tod = 'day' | 'sunset' | 'night';

export interface LookTone {
  /** Added to the grade's white-balance temperature / tint. */
  temp: number;
  tint: number;
  /** Multipliers on contrast / saturation. */
  contrast: number;
  saturation: number;
  /** Shadow / highlight tint (sRGB hex) and strength (replace the grade's when k > 0). */
  shadow: number;
  shadowK: number;
  high: number;
  highK: number;
  /** Added to the grade's lift (offset), per channel. */
  lift: [number, number, number];
  /** Multipliers on the rig's exposure and bloom intensity. */
  exposure: number;
  bloom: number;
}

export interface TrackLook {
  tod: Record<Tod, LookTone>;
  /** Overcast / rain tone, blended in with the cloud factor m (same m as the grade's overcast blend). */
  wet: LookTone;
}

const T = (p: Partial<LookTone>): LookTone => ({
  temp: 0, tint: 0, contrast: 1, saturation: 1, shadow: 0x808080, shadowK: 0, high: 0x808080, highK: 0, lift: [0, 0, 0], exposure: 1, bloom: 1, ...p,
});

export const TRACK_LOOKS: Readonly<Record<string, TrackLook>> = {
  // İstanbul (Anatolian upland): warm dusty light, golden highlights, cool blue-grey shadows; amber dusk; sodium-warm
  // night under a deep blue sky; rain stays cool-grey but keeps contrast (no milky wash).
  istanbul: {
    tod: {
      day: T({ temp: 0.14, tint: 0.015, contrast: 1.12, saturation: 1.12, shadow: 0x2a3444, shadowK: 0.18, high: 0xffd89a, highK: 0.22, lift: [0.006, 0.003, -0.002], exposure: 1.05 }),
      sunset: T({ temp: 0.06, contrast: 1.08, saturation: 1.06, shadow: 0x302a40, shadowK: 0.22, high: 0xffa050, highK: 0.24, lift: [0.012, 0.007, 0.008], exposure: 1.18, bloom: 1.15 }),
      night: T({ temp: 0.09, contrast: 1.12, saturation: 1.08, shadow: 0x101828, shadowK: 0.08, high: 0xffc780, highK: 0.2, lift: [0.002, 0.001, 0.002], exposure: 1.1, bloom: 0.9 }),
    },
    wet: T({ temp: -0.04, contrast: 1.16, saturation: 1.08, shadow: 0x1a2430, shadowK: 0.16, high: 0xe8eef4, highK: 0.06, lift: [-0.008, -0.007, -0.004], exposure: 0.98 }),
  },
  // Lombardia (northern-Italian park): warm hazy sun, lifted soft greens, gentle contrast; peach dusk; neutral-warm night
  // with lit stands; rain keeps the greens alive but cools slightly.
  lombardia: {
    tod: {
      day: T({ temp: 0.1, tint: -0.012, contrast: 1.04, saturation: 1.12, shadow: 0x2c3a38, shadowK: 0.14, high: 0xffe7b0, highK: 0.2, lift: [0.008, 0.008, 0.004], exposure: 1.04 }),
      sunset: T({ temp: 0.05, tint: -0.005, contrast: 1.04, saturation: 1.08, shadow: 0x363040, shadowK: 0.18, high: 0xffb470, highK: 0.22, lift: [0.012, 0.008, 0.008], exposure: 1.2, bloom: 1.12 }),
      night: T({ temp: 0.04, contrast: 1.08, saturation: 1.06, shadow: 0x121c24, shadowK: 0.08, high: 0xffd8a0, highK: 0.16, lift: [0.002, 0.002, 0.002], exposure: 1.1, bloom: 0.95 }),
    },
    wet: T({ temp: -0.03, tint: -0.01, contrast: 1.1, saturation: 1.06, shadow: 0x1c2a2a, shadowK: 0.14, high: 0xe6efe8, highK: 0.06, lift: [-0.005, -0.003, -0.004], exposure: 0.99 }),
  },
  // Bosphorus (seaside city): clear cool-blue sea air with clean whites, saturated magenta-amber sunset, strong glowing
  // night city (more bloom, cool-teal shadows); rain goes steel-blue.
  bosphorus: {
    tod: {
      day: T({ temp: -0.06, tint: -0.005, contrast: 1.08, saturation: 1.14, shadow: 0x1e3048, shadowK: 0.2, high: 0xfff4e0, highK: 0.12, lift: [-0.002, 0.002, 0.008], exposure: 1.05 }),
      sunset: T({ temp: 0.02, tint: 0.012, contrast: 1.1, saturation: 1.22, shadow: 0x2c2a4c, shadowK: 0.24, high: 0xff9060, highK: 0.26, lift: [0.01, 0.004, 0.012], exposure: 1.2, bloom: 1.2 }),
      night: T({ temp: -0.03, contrast: 1.1, saturation: 1.16, shadow: 0x0c1830, shadowK: 0.12, high: 0xffd0a0, highK: 0.18, lift: [0, 0.002, 0.006], exposure: 1.12, bloom: 1.25 }),
    },
    wet: T({ temp: -0.07, contrast: 1.12, saturation: 1.06, shadow: 0x16263a, shadowK: 0.18, high: 0xe4ecf6, highK: 0.08, lift: [-0.008, -0.005, 0.002], exposure: 0.98, bloom: 1.05 }),
  },
  // Ardennes (forest): moist, slightly desaturated green-grey, misty lifted blacks with softer contrast; cold dim dusk;
  // dark teal night; rain deepens the greens without crushing.
  ardennes: {
    tod: {
      day: T({ temp: -0.02, tint: -0.02, contrast: 0.96, saturation: 0.9, shadow: 0x2a3a3a, shadowK: 0.2, high: 0xe8f0e0, highK: 0.14, lift: [0.006, 0.01, 0.008], exposure: 1.06 }),
      sunset: T({ temp: 0.01, tint: -0.012, contrast: 0.98, saturation: 0.94, shadow: 0x2c3844, shadowK: 0.2, high: 0xf0b078, highK: 0.2, lift: [0.008, 0.01, 0.01], exposure: 1.2, bloom: 1.05 }),
      night: T({ temp: -0.04, tint: -0.01, contrast: 1.02, saturation: 0.92, shadow: 0x0e1a20, shadowK: 0.1, high: 0xe0e8dc, highK: 0.1, lift: [0.002, 0.004, 0.004], exposure: 1.14, bloom: 1.05 }),
    },
    wet: T({ temp: -0.05, tint: -0.02, contrast: 1.04, saturation: 0.96, shadow: 0x18282a, shadowK: 0.16, high: 0xdfe8e4, highK: 0.06, lift: [-0.002, 0.002, 0.002], exposure: 1.0 }),
  },
};

const hexLin = (hex: number): [number, number, number] => {
  const f = (c: number): number => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return [f((hex >> 16) & 255), f((hex >> 8) & 255), f(hex & 255)];
};
/** Same normalisation as lutPresets `tint()`: grey 0.5 = identity. */
const tintOf = (hex: number, out: [number, number, number]): void => {
  const c = hexLin(hex);
  const l = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  const k = l > 0 ? 0.5 / l : 1;
  out[0] = c[0] * k;
  out[1] = c[1] * k;
  out[2] = c[2] * k;
};

const tmp: [number, number, number] = [0, 0, 0];
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

function applyTone(g: GradeParams, l: LookTone, w: number): void {
  if (w <= 0) return;
  g.temp += l.temp * w;
  g.tint += l.tint * w;
  g.contrast *= lerp(1, l.contrast, w);
  g.saturation *= lerp(1, l.saturation, w);
  for (let i = 0; i < 3; i++) g.offset[i] = g.offset[i]! + l.lift[i]! * w;
  if (l.shadowK > 0) {
    tintOf(l.shadow, tmp);
    for (let i = 0; i < 3; i++) g.shadowTint[i] = lerp(g.shadowTint[i]!, tmp[i]!, w);
    g.shadowK = lerp(g.shadowK, l.shadowK, w);
  }
  if (l.highK > 0) {
    tintOf(l.high, tmp);
    for (let i = 0; i < 3; i++) g.highTint[i] = lerp(g.highTint[i]!, tmp[i]!, w);
    g.highK = lerp(g.highK, l.highK, w);
  }
}

/** Applies the track look to a grade already computed for (tod, cloud factor m). */
export function applyTrackLook(g: GradeParams, look: TrackLook | null, tod: Tod, m: number): void {
  if (!look) return;
  applyTone(g, look.tod[tod], 1 - m);
  applyTone(g, look.wet, m);
}

/** Exposure / bloom multipliers for the rig values (blended like the grade). */
export function lookScale(look: TrackLook | null, tod: Tod, m: number, key: 'exposure' | 'bloom'): number {
  if (!look) return 1;
  return lerp(look.tod[tod][key], look.wet[key], m);
}
