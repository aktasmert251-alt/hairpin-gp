// T3 screenshot gallery (V-01, E-SH-01): PNGs in test-results/screens/gallery/ plus index.json.
//
//   npx playwright test --project=visual                 sandbox scenes + İstanbul points (day-dry, High) + race-start (day-dry)
//   APEX_GALLERY=full npx playwright test --project=visual   the full matrix of testing-qc.md §3 (42 + 4 + race-start x 6)
//   APEX_GALLERY=scenes ...                              scenes only
//
// Every PNG must pass the "not blank" check (luma standard deviation > 8 on 0..255) and every test runs the error gate of
// tests/helpers/fixtures.ts. Visual quality is judged by QC from the pictures; there is no pixel diff.
// Scenes that do not exist yet are skipped with a warning (hand-off H5); points need the real İstanbul track and real graphics.

import { expect, test } from '../helpers/fixtures';
import { isStatusReal } from '../helpers/moduleStatus';
import { listSceneIds } from '../helpers/paths';
import { saveScreen } from '../helpers/screens';
import { urlWith, type ApexClient } from '../helpers/apexClient';
import { CONDITIONS, EXPECTED_SPRINT1_SCENES, OSM_LENGTH, POINTS, SCENE_COMMON, SCENE_VARIANTS, pointFileStem, pointRuns, type Condition } from './points';
import { mergeGalleryIndex, writeEntry } from './galleryIndex';

const MODE = process.env.APEX_GALLERY ?? 'quick';
const FULL = MODE === 'full';
const WANT_SCENES = MODE !== 'points';
const WANT_POINTS = MODE !== 'scenes';

const presentScenes = listSceneIds();

test.afterAll(() => {
  mergeGalleryIndex();
});

// ---- scenes ---------------------------------------------------------------------------------------------------------------------

test.describe('V-01 sandbox scenes', () => {
  test.skip(!WANT_SCENES, 'APEX_GALLERY=points');

  for (const id of EXPECTED_SPRINT1_SCENES) {
    if (presentScenes.includes(id)) continue;
    test(`scene ${id} (not present yet, hand-off H5)`, () => {
      console.warn(`[gallery] WARNING: sandbox scene "${id}" has no file yet (src/**/sandbox/${id}.scene.ts); skipped.`);
      test.skip(true, `scene "${id}" is not present yet (hand-off H5)`);
    });
  }

  for (const id of presentScenes) {
    const variants = [{ name: '', params: {} }, ...(SCENE_VARIANTS[id] ?? []).map((v) => ({ name: `-${v.name}`, params: v.params }))];
    for (const variant of variants) {
      test(`V-01 scene ${id}${variant.name}`, async ({ apex, page }) => {
        const params = { scene: id, ...SCENE_COMMON, ...variant.params };
        await apex.goto(params);
        await apex.whenReady('sceneReady', 60_000);
        await apex.nextFrames(20);
        await page.waitForTimeout(300);
        const shot = await saveScreen(page, 'gallery', `scene-${id}${variant.name}`);
        writeEntry({
          path: shot.relPath, kind: 'scene', scene: id, params: { ...params }, lumaMean: shot.stats.mean, lumaStdDev: shot.stats.stdDev, gpu: await apex.gpu(),
        });
      });
    }
  }
});

// ---- İstanbul screenshot points (testing-qc.md §3) ------------------------------------------------------------------------------

interface TrackGeo { id: string; length: number }

// Imported through the dev server (the page reports which track loadTrack() returns, hand-off H1). Not available in a built
// preview page: run the points gallery against `vite` (dev), the sandbox scenes work on either.
async function trackGeo(apex: ApexClient): Promise<TrackGeo | null> {
  try {
    return await apex.page.evaluate<TrackGeo>(
      "(async () => { const m = await import('/src/track/index.ts'); const t = m.loadTrack(); return { id: t.data.id, length: t.query.length }; })()",
    );
  } catch {
    return null;
  }
}

async function worldFromSD(apex: ApexClient, s: number, d: number): Promise<{ x: number; y: number; z: number }> {
  return apex.page.evaluate<{ x: number; y: number; z: number }>(
    `(async () => { const m = await import('/src/track/index.ts'); const t = m.loadTrack(); const o = { x: 0, y: 0, z: 0 }; t.query.worldFromSD(${s}, ${d}, o); return o; })()`,
  );
}

function condLabel(c: Condition): string {
  return `${c.id} (rain ${c.rain}, wetness ${c.wetness})`;
}

