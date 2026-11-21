// Mobile (2026-11-21): phone emulation (Playwright hasTouch + isMobile, 844 × 390 landscape, 390 × 844 portrait).
// Taps through the menus, drives a race with synthetic multi-touch (CDP touch events → pointer events), opens the MFD and
// pause by their buttons, and saves the review screenshots to test-results/screens/mobile/. Desktop stays keyboard-only.

import type { CDPSession, Page } from '@playwright/test';
import { expect, test } from '../helpers/fixtures';
import { saveScreen } from '../helpers/screens';

const PHONE = { viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 } as const;

type ApexWin = Window & { __APEX__: { ready: boolean; sceneReady: boolean; ui: { screen(): string | null }; startSession(c: object): Promise<void>;
  getTelemetry(): { kmh: number; controls: { analog: boolean; steerAxis: number; throttleAxis: number } } | null; getHud(): { mfd: { open: boolean; page: string } } | null } };

async function boot(page: Page, query = 'governor=0'): Promise<void> {
  await page.goto(`/?${query}`);
  await page.waitForFunction(() => (window as unknown as ApexWin).__APEX__?.ready === true, null, { timeout: 90_000 });
  await page.evaluate(() => document.fonts.ready);
}
const screenId = (page: Page): Promise<string | null> => page.evaluate(() => (window as unknown as ApexWin).__APEX__.ui.screen());
async function tap(page: Page, selector: string): Promise<void> {
  const box = await page.locator(selector).first().boundingBox();
  expect(box, selector).not.toBeNull();
  await page.touchscreen.tap(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.waitForTimeout(450);
}
async function centre(page: Page, selector: string): Promise<{ x: number; y: number }> {
  const b = (await page.locator(selector).first().boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}
async function toMainMenu(page: Page): Promise<void> {
  await page.touchscreen.tap(420, 200);
  await expect.poll(() => screenId(page), { timeout: 15_000 }).toBe('mainMenu');
  await page.waitForTimeout(400);
}
async function startRace(page: Page): Promise<void> {
  await page.evaluate(() => (window as unknown as ApexWin).__APEX__.startSession({ mode: 'race', aiCount: 5, skipLights: true, laps: 3 }));
  await page.waitForFunction(() => (window as unknown as ApexWin).__APEX__.sceneReady === true, null, { timeout: 90_000 });
  await expect(page.locator('.apx-touch')).toHaveAttribute('data-on', '1');
}
const telemetry = (page: Page) => page.evaluate(() => (window as unknown as ApexWin).__APEX__.getTelemetry()!);
async function touches(cdp: CDPSession, type: 'touchStart' | 'touchMove' | 'touchEnd', pts: { x: number; y: number }[]): Promise<void> {
  await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i + 1 })) });
}

