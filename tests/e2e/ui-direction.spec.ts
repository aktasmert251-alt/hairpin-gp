// D-040 (5) menu Left/Right direction: walks EVERY value row (stepper, toggle, slider, key chips) of every menu
// screen with both ArrowLeft/ArrowRight and A/D. ← must move to the previous / left value (or stay at the first),
// → to the next / right value (or stay at the last); never the opposite (no wrap from the first value to the last).
// Run: APEX_BASE_URL=http://localhost:5179 npx playwright test tests/e2e/ui-direction.spec.ts --project=e2e

import type { Page } from '@playwright/test';
import { expect, test } from '../helpers/fixtures';
import { UI_BASE, Ui } from '../helpers/uiDriver';

test.use({ baseURL: UI_BASE });
test.describe.configure({ mode: 'default' });

const PAIRS: [string, string][] = [['ArrowLeft', 'ArrowRight'], ['KeyA', 'KeyD']];
async function rowKey(ui: Ui, code: string): Promise<void> {
  await ui.key(code, 0);
  // Let the changed showroom/control render before issuing another model change.
  await ui.apex.nextFrames(2);
}

type Kind = 'step' | 'toggle' | 'slider' | 'bind' | 'other';

/** Value rows of the active screen (visible pane only), in DOM order. */
function rowIds(page: Page): Promise<{ id: string; kind: Kind }[]> {
  return page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.apx-screen[data-active="1"] .m-row[data-focus-id]')]
    .filter((e) => !e.closest('[hidden]') && e.getClientRects().length > 0)
    .map((e) => ({
      id: e.dataset.focusId!,
      kind: (e.querySelector('.c-step') ? 'step' : e.getAttribute('role') === 'switch' ? 'toggle' : e.getAttribute('role') === 'slider' ? 'slider' : e.classList.contains('m-bind') ? 'bind' : 'other') as Kind,
    })));
}

function bindSlot(page: Page, id: string): Promise<number> {
  return page.evaluate((i) => [...document.querySelectorAll(`[data-focus-id="${i}"] .apx-kc`)].findIndex((c) => c.classList.contains('is-focus')), id);
}

function sliderBounds(page: Page, id: string): Promise<{ min: number; max: number }> {
  return page.evaluate((i) => {
    const e = document.querySelector(`[data-focus-id="${i}"]`)!;
    return { min: Number(e.getAttribute('aria-valuemin')), max: Number(e.getAttribute('aria-valuemax')) };
  }, id);
}

/** Checks one focused row with both key pairs. */
async function walkRow(ui: Ui, page: Page, id: string, kind: Kind): Promise<void> {
  for (const [L, R] of PAIRS) {
    if (kind === 'step') {
      const n = (await ui.stepIndex(id)).count;
      for (let k = 0; k < n; k++) {
        const a = (await ui.stepIndex(id)).index;
        await rowKey(ui, L);
        const b = (await ui.stepIndex(id)).index;
        expect(b, `${id}: ${L} from index ${a} must go to ${Math.max(0, a - 1)}`).toBe(Math.max(0, a - 1));
      }
      for (let k = 0; k < n; k++) {
        const s = await ui.stepIndex(id);
        await rowKey(ui, R);
        const b = (await ui.stepIndex(id)).index;
        expect(b, `${id}: ${R} from index ${s.index}/${s.count} must go to ${Math.min(s.count - 1, s.index + 1)}`).toBe(Math.min(s.count - 1, s.index + 1));
      }
    } else if (kind === 'toggle') {
      for (const [key, v] of [[L, false], [L, false], [R, true], [R, true], [L, false]] as const) {
        await rowKey(ui, key);
        expect(await ui.toggleValue(id), `${id}: ${key} selects the ${v ? 'right (ON)' : 'left (OFF)'} segment`).toBe(v);
      }
    } else if (kind === 'slider') {
      const { min, max } = await sliderBounds(page, id);
      for (const [key, d] of [[L, -1], [L, -1], [L, -1], [R, 1], [R, 1], [R, 1]] as const) {
        const a = await ui.sliderValue(id);
        await rowKey(ui, key);
        const b = await ui.sliderValue(id);
        if ((d < 0 && a <= min) || (d > 0 && a >= max)) expect(b, `${id}: ${key} at the end stays`).toBe(a);
        else if (d < 0) expect(b, `${id}: ${key} from ${a} must decrease`).toBeLessThan(a);
        else expect(b, `${id}: ${key} from ${a} must increase`).toBeGreaterThan(a);
      }
    } else if (kind === 'bind') {
      await rowKey(ui, R);
      expect(await bindSlot(page, id), `${id}: ${R} picks the right chip`).toBe(1);
      await rowKey(ui, L);
      expect(await bindSlot(page, id), `${id}: ${L} picks the left chip`).toBe(0);
    }
    await ui.expectFocus(id, `${id}: focus stays on the row after ${L}/${R}`);
  }
}

