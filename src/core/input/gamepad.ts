// Gamepad input (2026-10-27, user request: "play with an Xbox controller; the default must always be the keyboard").
// Polls navigator.getGamepads() (W3C "standard" mapping) once per frame and feeds the InputManager:
//   - buttons → the same ActionIds keys produce (padPress / padRelease, menu auto-repeat), per input context;
//   - left stick X / bound triggers → shaped analog values (deadzone, linearity, gain, trigger curves) via setAnalog().
// Driving needs settings.controls.device = 'gamepad', or 'auto' with the pad used last; in 'keyboard' (default) the pad
// only navigates menus and an 'input:pad' 'inactive' hint is emitted. The sim only ever sees the shaped values latched
// into DriverControls (deterministic replays / ghosts); raw device reads stay here.

import type { EventBus, EventMap } from '../../contracts/events';
import type { ActionId, GamepadApi, InputDeviceKind, PadLive, PadRebindResult } from '../../contracts/input';
import type { Settings } from '../../contracts/settings';
import { CONTEXT_ACTIONS, PAD, PAD_BUTTONS, REPEATABLE_ACTIONS, defaultPadBindings } from './bindings';
import type { InputManager } from './InputManager';

/** The subset of the DOM Gamepad the module reads (lets tests mock navigator.getGamepads). */
export interface PadLike {
  readonly index: number;
  readonly id: string;
  readonly connected: boolean;
  readonly axes: readonly number[];
  readonly buttons: readonly { readonly pressed: boolean; readonly value: number }[];
  readonly vibrationActuator?: { playEffect?(type: string, params: Record<string, number>): Promise<unknown> } | null;
}

export const PAD_LABELS: readonly string[] = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'View', 'Start', 'LS', 'RS', '↑', '↓', '←', '→', 'Guide'];

/** Menu auto-repeat of a held D-pad / stick direction (ms). */
export const MENU_REPEAT_DELAY = 380;
export const MENU_REPEAT_EVERY = 90;
/** Left stick deflection that counts as a menu direction. */
export const STICK_MENU = 0.55;
/** Activity thresholds that make the pad the last-used device. */
const ACTIVE_STICK = 0.35;
const ACTIVE_TRIGGER = 0.15;
/** Seconds between two 'inactive' hints while the keyboard is the driving device. */
const INACTIVE_HINT_MS = 20000;

/** Virtual buttons 17..20: left stick up / down / left / right (menus only). */
const N_VIRTUAL = PAD_BUTTONS + 4;
const STICK_MENU_ACTIONS: readonly ActionId[] = ['menuUp', 'menuDown', 'menuLeft', 'menuRight'];
/** Analog axes: never pressed as actions. */
const ANALOG_ACTIONS: ReadonlySet<ActionId> = new Set<ActionId>(['throttle', 'brake', 'steerLeft', 'steerRight']);
const MENU_FIXED: readonly ActionId[] = ['menuUp', 'menuDown', 'menuLeft', 'menuRight', 'menuConfirm', 'menuBack', 'pause', 'menuTabPrev', 'menuTabNext'];

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Stick axis → −1..1: axial deadzone, rescale, |n|^linearity, × gain (clamped). */
export function stickResponse(x: number, deadzone: number, linearity: number, gain: number): number {
  const a = x < 0 ? -x : x;
  if (!(a > deadzone)) return 0;
  const n = clamp01((a - deadzone) / (1 - deadzone));
  const y = clamp01(Math.pow(n, linearity) * gain);
  return x < 0 ? -y : y;
}

/** Trigger 0..1: deadzone, rescale, n^curve. */
export function triggerResponse(v: number, deadzone: number, curve: number): number {
  if (!(v > deadzone)) return 0;
  return Math.pow(clamp01((v - deadzone) / (1 - deadzone)), curve);
}

