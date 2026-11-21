import { chromium, type Locator, type Page } from '@playwright/test';
import type { NetLobbyModel } from '../../src/contracts/net';
import type { ScreenId, UiAction } from '../../src/contracts/ui';
import { expect, test as base } from '../helpers/fixtures';
import { BLOCK_VITE_HMR, RESET_STORAGE_ONCE } from '../helpers/pageInit.mjs';

// Chrome exposes browser zoom settings only in a persistent profile. Keep a separate disposable profile per test.
const test = base.extend({
  context: async ({ baseURL, viewport, cleanStorage, blockHmr }, use, testInfo) => {
    const context = await chromium.launchPersistentContext(testInfo.outputPath('chrome-profile'), {
      channel: 'chrome', headless: true, baseURL, viewport,
      args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'],
    });
    if (blockHmr) await context.addInitScript(BLOCK_VITE_HMR);
    if (cleanStorage) await context.addInitScript(RESET_STORAGE_ONCE);
    try { await use(context); } finally { await context.close(); }
  },
});

interface Probe {
  show(id: ScreenId): void;
  model(): NetLobbyModel;
  patch(model: Partial<NetLobbyModel>): void;
  actions(): UiAction[];
}
declare global { interface Window { __onlineUi: Probe } }

const screen = (page: Page, id: string) => page.locator(`[data-screen="${id}"][data-active="1"]`);
const ctl = (page: Page, id: string) => page.locator(`[data-active="1"] [data-focus-id="${id}"]:visible`);

/** No locator.click retries, hover preparation, focus(), or activation sleeps. */
async function center(page: Page, item: Locator): Promise<{ x: number; y: number }> {
  const box = await item.boundingBox();
  expect(box, 'click target has a box').not.toBeNull();
  const point = { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 };
  expect(await item.evaluate((el, p) => el.contains(document.elementFromPoint(p.x, p.y)), point), 'visual centre hits this control').toBe(true);
  return point;
}
async function click(page: Page, item: Locator): Promise<void> {
  const p = await center(page, item);
  await page.mouse.click(p.x, p.y);
}
async function open(page: Page, scene: string, extra = ''): Promise<void> {
  await page.goto(`/?scene=${scene}&freeze=1&anim=off${extra}`);
  await page.waitForFunction(() => (window as unknown as { __APEX__?: { sceneReady: boolean } }).__APEX__?.sceneReady);
}

/** Emulate the server acknowledgement for the sandbox's newly added custom-team action. */
async function acknowledgeTeam(page: Page): Promise<void> {
  await page.evaluate(() => {
    const probe = window.__onlineUi;
    const action = probe.actions().filter(a => a.type === 'onlineSetTeam').at(-1);
    if (!action || action.type !== 'onlineSetTeam') throw new Error('No custom-team request to acknowledge');
    const model = probe.model(), room = model.room!;
    const team = action.team;
    probe.patch({ room: { ...room, teams: team ? [{ ownerId: model.myId!, team }] : [],
      players: room.players.map(player => player.id === model.myId && team
        ? { ...player, teamId: team.baseTeamId, driverIdx: 0 } : player) } });
  });
}

test('a fresh click during entrance is accepted and an outgoing screen cannot intercept it', async ({ page }) => {
  await open(page, 'online');
  // The later-mounted online screen used to cover the menu while fading out; the guard also dropped this click.
  const p = await page.evaluate(() => {
    window.__onlineUi.show('mainMenu');
    const b = document.querySelector('[data-focus-id="main.settings"]')!.getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  });
  await page.mouse.click(p.x, p.y);
  await expect(screen(page, 'settings')).toBeVisible();
});

test('a server redraw between mouse down and up preserves one room-row activation', async ({ page }) => {
  await open(page, 'online');
  await ctl(page, 'online.name').fill('Deniz');
  const row = ctl(page, 'online.room.HRP42');
  const p = await center(page, row.locator('.m-room-detail'));
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.evaluate(() => window.__onlineUi.patch({ rttMs: 45 }));
  await page.mouse.up();
  await expect(screen(page, 'lobby')).toBeVisible();
  expect(await page.evaluate(() => window.__onlineUi.actions().filter(a => a.type === 'onlineJoin'))).toHaveLength(1);
});

