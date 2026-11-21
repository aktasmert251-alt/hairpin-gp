// Mobile (2026-11-21): device detection and the default quality, the frame-time governor, the portrait check, and the
// settings migration (existing users and desktop unchanged, keyboard default; touch defaults only on touch-only devices).

import { describe, expect, it } from 'vitest';
import type { DeviceProfile } from '../../contracts/input';
import { createFrameGovernor, lowerQuality } from '../platform/governor';
import { defaultQualityFor, profileFrom, type DeviceEnv } from '../platform/device';
import { needsRotate } from '../platform/screen';
import { createSettingsStore, migrateSettings, type StorageLike } from '../settings/SettingsStore';
import { ASSIST_PRESETS, STORAGE_KEYS, autoHudScale, defaultSettings } from '../settings/defaults';

const media = (on: string[]) => (q: string): boolean => on.includes(q);
const DESKTOP: DeviceEnv = { media: media(['(pointer: fine)', '(any-pointer: fine)', '(any-hover: hover)']), maxTouchPoints: 0, userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131', hardwareConcurrency: 16, deviceMemory: 8, secure: true };
const TOUCH_LAPTOP: DeviceEnv = { ...DESKTOP, maxTouchPoints: 10 };
const PHONE_ENV: DeviceEnv = { media: media(['(pointer: coarse)']), maxTouchPoints: 5, userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile Chrome/131', uaMobile: true, hardwareConcurrency: 8, deviceMemory: 8, gpu: 'Mali-G715 Immortalis', secure: true };
const OLD_PHONE: DeviceEnv = { ...PHONE_ENV, hardwareConcurrency: 4, deviceMemory: 3, gpu: 'Mali-G52' };
const IPAD: DeviceEnv = { media: media(['(pointer: coarse)']), maxTouchPoints: 5, userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15', secure: false };

describe('device profile', () => {
  it('desktop and touchscreen laptops are not mobile and keep the high preset', () => {
    for (const env of [DESKTOP, TOUCH_LAPTOP]) {
      const p = profileFrom(env);
      expect(p.mobile).toBe(false);
      expect(p.touchOnly).toBe(false);
      expect(defaultQualityFor(p)).toBe('high');
    }
    expect(profileFrom(TOUCH_LAPTOP).touch).toBe(true);
  });
  it('phones are touch-only mobile; the GPU / cores / memory pick low or medium', () => {
    const strong = profileFrom(PHONE_ENV);
    expect(strong).toMatchObject({ touch: true, touchOnly: true, mobile: true, ios: false, tier: 'high' });
    expect(defaultQualityFor(strong)).toBe('medium');
    const weak = profileFrom(OLD_PHONE);
    expect(weak.tier).toBe('low');
    expect(defaultQualityFor(weak)).toBe('low');
    expect(defaultQualityFor(profileFrom({ ...PHONE_ENV, gpu: '' }))).toBe('low'); // unknown GPU: mid tier → low
  });
  it('iPadOS (desktop Safari UA + touch points) is iOS and mobile', () => {
    const p = profileFrom(IPAD);
    expect(p.ios).toBe(true);
    expect(p.mobile).toBe(true);
    expect(p.secure).toBe(false);
  });
});

describe('frame governor', () => {
  it('steps down one preset when the 5 s average is under 30 fps, then settles before measuring again', () => {
    const g = createFrameGovernor({ windowS: 5, minFps: 30, settleS: 2 });
    const run = (ms: number, frameMs: number, q: 'low' | 'medium' | 'high' | 'ultra') => {
      let out: string | null = null;
      for (let t = 0; t < ms; t += frameMs) out = g.frame(frameMs, q) ?? out;
      return out;
    };
    expect(run(9000, 20, 'high')).toBeNull(); // 50 fps
    g.reset();
    expect(run(7100, 40, 'high')).toBe('medium'); // 25 fps over 2 s settle + 5 s window
    expect(run(1500, 40, 'medium')).toBeNull(); // settling after the drop
    expect(lowerQuality('low')).toBeNull();
    g.reset();
    expect(run(8000, 50, 'low')).toBeNull(); // nothing below low
  });
  it('ignores stalls (> 1 s) and non-positive frames', () => {
    const g = createFrameGovernor({ settleS: 0 });
    for (let i = 0; i < 20; i++) expect(g.frame(5000, 'high')).toBeNull();
    expect(g.frame(0, 'high')).toBeNull();
    expect(g.frame(-3, 'high')).toBeNull();
  });
});

describe('orientation', () => {
  it('portrait on a touch UI asks to rotate; landscape or desktop never does', () => {
    expect(needsRotate(390, 844, true)).toBe(true);
    expect(needsRotate(844, 390, true)).toBe(false);
    expect(needsRotate(390, 844, false)).toBe(false);
    expect(needsRotate(800, 800, true)).toBe(false);
  });
});

function memStorage(init: Record<string, string> = {}): StorageLike & { data: Record<string, string> } {
  const data = { ...init };
  return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => { data[k] = v; }, removeItem: (k) => { delete data[k]; } };
}
const timers = { setTimeout: () => 0, clearTimeout: () => {} };
const DESK: DeviceProfile = profileFrom(DESKTOP);
const PHONE: DeviceProfile = profileFrom(PHONE_ENV);

describe('settings: mobile defaults and migration', () => {
  it('defaults without a device (tests, old callers) and on desktop are unchanged: keyboard, high, intermediate', () => {
    for (const s of [defaultSettings(), defaultSettings(false, 1080, DESK)]) {
      expect(s.controls.device).toBe('keyboard');
      expect(s.graphics.preset).toBe('high');
      expect(s.assists).toEqual(ASSIST_PRESETS.intermediate);
      expect(s.controls.touch.steerMode).toBe('buttons');
    }
  });
  it('first run on a touch-only phone: touch drives, beginner assists, mobile quality, bigger HUD', () => {
    const store = createSettingsStore({ storage: memStorage(), timers, viewportHeight: 390, device: PHONE, reducedMotion: false });
    const s = store.get();
    expect(s.controls.device).toBe('touch');
    expect(s.assists).toEqual(ASSIST_PRESETS.beginner);
    expect(s.graphics.preset).toBe('medium');
    expect(s.hud.scale).toBe(autoHudScale(390, true));
    expect(s.hud.scale).toBe(1.25);
  });
  it('existing desktop data loads unchanged (no touch block yet: defaults filled in, device kept)', () => {
    const old = JSON.parse(JSON.stringify(defaultSettings())) as Record<string, unknown> & { controls: Record<string, unknown>; graphics: Record<string, unknown> };
    delete old.controls.touch;
    old.controls.device = 'gamepad';
    old.graphics.preset = 'ultra';
    const storage = memStorage({ [STORAGE_KEYS.settings]: JSON.stringify(old) });
    const s = createSettingsStore({ storage, timers, viewportHeight: 1080, device: DESK }).get();
    expect(s.controls.device).toBe('gamepad');
    expect(s.graphics.preset).toBe('ultra');
    expect(s.controls.touch).toEqual(defaultSettings().controls.touch);
    expect(migrateSettings(old).controls.device).toBe('gamepad');
  });
  it('stored desktop defaults opened on a phone switch to touch / mobile quality until the user picks something', () => {
    const storage = memStorage({ [STORAGE_KEYS.settings]: JSON.stringify(defaultSettings()) });
    const a = createSettingsStore({ storage, timers, viewportHeight: 390, device: PHONE });
    expect(a.get().controls.device).toBe('touch');
    expect(a.get().graphics.preset).toBe('medium');
    a.setPath('controls.device', 'keyboard');
    a.setPath('graphics.preset', 'high');
    a.flush();
    const b = createSettingsStore({ storage, timers, viewportHeight: 390, device: PHONE });
    expect(b.get().controls.device).toBe('keyboard');
    expect(b.get().graphics.preset).toBe('high');
  });
  it('touch values are validated (enum, ranges)', () => {
    const raw = JSON.parse(JSON.stringify(defaultSettings()));
    raw.controls.device = 'joystick';
    raw.controls.touch = { steerMode: 'mouse', size: 9, opacity: -1, tiltSensitivity: 0.1, tiltDeadzone: 0.5, tiltCenter: 120, leftHanded: 'yes', pedalSlide: true, haptics: false };
    const s = migrateSettings(raw);
    expect(s.controls.device).toBe('keyboard');
    expect(s.controls.touch).toEqual({ steerMode: 'buttons', size: 1.3, opacity: 0.2, tiltSensitivity: 0.5, tiltDeadzone: 0.2, tiltCenter: 45, leftHanded: false, pedalSlide: true, haptics: false });
  });
});
