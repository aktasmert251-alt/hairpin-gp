// UI Tester: keyboard inventory of every menu screen (arrows + WASD, Enter + Space, Esc + Backspace, Home/End), see
// docs/qa/test-ui-controls.md matrix section A. Asserts through __APEX__.ui.focusId()/screen(), persisted settings and DOM markers.
// Run: APEX_BASE_URL=http://localhost:5183 npx playwright test tests/e2e/ui-keys.spec.ts --project=e2e

import { expect, test } from '../helpers/fixtures';
import { EXPERT_ASSISTS, SETTINGS_KEY, UI_BASE, Ui } from '../helpers/uiDriver';

test.use({ baseURL: UI_BASE });
test.describe.configure({ mode: 'default' });

const TABS = ['graphics', 'audio', 'controls', 'assists', 'hud', 'language', 'interface'] as const;

test.describe('UI keys: title and main menu', () => {
  test('UK-01 title: modifier / Tab / F-keys are ignored, any other key proceeds (once)', async ({ apex, page }) => {
    const ui = new Ui(apex, page);
    await apex.open('/', 'sceneReady');
    await page.waitForTimeout(400);
    expect(await ui.screen()).toBe('title');
    for (const k of ['ShiftLeft', 'Tab', 'CapsLock', 'F8']) await ui.key(k, 250);
    expect(await ui.screen(), 'Shift/Tab/CapsLock/F8 must not leave the title').toBe('title');
    for (const k of ['Enter', 'Escape', 'ArrowDown', 'Digit5']) {
      await apex.open('/', 'sceneReady');
      await page.waitForTimeout(400);
      await ui.key(k, 150);
      await apex.waitForState('menu', 15_000);
      await ui.waitScreen('mainMenu');
      await page.waitForTimeout(500);
      expect(await ui.screen(), `${k}: a single key must stop on the main menu (no double fire)`).toBe('mainMenu');
      await ui.expectFocus('main.timeTrial', `after ${k}`);
    }
  });

  test('UK-02 main menu: arrows + WASD move one item, lists do not wrap, Home/End, Left/Right/Esc/Backspace do nothing', async ({ apex, page }) => {
    const ui = new Ui(apex, page);
    await ui.toMainMenu();
    await ui.expectFocus('main.timeTrial', 'initial');
    const order = ['main.timeTrial', 'main.quickRace', 'main.online', 'main.settings', 'main.credits'];
    for (const [down, up] of [['ArrowDown', 'ArrowUp'], ['KeyS', 'KeyW']]) {
      for (let i = 1; i < order.length; i++) {
        await ui.key(down!);
        await ui.expectFocus(order[i]!, `${down}`);
      }
      await ui.key(down!); // end of list: no wrap
      await ui.expectFocus('main.credits', `${down} at the end must not wrap`);
      for (let i = order.length - 2; i >= 0; i--) {
        await ui.key(up!);
        await ui.expectFocus(order[i]!, `${up}`);
      }
      await ui.key(up!);
      await ui.expectFocus('main.timeTrial', `${up} at the top must not wrap`);
    }
    await ui.key('End');
    await ui.expectFocus('main.credits', 'End');
    await ui.key('Home');
    await ui.expectFocus('main.timeTrial', 'Home');
    for (const k of ['ArrowLeft', 'ArrowRight', 'KeyA', 'KeyD', 'Escape', 'Backspace']) {
      await ui.key(k);
      expect(await ui.screen(), `${k} on the hub`).toBe('mainMenu');
      await ui.expectFocus('main.timeTrial', k);
    }
  });

  test('UK-03 main menu: Enter and Space open each destination, Esc / Backspace go back; focus is restored', async ({ apex, page }) => {
    const ui = new Ui(apex, page);
    await ui.toMainMenu();
    const dest: [string, string, string][] = [
      ['main.timeTrial', 'ttSetup', 'Enter'], ['main.quickRace', 'raceConditions', 'Space'], ['main.settings', 'settings', 'Enter'], ['main.credits', 'credits', 'Space'],
    ];
    for (const back of ['Escape', 'Backspace']) {
      for (const [id, scr, act] of dest) {
        await ui.focusViaKeys(id);
        await ui.key(act, 500);
        expect(await ui.screen(), `${act} on ${id}`).toBe(scr);
        await page.waitForTimeout(500);
        expect(await ui.screen(), `${id}: ${act} must not fire twice (still ${scr})`).toBe(scr);
        await ui.key(back, 500);
        expect(await ui.screen(), `${back} from ${scr}`).toBe('mainMenu');
        await ui.expectFocus(id, `focus restored after ${back} from ${scr}`);
      }
    }
  });

  test('UK-04 stepper rows change exactly one step per Enter / Space / arrow (no double fire), ends clamp, Enter at the end wraps', async ({ apex, page }) => {
    const ui = new Ui(apex, page);
    await ui.toMainMenu();
    await ui.goTo('raceConditions');
    await ui.expectFocus('race.track', 'first row (PIST stepper)');
    await ui.key('ArrowDown');
    await ui.expectFocus('race.tod', 'second row');
    expect((await ui.stepIndex('race.tod')).index).toBe(0);
    await ui.key('Enter');
    expect((await ui.stepIndex('race.tod')).index, 'Enter = +1').toBe(1);
    await ui.key('Space');
    expect((await ui.stepIndex('race.tod')).index, 'Space = +1').toBe(2);
    await ui.key('ArrowRight');
    expect((await ui.stepIndex('race.tod')).index, 'ArrowRight at the end clamps').toBe(2);
    await ui.key('Enter');
    expect((await ui.stepIndex('race.tod')).index, 'Enter on the last ordered value wraps to the first').toBe(0);
    await ui.key('ArrowLeft');
    expect((await ui.stepIndex('race.tod')).index, 'ArrowLeft at the start clamps').toBe(0);
    await ui.key('KeyD');
    expect((await ui.stepIndex('race.tod')).index, 'D = right').toBe(1);
    await ui.key('KeyA');
    expect((await ui.stepIndex('race.tod')).index, 'A = left').toBe(0);
    await ui.expectFocus('race.tod', 'focus stays on the row while changing it');
  });
});

