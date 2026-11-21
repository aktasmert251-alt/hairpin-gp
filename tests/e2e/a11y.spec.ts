// E-A11-01 reduced motion (testing-qc.md §3): emulateMedia reducedMotion + ui.animations 'auto' -> nothing animates in the UI.
// A no-preference control run on the same screen proves the probe can see transitions at all.

import type { Page } from '@playwright/test';
import { expect, test } from '../helpers/fixtures';
import { saveScreen } from '../helpers/screens';
import { toMainMenu } from '../helpers/menu';

/** Elements under #ui whose computed transition/animation duration is > 0, plus every live Web Animation in the document. */
function probe(page: Page): Promise<{ elements: number; animated: number; sample: string[]; liveAnimations: number }> {
  return page.evaluate(() => {
    const longest = (s: string): number => Math.max(...s.split(',').map((x) => parseFloat(x) * (x.includes('ms') ? 0.001 : 1)));
    const els = [...document.querySelectorAll('#ui *')];
    const animated = els.filter((e) => {
      const cs = getComputedStyle(e);
      return longest(cs.transitionDuration) > 0 || longest(cs.animationDuration) > 0;
    });
    return {
      elements: els.length,
      animated: animated.length,
      sample: animated.slice(0, 5).map((e) => `${e.className} ${getComputedStyle(e).transitionDuration}`),
      liveAnimations: document.getAnimations().length,
    };
  });
}

test.describe('accessibility', () => {
  test('E-A11-01 reduced motion: no element transitions or animates (ui.animations = auto)', async ({ apex, page }) => {
    test.setTimeout(90_000);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await toMainMenu(apex, page);
    await page.waitForTimeout(1500); // let the entry animation (if any) finish
    expect((await page.evaluate(() => JSON.parse(localStorage.getItem('apexgp:v1:settings') ?? '{"ui":{"animations":"auto"}}').ui.animations))).toBe('auto');
    const p = await probe(page);
    expect(p.elements, '#ui has content').toBeGreaterThan(100);
    expect(p.animated, `animated elements: ${JSON.stringify(p.sample)}`).toBe(0);
    expect(p.liveAnimations, 'live Web Animations').toBe(0);
    await saveScreen(page, 'testci', 'e2e-reduced-motion');
  });

  test('E-A11-01 control: with no-preference the same screen does transition', async ({ apex, page }) => {
    test.setTimeout(90_000);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await toMainMenu(apex, page);
    await page.waitForTimeout(1500);
    expect((await probe(page)).animated, 'probe sees transitions when motion is allowed').toBeGreaterThan(0);
  });
});
