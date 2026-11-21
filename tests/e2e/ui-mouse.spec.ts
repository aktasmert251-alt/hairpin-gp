// UI Tester: mouse inventory of every menu screen (hover focus, click activate, chevrons, toggle segments, slider click + drag, tab click,
// wheel, "ESC GERI" hint), see docs/qa/test-ui-controls.md matrix section B. Commit 6e665e3 added the pointer layer (src/ui/pointer.ts).
// Run: APEX_BASE_URL=http://localhost:5183 npx playwright test tests/e2e/ui-mouse.spec.ts --project=e2e

import { expect, test } from '../helpers/fixtures';
import { UI_BASE, Ui } from '../helpers/uiDriver';

test.use({ baseURL: UI_BASE });

const CHEV_L = '.c-step > svg:nth-of-type(1)';
const CHEV_R = '.c-step > svg:nth-of-type(2)';
const SEG_OFF = '.c-seg > span:nth-of-type(1)';
const SEG_ON = '.c-seg > span:nth-of-type(2)';
const TRACK = '.c-slider .tr';
const TABS = ['graphics', 'audio', 'controls', 'assists', 'hud', 'language', 'interface'] as const;

/** Mouse path from the title to a menu screen (title click + item clicks only). */
async function mouseTo(ui: Ui, target: 'ttSetup' | 'raceConditions' | 'teamSelect' | 'raceSettings' | 'assists' | 'settings' | 'credits'): Promise<void> {
  await ui.apex.open('/', 'sceneReady');
  await ui.page.waitForTimeout(400);
  await ui.page.mouse.click(960, 540);
  await ui.apex.waitForState('menu', 15_000);
  await ui.waitScreen('mainMenu');
  await ui.page.waitForTimeout(300);
  const entry = { ttSetup: 'main.timeTrial', settings: 'main.settings', credits: 'main.credits' }[target as string] ?? 'main.quickRace';
  await ui.click(entry, '', 0.5, 500);
  const chain = ['raceConditions', 'teamSelect', 'raceSettings', 'assists'];
  if (chain.includes(target)) {
    await ui.waitScreen('raceConditions');
    for (let i = 0; i < chain.indexOf(target); i++) {
      await ui.click(`${chain[i]}.cta`, '', 0.5, 500);
      await ui.waitScreen(chain[i + 1]!);
    }
  } else await ui.waitScreen(target);
  await ui.page.waitForTimeout(300);
}

test.describe('UI mouse: title and main menu', () => {
  test('UM-01 title: a click anywhere proceeds to the main menu exactly once', async ({ apex, page }) => {
    const ui = new Ui(apex, page);
    await apex.open('/', 'sceneReady');
    await page.waitForTimeout(400);
    await page.mouse.click(1500, 300);
    await apex.waitForState('menu', 15_000);
    await ui.waitScreen('mainMenu');
    await page.waitForTimeout(600);
    expect(await ui.screen(), 'one click = one transition').toBe('mainMenu');
    expect(await ui.markedId(), 'first item highlighted').toBe('main.timeTrial');
    await ui.key('ArrowDown');
    expect(await ui.markedId(), 'keyboard still works after a mouse entry').toBe('main.quickRace');
  });

  // UIT-04 (P2, Grafik-UI): focus() is set in the pointerdown handler (title go() / pointerFocus), but the browser's mousedown default action then
  // moves DOM focus to <body> when the press lands on a non-focusable area (title page, the pause dim, empty menu space). The .is-focus marker
  // stays, `document.activeElement` / ui.focusId() become null (screen readers lose the position, :focus-visible outlines vanish).
  test('UM-01b UIT-04: pressing the mouse on empty space keeps DOM focus on the focused item', async ({ apex, page }) => {
    const ui = new Ui(apex, page);
    await apex.open('/', 'sceneReady');
    await page.waitForTimeout(400);
    await page.mouse.click(1500, 300);
    await ui.waitScreen('mainMenu');
    await page.waitForTimeout(500);
    await ui.shot('uit-04-focus-lost-after-title-click');
    expect(await ui.focusId(), 'DOM focus after entering the main menu by mouse').toBe('main.timeTrial');
  });

  test('UM-02 main menu: hover moves the (single) focus, hover alone never activates, click activates once, back hint returns', async ({ apex, page }) => {
    const ui = new Ui(apex, page);
    await mouseTo(ui, 'credits').then(() => ui.clickHint('back'));
    await ui.waitScreen('mainMenu');
    await ui.expectFocus('main.credits', 'restored after returning via the hint');
    for (const id of ['main.quickRace', 'main.settings', 'main.timeTrial', 'main.credits']) {
      await ui.hover(id);
      await ui.expectFocus(id, 'hover');
    }
    await ui.page.mouse.move(1500, 900, { steps: 4 });
    await page.waitForTimeout(200);
    await ui.expectFocus('main.credits', 'moving over empty space keeps the focus');
    expect(await ui.screen(), 'hover must not activate').toBe('mainMenu');
    await ui.click('main.quickRace', '', 0.2);
    await ui.waitScreen('raceConditions');
    await page.waitForTimeout(500);
    expect(await ui.screen(), 'a single click activates once').toBe('raceConditions');
    await ui.clickHint('back');
    await ui.waitScreen('mainMenu');
    await ui.expectFocus('main.quickRace');
  });

  test('UM-03 main menu: every destination opens by click and the "back" hint (ESC) returns from each', async ({ apex, page }) => {
    const ui = new Ui(apex, page);
    await mouseTo(ui, 'credits');
    await ui.clickHint('back');
    for (const [id, scr] of [['main.timeTrial', 'ttSetup'], ['main.quickRace', 'raceConditions'], ['main.settings', 'settings'], ['main.credits', 'credits']] as const) {
      await ui.click(id, '', 0.5, 500);
      await ui.waitScreen(scr);
      await page.waitForTimeout(300);
      expect(await ui.screen()).toBe(scr);
      expect(await page.locator('.apx-screen[data-active="1"] [data-hint="back"]').count(), `${scr} shows a back hint`).toBe(1);
      await ui.clickHint('back');
      await ui.waitScreen('mainMenu');
    }
  });
});

