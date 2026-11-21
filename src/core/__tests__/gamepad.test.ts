// Gamepad input (2026-10-27) with a mocked navigator.getGamepads: mapping, deadzones, curves, device selection (keyboard by
// default), hot-plug, menu navigation, rebinding, rumble gating and the settings migration.

import { describe, expect, it, vi } from 'vitest';
import type { EventMap } from '../../contracts/events';
import type { ActionId } from '../../contracts/input';
import type { Settings } from '../../contracts/settings';
import type { DriverControls } from '../../contracts/vehicle';
import { createEventBus } from '../eventBus';
import { DEFAULT_PAD_BINDINGS, PAD } from '../input/bindings';
import { createGamepadInput, MENU_REPEAT_DELAY, MENU_REPEAT_EVERY, stickResponse, triggerResponse, type PadLike } from '../input/gamepad';
import { createInputManager } from '../input/InputManager';
import { migrateSettings } from '../settings/SettingsStore';
import { defaultSettings } from '../settings/defaults';

interface MockPad { index: number; id: string; connected: boolean; axes: number[]; buttons: { pressed: boolean; value: number }[]; vibrationActuator?: PadLike['vibrationActuator'] }

function mockPad(index = 0): MockPad {
  return { index, id: 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)', connected: true, axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
}
const press = (p: MockPad, b: number, v = 1): void => {
  p.buttons[b] = { pressed: v > 0.5, value: v };
};

function controls(): DriverControls {
  return { throttle: false, brake: false, left: false, right: false, gearUpPressed: false, gearDownPressed: false, drsPressed: false, ersOvertakeHeld: false, pitLimiterPressed: false,
    ersModeSel: 'auto', brakeBias: 0.575, boxRequest: false, nextCompound: 'medium', steerSensitivity: 1, analog: false, steerAxis: 0, throttleAxis: 0, brakeAxis: 0 };
}

function rig(device: Settings['controls']['device'] = 'keyboard') {
  let s = defaultSettings();
  s.controls.device = device;
  const pads: (MockPad | null)[] = [];
  let t = 0;
  const bus = createEventBus<EventMap>();
  const input = createInputManager();
  const actions: ActionId[] = [];
  input.onAction((a) => actions.push(a));
  const pad = createGamepadInput({
    input, bus, controls: () => s.controls, getPads: () => pads, now: () => t,
    setBindings: (b) => {
      s = { ...s, controls: { ...s.controls, pad: { ...s.controls.pad, bindings: b } } };
    },
  });
  return {
    pads, input, pad, bus, actions,
    set(fn: (c: Settings['controls']) => void) { fn(s.controls); },
    advance(ms: number) { t += ms; },
    latch() { const c = controls(); input.latch(c); return c; },
  };
}

describe('response curves', () => {
  it('stick: deadzone, rescale, linearity exponent and gain (clamped)', () => {
    expect(stickResponse(0.05, 0.08, 1, 1)).toBe(0);
    expect(stickResponse(-0.08, 0.08, 1, 1)).toBe(0);
    expect(stickResponse(1, 0.08, 1, 1)).toBe(1);
    expect(stickResponse(-1, 0.08, 2, 1)).toBe(-1);
    expect(stickResponse(0.54, 0.08, 1, 1)).toBeCloseTo(0.5, 9);
    expect(stickResponse(0.54, 0.08, 2, 1)).toBeCloseTo(0.25, 9);
    expect(stickResponse(0.54, 0.08, 1, 1.5)).toBeCloseTo(0.75, 9);
    expect(stickResponse(0.9, 0.08, 1, 1.5)).toBe(1);
  });
  it('trigger: deadzone and curve', () => {
    expect(triggerResponse(0.03, 0.04, 1)).toBe(0);
    expect(triggerResponse(1, 0.04, 2)).toBe(1);
    expect(triggerResponse(0.52, 0.04, 1)).toBeCloseTo(0.5, 9);
    expect(triggerResponse(0.52, 0.04, 2)).toBeCloseTo(0.25, 9);
    expect(triggerResponse(NaN, 0.04, 1)).toBe(0);
  });
});

