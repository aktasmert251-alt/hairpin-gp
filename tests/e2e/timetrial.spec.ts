// E-TT-01 time trial and ghost (testing-qc.md §3): 2 laps by autodrive -> PB and ghost stored -> reload -> a new TT session uses the PB
// as delta reference and the stored PB ghost on its lap.

import { expect, test } from '../helpers/fixtures';
import { saveScreen } from '../helpers/screens';

const TT = { mode: 'tt', autostart: 1, autodrive: 1, seed: 4242, mute: 1 } as const;

test.describe('time trial', () => {
  test('E-TT-01 two laps -> PB saved -> reload -> TT shows the PB reference and ghost', async ({ apex, page }) => {
    test.setTimeout(360_000);
    await apex.open(TT, 'sceneReady', 90_000);
    expect((await apex.race())!.mode).toBe('timeTrial');
    await apex.setTimeScale(4); // sim runs faster than real time; results are tick-exact
    await apex.waitForLap(2, 300_000);
    await apex.setTimeScale(1);

    const stored = await page.evaluate(() => {
      const out: Record<string, string> = {};
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)!;
        if (k.startsWith('apexgp:v1:tt:') || k.startsWith('apexgp:v1:ghost:')) out[k] = localStorage.getItem(k)!;
      }
      return out;
    });
    const ttKey = Object.keys(stored).find((k) => k.startsWith('apexgp:v1:tt:'));
    const ghostKey = Object.keys(stored).find((k) => k.startsWith('apexgp:v1:ghost:'));
    expect(ttKey, 'PB record stored').toBeTruthy();
    expect(ghostKey, 'PB ghost stored').toBeTruthy();
    const pb = JSON.parse(stored[ttKey!]!) as { pbMs: number; sectors: number[]; top10: { ms: number }[] };
    test.info().annotations.push({ type: 'pb', description: `pbMs ${pb.pbMs}, top10 ${pb.top10.length}, ghost ${stored[ghostKey!]!.length} chars` });
    expect(pb.pbMs).toBeGreaterThan(60_000);
    expect(pb.pbMs).toBeLessThan(150_000);
    expect(pb.top10.length).toBeGreaterThanOrEqual(1);
    expect(stored[ghostKey!]!.length).toBeGreaterThan(1000);
    expect(await apex.errors()).toEqual([]);

    // Reload: storage persists (the fixture only clears it once per tab); a fresh TT session reads the PB as its delta reference.
    await page.reload({ waitUntil: 'load' });
    await apex.whenReady('sceneReady', 90_000);
    expect(await page.evaluate((k) => localStorage.getItem(k) !== null, ttKey!), 'PB survived the reload').toBe(true);
    await expect.poll(async () => (await apex.getHud())?.timing.deltaRef ?? null, { timeout: 20_000 }).toBe('pb');
    await apex.waitForSpeed(60, 30_000);
    await page.waitForTimeout(1500);
    await saveScreen(page, 'testci', 'e2e-tt-ghost');
    expect(await apex.errors()).toEqual([]);
  });
});
