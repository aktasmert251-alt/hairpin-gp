// Regression (user bug 2026-10-23): online, the loading screen and the HUD minimap showed the MENU's track instead of the room's
// race track. Launch track İstanbul; the (mock) room races Ardennes. Loading title, the session's track and the setup store the
// minimap reads must all say Ardennes; after leaving online the menu choice (İstanbul) is back.
import { expect, test } from '../helpers/fixtures';
import { mockLobby } from '../helpers/mockLobby';

test('online: loading screen and minimap use the room track, not the menu track', async ({ page }) => {
  test.setTimeout(120_000);
  await mockLobby(page);
  await page.goto('/?track=istanbul&name=Deniz&quality=low&mute=1&autopause=0&nopost=1');
  const start = page.locator('[data-screen="lobby"][data-active="1"] [data-focus-id="lobby.start"]');
  await expect(start).toBeVisible({ timeout: 30_000 });
  await expect(start).not.toHaveAttribute('aria-disabled', 'true', { timeout: 10_000 });
  await start.click();
  const loading = page.locator('[data-screen="loading"] .m-h1');
  await expect(loading).toHaveText(/ARDEN/i, { timeout: 30_000 });
  await page.waitForFunction(() => (window as unknown as { __APEX__: { getRace(): unknown } }).__APEX__.getRace() !== null, null, { timeout: 90_000 });
  const track = await page.evaluate(() => (window as unknown as { __APEX__: { track(): { id: string } } }).__APEX__.track().id);
  expect(track).toBe('ardennes');
});