describe('device selection', () => {
  it('default settings: keyboard drives, the pad never touches the car but navigates menus and hints once', () => {
    expect(defaultSettings().controls.device).toBe('keyboard');
    const r = rig();
    const hints: string[] = [];
    r.bus.on('input:pad', (e) => hints.push(e.kind));
    r.pads.push(mockPad());
    r.pad.poll();
    r.input.setContext('driving');
    press(r.pads[0]!, PAD.RT, 1);
    r.pads[0]!.axes[0] = -1;
    press(r.pads[0]!, PAD.A);
    r.pad.poll();
    const c = r.latch();
    expect(c.analog).toBe(false);
    expect(c.throttleAxis).toBe(0);
    expect(c.drsPressed).toBe(false);
    expect(r.pad.drives()).toBe(false);
    expect(hints).toEqual(['connected', 'inactive']);
    // Menus work in keyboard mode.
    r.input.setContext('menu');
    press(r.pads[0]!, PAD.A, 0);
    r.pad.poll();
    press(r.pads[0]!, PAD.A);
    r.pad.poll();
    expect(r.actions).toContain('menuConfirm');
  });

  it("'gamepad': analog axes and button actions drive (stick right = negative steerAxis)", () => {
    const r = rig('gamepad');
    const p = mockPad();
    r.pads.push(p);
    r.input.setContext('driving');
    r.pad.poll();
    p.axes[0] = 0.54;
    press(p, PAD.RT, 0.52);
    press(p, PAD.LT, 1);
    press(p, PAD.RB);
    r.pad.poll();
    const s = defaultSettings().controls.pad;
    const c = r.latch();
    expect(c.analog).toBe(true);
    expect(c.steerAxis).toBeCloseTo(-stickResponse(0.54, s.steerDeadzone, s.steerLinearity, s.steerSensitivity), 9);
    expect(c.throttleAxis).toBeCloseTo(triggerResponse(0.52, s.triggerDeadzone, s.throttleCurve), 9);
    expect(c.brakeAxis).toBe(1);
    expect(c.gearUpPressed).toBe(true);
    expect(r.latch().gearUpPressed).toBe(false);
    // Held lookBack via View.
    press(p, PAD.VIEW);
    r.pad.poll();
    expect(r.input.isHeld('lookBack')).toBe(true);
    press(p, PAD.VIEW, 0);
    r.pad.poll();
    expect(r.input.isHeld('lookBack')).toBe(false);
    // Outside driving the axes are not latched.
    r.input.setContext('menu');
    r.pad.poll();
    expect(r.latch().analog).toBe(false);
  });

  it("'auto': the device used last drives", () => {
    const r = rig('auto');
    const p = mockPad();
    r.pads.push(p);
    r.input.setContext('driving');
    r.pad.poll();
    expect(r.pad.drives()).toBe(false);
    const devices: string[] = [];
    r.bus.on('input:device', (e) => devices.push(e.device));
    press(p, PAD.RT, 0.8);
    r.pad.poll();
    expect(r.latch().analog).toBe(true);
    expect(devices).toEqual(['gamepad']);
  });

  it('keyboard use flips auto back to the keyboard', () => {
    const r = rig('auto');
    const p = mockPad();
    r.pads.push(p);
    r.input.setContext('driving');
    press(p, PAD.RT, 0.8);
    r.pad.poll();
    r.pad.poll();
    expect(r.latch().analog).toBe(true);
    press(p, PAD.RT, 0);
    r.pad.poll();
    r.pad.noteKeyboard();
    r.pad.poll();
    expect(r.pad.lastDevice()).toBe('keyboard');
    expect(r.latch().analog).toBe(false);
  });
});

describe('hot-plug and multiple pads', () => {
  it('connect / disconnect events; disconnect while driving reports driving and releases held actions', () => {
    const r = rig('gamepad');
    const ev: EventMap['input:pad'][] = [];
    r.bus.on('input:pad', (e) => ev.push(e));
    r.pad.poll();
    expect(r.pad.live()).toBeNull();
    const p = mockPad();
    r.pads.push(p);
    r.pad.poll();
    expect(ev[0]).toMatchObject({ kind: 'connected', name: 'Xbox Wireless Controller' });
    r.input.setContext('driving');
    press(p, PAD.VIEW);
    press(p, PAD.RT, 1);
    r.pad.poll();
    expect(r.input.isHeld('lookBack')).toBe(true);
    r.pads[0] = null;
    r.pad.poll();
    expect(ev[1]).toMatchObject({ kind: 'disconnected', driving: true });
    expect(r.input.isHeld('lookBack')).toBe(false);
    expect(r.latch().analog).toBe(false);
    expect(r.pad.drives()).toBe(false);
  });

  it('several pads: the first one with input wins; buttons held at connect do not fire', () => {
    const r = rig('gamepad');
    const a = mockPad(0);
    const b = mockPad(1);
    press(b, PAD.A);
    r.pads.push(a, b);
    r.pad.poll();
    expect(r.actions).toEqual([]);
    a.axes[0] = 1;
    b.axes[0] = -1;
    r.input.setContext('driving');
    r.pad.poll();
    expect(r.latch().steerAxis).toBeGreaterThan(0); // pad 1 (stick left) is the active one
  });
});

