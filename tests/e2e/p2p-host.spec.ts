// D-064 host-in-browser rooms, end to end in real Chrome: two browser contexts (host and guest) exchange the manual invite /
// answer codes through the pages, connect over WebRTC (host candidates only: ?p2pIce=none, no STUN, nothing leaves localhost),
// see the host-tab "paused" banner, race a few seconds against the host's in-browser server AI, then the host closes its tab
// and the guest is told. Screenshots: test-results/screens/net2/.
import path from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from '../helpers/fixtures';
import { ApexClient } from '../helpers/apexClient';
import { BLOCK_VITE_HMR, RESET_STORAGE_ONCE } from '../helpers/pageInit.mjs';
import { Ui, seedSettings } from '../helpers/uiDriver';

const SHOTS = path.join('test-results', 'screens', 'net2');
// WebRtcHideLocalIpsWithMdns off: two contexts of one headless browser cannot resolve each other's mDNS (.local) candidates.
test.use({ launchOptions: { args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--disable-features=WebRtcHideLocalIpsWithMdns'] } });

const BASE = { p2pIce: 'none', quality: 'low', mute: 1, autopause: 0, nopost: 1 };
const shot = (page: Page, name: string): Promise<Buffer> => page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
const value = (page: Page, sel: string): Promise<string> => page.locator(sel).inputValue();

async function toOnline(ui: Ui, mode: 'host' | 'join', name: string): Promise<void> {
  await ui.toMainMenu({ ...BASE, p2p: mode });
  await ui.click('main.online');
  await ui.waitScreen('online');
  await ui.page.locator('[data-focus-id="online.name"]').fill(name);
}

test('host-in-browser room: manual code exchange, paused banner, short race, host leaves', async ({ page, apex, browser }) => {
  test.setTimeout(300_000);
  await seedSettings(page, { ui: { animations: 'off' }, graphics: { preset: 'low' } });
  const guestCtx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  await guestCtx.addInitScript(BLOCK_VITE_HMR);
  await guestCtx.addInitScript(RESET_STORAGE_ONCE);
  const guest = await guestCtx.newPage();
  const guestErrors: string[] = [];
  guest.on('console', (m) => { if (m.type() === 'error') guestErrors.push(m.text()); });
  guest.on('pageerror', (e) => guestErrors.push(e.message));
  await seedSettings(guest, { ui: { animations: 'off' }, graphics: { preset: 'low' } });
  const hostUi = new Ui(apex, page);
  const guestApex = new ApexClient(guest);
  const guestUi = new Ui(guestApex, guest);

  // Host: "Oda kur (bu bilgisayar sunucu)" → lobby with the host notice → invite panel → first invite code.
  await toOnline(hostUi, 'host', 'Ev Sahibi');
  await expect(page.locator('.m-p2p-privacy').first()).toBeVisible();
  await shot(page, '01-host-online-mode');
  await hostUi.click('online.hostStart');
  await hostUi.waitScreen('lobby', 20_000);
  await expect(page.locator('.m-p2p-banner')).toBeVisible();
  await hostUi.click('lobby.p2pInvites');
  await hostUi.click('p2p.newInvite');
  await expect.poll(() => value(page, '#p2p-invite-out'), { timeout: 15_000 }).toMatch(/^HP1I\./);
  const invite = await value(page, '#p2p-invite-out');
  expect(invite.length).toBeLessThan(3000);
  await shot(page, '02-host-invite');

  // Guest: "Odaya katıl (davet kodu)" → paste invite → answer code.
  await toOnline(guestUi, 'join', 'Misafir');
  await guest.locator('[data-focus-id="online.invite"]').fill(invite);
  await guestUi.click('online.makeAnswer');
  await expect.poll(() => value(guest, '#online-answer'), { timeout: 15_000 }).toMatch(/^HP1A\./);
  const answer = await value(guest, '#online-answer');
  await shot(guest, '03-guest-answer');

  // Host pastes the answer → the slot connects → the guest lands in the lobby.
  await page.locator('#p2p-answer-in').fill(answer);
  await hostUi.click('p2p.connect');
  await expect(page.locator('.m-p2p-slot.is-connected')).toHaveCount(1, { timeout: 20_000 });
  await guestUi.waitScreen('lobby', 20_000);
  await shot(page, '04-host-panel-connected');
  await hostUi.click('p2p.close');
  await expect(page.locator('.m-player-card')).toHaveCount(2, { timeout: 10_000 });
  await expect(guest.locator('.m-player-card')).toHaveCount(2, { timeout: 10_000 });

  // Host tab hidden (Page Visibility) → guests see the paused banner; back → host warning.
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(guest.locator('.m-p2p-banner')).toBeVisible({ timeout: 10_000 });
  await shot(guest, '05-guest-host-paused');
  await page.waitForTimeout(2200);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(guest.locator('.m-p2p-banner')).toBeHidden({ timeout: 10_000 });
  await expect(page.locator('.m-p2p-banner.is-warn')).toBeVisible({ timeout: 5_000 });

  // Short race: guest ready, host starts; both race the same grid (2 humans + server AI from the host's worker).
  await guestUi.click('lobby.ready');
  await expect(page.locator('[data-focus-id="lobby.start"]')).not.toHaveAttribute('aria-disabled', 'true', { timeout: 10_000 });
  await shot(guest, '06-guest-lobby-ready');
  await hostUi.click('lobby.start');
  const raceOn = (p: Page): Promise<unknown> => p.waitForFunction(() => {
    const r = (window as unknown as { __APEX__: { getRace(): { phase: string } | null } }).__APEX__.getRace();
    return r !== null && r.phase === 'running';
  }, null, { timeout: 120_000, polling: 250 });
  await Promise.all([raceOn(page), raceOn(guest)]);
  await page.waitForTimeout(6000);
  const cars = (p: Page): Promise<number> => p.evaluate(() => (window as unknown as { __APEX__: { getRace(): { cars: unknown[] } } }).__APEX__.getRace().cars.length);
  expect(await cars(page)).toBe(await cars(guest));
  expect(await cars(page)).toBeGreaterThan(2);
  const net = await guest.evaluate(() => (window as unknown as { __APEX__: { net(): { state: string; rttMs: number; recv: number } | null } }).__APEX__.net());
  expect(net?.state).toBe('online');
  expect(net!.recv).toBeGreaterThan(100);
  await shot(page, '07-race-host-view');
  await shot(guest, '08-race-guest-view');

  // Host closes its tab: guests are told the room ended and return to the online screen.
  await page.close({ runBeforeUnload: true });
  await guestUi.waitScreen('online', 30_000);
  await expect(guest.locator('[data-screen="online"] .m-net-message')).toContainText(/odayı kapattı|closed the room/i);
  await shot(guest, '09-guest-host-left');
  expect(guestErrors).toEqual([]);
  await guestCtx.close();
});
