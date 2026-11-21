// LightingRig data per time of day (rendering.md §5.2) and the overcast/rain modifiers (§5.3).
// Pure data + math (no three): `applyRigConditions` rewrites `out` from the base rig every call (never cumulative).

import type { TimeOfDay } from '../../contracts/common';
import type { ConditionsFrame } from '../../contracts/conditions';
import type { LightingRig } from '../../contracts/environment';

export const BASE_RIGS: Readonly<Record<TimeOfDay, Readonly<LightingRig>>> = {
  day: {
    tod: 'day', sunDir: { x: -0.196, y: 0.819, z: 0.539 }, sunColor: 0xfff4e5, sunIntensity: 3.5,
    hemiSky: 0xbcd8ff, hemiGround: 0x6b5a45, hemiIntensity: 0.44, envIntensity: 1.0, exposure: 1.0,
    fogColor: 0xd6d9d2, fogDensity: 0.00022, bloomIntensity: 0.25, bloomThreshold: 0.95, lut: 'day', shadows: true,
  },
  sunset: {
    tod: 'sunset', sunDir: { x: -0.935, y: 0.105, z: -0.34 }, sunColor: 0xffb36b, sunIntensity: 2.4,
    hemiSky: 0x8fa4d6, hemiGround: 0x5a3d2b, hemiIntensity: 0.45, envIntensity: 0.9, exposure: 1.15,
    fogColor: 0xe7a77a, fogDensity: 0.0003, bloomIntensity: 0.6, bloomThreshold: 0.85, lut: 'sunset', shadows: true,
  },
  night: {
    tod: 'night', sunDir: { x: 0.117, y: 0.94, z: 0.321 }, sunColor: 0xe8f0ff, sunIntensity: 2.4,
    hemiSky: 0xa8c4ff, hemiGround: 0x0d0c10, hemiIntensity: 0.08, envIntensity: 0.75, exposure: 0.9,
    fogColor: 0x141a26, fogDensity: 0.0003, bloomIntensity: 0.8, bloomThreshold: 0.9, lut: 'night', shadows: true,
  },
};

/** Per-track base-rig overrides (visual pass 2026-10; tracks-visual.md). Tracks without an entry use BASE_RIGS. */
export const TRACK_RIGS: Readonly<Partial<Record<string, Partial<Record<TimeOfDay, Partial<LightingRig>>>>>> = {
  // İstanbul: dusty, warm late-summer haze; a touch more sky fill at sunset (the fresh asphalt read near-black).
  istanbul: {
    day: { fogColor: 0xe0d4bc, sunColor: 0xffecd0, hemiGround: 0x7a6446 },
    sunset: { hemiIntensity: 0.58, fogColor: 0xe9a979 },
  },
  // Aegean Islands (tracks-aegean.md §8): clear sea air (the islands read across the water), a long warm sunset glow on
  // the sea, a clear night.
  aegean: {
    day: { fogColor: 0xcfe0ec, fogDensity: 0.00011, sunColor: 0xfff3e0, sunIntensity: 3.3, hemiSky: 0xbfdcff, hemiGround: 0x7a6a50 },
    sunset: { fogColor: 0xe9a07a, fogDensity: 0.00012, hemiIntensity: 0.55, hemiSky: 0x9ab0e0 },
    night: { fogDensity: 0.0002 },
  },
  // Desert Cliff (tracks-cliff.md §8): hot hazy air, strong sun, warm bounce off the sand; a dusty violet night.
  cliff: {
    day: { fogColor: 0xe2cda6, fogDensity: 0.0002, sunColor: 0xfff0d4, sunIntensity: 3.4, hemiSky: 0xc4d6ef, hemiGround: 0x9a7650 },
    sunset: { fogColor: 0xef9f68, fogDensity: 0.00024, hemiGround: 0x7a4a30 },
    night: { fogColor: 0x1b1622, fogDensity: 0.00024, hemiGround: 0x2a2018 },
  },
  // Volcano Rim (tracks-volcano.md §6): hazy, ash-dimmed sun with a sulphur tint by day, a blood-orange sunset, a dark
  // night under a red-lit plume (the lava and the floodlights carry it).
  volcano: {
    day: { sunColor: 0xffdcb4, sunIntensity: 2.8, hemiSky: 0x9ea4ae, hemiGround: 0x3a2c26, fogColor: 0xa89a8c, fogDensity: 0.00034, bloomIntensity: 0.45 },
    sunset: { sunColor: 0xff7a3a, sunIntensity: 2.6, hemiSky: 0x8a6a78, hemiGround: 0x4a2418, fogColor: 0xd8784a, fogDensity: 0.0003, bloomIntensity: 0.8, exposure: 1.15 },
    night: { fogColor: 0x2a0f0a, fogDensity: 0.00032, hemiSky: 0x6a3a38, hemiGround: 0x3a120a, hemiIntensity: 0.14, bloomIntensity: 1.0 },
  },
  // Cappadocia Valley (tracks-cappadocia.md §8): warm golden light off the rose tuff, a long low sunset glow, a dark
  // violet night (the floodlights, village and cave windows carry it).
  cappadocia: {
    // Golden mid-morning light from low in the south-west: long shadows off the chimneys, warm bounce off the tuff.
    day: { sunDir: { x: -0.5, y: 0.56, z: 0.66 }, sunColor: 0xffd59a, sunIntensity: 3.4, hemiSky: 0xb6cdeb, hemiGround: 0x9a6c52, fogColor: 0xe9d3b0, fogDensity: 0.00015 },
    // Sunset: clearer air than the base rig so the glow reaches across the valley, rose-pink bounce, a stronger bloom.
    sunset: { sunColor: 0xff8e48, sunIntensity: 3.0, hemiSky: 0xa49ad0, hemiGround: 0x8a4a3a, hemiIntensity: 0.55, fogColor: 0xf0a070, fogDensity: 0.0002, exposure: 1.22, bloomIntensity: 0.75 },
    night: { fogColor: 0x1a1522, fogDensity: 0.00026, hemiGround: 0x2a1c18, hemiIntensity: 0.1 },
  },
  // Alpine Pass (tracks-alpine.md §9): crisp, clear mountain air so the snowy peaks read at 4–6 km.
  alpine: {
    day: { fogColor: 0xc9d7e4, fogDensity: 0.00011, hemiGround: 0x5d6a48 },
    sunset: { fogDensity: 0.00017 },
  },
};

