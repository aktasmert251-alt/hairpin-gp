// Screenshot saving with the "not blank" gate (luma stdDev > 8). Files go to test-results/screens/<dir>/<name>.png.

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { assertNotBlank, lumaStats, type LumaStats } from './png';
import { SCREENS_DIR, rel } from './paths';

export interface SavedScreen { file: string; relPath: string; stats: LumaStats }

/** Presents two frames, captures the viewport, writes the PNG and fails when the frame is blank. */
export async function saveScreen(page: Page, dir: string, name: string, opts: { requireNotBlank?: boolean } = {}): Promise<SavedScreen> {
  await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
  const buf = await page.screenshot({ type: 'png' });
  const file = path.join(SCREENS_DIR, dir, `${name}.png`);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, buf);
  const label = rel(file);
  if (opts.requireNotBlank === false) {
    return { file, relPath: label, stats: lumaStats(buf) };
  }
  return { file, relPath: label, stats: assertNotBlank(buf, label) };
}
