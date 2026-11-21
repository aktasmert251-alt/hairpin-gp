// Touch input (mobile, 2026-11-21, user request: "make the game playable on a phone"). The overlay (src/ui/touch) reports
// pointers per zone; this module turns them, or the device tilt, into shaped analog values and feeds the InputManager
// through the same analog path the gamepad uses (setAnalog): the sim only ever sees the values latched into
// DriverControls, so replays / ghosts / flashback stay deterministic. On-screen buttons press actions like pad buttons.
//
// Steering modes (settings.controls.touch.steerMode):
//   'buttons'  left / right halves of the steering zone, ramped like a key (partial lock on a short tap);
//   'wheel'    drag horizontally from where the finger landed (full lock at 35 % of the zone width);
//   'tilt'     DeviceOrientation roll in the screen plane (works for any screen orientation), low-pass filtered,
//              calibrated centre, deadzone, full lock at 25° / sensitivity.
// Pedals: full press, or with pedalSlide the finger height sets 30..100 %.

import type { ActionId, DeviceProfile, TouchApi, TouchLive, TouchZone } from '../../contracts/input';
import type { Settings } from '../../contracts/settings';
import type { InputManager } from './InputManager';

/** Degrees of roll for full lock at tilt sensitivity 1. */
export const TILT_FULL_DEG = 25;
/** Roll low-pass time constant (s): removes hand tremor without a felt lag. */
export const TILT_TAU = 0.06;
/** Button steering ramp (1/s): in 0.22 s to full lock, back to centre twice as fast. */
export const BUTTON_STEER_RATE = 4.5;
export const BUTTON_RETURN_RATE = 9;
/** Wheel drag: full lock at this fraction of the steering zone width. */
export const WHEEL_SPAN = 0.35;
/** Below this in-plane gravity share the phone lies flat and the roll is meaningless (held). */
const FLAT_LIMIT = 0.2;
const HAPTIC_GAP_MS = 80;

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/**
 * Roll of the device in the screen plane, in degrees (0 = upright, positive = turned anticlockwise = steer left), from
 * DeviceOrientation beta / gamma (deg) and the screen orientation angle (deg). Null when the phone lies flat.
 * World "up" in device axes for the Z-X'-Y'' Euler angles is (−sinγ·cosβ, sinβ, cosγ·cosβ); rotated into screen axes.
 */
export function tiltRollDeg(beta: number, gamma: number, screenAngle: number): number | null {
  const d = Math.PI / 180;
  const b = beta * d;
  const g = gamma * d;
  const ux = -Math.sin(g) * Math.cos(b);
  const uy = Math.sin(b);
  const a = screenAngle * d;
  const sx = ux * Math.cos(a) - uy * Math.sin(a);
  const sy = ux * Math.sin(a) + uy * Math.cos(a);
  if (Math.hypot(sx, sy) < FLAT_LIMIT) return null;
  // Up seen on the screen's right (sx > 0) means the device turned anticlockwise (to the left).
  return Math.atan2(sx, sy) / d;
}

/** Calibrated roll (deg) → steerAxis −1..1 (positive = left, the sim's convention): deadzone, rescale, clamp. */
export function tiltSteer(rollDeg: number, centerDeg: number, sensitivity: number, deadzone: number): number {
  let r = rollDeg - centerDeg;
  if (r > 180) r -= 360;
  else if (r < -180) r += 360;
  const n = r / (TILT_FULL_DEG / clamp(sensitivity, 0.5, 2));
  const a = Math.abs(n);
  if (!(a > deadzone)) return 0;
  const y = clamp((a - deadzone) / (1 - deadzone), 0, 1);
  return n < 0 ? -y : y;
}

/** Pedal travel from the finger height inside the pedal (y from the top): 1 without slide, else 0.3 (bottom) .. 1 (top 25 %). */
export function pedalValue(y: number, h: number, slide: boolean): number {
  if (!slide || !(h > 0)) return 1;
  const f = clamp((h - y) / h, 0, 1);
  return clamp(0.3 + 0.7 * (f / 0.75), 0.3, 1);
}

/** Wheel drag dx (CSS px, right positive) over a zone of width w → steerAxis (drag right = steer right = negative). */
export function wheelSteer(dx: number, w: number): number {
  return w > 0 && dx !== 0 ? clamp(-dx / (w * WHEEL_SPAN), -1, 1) : 0;
}

interface Ptr { zone: TouchZone; x: number; y: number; w: number; h: number; x0: number }

