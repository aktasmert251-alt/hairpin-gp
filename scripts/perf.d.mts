// Types for scripts/perf.mjs (consumed by tests/perf/fps.spec.ts). Keep in sync with the exports of perf.mjs.

import type { Browser } from '@playwright/test';

export type PresetId = 'low' | 'medium' | 'high' | 'ultra';
export type ScenarioId = 'A' | 'B' | 'C';

export interface Gate { metric: string; value: number | string; limit: string; pass: boolean; severity: 'P0' | 'P1' | 'P2' }

export interface RendererStats { calls: number; triangles: number; geometries: number; textures: number; programs: number }

export interface PerfResult {
  preset: PresetId;
  scenario: string;
  url: string;
  skipped?: string;
  when?: string;
  gpu?: string;
  valid: boolean;
  fps?: number;
  frameMsAvg?: number;
  frameMsP95?: number;
  frameMsMax?: number;
  hitches?: number;
  simOverrun?: number;
  renderer?: RendererStats;
  heapMB?: number | null;
  apexFps?: number;
  runsFps?: (number | null)[];
  warmupS?: number;
  sampleS?: number;
  uncapped?: boolean;
  pageErrors?: string[];
  gates?: Gate[];
}

export interface RunScenarioOptions {
  kind: 'race' | 'scene';
  preset: PresetId;
  /** Label written to the JSON: 'A' | 'B' | 'C' or 'scene:<name>'. */
  scenario: string;
  /** 'A' | 'B' | 'C' for race scenarios (gate selection), undefined for scenes. */
  scenarioId?: ScenarioId;
  url: string;
  baseUrl: string;
  runs: number;
  warmupS: number;
  sampleS: number;
  cooldownS: number;
  minFps?: number;
  gpuPattern?: string;
  /** Recorded in the JSON only; the Chrome flags are chosen when the browser is launched. */
  uncapped?: boolean;
}

export const ROOT: string;
export const PERF_DIR: string;
export const REPORT_FILE: string;
export const PERF_FLAGS: string[];
export const UNCAPPED_FLAGS: string[];
export const VIEWPORT: { width: number; height: number };
export const PRESETS: PresetId[];
export const SCENARIOS: Record<ScenarioId, { tod: string; weather: string; label: string }>;
export const SPRINT1_SCENES: { name: string; url: string; preset: PresetId; minFps: number }[];
export const DEFAULT_GPU_PATTERN: string;
export function raceScenarioUrl(preset: PresetId, scenario: ScenarioId): string;
export function isValidGpu(gpu: string | undefined, pattern?: string): boolean;
export function summariseDeltas(deltas: number[]): { frames: number; fps: number; frameMsAvg: number; frameMsP95: number; frameMsMax: number; hitches: number };
export function runScenario(browser: Browser, options: RunScenarioOptions): Promise<PerfResult>;
export function writeResult(result: PerfResult): string;
export function loadResults(): (PerfResult & { file: string })[];
export function renderReport(results: PerfResult[]): string;
export function writeReport(): string;
