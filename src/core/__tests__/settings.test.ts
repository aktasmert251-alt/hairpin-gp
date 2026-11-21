import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_BINDINGS } from '../input/bindings';
import { STORAGE_KEYS, autoHudScale } from '../settings/defaults';
import { createSettingsStore, migrateSettings, type StorageLike, type TimerLike } from '../settings/SettingsStore';

function fakeStorage(initial: Record<string, string> = {}): StorageLike & { data: Map<string, string>; writes: number } {
  const data = new Map(Object.entries(initial));
  const s = {
    data,
    writes: 0,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      s.writes++;
      data.set(k, v);
    },
    removeItem: (k: string) => void data.delete(k),
  };
  return s;
}

function fakeTimers(): TimerLike & { flush(): void; pending(): number } {
  let queue: { id: number; cb: () => void }[] = [];
  let next = 1;
  return {
    setTimeout(cb) {
      const id = next++;
      queue.push({ id, cb });
      return id;
    },
    clearTimeout(h) {
      queue = queue.filter((q) => q.id !== h);
    },
    flush() {
      const q = queue;
      queue = [];
      for (const t of q) t.cb();
    },
    pending: () => queue.length,
  };
}

describe('SettingsStore', () => {
  it('migrates unversioned data and repairs every field', () => {
    const s = migrateSettings({
      lang: 'en',
      controls: { layout: 'wasd', bindings: { throttle: ['KeyI', 'ControlLeft', 'KeyI'], brake: 'nope' } },
      audio: { master: 5, engine: -1, sfx: 'loud' },
      hud: { mode: 'weird', scale: 3 },
      gameplay: { difficulty: 70.6, flashbacks: 3 },
      bogus: 1,
    });
    expect(s.version).toBe(1);
    expect(s.lang).toBe('en');
    expect(s.controls.layout).toBe('combined');
    expect(s.controls.bindings.throttle).toEqual(['KeyI']);
    expect(s.controls.bindings.brake).toEqual([...DEFAULT_BINDINGS.brake]);
    expect(s.controls.bindings.debugOverlay).toEqual(['F8']);
    expect(s.audio).toMatchObject({ master: 1, engine: 0, sfx: 0.8 });
    expect(s.hud.mode).toBe('full');
    expect(s.hud.scale).toBe(1.25);
    expect(s.gameplay.difficulty).toBe(71);
    expect(s.ui.animations).toBe('auto');
    expect((s as unknown as Record<string, unknown>).bogus).toBeUndefined();
  });

  it('loads from storage, debounces writes and persists them', () => {
    const storage = fakeStorage({ [STORAGE_KEYS.settings]: JSON.stringify({ version: 1, lang: 'en', ui: { animations: 'off' } }) });
    const timers = fakeTimers();
    const store = createSettingsStore({ storage, timers, viewportHeight: 1080, reducedMotion: false });
    expect(store.get().lang).toBe('en');
    expect(store.get().ui.animations).toBe('off');
    const seen: string[] = [];
    store.subscribe((s) => seen.push(s.lang));
    store.setPath('lang', 'tr');
    store.setPath('audio.master', 0.5);
    expect(storage.writes).toBe(0);
    expect(timers.pending()).toBe(1);
    timers.flush();
    const saved = JSON.parse(storage.data.get(STORAGE_KEYS.settings)!);
    expect(saved.lang).toBe('tr');
    expect(saved.audio.master).toBe(0.5);
    expect(seen).toEqual(['tr', 'tr']);
    store.reset('audio');
    expect(store.get().audio.master).toBe(0.8);
    store.dispose();
  });

  it('falls back to defaults on corrupt data with a warning (never console.error)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const err = vi.spyOn(console, 'error');
    const store = createSettingsStore({ storage: fakeStorage({ [STORAGE_KEYS.settings]: '{not json' }), timers: fakeTimers(), viewportHeight: 1080, reducedMotion: true });
    expect(store.get().lang).toBe('tr');
    expect(store.get().graphics.cameraShake).toBe(0);
    expect(store.get().graphics.motionEffects).toBe(false);
    expect(warn).toHaveBeenCalled();
    expect(err).not.toHaveBeenCalled();
    warn.mockRestore();
    err.mockRestore();
  });

  it('D-004: hud.scale follows the viewport until the user sets it', () => {
    expect(autoHudScale(800)).toBe(1.1);
    expect(autoHudScale(1080)).toBe(1.0);
    const storage = fakeStorage();
    const timers = fakeTimers();
    const store = createSettingsStore({ storage, timers, viewportHeight: 800 });
    expect(store.get().hud.scale).toBe(1.1);
    store.applyViewport(1080);
    expect(store.get().hud.scale).toBe(1.0);
    store.applyViewport(720);
    expect(store.get().hud.scale).toBe(1.1);
    store.setPath('hud.scale', 1.0);
    expect(store.isExplicit('hud.scale')).toBe(true);
    store.applyViewport(700);
    expect(store.get().hud.scale).toBe(1.0);
    timers.flush();
    const again = createSettingsStore({ storage, timers: fakeTimers(), viewportHeight: 700 });
    expect(again.get().hud.scale).toBe(1.0);
    again.reset('hud');
    expect(again.get().hud.scale).toBe(1.1);
    expect(again.isExplicit('hud.scale')).toBe(false);
  });
});
