// QUALITY_PRESETS (docs/design/rendering.md §10): every contract field, all four presets, exactly as tabled.
// Derived per-preset constants that are not contract fields live in PRESET_DERIVED.

import type { QualityId } from '../contracts/common';
import type { QualityPreset } from '../contracts/render';

const PIXEL_RATIO_CAP: Readonly<Record<QualityId, number>> = { low: 1, medium: 1.25, high: 1.5, ultra: 2 };
/** Cap physical pixel density before applying the preset's render resolution. */
export function rendererPixelRatio(q: QualityPreset, deviceRatio: number): number {
  return Math.min(deviceRatio || 1, PIXEL_RATIO_CAP[q.id]) * q.renderScale;
}

export const QUALITY_PRESETS: Readonly<Record<QualityId, QualityPreset>> = Object.freeze({
  low: Object.freeze<QualityPreset>({
    id: 'low', renderScale: 0.75, aa: 'fxaa', smaa: 'MEDIUM', shadowSize: 1024, shadowExtent: 35, shadowRadius: 1, ao: 'off', bloom: false, lut: false,
    lens: 'droplets', envSize: 128, anisotropy: 2, carLod: [15, 80, 600], mirrors: 'static', treeDensity: 0.35, crowdDensity: 0.3, grassCards: 0,
    rainStreaks: 2000, sprayPerCar: 24, smokeMax: 256, skidQuads: 1000, far: 1800,
  }),
  medium: Object.freeze<QualityPreset>({
    id: 'medium', renderScale: 0.9, aa: 'smaa', smaa: 'MEDIUM', shadowSize: 2048, shadowExtent: 55, shadowRadius: 2, ao: 'off', bloom: true, lut: true,
    lens: 'dropletsCA', envSize: 256, anisotropy: 4, carLod: [25, 100, 800], mirrors: 'static', treeDensity: 0.6, crowdDensity: 0.6, grassCards: 12_000,
    rainStreaks: 4000, sprayPerCar: 48, smokeMax: 512, skidQuads: 2000, far: 2500,
  }),
  high: Object.freeze<QualityPreset>({
    id: 'high', renderScale: 1.0, aa: 'smaa', smaa: 'HIGH', shadowSize: 2048, shadowExtent: 70, shadowRadius: 3, ao: 'half', bloom: true, lut: true,
    lens: 'dropletsCA', envSize: 256, anisotropy: 8, carLod: [30, 120, 1000], mirrors: 'low30', treeDensity: 1.0, crowdDensity: 1.0, grassCards: 30_000,
    rainStreaks: 8000, sprayPerCar: 96, smokeMax: 1024, skidQuads: 4000, far: 3500,
  }),
  ultra: Object.freeze<QualityPreset>({
    id: 'ultra', renderScale: 1.0, aa: 'smaa', smaa: 'ULTRA', shadowSize: 4096, shadowExtent: 90, shadowRadius: 4, ao: 'full', bloom: true, lut: true,
    lens: 'all', envSize: 512, anisotropy: 16, carLod: [45, 160, 1500], mirrors: 'high60', treeDensity: 1.3, crowdDensity: 1.0, grassCards: 60_000,
    rainStreaks: 12_000, sprayPerCar: 160, smokeMax: 2048, skidQuads: 8000, far: 4500,
  }),
});

/**
 * Mobile branch (2026-11-21): the same preset id (so PRESET_DERIVED and every setQuality(q.id) branch stay valid), with
 * phone-sized costs: smaller render scale, one 1024 shadow cascade over a short extent, no AO / live mirrors / CA lens,
 * small environment map and anisotropy, thinner scenery and particles, shorter far plane. Desktop presets are untouched.
 */
export function mobilePreset(q: QualityPreset): QualityPreset {
  return Object.freeze<QualityPreset>({
    ...q,
    renderScale: Math.min(q.renderScale, q.id === 'low' ? 0.7 : 0.8),
    aa: 'fxaa', shadowSize: 1024, shadowExtent: Math.min(q.shadowExtent, 35), shadowRadius: 1, ao: 'off', bloom: q.id !== 'low' && q.bloom,
    lens: 'droplets', envSize: 128, anisotropy: Math.min(q.anisotropy, 2), mirrors: 'static',
    carLod: [Math.min(q.carLod[0], 15), Math.min(q.carLod[1], 70), Math.min(q.carLod[2], 500)],
    treeDensity: q.treeDensity * 0.6, crowdDensity: q.crowdDensity * 0.5, grassCards: 0,
    rainStreaks: Math.round(q.rainStreaks * 0.5), sprayPerCar: Math.round(q.sprayPerCar * 0.5), smokeMax: Math.min(q.smokeMax, 256),
    skidQuads: Math.min(q.skidQuads, 1000), far: Math.min(q.far, 1800),
  });
}

export interface PresetDerived {
  bloomLevels: number;
  /** N8AO samples (0 = off). */
  aoSamples: number;
  aoDenoiseSamples: number;
  liveryAtlas: number;
  liveryAtlasPlayer: number;
  mirrorRt: [number, number, number] | null;
  dropletSlots: [number, number];
  grassRadius: number;
  iridescence: boolean;
  /** LOD0 cap (rendering.md §7.3). Ultra 5, not 6: with LOD0 = 7 draws (D-022), 6 gives 91 car draws on a 20-car grid (cap 90). */
  lod0Cap: number;
  softParticles: boolean;
  flakeNormal: boolean;
}

export const PRESET_DERIVED: Readonly<Record<QualityId, PresetDerived>> = {
  low: { bloomLevels: 0, aoSamples: 0, aoDenoiseSamples: 0, liveryAtlas: 512, liveryAtlasPlayer: 1024, mirrorRt: null, dropletSlots: [24, 12], grassRadius: 0, iridescence: false, lod0Cap: 4, softParticles: false, flakeNormal: false },
  medium: { bloomLevels: 5, aoSamples: 0, aoDenoiseSamples: 0, liveryAtlas: 512, liveryAtlasPlayer: 1024, mirrorRt: null, dropletSlots: [48, 24], grassRadius: 80, iridescence: false, lod0Cap: 4, softParticles: true, flakeNormal: false },
  high: { bloomLevels: 6, aoSamples: 16, aoDenoiseSamples: 8, liveryAtlas: 1024, liveryAtlasPlayer: 2048, mirrorRt: [768, 192, 30], dropletSlots: [48, 24], grassRadius: 100, iridescence: true, lod0Cap: 4, softParticles: true, flakeNormal: true },
  ultra: { bloomLevels: 7, aoSamples: 32, aoDenoiseSamples: 8, liveryAtlas: 1024, liveryAtlasPlayer: 2048, mirrorRt: [1024, 256, 60], dropletSlots: [48, 24], grassRadius: 150, iridescence: true, lod0Cap: 5, softParticles: true, flakeNormal: true },
};