describe('menu navigation', () => {
  it('D-pad, left stick, A / B, LB / RB, Start; held directions auto-repeat', () => {
    const r = rig();
    const p = mockPad();
    r.pads.push(p);
    r.pad.poll();
    const tap = (b: number): void => {
      press(p, b);
      r.pad.poll();
      press(p, b, 0);
      r.pad.poll();
    };
    tap(PAD.DOWN);
    tap(PAD.A);
    tap(PAD.B);
    tap(PAD.LB);
    tap(PAD.RB);
    tap(PAD.START);
    expect(r.actions).toEqual(['menuDown', 'menuConfirm', 'menuBack', 'menuTabPrev', 'menuTabNext', 'pause']);
    r.actions.length = 0;
    p.axes[1] = -0.9;
    r.pad.poll();
    expect(r.actions).toEqual(['menuUp']);
    r.advance(MENU_REPEAT_DELAY);
    r.pad.poll();
    r.advance(MENU_REPEAT_EVERY);
    r.pad.poll();
    expect(r.actions).toEqual(['menuUp', 'menuUp', 'menuUp']);
    r.advance(10);
    r.pad.poll();
    expect(r.actions.length).toBe(3);
  });

  it('flashback context: A applies, D-pad scrubs (held), RS = flashback', () => {
    const r = rig('gamepad');
    const p = mockPad();
    r.pads.push(p);
    r.pad.poll();
    r.input.setContext('flashback');
    press(p, PAD.LEFT);
    press(p, PAD.RS);
    r.pad.poll();
    expect(r.input.isHeld('menuLeft')).toBe(true);
    expect([...r.actions].sort()).toEqual(['flashback', 'menuLeft']);
  });
});

describe('rebinding and rumble', () => {
  it('press-to-bind takes the button from the other driving action; Start cancels; pad input is swallowed meanwhile', () => {
    const r = rig('gamepad');
    const p = mockPad();
    r.pads.push(p);
    r.pad.poll();
    const results: unknown[] = [];
    r.pad.startRebind('gearUp', (x) => results.push(x));
    press(p, PAD.A);
    r.pad.poll();
    expect(results[0]).toEqual({ ok: true, action: 'gearUp', button: PAD.A, replaced: 'drs' });
    expect(r.pad.bindings().gearUp).toEqual([PAD.A]);
    expect(r.pad.bindings().drs).toEqual([]);
    expect(r.pad.bindings().menuConfirm).toEqual([PAD.A]);
    expect(r.actions).toEqual([]);
    r.pad.startRebind('cameraNext', (x) => results.push(x));
    press(p, PAD.START);
    r.pad.poll();
    expect(results[1]).toEqual({ ok: false, action: 'cameraNext', reason: 'cancelled' });
    r.pad.resetBindings();
    expect(r.pad.bindings()).toEqual(DEFAULT_PAD_BINDINGS);
  });

  it('rumble only when vibration is on and the pad drives; strength scales', () => {
    const r = rig('keyboard');
    const p = mockPad();
    const playEffect = vi.fn(() => Promise.resolve());
    p.vibrationActuator = { playEffect };
    r.pads.push(p);
    r.pad.poll();
    r.pad.rumble(1, 1, 100);
    expect(playEffect).not.toHaveBeenCalled();
    r.set((c) => { c.device = 'gamepad'; c.pad.vibrationStrength = 0.5; });
    r.pad.rumble(1, 0.4, 100);
    expect(playEffect).toHaveBeenCalledWith('dual-rumble', { startDelay: 0, duration: 100, strongMagnitude: 0.5, weakMagnitude: 0.2 });
    r.advance(200);
    r.set((c) => { c.pad.vibration = false; });
    r.pad.rumble(1, 1, 100);
    expect(playEffect).toHaveBeenCalledTimes(1);
  });
});

describe('settings migration', () => {
  it('stored settings without gamepad fields keep the keyboard and get the pad defaults', () => {
    const old = JSON.parse(JSON.stringify(defaultSettings())) as Record<string, unknown> & { controls: Record<string, unknown> };
    delete old.controls.device;
    delete old.controls.pad;
    const s = migrateSettings(old);
    expect(s.controls.device).toBe('keyboard');
    expect(s.controls.pad).toEqual(defaultSettings().controls.pad);
  });
  it('bad pad values are clamped / reset', () => {
    const raw = JSON.parse(JSON.stringify(defaultSettings()));
    raw.controls.device = 'joystick';
    raw.controls.pad.steerDeadzone = 2;
    raw.controls.pad.bindings.drs = [16, 3, 3, 99, 'x'];
    raw.controls.pad.bindings.gearUp = 'RB';
    const s = migrateSettings(raw);
    expect(s.controls.device).toBe('keyboard');
    expect(s.controls.pad.steerDeadzone).toBe(0.4);
    expect(s.controls.pad.bindings.drs).toEqual([3]);
    expect(s.controls.pad.bindings.gearUp).toEqual([PAD.RB]);
  });
});
