import type { Page } from '@playwright/test';
import { PROTOCOL_VERSION, type NetLobbyModel, type NetClientMsg } from '../../src/contracts/net';
import { parseClientMessage } from '../../src/net/protocol';
import type { ScreenId, UiAction } from '../../src/contracts/ui';
import { expect, test } from '../helpers/fixtures';

interface Probe {
  model(): NetLobbyModel;
  actions(): UiAction[];
  remoteReady(ready: boolean): void;
  countdown(): void;
  patch(patch: Partial<NetLobbyModel>): void;
  show(screen: ScreenId): void;
  dispose(): void;
}
const ctl = (page: Page, id: string) => page.locator(`[data-active="1"] [data-focus-id="${id}"]`);
const screen = (page: Page, id: string) => page.locator(`[data-screen="${id}"][data-active="1"]`);
const state = (page: Page) => page.evaluate(() => (window as unknown as { __onlineUi: Probe }).__onlineUi.model());
async function open(page: Page, id = 'lobby', query = '') {
  await page.goto(`/?scene=${id}&freeze=1${query}`);
  await page.waitForFunction(() => Boolean((window as unknown as { __APEX__?: { sceneReady: boolean } }).__APEX__?.sceneReady));
  await expect(screen(page, id)).toHaveCount(1);
  await page.waitForTimeout(250);
}
async function focus(page: Page, id: string) {
  await page.keyboard.press('Home');
  for (let i = 0; i < 40; i++) {
    if (await ctl(page, id).evaluate((el) => el.classList.contains('is-focus'))) return;
    await page.keyboard.press('ArrowDown');
  }
  throw new Error(`Could not focus ${id}`);
}