test.describe('UI mouse: race flow', () => {
  test('UM-04 stepper: chevrons step (left/right), ends clamp, row body = Enter (wraps), hover focuses the row first', async ({ apex, page }) => {
    const ui = new Ui(apex, page);
    await mouseTo(ui, 'raceConditions');
    await ui.expectFocus('race.track', 'first row (PIST stepper)');
    expect((await ui.stepIndex('race.tod')).index).toBe(0);
    await ui.click('race.tod', CHEV_L, 0.5, 200);
    expect((await ui.stepIndex('race.tod')).index, 'left chevron at the start clamps').toBe(0);
    await ui.click('race.tod', CHEV_R, 0.5, 200);
    expect((await ui.stepIndex('race.tod')).index).toBe(1);
    await ui.click('race.tod', CHEV_R, 0.5, 200);
    await ui.click('race.tod', CHEV_R, 0.5, 200);
    expect((await ui.stepIndex('race.tod')).index, 'right chevron at the end clamps').toBe(2);
    await ui.click('race.tod', CHEV_L, 0.5, 200);
    expect((await ui.stepIndex('race.tod')).index).toBe(1);
    // click on another row: it focuses and applies the click in one go
    await ui.click('race.weather', CHEV_R, 0.5, 200);
    await ui.expectFocus('race.weather', 'click focuses the row it hits');
    expect((await ui.stepIndex('race.weather')).index, 'chevron click on an unfocused row steps once').toBe(1);
    expect((await ui.stepIndex('race.tod')).index, 'other row untouched').toBe(1);
    // row body = Enter: advances; on the last value wraps to the first
    const l0 = (await ui.stepIndex('race.laps')).index;
    await ui.click('race.laps', '.lbl', 0.5, 200);
    expect((await ui.stepIndex('race.laps')).index, 'label click = Enter (+1, once)').toBe(l0 + 1);
    for (let i = 0; i < 4 - (l0 + 1); i++) await ui.click('race.laps', '.lbl', 0.5, 150);
    expect((await ui.stepIndex('race.laps')).index).toBe(4);
    await ui.click('race.laps', '.lbl', 0.5, 150);
    expect((await ui.stepIndex('race.laps')).index, 'Enter-like click on the last value wraps').toBe(0);
    await ui.shot('um-04-conditions');
  });

  test('UM-05 team select: hover focuses a tile, click selects it (and moves to the driver row), driver chevrons, CTA and back hint', async ({ apex, page }) => {
    const ui = new Ui(apex, page);
    await mouseTo(ui, 'teamSelect');
    const tiles = await page.locator('.apx-screen[data-active="1"] .m-tile').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.focusId!));
    expect(tiles.length).toBe(10);
    await ui.hover(tiles[3]!);
    await ui.expectFocus(tiles[3]!, 'hover tile');
    expect(await page.locator('.apx-screen[data-active="1"] .m-tile.is-sel').getAttribute('data-focus-id')).not.toBe(tiles[3]);
    await ui.click(tiles[3]!);
    expect(await page.locator('.apx-screen[data-active="1"] .m-tile.is-sel').getAttribute('data-focus-id'), 'click selects').toBe(tiles[3]);
    await ui.expectFocus('race.driver', 'selecting moves focus to the driver row');
    // (the value shown right after a team change is stale: UIT-05, see ui-keys UK-06c)
    await ui.click('race.driver', CHEV_R, 0.5, 200);
    const dR = await ui.stepValue('race.driver');
    await ui.click('race.driver', CHEV_L, 0.5, 200);
    const dL = await ui.stepValue('race.driver');
    expect(dL, 'driver chevrons step between the two drivers').not.toBe(dR);
    expect(await ui.screen()).toBe('teamSelect');
    await ui.hover(tiles[7]!);
    await ui.expectFocus(tiles[7]!);
    await ui.click('teamSelect.cta', '', 0.5, 500);
    await ui.waitScreen('raceSettings');
    await ui.clickHint('back');
    await ui.waitScreen('teamSelect');
  });

  test('UM-06 sliders: click on the track jumps, drag scrubs, release stops, values snap to the step, ends clamp', async ({ apex, page }) => {
    const ui = new Ui(apex, page);
    await mouseTo(ui, 'raceSettings');
    const track = await ui.box('race.opponents', TRACK);
    const at = (f: number) => ({ x: track.x + track.w * f, y: track.y + track.h / 2 });
    await ui.click('race.opponents', TRACK, 0, 200);
    expect(await ui.sliderValue('race.opponents'), 'click at the left end').toBe(1);
    await ui.click('race.opponents', TRACK, 1, 200);
    expect(await ui.sliderValue('race.opponents'), 'click at the right end').toBe(19);
    await ui.click('race.opponents', TRACK, 0.5, 200);
    expect([9, 10]).toContain(await ui.sliderValue('race.opponents'));
    // drag
    await page.mouse.move(at(0.5).x, at(0.5).y);
    await page.mouse.down();
    await page.mouse.move(at(0.9).x, at(0.9).y, { steps: 8 });
    expect(await ui.sliderValue('race.opponents'), 'dragged to 90 %').toBeGreaterThanOrEqual(16);
    await page.mouse.move(at(0.1).x + 0, at(0.1).y + 80, { steps: 10 }); // leaving the track vertically keeps scrubbing (pointer capture)
    expect(await ui.sliderValue('race.opponents'), 'drag follows x only').toBeLessThanOrEqual(3);
    await page.mouse.move(track.x - 300, at(0).y, { steps: 6 });
    expect(await ui.sliderValue('race.opponents'), 'dragging far left clamps at min').toBe(1);
    await page.mouse.up();
    await page.mouse.move(at(1).x, at(1).y, { steps: 4 });
    expect(await ui.sliderValue('race.opponents'), 'no scrubbing after release').toBe(1);
    // difficulty snaps to 5
    await ui.click('race.difficulty', TRACK, 0.37, 200);
    const diff = await ui.sliderValue('race.difficulty');
    expect(diff % 5, 'step 5').toBe(0);
    expect(diff).toBeGreaterThan(30);
    expect(diff).toBeLessThan(50);
    await ui.expectFocus('race.difficulty', 'slider click focuses the row');
    // grid list follows the opponent count after pointer scrubs
    await ui.click('race.opponents', TRACK, 0, 200);
    await ui.click('race.opponents', TRACK, 0.1, 200);
    await ui.hover('race.grid');
    expect((await ui.stepIndex('race.grid')).count).toBe((await ui.sliderValue('race.opponents')) + 2);
    // read-only row: hover focuses, click does nothing
    await ui.click('race.twoCompound', '', 0.5, 200);
    expect(await ui.screen()).toBe('raceSettings');
    await ui.shot('um-06-sliders');
  });

  test('UM-07 assists: toggle segments set (not flip), label click flips, preset chevrons apply, mouse-only start -> session', async ({ apex, page }) => {
    test.setTimeout(180_000);
    const ui = new Ui(apex, page);
    await mouseTo(ui, 'assists');
    const v0 = await ui.toggleValue('assists.steering');
    expect(v0).toBe(true);
    await ui.click('assists.steering', SEG_ON, 0.5, 200);
    expect(await ui.toggleValue('assists.steering'), 'clicking ON when on keeps it on').toBe(true);
    await ui.click('assists.steering', SEG_OFF, 0.5, 200);
    expect(await ui.toggleValue('assists.steering'), 'OFF segment sets off').toBe(false);
    await ui.click('assists.steering', SEG_OFF, 0.5, 200);
    expect(await ui.toggleValue('assists.steering'), 'clicking OFF when off keeps it off').toBe(false);
    await ui.click('assists.steering', SEG_ON, 0.5, 200);
    expect(await ui.toggleValue('assists.steering')).toBe(true);
    await ui.click('assists.abs', '.lbl', 0.5, 200);
    expect(await ui.toggleValue('assists.abs'), 'label click flips').toBe(false);
    expect((await ui.stepIndex('assists.preset')).count, 'custom preset appears after the edit').toBe(4);
    await ui.click('assists.abs', '.lbl', 0.5, 200);
    expect(await ui.toggleValue('assists.abs')).toBe(true);
    await ui.click('assists.preset', CHEV_L, 0.5, 200);
    await ui.click('assists.preset', CHEV_L, 0.5, 200);
    await ui.click('assists.preset', CHEV_L, 0.5, 200);
    await ui.click('assists.preset', CHEV_R, 0.5, 200);
    expect(await ui.screen()).toBe('assists');
    await ui.click('assists.cta', '', 0.5, 600);
    await apex.waitForState('session', 90_000);
    await apex.waitForPhase('running', 60_000);
    await page.waitForTimeout(500);
    expect(await ui.screen()).toBeNull();
    expect(await ui.simRunning(), 'sim runs after a mouse-only start').toBe(true);
  });

  test('UM-08 time trial setup: chevrons, hover focus, GO click starts a TT session', async ({ apex, page }) => {
    test.setTimeout(150_000);
    const ui = new Ui(apex, page);
    await mouseTo(ui, 'ttSetup');
    for (const id of ['tt.team', 'tt.tyre', 'tt.tod', 'tt.weather', 'tt.ghost']) {
      await ui.hover(id);
      await ui.expectFocus(id, 'hover');
      const v0 = await ui.stepValue(id);
      await ui.click(id, CHEV_R, 0.5, 200);
      const v1 = await ui.stepValue(id);
      if (!(await ui.stepIndex(id)).index && v0 === v1) throw new Error(`${id}: right chevron did not step`);
    }
    await ui.hover('tt.go');
    await ui.expectFocus('tt.go');
    await ui.click('tt.go', '', 0.5, 600);
    await apex.waitForState('session', 90_000);
    expect((await apex.race())!.mode).toBe('timeTrial');
  });
});

