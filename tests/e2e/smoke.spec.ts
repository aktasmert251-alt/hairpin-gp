// T6 E2E smoke. Every test here also runs the error gate of tests/helpers/fixtures.ts (no console.error, empty __APEX__.errors).
//
//   E-SM-01  (a) ?scene=skeleton -> sceneReady, screenshot
//   E-BT-01  (b) boot -> title -> any key -> main menu visible
//   E-BT-02  (c) autostart race with autodrive: the sim advances and the car moves

import { expect, test } from '../helpers/fixtures';
import { saveScreen } from '../helpers/screens';

test.describe('smoke', () => {
  test('E-SM-01 ?scene=skeleton reaches sceneReady without errors', async ({ apex, page }) => {
    await apex.open({ scene: 'skeleton', freeze: 1 }, 'sceneReady', 60_000);
    expect(await apex.state()).toBe('sandbox');
    expect(await apex.errors()).toEqual([]);
    const gpu = await apex.gpu();
    expect(gpu, 'WebGL2 renderer string probed at boot').not.toBe('');
    expect(gpu).not.toBe('unavailable');
    await saveScreen(page, 'testci', 'skeleton');
  });

  test('E-BT-01 boot -> title -> any key -> main menu', async ({ apex, page }) => {
    await apex.open('/', 'sceneReady');
    expect(await apex.state()).toBe('title');
    await saveScreen(page, 'testci', 'title');
    // The title ignores input for ~120 ms after it appears (anti-mash guard).
    await page.waitForTimeout(250);
    await page.keyboard.press('Space');
    await apex.waitForState('menu', 15_000);
    await apex.whenReady('sceneReady', 15_000);
    // `sceneReady` flips back to true two frames after the menu is shown.
    await expect.poll(() => apex.isSceneReady(), { timeout: 10_000 }).toBe(true);
    await expect(page.locator('#ui button, #ui [role="menuitem"], #ui [role="button"]').first(), 'main menu has interactive entries').toBeVisible();
    await saveScreen(page, 'testci', 'menu');
  });

  test('E-BT-02 autostart + autodrive race: hash changes and the car moves within 10 s', async ({ apex }) => {
    test.setTimeout(120_000);
    await apex.open({ mode: 'race', autostart: 1, autodrive: 1, laps: 1, ai: 0, skipLights: 1 }, 'sceneReady', 90_000);
    expect(await apex.state()).toBe('session');
    const h0 = await apex.hashState();
    expect(h0, 'hashState() is available once a session runs').not.toBeNull();
    await apex.page.waitForTimeout(10_000);
    const h1 = await apex.hashState();
    expect(h1).not.toBeNull();
    expect(h1, 'sim state hash must change while the session runs').not.toBe(h0);
    const tel = await apex.telemetry();
    expect(tel, 'telemetry for the player car').not.toBeNull();
    expect(tel!.kmh).toBeGreaterThan(0);
    const race = await apex.race();
    expect(race?.phase).toBe('running');
  });
});