test.describe('P4 online lobby sandbox', () => {
  test('D-059 new online rooms default to filled seats after a solo setup', async ({ page }) => {
    await open(page, 'online', '&anim=off');
    await page.evaluate(() => (window as unknown as { __onlineUi: Probe }).__onlineUi.show('ttSetup'));
    await page.keyboard.press('End');
    await page.keyboard.press('Enter'); // the time-trial start action sets the shared setup count to zero
    await page.evaluate(() => (window as unknown as { __onlineUi: Probe }).__onlineUi.show('online'));
    await ctl(page, 'online.name').fill('Deniz');
    await ctl(page, 'online.create').click();
    await expect(ctl(page, 'lobby.aiEnabled')).toHaveAttribute('aria-checked', 'true');
    const actions = await page.evaluate(() => (window as unknown as { __onlineUi: Probe }).__onlineUi.actions());
    expect(actions).toContainEqual(expect.objectContaining({ type: 'startTimeTrial' }));
    expect(actions).toContainEqual(expect.objectContaining({ type: 'onlineCreate', settings: expect.objectContaining({ aiCount: 19 }) }));
  });

  for (const lang of ['tr', 'en']) {
    test(`D-059 ${lang}: owner switches opponents Off/On, fills empty seats, and may lower the count`, async ({ page }) => {
      await open(page, 'lobby', `&lang=${lang}&anim=off`);
      const toggle = ctl(page, 'lobby.aiEnabled');
      // Real server snapshots retain the requested count and clamp it when loading the race.
      await page.evaluate(() => {
        const probe = (window as unknown as { __onlineUi: Probe }).__onlineUi;
        const room = probe.model().room!;
        probe.patch({ room: { ...room, settings: { ...room.settings, aiCount: 19 } } });
      });
      await expect(toggle).toHaveAccessibleName(lang === 'tr' ? 'Yapay zekâ rakipler' : 'AI opponents');
      await expect(toggle).toHaveAttribute('aria-checked', 'true');
      await expect(ctl(page, 'lobby.aiCount').locator('.val')).toHaveText('17');
      await focus(page, 'lobby.aiEnabled');
      await page.keyboard.press('ArrowLeft');
      expect((await state(page)).room!.settings.aiCount).toBe(0);
      await expect(toggle).toHaveAttribute('aria-checked', 'false');
      await expect(ctl(page, 'lobby.aiCount')).toBeHidden();
      await expect(page.locator('.m-ai-summary')).toHaveText(lang === 'tr' ? '0 yapay zekâ · toplam 3 araç' : '0 AI · 3 cars in total');
      await page.keyboard.press('ArrowDown');
      await expect(ctl(page, 'lobby.difficulty')).toBeFocused();
      // A join while Off must keep zero; On fills the updated capacity.
      await page.evaluate(() => {
        const probe = (window as unknown as { __onlineUi: Probe }).__onlineUi;
        const room = probe.model().room!;
        probe.patch({ room: { ...room, players: [...room.players, { ...room.players[0]!, id: 3, name: 'Ada', teamId: 'vortex' }] } });
      });
      await expect(page.locator('.m-ai-summary')).toHaveText(lang === 'tr' ? '0 yapay zekâ · toplam 4 araç' : '0 AI · 4 cars in total');
      await toggle.click();
      expect((await state(page)).room!.settings.aiCount).toBe(16);
      await expect(ctl(page, 'lobby.aiCount')).toBeVisible();
      await focus(page, 'lobby.aiCount');
      await page.keyboard.press('ArrowLeft');
      expect((await state(page)).room!.settings.aiCount).toBe(15);
      await expect(page.locator('.m-ai-summary')).toHaveText(lang === 'tr' ? '15 yapay zekâ · toplam 19 araç' : '15 AI · 19 cars in total');
      const actions = await page.evaluate(() => (window as unknown as { __onlineUi: Probe }).__onlineUi.actions());
      expect(actions).toContainEqual(expect.objectContaining({ type: 'onlineSettings', settings: expect.objectContaining({ aiCount: 0 }) }));
      expect(actions).toContainEqual(expect.objectContaining({ type: 'onlineSettings', settings: expect.objectContaining({ aiCount: 16 }) }));
    });
  }

  test('D-059 guests see live read-only opponent state; a full human grid cannot add AI', async ({ page }) => {
    await open(page, 'lobby', '&owner=0&anim=off');
    await expect(ctl(page, 'lobby.aiEnabled')).toHaveAttribute('aria-disabled', 'true');
    await ctl(page, 'lobby.aiEnabled').click({ force: true });
    expect((await state(page)).room!.settings.aiCount).toBe(17);
    await page.evaluate(() => {
      const probe = (window as unknown as { __onlineUi: Probe }).__onlineUi;
      const room = probe.model().room!;
      probe.patch({ room: { ...room, settings: { ...room.settings, aiCount: 0 } } });
    });
    await expect(ctl(page, 'lobby.aiEnabled')).toHaveAttribute('aria-checked', 'false');
    await expect(ctl(page, 'lobby.aiCount')).toBeHidden();
    await expect(page.locator('.m-ai-summary')).toHaveText('0 yapay zekâ · toplam 3 araç');
    await ctl(page, 'lobby.aiEnabled').click({ force: true });
    expect((await state(page)).room!.settings.aiCount).toBe(0);
    await open(page, 'lobby', '&players=20&anim=off');
    await expect(ctl(page, 'lobby.aiEnabled')).toHaveAttribute('aria-disabled', 'true');
    await ctl(page, 'lobby.aiEnabled').click({ force: true });
    expect((await state(page)).room!.settings.aiCount).toBe(0);
  });

  test('mouse create and keyboard ready toggle; mouse start and countdown leave', async ({ page }) => {
    await open(page, 'online');
    await ctl(page, 'online.name').fill('Gül');
    await ctl(page, 'online.create').click();
    await expect(screen(page, 'lobby')).toHaveCount(1);
    await page.waitForTimeout(250);
    await focus(page, 'lobby.ready');
    await page.keyboard.press('Space');
    await expect(ctl(page, 'lobby.ready')).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Enter');
    await expect(ctl(page, 'lobby.ready')).toHaveAttribute('aria-pressed', 'false');
    await page.evaluate(() => (window as unknown as { __onlineUi: Probe }).__onlineUi.remoteReady(true));
    await page.keyboard.press('Space');
    await ctl(page, 'lobby.start').click();
    await expect(page.locator('.m-countdown .apx-num')).toHaveText('3');
    await page.keyboard.press('Escape');
    await expect(screen(page, 'online')).toHaveCount(1);
    expect((await state(page)).room).toBeNull();
  });

  test('keyboard create with Turkish nickname, one focus, no arrow wrapping, leave', async ({ page }) => {
    await open(page, 'online');
    // D-064: the connection mode row (server / host / join) comes first; the nickname follows.
    await expect(ctl(page, 'online.connMode')).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(ctl(page, 'online.connMode')).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(ctl(page, 'online.name')).toBeFocused();
    await expect(ctl(page, 'online.create')).toHaveAttribute('aria-disabled', 'true');
    await page.keyboard.insertText('  Çağrı Işık  ');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await expect(ctl(page, 'online.create')).toBeFocused();
    await expect(screen(page, 'online').locator('.is-focus')).toHaveCount(1);
    await page.keyboard.press('Space');
    await expect(screen(page, 'lobby')).toHaveCount(1);
    expect((await state(page)).room!.players[0]!.name).toBe('Çağrı Işık');
    await page.waitForTimeout(250);
    await page.keyboard.press('End');
    await expect(ctl(page, 'lobby.leave')).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(ctl(page, 'lobby.leave')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(screen(page, 'online')).toHaveCount(1);
    expect((await state(page)).room).toBeNull();
  });

  test('mouse join validates code and nickname; advanced server goes into the action', async ({ page }) => {
    await open(page, 'online');
    await ctl(page, 'online.name').fill('<Deniz>');
    await ctl(page, 'online.code').fill('ab!23');
    await expect(ctl(page, 'online.name')).toHaveAttribute('aria-invalid', 'true');
    await expect(ctl(page, 'online.join')).toHaveAttribute('aria-disabled', 'true');
    await ctl(page, 'online.join').click({ force: true });
    await expect(screen(page, 'online')).toHaveCount(1);
    await ctl(page, 'online.name').fill('İpek');
    await ctl(page, 'online.code').fill('abx23');
    await expect(ctl(page, 'online.code')).toHaveValue('ABX23');
    await ctl(page, 'online.advanced').click();
    await ctl(page, 'online.server').fill('https://localhost/ws');
    await expect(ctl(page, 'online.join')).toHaveAttribute('aria-disabled', 'true');
    await ctl(page, 'online.server').fill('wss://localhost/ws');
    await expect(ctl(page, 'online.server')).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(ctl(page, 'online.advanced')).toBeFocused();
    await ctl(page, 'online.join').click();
    await expect(screen(page, 'lobby')).toHaveCount(1);
    expect((await state(page)).room!.code).toBe('ABX23');
    const actions = await page.evaluate(() => (window as unknown as { __onlineUi: Probe }).__onlineUi.actions());
    expect(actions).toContainEqual({ type: 'onlineJoin', name: 'İpek', code: 'ABX23', server: 'wss://localhost/ws' });
    await page.waitForTimeout(250);
    await expect(ctl(page, 'lobby.start')).toBeHidden();
    await expect(ctl(page, 'lobby.track')).toHaveAttribute('aria-disabled', 'true');
  });

  test('keyboard join uses Enter on text fields and Space on the join button', async ({ page }) => {
    await open(page, 'online');
    await page.keyboard.press('ArrowDown'); // D-064: past the connection mode row to the nickname
    await page.keyboard.insertText('Özgür');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await expect(ctl(page, 'online.code')).toBeFocused();
    await page.keyboard.type('apx27');
    await page.keyboard.press('Enter');
    await expect(ctl(page, 'online.join')).toBeFocused();
    await page.keyboard.press('Space');
    await expect(screen(page, 'lobby')).toHaveCount(1);
    expect((await state(page)).room!.players[1]!.name).toBe('Özgür');
  });

  test('owner settings use real track registry, lap choices, bounds and reset ready', async ({ page }) => {
    await open(page);
    await focus(page, 'lobby.laps');
    await page.keyboard.press('ArrowLeft');
    expect((await state(page)).room!.settings.laps).toBe(3);
    await page.keyboard.press('ArrowLeft');
    expect((await state(page)).room!.settings.laps).toBe(1);
    await page.keyboard.press('ArrowLeft');
    expect((await state(page)).room!.settings.laps).toBe(1);
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    expect((await state(page)).room!.settings.laps).toBe(10);
    await focus(page, 'lobby.track');
    const oldTrack = (await state(page)).room!.settings.trackId;
    await page.keyboard.press('ArrowRight');
    expect((await state(page)).room!.settings.trackId).not.toBe(oldTrack);
    await ctl(page, 'lobby.weather').click();
    expect((await state(page)).room!.settings.weather).toBe('light');
    await ctl(page, 'lobby.tod').click();
    expect((await state(page)).room!.settings.tod).toBe('night');
    await focus(page, 'lobby.aiCount');
    await page.keyboard.press('ArrowRight');
    expect((await state(page)).room!.settings.aiCount).toBe(17);
    await focus(page, 'lobby.difficulty');
    for (let i = 0; i < 45; i++) await page.keyboard.press('ArrowRight');
    expect((await state(page)).room!.settings.difficulty).toBe(110);
    expect((await state(page)).room!.players.every((p) => !p.ready)).toBe(true);
  });

  test('non-owner settings remain read-only; car picker excludes another player’s car', async ({ page }) => {
    await open(page, 'lobby', '&owner=0');
    const before = (await state(page)).room!.settings;
    await ctl(page, 'lobby.laps').click({ force: true });
    expect((await state(page)).room!.settings).toEqual(before);
    await expect(ctl(page, 'lobby.start')).toBeHidden();
    await focus(page, 'lobby.team');
    await page.keyboard.press('ArrowLeft');
    const m = await state(page);
    const me = m.room!.players.find((p) => p.id === m.myId)!;
    expect(me).toMatchObject({ teamId: 'anka', driverIdx: 1 });
    await focus(page, 'lobby.driver');
    await page.keyboard.press('ArrowLeft');
    expect((await state(page)).room!.players.find((p) => p.id === m.myId)!.driverIdx).toBe(1);
    await ctl(page, 'lobby.ready').click();
    await expect(ctl(page, 'lobby.ready')).toHaveAttribute('aria-pressed', 'true');
    await ctl(page, 'lobby.leave').click();
    await expect(screen(page, 'online')).toHaveCount(1);
  });

  test('Start enables only for all connected ready players; 3–2–1 follows the model', async ({ page }) => {
    await open(page);
    await expect(ctl(page, 'lobby.start')).toHaveAttribute('aria-disabled', 'true');
    await ctl(page, 'lobby.ready').click();
    await expect(ctl(page, 'lobby.start')).toHaveAttribute('aria-disabled', 'true');
    await page.evaluate(() => (window as unknown as { __onlineUi: Probe }).__onlineUi.remoteReady(true));
    await expect(ctl(page, 'lobby.start')).toHaveAttribute('aria-disabled', 'false');
    await page.evaluate(() => {
      const probe = (window as unknown as { __onlineUi: Probe }).__onlineUi;
      const room = probe.model().room!;
      probe.patch({ room: { ...room, players: room.players.map((p) => p.id === 0 ? { ...p, connected: false } : p) } });
    });
    await expect(ctl(page, 'lobby.start')).toHaveAttribute('aria-disabled', 'true');
    await page.evaluate(() => {
      const probe = (window as unknown as { __onlineUi: Probe }).__onlineUi;
      const room = probe.model().room!;
      probe.patch({ room: { ...room, players: room.players.map((p) => ({ ...p, connected: true })) } });
    });
    await focus(page, 'lobby.start');
    await page.keyboard.press('Enter');
    const digit = page.locator('.m-countdown .apx-num');
    await expect(digit).toHaveText('3');
    await expect(page.locator('.m-lobby-body')).toHaveJSProperty('inert', true);
    await expect(digit).toHaveText('2');
    await expect(digit).toHaveText('1');
    await expect(digit).toHaveText('BAŞLA');
    await expect.poll(async () => (await state(page)).room!.phase).toBe('racing');
  });

  test('room code copies with a mouse and Enter; all-ready state updates keep focus', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await open(page);
    await ctl(page, 'lobby.copy').click();
    await expect(ctl(page, 'lobby.copy')).toContainText('Kod kopyalandı');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('APX27');
    await page.keyboard.press('Enter');
    await page.evaluate(() => (window as unknown as { __onlineUi: Probe }).__onlineUi.remoteReady(true));
    await expect(ctl(page, 'lobby.copy')).toBeFocused();
    await expect(screen(page, 'lobby').locator('.is-focus')).toHaveCount(1);
  });

  test('English and reduced motion; reconnect and server errors are visible', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await open(page, 'lobby', '&lang=en');
    await expect(screen(page, 'lobby')).toContainText('RACE ROOM');
    await expect(ctl(page, 'lobby.ready')).toContainText('READY');
    await page.evaluate(() => (window as unknown as { __onlineUi: Probe }).__onlineUi.patch({ status: 'reconnecting' }));
    await expect(screen(page, 'lobby')).toContainText('Reconnecting');
    await expect(ctl(page, 'lobby.ready')).toHaveAttribute('aria-disabled', 'true');
    await page.evaluate(() => (window as unknown as { __onlineUi: Probe }).__onlineUi.patch({ status: 'error', error: 'taken' }));
    await expect(screen(page, 'lobby')).toContainText('Another player has this car.');
  });

  test('online pause and results have no restart; tower shows link badges and local ping', async ({ page }) => {
    await open(page);
    await page.evaluate(() => (window as unknown as { __onlineUi: Probe }).__onlineUi.show('pause'));
    await page.waitForTimeout(250);
    await expect(ctl(page, 'pause.restart')).toBeHidden();
    await expect(ctl(page, 'pause.restartLap')).toBeHidden();
    await expect(ctl(page, 'pause.retire')).toContainText('Yarıştan ayrıl');
    await expect(page.locator('.h-net-ping')).toHaveText('38 ms');
    await expect(page.locator('.h-row[data-net="stale"] .b-net')).toHaveText('LAG');
    await expect(page.locator('.h-row[data-net="stale"] .b-net')).toBeVisible();
    await expect(page.locator('.h-row[data-net="stale"] .b-pen')).toBeVisible();
    await expect(page.locator('.h-row[data-net="dc"] .b-net')).toHaveText('DC');
    await expect(page.locator('.h-row[data-net="dc"] .b-net')).toBeVisible();
    await ctl(page, 'pause.retire').click();
    await expect(page.getByRole('alertdialog')).toContainText('Yarış devam edecek');
    await expect(ctl(page, 'pause.confirm.no')).toBeFocused();
    await ctl(page, 'pause.confirm.yes').click();
    await expect(screen(page, 'online')).toHaveCount(1);
    await page.evaluate(() => (window as unknown as { __onlineUi: Probe }).__onlineUi.show('results'));
    await page.waitForTimeout(250);
    await expect(ctl(page, 'results.restart')).toBeHidden();
  });

  test('main menu offers ONLINE and provider absence is handled explicitly', async ({ page }) => {
    await open(page, 'online', '&provider=none');
    await ctl(page, 'online.name').fill('Deniz');
    await expect(ctl(page, 'online.create')).toHaveAttribute('aria-disabled', 'true');
    await expect(screen(page, 'online')).toContainText('Çevrim içi bağlantı henüz kullanılamıyor.');
    await page.keyboard.press('Escape');
    await expect(screen(page, 'mainMenu')).toHaveCount(1);
    await page.waitForTimeout(250);
    await ctl(page, 'main.online').click();
    await expect(screen(page, 'online')).toHaveCount(1);
  });

  test('a loading model blocks input and disposal clears the countdown interval', async ({ page }) => {
    await open(page);
    await page.evaluate(() => {
      const probe = (window as unknown as { __onlineUi: Probe }).__onlineUi;
      probe.patch({ room: { ...probe.model().room!, phase: 'loading' }, t0ServerMs: null });
    });
    await expect(page.locator('.m-countdown')).toContainText('Pist hazırlanıyor');
    await expect(page.locator('.m-countdown .apx-num')).toHaveText('');
    await page.keyboard.press('Enter');
    expect((await state(page)).room!.phase).toBe('loading');
    await page.evaluate(() => (window as unknown as { __onlineUi: Probe }).__onlineUi.dispose());
    await expect(page.locator('.apx-ui')).toHaveCount(0);
    await page.waitForTimeout(250);
  });

  test('sandbox peers join, report ping and become ready; grid clamps as humans join', async ({ page }) => {
    await page.goto('/?scene=lobby');
    await expect(screen(page, 'lobby')).toHaveCount(1);
    await expect(page.locator('.m-player-card[data-player-id]')).toHaveCount(4);
    expect((await state(page)).room!.settings.aiCount).toBe(16);
    await expect(page.locator('.m-ai-summary')).toContainText('16 yapay zekâ');
    await expect(page.locator('.m-player-card[data-player-id="3"]')).toContainText('51 ms');
    await expect.poll(async () => (await state(page)).room!.players.filter((p) => p.id !== 0).every((p) => p.ready)).toBe(true);
  });

  for (const humans of [1, 2, 8, 20]) {
    test(`${humans} humans fit the roster, preserve focus on updates and can start`, async ({ page }) => {
      await open(page, 'lobby', `&players=${humans}`);
      const cards = page.locator('.m-player-card[data-player-id]');
      await expect(cards).toHaveCount(humans);
      await expect(page.locator('.m-lobby-section')).toContainText(`${humans}/20`);
      await expect(page.locator('.m-ai-summary')).toContainText(`${Math.min(19, 20 - humans)} yapay zekâ`);
      await expect(page.locator('.m-lobby-actions')).not.toContainText('En az 2');
      const last = ctl(page, `lobby.player.${humans - 1}`);
      await last.click();
      await expect(last).toBeFocused();
      await page.evaluate(() => (window as unknown as { __onlineUi: Probe }).__onlineUi.remoteReady(true));
      await expect(last).toBeFocused();
      await page.keyboard.press('Home');
      await page.keyboard.press('ArrowDown');
      await expect(ctl(page, 'lobby.player.0')).toBeFocused();
      await ctl(page, 'lobby.ready').click();
      await expect(ctl(page, 'lobby.start')).toHaveAttribute('aria-disabled', 'false');
      const boxes = await page.locator('.m-player-grid, .m-lobby-car, .m-lobby-actions').evaluateAll((els) => els.map((el) => {
        const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom };
      }));
      expect(boxes[0]!.bottom).toBeLessThan(boxes[1]!.top);
      expect(boxes[1]!.bottom).toBeLessThan(boxes[2]!.top);
      if (humans === 20) await expect(page.locator('.m-ai-summary')).toHaveText('0 yapay zekâ · toplam 20 araç');
    });
  }
});