test.describe('UI mouse: pause, dialogs, results', () => {
  test('UM-09 pause: hover focuses, click Resume resumes; Restart/Retire/Quit open the confirm dialog, only its buttons react, NO closes', async ({ apex, page }) => {
    test.setTimeout(200_000);
    const ui = new Ui(apex, page);
    await ui.startGame({ assists: 'default', ai: 3 });
    await ui.key('Escape', 500);
    await ui.waitScreen('pause');
    for (const id of ['pause.restart', 'pause.settings', 'pause.retire', 'pause.quit', 'pause.resume']) {
      await ui.hover(id);
      await ui.expectFocus(id, 'hover');
    }
    await ui.click('pause.resume', '', 0.5, 500);
    await ui.waitScreen(null);
    expect(await ui.simRunning(), 'click Resume resumes the sim').toBe(true);
    await ui.key('Escape', 500);
    await ui.waitScreen('pause');
    // settings via click and back via the hint
    await ui.click('pause.settings', '', 0.5, 500);
    await ui.waitScreen('settings');
    await ui.clickHint('back');
    await ui.waitScreen('pause');
    // confirm dialog
    await ui.click('pause.quit', '', 0.5, 400);
    await ui.expectFocus('pause.confirm.no', 'dialog default');
    await ui.page.mouse.click(300, 700); // dim over the list
    await page.waitForTimeout(300);
    expect(await ui.markedId(), 'click on the dim does not move the highlight (DOM focus loss: UIT-04)').toBe('pause.confirm.no');
    expect(await ui.screen()).toBe('pause');
    const quitBox = await ui.box('pause.resume');
    await page.mouse.move(quitBox.x + 40, quitBox.y + 20, { steps: 3 });
    await page.waitForTimeout(200);
    expect(await ui.markedId(), 'hover over the dimmed list does not steal the highlight').toBe('pause.confirm.no');
    await ui.hover('pause.confirm.yes');
    await ui.expectFocus('pause.confirm.yes');
    await ui.click('pause.confirm.no', '', 0.5, 400);
    await ui.expectFocus('pause.quit', 'NO closes, focus back on the item');
    expect(await ui.simRunning(), 'still paused').toBe(false);
    await ui.click('pause.retire', '', 0.5, 400);
    await ui.click('pause.confirm.yes', '', 0.5, 800);
    await ui.waitScreen('results');
  });

  test('UM-10 results: hover focuses both buttons, Restart click starts a new session, Continue click returns to the menu', async ({ apex, page }) => {
    test.setTimeout(240_000);
    const ui = new Ui(apex, page);
    await ui.startGame({ assists: 'default', ai: 3 });
    await ui.key('Escape', 500);
    await ui.waitScreen('pause');
    await ui.click('pause.retire', '', 0.5, 400);
    await ui.click('pause.confirm.yes', '', 0.5, 800);
    await ui.waitScreen('results');
    await page.waitForTimeout(900);
    await ui.hover('results.menu');
    await ui.expectFocus('results.menu', 'hover');
    await ui.hover('results.restart');
    await ui.expectFocus('results.restart', 'hover');
    // table rows are not interactive
    await page.mouse.click(900, 400);
    expect(await ui.screen()).toBe('results');
    await ui.click('results.restart', '', 0.5, 600);
    await apex.waitForState('session', 90_000);
    await ui.key('Escape', 600);
    await ui.waitScreen('pause');
    await ui.click('pause.retire', '', 0.5, 400);
    await ui.click('pause.confirm.yes', '', 0.5, 800);
    await ui.waitScreen('results');
    await page.waitForTimeout(700);
    await ui.click('results.menu', '', 0.5, 700);
    await ui.expectFocus('results.confirm.no');
    await ui.click('results.confirm.yes', '', 0.5, 700);
    await ui.waitScreen('mainMenu');
  });

  test('UM-11 time trial: restart-lap click resumes, End session -> TT results buttons, Main menu -> main menu (QA-19-03)', async ({ apex, page }) => {
    test.setTimeout(240_000);
    const ui = new Ui(apex, page);
    await ui.startGame({ mode: 'tt', assists: 'default' });
    await ui.key('Escape', 500);
    await ui.waitScreen('pause');
    await ui.click('pause.restartLap', '', 0.5, 600);
    await ui.waitScreen(null);
    expect(await ui.simRunning()).toBe(true);
    await ui.key('Escape', 500);
    await ui.waitScreen('pause');
    await ui.click('pause.retire', '', 0.5, 400);
    await ui.click('pause.confirm.yes', '', 0.5, 800);
    await ui.waitScreen('ttResults');
    await page.waitForTimeout(700);
    await ui.hover('ttResults.menu');
    await ui.expectFocus('ttResults.menu');
    await ui.click('ttResults.retry', '', 0.5, 700);
    await apex.waitForState('session', 90_000);
    await ui.key('Escape', 500);
    await ui.waitScreen('pause');
    await ui.click('pause.quit', '', 0.5, 400);
    await ui.click('pause.confirm.yes', '', 0.5, 800);
    await ui.waitScreen('mainMenu');
  });
});

