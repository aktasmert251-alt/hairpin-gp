// Leak suite (testing-qc.md §2.7). Project `leak` (npx playwright test --project=leak). Error gate: tests/helpers/fixtures.ts.
//   L-03  5 x quality preset switch: programs (+1) and geometries/textures (+2 %) stay constant after the second cycle        [Sprint 1]
//   L-01  5 x (start race -> 10 s -> quit to menu via the pause menu): geometries/textures within +-2 %, heap within +10 %
//   L-02  5 x walk every menu screen (menu sandbox probe window.__uiMotion): DOM node count and GSAP timeline children back to baseline

import { expect, test } from '../helpers/fixtures';
import type { QualityId } from '../../src/contracts/common';

// L-01 reads the JS heap after a forced GC (a sawtooth of 120-200 MB without it), so Chrome needs --expose-gc + precise memory info.
test.use({ launchOptions: { args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--js-flags=--expose-gc', '--enable-precise-memory-info'] } });

const CYCLE: QualityId[] = ['low', 'medium', 'high', 'ultra'];

test.describe('leak', () => {
  test('L-03 5 x quality preset switch keeps programs, geometries and textures stable after the second cycle', async ({ apex }) => {
    test.setTimeout(240_000);
    await apex.open({ mode: 'race', autostart: 1, autodrive: 1, laps: 3, ai: 3, skipLights: 1, seed: 777, mute: 1, quality: 'high' }, 'sceneReady', 120_000);
    expect(await apex.state()).toBe('session');
    // Hold the sim still: a driving car streams new track/scenery chunks (geometry count grows with distance), which is not a preset leak.
    await apex.nextFrames(60);
    await apex.setTimeScale(0);
    await apex.nextFrames(30);

    const afterCycle: { programs: number; geometries: number; textures: number }[] = [];
    for (let cycle = 1; cycle <= 5; cycle++) {
      for (const q of CYCLE) {
        await apex.setQuality(q);
        await apex.nextFrames(30);
      }
      await apex.setQuality('high');
      await apex.nextFrames(60);
      const r = (await apex.perf()).renderer;
      afterCycle.push({ programs: r.programs, geometries: r.geometries, textures: r.textures });
    }
    test.info().annotations.push({ type: 'cycles', description: JSON.stringify(afterCycle) });
    const base = afterCycle[1]!;
    for (let i = 2; i < afterCycle.length; i++) {
      const c = afterCycle[i]!;
      // +1 is tolerated: a live session can compile one more variant when new content comes into view (not a preset-switch leak).
      expect(c.programs, `programs after cycle ${i + 1} vs cycle 2 (${JSON.stringify(afterCycle)})`).toBeLessThanOrEqual(base.programs + 1);
      expect(c.geometries, `geometries after cycle ${i + 1} vs cycle 2 (${JSON.stringify(afterCycle)})`).toBeLessThanOrEqual(Math.ceil(base.geometries * 1.02));
      expect(c.textures, `textures after cycle ${i + 1} vs cycle 2 (${JSON.stringify(afterCycle)})`).toBeLessThanOrEqual(Math.ceil(base.textures * 1.02));
    }
  });

  test('L-01 5 x (start race -> 10 s -> quit to menu): geometries/textures within +-2 %, JS heap within +10 %', async ({ apex, page }) => {
    test.setTimeout(420_000);
    await apex.open('/', 'sceneReady');
    await page.waitForTimeout(400);
    await page.keyboard.press('Space');
    await apex.waitForState('menu', 15_000);
    const runs: { geometries: number; textures: number; programs: number; heapMB: number; atMenu: { geometries: number; textures: number } }[] = [];
    for (let i = 1; i <= 5; i++) {
      await apex.startSession({ mode: 'race', laps: 3, aiCount: 3, autodrive: true, skipLights: true, seed: 777 });
      expect(await apex.state()).toBe('session');
      await apex.waitForPhase('running', 30_000);
      await page.waitForFunction(() => (window.__APEX__.getRace()?.race.raceMs ?? 0) >= 10_000, undefined, { timeout: 60_000, polling: 100 });
      const p = await apex.perf();
      // Pause menu -> MENÜYE DÖN -> confirm (real quit-to-menu flow).
      await page.keyboard.press('Escape');
      await expect.poll(() => apex.uiScreen(), { timeout: 5000 }).toBe('pause');
      for (let n = 0; n < 8 && (await apex.focusId()) !== 'pause.quit'; n++) { await page.keyboard.press('ArrowDown'); await page.waitForTimeout(150); }
      expect(await apex.focusId()).toBe('pause.quit');
      await page.keyboard.press('Enter');
      await page.waitForTimeout(300);
      await page.keyboard.press('ArrowLeft');
      await page.waitForTimeout(200);
      if ((await apex.focusId()) !== 'pause.confirm.yes') await page.keyboard.press('ArrowUp');
      await page.waitForTimeout(200);
      expect(await apex.focusId()).toBe('pause.confirm.yes');
      await page.keyboard.press('Enter');
      await apex.waitForState('menu', 30_000);
      await expect.poll(() => apex.uiScreen(), { timeout: 10_000 }).toBe('mainMenu');
      await page.waitForTimeout(1500);
      await page.evaluate(async () => { const g = (window as unknown as { gc?: () => void }).gc; for (let k = 0; k < 3; k++) { g?.(); await new Promise((r) => setTimeout(r, 100)); } });
      const m = await apex.perf();
      runs.push({ geometries: p.renderer.geometries, textures: p.renderer.textures, programs: p.renderer.programs, heapMB: m.heapMB, atMenu: { geometries: m.renderer.geometries, textures: m.renderer.textures } });
    }
    test.info().annotations.push({ type: 'runs', description: JSON.stringify(runs) });
    const base = runs[0]!;
    for (let i = 1; i < runs.length; i++) {
      const r = runs[i]!;
      expect(r.geometries, `geometries run ${i + 1} vs run 1 (${JSON.stringify(runs)})`).toBeLessThanOrEqual(Math.ceil(base.geometries * 1.02));
      expect(r.geometries, `geometries run ${i + 1} vs run 1`).toBeGreaterThanOrEqual(Math.floor(base.geometries * 0.98));
      expect(r.textures, `textures run ${i + 1} vs run 1 (${JSON.stringify(runs)})`).toBeLessThanOrEqual(Math.ceil(base.textures * 1.02));
      expect(r.textures, `textures run ${i + 1} vs run 1`).toBeGreaterThanOrEqual(Math.floor(base.textures * 0.98));
      if (base.heapMB > 0) expect(r.heapMB, `JS heap run ${i + 1} vs run 1 (heap after GC at the main menu; ${JSON.stringify(runs)})`).toBeLessThanOrEqual(base.heapMB * 1.1);
    }
  });

  test('L-02 5 x open/close every menu screen: DOM node count and GSAP global timeline children back to baseline', async ({ apex, page }) => {
    test.setTimeout(240_000);
    // The menu sandbox exposes the GSAP probe (window.__uiMotion); the production page does not expose gsap.
    await apex.open('/?scene=menu&screen=mainMenu', 'sceneReady', 60_000);
    await page.waitForFunction(() => Boolean((window as unknown as { __uiMotion?: unknown }).__uiMotion), undefined, { timeout: 15_000 });
    type Motion = { children(): number; show(s: string): void; hide(): void; screens: string[] };
    const snap = (): Promise<{ dom: number; gsap: number }> => page.evaluate(() => {
      const m = (window as unknown as { __uiMotion: Motion }).__uiMotion;
      return { dom: document.querySelectorAll('*').length, gsap: m.children() };
    });
    const screens = await page.evaluate(() => (window as unknown as { __uiMotion: Motion }).__uiMotion.screens);
    expect(screens.length, 'screen list').toBeGreaterThanOrEqual(10);
    const walk = async (): Promise<void> => {
      for (const s of screens) {
        await page.evaluate((id) => (window as unknown as { __uiMotion: Motion }).__uiMotion.show(id), s);
        await page.waitForTimeout(450);
      }
      await page.evaluate(() => (window as unknown as { __uiMotion: Motion }).__uiMotion.hide());
      await page.evaluate(() => (window as unknown as { __uiMotion: Motion }).__uiMotion.show('mainMenu'));
      await page.waitForTimeout(800);
    };
    await walk(); // warm-up pass: lazy screens build their DOM once
    const base = await snap();
    const after: { dom: number; gsap: number }[] = [];
    for (let i = 0; i < 5; i++) {
      await walk();
      after.push(await snap());
    }
    test.info().annotations.push({ type: 'baseline-vs-cycles', description: JSON.stringify({ base, after }) });
    for (const [i, a] of after.entries()) {
      expect(a.dom, `DOM nodes after cycle ${i + 1} (${JSON.stringify({ base, after })})`).toBeLessThanOrEqual(Math.ceil(base.dom * 1.01));
      expect(a.gsap, `GSAP timeline children after cycle ${i + 1} (${JSON.stringify({ base, after })})`).toBeLessThanOrEqual(base.gsap);
    }
  });
});