test.describe('D-050 and D-052 menu feedback', () => {
  test('owner toggles visibility by keyboard and it locks during loading; guest sees a badge', async ({ page }) => {
    await open(page);
    await focus(page, 'lobby.visibility');
    await page.keyboard.press('ArrowRight');
    expect((await state(page)).room!.settings.visibility).toBe('private');
    await page.evaluate(() => { const p = (window as unknown as { __onlineUi: Probe }).__onlineUi; p.patch({ room: { ...p.model().room!, phase: 'loading' } }); });
    await expect(ctl(page, 'lobby.visibility')).toHaveAttribute('aria-disabled', 'true');
    await open(page, 'lobby', '&owner=0&visibility=private');
    await expect(ctl(page, 'lobby.visibility')).toBeHidden();
    await expect(page.locator('.m-visibility-badge')).toHaveText('Özel');
  });
  for (const id of ['online', 'lobby']) {
    test(`${id}: plain-text notices clear and maintenance is inline`, async ({ page }) => {
      await open(page, id, '&notice=Service%20update');
      const root = screen(page, id);
      await expect(root.locator('.m-net-notice')).toHaveText('Service update');
      await page.evaluate(() => (window as unknown as { __onlineUi: Probe }).__onlineUi.patch({ notice: '<img src=x onerror=alert(1)>' }));
      await expect(root.locator('.m-net-notice')).toHaveText('<img src=x onerror=alert(1)>');
      await expect(root.locator('.m-net-notice img')).toHaveCount(0);
      await page.evaluate(() => (window as unknown as { __onlineUi: Probe }).__onlineUi.patch({ notice: null, error: 'maintenance' }));
      await expect(root.locator('.m-net-notice')).toBeHidden();
      await expect(root.locator('.m-net-message')).toContainText('bakımda');
    });
    test(`${id}: timed ban traps focus and returns to online without connecting`, async ({ page }) => {
      await open(page, id, '&lang=en&kicked=banned&until=1893456000000');
      const dialog = screen(page, id).getByRole('alertdialog');
      await expect(dialog).toContainText('ACCESS BLOCKED');
      await expect(dialog).toContainText('Blocked until');
      await expect(ctl(page, `${id}.removed.back`)).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(ctl(page, `${id}.removed.back`)).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(dialog).toBeVisible();
      await page.keyboard.press('Enter');
      await expect(screen(page, 'online')).toHaveCount(1);
      expect((await state(page)).status).toBe('offline');
      expect((await state(page)).kicked).toBeNull();
    });
  }
});

