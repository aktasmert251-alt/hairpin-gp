// SettingsStore (§3.9): localStorage with try/catch, debounced writes (500 ms) and versioned migrations.
// Every write goes through sanitize(), so the in-memory object is always a valid Settings.

import type { Unsubscribe } from '../../contracts/common';
import type { EventBus, EventMap } from '../../contracts/events';
import type { ActionId, DeviceProfile } from '../../contracts/input';
import type { Settings, SettingsStore } from '../../contracts/settings';
import { ACTION_IDS, DEFAULT_BINDINGS, MODIFIER_CODES, sanitizePadBindings } from '../input/bindings';
import { SETTINGS_VERSION, STORAGE_KEYS, autoHudScale, defaultSettings } from './defaults';
import { defaultQualityFor, detectDevice } from '../platform/device';

/** Paths whose default is derived from the environment; they follow it until the user sets them (D-004). */
// Mobile (2026-11-21): device + quality follow a touch-only / mobile device until set (desktop never changes them).
const AUTO_PATHS = ['hud.scale', 'controls.device', 'graphics.preset'] as const;
type AutoPath = (typeof AUTO_PATHS)[number];

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface TimerLike {
  setTimeout(cb: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface SettingsStoreOptions {
  /** Default: window.localStorage when accessible; null = memory only. */
  storage?: StorageLike | null;
  bus?: EventBus<EventMap>;
  debounceMs?: number;
  timers?: TimerLike;
  key?: string;
  /** First-run reduced-motion defaults; default: matchMedia('(prefers-reduced-motion: reduce)'). */
  reducedMotion?: boolean;
  /** Viewport height in CSS px for the D-004 hud.scale default; default: window.innerHeight. */
  viewportHeight?: number;
  /** Mobile defaults (touch device, quality); default: detectDevice() (desktop in Node). */
  device?: DeviceProfile;
}

function currentViewportHeight(): number | undefined {
  return typeof window !== 'undefined' && window.innerHeight > 0 ? window.innerHeight : undefined;
}

function prefersReducedMotion(): boolean {
  try {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export interface SettingsStoreImpl extends SettingsStore {
  /** Writes pending changes immediately. */
  flush(): void;
  /** True when the user set this path explicitly (auto defaults never override it). */
  isExplicit(path: string): boolean;
  /** Re-evaluates viewport-driven defaults (call on resize). Explicit user values are untouched. */
  applyViewport(viewportHeight: number): void;
  dispose(): void;
}

type Obj = Record<string, unknown>;
type Migration = (o: Obj) => Obj;

/** Upgrades raw data written by version N to version N+1. */
const MIGRATIONS: Readonly<Record<number, Migration>> = {
  // v0: unversioned pre-release data. Same shape; the old 'wasd' layout already bound arrows too.
  0: (o) => {
    const controls = isObj(o.controls) ? { ...o.controls } : undefined;
    if (controls && controls.layout === 'wasd') controls.layout = 'combined';
    return { ...o, ...(controls ? { controls } : {}), version: 1 };
  },
};

const ENUMS: Readonly<Record<string, readonly string[]>> = {
  lang: ['tr', 'en'],
  'graphics.preset': ['low', 'medium', 'high', 'ultra', 'custom'],
  'controls.layout': ['combined', 'wasd', 'arrows'],
  'controls.device': ['keyboard', 'gamepad', 'auto', 'touch'],
  'controls.touch.steerMode': ['tilt', 'buttons', 'wheel'],
  'assists.braking': ['off', 'low', 'medium', 'high'],
  'assists.tc': ['off', 'medium', 'full'],
  'assists.gearbox': ['auto', 'manual'],
  'assists.racingLine': ['off', 'corners', 'full'],
  'hud.mode': ['full', 'minimal', 'off'],
  'hud.units': ['kmh', 'mph'],
  'camera.default': ['cockpit', 'tcam', 'nose', 'chaseNear', 'chaseFar'],
  'ui.animations': ['auto', 'on', 'off'],
};

const RANGES: Readonly<Record<string, readonly [number, number]>> = {
  'graphics.fovOffset': [-10, 10],
  'graphics.cameraShake': [0, 1],
  'audio.master': [0, 1],
  'audio.engine': [0, 1],
  'audio.sfx': [0, 1],
  'audio.ambience': [0, 1],
  'audio.ui': [0, 1],
  'controls.steerSensitivity': [0.5, 1.5],
  'controls.pad.steerDeadzone': [0, 0.4],
  'controls.pad.steerLinearity': [1, 3],
  'controls.pad.steerSensitivity': [0.5, 1.5],
  'controls.pad.triggerDeadzone': [0, 0.3],
  'controls.pad.throttleCurve': [0.5, 3],
  'controls.pad.brakeCurve': [0.5, 3],
  'controls.pad.vibrationStrength': [0, 1],
  'controls.touch.size': [0.8, 1.3],
  'controls.touch.opacity': [0.2, 1],
  'controls.touch.tiltSensitivity': [0.5, 2],
  'controls.touch.tiltDeadzone': [0, 0.2],
  'controls.touch.tiltCenter': [-45, 45],
  'hud.scale': [0.8, 1.25],
  'gameplay.difficulty': [0, 110],
  'gameplay.flashbacks': [-1, 99],
};

const INTEGERS: ReadonlySet<string> = new Set(['gameplay.difficulty', 'gameplay.flashbacks']);

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function sanitizeBindings(raw: unknown): Record<ActionId, string[]> {
  const src = isObj(raw) ? raw : {};
  const out = {} as Record<ActionId, string[]>;
  for (const a of ACTION_IDS) {
    const v = src[a];
    if (Array.isArray(v)) {
      const list: string[] = [];
      for (const c of v) if (typeof c === 'string' && c.length > 0 && !MODIFIER_CODES.has(c) && !list.includes(c)) list.push(c);
      out[a] = list;
    } else out[a] = [...DEFAULT_BINDINGS[a]];
  }
  return out;
}

function sanitizeCustom(raw: unknown): Obj {
  const out: Obj = {};
  if (!isObj(raw)) return out;
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string') out[k] = v;
    else if (Array.isArray(v) && v.every((x) => typeof x === 'number')) out[k] = [...v];
  }
  return out;
}

function sanitizeNode(def: unknown, raw: unknown, path: string): unknown {
  if (path === 'controls.bindings') return sanitizeBindings(raw);
  if (path === 'controls.pad.bindings') return sanitizePadBindings(raw);
  if (path === 'graphics.custom') return sanitizeCustom(raw);
  if (isObj(def)) {
    const r = isObj(raw) ? raw : {};
    const out: Obj = {};
    for (const k of Object.keys(def)) out[k] = sanitizeNode(def[k], r[k], path ? `${path}.${k}` : k);
    return out;
  }
  if (typeof def === 'number') {
    if (typeof raw !== 'number' || !Number.isFinite(raw)) return def;
    const range = RANGES[path];
    let v = range ? Math.min(range[1], Math.max(range[0], raw)) : raw;
    if (INTEGERS.has(path)) v = Math.round(v);
    return v;
  }
  if (typeof def === 'boolean') return typeof raw === 'boolean' ? raw : def;
  if (typeof def === 'string') {
    if (typeof raw !== 'string') return def;
    const allowed = ENUMS[path];
    return allowed && !allowed.includes(raw) ? def : raw;
  }
  return def;
}

/** Runs version migrations, then validates every field against the defaults (unknown keys dropped, bad values reset). */
export function migrateSettings(raw: unknown): Settings {
  let o: Obj = isObj(raw) ? raw : {};
  let v = typeof o.version === 'number' && Number.isInteger(o.version) ? o.version : 0;
  if (v > SETTINGS_VERSION) {
    console.warn(`[settings] stored version ${v} is newer than ${SETTINGS_VERSION}; keeping compatible fields`);
    v = SETTINGS_VERSION;
  }
  while (v < SETTINGS_VERSION) {
    const m = MIGRATIONS[v];
    o = m ? m(o) : o;
    v++;
  }
  const s = sanitizeNode(defaultSettings(), o, '') as Settings;
  s.version = SETTINGS_VERSION;
  return s;
}

function defaultStorage(): StorageLike | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    const probe = '__apexgp_probe__';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    return null;
  }
}

function setAtPath(root: Obj, path: string, value: unknown): Obj {
  const keys = path.split('.');
  const out: Obj = { ...root };
  let cur = out;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i]!;
    const next = isObj(cur[k]) ? { ...(cur[k] as Obj) } : {};
    cur[k] = next;
    cur = next;
  }
  cur[keys[keys.length - 1]!] = value;
  return out;
}