export interface GamepadInputOptions {
  input: InputManager;
  controls(): Readonly<Settings['controls']>;
  /** Persists rebinds (settings.controls.pad.bindings). */
  setBindings(b: Record<ActionId, number[]>): void;
  getPads?(): readonly (PadLike | null)[];
  bus?: EventBus<EventMap>;
  now?(): number;
}

export interface GamepadInput extends GamepadApi {
  /** Once per frame. */
  poll(): void;
  /** A keyboard key went down (last-used device for 'auto' and the on-screen hints). */
  noteKeyboard(): void;
  dispose(): void;
}

function defaultGetPads(): readonly (PadLike | null)[] {
  try {
    return typeof navigator !== 'undefined' && typeof navigator.getGamepads === 'function' ? (navigator.getGamepads() as unknown as (PadLike | null)[]) : [];
  } catch {
    return [];
  }
}

/** Short device name for the UI ("Xbox Wireless Controller (STANDARD GAMEPAD …)" → "Xbox Wireless Controller"). */
function padName(id: string): string {
  const i = id.indexOf('(');
  const s = (i > 0 ? id.slice(0, i) : id).trim();
  return s.length > 0 ? s.slice(0, 40) : 'Gamepad';
}

export function createGamepadInput(o: GamepadInputOptions): GamepadInput {
  const input = o.input;
  const getPads = o.getPads ?? defaultGetPads;
  const now = o.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  const prev = new Uint8Array(N_VIRTUAL);
  const cur = new Uint8Array(N_VIRTUAL);
  const pressedWith: ActionId[][] = Array.from({ length: N_VIRTUAL }, () => []);
  const pressedAt = new Float64Array(N_VIRTUAL);
  const repeatedAt = new Float64Array(N_VIRTUAL);
  let pad: PadLike | null = null;
  let activeIndex = -1;
  let last: InputDeviceKind = 'keyboard';
  let lastInactiveHint = -Infinity;
  let rebind: { action: ActionId; cb: (r: PadRebindResult) => void } | null = null;
  let rumbleUntil = 0;
  let rumbleMag = 0;
  const live: PadLive = { name: '', rawSteer: 0, rawThrottle: 0, rawBrake: 0, steer: 0, throttle: 0, brake: 0, buttons: 0 };

  const bindings = (): Record<ActionId, number[]> => o.controls().pad.bindings;
  const value = (p: PadLike, i: number): number => {
    const b = p.buttons[i];
    return b ? (b.value > 0 ? b.value : b.pressed ? 1 : 0) : 0;
  };
  const maxOf = (p: PadLike, list: readonly number[]): number => {
    let v = 0;
    for (let k = 0; k < list.length; k++) {
      const x = value(p, list[k]!);
      if (x > v) v = x;
    }
    return v;
  };
  const drivesNow = (): boolean => {
    if (!pad) return false;
    const d = o.controls().device;
    return d === 'gamepad' || (d === 'auto' && last === 'gamepad');
  };
  const setLast = (d: InputDeviceKind): void => {
    if (last === d) return;
    last = d;
    o.bus?.emit('input:device', { device: d });
  };

  const actionsFor = (ctx: ReturnType<InputManager['context']>, i: number, drives: boolean): ActionId[] => {
    if (i >= PAD_BUTTONS) return ctx === 'driving' || ctx === 'rebind' ? [] : [STICK_MENU_ACTIONS[i - PAD_BUTTONS]!];
    const b = bindings();
    const out: ActionId[] = [];
    if (ctx === 'driving') {
      if (!drives) return out;
      for (const a of CONTEXT_ACTIONS.driving) if (!ANALOG_ACTIONS.has(a) && b[a]?.includes(i)) out.push(a);
      return out;
    }
    if (ctx === 'rebind') return out;
    for (const a of MENU_FIXED) if (b[a]?.includes(i)) out.push(a);
    if (ctx === 'flashback' && b.flashback?.includes(i)) out.push('flashback');
    return out;
  };

  const releaseAll = (): void => {
    for (let i = 0; i < N_VIRTUAL; i++) {
      for (const a of pressedWith[i]!) input.padRelease(a);
      pressedWith[i] = [];
      prev[i] = 0;
    }
    input.setAnalog(false, 0, 0, 0);
  };

  const finishRebind = (r: PadRebindResult): void => {
    const req = rebind;
    rebind = null;
    req?.cb(r);
  };

  const setBinding = (action: ActionId, button: number): PadRebindResult => {
    const b: Record<ActionId, number[]> = {} as Record<ActionId, number[]>;
    const src = bindings();
    for (const k of Object.keys(src) as ActionId[]) b[k] = [...src[k]];
    let replaced: ActionId | null = null;
    // Only driving actions compete for a button: the menu set (A / B / D-pad / Start / LB / RB) is fixed and separate.
    for (const other of CONTEXT_ACTIONS.driving) {
      if (other === action) continue;
      const i = b[other].indexOf(button);
      if (i >= 0) {
        b[other].splice(i, 1);
        if (replaced === null) replaced = other;
      }
    }
    b[action] = [button];
    o.setBindings(b);
    return { ok: true, action, button, replaced };
  };

  const api: GamepadInput = {
    poll() {
      const t = now();
      const pads = getPads();
      let next: PadLike | null = null;
      if (activeIndex >= 0) for (const p of pads) if (p && p.connected && p.index === activeIndex) next = p;
      if (!next && pad) {
        // Hot-unplug: drop everything the pad held; offline races pause on `driving` (session glue).
        const driving = drivesNow() && input.context() === 'driving';
        const name = live.name;
        releaseAll();
        pad = null;
        activeIndex = -1;
        live.name = '';
        o.bus?.emit('input:pad', { kind: 'disconnected', name, driving });
      }
      if (!next) {
        // Several pads: the first one with input wins, else the first connected one.
        let first: PadLike | null = null;
        for (const p of pads) {
          if (!p || !p.connected) continue;
          first ??= p;
          if (p.buttons.some((b) => b.pressed)) {
            next = p;
            break;
          }
        }
        next ??= first;
        if (next) {
          activeIndex = next.index;
          live.name = padName(next.id);
          // Buttons already down at connect count as held (no edge).
          for (let i = 0; i < PAD_BUTTONS; i++) prev[i] = next.buttons[i]?.pressed || value(next, i) > 0.5 ? 1 : 0;
          o.bus?.emit('input:pad', { kind: 'connected', name: live.name, driving: false });
        }
      }
      pad = next;
      if (!pad) return;

      const ax = pad.axes[0] ?? 0;
      const ay = pad.axes[1] ?? 0;
      let active = false;
      let mask = 0;
      for (let i = 0; i < PAD_BUTTONS; i++) {
        const down = pad.buttons[i]?.pressed === true || value(pad, i) > 0.5;
        cur[i] = down ? 1 : 0;
        if (down) {
          active = true;
          mask |= 1 << i;
        }
      }
      cur[PAD_BUTTONS] = ay < -STICK_MENU ? 1 : 0;
      cur[PAD_BUTTONS + 1] = ay > STICK_MENU ? 1 : 0;
      cur[PAD_BUTTONS + 2] = ax < -STICK_MENU ? 1 : 0;
      cur[PAD_BUTTONS + 3] = ax > STICK_MENU ? 1 : 0;
      if (Math.abs(ax) > ACTIVE_STICK || Math.abs(ay) > ACTIVE_STICK || value(pad, PAD.LT) > ACTIVE_TRIGGER || value(pad, PAD.RT) > ACTIVE_TRIGGER) active = true;
      if (active) setLast('gamepad');

      const ctx = input.context();
      const drives = drivesNow();
      if (active && ctx === 'driving' && !drives && o.controls().device === 'keyboard' && t - lastInactiveHint >= INACTIVE_HINT_MS) {
        lastInactiveHint = t;
        o.bus?.emit('input:pad', { kind: 'inactive', name: live.name, driving: false });
      }

      for (let i = 0; i < N_VIRTUAL; i++) {
        const down = cur[i] === 1;
        const was = prev[i] === 1;
        if (down && !was) {
          if (rebind && i < PAD_BUTTONS) {
            if (i === PAD.START) finishRebind({ ok: false, action: rebind.action, reason: 'cancelled' });
            else if (i === PAD.GUIDE) finishRebind({ ok: false, action: rebind.action, reason: 'reserved' });
            else finishRebind(setBinding(rebind.action, i));
          } else if (!rebind) {
            const acts = actionsFor(ctx, i, drives);
            pressedWith[i] = acts;
            pressedAt[i] = t;
            repeatedAt[i] = t;
            for (const a of acts) input.padPress(a);
          }
        } else if (!down && was) {
          for (const a of pressedWith[i]!) input.padRelease(a);
          pressedWith[i] = [];
        } else if (down && ctx !== 'driving' && t - pressedAt[i]! >= MENU_REPEAT_DELAY && t - repeatedAt[i]! >= MENU_REPEAT_EVERY) {
          let rep = false;
          for (const a of pressedWith[i]!) {
            if (REPEATABLE_ACTIONS.has(a)) {
              input.padRepeat(a);
              rep = true;
            }
          }
          if (rep) repeatedAt[i] = t;
        }
        prev[i] = cur[i]!;
      }

      const s = o.controls().pad;
      const b = bindings();
      const rawThr = maxOf(pad, b.throttle);
      const rawBrk = maxOf(pad, b.brake);
      // Stick right (+x) = steer right = negative steerAxis (left − right convention).
      live.rawSteer = ax;
      live.rawThrottle = rawThr;
      live.rawBrake = rawBrk;
      live.steer = -stickResponse(ax, s.steerDeadzone, s.steerLinearity, s.steerSensitivity);
      live.throttle = triggerResponse(rawThr, s.triggerDeadzone, s.throttleCurve);
      live.brake = triggerResponse(rawBrk, s.triggerDeadzone, s.brakeCurve);
      live.buttons = mask;
      if (ctx === 'driving' && drives && !rebind) input.setAnalog(true, live.steer, live.throttle, live.brake);
      else input.setAnalog(false, 0, 0, 0);
    },
    noteKeyboard() {
      setLast('keyboard');
    },
    lastDevice: () => last,
    drives: drivesNow,
    live: () => (pad ? live : null),
    bindings,
    label: (i) => PAD_LABELS[i] ?? `B${i}`,
    startRebind(action, cb) {
      if (rebind) finishRebind({ ok: false, action: rebind.action, reason: 'cancelled' });
      rebind = { action, cb };
    },
    cancelRebind() {
      if (rebind) finishRebind({ ok: false, action: rebind.action, reason: 'cancelled' });
    },
    resetBindings() {
      o.setBindings(defaultPadBindings());
    },
    rumble(strong, weak, ms) {
      const s = o.controls().pad;
      const act = pad?.vibrationActuator;
      if (!s.vibration || s.vibrationStrength <= 0 || !drivesNow() || !act?.playEffect) return;
      const t = now();
      const mag = Math.max(strong, weak);
      // A weaker effect never cuts a stronger one that is still playing.
      if (t < rumbleUntil && mag <= rumbleMag) return;
      rumbleUntil = t + ms;
      rumbleMag = mag;
      const k = s.vibrationStrength;
      act.playEffect('dual-rumble', { startDelay: 0, duration: ms, strongMagnitude: clamp01(strong * k), weakMagnitude: clamp01(weak * k) }).catch(() => {});
    },
    dispose() {
      if (rebind) finishRebind({ ok: false, action: rebind.action, reason: 'cancelled' });
      releaseAll();
      pad = null;
    },
  };
  return api;
}
