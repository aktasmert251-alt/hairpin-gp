// Playwright global setup: warm the Vite dev server once so that the first test does not hit dependency optimisation
// ("optimized dependencies changed. reloading") or a cold transform of the whole module graph. Never fails the run.

import { chromium, type FullConfig } from '@playwright/test';

export default async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL = config.projects[0]?.use.baseURL;
  if (!baseURL) return;
  const t0 = Date.now();
  try {
    const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
      await page.goto(new URL('/?scene=skeleton&freeze=1', baseURL).toString(), { waitUntil: 'load', timeout: 60_000 });
      await page.waitForFunction(() => Boolean((window as unknown as { __APEX__?: { sceneReady: boolean } }).__APEX__?.sceneReady), undefined, { timeout: 60_000 });
      // A second navigation picks up any re-optimised dependency graph.
      await page.reload({ waitUntil: 'load' });
      await page.waitForFunction(() => Boolean((window as unknown as { __APEX__?: { sceneReady: boolean } }).__APEX__?.sceneReady), undefined, { timeout: 60_000 });
    } finally {
      await browser.close();
    }
    console.log(`[globalSetup] dev server warm in ${Date.now() - t0} ms`);
  } catch (err) {
    console.warn(`[globalSetup] warm-up skipped: ${err instanceof Error ? err.message : String(err)}`);
  }
}