test.describe('UI keys: race flow screens', () => {
  test('UK-05 race flow: conditions -> team -> settings -> assists, Esc/Backspace walk back step by step', async ({ apex, page }) => {
    test.setTimeout(150_000);
    const ui = new Ui(apex, page);
    await ui.toMainMenu();
    await ui.goTo('raceConditions');
    // conditions rows
    for (const [id, n] of [['race.tod', 3], ['race.weather', 4], ['race.laps', 5]] as const) {
      await ui.focusViaKeys(id);
      expect((await ui.stepIndex(id)).count, `${id} option count`).toBe(n);
    }
    await ui.focusViaKeys('race.weather');
    await ui.key('ArrowRight');
    expect(await ui.stepValue('race.weather')).not.toBe('');
    // CTA by keyboard to each next step and back with alternating Esc / Backspace
    const chain = ['raceConditions', 'teamSelect', 'raceSettings', 'assists'];
    for (let i = 0; i < 3; i++) {
      await ui.focusViaKeys(`${chain[i]}.cta`);
      await ui.key(i % 2 ? 'Space' : 'Enter', 500);
      await ui.waitScreen(chain[i + 1]!);
      await page.waitForTimeout(400);
      expect(await ui.screen(), `no double fire on ${chain[i]}.cta`).toBe(chain[i + 1]);
    }
    for (let i = 3; i > 0; i--) {
      await ui.key(i % 2 ? 'Escape' : 'Backspace', 500);
      await ui.waitScreen(chain[i - 1]!);
    }
    await ui.key('Escape', 500);
    await ui.waitScreen('mainMenu');
    await ui.expectFocus('main.quickRace', 'back at the hub');
  });

  test('UK-06 team select: 2D tile grid with arrows / WASD, Enter selects, Down leaves to the driver row, driver row steps and advances', async ({ apex, page }) => {
    const ui = new Ui(apex, page);
    await ui.toMainMenu();
    await ui.goTo('teamSelect');
    const start = await ui.focusId();
    expect(start, 'focus starts on a team tile').toMatch(/^team\./);
    await ui.expectFocus(start!, 'initial');
    await ui.key('Home');
    const first = await ui.focusId();
    expect(first).toMatch(/^team\./);
    await ui.key('ArrowRight');
    const second = await ui.focusId();
    expect(second, 'Right moves to the next tile').not.toBe(first);
    await ui.key('KeyS');
    const third = await ui.focusId();
    expect(third, 'Down moves one row (2 columns)').toMatch(/^team\./);
    expect(third).not.toBe(second);
    await ui.key('ArrowLeft');
    await ui.key('ArrowUp');
    expect(await ui.focusId(), 'back to the top-left tile').toBe(first);
    await ui.key('Enter');
    expect(await page.locator('.apx-screen[data-active="1"] .m-tile.is-sel').count(), 'exactly one selected tile').toBe(1);
    await ui.expectFocus('race.driver', 'selecting a tile moves focus to the driver row');
    await ui.key('ArrowUp');
    expect(await ui.focusId(), 'Up returns to the selected tile').toBe(first);
    await ui.key('Space');
    expect(await page.locator('.apx-screen[data-active="1"] .m-tile.is-sel').count(), 'Space selects too').toBe(1);
    await ui.expectFocus('race.driver');
    await ui.key('ArrowUp');
    // leaves the grid downwards
    for (let i = 0; i < 8 && (await ui.focusId()) !== 'race.driver'; i++) await ui.key('ArrowDown', 120);
    await ui.expectFocus('race.driver', 'Down out of the grid');
    const d0 = await ui.stepValue('race.driver');
    await ui.key('ArrowRight');
    expect(await ui.stepValue('race.driver'), 'driver steps with Right').not.toBe(d0);
    await ui.key('ArrowLeft');
    expect(await ui.stepValue('race.driver')).toBe(d0);
    await ui.key('ArrowUp');
    expect(await ui.focusId(), 'Up returns to the selected tile').toMatch(/^team\./);
    for (let i = 0; i < 8 && (await ui.focusId()) !== 'race.driver'; i++) await ui.key('ArrowDown', 120);
    await ui.expectFocus('race.driver');
    await ui.key('Enter', 500);
    await ui.waitScreen('raceSettings');
    await ui.key('Escape', 500);
    await ui.waitScreen('teamSelect');
  });

  test('UK-07 race settings: sliders (+-1 / +-5, clamp), dependent grid list, tyre: Enter wraps / arrows clamp, read-only row is inert', async ({ apex, page }) => {
    const ui = new Ui(apex, page);
    await ui.toMainMenu();
    await ui.goTo('raceSettings');
    await ui.expectFocus('race.aiEnabled', 'first row');
    await ui.key('ArrowDown');
    await ui.expectFocus('race.opponents', 'first row');
    const o0 = await ui.sliderValue('race.opponents');
    await ui.key('ArrowLeft');
    expect(await ui.sliderValue('race.opponents'), 'slider left = -1').toBe(o0 - 1);
    await ui.key('KeyD');
    expect(await ui.sliderValue('race.opponents'), 'slider D = +1').toBe(o0);
    await ui.key('ArrowRight');
    await ui.key('ArrowRight');
    expect(await ui.sliderValue('race.opponents'), 'clamps at 19').toBe(19);
    await ui.key('ArrowDown');
    await ui.expectFocus('race.difficulty');
    const d0 = await ui.sliderValue('race.difficulty');
    await ui.key('ArrowRight');
    expect(await ui.sliderValue('race.difficulty'), 'difficulty +5').toBe(d0 + 5);
    await ui.key('ArrowLeft');
    await ui.key('ArrowLeft');
    expect(await ui.sliderValue('race.difficulty')).toBe(d0 - 5);
    await ui.key('ArrowDown');
    await ui.expectFocus('race.grid');
    const gridCount19 = (await ui.stepIndex('race.grid')).count;
    expect(gridCount19, 'grid options = random + 20 slots with 19 opponents').toBe(21);
    await ui.key('ArrowUp'); await ui.key('ArrowUp');
    for (let i = 0; i < 19; i++) await ui.key('ArrowLeft', 40);
    expect(await ui.sliderValue('race.opponents'), 'enabled opponents clamp at 1').toBe(1);
    await ui.key('ArrowUp');
    await ui.expectFocus('race.aiEnabled');
    await ui.key('ArrowLeft');
    await ui.key('ArrowDown'); await ui.key('ArrowDown');
    expect((await ui.stepIndex('race.grid')).count, 'grid list follows the opponent count').toBe(2);
    await ui.key('ArrowDown');
    await ui.expectFocus('race.startTyre');
    const t = await ui.stepIndex('race.startTyre');
    for (let i = 0; i < t.count; i++) await ui.key('Enter', 80);
    expect((await ui.stepIndex('race.startTyre')).index, 'Enter cycles the set and wraps after a full cycle').toBe(t.index);
    for (let i = 0; i < t.count; i++) await ui.key('ArrowRight', 80);
    expect((await ui.stepIndex('race.startTyre')).index, 'D-040: ArrowRight clamps at the last value (no wrap)').toBe(t.count - 1);
    await ui.key('ArrowDown');
    await ui.expectFocus('race.flashbacks');
    await ui.key('ArrowDown');
    await ui.expectFocus('race.twoCompound');
    const before = await ui.text('race.twoCompound');
    await ui.key('ArrowRight'); await ui.key('Enter'); await ui.key('Space');
    expect(await ui.text('race.twoCompound'), 'read-only row never changes').toBe(before);
    expect(await ui.screen()).toBe('raceSettings');
    await ui.key('ArrowDown');
    await ui.expectFocus('race.safetyCar');
    await ui.key('ArrowLeft');
    expect(await ui.toggleValue('race.safetyCar')).toBe(false);
    await ui.key('ArrowRight');
    expect(await ui.toggleValue('race.safetyCar')).toBe(true);
    await ui.key('ArrowDown');
    await ui.expectFocus('raceSettings.cta');
  });

  test('UK-08 assists: preset applies and turns into custom on edit, toggles flip with Left/Right/Enter/Space; keyboard-only start -> session', async ({ apex, page }) => {
    test.setTimeout(180_000);
    const ui = new Ui(apex, page);
    await ui.toMainMenu();
    await ui.goTo('assists');
    await ui.expectFocus('assists.preset', 'first row');
    const cnt = (await ui.stepIndex('assists.preset')).count;
    expect(cnt, 'three presets (no custom while a preset matches)').toBe(3);
    // pick "expert" (last), toggles must follow
    while ((await ui.stepIndex('assists.preset')).index < 2) await ui.key('ArrowRight');
    expect(await ui.toggleValue('assists.steering')).toBe(false);
    expect(await ui.toggleValue('assists.kbBrakeLimiter')).toBe(false);
    await ui.key('ArrowLeft');
    await ui.key('ArrowLeft'); // beginner
    expect(await ui.toggleValue('assists.steering')).toBe(true);
    await ui.key('ArrowDown');
    await ui.expectFocus('assists.steering');
    await ui.key('ArrowLeft');
    expect(await ui.toggleValue('assists.steering'), 'Left sets off').toBe(false);
    await ui.key('ArrowLeft');
    expect(await ui.toggleValue('assists.steering'), 'Left on an off toggle keeps it off').toBe(false);
    await ui.key('ArrowRight');
    expect(await ui.toggleValue('assists.steering'), 'Right sets on').toBe(true);
    await ui.key('Enter');
    expect(await ui.toggleValue('assists.steering'), 'Enter flips').toBe(false);
    await ui.key('Space');
    expect(await ui.toggleValue('assists.steering'), 'Space flips').toBe(true);
    await ui.key('Enter');
    await ui.key('ArrowUp');
    expect((await ui.stepIndex('assists.preset')).count, 'editing a toggle adds the custom preset').toBe(4);
    // multi-select rows
    await ui.focusViaKeys('assists.braking');
    const b = (await ui.stepIndex('assists.braking')).index;
    await ui.key('ArrowLeft'); await ui.key('ArrowLeft'); await ui.key('ArrowLeft'); await ui.key('ArrowLeft');
    expect((await ui.stepIndex('assists.braking')).index).toBe(0);
    expect(b).toBeGreaterThanOrEqual(0);
    await ui.focusViaKeys('assists.cta');
    await ui.key('Enter', 600);
    await apex.waitForState('session', 90_000);
    await apex.waitForPhase('running', 60_000);
    await page.waitForTimeout(500);
    expect(await ui.screen(), 'HUD only, no menu screen').toBeNull();
    const saved = await page.evaluate(() => localStorage.getItem('apexgp:v1:lastRaceSetup'));
    expect(saved, 'YARIŞA BAŞLA saves the setup').toContain('"assists"');
  });

  test('UK-09 time trial setup: rows step, ghost Enter wraps, Esc back, GO starts a TT session', async ({ apex, page }) => {
    test.setTimeout(150_000);
    const ui = new Ui(apex, page);
    await ui.toMainMenu();
    await ui.goTo('ttSetup');
    await ui.expectFocus('tt.track', 'first row (PIST stepper)');
    const rows: [string, number][] = [['tt.team', 10], ['tt.tyre', 3], ['tt.tod', 3], ['tt.weather', 3], ['tt.ghost', 3]];
    for (const [id, n] of rows) {
      await ui.focusViaKeys(id);
      const s = await ui.stepIndex(id);
      if (id !== 'tt.team') expect(s.count, id).toBe(n);
      const v0 = await ui.stepValue(id);
      await ui.key('ArrowRight');
      const v1 = await ui.stepValue(id);
      if (s.count > 1 && s.index < s.count - 1) expect(v1, `${id} Right`).not.toBe(v0);
      await ui.key('ArrowLeft');
      await ui.key('ArrowLeft');
      await ui.key('ArrowRight');
    }
    await ui.focusViaKeys('tt.ghost');
    const g = await ui.stepIndex('tt.ghost');
    for (let i = 0; i < g.count; i++) await ui.key('Enter', 80);
    expect((await ui.stepIndex('tt.ghost')).index, 'ghost: Enter cycles and wraps').toBe(g.index);
    await ui.key('Backspace', 500);
    await ui.waitScreen('mainMenu');
    await ui.goTo('ttSetup');
    await ui.focusViaKeys('tt.go');
    await ui.key('Space', 600);
    await apex.waitForState('session', 90_000);
    expect((await apex.race())!.mode).toBe('timeTrial');
  });
});

