// E-SM-02: sandbox scenes reach `sceneReady` within 15 s and log no errors (error gate from fixtures.ts).
// The trailer first generates offline replays; trailerReady marks that preparation complete.
// The id list is read from the files on disk exactly like src/sandbox/router.ts discovers them, so new scenes are picked up
// automatically (hand-off H5). Scenes that do not exist yet are simply absent.

import type { UrlParams } from '../helpers/apexClient';
import { listSceneFiles } from '../helpers/paths';
import { expect, test } from '../helpers/fixtures';

const SCENE_READY_MS = 15_000;
const scenes = listSceneFiles();

/** Documented URL variants (ARCHITECTURE §8, sprint-1.md S9/S10) that must also load cleanly. Skipped when the scene file is absent. */
const VARIANTS: { scene: string; params: UrlParams }[] = [
  { scene: 'audio', params: { offline: 1 } },
  { scene: 'physics', params: { track: 'oval' } },
  { scene: 'physics', params: { track: 'straight' } },
  { scene: 'physics', params: { track: 'istanbul' } },
];

test.describe('E-SM-02 sandbox scenes', () => {
  test('scene list is not empty and ids are unique kebab-case', () => {
    expect(scenes.length).toBeGreaterThan(0);
    const ids = scenes.map((s) => s.id);
    expect(new Set(ids).size, `duplicate scene ids in ${ids.join(', ')}`).toBe(ids.length);
    for (const id of ids) expect(id, 'scene ids are kebab-case (ARCHITECTURE §8)').toMatch(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/);
  });

  for (const scene of scenes) {
    test(`E-SM-02 ?scene=${scene.id} loads and reaches sceneReady`, async ({ apex }) => {
      const t0 = Date.now();
      await apex.goto({ scene: scene.id, freeze: 1 });
      if (scene.id === 'trailer') {
        await apex.page.waitForFunction(() => (window as unknown as { trailerReady?: boolean }).trailerReady === true);
      }
      await apex.whenReady('sceneReady', SCENE_READY_MS);
      const ms = Date.now() - t0;
      test.info().annotations.push({ type: 'sceneReady', description: `${ms} ms (${scene.file})` });
      expect(await apex.state()).toBe('sandbox');
      expect(await apex.errors()).toEqual([]);
      // An unknown id shows the router's scene index; a found scene appends its title to the current brand.
      expect(await apex.page.title(), `the router found scene "${scene.id}"`).toMatch(/^HAIRPIN GP · /);
    });
  }

  for (const v of VARIANTS) {
    if (!scenes.some((x) => x.id === v.scene)) continue;
    const label = Object.entries(v.params).map(([k, val]) => `${k}=${val}`).join('&');
    test(`E-SM-02 ?scene=${v.scene}&${label} loads and reaches sceneReady`, async ({ apex }) => {
      await apex.goto({ scene: v.scene, freeze: 1, ...v.params });
      await apex.whenReady('sceneReady', SCENE_READY_MS);
      expect(await apex.errors()).toEqual([]);
      expect(await apex.page.title()).toMatch(/^HAIRPIN GP · /);
    });
  }
});
