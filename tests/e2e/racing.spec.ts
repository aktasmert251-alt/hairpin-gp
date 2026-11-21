// E-RC-03 flashback and E-RC-02 pit stop (testing-qc.md §3). Synthetic input goes through __APEX__.input (same latching as keys).
// Note: `pitLap=` is ignored in race mode; the stop is requested through the MFD (mfdNext opens it, mfd1 toggles the box request).

import type { Page } from '@playwright/test';
import type { ApexClient } from '../helpers/apexClient';
import { expect, test } from '../helpers/fixtures';
import { saveScreen } from '../helpers/screens';

const RACE = { mode: 'race', autostart: 1, autodrive: 1, skipLights: 1, ai: 3, seed: 1234, mute: 1 } as const;

test.describe('race extras', () => {
  test('E-RC-03 flashback: scrub -5 s, confirm -> raceMs back by ~5 s, one flashback used', async ({ apex, page }) => {
    test.setTimeout(120_000);
    await apex.open({ ...RACE, laps: 3 }, 'sceneReady', 90_000);
    await apex.waitForPhase('running', 30_000);
    await page.waitForFunction(() => (window.__APEX__.getRace()?.race.raceMs ?? 0) >= 12_000, undefined, { timeout: 60_000, polling: 100 });
    const left0 = (await apex.race())!.race.flashbacksLeft;
    expect(left0, 'flashbacks available').toBeGreaterThan(0);

    await apex.press('flashback', 80);
    await page.waitForFunction(() => window.__APEX__.getHud()?.flashback.open === true, undefined, { timeout: 5000 });
    const opened = (await apex.race())!.race.raceMs;
    for (let i = 0; i < 10; i++) { // 10 x 0.5 s
      await apex.press('menuLeft', 40);
      await page.waitForTimeout(80);
    }
    const hudOff = (await apex.getHud())!.flashback;
    expect(hudOff.offsetSec, 'timeline offset').toBeLessThanOrEqual(-4.5);
    await saveScreen(page, 'testci', 'e2e-flashback');
    // Keep resumed ticks out of the rewind measurement, including a slow screenshot/IPC round trip.
    await apex.setTimeScale(0);
    await apex.press('menuConfirm', 40);
    await page.waitForFunction(() => window.__APEX__.getHud()?.flashback.open === false, undefined, { timeout: 5000 });
    const after = (await apex.race())!;
    const delta = (opened - after.race.raceMs) / 1000;
    test.info().annotations.push({ type: 'flashback', description: `opened at ${opened} ms, after apply ${after.race.raceMs} ms (delta ${delta.toFixed(2)} s), offset ${hudOff.offsetSec}` });
    expect(delta, 'raceMs decreased by about 5 s').toBeGreaterThan(4);
    expect(delta).toBeLessThan(6.5);
    expect(after.race.flashbacksLeft).toBe(left0 - 1);
    expect(await apex.errors()).toEqual([]);
    await apex.setTimeScale(1);
  });

  /** Requests a stop through the MFD (mfdNext opens it, mfd1 toggles the box request) and waits until the service is over. */
  async function requestAndServeStop(apex: ApexClient, page: Page): Promise<{ compound0: string; selected: string; compound1: string; pitStops: number }> {
    await apex.open({ ...RACE, laps: 3, ai: 0, tyre: 'soft' }, 'sceneReady', 90_000);
    await apex.waitForPhase('running', 30_000);
    await page.waitForFunction(() => (window.__APEX__.getRace()?.race.raceMs ?? 0) >= 6_000, undefined, { timeout: 30_000, polling: 100 });
    const start = (await apex.telemetry(0))!;
    const compound0 = start.vehicle.compound;
    expect(start.race.pitStops).toBe(0);
    expect((await apex.race())!.cars.find((c) => c.isPlayer)!.lapsCompleted, 'request on lap 1').toBe(0);

    await apex.press('mfdNext', 50);
    await page.waitForFunction(() => window.__APEX__.getHud()?.mfd.open === true, undefined, { timeout: 5000 });
    await apex.press('mfd1', 50);
    await page.waitForFunction(() => window.__APEX__.getHud()?.mfd.boxRequested === true, undefined, { timeout: 5000 });
    // The suggestion can be the compound already fitted; pick another dry one with mfd2 so that "compound changed" is testable.
    let selected = (await apex.getHud())!.mfd.nextCompound;
    for (let i = 0; i < 4 && (selected === compound0 || selected === 'inter' || selected === 'wet'); i++) {
      await apex.press('mfd2', 50);
      await page.waitForTimeout(150);
      selected = (await apex.getHud())!.mfd.nextCompound;
    }
    expect(selected, 'a different dry compound is selected in the MFD').not.toBe(compound0);
    await saveScreen(page, 'testci', 'e2e-pit-request');
    await apex.setTimeScale(4); // sim runs faster than real time; results are tick-exact

    await page.waitForFunction(() => (window.__APEX__.getTelemetry(0)?.race.pitStops ?? 0) >= 1, undefined, { timeout: 200_000, polling: 200 });
    if (await page.waitForFunction(() => window.__APEX__.getHud()?.pit?.inLane === true, undefined, { timeout: 1000 }).then(() => true, () => false)) {
      await saveScreen(page, 'testci', 'e2e-pit');
    }
    // pitStops counts at pit entry; the tyres change once the service is over (HUD pit state returns to null).
    await page.waitForFunction(() => window.__APEX__.getHud()?.pit === null, undefined, { timeout: 60_000, polling: 100 });
    await apex.setTimeScale(1);
    const t = (await apex.telemetry(0))!;
    test.info().annotations.push({ type: 'pit', description: `fitted ${compound0}, MFD selected ${selected}, now ${t.vehicle.compound}, mask ${t.race.compoundsUsedMask}` });
    return { compound0, selected, compound1: t.vehicle.compound, pitStops: t.race.pitStops };
  }

  test('E-RC-02 pit stop: MFD box request on lap 1 of 3 -> exactly one stop, results show one stop', async ({ apex, page }) => {
    test.setTimeout(420_000);
    const r = await requestAndServeStop(apex, page);
    expect(r.pitStops).toBe(1);
    await apex.setTimeScale(4);
    // Telemetry is gone once the results screen shows, so sample the stop count while the race is still running.
    await page.evaluate(() => {
      const w = window as unknown as { __pit: number; __APEX__: { getTelemetry(c: number): { race: { pitStops: number } } | null } };
      w.__pit = 0;
      const id = setInterval(() => { const t = w.__APEX__.getTelemetry(0); if (t) w.__pit = Math.max(w.__pit, t.race.pitStops); else if (w.__pit > 0) clearInterval(id); }, 100);
    });
    await apex.waitForLap(3, 300_000);
    await expect.poll(() => apex.uiScreen(), { timeout: 60_000 }).toBe('results');
    expect(await page.evaluate(() => (window as unknown as { __pit: number }).__pit), 'one stop in total').toBe(1);
    await page.waitForTimeout(1200);
    await saveScreen(page, 'testci', 'e2e-pit-results');
    expect(await apex.errors()).toEqual([]);
  });

  // TS2-01 (fixed): under autodrive the MFD compound choice used to be ignored.
  test('E-RC-02b pit stop: the compound chosen in the MFD is fitted under autodrive (TS2-01 regression)', async ({ apex, page }) => {
    test.setTimeout(240_000);
    const r = await requestAndServeStop(apex, page);
    expect(r.compound1, 'compound changed to the MFD choice').toBe(r.selected);
  });
});
