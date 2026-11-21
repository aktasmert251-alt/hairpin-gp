// I-03: settings migration v0 -> v1 and persistence across a "reload" (a second store over the same storage); corrupt JSON warns once.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_KEYS } from '../../src/core/settings/defaults';
import { createSettingsStore, type StorageLike } from '../../src/core/settings/SettingsStore';

function memStorage(initial: Record<string, string> = {}): StorageLike & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
}
const opts = { debounceMs: 0, reducedMotion: false, viewportHeight: 1080 } as const;

afterEach(() => vi.restoreAllMocks());

describe('I-03 settings persistence', () => {
  it('survives a reload: language, audio, graphics preset, assists and a rebinding', () => {
    const storage = memStorage();
    const a = createSettingsStore({ ...opts, storage });
    a.setPath('lang', 'en');
    a.setPath('audio.master', 0.4);
    a.setPath('graphics.preset', 'ultra');
    a.setPath('controls.bindings.throttle', ['KeyI']);
    a.setPath('hud.scale', 0.9);
    a.flush();
    a.dispose();
    const b = createSettingsStore({ ...opts, storage });
    const s = b.get();
    expect(s.lang).toBe('en');
    expect(s.audio.master).toBe(0.4);
    expect(s.graphics.preset).toBe('ultra');
    expect(s.controls.bindings.throttle).toEqual(['KeyI']);
    expect(s.hud.scale).toBe(0.9);
    expect(b.isExplicit('hud.scale')).toBe(true);
    b.dispose();
  });

  it('migrates an unversioned (v0) blob stored by an older build and writes it back as v1 on the next change', () => {
    const storage = memStorage({ [STORAGE_KEYS.settings]: JSON.stringify({ lang: 'en', audio: { master: 0.3 }, legacyKey: 1 }) });
    const store = createSettingsStore({ ...opts, storage });
    expect(store.get().version).toBe(1);
    expect(store.get().lang).toBe('en');
    expect(store.get().audio.master).toBe(0.3);
    expect((store.get() as unknown as Record<string, unknown>).legacyKey).toBeUndefined();
    store.setPath('audio.sfx', 0.5);
    store.flush();
    const saved = JSON.parse(storage.data.get(STORAGE_KEYS.settings)!) as { version: number; legacyKey?: number };
    expect(saved.version).toBe(1);
    expect(saved.legacyKey).toBeUndefined();
    store.dispose();
  });

  it('corrupt JSON gives defaults with exactly one console.warn and no console.error', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const storage = memStorage({ [STORAGE_KEYS.settings]: '{not json' });
    const store = createSettingsStore({ ...opts, storage });
    expect(store.get().version).toBe(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(err).not.toHaveBeenCalled();
    store.dispose();
  });

  it('reset(section) restores only that section and persists it', () => {
    const storage = memStorage();
    const a = createSettingsStore({ ...opts, storage });
    a.setPath('audio.master', 0.2);
    a.setPath('lang', 'en');
    a.reset('audio');
    a.flush();
    a.dispose();
    const b = createSettingsStore({ ...opts, storage });
    expect(b.get().audio.master).not.toBe(0.2);
    expect(b.get().lang).toBe('en');
    b.dispose();
  });
});