/** Base rig of a time of day for a track (overrides merged over BASE_RIGS). */
export function baseRig(tod: TimeOfDay, trackId?: string): Readonly<LightingRig> {
  const o = trackId ? TRACK_RIGS[trackId]?.[tod] : undefined;
  return o ? { ...BASE_RIGS[tod], ...o } : BASE_RIGS[tod];
}

/** Night extras (rendering.md §5.2): floodlight constants, used by the Sprint 2 floodlight pass. */
export const NIGHT = { FLOOD_GROUND_INTENSITY: 2.2, lampEmissive: 12, glowSize: 6, glowIntensity: 2.5, sunsetFactor: 0.35 } as const;

/** Sky colours per TOD (DESIGN.md §1.4.1). */
export const SKY_COLORS: Readonly<Record<TimeOfDay, { zenith: number; mid: number; horizon: number }>> = {
  day: { zenith: 0x7fb4e2, mid: 0xa9cbea, horizon: 0xd8e6f1 },
  sunset: { zenith: 0x2b3f6b, mid: 0xe58a6a, horizon: 0xffa04d },
  night: { zenith: 0x05070d, mid: 0x0a0d16, horizon: 0x3a2a1a },
};
export const OVERCAST = { zenith: 0x8e959d, horizon: 0xb7bdc3 } as const;

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const smooth = (e0: number, e1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** Mix two 0xRRGGBB colours (sRGB space, fine for these grading targets). */
export function mixHex(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  return (Math.round(lerp(ar, br, t)) << 16) | (Math.round(lerp(ag, bg, t)) << 8) | Math.round(lerp(ab, bb, t));
}

/** rendering.md §5.3; also returns the sun-shadow intensity for the caller. */
export function applyRigConditions(out: LightingRig, c: ConditionsFrame, trackId?: string): { shadowIntensity: number } {
  const base = baseRig(c.tod, trackId);
  const k = Math.min(1, Math.max(0, c.cloud));
  const r = Math.min(1, Math.max(0, c.rain));
  out.tod = base.tod;
  out.sunDir.x = base.sunDir.x;
  out.sunDir.y = base.sunDir.y;
  out.sunDir.z = base.sunDir.z;
  out.hemiGround = base.hemiGround;
  out.lut = base.lut;
  if (c.tod === 'night') {
    out.sunIntensity = base.sunIntensity * lerp(1, 0.85, k);
    out.sunColor = base.sunColor;
    out.hemiSky = mixHex(base.hemiSky, 0x232a36, k);
    out.hemiIntensity = base.hemiIntensity * lerp(1, 1.15, k);
    out.envIntensity = base.envIntensity;
    out.exposure = base.exposure;
    out.fogDensity = base.fogDensity * (1 + 0.6 * k + 1.5 * r);
    out.fogColor = mixHex(base.fogColor, 0x1a2029, k);
    out.bloomIntensity = lerp(base.bloomIntensity, 0.8, k);
    out.bloomThreshold = base.bloomThreshold;
    out.shadows = true;
    return { shadowIntensity: lerp(1, 0.7, k) };
  }
  out.sunIntensity = base.sunIntensity * lerp(1, 0.25, k);
  out.sunColor = mixHex(base.sunColor, 0xd8dde3, 0.7 * k);
  out.hemiSky = mixHex(base.hemiSky, 0xa7b0ba, k);
  out.hemiIntensity = base.hemiIntensity * lerp(1, 1.35, k);
  out.envIntensity = base.envIntensity * lerp(1, 0.85, k);
  out.exposure = base.exposure * lerp(1, 0.85, k);
  out.fogDensity = base.fogDensity * (1 + k + 1.5 * r);
  out.fogColor = mixHex(base.fogColor, 0x9aa1a8, k);
  out.bloomIntensity = lerp(base.bloomIntensity, 0.5, k);
  out.bloomThreshold = lerp(base.bloomThreshold, 0.9, k);
  if (smooth(0.3, 0.9, k) >= 0.5) out.lut = 'overcast';
  out.shadows = k < 0.95;
  return { shadowIntensity: lerp(1, 0.25, k) * (1 - smooth(0.8, 0.95, k)) };
}

export function cloneRig(r: Readonly<LightingRig>): LightingRig {
  return { ...r, sunDir: { ...r.sunDir } };
}
