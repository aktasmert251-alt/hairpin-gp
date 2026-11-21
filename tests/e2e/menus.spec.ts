// Menu E2E (sprint-2 §9 T5): E-MN-01 every screen by keyboard, E-MN-02 settings persist, E-MN-03 rebinding.
// Only page.keyboard drives the UI; __APEX__ is read for screen / focus ids. Error gate: fixtures.

import { expect, test } from '../helpers/fixtures';
import { saveScreen } from '../helpers/screens';
import { focusOn, key, storedSettings, toMainMenu, waitScreen } from '../helpers/menu';

test.describe('menus', () => {
  test('E-MN-01 title -> main menu -> every screen by keyboard -> back to main menu', async ({ apex, page }) => {
    test.setTimeout(120_000);
    await apex.open('/', 'sceneReady');
    expect(await apex.uiScreen()).toBe('title');
    await page.waitForTimeout(400);
    await key(page, 'Space');
    await waitScreen(apex, 'mainMenu');
    expect(await apex.focusId(), 'main menu has a focused entry').not.toBeNull();

    const seen: string[] = ['title', 'mainMenu'];
    const visit = async (entry: string, expected: string[], back = 'Escape'): Promise<void> => {
      await focusOn(apex, page, entry);
      await key(page, 'Enter');
      await waitScreen(apex, expected[0]!);
      expect(await apex.focusId(), `${expected[0]} focus`).not.toBeNull();
      seen.push(expected[0]!);
      // Quick race / TT setup: walk the whole chain forward only for race setup (CTA = last entry), then back out step by step.
      for (let i = 1; i < expected.length; i++) {
        let prev = '';
        for (let n = 0; n < 20; n++) {
          const f = await apex.focusId();
          if (f === prev) break;
          prev = f ?? '';
          await key(page, 'ArrowDown', 120);
        }
        await key(page, 'Enter');
        await waitScreen(apex, expected[i]!);
        expect(await apex.focusId(), `${expected[i]} focus`).not.toBeNull();
        seen.push(expected[i]!);
      }
      for (let i = expected.length - 1; i >= 0; i--) {
        await key(page, back, 300);
        await waitScreen(apex, i === 0 ? 'mainMenu' : expected[i - 1]!);
      }
      expect(await apex.focusId(), 'main menu focus restored').not.toBeNull();
    };

    await visit('main.timeTrial', ['ttSetup']);
    await visit('main.quickRace', ['raceConditions', 'teamSelect', 'raceSettings', 'assists']);
    await visit('main.settings', ['settings']);
    await visit('main.credits', ['credits']);
    expect(seen).toEqual(['title', 'mainMenu', 'ttSetup', 'raceConditions', 'teamSelect', 'raceSettings', 'assists', 'settings', 'credits']);
    await saveScreen(page, 'testci', 'e2e-menu-main');
  });

  test('E-MN-02 settings persist: language, HUD mode and a binding survive a reload', async ({ apex, page }) => {
    test.setTimeout(120_000);
    await toMainMenu(apex, page);
    await focusOn(apex, page, 'main.settings');
    await key(page, 'Enter');
    await waitScreen(apex, 'settings');

    // HUD tab: mode full -> minimal
    await focusOn(apex, page, 'settings.tab.hud');
    await key(page, 'Enter');
    await focusOn(apex, page, 'set.h.mode');
    await key(page, 'ArrowRight');
    // Controls tab: throttle -> KeyI
    await key(page, 'Escape');
    await focusOn(apex, page, 'settings.tab.controls');
    await key(page, 'Enter');
    await focusOn(apex, page, 'set.c.bind.throttle');
    await key(page, 'Enter');
    await key(page, 'KeyI');
    // Language tab: tr -> en
    await key(page, 'Escape');
    await focusOn(apex, page, 'settings.tab.language');
    await key(page, 'Enter');
    await focusOn(apex, page, 'set.l.lang');
    await key(page, 'ArrowRight');
    await page.waitForTimeout(300);

    const before = await storedSettings(page);
    expect(before.hud.mode).toBe('minimal');
    expect(before.lang).toBe('en');
    expect(before.controls.bindings.throttle[0]).toBe('KeyI');

    await page.reload({ waitUntil: 'load' });
    await apex.whenReady('sceneReady', 60_000);
    const after = await storedSettings(page);
    expect(after.hud.mode).toBe('minimal');
    expect(after.lang).toBe('en');
    expect(after.controls.bindings.throttle[0]).toBe('KeyI');
    expect(await page.evaluate(() => document.documentElement.lang)).toBe('en');

    // The reloaded UI shows the stored values.
    await key(page, 'Space');
    await waitScreen(apex, 'mainMenu');
    await focusOn(apex, page, 'main.settings');
    await key(page, 'Enter');
    await waitScreen(apex, 'settings');
    await focusOn(apex, page, 'settings.tab.controls');
    await key(page, 'Enter');
    await focusOn(apex, page, 'set.c.bind.throttle');
    await expect(page.locator('[data-focus-id="set.c.bind.throttle"] .apx-kc').first()).toHaveText(/^I$/i);
    await saveScreen(page, 'testci', 'e2e-settings-reload');
  });

  test('E-MN-03 rebinding: throttle -> KeyI, Ctrl+K rejected (modifier), reset restores defaults', async ({ apex, page }) => {
    test.setTimeout(120_000);
    await toMainMenu(apex, page);
    await focusOn(apex, page, 'main.settings');
    await key(page, 'Enter');
    await focusOn(apex, page, 'settings.tab.controls');
    await key(page, 'Enter');
    await focusOn(apex, page, 'set.c.bind.throttle');
    const chip = page.locator('[data-focus-id="set.c.bind.throttle"] .apx-kc').first();

    await key(page, 'Enter');
    await key(page, 'KeyI');
    await expect(chip).toHaveText(/^I$/i);
    expect((await storedSettings(page)).controls.bindings.throttle[0]).toBe('KeyI');

    // Ctrl+K while listening is rejected: the binding stays on KeyI and nothing is bound to Ctrl+K.
    await key(page, 'Enter');
    await page.keyboard.press('Control+KeyK');
    await page.waitForTimeout(400);
    const afterCtrl = (await storedSettings(page)).controls.bindings as Record<string, string[]>;
    expect(afterCtrl.throttle[0]).toBe('KeyI');
    for (const [a, codes] of Object.entries(afterCtrl)) expect(codes.some((c) => c.includes('Control') || c.includes('Meta') || c.includes('Alt')), `${a} has a modifier binding`).toBe(false);
    expect(afterCtrl.throttle).not.toContain('KeyK');

    await saveScreen(page, 'testci', 'e2e-rebind');
    // Reset: first Enter arms, second confirms.
    await focusOn(apex, page, 'set.c.reset');
    await key(page, 'Enter');
    await key(page, 'Enter');
    const reset = (await storedSettings(page)).controls.bindings as Record<string, string[]>;
    expect(reset.throttle[0], 'throttle back to its default').not.toBe('KeyI');
    expect(reset.throttle).toEqual(expect.arrayContaining(['KeyW']));
  });
});
