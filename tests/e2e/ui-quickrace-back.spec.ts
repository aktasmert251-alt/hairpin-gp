import { mkdir, writeFile } from 'node:fs/promises';
import { expect, test } from '../helpers/fixtures';
import { UI_BASE, Ui } from '../helpers/uiDriver';
import { seedSettings } from '../helpers/uiDriver';
import { TEAMS } from '../../src/data/teams';
import { RACE_TRACKS } from '../../src/data/tracks';

test.use({ baseURL: UI_BASE });

// Capture the actual browser key events and every rendered frame, including transition frames.
async function record(ui: Ui): Promise<() => Promise<void>> {
  await ui.page.evaluate(() => {
    const records: unknown[] = [];
    const w = window as unknown as { __quickRaceTrace: unknown[]; __stopQuickRaceTrace(): void };
    w.__quickRaceTrace = records;
    const snapshot = () => {
      const api = (window as unknown as { __APEX__: { ui: { screen(): string; focusId(): string } } }).__APEX__;
      const screen = api.ui.screen();
      return { time: performance.now(), screen, focusId: api.ui.focusId(), selectedTeam: document.querySelector<HTMLElement>('.m-tile.is-sel')?.dataset.focusId, values: [...document.querySelectorAll<HTMLElement>(`.apx-screen[data-screen="${screen}"] .m-row`)].map(e => ({ id: e.dataset.focusId, value: e.querySelector('.val, .v')?.textContent ?? e.getAttribute('aria-checked') })) };
    };
    const key = (e: KeyboardEvent) => records.push({ kind: 'keydown', code: e.code, repeat: e.repeat, ...snapshot() });
    window.addEventListener('keydown', key, true);
    let frame = 0;
    const tick = () => { records.push({ kind: 'frame', ...snapshot() }); frame = requestAnimationFrame(tick); };
    tick();
    w.__stopQuickRaceTrace = () => { cancelAnimationFrame(frame); window.removeEventListener('keydown', key, true); };
  });
  return async () => {
    const trace = await ui.page.evaluate(() => {
      const w = window as unknown as { __quickRaceTrace: unknown[]; __stopQuickRaceTrace(): void };
      w.__stopQuickRaceTrace();
      return w.__quickRaceTrace;
    });
    await mkdir('test-results/screens/codex3', { recursive: true });
    await writeFile(`test-results/screens/codex3/${test.info().title.split(' ')[0]}-trace.json`, JSON.stringify(trace, null, 2));
    await test.info().attach('frame-trace', { body: JSON.stringify(trace), contentType: 'application/json' });
  };
}

test('QB-01 fresh back presses during transitions each go back exactly one step', async ({ apex, page }) => {
  const ui = new Ui(apex, page);
  await ui.toMainMenu();
  await ui.goTo('assists');
  await ui.hover('assists.preset');
  const stop = await record(ui);
  try {
    await page.screenshot({ path: 'test-results/screens/codex3/back-before.png' });
    await ui.key('Escape', 0);
    await ui.key('Backspace', 0);
    await ui.key('Escape', 350);
    await page.screenshot({ path: 'test-results/screens/codex3/back-after.png' });
    await ui.waitScreen('raceConditions', 1000);
    await ui.expectFocus('raceConditions.cta');
    await ui.key('Escape', 300);
    await ui.waitScreen('mainMenu');
    await ui.expectFocus('main.quickRace');
  } finally { await stop(); }
});

test('QB-02 selected team is focused when returning through conditions', async ({ apex, page }) => {
  const ui = new Ui(apex, page);
  await ui.toMainMenu();
  await ui.goTo('teamSelect');
  const stop = await record(ui);
  try {
    await ui.key('Home');
    await ui.key('ArrowRight');
    await ui.key('ArrowDown');
    const selected = await ui.focusId();
    await ui.key('Enter');
    const driver = await ui.stepValue('race.driver');
    await page.screenshot({ path: 'test-results/screens/codex3/team-back-before.png' });
    await ui.key('Backspace', 300);
    await ui.waitScreen('raceConditions');
    await ui.key('Enter', 350);
    await ui.waitScreen('teamSelect');
    await page.screenshot({ path: 'test-results/screens/codex3/team-back-after.png' });
    await ui.expectFocus(selected!);
    expect(await ui.stepValue('race.driver')).toBe(driver);
    await ui.key('ArrowLeft');
    await ui.expectFocus('team.vortex');
    await ui.key('KeyD');
    await ui.expectFocus(selected!);
  } finally { await stop(); }
});

