import { expect, test, type Page } from '@playwright/test';

test.describe.configure({ mode: 'parallel' });

const sizes = [[1366, 768], [1440, 900], [1920, 1080], [1920, 1200], [2560, 1440], [3840, 2160]] as const;

async function load(page: Page, query: string): Promise<void> {
  await page.goto(`/?scene=${query}&anim=off&freeze=1`);
  await page.waitForFunction(() => (window as unknown as { __APEX__?: { sceneReady: boolean } }).__APEX__?.sceneReady);
  await page.evaluate(() => document.fonts.ready);
  // Screen entry fades and its pointer-input guard both last 120 ms, even with reduced motion.
  await page.waitForTimeout(140);
}

async function fits(page: Page): Promise<void> {
  const issues = await page.evaluate(() => {
    const errors: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>('.apx-ui *')) {
      if (!el.checkVisibility() || el.closest('[aria-hidden="true"], .notch, svg')) continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      // Scrollable lists deliberately contain off-screen rows; their viewport is checked instead.
      let scrolled = false;
      for (let p = el.parentElement; p && !p.classList.contains('apx-ui'); p = p.parentElement) {
        const s = getComputedStyle(p);
        if (/(auto|scroll)/.test(s.overflowY) && p.scrollHeight > p.clientHeight) { scrolled = true; break; }
      }
      if (scrolled) continue;
      const id = el.dataset.focusId ?? `${el.parentElement?.className} > ${el.tagName}.${el.className}`;
      if (r.left < -1 || r.top < -1 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1) errors.push(`${id}: outside viewport`);
      const directText = [...el.childNodes].some(n => n.nodeType === Node.TEXT_NODE && n.textContent?.trim());
      const style = getComputedStyle(el);
      if (directText && el.clientWidth && el.scrollWidth > el.clientWidth + 1 && style.display !== 'inline') {
        // Focus notches and underlines may extend beyond the box; measure the text itself too.
        const range = document.createRange(); range.selectNodeContents(el);
        const text = range.getBoundingClientRect();
        if (text.left < r.left - 1 || text.right > r.right + 1) errors.push(`${id}: clipped text ${el.scrollWidth}/${el.clientWidth}`);
      }
      if (directText && /hidden|clip/.test(style.overflowY) && el.clientHeight && el.scrollHeight > el.clientHeight + 2) errors.push(`${id}: clipped height ${el.scrollHeight}/${el.clientHeight}`);
    }
    return errors;
  });
  expect(issues).toEqual([]);
}

for (const [width, height] of sizes) {
  test(`D-060 ${width}x${height} HiDPI menus, HUD, lobby and forms fit`, async ({ browser }) => {
    test.setTimeout(120_000);
    const context = await browser.newContext({ deviceScaleFactor: 2 });
    const page = await context.newPage();
    try {
      // Desktop zoom changes the available CSS viewport. Probe both endpoints at the size bounds.
      const zooms = width === 1366 || width === 3840 ? [1, 0.9, 1.25] : [1];
      for (const zoom of zooms) {
        await page.setViewportSize({ width: Math.round(width / zoom), height: Math.round(height / zoom) });
        await load(page, 'menu&screen=mainMenu');
        for (const screen of ['mainMenu', 'ttSetup', 'raceConditions', 'raceSettings', 'assists', 'teamSelect', 'settings', 'results'] as const) {
          await page.evaluate(s => (window as unknown as { __uiMotion: { show(s: string): void } }).__uiMotion.show(s), screen);
          await fits(page);
        }
        // D-062: the editor is offered only in an online lobby.
        await load(page, 'lobby&players=4');
        await page.locator('[data-active="1"] [data-focus-id="lobby.createTeam"]').click();
        await fits(page);
        const traits = (await page.locator('[data-editor] .m-team-traits').boundingBox())!;
        const preview = (await page.locator('[data-editor] .m-team-preview').boundingBox())!;
        expect(traits.y + traits.height).toBeLessThan(preview.y);
        await load(page, 'hud&sc=deployed&scale=1.25');
        await fits(page);
        if (zoom === 1 || width === 1366) {
          await load(page, 'hud&sc=deployed&scale=0.8');
          await fits(page);
        }
        await load(page, 'lobby&players=4');
        await expect(page.getByText('Online: eşit araçlar', { exact: true })).toBeVisible();
        await fits(page);
        if (zoom === 1) {
          await load(page, 'online');
          await fits(page);
          await load(page, 'lobby&players=20');
          await page.locator('[data-focus-id="lobby.player.19"]').click();
          await expect(page.locator('[data-focus-id="lobby.player.19"]')).toBeInViewport();
          await fits(page);
          const car = (await page.locator('.m-lobby-car').boundingBox())!;
          const actions = (await page.locator('.m-lobby-actions').boundingBox())!;
          expect(car.y + car.height).toBeLessThan(actions.y);
        }
      }
    } finally { await context.close(); }
  });
}

test('D-056 safety car toggle defaults On and persists Off across reload', async ({ page }) => {
  await load(page, 'menu&screen=raceSettings');
  const toggle = page.locator('[data-active="1"] [data-focus-id="race.safetyCar"]');
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('apexgp:v1:lastRaceSetup')!).safetyCar)).toBe(false);
  await page.reload();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
});

test('D-056 board follows deployed, in-this-lap and green without covering lights or toasts', async ({ page }) => {
  await load(page, 'hud&sc=deployed&lights=1');
  const board = page.locator('.h-sc');
  await expect(board).toHaveAttribute('data-state', 'deployed');
  const lights = await page.locator('.h-lights').boundingBox();
  const sc = (await board.boundingBox())!;
  expect(lights).not.toBeNull();
  expect(sc.y).toBeGreaterThanOrEqual(lights!.y + lights!.height);
  for (const toast of await page.locator('.h-ban').all()) {
    const r = await toast.boundingBox();
    if (r) expect(r.y).toBeGreaterThanOrEqual(sc.y + sc.height);
  }
  const set = (state: 'none' | 'ending') => page.evaluate(s => (window as unknown as { __hudSafetyCar(s: string): void }).__hudSafetyCar(s), state);
  await set('ending');
  await expect(board).toContainText('bu tur pite giriyor');
  await set('none');
  await expect(board).toHaveAttribute('data-state', 'green');
  await expect(board).toContainText('Yeşil bayrak');
});
