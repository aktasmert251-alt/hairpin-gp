// Grafik-UI regression (user report after a33319d: "← sometimes sticks, or it goes forward and then corrects itself").
// Root cause: hover-to-focus listened to `pointerover`, which Chrome also dispatches when content moves under a
// cursor that is NOT moving (focused team tile lifting/dropping 4 px, the settings column scrolling, a screen sliding
// in). The parked cursor then stole focus back from the keyboard. Hover must follow real pointer movement only.
// Run: APEX_BASE_URL=http://localhost:5179 npx playwright test tests/e2e/ui-arrows.spec.ts --project=e2e

import type { Page } from '@playwright/test';
import { expect, test } from '../helpers/fixtures';
import { UI_BASE, Ui } from '../helpers/uiDriver';

test.use({ baseURL: UI_BASE });
test.describe.configure({ mode: 'default' });

/** Displayed value of a control on the visible screen (stepper text, slider value or toggle state). */
function valueOf(page: Page, id: string): Promise<string> {
  return page.evaluate((i) => {
    const el = document.querySelector(`.apx-screen[data-active="1"] [data-focus-id="${i}"]`);
    const v = el?.querySelector('.c-step .val') ?? el?.querySelector('.c-slider .v');
    if (v) return v.textContent ?? '';
    return el?.querySelector<HTMLElement>('.c-seg')?.dataset.on ?? '';
  }, id);
}

/** OS-style auto-repeat: one keydown, a 300 ms delay, then repeat keydowns every 33 ms (Playwright marks them repeat). */
async function holdKey(page: Page, code: string, ms: number): Promise<void> {
  await page.keyboard.down(code);
  await page.waitForTimeout(300);
  for (let t = 300; t < ms; t += 33) {
    await page.keyboard.down(code);
    await page.waitForTimeout(33);
  }
  await page.keyboard.up(code);
}

test.describe('UI arrows: keyboard focus is not stolen by a parked cursor', () => {
  test('UA-01 team tiles: → stays on the next tile when the cursor rests where the focused tile used to be', async ({ apex, page }) => {
    const ui = new Ui(apex, page);
    await ui.toMainMenu();
    await ui.goTo('teamSelect');
    const first = (await ui.focusId())!;
    const b = await ui.box(first); // the focused tile is lifted 4 px: park the cursor in the band it uncovers when it drops
    await page.mouse.move(b.x + b.w / 2, b.y + b.h + 2, { steps: 3 });
    await page.waitForTimeout(400);
    expect(await ui.focusId()).toBe(first);
    for (let n = 0; n < 3; n++) {
      await ui.key('ArrowRight', 450);
      const right = await ui.focusId();
      expect(right, `→ #${n} must stay on the right tile (the tile under the parked cursor must not take focus back)`).not.toBe(first);
      await ui.key('ArrowLeft', 450);
      expect(await ui.focusId(), `← #${n} returns to the left tile`).toBe(first);
    }
    // Quick taps.
    for (const k of ['ArrowRight', 'ArrowLeft', 'ArrowRight']) await ui.key(k, 40);
    await page.waitForTimeout(450);
    expect(await ui.focusId(), 'rapid →←→ ends on the right tile').not.toBe(first);
    // A real pointer move still focuses what is under the cursor.
    await page.mouse.move(b.x + b.w / 2, b.y + b.h / 2, { steps: 3 });
    await page.waitForTimeout(200);
    expect(await ui.focusId(), 'a real hover still focuses the tile').toBe(first);
  });

  test('UA-02 settings: ↓ scrolls rows under a parked cursor, ←/→ act on the keyboard row only', async ({ apex, page }) => {
    const ui = new Ui(apex, page);
    await ui.toMainMenu();
    await ui.openSettingsTab('graphics');
    await ui.key('ArrowRight', 300); // rows level, first row
    await ui.hover('set.g.ao'); // a real hover: focus row 4, then the cursor stays there
    await ui.expectFocus('set.g.ao', 'hover');
    const order = ['set.g.bloom', 'set.g.mirrors', 'set.g.trees', 'set.g.crowd', 'set.g.fov'];
    for (const id of order) {
      await ui.key('ArrowDown', 260); // the column scrolls (180 ms) under the cursor
      await ui.expectFocus(id, 'keyboard ↓ with the cursor parked over the rows');
    }
    const fov0 = await valueOf(page, 'set.g.fov');
    const ao0 = await valueOf(page, 'set.g.ao');
    for (const k of ['ArrowLeft', 'ArrowRight', 'ArrowLeft']) await ui.key(k, 40);
    await page.waitForTimeout(300);
    await ui.expectFocus('set.g.fov', 'after ←→←');
    await holdKey(page, 'ArrowLeft', 700);
    await page.waitForTimeout(300);
    await ui.expectFocus('set.g.fov', 'after holding ←');
    expect(await valueOf(page, 'set.g.fov'), 'held ← lowers the keyboard row').not.toBe(fov0);
    expect(await valueOf(page, 'set.g.ao'), 'the row under the cursor is untouched').toBe(ao0);
  });

  test('UA-03 race setup: ←/→/A/D, quick taps and held repeat with the cursor over another row; clamp at the ends', async ({ apex, page }) => {
    const ui = new Ui(apex, page);
    await ui.toMainMenu();
    await ui.goTo('raceConditions');
    await ui.hover('race.tod');
    await ui.focusViaKeys('race.laps');
    const laps = (): Promise<string> => valueOf(page, 'race.laps');
    await holdKey(page, 'ArrowLeft', 600);
    const min = await laps();
    await ui.key('ArrowLeft', 200);
    expect(await laps(), '← at the minimum clamps').toBe(min);
    await ui.key('ArrowRight', 200);
    const second = await laps();
    expect(second).not.toBe(min);
    for (const k of ['ArrowLeft', 'ArrowRight', 'ArrowLeft', 'KeyD', 'KeyA']) await ui.key(k, 30);
    await page.waitForTimeout(300);
    await ui.expectFocus('race.laps', 'after the quick taps');
    expect(await laps(), '←→←DA from the 2nd value ends on the minimum').toBe(min);
    await holdKey(page, 'ArrowRight', 900);
    const max = await laps();
    await ui.key('KeyD', 200);
    expect(await laps(), '→ at the maximum clamps').toBe(max);
    await ui.expectFocus('race.laps', 'after holding →');
  });

  test('UA-04 entering a screen with the cursor resting over a row keeps the keyboard focus on the first row', async ({ apex, page }) => {
    const ui = new Ui(apex, page);
    await ui.toMainMenu();
    await ui.goTo('raceConditions');
    await ui.hover('race.laps');
    await ui.key('Escape', 400);
    await ui.waitScreen('mainMenu');
    await ui.key('Enter', 600); // main.quickRace is restored; the cursor has not moved
    await ui.waitScreen('raceConditions');
    await ui.expectFocus('race.track', 'first row after entering, cursor parked over race.laps');
    await ui.key('ArrowRight', 300);
    await ui.expectFocus('race.track', '→ acts on the first row');
  });
});
