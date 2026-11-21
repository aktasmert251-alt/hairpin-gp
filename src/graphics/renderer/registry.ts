// Per-renderer registry so graphics sub-systems that only receive a RenderContext (VFX, car visuals, racing line)
// can reach the post chain (fxScene, soft-particle depth) of the GraphicsSystem that owns the renderer.
// Sub-systems also attach themselves here; in dev builds `globalThis.__APEX_GFX__()` returns the latest entry so
// screenshot `--eval` scripts can exercise the D-019/D-020/D-021 hooks before the glue calls them.

import type { WebGLRenderer } from 'three';
import type { CameraRig, CarVisualsSystem, GraphicsSystem, VfxSystem } from '../../contracts/render';
import type { PostChain } from '../post/postChain';

export interface GraphicsEntry {
  post: PostChain;
  system: GraphicsSystem;
  cars?: CarVisualsSystem | null;
  vfx?: VfxSystem | null;
  rig?: CameraRig | null;
}

const entries = new WeakMap<WebGLRenderer, GraphicsEntry>();
let latest: GraphicsEntry | null = null;

if (import.meta.env?.DEV) {
  (globalThis as { __APEX_GFX__?: () => GraphicsEntry | null }).__APEX_GFX__ = () => latest;
}

export function registerGraphics(r: WebGLRenderer, e: GraphicsEntry): void {
  entries.set(r, e);
  latest = e;
}

export function unregisterGraphics(r: WebGLRenderer): void {
  if (latest === entries.get(r)) latest = null;
  entries.delete(r);
}

export function graphicsFor(r: WebGLRenderer): GraphicsEntry | null {
  return entries.get(r) ?? null;
}

type SubKey = 'cars' | 'vfx' | 'rig';
type Sub = CarVisualsSystem | VfxSystem | CameraRig;

/** Attaches a sub-system to the renderer's entry (debug handle; the newest instance wins). */
export function attachSubsystem(r: WebGLRenderer, key: SubKey, sys: Sub): void {
  const e = entries.get(r) as unknown as Record<string, unknown> | undefined;
  if (e) e[key] = sys;
}

/** Detaches `sys` if it is still the attached instance. */
export function detachSubsystem(r: WebGLRenderer, key: SubKey, sys: Sub): void {
  const e = entries.get(r) as unknown as Record<string, unknown> | undefined;
  if (e && e[key] === sys) e[key] = null;
}
