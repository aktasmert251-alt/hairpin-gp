// E-AU-01 (testing-qc.md §3): a key press on the title unlocks audio; ?scene=audio&offline=1 renders offline.
// Written against the title-screen path only (the Lead is widening unlock to any first gesture in parallel).

import { expect, test } from '../helpers/fixtures';
import { key } from '../helpers/menu';

test.describe('audio', () => {
  test('E-AU-01 title key press unlocks audio', async ({ apex, page }) => {
    test.setTimeout(90_000);
    await apex.open('/', 'sceneReady');
    expect(await apex.state()).toBe('title');
    expect((await page.evaluate(() => window.__APEX__.audio())).unlocked, 'locked before any gesture').toBe(false);
    await page.waitForTimeout(400);
    await key(page, 'Space', 500);
    await expect.poll(() => page.evaluate(() => window.__APEX__.audio().unlocked), { timeout: 10_000 }).toBe(true);
  });

  test('E-AU-01 ?scene=audio&offline=1 renders a 20-car replay offline, twice, bit-identical', async ({ apex, page }) => {
    test.setTimeout(180_000);
    // offline=1 renders the 2 s engine bench on creation; replay=30 records a 20-car replay and renders 30 s of it twice.
    await apex.goto('/?scene=audio&offline=1&replay=30');
    await page.waitForFunction(() => Boolean((window as unknown as { __replayAudio?: unknown }).__replayAudio), undefined, { timeout: 120_000 });
    const r = await page.evaluate(() => (window as unknown as { __replayAudio: { secs: number; ms: number; h1: string; h2: string; length: number } }).__replayAudio);
    test.info().annotations.push({ type: 'offline-audio', description: JSON.stringify(r) });
    expect(r.secs).toBe(30);
    expect(r.length).toBe(30 * 48000);
    expect(r.h1, 'two renders give identical sample hashes').toBe(r.h2);
    expect(r.ms / 1000, 'S9 accept: 30 s at 48 kHz in <= 20 s wall time').toBeLessThanOrEqual(20);
  });
});

