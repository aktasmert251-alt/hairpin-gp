// Contract: input actions and bindings. Implemented by: Yönetici (src/core/input/InputManager.ts).

import type { Unsubscribe } from './common';

export type ActionId = 'throttle' | 'brake' | 'steerLeft' | 'steerRight' | 'gearUp' | 'gearDown' | 'drs' | 'ersOvertake' | 'pitLimiter' | 'cameraNext' | 'lookBack'
  | 'flashback' | 'pause' | 'mfdNext' | 'mfd1' | 'mfd2' | 'mfd3' | 'mfd4' | 'racingLine' | 'hudCycle' | 'restartLap' | 'debugOverlay'
  | 'menuUp' | 'menuDown' | 'menuLeft' | 'menuRight' | 'menuConfirm' | 'menuBack'
  /** D-056: in-race shortcut to the main menu (asks for confirmation). */
  | 'mainMenu'
  /** Gamepad LB / RB in menus (tab lists); no keyboard default. */
  | 'menuTabPrev' | 'menuTabNext';

export interface MenuInputSource { onAction(cb: (a: ActionId) => void): Unsubscribe }

// ---------------------------------------------------------------------------------------------
// Additions (Sprint 0): contexts and the rebinding/label API used by the controls screen.

export type InputContext = 'menu' | 'driving' | 'flashback' | 'rebind';

export type RebindResult =
  | { ok: true; action: ActionId; code: string; slot: number; replaced: ActionId | null }
  | { ok: false; action: ActionId; reason: 'cancelled' | 'modifier' | 'reserved' };

export interface KeyBindingsApi {
  bindings(): Readonly<Record<ActionId, readonly string[]>>;
  /** Display label for a KeyboardEvent.code (uses navigator.keyboard.getLayoutMap() when available). */
  label(code: string): string;
  labelsFor(action: ActionId): string[];
  /** Captures the next key press for `action` at binding `slot` (0 = primary). Escape cancels. */
  startRebind(action: ActionId, slot: number, cb: (r: RebindResult) => void): void;
  cancelRebind(): void;
  setBinding(action: ActionId, slot: number, code: string): RebindResult;
  resetBindings(): void;
}

// ---------------------------------------------------------------------------------------------
// Addition (2026-10-27): gamepad (standard mapping) bindings, live values and rumble for the UI and the session glue.

export type InputDeviceKind = 'keyboard' | 'gamepad';

export type PadRebindResult =
  | { ok: true; action: ActionId; button: number; replaced: ActionId | null }
  | { ok: false; action: ActionId; reason: 'cancelled' | 'reserved' };

/** Live values of the active pad: raw device reads and the shaped values the sim receives. */
export interface PadLive { name: string; rawSteer: number; rawThrottle: number; rawBrake: number; steer: number; throttle: number; brake: number; buttons: number }

export interface GamepadApi {
  /** Device used last (keyboard until a pad is touched). */
  lastDevice(): InputDeviceKind;
  /** True when the pad drives the car now (settings.controls.device + last device). */
  drives(): boolean;
  /** Null when no pad is connected. */
  live(): PadLive | null;
  bindings(): Readonly<Record<ActionId, readonly number[]>>;
  /** Short glyph for a standard-mapping button index (A, B, X, Y, LB, RB, LT, RT, …). */
  label(button: number): string;
  /** Captures the next pad button for `action` (Start / keyboard Esc cancel). */
  startRebind(action: ActionId, cb: (r: PadRebindResult) => void): void;
  cancelRebind(): void;
  resetBindings(): void;
  /** Dual-rumble (0..1 magnitudes); no-op when vibration is off, the pad does not drive or has no actuator. */
  rumble(strong: number, weak: number, ms: number): void;
}

// ---------------------------------------------------------------------------------------------
// Addition (2026-11-21, mobile): touch controls + device profile. Touch feeds the same analog path as the gamepad
// (InputManager.setAnalog), so the sim only sees the latched, shaped values (deterministic replays).

/** Detected once at boot. `touchOnly` = coarse primary pointer and no fine pointer / hover (phones, tablets). */
export interface DeviceProfile {
  touch: boolean; touchOnly: boolean; mobile: boolean; ios: boolean;
  /** Rough performance class from cores / memory / GPU string: picks the default quality on mobile. */
  tier: 'low' | 'mid' | 'high';
  /** DeviceOrientation, Fullscreen and Wake Lock need https (or localhost). */
  secure: boolean;
}

/** On-screen control zones the overlay reports pointers for. */
export type TouchZone = 'steer' | 'gas' | 'brake';

/** Live touch values for the settings test row: raw tilt (deg, after calibration) and the shaped values the sim receives. */
export interface TouchLive { tiltDeg: number; tiltOk: boolean; steer: number; throttle: number; brake: number }

export interface TouchApi {
  profile(): DeviceProfile;
  /** True when the on-screen controls drive the car (settings.controls.device 'touch', or 'auto' after a touch). */
  drives(): boolean;
  /** True when the UI should be touch-friendly (touch-only device or touch chosen as the device). */
  uiTouch(): boolean;
  /** Zone pointer from the overlay: x / y in CSS px inside the zone rect of size w × h. */
  pointer(kind: 'down' | 'move' | 'up', zone: TouchZone, id: number, x: number, y: number, w: number, h: number): void;
  /** On-screen buttons (DRS, gears, camera, pause, MFD…): held + edge like a key. */
  press(a: ActionId): void;
  release(a: ActionId): void;
  /** Drops every pointer and button (cancel, blur, overlay hidden). */
  releaseAll(): void;
  live(): TouchLive;
  /** Starts tilt (iOS: the permission prompt; must be called from a tap). */
  enableTilt(): Promise<'granted' | 'denied' | 'unavailable'>;
  /** Uses the current tilt as the centre (settings.controls.touch.tiltCenter). */
  calibrateTilt(): void;
  /** Light haptic tap (navigator.vibrate) when haptics are on and supported. */
  haptic(ms: number): void;
}
