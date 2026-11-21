// Sandbox router (YÖN): discovers scenes with import.meta.glob('/src/**/sandbox/*.scene.ts') (no registry file).
// Scene id = file name without `.scene.ts` (kebab-case, unique; duplicates throw). `?scene=<id>` mounts it,
// drives update(dt) from requestAnimationFrame and sets __APEX__.sceneReady after the first rendered frame.
// An unknown id shows an index of every scene.

import type { LaunchParams, SandboxScene } from '../contracts/debug';
import type { ApexController } from '../core/debug/apexApi';
import { createI18n } from '../core/i18n/index';

const loaders = import.meta.glob<{ default: SandboxScene }>('/src/**/sandbox/*.scene.ts');

export interface SceneEntry { id: string; path: string }

export function listScenes(): SceneEntry[] {
  const seen = new Map<string, string>();
  for (const path of Object.keys(loaders)) {
    const m = /\/([^/]+)\.scene\.ts$/.exec(path);
    if (!m) continue;
    const id = m[1]!;
    const prev = seen.get(id);
    if (prev) throw new Error(`[sandbox] duplicate scene id "${id}": ${prev} and ${path}`);
    seen.set(id, path);
  }
  return [...seen].map(([id, path]) => ({ id, path })).sort((a, b) => a.id.localeCompare(b.id));
}

export interface SandboxEnv { appEl: HTMLElement; uiRoot: HTMLElement; apex: ApexController; launch: LaunchParams }

function renderIndex(env: SandboxEnv, unknownId: string, scenes: readonly SceneEntry[]): void {
  const i18n = createI18n({ lang: env.launch.lang ?? 'tr' });
  const el = document.createElement('main');
  el.style.cssText = 'position:fixed;inset:0;overflow:auto;padding:48px;background:#0A0C0F;color:#F2F4F7;font:18px/1.6 "Segoe UI",system-ui,sans-serif;pointer-events:auto';
  const h = document.createElement('h1');
  h.textContent = i18n.t('common.sandbox.title');
  const p = document.createElement('p');
  p.textContent = `${i18n.t('common.sandbox.unknown', { id: unknownId })} ${i18n.t('common.sandbox.hint')}`;
  const ul = document.createElement('ul');
  for (const s of scenes) {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = `?scene=${encodeURIComponent(s.id)}`;
    a.textContent = s.id;
    a.style.color = '#F2F4F7';
    li.append(a, ` (${s.path})`);
    ul.appendChild(li);
  }
  el.append(h, p, ul);
  env.uiRoot.appendChild(el);
}

export async function mountSandbox(id: string, env: SandboxEnv): Promise<void> {
  const { apex } = env;
  apex.attachApp({ state: () => 'sandbox' });
  apex.setSceneReady(false);
  try {
    const scenes = listScenes();
    const entry = scenes.find((s) => s.id === id);
    if (!entry) {
      renderIndex(env, id, scenes);
      apex.setReady(true);
      requestAnimationFrame(() => requestAnimationFrame(() => apex.setSceneReady(true)));
      return;
    }
    const mod = await loaders[entry.path]!();
    const scene = mod.default;
    if (scene.id !== id) console.warn(`[sandbox] ${entry.path} exports id "${scene.id}"; expected "${id}"`);
    document.title = `HAIRPIN GP · ${scene.title}`;
    const canvas = document.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    env.appEl.appendChild(canvas);
    const handle = await scene.create({ canvas, uiRoot: env.uiRoot, params: new URLSearchParams(window.location.search) });
    apex.setReady(true);
    let last = performance.now();
    let frames = 0;
    let raf = 0;
    let stopped = false;
    const tick = (now: number): void => {
      if (stopped) return;
      const dt = Math.max(0, (now - last) / 1000);
      last = now;
      try {
        handle.update(dt);
      } catch (err) {
        console.error(`[sandbox] ${id}.update threw`, err);
      }
      frames++;
      // update() rendered frame 1 during the previous callback; it has been presented by now.
      if (frames === 2) apex.setSceneReady(true);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    window.addEventListener('pagehide', () => {
      stopped = true;
      cancelAnimationFrame(raf);
      handle.dispose();
    });
  } catch (err) {
    console.error(`[sandbox] failed to mount "${id}"`, err);
    apex.setReady(true);
  }
}
