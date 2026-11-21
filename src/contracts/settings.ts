// Contract: persisted settings. Implemented by: Yönetici (src/core/settings/SettingsStore.ts).

import type { AudioSettings } from './audio';
import type { CameraId, Lang, QualityId } from './common';
import type { ActionId } from './input';
import type { AssistSettings } from './race';
import type { QualityPreset } from './render';
import type { Store } from './ui';

export interface Settings {
  version: 1; lang: Lang;
  graphics: { preset: QualityId | 'custom'; custom: Partial<QualityPreset>; fovOffset: number; showFps: boolean; cameraShake: number; motionEffects: boolean };
  audio: AudioSettings;
  /** Deviation from §4: `layout` gains 'combined' (PLAN Ek D default: WASD and arrows both bound). */
  controls: { layout: 'combined' | 'wasd' | 'arrows'; bindings: Record<ActionId, string[]>; steerSensitivity: number;
    /** Gamepad (2026-10-27): which device drives. Default 'keyboard'; 'auto' = the device used last. */
    device: 'keyboard' | 'gamepad' | 'auto' | 'touch'; pad: PadSettings;
    /** Mobile (2026-11-21): on-screen / tilt controls ('touch' is the first-run default on touch-only devices only). */
    touch: TouchSettings };
  assists: AssistSettings;
  hud: { mode: 'full' | 'minimal' | 'off'; minimap: boolean; units: 'kmh' | 'mph'; scale: number };
  camera: { default: CameraId };
  gameplay: { difficulty: number; flashbacks: number };
  /** Addition (Sprint 0 brief): 'auto' follows prefers-reduced-motion. */
  ui: { animations: 'auto' | 'on' | 'off'; /** Play the intro trailer after the title key. */ trailer: boolean };
}

/** Gamepad response settings (standard mapping button indices in `bindings`). */
export interface PadSettings {
  bindings: Record<ActionId, number[]>;
  /** Stick deadzone 0..0.4, linearity exponent 1..3 (1 = linear), gain 0.5..1.5, extra lock reduction with speed. */
  steerDeadzone: number; steerLinearity: number; steerSensitivity: number; speedSteer: boolean;
  /** Trigger deadzone 0..0.3; response exponents 0.5..3 (1 = linear, > 1 = finer at the start of travel). */
  triggerDeadzone: number; throttleCurve: number; brakeCurve: number;
  vibration: boolean; vibrationStrength: number;
}

/** Touch controls (2026-11-21). */
export interface TouchSettings {
  /** Left-side steering: tilt (DeviceOrientation), left/right pads, or a draggable wheel. */
  steerMode: 'tilt' | 'buttons' | 'wheel';
  /** Control size 0.8..1.3, opacity 0.2..1, left-handed swaps steering and pedals. */
  size: number; opacity: number; leftHanded: boolean;
  /** Tilt: degrees for full lock at 1 = 25° (0.5..2), deadzone 0..0.2 of full lock, calibrated centre in degrees. */
  tiltSensitivity: number; tiltDeadzone: number; tiltCenter: number;
  /** Partial throttle / brake from the finger height on the pedal. */
  pedalSlide: boolean;
  haptics: boolean;
}

export interface SettingsStore extends Store<Settings> {
  /** Dot path, e.g. `audio.master` or `controls.bindings.throttle`. */
  setPath(path: string, value: unknown): void;
  reset(section?: keyof Settings): void;
}