async function walkScreen(ui: Ui, page: Page, skip: (id: string) => boolean = () => false): Promise<number> {
  const rows = await rowIds(page);
  let n = 0;
  for (const r of rows) {
    if (r.kind === 'other' || skip(r.id)) continue;
    if (r.id === 'race.opponents') {
      await ui.focusViaKeys('race.aiEnabled');
      await rowKey(ui, 'ArrowRight');
    }
    await ui.focusViaKeys(r.id);
    await walkRow(ui, page, r.id, r.kind);
    n++;
  }
  return n;
}

test.describe('UI keys: Left/Right direction on every value row (D-040)', () => {
  test('UD-01 time trial setup + race setup (conditions, team grid + driver, settings, assists)', async ({ apex, page }) => {
    test.setTimeout(240_000);
    const ui = new Ui(apex, page);
    await ui.toMainMenu();
    await ui.goTo('ttSetup');
    expect(await walkScreen(ui, page), 'TT rows walked').toBeGreaterThanOrEqual(6);
    await ui.key('Escape', 500);
    await ui.waitScreen('mainMenu');
    await ui.goTo('raceConditions');
    expect(await walkScreen(ui, page), 'conditions rows walked').toBe(4);
    await ui.focusViaKeys('raceConditions.cta');
    await ui.key('Enter', 400);
    await ui.waitScreen('teamSelect');
    // Team tiles: a 2-column grid; ← goes to the left column, → to the right one.
    await ui.key('Home', 120);
    const tiles = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.apx-screen[data-active="1"] .m-tile')].map((e) => e.dataset.focusId!));
    for (const [L, R] of PAIRS) {
      await rowKey(ui, R);
      await ui.expectFocus(tiles[1]!, `${R} on the first tile goes right`);
      await rowKey(ui, R);
      await ui.expectFocus(tiles[1]!, `${R} on the right column stays`);
      await rowKey(ui, L);
      await ui.expectFocus(tiles[0]!, `${L} goes back left`);
      await rowKey(ui, L);
      await ui.expectFocus(tiles[0]!, `${L} on the left column stays`);
    }
    expect(await walkScreen(ui, page), 'driver row walked; custom teams are online only (D-062)').toBe(1);
    await ui.focusViaKeys('teamSelect.cta');
    await ui.key('Enter', 400);
    await ui.waitScreen('raceSettings');
    expect(await walkScreen(ui, page), 'race settings rows walked, including safety car').toBe(7);
    await ui.focusViaKeys('raceSettings.cta');
    await ui.key('Enter', 400);
    await ui.waitScreen('assists');
    expect(await walkScreen(ui, page), 'assist rows walked').toBe(11);
  });

  test('UD-02 settings: every row of all 7 tabs', async ({ apex, page }) => {
    test.setTimeout(300_000);
    const ui = new Ui(apex, page);
    await ui.toMainMenu();
    await ui.goTo('settings');
    for (const tab of ['graphics', 'audio', 'controls', 'assists', 'hud', 'language', 'interface']) {
      await ui.focusViaKeys(`settings.tab.${tab}`);
      await ui.key('ArrowRight', 150); // tabs -> rows
      const n = await walkScreen(ui, page);
      expect(n, `${tab}: rows walked`).toBeGreaterThanOrEqual(1);
      await ui.key('Escape', 150); // rows -> tabs
    }
  });
});
