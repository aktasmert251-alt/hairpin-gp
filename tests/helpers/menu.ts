// Keyboard helpers for the menu E2E specs (page.keyboard only; `__APEX__.ui` is read for screen / focus ids).

import type { Page } from '@playwright/test';
import type { ApexClient } from './apexClient';

export const SETTINGS_KEY = 'apexgp:v1:settings';

export async function key(page: Page, k: string, wait = 220): Promise<void> {
  await page.keyboard.press(k);
  await page.waitForTimeout(wait);
}

/** Boot to the title, press Space and wait for the main menu. */
export async function toMainMenu(apex: ApexClient, page: Page): Promise<void> {
  await apex.open('/', 'sceneReady');
  await page.waitForTimeout(400);
  await key(page, 'Space');
  await apex.waitForState('menu', 15_000);
  await waitScreen(apex, 'mainMenu');
}

export async function waitScreen(apex: ApexClient, id: string, timeout = 10_000): Promise<void> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if ((await apex.uiScreen()) === id) return;
    await apex.page.waitForTimeout(100);
  }
  throw new Error(`ui.screen() never became "${id}" (now "${await apex.uiScreen()}")`);
}

/** Moves focus (ArrowDown, then ArrowUp if the end of the list is reached) until `ui.focusId()` equals `id`. */
export async function focusOn(apex: ApexClient, page: Page, id: string, max = 40): Promise<void> {
  for (const step of ['ArrowDown', 'ArrowUp']) {
    let prev = '';
    for (let i = 0; i < max; i++) {
      const f = (await apex.focusId()) ?? '';
      if (f === id) return;
      if (f === prev) break; // end of the list
      prev = f;
      await key(page, step, 120);
    }
  }
  if ((await apex.focusId()) !== id) throw new Error(`could not focus "${id}" (focus is "${await apex.focusId()}")`);
}

/** Reads and parses the persisted settings (debounced writes: waits past 500 ms first). */
export async function storedSettings(page: Page): Promise<any> {
  await page.waitForTimeout(800);
  const raw = await page.evaluate((k) => localStorage.getItem(k), SETTINGS_KEY);
  return raw ? JSON.parse(raw) : null;
}
