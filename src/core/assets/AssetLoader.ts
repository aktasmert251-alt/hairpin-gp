// AssetLoader (§3.4): ref-counted texture cache, progress reporting, font waiting, compileAsync warm-up.

import { NoColorSpace, RepeatWrapping, SRGBColorSpace, TextureLoader, type Camera, type Object3D, type Texture, type WebGLRenderer } from 'three';
import type { Unsubscribe } from '../../contracts/common';
import type { AssetLoader, AssetProgress, TextureOptions } from '../../contracts/render';

interface Entry { key: string; refs: number; tex: Texture | null; promise: Promise<Texture> }

export interface AssetLoaderImpl extends AssetLoader {
  /** Clamp for TextureOptions.anisotropy (renderer.capabilities.getMaxAnisotropy()). */
  setMaxAnisotropy(n: number): void;
  /** Number of cached textures (leak checks). */
  size(): number;
}

function keyOf(url: string, o: TextureOptions | undefined): string {
  const srgb = o?.srgb ?? true;
  const repeat = o?.repeat ?? false;
  const flipY = o?.flipY ?? true;
  const aniso = o?.anisotropy ?? 1;
  return `${url}|${srgb ? 's' : 'l'}|${repeat ? 'r' : 'c'}|${flipY ? 'f' : 'n'}|${aniso}`;
}

export function createAssetLoader(): AssetLoaderImpl {
  const loader = new TextureLoader();
  const entries = new Map<string, Entry>();
  const keyByTexture = new WeakMap<Texture, string>();
  let maxAniso = 16;
  let loaded = 0;
  let total = 0;
  let listeners: readonly ((p: AssetProgress) => void)[] = [];

  const snapshot = (): AssetProgress => ({ loaded, total, progress: total > 0 ? Math.min(1, loaded / total) : 1 });
  const notify = (): void => {
    const p = snapshot();
    for (const cb of listeners) cb(p);
  };

  const track = <T>(work: Promise<T>, weight = 1): Promise<T> => {
    total += weight;
    notify();
    return work.finally(() => {
      loaded += weight;
      notify();
    });
  };

  const api: AssetLoaderImpl = {
    texture(url, o) {
      const key = keyOf(url, o);
      const hit = entries.get(key);
      if (hit) {
        hit.refs++;
        return hit.promise;
      }
      const entry: Entry = { key, refs: 1, tex: null, promise: Promise.resolve(null as unknown as Texture) };
      entry.promise = track(
        loader.loadAsync(url).then((tex) => {
          tex.colorSpace = (o?.srgb ?? true) ? SRGBColorSpace : NoColorSpace;
          if (o?.repeat) {
            tex.wrapS = RepeatWrapping;
            tex.wrapT = RepeatWrapping;
          }
          tex.flipY = o?.flipY ?? true;
          tex.anisotropy = Math.max(1, Math.min(maxAniso, o?.anisotropy ?? 1));
          tex.needsUpdate = true;
          entry.tex = tex;
          keyByTexture.set(tex, key);
          if (entry.refs <= 0) {
            // Released before it finished loading.
            tex.dispose();
            entries.delete(key);
          }
          return tex;
        }),
      ).catch((err: unknown) => {
        entries.delete(key);
        throw err;
      });
      entries.set(key, entry);
      return entry.promise;
    },
    release(tex) {
      const key = keyByTexture.get(tex);
      if (!key) return;
      const e = entries.get(key);
      if (!e) return;
      e.refs--;
      if (e.refs <= 0) {
        e.tex?.dispose();
        entries.delete(key);
      }
    },
    refCount(url, o) {
      return entries.get(keyOf(url, o))?.refs ?? 0;
    },
    async font(family, o) {
      if (typeof document === 'undefined' || !document.fonts) return false;
      const spec = `${o?.style ?? 'normal'} ${o?.weight ?? 400} 16px "${family}"`;
      const timeout = o?.timeoutMs ?? 4000;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const res = await Promise.race([
          (o?.text !== undefined ? document.fonts.load(spec, o.text) : document.fonts.load(spec)).then((list) => list.length > 0),
          new Promise<boolean>((resolve) => {
            timer = setTimeout(() => resolve(false), timeout);
          }),
        ]);
        return res;
      } catch {
        return false;
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
    },
    track,
    progress: snapshot,
    onProgress(cb): Unsubscribe {
      listeners = [...listeners, cb];
      return () => {
        listeners = listeners.filter((l) => l !== cb);
      };
    },
    resetProgress() {
      loaded = 0;
      total = 0;
      notify();
    },
    async warmup(renderer: WebGLRenderer, scene: Object3D, camera: Camera) {
      await renderer.compileAsync(scene, camera);
    },
    dispose() {
      for (const e of entries.values()) e.tex?.dispose();
      entries.clear();
      listeners = [];
    },
    setMaxAnisotropy(n) {
      maxAniso = Math.max(1, n);
    },
    size: () => entries.size,
  };
  return api;
}
