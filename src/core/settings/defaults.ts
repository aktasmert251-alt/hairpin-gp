// Default settings + storage keys (§3.9).

import type { AssistSettings } from '../../contracts/race';
import type { DeviceProfile } from '../../contracts/input';
import type { Settings } from '../../contracts/settings';
import { defaultBindings, defaultPadBindings } from '../input/bindings';
import { defaultQualityFor } from '../platform/device';

export const STORAGE_KEYS = {
  settings: 'apexgp:v1:settings',
  /** Which settings paths the user set explicitly (D-004: auto defaults never override those). */
  settingsMeta: 'apexgp:v1:settingsMeta',
  lastRaceSetup: 'apexgp:v1:lastRaceSetup',
  tt: (trackId: string) => `apexgp:v1:tt:${trackId}`,
  /** CR-TRK-5: keyed by track and build. */
  rivalGhost: (trackId: string, buildHash: string) => `apexgp:v1:rivalGhost:${trackId}:${buildHash}`,
  /** sprint-2 §2: PB ghost, 20 Hz × 7 floats, base64. */
  ghost: (trackId: string) => `apexgp:v1:ghost:${trackId}:pb`,
} as const;

export const SETTINGS_VERSION = 1 as const;

/** Assist presets (§5.8). */
export const ASSIST_PRESETS: Readonly<Record<'beginner' | 'intermediate' | 'expert', AssistSettings>> = {
  beginner: { steering: true, braking: 'high', abs: true, tc: 'full', gearbox: 'auto', racingLine: 'full', pit: true, ers: true, drs: true, kbBrakeLimiter: true },
  intermediate: { steering: true, braking: 'off', abs: true, tc: 'medium', gearbox: 'auto', racingLine: 'corners', pit: true, ers: true, drs: false, kbBrakeLimiter: true },
  expert: { steering: false, braking: 'off', abs: false, tc: 'off', gearbox: 'manual', racingLine: 'off', pit: false, ers: false, drs: false, kbBrakeLimiter: false },
};

/** Decision D-004: HUD scale 1.1 below 900 px viewport height, else 1.0 (only while the user has not set it). Mobile: 1.25 on a touch-only phone (< 600 px) so the HUD boxes outgrow the 12 px text floor. */
export function autoHudScale(viewportHeight: number | undefined, touchPhone = false): number {
  if (touchPhone && viewportHeight !== undefined && viewportHeight > 0 && viewportHeight < 600) return 1.25;
  return viewportHeight !== undefined && viewportHeight > 0 && viewportHeight < 900 ? 1.1 : 1.0;
}

/** Touch controls defaults (mobile, 2026-11-21). */
export function defaultTouchSettings(): Settings['controls']['touch'] {
  return {
    steerMode: 'buttons', size: 1, opacity: 0.55, leftHanded: false,
    tiltSensitivity: 1, tiltDeadzone: 0.04, tiltCenter: 0, pedalSlide: false, haptics: true,
  };
}

/**
 * Defaults per docs/ARCHITECTURE.md §10.2. `reducedMotion` applies only on first run (nothing stored yet);
 * `viewportHeight` (CSS px) drives the D-004 hud.scale default. `device` (mobile, 2026-11-21): on a touch-only device the
 * first run drives with the touch controls, the beginner assists and the mobile quality; every other device (desktop,
 * touchscreen laptop, tests) gets the unchanged keyboard / high defaults.
 */
export function defaultSettings(reducedMotion = false, viewportHeight?: number, device?: DeviceProfile): Settings {
  const touchFirst = device?.touchOnly === true;
  return {
    version: SETTINGS_VERSION,
    lang: 'tr',
    graphics: {
      preset: device ? defaultQualityFor(device) : 'high', custom: {}, fovOffset: 0, showFps: false,
      cameraShake: reducedMotion ? 0 : 0.6, motionEffects: !reducedMotion,
    },
    audio: { master: 0.8, engine: 0.9, sfx: 0.8, ambience: 0.6, ui: 0.6 },
    controls: {
      layout: 'combined', bindings: defaultBindings(), steerSensitivity: 1,
      // Gamepad (2026-10-27): the keyboard stays the default driving device.
      device: touchFirst ? 'touch' : 'keyboard',
      pad: {
        bindings: defaultPadBindings(), steerDeadzone: 0.08, steerLinearity: 1.4, steerSensitivity: 1, speedSteer: false,
        triggerDeadzone: 0.04, throttleCurve: 1, brakeCurve: 1.3, vibration: true, vibrationStrength: 0.7,
      },
      touch: defaultTouchSettings(),
    },
    // Touch: steering + braking assists on (beginner) so a phone is drivable from the first race.
    assists: { ...(touchFirst ? ASSIST_PRESETS.beginner : ASSIST_PRESETS.intermediate) },
    hud: { mode: 'full', minimap: true, units: 'kmh', scale: autoHudScale(viewportHeight, touchFirst) },
    camera: { default: 'chaseNear' },
    gameplay: { difficulty: 55, flashbacks: 5 }, // D-051 #1
    ui: { animations: 'auto', trailer: true },
  };
}