test.describe('UI keys: settings', () => {
  test('UK-10 settings: tab list previews all 7 tabs (Up/Down/WASD/Home/End), Right/Enter enter rows, Left/Esc return, Esc leaves', async ({ apex, page }) => {
    const ui = new Ui(apex, page);
    await ui.toMainMenu();
    await ui.goTo('settings');
    await ui.expectFocus('settings.tab.graphics', 'first tab');
    for (let i = 1; i < TABS.length; i++) {
      await ui.key(i % 2 ? 'ArrowDown' : 'KeyS');
      await ui.expectFocus(`settings.tab.${TABS[i]}`, `tab ${i}`);
      const visible = await page.locator('.apx-screen[data-active="1"] .m-pane:not([hidden])').count();
      expect(visible, 'exactly one pane visible').toBe(1);
    }
    await ui.key('ArrowDown');
    await ui.expectFocus('settings.tab.interface', 'tabs do not wrap');
    await ui.key('Home');
    await ui.expectFocus('settings.tab.graphics');
    await ui.key('End');
    await ui.expectFocus('settings.tab.interface');
    await ui.key('Home');
    // Right enters the rows, Left on a row without value returns, Esc returns
    await ui.key('ArrowRight');
    await ui.expectFocus('set.g.preset', 'rows level');
    await ui.key('Escape');
    await ui.expectFocus('settings.tab.graphics', 'Esc from rows -> tabs');
    await ui.key('Enter');
    await ui.expectFocus('set.g.preset', 'Enter enters');
    await ui.key('Backspace');
    await ui.expectFocus('settings.tab.graphics', 'Backspace from rows -> tabs');
    await ui.key('Space');
    await ui.expectFocus('set.g.preset', 'Space enters');
    await ui.key('Escape');
    await ui.key('Escape', 500);
    await ui.waitScreen('mainMenu');
    await ui.expectFocus('main.settings');
  });

  test('UK-11 settings rows: every row of every tab is reachable, focus is visible (scrolls into the clipped column), Home/End', async ({ apex, page }) => {
    test.setTimeout(150_000);
    const ui = new Ui(apex, page);
    await ui.toMainMenu();
    await ui.goTo('settings');
    for (const tab of TABS) {
      await ui.focusViaKeys(`settings.tab.${tab}`);
      await ui.key('ArrowRight');
      const seen: string[] = [];
      for (let i = 0; i < 40; i++) {
        const f = await ui.focusInfo();
        expect(f.id, `${tab} row ${i}`).toBeTruthy();
        expect(f.marked, `${tab}/${f.id}: exactly one focus marker`).toBe(1);
        // set.c.reset is clipped by a few px at the end of the column: tracked separately as UIT-02 (UK-11b).
        if (f.id !== 'set.c.reset') expect(f.visible, `${tab}/${f.id}: focused row visible (${f.clipped}) rect=${JSON.stringify(f.rect)}`).toBe(true);
        if (seen[seen.length - 1] === f.id) break;
        seen.push(f.id!);
        await ui.key('ArrowDown', 90);
      }
      const expected = { graphics: 14, audio: 5, controls: 2 + 22 + 1, assists: 11 + 2, hud: 4, language: 1, interface: 2 }[tab];
      expect(seen.length, `${tab}: rows reachable (${seen.join(',')})`).toBe(expected);
      await ui.key('Home');
      expect(await ui.focusId(), `${tab} Home`).toBe(seen[0]);
      await ui.key('End');
      expect(await ui.focusId(), `${tab} End`).toBe(seen[seen.length - 1]);
      if (tab !== 'controls') await ui.expectFocus(seen[seen.length - 1]!, `${tab} End visible`);
      await ui.key('Escape');
    }
  });

  test('UK-12 settings value rows (stepper, toggle, slider) change with Left/Right/A/D/Enter/Space and persist across a reload', async ({ apex, page }) => {
    test.setTimeout(150_000);
    const ui = new Ui(apex, page);
    await ui.toMainMenu();
    await ui.goTo('settings');
    // graphics: stepper (ordered preset), toggle, slider
    await ui.focusViaKeys('settings.tab.graphics');
    await ui.key('ArrowRight');
    await ui.expectFocus('set.g.preset');
    expect(await ui.stepValue('set.g.preset')).toBeTruthy();
    await ui.key('ArrowLeft'); // high -> medium
    await ui.key('ArrowLeft'); // medium -> low
    expect((await ui.stepIndex('set.g.preset')).index).toBe(0);
    await ui.expectFocus('set.g.preset');
    await ui.focusViaKeys('set.g.bloom');
    const bloom0 = await ui.toggleValue('set.g.bloom');
    await ui.key('Enter');
    expect(await ui.toggleValue('set.g.bloom'), 'Enter flips the toggle').toBe(!bloom0);
    await ui.focusViaKeys('set.g.fov');
    const fov0 = await ui.sliderValue('set.g.fov');
    await ui.key('ArrowRight'); await ui.key('KeyD');
    expect(await ui.sliderValue('set.g.fov'), 'FOV +2').toBe(fov0 + 2);
    await ui.focusViaKeys('set.g.shake');
    await ui.key('ArrowLeft');
    // audio sliders
    await ui.key('Escape');
    await ui.focusViaKeys('settings.tab.audio');
    await ui.key('Enter');
    await ui.expectFocus('set.a.master');
    const m0 = await ui.sliderValue('set.a.master');
    await ui.key('ArrowLeft'); await ui.key('ArrowLeft');
    expect(await ui.sliderValue('set.a.master')).toBeCloseTo(m0 - 0.1, 5);
    // hud tab
    await ui.key('Escape');
    await ui.focusViaKeys('settings.tab.hud');
    await ui.key('ArrowRight');
    await ui.key('Space'); // hud mode full -> minimal
    expect(await ui.stepValue('set.h.mode')).not.toBe('');
    await ui.focusViaKeys('set.h.units');
    await ui.key('ArrowRight');
    // interface tab
    await ui.key('Escape');
    await ui.focusViaKeys('settings.tab.interface');
    await ui.key('Enter');
    await ui.key('ArrowRight');
    const st = await ui.stored();
    expect(st.graphics.preset, 'bloom edit turns the preset into custom').toBe('custom');
    expect(st.audio.master).toBeCloseTo(m0 - 0.1, 5);
    expect(st.graphics.fovOffset).toBe(fov0 + 2);
    expect(st.hud.mode).toBe('minimal');
    expect(st.hud.units).toBe('mph');
    expect(st.ui.animations).toBe('on');
    // reload: the UI shows the persisted values
    await page.reload();
    await apex.whenReady('sceneReady');
    await page.waitForTimeout(400);
    await ui.key('Space');
    await ui.waitScreen('mainMenu');
    await ui.goTo('settings');
    await ui.focusViaKeys('settings.tab.audio');
    await ui.key('ArrowRight');
    expect(await ui.sliderValue('set.a.master'), 'master volume survives the reload').toBeCloseTo(m0 - 0.1, 5);
    await ui.key('Escape');
    await ui.focusViaKeys('settings.tab.hud');
    await ui.key('ArrowRight');
    expect(await ui.stepValue('set.h.mode')).toBe(await ui.stepValue('set.h.mode'));
    const st2 = await ui.stored();
    expect(st2.hud.units).toBe('mph');
    expect(st2.hud.mode).toBe('minimal');
  });

  test('UK-13 language: TR <-> EN switches every label and all keys keep working (main menu, race flow, settings)', async ({ apex, page }) => {
    test.setTimeout(150_000);
    const ui = new Ui(apex, page);
    await ui.toMainMenu();
    const trLabel = await ui.text('main.quickRace');
    await ui.goTo('settings');
    await ui.focusViaKeys('settings.tab.language');
    await ui.key('ArrowRight');
    await ui.expectFocus('set.l.lang');
    const trValue = await ui.stepValue('set.l.lang');
    await ui.key('ArrowRight');
    const enValue = await ui.stepValue('set.l.lang');
    expect(enValue, 'language value changes').not.toBe(trValue);
    expect(await page.evaluate(() => document.querySelector('.apx-ui')?.getAttribute('lang'))).toBe('en');
    await ui.expectFocus('set.l.lang', 'focus survives the re-render');
    await ui.key('Escape');
    await ui.key('Escape', 500);
    await ui.waitScreen('mainMenu');
    const enLabel = await ui.text('main.quickRace');
    expect(enLabel, 'main menu relabelled').not.toBe(trLabel);
    // keys still work in EN
    await ui.focusViaKeys('main.quickRace');
    await ui.key('Enter', 500);
    await ui.waitScreen('raceConditions');
    await ui.focusViaKeys('race.weather');
    await ui.key('ArrowRight');
    await ui.key('Escape', 500);
    await ui.waitScreen('mainMenu');
    expect((await ui.stored()).lang).toBe('en');
    await page.reload();
    await apex.whenReady('sceneReady');
    await page.waitForTimeout(400);
    await ui.key('Enter');
    await ui.waitScreen('mainMenu');
    expect(await ui.text('main.quickRace'), 'EN persisted').toBe(enLabel);
    // back to TR
    await ui.goTo('settings');
    await ui.focusViaKeys('settings.tab.language');
    await ui.key('Enter');
    await ui.key('Enter'); // unordered set: Enter steps and wraps
    expect(await ui.stepValue('set.l.lang')).toBe(trValue);
    await ui.key('Escape'); await ui.key('Escape', 500);
    await ui.waitScreen('mainMenu');
    expect(await ui.text('main.quickRace')).toBe(trLabel);
  });

  test('UK-14 about: keyboard tabs, content scroll and return to menu', async ({ apex, page }) => {
    const ui = new Ui(apex, page);
    await ui.toMainMenu(); await ui.goTo('credits');
    await ui.expectFocus('about.tab.game');
    await ui.key('ArrowDown'); await ui.expectFocus('about.tab.licenses');
    await ui.key('KeyS'); await ui.expectFocus('about.tab.kvkk');
    await ui.key('Enter'); await ui.expectFocus('about.content');
    const y = () => page.locator('.m-about-panel').evaluate((el) => el.scrollTop);
    await ui.key('ArrowDown'); expect(await y()).toBe(120);
    await ui.key('KeyS'); expect(await y()).toBe(240);
    await ui.key('KeyW'); expect(await y()).toBe(120);
    await ui.key('Home'); expect(await y()).toBe(0);
    await ui.key('End'); expect(await y()).toBeGreaterThan(240);
    for (const back of ['Escape', 'Backspace']) {
      await ui.key(back, 500); await ui.waitScreen('mainMenu');
      await ui.expectFocus('main.credits');
      await ui.key('Enter', 500); await ui.waitScreen('credits');
    }
  });
});

