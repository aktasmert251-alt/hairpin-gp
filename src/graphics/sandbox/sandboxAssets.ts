// Minimal AssetLoader for graphics sandbox scenes (the real one lives in src/core and is injected by the glue).

import { NoColorSpace, RepeatWrapping, SRGBColorSpace, TextureLoader, type Texture } from 'three';
import type { AssetLoader, AssetProgress } from '../../contracts/render';

export function createSandboxAssets(): AssetLoader {
  const loader = new TextureLoader();
  const owned = new Set<Texture>();
  const prog: AssetProgress = { loaded: 0, total: 0, progress: 1 };
  return {
    async texture(url, o) {
      const t = await loader.loadAsync(url);
      t.colorSpace = (o?.srgb ?? true) ? SRGBColorSpace : NoColorSpace;
      if (o?.repeat) t.wrapS = t.wrapT = RepeatWrapping;
      t.anisotropy = o?.anisotropy ?? 1;
      t.flipY = o?.flipY ?? true;
      owned.add(t);
      return t;
    },
    release(t) {
      owned.delete(t);
      t.dispose();
    },
    refCount: () => 0,
    async font(family, opts) {
      try {
        await document.fonts.load(`${opts?.weight ?? 400} 16px "${family}"`, opts?.text);
        return true;
      } catch {
        return false;
      }
    },
    track: (w) => w,
    progress: () => prog,
    onProgress: () => () => {},
    resetProgress() {},
    async warmup(renderer, scene, camera) {
      await renderer.compileAsync(scene, camera);
    },
    dispose() {
      for (const t of owned) t.dispose();
      owned.clear();
    },
  };
}
