// Screenshot catalogue for the gallery (testing-qc.md §3, ARCHITECTURE §8). Pure data + small helpers; no Playwright imports.

import type { CameraId, QualityId, TimeOfDay, WeatherPreset } from '../../src/contracts/common';
import type { UrlParams } from '../helpers/apexClient';

// ---- sandbox scenes -------------------------------------------------------------------------------------------------------------

/** Scene ids the Sprint 1 plan promises (sprint-1.md §2-§4). Missing ones are reported as skipped with a warning (hand-off H5). */
export const EXPECTED_SPRINT1_SCENES: readonly string[] = [
  'skeleton', 'track-data', 'track', 'car', 'cameras', 'vfx', 'post', 'physics', 'ai', 'audio',
];

export interface SceneVariant { name: string; params: UrlParams }

/** Params every scene shot gets (deterministic, time frozen after `t`). */
export const SCENE_COMMON: UrlParams = { freeze: 1 };

/**
 * Variants per scene id beyond the default shot. Only the common URL extras of ARCHITECTURE §8 (`cam`, `quality`, `tod`, `weather`,
 * `seed`, `lang`) plus the camera presets documented in sprint-1.md Ç9 are used, so a scene that ignores a parameter still yields a
 * valid (if identical) picture.
 */
export const SCENE_VARIANTS: Readonly<Record<string, readonly SceneVariant[]>> = {
  track: [
    ...(['sf', 't1', 't8', 't12', 'pit', 'aerial'] as const).map((cam) => ({ name: cam, params: { cam, quality: 'high', tod: 'day' } })),
    { name: 't8-low', params: { cam: 't8', quality: 'low', tod: 'day' } },
    { name: 't8-ultra', params: { cam: 't8', quality: 'ultra', tod: 'day' } },
  ],
  car: [
    { name: 'low', params: { quality: 'low' } },
    { name: 'ultra', params: { quality: 'ultra' } },
  ],
  post: (['low', 'medium', 'high', 'ultra'] as const).map((quality) => ({ name: quality, params: { quality } })),
  cameras: [{ name: 'night', params: { tod: 'night' } }],
  audio: [{ name: 'offline', params: { offline: 1 } }],
  physics: [
    { name: 'oval', params: { track: 'oval' } },
    { name: 'straight', params: { track: 'straight' } },
    { name: 'istanbul', params: { track: 'istanbul' } },
  ],
};

// ---- İstanbul screenshot points (testing-qc.md §3) -------------------------------------------------------------------------------

/** OSM-basis length the `s` values are given on (report §7.3). Convert with s_final = s * L / OSM_LENGTH. */
export const OSM_LENGTH = 5351.5;

export type PointId = 'sf' | 't1' | 't3' | 't8' | 't9' | 't12' | 'pit';

export interface ShotPoint {
  id: PointId;
  /** metres on the OSM basis */
  s: number;
  /** metres, positive to the left */
  d: number;
  kmh: number;
  view: CameraId | 'freeCam';
  /** What a human reviewer looks for (copied into index.json). */
  look: string;
}

export const POINTS: readonly ShotPoint[] = [
  { id: 'sf', s: 5300, d: 0, kmh: 0, view: 'chaseFar', look: 'start gantry (s 0), main grandstand (right), pit wall and building (left), grid boxes' },
  { id: 't1', s: 150, d: -4.0, kmh: 280, view: 'chaseNear', look: 'T1 braking boards, apex kerb (left), hill bleachers, drop after apex' },
  { id: 't3', s: 930, d: 1.0, kmh: 210, view: 'chaseNear', look: 'crest (highest point), sky, blind left' },
  { id: 't8', s: 2392, d: -2.0, kmh: 270, view: 'chaseFar', look: 'multi-apex left, outside bleachers, gravel second half, sparks bump' },
  { id: 't9', s: 3230, d: -2.5, kmh: 140, view: 'cockpit', look: 'steep downhill braking, lowest point, halo and wheel in frame' },
  { id: 't12', s: 4600, d: -3.0, kmh: 320, view: 'chaseNear', look: 'biggest braking zone, DRS end board, T12 bleachers' },
  { id: 'pit', s: 5150, d: 0, kmh: 0, view: 'freeCam', look: 'pit lane, pit wall, garages with team colours' },
];

export interface Condition {
  id: string;
  tod: TimeOfDay;
  /** The SessionConfig weather preset that best matches the explicit rain/wetness. */
  weather: WeatherPreset;
  weatherLabel: 'dry' | 'light' | 'heavy';
  rain: number;
  wetness: number;
}

/** Conditions matrix of testing-qc.md §3 (`rain` / `wetness` set explicitly). */
export const CONDITIONS: readonly Condition[] = [
  { id: 'day-dry', tod: 'day', weather: 'dry', weatherLabel: 'dry', rain: 0, wetness: 0 },
  { id: 'day-heavy', tod: 'day', weather: 'heavy', weatherLabel: 'heavy', rain: 0.9, wetness: 0.95 },
  { id: 'sunset-dry', tod: 'sunset', weather: 'dry', weatherLabel: 'dry', rain: 0, wetness: 0 },
  { id: 'sunset-light', tod: 'sunset', weather: 'light', weatherLabel: 'light', rain: 0.35, wetness: 0.4 },
  { id: 'night-dry', tod: 'night', weather: 'dry', weatherLabel: 'dry', rain: 0, wetness: 0 },
  { id: 'night-heavy', tod: 'night', weather: 'heavy', weatherLabel: 'heavy', rain: 0.9, wetness: 0.95 },
];

export interface PresetRun { preset: QualityId; condition: Condition; points: readonly PointId[] }

const ALL_POINTS: readonly PointId[] = POINTS.map((p) => p.id);

/**
 * Main gallery = 7 points x 6 conditions on High (42 shots) + `sf` and `t8` on Low and Ultra (day-dry), testing-qc.md §3.
 * `quick` (the default of `npm run shots`) keeps only day-dry on High so the run stays short; `APEX_GALLERY=full` runs the matrix.
 */
export function pointRuns(full: boolean): PresetRun[] {
  const runs: PresetRun[] = [];
  const dayDry = CONDITIONS[0]!;
  if (!full) return [{ preset: 'high', condition: dayDry, points: ALL_POINTS }];
  for (const condition of CONDITIONS) runs.push({ preset: 'high', condition, points: ALL_POINTS });
  runs.push({ preset: 'low', condition: dayDry, points: ['sf', 't8'] });
  runs.push({ preset: 'ultra', condition: dayDry, points: ['sf', 't8'] });
  return runs;
}

/** `test-results/screens/gallery/<point>-<tod>-<weather>-<preset>.png` (file stem). */
export function pointFileStem(point: string, c: Condition, preset: QualityId): string {
  return `${point}-${c.tod}-${c.weatherLabel}-${preset}`;
}