test.describe('mobile (phone emulation)', () => {
  test.use(PHONE);

  test('menus by tap: touch UI on, thumb-sized rows, settings > controls with the touch device and rows', async ({ page }) => {
    test.setTimeout(120_000);
    await boot(page);
    await expect(page.locator('.apx-ui')).toHaveAttribute('data-touch', '1');
    await expect(page.locator('.apx-ui')).toHaveAttribute('data-phone', '1');
    await toMainMenu(page);
    for (const id of ['main.quickRace', 'main.settings', 'main.online']) {
      const b = (await page.locator(`[data-focus-id="${id}"]`).boundingBox())!;
      expect(b.height, `${id} height`).toBeGreaterThanOrEqual(44);
    }
    await saveScreen(page, 'mobile', 'menu');
    await tap(page, '[data-focus-id="main.settings"]');
    await expect.poll(() => screenId(page)).toBe('settings');
    await tap(page, '[data-focus-id="settings.tab.controls"]');
    await expect(page.locator('[data-focus-id="set.c.device"]')).toContainText(/dokunmatik/i);
    await expect(page.locator('[data-focus-id="set.c.touch.steerMode"]')).toBeVisible();
    const row = (await page.locator('[data-focus-id="set.c.touch.steerMode"]').boundingBox())!;
    expect(row.height).toBeGreaterThanOrEqual(43);
    await saveScreen(page, 'mobile', 'settings-controls');
    // The virtual back button returns to the main menu.
    await tap(page, '.apx-back');
    await expect.poll(() => screenId(page)).toBe('mainMenu');
  });

  test('race: drive with multi-touch (speed rises, steering follows), MFD + pause by buttons, back resumes', async ({ page, context }) => {
    test.setTimeout(180_000);
    await boot(page);
    await startRace(page);
    const cdp = await context.newCDPSession(page);
    const gas = await centre(page, '.t-gas');
    const right = await centre(page, '.t-pad.t-r');
    const left = await centre(page, '.t-pad.t-l');
    const v0 = (await telemetry(page)).kmh;
    await touches(cdp, 'touchStart', [gas]);
    await expect.poll(async () => (await telemetry(page)).kmh, { timeout: 20_000 }).toBeGreaterThan(v0 + 30);
    const t1 = await telemetry(page);
    expect(t1.controls.analog).toBe(true);
    expect(t1.controls.throttleAxis).toBe(1);
    // Second finger on the right pad while the gas stays down.
    await touches(cdp, 'touchStart', [gas, right]);
    await expect.poll(async () => (await telemetry(page)).controls.steerAxis, { timeout: 5_000 }).toBeLessThan(-0.5);
    expect((await telemetry(page)).controls.throttleAxis).toBe(1);
    await saveScreen(page, 'mobile', 'race');
    await touches(cdp, 'touchMove', [gas, left]);
    await touches(cdp, 'touchEnd', []);
    await touches(cdp, 'touchStart', [left]);
    await expect.poll(async () => (await telemetry(page)).controls.steerAxis, { timeout: 5_000 }).toBeGreaterThan(0.5);
    await touches(cdp, 'touchEnd', []);
    await expect.poll(async () => { const c = (await telemetry(page)).controls; return Math.abs(c.steerAxis) + c.throttleAxis; }, { timeout: 5_000 }).toBe(0);
    // MFD by its button, then a tapped row (strategy page, row 3: gap mode) acts like its number key.
    await tap(page, '.t-mfd');
    await expect.poll(async () => (await page.evaluate(() => (window as unknown as ApexWin).__APEX__.getHud()))?.mfd.open).toBe(true);
    await page.waitForTimeout(300);
    await saveScreen(page, 'mobile', 'race-mfd');
    await tap(page, '.h-mfd .mfd-row >> nth=2');
    await expect(page.locator('.h-mfd .mfd-row').nth(2)).toContainText(/lidere|leader/i);
    // Pause by its button; the overlay hides; the back button resumes.
    await tap(page, '.t-pause');
    await expect.poll(() => screenId(page)).toBe('pause');
    await expect(page.locator('.apx-touch')).toHaveAttribute('data-on', '0');
    await page.waitForTimeout(300);
    await saveScreen(page, 'mobile', 'pause');
    await tap(page, '.apx-back');
    await expect.poll(() => screenId(page)).toBeNull();
    await expect(page.locator('.apx-touch')).toHaveAttribute('data-on', '1');
  });

  test('online: join-by-invite with a paste button, phone-host warning', async ({ page }) => {
    test.setTimeout(120_000);
    await boot(page, 'governor=0&p2p=join');
    await toMainMenu(page);
    await tap(page, '[data-focus-id="main.online"]');
    await expect.poll(() => screenId(page), { timeout: 15_000 }).toBe('online');
    await expect(page.locator('[data-focus-id="online.pasteInvite"]')).toBeVisible();
    // The phone layout scrolls the screen: bring the invite field and its paste button into view for the review shot.
    await page.locator('[data-focus-id="online.pasteInvite"]').scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await saveScreen(page, 'mobile', 'online-invite');
    await boot(page, 'governor=0&p2p=host');
    await toMainMenu(page);
    await tap(page, '[data-focus-id="main.online"]');
    await expect.poll(() => screenId(page), { timeout: 15_000 }).toBe('online');
    await expect(page.locator('.m-phone-host')).toContainText(/telefon/i);
    await page.locator('.m-phone-host').scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await saveScreen(page, 'mobile', 'online-host');
  });

  test('left-handed layout swaps pedals and steering', async ({ page }) => {
    test.setTimeout(120_000);
    await boot(page);
    await toMainMenu(page);
    await tap(page, '[data-focus-id="main.settings"]');
    await tap(page, '[data-focus-id="settings.tab.controls"]');
    const lh = page.locator('[data-focus-id="set.c.touch.leftHanded"]');
    await tap(page, '[data-focus-id="set.c.touch.leftHanded"] .c-seg span >> nth=1');
    await expect(lh).toHaveAttribute('aria-checked', 'true');
    await startRace(page);
    const gas = (await page.locator('.t-gas').boundingBox())!;
    const steer = (await page.locator('.t-steer').boundingBox())!;
    expect(gas.x).toBeLessThan(422);
    expect(steer.x).toBeGreaterThan(422);
  });
});

test.describe('mobile: portrait', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  test('portrait shows the rotate overlay', async ({ page }) => {
    await boot(page);
    await expect(page.locator('.apx-rotate')).toHaveAttribute('data-on', '1');
    await expect(page.locator('.apx-rotate')).toContainText(/yan çevir/i);
    await saveScreen(page, 'mobile', 'rotate');
  });
});

test.describe('desktop stays keyboard-only', () => {
  test('no touch UI, keyboard device, no overlay in a race', async ({ page }) => {
    test.setTimeout(120_000);
    await boot(page);
    await expect(page.locator('.apx-ui')).toHaveAttribute('data-touch', '0');
    await expect(page.locator('.apx-back')).toBeHidden();
    await page.evaluate(() => (window as unknown as ApexWin).__APEX__.startSession({ mode: 'race', aiCount: 1, skipLights: true }));
    await page.waitForFunction(() => (window as unknown as ApexWin).__APEX__.sceneReady === true, null, { timeout: 90_000 });
    await expect(page.locator('.apx-touch')).toHaveAttribute('data-on', '0');
    await expect(page.locator('.apx-hud')).not.toHaveAttribute('data-touch', '1');
  });
});