test.describe('UI mouse: known defects', () => {
  // UIT-04 (see UM-01b): the native mousedown focus also lands on a disabled <button> (aria-disabled) although the FocusList refuses it, so
  // DOM focus (ui.focusId) and the visible highlight disagree and a later Enter/Space keydown on that element is judged by the app, not the DOM.
  test('UM-11b UIT-04: pressing the mouse on a disabled item does not move DOM focus to it', async ({ apex, page }) => {
    test.setTimeout(120_000);
    const ui = new Ui(apex, page);
    // The TT pause has no disabled item any more (QA-19-03); the race-settings opponent count is disabled with AI off.
    await ui.toMainMenu();
    await ui.goTo('raceSettings');
    await ui.click('race.aiEnabled', '', 0.25, 300);
    if ((await page.locator('[data-focus-id="race.opponents"]').getAttribute('aria-disabled')) !== 'true') await ui.click('race.aiEnabled', '', 0.75, 300);
    expect(await page.locator('[data-focus-id="race.opponents"]').getAttribute('aria-disabled')).toBe('true');
    await ui.hover('race.aiEnabled');
    await ui.hover('race.opponents', '', 0.5, 1);
    await ui.expectFocus('race.aiEnabled', 'hover over a disabled item does not focus it');
    const rb = await ui.box('race.opponents');
    await page.mouse.click(rb.x + rb.w / 2, rb.y + rb.h / 2);
    await page.waitForTimeout(300);
    await ui.shot('uit-04-disabled-item-focus');
    expect(await ui.focusId(), 'DOM focus after clicking the disabled opponent count').not.toBe('race.opponents');
  });
});