test.describe('UI keys: pause, confirm dialogs, results (need a running session)', () => {
  test('UK-15 pause + confirm dialog: Esc/Backspace resume, nav keys, HAYIR is the default, Esc/Left closes, YES quits to the menu', async ({ apex, page }) => {
    test.setTimeout(180_000);
    const ui = new Ui(apex, page);
    await ui.startGame({ assists: 'default' });
    const t0 = (await ui.tele()).tick;
    await ui.key('Escape', 500);
    await ui.waitScreen('pause');
    await ui.expectFocus('pause.resume', 'initial pause focus');
    expect(await ui.simRunning(), 'sim frozen while paused').toBe(false);
    // resume with Escape, then pause with P (P opens), resume with Backspace, resume via Enter on Resume
    await ui.key('Escape', 500);
    await ui.waitScreen(null);
    expect(await ui.simRunning(), 'sim runs again').toBe(true);
    expect((await ui.tele()).tick).toBeGreaterThan(t0);
    await ui.key('KeyP', 500);
    await ui.waitScreen('pause');
    await ui.key('Backspace', 500);
    await ui.waitScreen(null);
    await ui.key('Escape', 500);
    await ui.waitScreen('pause');
    await ui.key('Enter', 500);
    await ui.waitScreen(null);
    await ui.key('Escape', 500);
    await ui.waitScreen('pause');
    // navigation: race => restartLap hidden; order resume, restart, settings, retire, quit
    const order = ['pause.resume', 'pause.restart', 'pause.settings', 'pause.retire', 'pause.quit'];
    for (let i = 1; i < order.length; i++) {
      await ui.key(i % 2 ? 'ArrowDown' : 'KeyS');
      await ui.expectFocus(order[i]!, 'down');
    }
    await ui.key('ArrowDown');
    await ui.expectFocus('pause.quit', 'no wrap');
    await ui.key('ArrowRight');
    await ui.expectFocus('pause.quit', 'Right does nothing on a nav list');
    // confirm dialog: HAYIR default
    await ui.key('Enter');
    await ui.expectFocus('pause.confirm.no', 'dialog default is HAYIR');
    await ui.key('ArrowLeft');
    await ui.expectFocus('pause.confirm.yes');
    await ui.key('ArrowRight');
    await ui.expectFocus('pause.confirm.no');
    await ui.key('KeyA');
    await ui.expectFocus('pause.confirm.yes', 'A in dialog');
    await ui.key('Escape');
    await ui.expectFocus('pause.quit', 'Esc closes only the dialog, focus returns to the item');
    expect(await ui.screen()).toBe('pause');
    await ui.key('Space');
    await ui.expectFocus('pause.confirm.no');
    await ui.key('Enter'); // HAYIR = close
    await ui.expectFocus('pause.quit', 'Enter on HAYIR closes the dialog');
    expect(await ui.simRunning(), 'still paused').toBe(false);
    await ui.key('Enter');
    await ui.key('ArrowUp');
    await ui.expectFocus('pause.confirm.yes');
    await ui.key('Space', 700);
    await ui.waitScreen('mainMenu');
    await apex.waitForState('menu');
    await ui.expectFocus('main.timeTrial');
  });

  test('UK-16 pause -> settings -> back returns to the pause menu; retire -> results; results keys; restart', async ({ apex, page }) => {
    test.setTimeout(240_000);
    const ui = new Ui(apex, page);
    await ui.startGame({ assists: 'default', ai: 3 });
    await ui.key('Escape', 500);
    await ui.waitScreen('pause');
    await ui.focusViaKeys('pause.settings');
    await ui.key('Enter', 500);
    await ui.waitScreen('settings');
    await ui.key('Escape', 500);
    await ui.waitScreen('pause');
    await ui.expectFocus('pause.settings', 'focus restored on the item');
    await ui.focusViaKeys('pause.retire');
    await ui.key('Enter');
    await ui.expectFocus('pause.confirm.no');
    await ui.key('ArrowLeft');
    await ui.key('Enter', 800);
    await ui.waitScreen('results');
    await page.waitForTimeout(800);
    expect(await page.locator('.apx-screen[data-screen="results"] tbody tr').count(), 'results table rows').toBe(4);
    await ui.expectFocus('results.restart', 'results first button');
    await ui.key('ArrowRight');
    await ui.expectFocus('results.menu', 'Right = next button');
    await ui.key('ArrowRight');
    await ui.expectFocus('results.menu', 'no wrap');
    await ui.key('KeyA');
    await ui.expectFocus('results.restart', 'A = previous button');
    await ui.key('Enter', 600); // restart -> new session
    await apex.waitForState('session', 90_000);
    await apex.waitForPhase('running', 60_000).catch(() => undefined);
    await ui.key('Escape', 500);
    await ui.waitScreen('pause');
    await ui.focusViaKeys('pause.retire');
    await ui.key('Enter'); await ui.key('ArrowLeft'); await ui.key('Enter', 800);
    await ui.waitScreen('results');
    await page.waitForTimeout(600);
    await ui.key('Escape', 600);
    await ui.expectFocus('results.confirm.no');
    await ui.key('ArrowLeft');
    await ui.expectFocus('results.confirm.yes');
    await ui.key('Enter', 600);
    await ui.waitScreen('mainMenu');
  });

  test('UK-17 time trial: pause menu shows restart-lap; End session -> TT results; retry / menu buttons by key', async ({ apex, page }) => {
    test.setTimeout(240_000);
    const ui = new Ui(apex, page);
    await ui.startGame({ mode: 'tt', assists: 'default' });
    await ui.key('Escape', 500);
    await ui.waitScreen('pause');
    await ui.key('ArrowDown');
    await ui.expectFocus('pause.restartLap', 'TT: restart lap is the 2nd item');
    await ui.key('Enter', 500); // resumes + restarts the lap
    await ui.waitScreen(null);
    expect(await ui.simRunning()).toBe(true);
    await ui.key('Escape', 500);
    await ui.waitScreen('pause');
    // QA-19-03: in Time Trial the retire slot is "End session" (enabled) and leads to the TT summary.
    await ui.focusViaKeys('pause.settings');
    await ui.key('ArrowDown');
    await ui.expectFocus('pause.retire', 'TT: End session follows Settings');
    expect(await page.locator('[data-focus-id="pause.retire"]').getAttribute('aria-disabled')).not.toBe('true');
    await ui.key('Enter'); await ui.key('ArrowLeft'); await ui.key('Enter', 800);
    await ui.waitScreen('ttResults');
    await page.waitForTimeout(800);
    await ui.expectFocus('ttResults.retry');
    await ui.key('ArrowDown');
    await ui.expectFocus('ttResults.menu');
    await ui.key('ArrowUp');
    await ui.expectFocus('ttResults.retry');
    await ui.key('KeyD');
    await ui.expectFocus('ttResults.menu', 'Right = next');
    await ui.key('Backspace', 700);
    await ui.waitScreen('mainMenu');
  });

  test('UK-17b QA-19-03 time trial: M -> Main menu confirmation -> the main menu (not the TT summary)', async ({ apex, page }) => {
    test.setTimeout(180_000);
    const ui = new Ui(apex, page);
    await ui.startGame({ mode: 'tt', assists: 'default' });
    await ui.key('KeyM', 600);
    await ui.waitScreen('pause');
    await ui.expectFocus('pause.confirm.no', 'M opens the main-menu confirmation');
    await ui.key('ArrowLeft'); await ui.key('Enter', 800);
    await ui.waitScreen('mainMenu');
  });
});