for (const [width, height] of [[1366, 768], [1920, 1080], [2560, 1440]] as const) {
  for (const zoom of [0.9, 1, 1.25]) {
    test(`${width}x${height} at ${zoom * 100}%: menu, setup, settings, editor, online, lobby, pause and results`, async ({ page, context }) => {
      test.setTimeout(120_000);
      await page.setViewportSize({ width, height });
      const settings = await context.newPage();
      await settings.goto('chrome://settings/appearance');
      await settings.evaluate(z => {
        const chrome = (window as unknown as { chrome: { settingsPrivate: { setDefaultZoom(zoom: number): void } } }).chrome;
        chrome.settingsPrivate.setDefaultZoom(z);
      }, zoom);
      await settings.close();
      await open(page, 'online');
      await expect.poll(() => page.evaluate(() => devicePixelRatio)).toBeCloseTo(zoom, 5);
      await page.evaluate(() => window.__onlineUi.show('mainMenu'));
      await click(page, ctl(page, 'main.quickRace'));
      await expect(screen(page, 'raceConditions')).toBeVisible();
      const tod = ctl(page, 'race.tod').locator('.val');
      const oldTod = await tod.textContent();
      await click(page, ctl(page, 'race.tod'));
      await expect(tod).not.toHaveText(oldTod!);
      await click(page, ctl(page, 'raceConditions.cta'));
      await expect(screen(page, 'teamSelect')).toBeVisible();
      await click(page, ctl(page, 'team.aurora'));
      await expect(ctl(page, 'team.aurora')).toHaveClass(/is-sel/);
      await click(page, ctl(page, 'teamSelect.cta'));
      await expect(screen(page, 'raceSettings')).toBeVisible();
      for (const id of ['race.aiEnabled', 'race.safetyCar']) {
        const toggle = ctl(page, id);
        const old = await toggle.getAttribute('aria-checked');
        await click(page, toggle);
        await expect(toggle).toHaveAttribute('aria-checked', String(old !== 'true'));
        await click(page, toggle.locator('.c-seg > span').nth(old === 'true' ? 1 : 0));
        await expect(toggle).toHaveAttribute('aria-checked', old!);
      }
      await click(page, ctl(page, 'raceSettings.cta'));
      await expect(screen(page, 'assists')).toBeVisible();
      const abs = ctl(page, 'assists.abs');
      const oldAbs = await abs.getAttribute('aria-checked');
      await click(page, abs);
      await expect(abs).toHaveAttribute('aria-checked', String(oldAbs !== 'true'));
      await page.keyboard.press('Escape');
      await page.keyboard.press('Escape');
      await page.keyboard.press('Escape');
      await page.keyboard.press('Escape');
      await expect(screen(page, 'mainMenu')).toBeVisible();
      await click(page, ctl(page, 'main.timeTrial'));
      const weather = ctl(page, 'tt.weather').locator('.val');
      const oldWeather = await weather.textContent();
      await click(page, ctl(page, 'tt.weather'));
      await expect(weather).not.toHaveText(oldWeather!);
      await page.keyboard.press('Escape');
      await click(page, ctl(page, 'main.settings'));
      for (const [tab, row] of [['graphics', 'set.g.bloom'], ['audio', 'set.a.master'], ['controls', 'set.c.layout'], ['assists', 'set.as.abs'], ['hud', 'set.h.minimap'], ['language', 'set.l.lang'], ['interface', 'set.i.animations']]) {
        await click(page, ctl(page, `settings.tab.${tab}`));
        const item = ctl(page, row!);
        await expect(item).toBeVisible();
        const value = item.locator('.val');
        const before = await item.getAttribute('aria-checked') ?? (await value.count() ? await value.textContent() : null);
        await click(page, tab === 'audio' ? item.locator('.tr') : item);
        if (tab === 'audio') await expect(item).toHaveAttribute('aria-valuenow', '0.5');
        else if (await item.getAttribute('role') === 'switch') await expect(item).toHaveAttribute('aria-checked', String(before !== 'true'));
        else await expect(value).not.toHaveText(before!);
      }
      await page.keyboard.press('Escape');
      await page.keyboard.press('Escape');
      await click(page, ctl(page, 'main.online'));
      await ctl(page, 'online.name').fill('Deniz');
      await click(page, ctl(page, 'online.name'));
      await expect(ctl(page, 'online.name')).toBeFocused();
      await click(page, ctl(page, 'online.advanced'));
      await expect(ctl(page, 'online.server')).toBeVisible();
      await click(page, ctl(page, 'online.create'));
      await expect(screen(page, 'lobby')).toBeVisible();
      await click(page, ctl(page, 'lobby.aiEnabled'));
      await expect(ctl(page, 'lobby.aiEnabled')).toHaveAttribute('aria-checked', 'false');
      await click(page, ctl(page, 'lobby.aiEnabled').locator('.c-seg > span').nth(1));
      await expect(ctl(page, 'lobby.aiEnabled')).toHaveAttribute('aria-checked', 'true');
      // D-062: custom teams are edited in the online lobby, across every real browser zoom.
      await click(page, ctl(page, 'lobby.createTeam'));
      const editor = page.locator('[data-editor="team"]');
      await expect(editor).toBeVisible();
      await click(page, editor.locator('input'));
      await expect(editor.locator('input')).toBeFocused();
      await page.keyboard.type('Deniz GP');
      await expect(editor.locator('input')).toHaveValue('Deniz GP');
      for (const [key, color] of [['primary', 'ink'], ['secondary', 'mint'], ['accent', 'gold']]) {
        const chip = editor.locator(`[data-focus-id="custom.${key}"] [data-palette-id="${color}"]`);
        await click(page, chip);
        await expect(chip).toHaveClass('selected');
      }
      await click(page, ctl(page, 'custom.finish'));
      await expect(editor.locator('.m-livery-swatch')).toHaveAttribute('data-finish', 'matte');
      await page.keyboard.press('ArrowLeft');
      await expect(editor.locator('.m-livery-swatch')).toHaveAttribute('data-finish', 'gloss');
      await click(page, ctl(page, 'custom.save'));
      await expect(editor).toHaveCount(0);
      await acknowledgeTeam(page);
      await click(page, ctl(page, 'lobby.editTeam'));
      await click(page, editor.locator('[data-hint="back"]'));
      await expect(editor).toHaveCount(0);
      await expect(screen(page, 'lobby')).toBeVisible();
      await click(page, ctl(page, 'lobby.ready'));
      await expect(ctl(page, 'lobby.ready')).toHaveAttribute('aria-pressed', 'true');
      await page.keyboard.press('Enter');
      await expect(ctl(page, 'lobby.ready')).toHaveAttribute('aria-pressed', 'false');
      await click(page, ctl(page, 'lobby.leave'));
      await click(page, ctl(page, 'online.room.HRP42'));
      await expect(screen(page, 'lobby')).toBeVisible();
      expect((await page.evaluate(() => window.__onlineUi.model())).room?.code).toBe('HRP42');
      await click(page, ctl(page, 'lobby.leave'));
      // Use the real pause/results screens with the sandbox's mock stores, no race load or live server required.
      await page.evaluate(() => window.__onlineUi.show('pause'));
      await click(page, ctl(page, 'pause.settings'));
      await expect(screen(page, 'settings')).toBeVisible();
      await page.keyboard.press('Escape');
      await click(page, ctl(page, 'pause.resume'));
      await expect(page.locator('[data-screen="pause"]')).toHaveAttribute('data-active', '0');
      await page.evaluate(() => window.__onlineUi.show('results'));
      await click(page, ctl(page, 'results.menu'));
      await expect(ctl(page, 'results.confirm.no')).toBeFocused();
      await click(page, ctl(page, 'results.confirm.yes'));
      await expect(screen(page, 'mainMenu')).toBeVisible();
    });
  }
}
