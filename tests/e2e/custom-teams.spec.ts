import { expect, test } from '../helpers/fixtures';
import { UI_BASE, Ui, seedSettings } from '../helpers/uiDriver';
import type { ApexDebugApi } from '../../src/contracts/debug';
import { hudStripColor } from '../../src/data/teamPalette';
import { mockLobby } from '../helpers/mockLobby';

async function openLobby(ui: Ui): Promise<void> {
  await ui.toMainMenu();
  await ui.click('main.online'); await ui.waitScreen('online');
  await ui.page.locator('[data-focus-id="online.name"]').fill('Deniz');
  await ui.click('online.quickJoin'); await ui.waitScreen('lobby');
}

test.use({ baseURL: UI_BASE });
const key = 'apexgp:v1:customTeams';

test('custom teams: validate, preview, save, edit, cancel and reload in the online lobby', async ({ page, apex }) => {
  test.setTimeout(240_000);
  await seedSettings(page, { ui: { animations: 'off' }, graphics: { preset: 'low' } });
  const ui = new Ui(apex, page);
  const requests = await mockLobby(page);
  await openLobby(ui);
  await page.locator('[data-focus-id="lobby.createTeam"]').click();
  const editor = page.locator('[data-editor="team"]');
  const name = editor.locator('input');
  await expect(editor).toBeVisible();
  await name.fill('<b>GP</b>');
  await expect(name).toHaveAttribute('aria-invalid', 'true');
  await expect(editor.locator('[data-focus-id="custom.save"]')).toHaveAttribute('aria-disabled', 'true');
  await name.fill(String.fromCharCode(70, 49));
  await expect(name).toHaveAttribute('aria-invalid', 'true');
  await name.fill('Gu\u0308nes\u0327 GP');
  await page.keyboard.press('Enter');
  await expect(editor.locator('[data-focus-id="custom.base"]')).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(editor.locator('.m-team-traits')).toHaveAttribute('data-team-id', 'aurora');
  await expect(editor.getByRole('meter')).toHaveCount(0);
  await expect(editor.locator('.m-team-traits')).toContainText('Online: eşit araçlar');
  await editor.locator('[data-focus-id="custom.primary"] [data-palette-id="ink"]').click();
  await editor.locator('[data-focus-id="custom.secondary"] [data-palette-id="mint"]').click();
  await editor.locator('[data-focus-id="custom.accent"] [data-palette-id="gold"]').click();
  await editor.locator('[data-focus-id="custom.finish"]').click();
  await expect(editor.locator('.m-livery-swatch')).toHaveAttribute('data-finish', 'matte');
  await editor.locator('[data-focus-id="custom.save"]').click();
  await expect(editor).toHaveCount(0);
  await expect(page.locator('[data-focus-id="lobby.customTeam"]')).toContainText('Güneş GP');
  expect(requests).toContainEqual(expect.objectContaining({ type: 'setTeam', team: expect.objectContaining({ name: 'Güneş GP' }) }));
  const saved = await page.evaluate(k => JSON.parse(localStorage.getItem(k)!), key);
  expect(saved).toMatchObject([{ name: 'Güneş GP', baseTeamId: 'aurora', primary: 'ink', secondary: 'mint', accent: 'gold', finish: 'matte' }]);
  await page.locator('[data-focus-id="lobby.editTeam"]').click();
  await editor.locator('input').fill('Geçici GP');
  await page.keyboard.press('Escape');
  expect(await page.evaluate(k => JSON.parse(localStorage.getItem(k)!)[0].name, key)).toBe('Güneş GP');
  await page.locator('[data-focus-id="lobby.editTeam"]').click();
  await editor.locator('input').fill('Deniz GP');
  await editor.locator('[data-focus-id="custom.save"]').click();
  expect(await page.evaluate(k => JSON.parse(localStorage.getItem(k)!)[0].name, key)).toBe('Deniz GP');
  await page.reload();
  await openLobby(ui);
  await expect(page.locator('[data-focus-id="lobby.customTeam"]')).toContainText('Deniz GP');
  await expect(page.locator('[data-focus-id="lobby.team"]')).toContainText('Deniz GP');
});

