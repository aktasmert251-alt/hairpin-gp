// Environment textures: CC0 Poly Haven maps (public/assets/env/textures, see CREDITS.part.md) through the AssetLoader,
// plus small procedural canvas textures. Every texture taken here is released in `dispose()`.

import { CanvasTexture, LinearMipmapLinearFilter, RepeatWrapping, SRGBColorSpace, type Texture } from 'three';
import type { AssetLoader } from '../../contracts/render';

const BASE = `${import.meta.env.BASE_URL}assets/env/textures/`;

export interface EnvTextures {
  asphalt: { map: Texture; normal: Texture; rough: Texture };
  concrete: { map: Texture; normal: Texture; rough: Texture };
  gravel: { map: Texture; normal: Texture };
  grassDry: { map: Texture; normal: Texture };
  grassGreen: { map: Texture };
  dirt: { map: Texture; normal: Texture };
  setAnisotropy(n: number): void;
  dispose(): void;
}

export async function loadEnvTextures(assets: AssetLoader, anisotropy: number, onProgress: (p: number) => void): Promise<EnvTextures> {
  const loaded: Texture[] = [];
  const files: [string, boolean][] = [
    ['asphalt_track_diffuse_1k.jpg', true], ['asphalt_track_nor_gl_1k.jpg', false], ['asphalt_track_rough_1k.jpg', false],
    ['concrete_floor_worn_001_diffuse_1k.jpg', true], ['concrete_floor_worn_001_nor_gl_1k.jpg', false], ['concrete_floor_worn_001_rough_1k.jpg', false],
    ['gravel_ground_01_diffuse_1k.jpg', true], ['gravel_ground_01_nor_gl_1k.jpg', false],
    ['withered_grass_diffuse_1k.jpg', true], ['withered_grass_nor_gl_1k.jpg', false],
    ['sparse_grass_diffuse_1k.jpg', true],
    ['dry_ground_01_diffuse_1k.jpg', true], ['dry_ground_01_nor_gl_1k.jpg', false],
  ];
  let done = 0;
  const tex = await Promise.all(files.map(async ([f, srgb]) => {
    const t = await assets.texture(BASE + f, { srgb, repeat: true, anisotropy });
    done++;
    onProgress(done / files.length);
    loaded.push(t);
    t.wrapS = t.wrapT = RepeatWrapping;
    t.minFilter = LinearMipmapLinearFilter;
    return t;
  }));
  const [a0, a1, a2, c0, c1, c2, g0, g1, gd0, gd1, gg0, d0, d1] = tex as [Texture, Texture, Texture, Texture, Texture, Texture, Texture, Texture, Texture, Texture, Texture, Texture, Texture];
  return {
    asphalt: { map: a0, normal: a1, rough: a2 },
    concrete: { map: c0, normal: c1, rough: c2 },
    gravel: { map: g0, normal: g1 },
    grassDry: { map: gd0, normal: gd1 },
    grassGreen: { map: gg0 },
    dirt: { map: d0, normal: d1 },
    setAnisotropy(n) {
      for (const t of loaded) {
        t.anisotropy = n;
        t.needsUpdate = true;
      }
    },
    dispose() {
      for (const t of loaded) assets.release(t);
      loaded.length = 0;
    },
  };
}

/** Canvas texture helper (sRGB colour data, repeat wrapping, mipmaps). */
export function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void, srgb = true): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  draw(g, w, h);
  const t = new CanvasTexture(c);
  if (srgb) t.colorSpace = SRGBColorSpace;
  t.wrapS = t.wrapT = RepeatWrapping;
  t.minFilter = LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  return t;
}

/** Deterministic value noise for canvas generators. */
export function makeRand(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
