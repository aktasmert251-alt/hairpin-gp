// P-01 FPS sampler (headed, GPU flags; project `perf`). The measurement code is scripts/perf.mjs; this spec runs it under Playwright
// so that `npx playwright test --project=perf` produces the same JSON files (test-results/perf/) and gates.
//
//   npx playwright test --project=perf --workers=1
//   APEX_PERF_FAST=1                      3 s warm-up, 8 s sample, one run (smoke)
//   APEX_PERF_PRESETS=high,ultra          race presets (default high)
//   APEX_PERF_SCENARIOS=A,C               race scenarios (default A)
//   APEX_PERF_ALLOW_INVALID=1             do not fail when the page is not on the discrete GPU (the run is still flagged valid:false)
//   APEX_PERF_RACE=0                      scene-level smoke only
//
// A run whose `__APEX__.gpu` does not contain the discrete GPU name is INVALID: its JSON says `valid: false` and the test fails
// (unless APEX_PERF_ALLOW_INVALID=1), because such numbers must never be used as evidence (rendering.md §11.2 step 3).

import { expect, test, type TestInfo } from '@playwright/test';
import {
  PRESETS, SCENARIOS, SPRINT1_SCENES, raceScenarioUrl, runScenario, writeReport, writeResult,
  type PerfResult, type PresetId, type ScenarioId,
} from '../../scripts/perf.mjs';

const FAST = process.env.APEX_PERF_FAST === '1';
const ALLOW_INVALID = process.env.APEX_PERF_ALLOW_INVALID === '1';
const BASE_URL = process.env.APEX_BASE_URL ?? 'http://localhost:5177';

const timing = FAST ? { runs: 1, warmupS: 3, sampleS: 8, cooldownS: 0 } : { runs: 2, warmupS: 10, sampleS: 30, cooldownS: 20 };

function listEnv<T extends string>(name: string, fallback: T[], allowed: readonly string[]): T[] {
  const v = process.env[name];
  if (!v) return fallback;
  const out = v.split(',').map((s) => s.trim()).filter(Boolean);
  for (const x of out) if (!allowed.includes(x)) throw new Error(`${name}: unknown value "${x}" (allowed: ${allowed.join(', ')})`);
  return out as T[];
}

function assertResult(result: PerfResult, info: TestInfo): void {
  info.annotations.push({ type: 'gpu', description: result.gpu ?? '(unknown)' });
  info.annotations.push({ type: 'fps', description: `${result.fps?.toFixed(1)} (runs ${result.runsFps?.join(', ')})` });
  if (!result.valid && !ALLOW_INVALID) {
    throw new Error(`INVALID perf run: the page used "${result.gpu}", not the discrete GPU. Assign Chrome to the high-performance GPU in Windows graphics settings and use AC power (rendering.md §11.2). The numbers were saved with valid:false.`);
  }
  if (!result.valid) return;
  const failed = (result.gates ?? []).filter((g) => !g.pass && g.severity !== 'P2');
  expect(failed, `perf gates failed for ${result.preset}/${result.scenario} (${result.url}):\n${failed.map((g) => `${g.metric} = ${g.value} (limit ${g.limit}, ${g.severity})`).join('\n')}`).toEqual([]);
}

test.describe.configure({ mode: 'serial' });

test.afterAll(() => {
  writeReport();
});

for (const scene of SPRINT1_SCENES) {
  test(`P-01 scene-level ${scene.name} (${scene.preset}) >= ${scene.minFps} fps`, async ({ browser }, testInfo) => {
    const result = await runScenario(browser, {
      kind: 'scene', preset: scene.preset, scenario: `scene:${scene.name}`, url: scene.url, baseUrl: BASE_URL, minFps: scene.minFps, ...timing,
    });
    if (result.skipped) {
      console.warn(`[perf] ${scene.name}: ${result.skipped}`);
      test.skip(true, `[needs sandbox scene] ${result.skipped}`);
      return;
    }
    writeResult(result);
    assertResult(result, testInfo);
  });
}

if (process.env.APEX_PERF_RACE !== '0') {
  const presets = listEnv<PresetId>('APEX_PERF_PRESETS', ['high'], PRESETS);
  const scenarios = listEnv<ScenarioId>('APEX_PERF_SCENARIOS', ['A'], Object.keys(SCENARIOS));
  for (const preset of presets) {
    for (const sc of scenarios) {
      test(`P-01 race scenario ${SCENARIOS[sc].label} on ${preset}`, async ({ browser }, testInfo) => {
        const result = await runScenario(browser, {
          kind: 'race', preset, scenario: sc, scenarioId: sc, url: raceScenarioUrl(preset, sc), baseUrl: BASE_URL, ...timing,
        });
        expect(result.skipped, 'race scenario must load').toBeUndefined();
        writeResult(result);
        assertResult(result, testInfo);
      });
    }
  }
}