test('QB-03 back restores rows and values; arrows, letters, rapid presses and holds keep their direction', async ({ apex, page }) => {
  test.setTimeout(120_000);
  const ui = new Ui(apex, page);
  await ui.toMainMenu();
  await ui.goTo('raceConditions');
  const stop = await record(ui);
  const hold = async (code: string) => {
    await page.keyboard.down(code);
    await page.waitForTimeout(300);
    for (let i = 0; i < 8; i++) { await page.keyboard.down(code); await page.waitForTimeout(33); }
    await page.keyboard.up(code);
  };
  try {
    await ui.hover('race.tod');
    await ui.focusViaKeys('race.laps');
    await hold('ArrowLeft');
    expect((await ui.stepIndex('race.laps')).index).toBe(0);
    for (const k of ['ArrowRight', 'KeyA', 'KeyD', 'ArrowLeft']) await ui.key(k, 0);
    expect((await ui.stepIndex('race.laps')).index).toBe(0);
    await ui.expectFocus('race.laps');
    await hold('KeyD');
    const max = await ui.stepIndex('race.laps');
    expect(max.index).toBe(max.count - 1);
    const laps = await ui.stepValue('race.laps');
    const tod = await ui.stepValue('race.tod');
    await ui.key('End');
    await ui.key('Enter', 300);
    await ui.key('Home');
    for (const pair of [['ArrowRight', 'ArrowLeft'], ['KeyD', 'KeyA']]) {
      await ui.key(pair[0]!, 0);
      await ui.key(pair[1]!, 0);
      await ui.expectFocus('team.anka');
      await hold(pair[1]!);
      await ui.expectFocus('team.anka');
    }
    await ui.key('ArrowRight');
    await ui.key('Enter'); // choose team and focus its driver
    await ui.key('KeyD');
    const driver = await ui.stepValue('race.driver');
    await ui.key('Enter', 300); // driver advances to settings
    await ui.hover('race.opponents');
    await ui.key('ArrowLeft');
    const opponents = await ui.sliderValue('race.opponents');
    await ui.key('End');
    await ui.key('Enter', 300);
    await ui.key('Backspace', 300);
    await ui.expectFocus('raceSettings.cta');
    expect(await ui.sliderValue('race.opponents')).toBe(opponents);
    await ui.key('Escape', 300);
    await ui.expectFocus('race.driver');
    expect(await ui.stepValue('race.driver')).toBe(driver);
    await ui.key('Backspace', 300);
    await ui.expectFocus('raceConditions.cta');
    expect(await ui.stepValue('race.laps')).toBe(laps);
    expect(await ui.stepValue('race.tod')).toBe(tod);
    await ui.key('Escape', 300);
    await ui.expectFocus('main.quickRace');
  } finally { await stop(); }
});

for (const lang of ['tr', 'en']) {
  test(`D-059 quick race ${lang}: Off runs solo, persists, and On restores the last count`, async ({ apex, page }) => {
    test.setTimeout(180_000);
    await seedSettings(page, { lang, ui: { animations: 'off' } });
    const ui = new Ui(apex, page);
    await ui.toMainMenu();
    await ui.goTo('raceSettings');
    const toggle = page.locator('[data-active="1"] [data-focus-id="race.aiEnabled"]');
    const count = page.locator('[data-active="1"] [data-focus-id="race.opponents"]');
    await expect(toggle).toHaveAccessibleName(lang === 'tr' ? 'Yapay zekâ rakipler' : 'AI opponents');
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(await ui.sliderValue('race.opponents')).toBe(19);
    await ui.hover('race.opponents');
    for (let i = 0; i < 12; i++) await page.keyboard.press('ArrowLeft');
    expect(await ui.sliderValue('race.opponents')).toBe(7);
    await ui.hover('race.grid');
    for (let i = 0; i < 8; i++) await page.keyboard.press('ArrowRight');
    expect(await ui.stepValue('race.grid')).toBe('P8');
    await ui.hover('race.aiEnabled');
    await ui.key('ArrowLeft');
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await expect(count).toBeHidden();
    await expect(count).toHaveAttribute('aria-disabled', 'true');
    expect((await ui.stepIndex('race.grid')).count).toBe(2); // random or the sole P1
    await ui.key('ArrowDown');
    await ui.expectFocus('race.difficulty');
    await ui.key('Home');
    await ui.key('ArrowRight');
    await expect(count).toBeVisible();
    expect(await ui.sliderValue('race.opponents')).toBe(7);
    await ui.key('Enter'); // Off again; save through the existing start flow
    await ui.key('End');
    await ui.key('Enter', 300);
    await ui.waitScreen('assists');
    await ui.key('End');
    await ui.key('Enter', 300);
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('apexgp:v1:lastRaceSetup') ?? '{}')))
      .toMatchObject({ aiCount: 0, lastAiCount: 7, gridPos: 'random' });
    await apex.waitForState('session', 90_000);
    await expect.poll(async () => (await ui.hud()).tower.length).toBe(1);
    await ui.toMainMenu();
    await ui.goTo('raceSettings');
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await expect(count).toBeHidden();
    await ui.key('ArrowRight');
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(await ui.sliderValue('race.opponents')).toBe(7);
  });
}