test('custom teams: English online editor supports keyboard palettes and deletion', async ({ page, apex }) => {
  test.setTimeout(240_000);
  await seedSettings(page, { lang: 'en', ui: { animations: 'off' }, graphics: { preset: 'low' } });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const ui = new Ui(apex, page);
  const requests = await mockLobby(page);
  await openLobby(ui);
  await page.locator('[data-focus-id="lobby.createTeam"]').click();
  const editor = page.locator('[data-editor="team"]');
  await expect(editor.locator('h1')).toHaveText('CREATE TEAM');
  await editor.locator('input').fill('Coast GP');
  await page.keyboard.press('Tab');
  await page.keyboard.press('ArrowDown');
  await expect(editor.locator('[data-focus-id="custom.primary"]')).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(editor.locator('[data-focus-id="custom.primary"] [data-palette-id="cyan"]')).toHaveClass('selected');
  await editor.locator('[data-focus-id="custom.save"]').click();
  await expect(page.locator('[data-focus-id="lobby.customTeam"]')).toContainText('Coast GP');
  await page.locator('[data-focus-id="lobby.editTeam"]').click();
  await editor.locator('[data-focus-id="custom.delete"]').click();
  await expect(editor).toHaveCount(0);
  expect(await page.evaluate(k => JSON.parse(localStorage.getItem(k)!), key)).toEqual([]);
  await expect(page.locator('[data-focus-id="lobby.customTeam"]')).not.toContainText('Coast GP');
  await expect(page.locator('[data-focus-id="lobby.team"]')).not.toContainText('Coast GP');
  expect(requests).toContainEqual({ type: 'setTeam', team: null });
});

test('D-062 custom-team entry points are absent from both offline setup screens', async ({ page, apex }) => {
  await seedSettings(page, { ui: { animations: 'off' }, graphics: { preset: 'low' } });
  const ui = new Ui(apex, page);
  await ui.toMainMenu(); await ui.goTo('teamSelect');
  await expect(page.locator('[data-focus-id="team.create"], [data-focus-id="team.edit"], [data-focus-id="team.custom"]')).toHaveCount(0);
  await expect(page.locator('[data-screen="teamSelect"] [role="meter"]')).toHaveCount(6);
  await ui.key('Escape'); await ui.key('Escape'); await ui.waitScreen('mainMenu');
  await ui.goTo('ttSetup');
  await expect(page.locator('[data-focus-id="tt.create"], [data-focus-id="tt.edit"]')).toHaveCount(0);
});

test('custom teams: online load renders both base-car seats with the custom livery and HUD strip', async ({ page, apex }) => {
  test.setTimeout(240_000);
  await seedSettings(page, { ui: { animations: 'off' }, graphics: { preset: 'low' } });
  await page.addInitScript(() => {
    localStorage.setItem('apexgp:v1:customTeams', JSON.stringify([{
      id: 'custom-race', name: 'Deniz GP', baseTeamId: 'meridian', primary: 'purple', secondary: 'mint', accent: 'gold', finish: 'metallic',
    }]));
  });
  const requests = await mockLobby(page);
  const ui = new Ui(apex, page);
  await openLobby(ui);
  await ui.focusViaKeys('lobby.customTeam'); await page.keyboard.press('ArrowRight');
  await expect(page.locator('[data-focus-id="lobby.team"]')).toContainText('Deniz GP');
  await page.locator('[data-focus-id="lobby.ready"]').click();
  await page.locator('[data-focus-id="lobby.start"]').click();
  await apex.waitForState('session', 90_000);
  await expect.poll(async () => (await apex.getHud())?.tower.length).toBe(2);
  expect(requests).toContainEqual(expect.objectContaining({ type: 'loaded' }));
  const cars = await page.evaluate(() => (window as unknown as { __APEX__: ApexDebugApi }).__APEX__.getRace()!.cars);
  const teamCars = cars.filter(c => c.teamId === 'meridian');
  expect(teamCars).toHaveLength(2);
  const hud = await page.evaluate(() => (window as unknown as { __APEX__: ApexDebugApi }).__APEX__.getHud()!);
  for (const car of teamCars) expect(hud.tower.find(row => row.car === car.id)!.teamColor).toBe(hudStripColor('purple'));
  await apex.nextFrames(3);
  await page.screenshot({ path: 'test-results/screens/codex/teams-race-chase.png' });
  await page.screenshot({ path: 'test-results/screens/codex/teams-hud-strip.png', clip: { x: 0, y: 0, width: 520, height: 1000 } });
});