test.describe('D-052 directory controls', () => {
  test('public rows join with Enter, racing rows are disabled, and updates preserve focus', async ({ page }) => {
    await open(page, 'online');
    await ctl(page, 'online.name').fill('İpek');
    await expect(ctl(page, 'online.room.RCE89')).toHaveAttribute('aria-disabled', 'true');
    await focus(page, 'online.room.HRP42');
    await page.evaluate(() => {
      const probe = (window as unknown as { __onlineUi: Probe }).__onlineUi;
      probe.patch({ rooms: probe.model().rooms!.map((r) => ({ ...r, humans: r.humans === 20 ? 20 : r.humans + 1 })) });
    });
    await expect(ctl(page, 'online.room.HRP42')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(screen(page, 'lobby')).toHaveCount(1);
    expect((await state(page)).room!.code).toBe('HRP42');
  });
  test('new room visibility is selected with keyboard and sent with create', async ({ page }) => {
    await open(page, 'online');
    await ctl(page, 'online.name').fill('Deniz');
    await focus(page, 'online.visibility');
    await page.keyboard.press('ArrowRight');
    await ctl(page, 'online.create').click();
    expect((await state(page)).room!.settings.visibility).toBe('private');
  });
});

test.describe('D-052 live browsing and quick join', () => {
  const polls = (page: Page) => page.evaluate(() => (window as unknown as { __onlineUi: Probe }).__onlineUi.actions().filter((a) => a.type === 'onlineListRooms').length);

  test('polls every three seconds only on the online screen, restarts on return, and stops on disposal', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-10-17T00:00:00Z') });
    await open(page, 'online', '&name=Deniz&anim=off');
    await page.clock.pauseAt(new Date('2026-10-18T00:00:00Z'));
    // Restart at a controlled instant: slow browser commands must not consume the interval being asserted.
    await page.evaluate(() => (window as unknown as { __onlineUi: Probe }).__onlineUi.show('mainMenu'));
    const before = await polls(page);
    await page.evaluate(() => (window as unknown as { __onlineUi: Probe }).__onlineUi.show('online'));
    expect(await polls(page)).toBe(before + 1);
    await page.clock.runFor(2999);
    expect(await polls(page)).toBe(before + 1);
    await page.clock.runFor(1);
    expect(await polls(page)).toBe(before + 2);
    await page.evaluate(() => (window as unknown as { __onlineUi: Probe }).__onlineUi.show('mainMenu'));
    await expect(screen(page, 'mainMenu')).toHaveCount(1);
    const stopped = await polls(page);
    await page.clock.runFor(3300);
    expect(await polls(page)).toBe(stopped);
    await page.evaluate(() => (window as unknown as { __onlineUi: Probe }).__onlineUi.show('online'));
    expect(await polls(page)).toBe(stopped + 1);
    await page.evaluate(() => (window as unknown as { __onlineUi: Probe }).__onlineUi.dispose());
    const disposed = await polls(page);
    await page.clock.runFor(3300);
    expect(await polls(page)).toBe(disposed);
  });

  test('invalid identity does not poll; a valid nickname and server are sent on the next interval', async ({ page }) => {
    await open(page, 'online', '&anim=off');
    await expect(ctl(page, 'online.quickJoin')).toHaveAttribute('aria-disabled', 'true');
    await page.waitForTimeout(3300);
    expect(await polls(page)).toBe(0);
    await ctl(page, 'online.name').fill('Çağrı');
    await ctl(page, 'online.advanced').click();
    await ctl(page, 'online.server').fill('wss://localhost/ws');
    await expect.poll(() => polls(page), { timeout: 4500 }).toBe(1);
    const actions = await page.evaluate(() => (window as unknown as { __onlineUi: Probe }).__onlineUi.actions());
    expect(actions).toContainEqual({ type: 'onlineListRooms', name: 'Çağrı', server: 'wss://localhost/ws' });
  });

  for (const lang of ['tr', 'en']) {
    test(`${lang}: quick join supports mouse and keyboard and selects the fullest public lobby`, async ({ page }) => {
      await open(page, 'online', `&lang=${lang}&anim=off`);
      await ctl(page, 'online.name').fill('Deniz');
      await expect(ctl(page, 'online.quickJoin')).toContainText(lang === 'tr' ? 'Hızlı katıl' : 'Quick join');
      if (lang === 'tr') await ctl(page, 'online.quickJoin').click();
      else { await focus(page, 'online.quickJoin'); await page.keyboard.press('Enter'); }
      await expect(screen(page, 'lobby')).toHaveCount(1);
      expect((await state(page)).room!.code).toBe('HRP42');
      const before = await polls(page);
      await page.waitForTimeout(3300);
      expect(await polls(page)).toBe(before);
    });
  }

  test('quick join creates a public room when no lobby is available', async ({ page }) => {
    await open(page, 'online', '&name=Deniz&anim=off');
    await page.evaluate(() => (window as unknown as { __onlineUi: Probe }).__onlineUi.patch({ rooms: [] }));
    await ctl(page, 'online.quickJoin').click();
    await expect(screen(page, 'lobby')).toHaveCount(1);
    const m = await state(page);
    expect(m.room!.ownerId).toBe(m.myId);
    expect(m.room!.settings).toMatchObject({ visibility: 'public', difficulty: 55 });
  });

  test('dismissal of a kick does not automatically reconnect or resume polling', async ({ page }) => {
    await open(page, 'online', '&name=Deniz&anim=off');
    await page.evaluate(() => (window as unknown as { __onlineUi: Probe }).__onlineUi.patch({ status: 'error', kicked: { reason: 'kicked', until: null } }));
    await ctl(page, 'online.removed.back').click();
    const before = await polls(page);
    await page.waitForTimeout(3300);
    expect(await polls(page)).toBe(before);
    expect((await state(page)).status).toBe('offline');
    await ctl(page, 'online.room.HRP42').click();
    await expect(screen(page, 'lobby')).toHaveCount(1);
    await page.waitForTimeout(150);
    await ctl(page, 'lobby.leave').click();
    await expect(screen(page, 'online')).toHaveCount(1);
    await expect.poll(() => polls(page)).toBe(before + 1);
  });
});