test.describe('UI mouse: settings and credits', () => {
  test('UM-12 settings: every tab opens by click, hover focuses rows, wheel scrolls the clipped column, back hint leaves', async ({ apex, page }) => {
    test.setTimeout(150_000);
    const ui = new Ui(apex, page);
    await mouseTo(ui, 'settings');
    for (const tab of TABS) {
      await ui.click(`settings.tab.${tab}`, '', 0.5, 300);
      await ui.expectFocus(`settings.tab.${tab}`, `click tab ${tab}`);
      expect(await page.locator('.apx-screen[data-active="1"] .m-pane:not([hidden])').count()).toBe(1);
      expect(await ui.screen()).toBe('settings');
    }
    await ui.click('settings.tab.graphics', '', 0.5, 300);
    await ui.hover('set.g.bloom');
    await ui.expectFocus('set.g.bloom', 'hover a row');
    // wheel: the graphics pane has 14 rows in an 11-row window
    const pane = () => page.evaluate(() => {
      const t = document.querySelector<HTMLElement>('.apx-screen[data-active="1"] .m-pane:not([hidden]) .m-pane-in')?.style.transform ?? '';
      const m = /translateY\((-?[\d.]+)px\)/.exec(t);
      return m ? Math.abs(Number(m[1])) : 0;
    });
    const y0 = await pane();
    await page.mouse.wheel(0, 240);
    await page.waitForTimeout(250);
    const y1 = await pane();
    expect(y1, 'wheel down scrolls').toBeGreaterThan(y0);
    await page.mouse.wheel(0, -2000);
    await page.waitForTimeout(250);
    expect(await pane(), 'wheel up returns to the top').toBe(0);
    for (let i = 0; i < 4; i++) await page.mouse.wheel(0, 500);
    await page.waitForTimeout(300);
    expect(await pane(), 'wheel stops at the end of the list (3 rows x 56)').toBe(3 * 56);
    await ui.hover('set.g.camera');
    await ui.expectFocus('set.g.camera', 'hover the last row after scrolling');
    const f = await ui.focusInfo();
    expect(f.visible, `row under the cursor is visible ${f.clipped}`).toBe(true);
    await ui.clickHint('back'); // rows level -> tabs level (like Esc)
    await ui.clickHint('back'); // tabs -> main menu
    await ui.waitScreen('mainMenu');
    await ui.expectFocus('main.settings');
  });

  test('UM-13 settings rows: chevrons, toggle segments, slider click + drag, all persisted and still there after a reload', async ({ apex, page }) => {
    test.setTimeout(150_000);
    const ui = new Ui(apex, page);
    await mouseTo(ui, 'settings');
    // graphics: stepper (preset), toggle (bloom -> custom), slider
    await ui.click('settings.tab.graphics');
    await ui.click('set.g.preset', CHEV_L, 0.5, 250);
    await ui.expectFocus('set.g.preset', 'chevron click on the first row enters the rows level');
    expect((await ui.stepIndex('set.g.preset')).index, 'high -> medium').toBe(1);
    const bloom0 = await ui.toggleValue('set.g.bloom');
    await ui.click('set.g.bloom', bloom0 ? SEG_OFF : SEG_ON, 0.5, 250);
    expect(await ui.toggleValue('set.g.bloom')).toBe(!bloom0);
    await ui.click('set.g.fov', TRACK, 1, 250);
    expect(await ui.sliderValue('set.g.fov'), 'fov slider right end').toBe(10);
    await ui.click('set.g.fov', TRACK, 0, 250);
    expect(await ui.sliderValue('set.g.fov')).toBe(-10);
    const tr = await ui.box('set.g.fov', TRACK);
    await page.mouse.move(tr.x + 5, tr.y + 2);
    await page.mouse.down();
    await page.mouse.move(tr.x + tr.w * 0.75, tr.y + 2, { steps: 8 });
    await page.mouse.up();
    expect(await ui.sliderValue('set.g.fov'), 'drag to 75 %').toBe(5);
    // audio slider
    await ui.click('settings.tab.audio');
    await ui.click('set.a.sfx', TRACK, 0.25, 250);
    expect(await ui.sliderValue('set.a.sfx')).toBeCloseTo(0.25, 5);
    // hud
    await ui.click('settings.tab.hud');
    await ui.click('set.h.units', CHEV_R, 0.5, 250);
    await ui.click('set.h.minimap', SEG_OFF, 0.5, 250);
    // interface
    await ui.click('settings.tab.interface');
    await ui.click('set.i.animations', CHEV_R, 0.5, 250);
    const st = await ui.stored();
    expect(st.graphics.preset).toBe('custom');
    expect(st.graphics.fovOffset).toBe(5);
    expect(st.audio.sfx).toBeCloseTo(0.25, 5);
    expect(st.hud.units).toBe('mph');
    expect(st.hud.minimap).toBe(false);
    expect(st.ui.animations).toBe('on');
    await page.reload();
    await apex.whenReady('sceneReady');
    await page.waitForTimeout(400);
    await page.mouse.click(960, 540);
    await ui.waitScreen('mainMenu');
    await ui.click('main.settings', '', 0.5, 500);
    await ui.waitScreen('settings');
    await ui.click('settings.tab.audio');
    await ui.hover('set.a.sfx');
    expect(await ui.sliderValue('set.a.sfx'), 'sfx survives the reload').toBeCloseTo(0.25, 5);
    await ui.click('settings.tab.hud');
    await ui.hover('set.h.minimap');
    expect(await ui.toggleValue('set.h.minimap')).toBe(false);
  });

  test('UM-14 controls tab: clicking a key chip starts listening for that slot, a key press rebinds, reset button needs two clicks', async ({ apex, page }) => {
    test.setTimeout(120_000);
    const ui = new Ui(apex, page);
    await mouseTo(ui, 'settings');
    await ui.click('settings.tab.controls');
    await ui.click('set.c.layout', CHEV_R, 0.5, 250);
    await ui.hover('set.c.bind.drs');
    await ui.expectFocus('set.c.bind.drs');
    const chips = '.ctl > .apx-kc';
    await ui.click('set.c.bind.drs', `${chips}:nth-of-type(1)`, 0.5, 300);
    expect((await ui.bindChips('drs'))[0], 'listening label').not.toBe('SPACE');
    await ui.key('KeyG', 300);
    expect((await ui.bindChips('drs'))[0]).toBe('G');
    // second slot chip
    await ui.click('set.c.bind.drs', `${chips}:nth-of-type(2)`, 0.5, 300);
    await ui.key('KeyB', 300);
    expect(await ui.bindChips('drs')).toEqual(['G', 'B']);
    // reset
    const label0 = await ui.text('set.c.reset');
    await ui.hover('set.c.bind.drs');
    for (let i = 0; i < 9; i++) await page.mouse.wheel(0, 400); // the RESET button is below the 11-row window: reachable only by scrolling
    await page.waitForTimeout(300);
    await ui.click('set.c.reset', '', 0.5, 250);
    expect(await ui.text('set.c.reset'), 'first click arms').not.toBe(label0);
    const other = await ui.box('set.c.bind.mfd4').catch(() => null);
    if (other) {
      await page.mouse.move(other.x + 100, other.y + other.h / 2, { steps: 1 });
      await page.waitForTimeout(250);
      expect(await ui.text('set.c.reset'), 'hovering another row disarms').toBe(label0);
    }
    await ui.click('set.c.reset', '', 0.5, 250);
    await ui.click('set.c.reset', '', 0.5, 250);
    expect((await ui.bindChips('drs'))[0], 'reset restores Space').not.toBe('G');
    expect((await ui.stored()).controls.bindings.drs).toEqual(['Space']);
  });

  test('UM-15 about: mouse tabs, native wheel scrolling and back hint', async ({ apex, page }) => {
    const ui = new Ui(apex, page);
    await mouseTo(ui, 'credits');
    await page.getByRole('tab', { name: 'Aydınlatma Metni (KVKK)', exact: true }).click();
    const panel = page.getByRole('tabpanel');
    await panel.hover(); await page.mouse.wheel(0, 240);
    await expect.poll(() => panel.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    await ui.clickHint('back'); await ui.waitScreen('mainMenu');
  });

  test('UM-16 language by mouse: switching TR/EN keeps hover, click, chevrons and back hint working', async ({ apex, page }) => {
    test.setTimeout(120_000);
    const ui = new Ui(apex, page);
    await mouseTo(ui, 'settings');
    await ui.click('settings.tab.language');
    const tr = await ui.stepValue('set.l.lang');
    await ui.click('set.l.lang', CHEV_R, 0.5, 300);
    expect(await ui.stepValue('set.l.lang')).not.toBe(tr);
    expect(await page.evaluate(() => document.querySelector('.apx-ui')?.getAttribute('lang'))).toBe('en');
    await ui.click('set.l.lang', CHEV_L, 0.5, 300);
    await ui.click('set.l.lang', CHEV_L, 0.5, 300);
    await ui.click('set.l.lang', '.lbl', 0.5, 300); // row body = Enter (D-040: the chevrons clamp, so this steps TR -> EN)
    await ui.clickHint('back'); // rows -> tabs
    await ui.clickHint('back'); // tabs -> main menu
    await ui.waitScreen('mainMenu');
    await ui.click('main.quickRace', '', 0.5, 500);
    await ui.waitScreen('raceConditions');
    await ui.click('race.tod', CHEV_R, 0.5, 200);
    expect((await ui.stepIndex('race.tod')).index).toBe(1);
    await ui.clickHint('back');
    await ui.waitScreen('mainMenu');
  });
});

test.describe('UI mouse: in-game', () => {
  test('UM-17 mouse during driving does nothing: left / right / middle clicks, wheel, double-click and drags change neither controls, HUD, camera nor screen', async ({ apex, page }) => {
    test.setTimeout(120_000);
    const ui = new Ui(apex, page);
    await ui.startGame({ assists: 'default', ai: 2 });
    const before = await ui.hud();
    const t0 = await ui.tele();
    const f0 = await ui.frame();
    for (const [x, y] of [[960, 540], [200, 200], [1700, 900], [960, 980], [1800, 100]] as const) {
      const hit = await page.evaluate(([px, py]) => {
        const el = document.elementFromPoint(px, py);
        return el ? `${el.tagName}.${(el as HTMLElement).className}` : 'none';
      }, [x, y] as const);
      expect(hit, `nothing interactive at (${x},${y})`).not.toMatch(/BUTTON|\.m-row|\.m-item|\.m-btn|\.m-cta/);
      await page.mouse.click(x, y);
      await page.mouse.click(x, y, { button: 'right' });
      await page.mouse.click(x, y, { button: 'middle' });
      await page.mouse.dblclick(x, y);
    }
    await page.mouse.move(500, 500);
    await page.mouse.down();
    await page.mouse.move(1400, 300, { steps: 10 });
    await page.mouse.up();
    await page.mouse.wheel(0, 600);
    await page.mouse.wheel(0, -600);
    await page.waitForTimeout(500);
    expect(await ui.screen(), 'no menu opened').toBeNull();
    expect(await ui.simRunning(), 'sim still running (not paused)').toBe(true);
    const t1 = await ui.tele();
    expect(t1.input.throttle, 'no throttle from the mouse').toBe(0);
    expect(t1.input.brake).toBe(0);
    expect(Math.abs(t1.input.steer)).toBe(0);
    expect(t1.vehicle.gear, 'gear unchanged').toBe(t0.vehicle.gear);
    expect(t1.input.pitLimiter).toBe(t0.input.pitLimiter);
    const after = await ui.hud();
    expect(after.visible, 'HUD mode unchanged').toBe(before.visible);
    expect(after.mfd.open).toBe(false);
    expect(after.flashback.open).toBe(false);
    const f1 = await ui.frame();
    expect(Ui.diff(f0, f1), 'camera view unchanged by the mouse').toBeLessThan(0.03);
    expect(await page.evaluate(() => document.querySelectorAll('.apx-screen[data-active="1"]').length)).toBe(0);
    await ui.shot('um-17-ingame-mouse');
  });
});
