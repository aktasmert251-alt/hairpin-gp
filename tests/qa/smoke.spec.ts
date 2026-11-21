import { test, expect } from '../helpers/fixtures';
import type { Page } from '@playwright/test';
import { Ui, seedSettings } from '../helpers/uiDriver';
import { RACE_TRACKS } from '../../src/data/tracks';

const ctl = (page: Page, id: string) => page.locator(`[data-active="1"] [data-focus-id="${id}"]`);
const shot = (page: Page, name: string) => page.screenshot({ path: `test-results/screens/qa-sweep-2026-10-19/${name}.png` });
// The menu deliberately guards input during its entrance. Await the actual animation state.
async function settled(page: Page): Promise<void> {
  await page.waitForFunction(() => [...document.querySelectorAll<HTMLElement>('[data-active="1"] .m-stage')]
    .every(el => getComputedStyle(el).opacity === '1'));
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

for (const track of RACE_TRACKS) {
  test(`release smoke: title, menu, ${track} one-lap race with AI, results, menu`, async ({ page, apex }) => {
    await seedSettings(page, { ui: { animations: 'off' }, graphics: { preset: 'low' } });
    await page.addInitScript(id => localStorage.setItem('apexgp:v1:lastRaceSetup', JSON.stringify({ trackId: id, laps: 1, aiCount: 19, difficulty: 55, safetyCar: true })), track);
    const ui = new Ui(apex, page);
    await apex.open({ track, autodrive: 1, timescale: 2, nopost: 1, mute: 1 }, 'sceneReady');
    await expect(ctl(page, 'title.prompt')).toBeVisible();
    await settled(page);
    if (track === 'istanbul') await shot(page, 'title');
    await ui.key('Space');
    await ui.waitScreen('mainMenu');
    if (track === 'istanbul') await shot(page, 'main-menu');
    await ui.goTo('raceConditions');
    await ui.focusViaKeys('race.track');
    for (let i = 0; i < RACE_TRACKS.length; i++) await ui.key('ArrowLeft', 0);
    for (let i = 0; i < RACE_TRACKS.indexOf(track); i++) await ui.key('ArrowRight', 0);
    await expect(page.locator('[data-screen="raceConditions"] .m-track-detail:not([aria-hidden])')).toHaveAttribute('data-track-id', track);
    await ctl(page, 'raceConditions.cta').click(); await ui.waitScreen('teamSelect');
    await ctl(page, 'teamSelect.cta').click(); await ui.waitScreen('raceSettings');
    await expect(ctl(page, 'race.aiEnabled')).toHaveAttribute('aria-checked', 'true');
    await expect(ctl(page, 'race.opponents')).toHaveAttribute('aria-valuenow', '19');
    const safety = ctl(page, 'race.safetyCar');
    await safety.click(); await expect(safety).toHaveAttribute('aria-checked', 'false');
    if (track === 'istanbul') await shot(page, 'safety-off');
    await safety.click(); await expect(safety).toHaveAttribute('aria-checked', 'true');
    if (track === 'istanbul') await shot(page, 'safety-on');
    await ctl(page, 'raceSettings.cta').click();
    await ui.waitScreen('assists'); await settled(page);
    await ctl(page, 'assists.cta').click();
    await apex.waitForState('session', 90_000); await apex.waitForPhase('running', 60_000);
    expect((await apex.race())?.cars).toHaveLength(20);
    expect((await apex.race())?.laps).toBe(1);
    expect(await page.evaluate(() => window.__APEX__.track()?.id)).toBe(track);
    await shot(page, `${track}-race`);
    await page.keyboard.press('KeyM');
    await expect(page.getByRole('alertdialog')).toBeVisible();
    await expect(page.getByRole('alertdialog')).toHaveCSS('opacity', '1');
    if (track === 'istanbul') await shot(page, 'race-m-confirm');
    await ctl(page, 'pause.confirm.no').click();
    await page.keyboard.press('Escape'); await ui.waitScreen(null);
    await ui.waitScreen('results', 240_000);
    await expect(page.locator('[data-active="1"] tbody tr')).toHaveCount(20);
    await shot(page, `${track}-results`);
    await settled(page); await ctl(page, 'results.menu').click();
    await expect(page.getByRole('alertdialog')).toBeVisible();
    await ctl(page, 'results.confirm.yes').click();
    await ui.waitScreen('mainMenu');
    expect(await apex.errors()).toEqual([]);
  });
}

test('release smoke: Ardennes time trial, M confirmation, settings', async ({ page, apex }) => {
  await seedSettings(page, { ui: { animations: 'off' }, graphics: { preset: 'low' } });
  const ui = new Ui(apex, page);
  await ui.toMainMenu({ track: 'ardennes', autodrive: 1, nopost: 1, mute: 1 });
  await ui.goTo('ttSetup');
  await ctl(page, 'tt.go').click();
  await apex.waitForState('session', 90_000); await apex.waitForPhase('running', 60_000);
  expect(await page.evaluate(() => window.__APEX__.track()?.id)).toBe('ardennes');
  await shot(page, 'ardennes-tt');
  await page.keyboard.press('KeyM');
  await expect(page.getByRole('alertdialog')).toBeVisible();
  await expect(page.getByRole('alertdialog')).toHaveCSS('opacity', '1');
  await shot(page, 'm-confirm');
  await ctl(page, 'pause.confirm.yes').click();
  // QA-19-03: the application currently takes this main-menu request through TT results.
  await ui.waitScreen('ttResults');
  await ctl(page, 'ttResults.menu').click();
  await ui.waitScreen('mainMenu');
  await ui.goTo('settings');
  await ui.focusViaKeys('settings.tab.graphics'); await page.keyboard.press('ArrowRight');
  await ui.focusViaKeys('set.g.preset'); await page.keyboard.press('ArrowRight');
  expect((await ui.stepIndex('set.g.preset')).index).toBe(1);
  await ui.focusViaKeys('set.g.renderScale');
  const before = await ctl(page, 'set.g.renderScale').getAttribute('aria-valuenow');
  await page.keyboard.press('ArrowLeft');
  await expect(ctl(page, 'set.g.renderScale')).not.toHaveAttribute('aria-valuenow', before!);
  await shot(page, 'settings');
  await ui.key('Escape'); await ui.key('Escape'); await ui.waitScreen('mainMenu');
});

test('release smoke: mock room list, quick join, Normal/Kasap and custom team row', async ({ page, apex }) => {
  await apex.open('/?scene=online&freeze=1&anim=off', 'sceneReady');
  await ctl(page, 'online.name').fill('Deniz');
  await expect(ctl(page, 'online.room.HRP42')).toBeVisible(); await shot(page, 'online-list');
  await settled(page); await ctl(page, 'online.quickJoin').click();
  await expect(ctl(page, 'lobby.mode')).toContainText('Normal');
  await expect(ctl(page, 'lobby.customTeam')).toBeVisible(); await shot(page, 'lobby-normal');
  // Quick join is a guest. Re-open the mock as the room owner to exercise settings.
  await apex.open('/?scene=lobby&freeze=1&anim=off', 'sceneReady'); await settled(page);
  await ctl(page, 'lobby.mode').click(); await expect(ctl(page, 'lobby.mode')).toContainText('Kasap');
  await shot(page, 'lobby-kasap');
  await ctl(page, 'lobby.mode').click(); await expect(ctl(page, 'lobby.mode')).toContainText('Normal');
  await ctl(page, 'lobby.createTeam').click();
  await expect(page.locator('[data-editor="team"]')).toBeVisible(); await shot(page, 'lobby-custom-editor');
  await expect(page.locator('[data-editor="team"] [role="meter"]')).toHaveCount(0);
  await expect(page.locator('[data-editor="team"] .m-team-traits')).toContainText('Online: eşit araçlar');
});

test('release smoke: M then Yes exits a running race to the main menu', async ({ page, apex }) => {
  await apex.open({ mode: 'race', autostart: 1, autodrive: 1, laps: 1, ai: 19, skipLights: 1, quality: 'low', nopost: 1, mute: 1 }, 'sceneReady');
  await apex.waitForPhase('running');
  await page.keyboard.press('KeyM');
  await expect(page.getByRole('alertdialog')).toBeVisible();
  await expect(page.getByRole('alertdialog')).toHaveCSS('opacity', '1');
  await ctl(page, 'pause.confirm.yes').click();
  await expect.poll(() => apex.uiScreen()).toBe('mainMenu');
  expect(await apex.state()).toBe('menu');
  await shot(page, 'race-m-main-menu');
});
