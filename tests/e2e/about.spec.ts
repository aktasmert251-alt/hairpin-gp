import { readFileSync } from 'node:fs';
import { expect, test } from '../helpers/fixtures';
import { focusOn, key, toMainMenu, waitScreen } from '../helpers/menu';
import tr from '../../src/ui/i18n/credits.tr';
import en from '../../src/ui/i18n/credits.en';

const ids = ['game', 'licenses', 'kvkk', 'storage', 'privacy'] as const;

test('About opens from the main menu; trailer menu entry is removed', async ({ apex, page }) => {
  await toMainMenu(apex, page);
  await expect(page.locator('[data-focus-id="main.credits"]')).toHaveText('OYUN HAKKINDA');
  await expect(page.locator('[data-focus-id="main.trailer"]')).toHaveCount(0);
  await focusOn(apex, page, 'main.credits'); await key(page, 'Enter');
  await waitScreen(apex, 'credits');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('OYUN HAKKINDA');
  await expect(page.getByRole('tab', { selected: true })).toBeFocused();
  await key(page, 'Escape'); await waitScreen(apex, 'mainMenu');
  expect(await apex.focusId()).toBe('main.credits');
});

for (const [lang, dict] of [['tr', tr], ['en', en]] as const) {
  for (const [width, height] of [[1920, 1080], [1366, 768]]) {
    test(`About ${lang} ${width}: mouse and keyboard tabs, readable layout, scroll and links`, async ({ apex, page }) => {
      await page.setViewportSize({ width: width!, height: height! });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await apex.open(`/?scene=menu&screen=credits&lang=${lang}&anim=off`, 'sceneReady');
      const panel = page.getByRole('tabpanel');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(dict.title);
      for (const id of ids) {
        const tab = page.getByRole('tab', { name: dict.tabs[id], exact: true });
        await tab.click(); await expect(tab).toHaveAttribute('aria-selected', 'true');
        await expect(panel).toHaveAttribute('aria-labelledby', `about-tab-${id}`);
        await expect(panel.getByRole('heading', { level: 2 })).toHaveText(dict.tabs[id]);
        expect(await panel.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
        const bounds = await panel.boundingBox();
        expect(bounds!.y + bounds!.height).toBeLessThan(height!);
        const typeSize = await panel.evaluate((el) => {
          const scale = el.getBoundingClientRect().width / (el as HTMLElement).offsetWidth;
          return parseFloat(getComputedStyle(el).fontSize) * scale;
        });
        expect(typeSize).toBeGreaterThanOrEqual(12);
      }
      const current = page.getByRole('tab', { selected: true });
      await key(page, 'Home'); await expect(current).toHaveAttribute('data-tab', 'game');
      await key(page, 'ArrowDown'); await expect(current).toHaveAttribute('data-tab', 'licenses');
      await key(page, 'KeyS'); await expect(current).toHaveAttribute('data-tab', 'kvkk');
      await key(page, 'ArrowUp'); await expect(current).toHaveAttribute('data-tab', 'licenses');
      await key(page, 'ArrowRight'); await expect(current).toHaveAttribute('data-tab', 'kvkk');
      await key(page, 'Tab'); await expect(panel).toBeFocused();
      await key(page, 'End'); expect(await panel.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
      await key(page, 'Home'); expect(await panel.evaluate(el => el.scrollTop)).toBe(0);
      await key(page, 'ArrowDown'); expect(await panel.evaluate(el => el.scrollTop)).toBe(120);
      await key(page, 'Shift+Tab'); await expect(current).toBeFocused();
      await page.getByRole('tab', { name: dict.tabs.game, exact: true }).click();
      await expect(panel.getByRole('heading', { level: 3, name: dict.game.source })).toBeVisible();
      await expect(panel).toContainText(dict.game.sourceBody);
      await page.getByRole('tab', { name: dict.tabs.licenses, exact: true }).click();
      for (const id of ['istanbul', 'lombardia', 'bosphorus', 'ardennes']) {
        await expect(panel.locator(`a[href$="data/tracks/${id}.raw.json"]`)).toHaveCount(1);
      }
      await expect(panel.locator('a[href$="THIRD-PARTY-LICENSES.txt"]')).toHaveCount(1);
      await page.getByRole('tab', { name: dict.tabs.privacy, exact: true }).click();
      for (const name of ['privacy', 'terms']) {
        await expect(panel.locator(`a[href*="legal/${name}.html"]`)).toHaveCount(1);
      }
    });
  }
  test(`About ${lang}: delete requires confirmation, cancels safely and clears both stores by prefix`, async ({ apex, page }) => {
    await apex.open(`/?scene=menu&screen=credits&lang=${lang}&anim=off`, 'sceneReady');
    await page.getByRole('tab', { name: dict.tabs.storage, exact: true }).click();
    await page.evaluate(() => {
      for (const storage of [localStorage, sessionStorage]) {
        for (const k of ['apexgp:v1:settings', 'apexgp:v1:deviceId', 'apexgp:v1:customTeams', 'apexgp:v1:tt:test', 'apexgp:v1:future', 'other-app:key', 'apex.net.resume']) storage.setItem(k, 'sentinel');
      }
    });
    const data = () => page.evaluate(() => [localStorage, sessionStorage].map(storage => Object.keys(storage).filter(k => k.startsWith('apexgp:v1:'))));
    const before = await data();
    const remove = page.getByRole('button', { name: dict.storage.delete, exact: true });
    const dialog = page.getByRole('dialog');
    await remove.click(); await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: dict.storage.cancel })).toBeFocused();
    await key(page, 'Escape'); await expect(dialog).not.toBeVisible(); expect(await data()).toEqual(before);
    await expect(remove).toBeFocused();
    await key(page, 'Enter'); await key(page, 'Enter'); // default Cancel
    await expect(dialog).not.toBeVisible(); expect(await data()).toEqual(before);
    await remove.click();
    if (lang === 'tr') {
      await key(page, 'Tab'); await expect(dialog.getByRole('button', { name: dict.storage.confirm, exact: true })).toBeFocused();
      await key(page, 'Enter');
    } else await dialog.getByRole('button', { name: dict.storage.confirm, exact: true }).click();
    await expect(dialog).not.toBeVisible(); expect(await data()).toEqual([[], []]);
    expect(await page.evaluate(() => [localStorage, sessionStorage].map(s => [s.getItem('other-app:key'), s.getItem('apex.net.resume')]))).toEqual([['sentinel', 'sentinel'], ['sentinel', 'sentinel']]);
    await expect(page.getByRole('status')).toHaveText(dict.storage.deleted);
  });
}

