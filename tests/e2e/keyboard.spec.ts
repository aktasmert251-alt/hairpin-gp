// Keyboard-only menu flow (sprint-2 §9 T1): title -> quick race 4 steps -> loading -> race -> pause -> retire -> results.
// Only page.keyboard is used to drive the UI; __APEX__ is read for state/screen id only.

import { expect, test } from '../helpers/fixtures';
import { saveScreen } from '../helpers/screens';

test.describe('keyboard flow', () => {
  test('E-RC-04 title -> quick race (4 steps) -> race -> pause -> retire -> results, keyboard only', async ({ apex, page }) => {
    test.setTimeout(240_000);
    const key = async (k: string): Promise<void> => { await page.keyboard.press(k); await page.waitForTimeout(250); };
    const screen = (): Promise<string | null> => apex.uiScreen();

    await apex.open('/', 'sceneReady');
    expect(await apex.state()).toBe('title');
    await page.waitForTimeout(400);
    await key('Space');
    await apex.waitForState('menu', 15_000);
    await expect.poll(screen, { timeout: 10_000 }).toBe('mainMenu');

    // Main menu: focus quick race (skip disabled entries by pressing Down until it is focused).
    for (let i = 0; i < 6 && (await apex.focusId()) !== 'main.quickRace'; i++) await key('ArrowDown');
    expect(await apex.focusId()).toBe('main.quickRace');
    await key('Enter');

    const steps = ['raceConditions', 'teamSelect', 'raceSettings', 'assists'];
    for (let i = 0; i < steps.length; i++) {
      await expect.poll(screen, { timeout: 10_000, message: `setup step ${i + 1}` }).toBe(steps[i]);
      await saveScreen(page, 'testci', `kb-step${i + 1}`);
      // CTA is the last focusable entry: Down until focus stops changing, then Enter.
      let prev = '';
      for (let n = 0; n < 20; n++) {
        const f = await apex.focusId();
        if (f === prev) break;
        prev = f ?? '';
        await key('ArrowDown');
      }
      await key('Enter');
    }

    await apex.waitForState('session', 90_000);
    await apex.waitForPhase('running', 60_000);
    await page.waitForTimeout(3000);
    await key('Escape');
    await expect.poll(screen, { timeout: 5000 }).toBe('pause');
    await saveScreen(page, 'testci', 'kb-pause');
    await expect.poll(() => apex.focusId(), { timeout: 3000 }).toBe('pause.resume');
    for (let i = 0; i < 6 && (await apex.focusId()) !== 'pause.retire'; i++) await key('ArrowDown');
    expect(await apex.focusId()).toBe('pause.retire');
    await key('Enter');
    await expect.poll(() => apex.focusId(), { timeout: 3000 }).toBe('pause.confirm.no'); // confirm dialog, safe default
    await key('ArrowLeft'); await key('ArrowUp');
    if ((await apex.focusId()) !== 'pause.confirm.yes') await key('ArrowDown');
    expect(await apex.focusId()).toBe('pause.confirm.yes');
    await key('Enter');
    await expect.poll(screen, { timeout: 30_000 }).toBe('results');
    await expect.poll(() => page.locator('#ui tbody tr').count(), { timeout: 10_000 }).toBe(20);
    await page.waitForTimeout(1200);
    await saveScreen(page, 'testci', 'kb-results');
  });
});