test('QB-04 every available track has its own outline and PB in both selection screens', async ({ apex, page }) => {
  test.setTimeout(120_000);
  const ui = new Ui(apex, page);
  await ui.toMainMenu();
  await page.evaluate((tracks) => {
    for (const [i, id] of tracks.entries()) {
      localStorage.setItem(`apexgp:v1:tt:${id}`, JSON.stringify({ pbMs: 90000 + i * 1000, sectors: [30000, 30000, 30000], top10: [] }));
    }
  }, RACE_TRACKS);
  for (const screen of ['raceConditions', 'ttSetup'] as const) {
    await ui.goTo(screen);
    const trackRow = screen === 'ttSetup' ? 'tt.track' : 'race.track';
    await ui.key('Home');
    const count = (await ui.stepIndex(trackRow)).count;
    expect(count, 'every registered race track is selectable').toBe(RACE_TRACKS.length);
    const paths = new Set<string>();
    for (let i = 0; i < count; i++) {
      await ui.key('ArrowLeft', 0);
    }
    for (let i = 0; i < count; i++) {
      const panel = page.locator(`[data-screen="${screen}"] .m-track-detail:not([aria-hidden])`);
      await expect(panel).toHaveCount(1);
      await expect(panel.locator('h2')).toHaveText(await ui.stepValue(trackRow));
      await expect(panel.locator('.sector')).toHaveCount(3);
      await expect(panel.locator('svg .finish')).toHaveCount(1);
      await expect(panel.locator('svg .pit')).toBeVisible();
      expect(await panel.locator('svg text').count()).toBeGreaterThan(0);
      await expect(panel.locator('.pb strong')).toHaveText(`1:3${i}.000`);
      paths.add((await panel.locator('.outline').getAttribute('d'))!);
      await expect(page.locator('.m-bg')).toBeVisible();
      await page.waitForTimeout(250);
      const id = await panel.getAttribute('data-track-id');
      await page.screenshot({ path: `test-results/screens/codex3/${screen}-${id}.png` });
      await ui.key('ArrowRight', 0);
    }
    expect(paths.size).toBe(count);
    await ui.key('Escape', 350);
  }
});

test('QB-05 team traits follow keyboard and mouse focus, selection and back', async ({ apex, page }) => {
  const ui = new Ui(apex, page);
  await ui.toMainMenu();
  await ui.goTo('teamSelect');
  const panel = page.locator('[data-screen="teamSelect"] .m-team-traits');
  for (const team of TEAMS) {
    await ui.hover(`team.${team.id}`);
    await expect(panel).toHaveAttribute('data-team-id', team.id);
    await expect(panel.locator('h2')).toHaveText(team.name);
    const meters = panel.getByRole('meter');
    await expect(meters).toHaveCount(6);
    for (const [i, rating] of Object.values(team.traits).entries()) await expect(meters.nth(i)).toHaveAttribute('aria-valuenow', String(rating));
    await expect(panel.locator('.m-traits-summary')).toContainText('Güçlü:');
    await expect(panel.locator('.m-traits-summary')).toContainText('Zayıf:');
    expect(await panel.locator('.m-pace .on').count()).toBeGreaterThanOrEqual(1);
    await page.screenshot({ path: `test-results/screens/codex3/traits-${team.id}.png` });
  }
  await ui.key('Home');
  await ui.key('KeyD');
  await expect(panel).toHaveAttribute('data-team-id', TEAMS[1]!.id);
  await ui.key('Enter');
  await ui.key('Enter', 300);
  await ui.key('Escape', 300);
  await expect(panel).toHaveAttribute('data-team-id', TEAMS[1]!.id);
});

test('QB-06 English and reduced motion keep track and trait information readable', async ({ apex, page }) => {
  await seedSettings(page, { lang: 'en', ui: { animations: 'off' } });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const ui = new Ui(apex, page);
  await ui.toMainMenu();
  await ui.goTo('raceConditions');
  await ui.key('ArrowRight', 0);
  await ui.key('ArrowLeft', 0);
  await page.waitForTimeout(140);
  await expect(page.locator('[data-screen="raceConditions"] .m-track-detail')).toHaveCount(1);
  await page.screenshot({ path: 'test-results/screens/codex3/track-en-reduced.png' });
  await ui.key('End');
  await ui.key('Enter', 300);
  await expect(page.getByRole('meter', { name: 'Engine power' })).toBeVisible();
  await expect(page.locator('.m-traits-summary')).toContainText('Strong:');
  await page.screenshot({ path: 'test-results/screens/codex3/traits-en-reduced.png' });
});

test('QB-07 a held arrow stays on its original screen; a fresh key works immediately after back', async ({ apex, page }) => {
  const ui = new Ui(apex, page);
  await ui.toMainMenu();
  await ui.goTo('raceConditions');
  await ui.key('ArrowRight');
  const track = (await ui.stepIndex('race.track')).index;
  await ui.key('End');
  await ui.key('Enter', 300);
  const stop = await record(ui);
  try {
    await page.keyboard.down('ArrowLeft');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Home');
    for (let i = 0; i < 8; i++) { await page.keyboard.down('ArrowLeft'); await page.waitForTimeout(33); }
    await page.keyboard.up('ArrowLeft');
    await ui.expectFocus('race.track');
    expect((await ui.stepIndex('race.track')).index).toBe(track);
    await ui.key('ArrowLeft', 0);
    expect((await ui.stepIndex('race.track')).index).toBe(Math.max(0, track - 1));
  } finally { await stop(); }
});