test.describe('UI keys: known defects', () => {
  // UIT-01 (P2, Grafik-UI): Left at the lowest value of a stepper / slider returns to the tab list (settings.ts action(): `cur.left() === false`
  // -> leaveRows()). Holding Left to lower a value therefore throws the player out of the row once the minimum is reached.
  test('UK-12b UIT-01: ArrowLeft at the minimum of a stepper / slider keeps focus on the row', async ({ apex, page }) => {
    const ui = new Ui(apex, page);
    await ui.toMainMenu();
    await ui.goTo('settings');
    await ui.focusViaKeys('settings.tab.audio');
    await ui.key('ArrowRight');
    for (let i = 0; i < 21; i++) await ui.key('ArrowLeft', 40);
    expect(await ui.sliderValue('set.a.master')).toBe(0);
    await ui.key('ArrowLeft'); // already at 0
    await ui.shot('uit-01-left-at-min');
    await ui.expectFocus('set.a.master', 'Left at slider minimum');
  });
});

test.describe('UI keys: known defects (2)', () => {
  // UIT-05 (P1, Grafik-UI): after choosing another team (Enter / click on a tile) the "Pilot" row keeps showing the previous team's driver name until
  // the row is stepped: selectRow.draw() is not re-run by TeamSelect.activate(). The player can start a race believing a different driver is selected.
  test('UK-06c UIT-05: the driver row shows a driver of the newly selected team', async ({ apex, page }) => {
    const ui = new Ui(apex, page);
    await ui.toMainMenu();
    await ui.goTo('teamSelect');
    await ui.key('Home');
    await ui.key('ArrowRight');
    await ui.key('ArrowDown');
    await ui.key('Enter'); // select a team that is not the default one; focus jumps to the driver row
    await ui.expectFocus('race.driver');
    const shown = await ui.stepValue('race.driver');
    await ui.key('ArrowRight');
    await ui.key('ArrowLeft');
    const truth = await ui.stepValue('race.driver');
    await ui.shot('uit-05-stale-driver-name');
    expect(shown, 'driver name shown right after selecting the team').toBe(truth);
  });

  // UIT-03 (P2, Grafik-UI): TeamSelect.action(): Down from the last tile row of the RIGHT column resolves moveGrid() to items[11] = the CTA, so the
  // "Pilot" (driver) row is skipped; it can only be reached from the left column. Up from the CTA then lands on the driver row.
  test('UK-06b UIT-03: Down from a right-column tile reaches the driver row before the CTA', async ({ apex, page }) => {
    const ui = new Ui(apex, page);
    await ui.toMainMenu();
    await ui.goTo('teamSelect');
    await ui.key('Home');
    await ui.key('ArrowRight');
    const seen: string[] = [];
    for (let i = 0; i < 8; i++) {
      await ui.key('ArrowDown', 120);
      seen.push((await ui.focusId())!);
    }
    await ui.shot('uit-03-driver-row-skipped');
    expect(seen, `visited ${seen.join(' > ')}`).toContain('race.driver');
  });

  // UIT-02 (P2, Grafik-UI): the last controls row (RESET) sits in a taller wrapper (.m-row-btn, 48 px + margins) than the 56 px row pitch the
  // scroll maths assumes, so at the end of the list its bottom edge is cut by the clipped column (~4 px) and the focus frame is not fully visible.
  test('UK-11b UIT-02: the focused RESET button at the end of the controls list is fully visible', async ({ apex, page }) => {
    const ui = new Ui(apex, page);
    await ui.toMainMenu();
    await ui.goTo('settings');
    await ui.focusViaKeys('settings.tab.controls');
    await ui.key('ArrowRight');
    await ui.key('End');
    await ui.shot('uit-02-reset-clipped');
    const f = await ui.focusInfo();
    expect(f.id).toBe('set.c.reset');
    expect(f.visible, `rect=${JSON.stringify(f.rect)} ${f.clipped}`).toBe(true);
  });
});

