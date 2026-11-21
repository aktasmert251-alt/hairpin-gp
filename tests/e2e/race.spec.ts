// T1 race E2E (sprint-2 §9). E-RC-01: autostart + autodrive 1-lap race -> lights -> finish -> 20-row results, 0 errors (fixture gate).

import { expect, test } from '../helpers/fixtures';
import { saveScreen } from '../helpers/screens';

test.describe('race', () => {
  test('E-RC-01 full race: lights -> finish -> 20-row results screen', async ({ apex, page }) => {
    test.setTimeout(240_000);
    await apex.open({ mode: 'race', autostart: 1, autodrive: 1, laps: 1 }, 'sceneReady', 90_000);
    expect(await apex.state()).toBe('session');
    const race0 = await apex.race();
    expect(race0?.cars.length, '20-car grid').toBe(20);
    // lights phase -> running
    await apex.waitForPhase('running', 40_000);
    await expect.poll(async () => (await apex.getHud())?.notifications !== undefined, { timeout: 10_000 }).toBe(true);
    await apex.waitForLap(1, 200_000);
    await expect.poll(() => apex.uiScreen(), { timeout: 60_000 }).toBe('results');
    await expect.poll(() => page.locator('#ui tbody tr').count(), { timeout: 10_000 }).toBe(20);
    await page.waitForTimeout(1200); // let the screen animation settle
    await saveScreen(page, 'testci', 'e2e-results');
    expect(await apex.errors()).toEqual([]);
  });
});
