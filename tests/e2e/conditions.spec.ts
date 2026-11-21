// E-SM-03: a short autodrive race starts and runs without page errors in every time of day / weather combination and on the
// extreme quality presets. Shader compile errors (THREE.WebGLProgram), missing assets and uncaught exceptions only show up when a
// real session renders under each lighting rig, so this is the cheapest net for them. Error gate: tests/helpers/fixtures.ts.

import { CONDITIONS } from '../visual/points';
import { expect, test } from '../helpers/fixtures';

const RUN_MS = 4_000;

interface Case { id: string; quality: 'low' | 'high' | 'ultra'; tod: string; weather: string }

const cases: Case[] = [
  ...CONDITIONS.map((c) => ({ id: c.id, quality: 'high' as const, tod: c.tod, weather: c.weather })),
  { id: 'night-heavy', quality: 'ultra', tod: 'night', weather: 'heavy' },
  { id: 'day-dry', quality: 'low', tod: 'day', weather: 'dry' },
];

test.describe('E-SM-03 sessions under every lighting rig', () => {
  for (const c of cases) {
    test(`E-SM-03 ${c.id} on ${c.quality}`, async ({ apex }) => {
      test.setTimeout(150_000);
      await apex.open(
        { mode: 'race', autostart: 1, autodrive: 1, laps: 1, ai: 3, skipLights: 1, seed: 777, mute: 1, quality: c.quality, tod: c.tod, weather: c.weather },
        'sceneReady',
        120_000,
      );
      expect(await apex.state()).toBe('session');
      await apex.page.waitForTimeout(RUN_MS);
      const tel = await apex.telemetry();
      expect(tel?.kmh, `player moves (seed 777, ${c.id}, ${c.quality})`).toBeGreaterThan(0);
      expect(await apex.errors()).toEqual([]);
    });
  }
});