test.describe('V-01 İstanbul screenshot points', () => {
  test.skip(!WANT_POINTS, 'APEX_GALLERY=scenes');

  for (const run of pointRuns(FULL)) {
    test(`V-01 points ${condLabel(run.condition)} on ${run.preset}`, async ({ apex, page }) => {
      test.setTimeout(420_000);
      test.skip(!isStatusReal('graphics'), '[needs H2: real graphics] src/graphics MODULE_STATUS is not real');
      await apex.open({ quality: run.preset, seed: 777, mute: 1 }, 'ready', 60_000);
      const geo = await trackGeo(apex);
      test.skip(!geo || geo.id !== 'istanbul' || !isStatusReal('track'), `[needs H1: İstanbul track] loadTrack() returns ${geo?.id ?? 'nothing'}`);
      const k = geo!.length / OSM_LENGTH;
      const c = run.condition;

      await apex.startSession({ mode: 'timeTrial', tod: c.tod, weather: c.weather, seed: 777, autodrive: true, skipLights: true });
      await apex.whenReady('sceneReady', 90_000);
      const failures: string[] = [];
      for (const id of run.points) {
        const p = POINTS.find((x) => x.id === id)!;
        await test.step(`${p.id} ${c.id} ${run.preset}`, async () => {
          await apex.setTimeScale(1);
          await apex.setConditions({ rain: c.rain, wetness: c.wetness });
          const s = p.s * k;
          await apex.teleport(0, s, p.d, p.kmh);
          if (p.view === 'freeCam') {
            const pos = await worldFromSD(apex, 5150 * k, 4);
            const look = await worldFromSD(apex, 5190 * k, 16);
            await apex.freeCam({ x: pos.x, y: pos.y + 6, z: pos.z }, look);
          } else {
            await apex.setCamera(p.view);
          }
          await apex.nextFrames(90);
          // Freeze the sim with a time scale of 0: `pause()` would put the pause menu over the picture.
          await apex.setTimeScale(0);
          await apex.nextFrames(2);
          const stem = pointFileStem(p.id, c, run.preset);
          try {
            const shot = await saveScreen(page, 'gallery', stem);
            writeEntry({
              path: shot.relPath, kind: 'point', scene: p.id,
              params: { mode: 'timeTrial', tod: c.tod, weather: c.weather, rain: c.rain, wetness: c.wetness, preset: run.preset, seed: 777, s, sOsm: p.s, d: p.d, kmh: p.kmh, view: p.view },
              lumaMean: shot.stats.mean, lumaStdDev: shot.stats.stdDev, gpu: await apex.gpu(), notes: p.look,
            });
          } catch (err) {
            failures.push(`${stem}: ${err instanceof Error ? err.message : String(err)}`);
          }
        });
      }
      expect(failures, failures.join('\n')).toEqual([]);
    });
  }

  const raceStartConditions = FULL ? CONDITIONS : CONDITIONS.slice(0, 1);
  for (const c of raceStartConditions) {
    test(`V-01 race-start ${condLabel(c)} on high`, async ({ apex, page }) => {
      test.setTimeout(300_000);
      test.skip(!isStatusReal('graphics'), '[needs H2: real graphics] src/graphics MODULE_STATUS is not real');
      await apex.open({ quality: 'high', seed: 777, mute: 1 }, 'ready', 60_000);
      const geo = await trackGeo(apex);
      test.skip(!geo || geo.id !== 'istanbul' || !isStatusReal('track'), `[needs H1: İstanbul track] loadTrack() returns ${geo?.id ?? 'nothing'}`);
      await apex.startSession({ mode: 'race', aiCount: 19, tod: c.tod, weather: c.weather, seed: 777, autodrive: true, skipLights: false });
      await apex.whenReady('sceneReady', 90_000);
      await apex.setConditions({ rain: c.rain, wetness: c.wetness });
      await apex.waitForPhase('running', 40_000);
      // Capture 2.0 s of race time after lights out. The TV view is Sprint 2+ (setCamera only knows the five driving cameras).
      await page.waitForFunction(
        () => {
          const r = (window as unknown as { __APEX__: { getRace(): { race: { raceMs: number; lightsOutAtMs: number } } | null } }).__APEX__.getRace();
          return r !== null && r.race.raceMs - r.race.lightsOutAtMs >= 2000;
        },
        undefined,
        { timeout: 20_000 },
      );
      await apex.setCamera('chaseFar');
      await apex.setTimeScale(0);
      await apex.nextFrames(2);
      const shot = await saveScreen(page, 'gallery', pointFileStem('race-start', c, 'high'));
      writeEntry({
        path: shot.relPath, kind: 'race-start', scene: 'race-start',
        params: { mode: 'race', aiCount: 19, tod: c.tod, weather: c.weather, rain: c.rain, wetness: c.wetness, preset: 'high', seed: 777, view: 'chaseFar' },
        lumaMean: shot.stats.mean, lumaStdDev: shot.stats.stdDev, gpu: await apex.gpu(), notes: 'field into T1 (tv view pending Sprint 2)',
      });
    });
  }
});

test('gallery URL builder is stable', () => {
  expect(urlWith({ scene: 'car', freeze: 1, quality: 'high' })).toBe('/?scene=car&freeze=1&quality=high');
});