test('About reports blocked storage instead of claiming complete deletion', async ({ apex, page }) => {
  await apex.open('/?scene=menu&screen=credits&anim=off', 'sceneReady');
  await page.getByRole('tab', { name: tr.tabs.storage, exact: true }).click();
  await page.evaluate(() => Object.defineProperty(window, 'sessionStorage', { configurable: true, get() { throw new DOMException('blocked', 'SecurityError'); } }));
  await page.getByRole('button', { name: tr.storage.delete, exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: tr.storage.confirm, exact: true }).click();
  await expect(page.getByRole('status')).toHaveText(tr.storage.failed);
});

test('Legal web pages and docs contain the same bilingual notice as the game', async ({ page, request }) => {
  for (const doc of ['privacy', 'kvkk']) {
    const response = await request.get(`/legal/${doc}.html`);
    expect(response.ok()).toBe(true);
    await page.setContent(await response.text());
    for (const [lang, dict] of [['tr', tr], ['en', en]] as const) {
      const section = page.locator(`section[lang="${lang}"]`);
      const md = readFileSync(`docs/legal/${doc === 'privacy' ? 'privacy' : 'kvkk-aydinlatma'}.md`, 'utf8');
      for (const k of ['controller', 'data', 'technical', 'contact', 'purposes', 'transfer', 'retention', 'rights'] as const) {
        await expect(section).toContainText(dict.kvkk[`${k}Body`]); expect(md).toContain(dict.kvkk[`${k}Body`]);
      }
      for (const k of ['cookiesBody', 'localBody', 'keys', 'deletionBody'] as const) {
        await expect(section).toContainText(dict.storage[k]); expect(md).toContain(dict.storage[k]);
      }
    }
    await expect(page.locator('body')).not.toContainText('Bu metin bilgilendirme amaçlıdır');
  }
});