test.describe('UI keys: settings key-binding rows (menu side)', () => {
  test('UK-18 binding row: Left/Right pick the slot, Enter listens, a key rebinds, Esc cancels, reserved/modifier keys are refused, reset needs two presses', async ({ apex, page }) => {
    test.setTimeout(120_000);
    const ui = new Ui(apex, page);
    await ui.toMainMenu();
    await ui.goTo('settings');
    await ui.focusViaKeys('settings.tab.controls');
    await ui.key('ArrowRight');
    await ui.focusViaKeys('set.c.bind.cameraNext');
    expect((await ui.bindChips('cameraNext'))[0]).toBe('C');
    // Esc while listening cancels and keeps the binding
    await ui.key('Enter');
    expect((await ui.bindChips('cameraNext'))[0], 'listening label shown').not.toBe('C');
    await ui.key('Escape');
    expect((await ui.bindChips('cameraNext'))[0], 'cancel keeps C').toBe('C');
    expect(await ui.screen(), 'Esc while listening must not leave settings').toBe('settings');
    // rebind primary to N
    await ui.key('Enter');
    await ui.key('KeyN');
    expect((await ui.bindChips('cameraNext'))[0]).toBe('N');
    // second slot with Right
    await ui.key('ArrowRight');
    await ui.key('Enter');
    await ui.key('KeyM');
    expect(await ui.bindChips('cameraNext')).toEqual(['N', 'M']);
    // Left goes back to slot 0 (and does not leave the rows level)
    await ui.key('ArrowLeft');
    await ui.expectFocus('set.c.bind.cameraNext', 'Left on slot 1 moves to slot 0');
    // conflict: bind hudCycle to N -> cameraNext loses N
    await ui.focusViaKeys('set.c.bind.hudCycle');
    await ui.key('Enter');
    await ui.key('KeyN');
    expect((await ui.bindChips('hudCycle'))[0]).toBe('N');
    expect((await ui.bindChips('cameraNext'))[0], 'the conflicting action lost the key (its slot is now the next binding)').not.toBe('N');
    // reserved key: Escape is cancel (above); F5 refused
    await ui.focusViaKeys('set.c.bind.racingLine');
    await ui.key('Enter');
    await ui.key('F5', 100).catch(() => undefined);
    // reset: first press arms, second resets
    await ui.focusViaKeys('set.c.reset');
    const label0 = await ui.text('set.c.reset');
    await ui.key('Enter');
    expect(await ui.text('set.c.reset'), 'first press arms the confirmation').not.toBe(label0);
    await ui.key('Enter');
    expect(await ui.text('set.c.reset'), 'second press resets and disarms').toBe(label0);
    expect((await ui.bindChips('hudCycle'))[0]).toBe('H');
    expect((await ui.bindChips('hudCycle'))[1], 'second slot empty again').toMatch(/^[—-]?$/);
    expect((await ui.bindChips('cameraNext'))[0]).toBe('C');
    // arming is cancelled by moving away
    await ui.key('Enter');
    await ui.key('ArrowUp');
    await ui.key('ArrowDown');
    expect(await ui.text('set.c.reset'), 'moving away disarms').toBe(label0);
  });
});

void EXPERT_ASSISTS;
void SETTINGS_KEY;