/** Minimal window surface the module listens on (tests pass a fake). */
export interface TouchWindow {
  addEventListener(type: string, cb: (e: Event) => void): void;
  removeEventListener(type: string, cb: (e: Event) => void): void;
}

export interface TouchInputOptions {
  input: InputManager;
  controls(): Readonly<Settings['controls']>;
  profile: DeviceProfile;
  /** Persists a tilt calibration (settings.controls.touch.tiltCenter). */
  setTiltCenter(deg: number): void;
  now?(): number;
  /** deviceorientation / blur source; default window when present. */
  win?: TouchWindow | null;
  /** Screen orientation angle in degrees; default screen.orientation.angle / window.orientation. */
  screenAngle?(): number;
  /** DeviceOrientationEvent.requestPermission (iOS 13+); default the real one when present. */
  requestPermission?: (() => Promise<string>) | null;
  vibrate?: ((ms: number) => boolean) | null;
}

export interface TouchInput extends TouchApi {
  /** Once per frame, after the gamepad poll (the device that drives writes the analog values last). */
  poll(): void;
  /** A key or a pad was used ('auto' device switches away from touch). */
  noteOther(): void;
  /** Feeds a deviceorientation reading (tests; the real listener calls it too). */
  orientation(beta: number | null, gamma: number | null): void;
  dispose(): void;
}

function defaultScreenAngle(): number {
  if (typeof screen !== 'undefined' && screen.orientation && typeof screen.orientation.angle === 'number') return screen.orientation.angle;
  const w = typeof window !== 'undefined' ? (window as Window & { orientation?: number }).orientation : undefined;
  return typeof w === 'number' ? (w + 360) % 360 : 0;
}

function defaultPermission(): (() => Promise<string>) | null {
  const D = typeof DeviceOrientationEvent !== 'undefined' ? (DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> }) : null;
  return D && typeof D.requestPermission === 'function' ? () => D.requestPermission!() : null;
}