export function createSettingsStore(opts: SettingsStoreOptions = {}): SettingsStoreImpl {
  const storage = opts.storage === undefined ? defaultStorage() : opts.storage;
  const key = opts.key ?? STORAGE_KEYS.settings;
  const debounceMs = opts.debounceMs ?? 500;
  const timers: TimerLike = opts.timers ?? {
    setTimeout: (cb, ms) => setTimeout(cb, ms),
    clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  };

  const metaKey = opts.key ? `${opts.key}:meta` : STORAGE_KEYS.settingsMeta;
  let viewport = opts.viewportHeight ?? currentViewportHeight();
  const device = opts.device ?? detectDevice();
  const explicit = new Set<string>();
  try {
    const metaText = storage?.getItem(metaKey) ?? null;
    const meta: unknown = metaText ? JSON.parse(metaText) : null;
    if (isObj(meta) && Array.isArray(meta.explicit)) for (const p of meta.explicit) if (typeof p === 'string') explicit.add(p);
  } catch (err) {
    console.warn('[settings] settings meta is corrupt; ignoring it', err);
  }

  /** Applies viewport-driven defaults to paths the user has not set (D-004). Mutates the fresh object. */
  const applyAuto = (s: Settings): Settings => {
    if (!explicit.has('hud.scale')) s.hud.scale = autoHudScale(viewport, device.touchOnly);
    // Stored data from before the mobile pass on a phone: only the desktop defaults are replaced, never a user choice.
    if (!explicit.has('controls.device') && device.touchOnly && s.controls.device === 'keyboard') s.controls.device = 'touch';
    if (!explicit.has('graphics.preset') && device.mobile && s.graphics.preset === 'high') s.graphics.preset = defaultQualityFor(device);
    return s;
  };

  const firstRun = (): Settings => defaultSettings(opts.reducedMotion ?? prefersReducedMotion(), viewport, device);
  let current: Settings;
  try {
    const text = storage?.getItem(key) ?? null;
    current = applyAuto(text ? migrateSettings(JSON.parse(text)) : firstRun());
  } catch (err) {
    console.warn('[settings] stored settings are corrupt; using defaults', err);
    current = applyAuto(firstRun());
  }

  let subscribers: readonly ((v: Readonly<Settings>) => void)[] = [];
  let timer: unknown = null;
  let dirty = false;

  const write = (): void => {
    timer = null;
    if (!dirty) return;
    dirty = false;
    if (!storage) return;
    try {
      storage.setItem(key, JSON.stringify(current));
      storage.setItem(metaKey, JSON.stringify({ explicit: [...explicit].sort() }));
    } catch (err) {
      console.warn('[settings] write failed', err);
    }
  };

  const valueAt = (s: Settings, path: AutoPath): unknown => {
    let cur: unknown = s;
    for (const k of path.split('.')) cur = isObj(cur) ? cur[k] : undefined;
    return cur;
  };

  /** Marks auto paths as explicit when a write touches them (`force` = a direct setPath on that path). */
  const markExplicit = (next: Settings, touched: string, force: boolean): void => {
    for (const p of AUTO_PATHS) {
      const covers = touched === p || p.startsWith(`${touched}.`);
      if (!covers) continue;
      if ((force && touched === p) || valueAt(next, p) !== valueAt(current, p)) explicit.add(p);
    }
  };

  const schedule = (): void => {
    dirty = true;
    if (timer !== null) timers.clearTimeout(timer);
    timer = timers.setTimeout(write, debounceMs);
  };

  const commit = (next: Settings, paths: readonly string[]): void => {
    current = next;
    schedule();
    for (const cb of subscribers) {
      try {
        cb(current);
      } catch (err) {
        console.error('[settings] subscriber threw', err);
      }
    }
    for (const path of paths) opts.bus?.emit('settings:changed', { path });
  };

  const onPageHide = (): void => store.flush();
  if (typeof window !== 'undefined' && storage) window.addEventListener('pagehide', onPageHide);

  const store: SettingsStoreImpl = {
    get: () => current,
    set(patch) {
      const merged = { ...current, ...patch } as Obj;
      const next = migrateSettings({ ...merged, version: SETTINGS_VERSION });
      for (const k of Object.keys(patch)) markExplicit(next, k, false);
      commit(applyAuto(next), Object.keys(patch));
    },
    subscribe(cb): Unsubscribe {
      subscribers = [...subscribers, cb];
      return () => {
        subscribers = subscribers.filter((s) => s !== cb);
      };
    },
    setPath(path, value) {
      const next = migrateSettings({ ...setAtPath(current as unknown as Obj, path, value), version: SETTINGS_VERSION });
      markExplicit(next, path, true);
      commit(applyAuto(next), [path]);
    },
    reset(section) {
      const defs = defaultSettings(false, viewport, device);
      if (section === undefined) {
        explicit.clear();
        commit(applyAuto(defs), ['*']);
        return;
      }
      for (const p of AUTO_PATHS) if (p.startsWith(`${section}.`)) explicit.delete(p);
      commit(applyAuto(migrateSettings({ ...current, [section]: defs[section], version: SETTINGS_VERSION })), [section]);
    },
    flush() {
      if (timer !== null) timers.clearTimeout(timer);
      write();
    },
    isExplicit: (path) => explicit.has(path),
    applyViewport(h) {
      viewport = h;
      if (explicit.has('hud.scale') || current.hud.scale === autoHudScale(h, device.touchOnly)) return;
      commit(applyAuto(migrateSettings(current)), ['hud.scale']);
    },
    dispose() {
      store.flush();
      if (typeof window !== 'undefined' && storage) window.removeEventListener('pagehide', onPageHide);
      subscribers = [];
    },
  };
  return store;
}