test('D-052 application dispatch sends directory/quickJoin, refreshes changed identities, and reopens the same room', async ({ page }) => {
  const requests: NetClientMsg[] = [];
  await page.routeWebSocket('**/ws', (socket) => {
    let name = '';
    socket.onMessage((raw) => {
      if (typeof raw !== 'string') return;
      const request = parseClientMessage(raw);
      if (!request) return;
      requests.push(request);
      if (request.type === 'hello') {
        name = request.name;
        socket.send(JSON.stringify({ type: 'welcome', id: 3, resumeToken: 'a'.repeat(32), serverMs: Date.now(), limits: { maxPlayers: 20, hz: 20 } }));
      } else if (request.type === 'listRooms') {
        socket.send(JSON.stringify({ type: 'rooms', rooms: [{ code: 'APX27', track: 'istanbul', laps: 5, weather: 'dry', tod: 'day', humans: 1, capacity: 20, state: 'lobby', owner: 'Selin' }] }));
      } else if (request.type === 'quickJoin') {
        socket.send(JSON.stringify({ type: 'room', code: 'APX27', ownerId: 3, phase: 'lobby',
          settings: { visibility: 'public', trackId: 'istanbul', laps: 5, weather: 'dry', tod: 'day', aiCount: 0, difficulty: 55 },
          players: [{ id: 3, name, teamId: 'anka', driverIdx: 0, ready: false, connected: true, pingMs: 0 }] }));
      }
    });
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(screen(page, 'title')).toHaveCount(1);
  await page.waitForTimeout(250);
  await page.keyboard.press('Enter');
  await expect(screen(page, 'mainMenu')).toHaveCount(1);
  await page.waitForTimeout(250);
  await ctl(page, 'main.online').click();
  await expect(screen(page, 'online')).toHaveCount(1);
  await ctl(page, 'online.name').fill('Deniz');
  await expect(ctl(page, 'online.room.APX27')).toBeVisible({ timeout: 15000 });
  expect(requests).toContainEqual(expect.objectContaining({ type: 'hello', v: PROTOCOL_VERSION, name: 'Deniz' }));
  await ctl(page, 'online.quickJoin').click();
  await expect(screen(page, 'lobby')).toHaveCount(1);
  await page.waitForTimeout(250);
  await ctl(page, 'lobby.leave').click();
  await expect(screen(page, 'online')).toHaveCount(1);
  await ctl(page, 'online.name').fill('Ece');
  await expect.poll(() => requests.find((r) => r.type === 'hello' && r.name === 'Ece'), { timeout: 15000 }).toBeTruthy();
  const renamed = requests.find((r) => r.type === 'hello' && r.name === 'Ece');
  expect(renamed).not.toHaveProperty('resume');
  await expect(ctl(page, 'online.quickJoin')).toHaveAttribute('aria-disabled', 'false');
  await ctl(page, 'online.quickJoin').click();
  await expect(screen(page, 'lobby')).toHaveCount(1);
  await expect(screen(page, 'lobby')).toContainText('Ece');
  expect(requests.filter((r) => r.type === 'quickJoin')).toHaveLength(2);
});