export function createTouchInput(o: TouchInputOptions): TouchInput {
  const input = o.input;
  const now = o.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  const win: TouchWindow | null = o.win !== undefined ? o.win : typeof window !== 'undefined' ? window : null;
  const screenAngle = o.screenAngle ?? defaultScreenAngle;
  const requestPermission = o.requestPermission !== undefined ? o.requestPermission : defaultPermission();
  const vibrate = o.vibrate !== undefined ? o.vibrate
    : typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function' ? (ms: number) => navigator.vibrate(ms) : null;

  const ptrs = new Map<number, Ptr>();
  const held = new Map<ActionId, number>();
  let lastTouch = false;
  let analogOwned = false;
  let lastPoll = -1;
  let buttonSteer = 0;
  let tiltOn = false;
  let tiltRaw: number | null = null;
  let tiltFiltered = 0;
  let tiltSeen = false;
  let lastHaptic = -Infinity;
  const live: TouchLive = { tiltDeg: 0, tiltOk: false, steer: 0, throttle: 0, brake: 0 };

  const t = (): Readonly<Settings['controls']['touch']> => o.controls().touch;
  const drives = (): boolean => {
    const d = o.controls().device;
    return d === 'touch' || (d === 'auto' && lastTouch);
  };

  const onOrientation = (e: Event): void => {
    const ev = e as DeviceOrientationEvent;
    api.orientation(ev.beta, ev.gamma);
  };
  const onBlur = (): void => api.releaseAll();
  win?.addEventListener('blur', onBlur);
  win?.addEventListener('pagehide', onBlur);

  const startTilt = (): void => {
    if (tiltOn || !win) return;
    tiltOn = true;
    win.addEventListener('deviceorientation', onOrientation);
  };

  const api: TouchInput = {
    profile: () => o.profile,
    drives,
    uiTouch: () => o.profile.touchOnly || o.controls().device === 'touch',
    pointer(kind, zone, id, x, y, w, h) {
      if (kind === 'down') {
        lastTouch = true;
        ptrs.set(id, { zone, x, y, w, h, x0: x });
        return;
      }
      const p = ptrs.get(id);
      if (!p) return;
      if (kind === 'up') ptrs.delete(id);
      else {
        p.x = x;
        p.y = y;
        p.w = w;
        p.h = h;
      }
    },
    press(a) {
      lastTouch = true;
      held.set(a, (held.get(a) ?? 0) + 1);
      input.padPress(a);
    },
    release(a) {
      const n = held.get(a) ?? 0;
      if (n <= 0) return;
      if (n === 1) held.delete(a);
      else held.set(a, n - 1);
      input.padRelease(a);
    },
    releaseAll() {
      ptrs.clear();
      for (const [a, n] of held) for (let i = 0; i < n; i++) input.padRelease(a);
      held.clear();
      buttonSteer = 0;
    },
    live: () => live,
    async enableTilt() {
      if (!win || (o.win === undefined && typeof DeviceOrientationEvent === 'undefined')) return 'unavailable';
      if (requestPermission) {
        try {
          const r = await requestPermission();
          if (r !== 'granted') return 'denied';
        } catch {
          return 'denied';
        }
      }
      startTilt();
      return 'granted';
    },
    calibrateTilt() {
      if (tiltRaw !== null) o.setTiltCenter(Math.round(clamp(tiltFiltered, -45, 45) * 10) / 10);
    },
    haptic(ms) {
      if (!vibrate || !t().haptics || !drives()) return;
      const tm = now();
      if (tm - lastHaptic < HAPTIC_GAP_MS) return;
      lastHaptic = tm;
      try {
        vibrate(ms);
      } catch {
        /* vibration blocked (no user gesture yet / iOS): silently none */
      }
    },
    orientation(beta, gamma) {
      if (beta === null || gamma === null || !Number.isFinite(beta) || !Number.isFinite(gamma)) return;
      const r = tiltRollDeg(beta, gamma, screenAngle());
      if (r === null) return;
      tiltRaw = r;
      if (!tiltSeen) {
        tiltSeen = true;
        tiltFiltered = r;
      }
    },
    poll() {
      const tm = now();
      const dt = lastPoll < 0 ? 0 : clamp((tm - lastPoll) / 1000, 0, 0.1);
      lastPoll = tm;
      const s = t();
      const mode = s.steerMode;
      if (mode === 'tilt' && !tiltOn && o.profile.touch) startTilt();
      // Pedals and steering zones (left-handed only moves the zones on screen; the zone ids stay the same).
      let thr = 0;
      let brk = 0;
      let left = false;
      let right = false;
      let wheel = 0;
      let wheelOn = false;
      for (const p of ptrs.values()) {
        if (p.zone === 'gas') thr = Math.max(thr, pedalValue(p.y, p.h, s.pedalSlide));
        else if (p.zone === 'brake') brk = Math.max(brk, pedalValue(p.y, p.h, s.pedalSlide));
        else if (mode === 'buttons') {
          if (p.x < p.w / 2) left = true;
          else right = true;
        } else if (mode === 'wheel' && !wheelOn) {
          wheelOn = true;
          wheel = wheelSteer(p.x - p.x0, p.w);
        }
      }
      // Tilt: exponential low-pass at TILT_TAU, then calibration / deadzone / sensitivity.
      if (tiltRaw !== null && dt > 0) {
        let d = tiltRaw - tiltFiltered;
        if (d > 180) d -= 360;
        else if (d < -180) d += 360;
        tiltFiltered += d * (1 - Math.exp(-dt / TILT_TAU));
      }
      live.tiltOk = tiltSeen;
      live.tiltDeg = tiltSeen ? Math.round((tiltFiltered - s.tiltCenter) * 10) / 10 : 0;
      let steer = 0;
      if (mode === 'tilt') steer = tiltSeen ? tiltSteer(tiltFiltered, s.tiltCenter, s.tiltSensitivity, s.tiltDeadzone) : 0;
      else if (mode === 'wheel') steer = wheel;
      else {
        const target = left === right ? 0 : left ? 1 : -1;
        const back = target === 0 || target * buttonSteer < 0;
        const step = (back ? BUTTON_RETURN_RATE : BUTTON_STEER_RATE) * dt;
        buttonSteer = target > buttonSteer ? Math.min(target, buttonSteer + step) : Math.max(target, buttonSteer - step);
        steer = buttonSteer;
      }
      live.steer = steer;
      live.throttle = thr;
      live.brake = brk;
      if (input.context() === 'driving' && drives()) {
        input.setAnalog(true, steer, thr, brk);
        analogOwned = true;
      } else if (analogOwned) {
        input.setAnalog(false, 0, 0, 0);
        analogOwned = false;
      }
    },
    noteOther() {
      lastTouch = false;
    },
    dispose() {
      api.releaseAll();
      if (analogOwned) input.setAnalog(false, 0, 0, 0);
      analogOwned = false;
      win?.removeEventListener('blur', onBlur);
      win?.removeEventListener('pagehide', onBlur);
      if (tiltOn) win?.removeEventListener('deviceorientation', onOrientation);
      tiltOn = false;
    },
  };
  return api;
}
