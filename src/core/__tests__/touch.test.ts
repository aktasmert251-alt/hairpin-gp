// Touch input (mobile, 2026-11-21): zone mapping to the analog path (multi-touch, pedals, pads, wheel), release on up /
// cancel / blur, on-screen buttons as held actions, tilt maths and filtering with a mocked deviceorientation source, and
// device selection (touch drives only when chosen; keyboard default untouched).

import { describe, expect, it } from 'vitest';
import type { DeviceProfile } from '../../contracts/input';
import type { Settings } from '../../contracts/settings';
import type { DriverControls } from '../../contracts/vehicle';
import { createInputManager } from '../input/InputManager';
import {
  BUTTON_STEER_RATE, TILT_FULL_DEG, createTouchInput, pedalValue, tiltRollDeg, tiltSteer, wheelSteer, type TouchWindow,
} from '../input/touch';
import { defaultSettings } from '../settings/defaults';

const PHONE: DeviceProfile = { touch: true, touchOnly: true, mobile: true, ios: false, tier: 'mid', secure: true };

function controls(): DriverControls {
  return { throttle: false, brake: false, left: false, right: false, gearUpPressed: false, gearDownPressed: false, drsPressed: false, ersOvertakeHeld: false, pitLimiterPressed: false,
    ersModeSel: 'auto', brakeBias: 0.575, boxRequest: false, nextCompound: 'medium', steerSensitivity: 1, analog: false, steerAxis: 0, throttleAxis: 0, brakeAxis: 0 };
}

class FakeWindow implements TouchWindow {
  readonly listeners = new Map<string, ((e: Event) => void)[]>();
  addEventListener(type: string, cb: (e: Event) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), cb]);
  }
  removeEventListener(type: string, cb: (e: Event) => void): void {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((x) => x !== cb));
  }
  fire(type: string, e: Partial<DeviceOrientationEvent> = {}): void {
    for (const cb of this.listeners.get(type) ?? []) cb(e as Event);
  }
}

function rig(device: Settings['controls']['device'] = 'touch', touch: Partial<Settings['controls']['touch']> = {}, opts: { permission?: () => Promise<string> } = {}) {
  const s = defaultSettings();
  s.controls.device = device;
  Object.assign(s.controls.touch, touch);
  let t = 0;
  let angle = 90;
  const win = new FakeWindow();
  const vib: number[] = [];
  const input = createInputManager();
  input.setContext('driving');
  const tin = createTouchInput({
    input, profile: PHONE, controls: () => s.controls, now: () => t, win, screenAngle: () => angle,
    setTiltCenter: (d) => { s.controls.touch.tiltCenter = d; },
    requestPermission: opts.permission ?? null, vibrate: (ms) => { vib.push(ms); return true; },
  });
  return {
    s, input, tin, win, vib,
    setAngle(a: number) { angle = a; },
    /** One frame of `ms` then one sim latch. */
    frame(ms = 16) {
      t += ms;
      tin.poll();
      const c = controls();
      input.latch(c);
      return c;
    },
  };
}

describe('pure maths', () => {
  it('pedal travel: full press, or 30..100 % by finger height with slide', () => {
    expect(pedalValue(10, 100, false)).toBe(1);
    expect(pedalValue(100, 100, true)).toBeCloseTo(0.3, 9);
    expect(pedalValue(0, 100, true)).toBe(1);
    expect(pedalValue(25, 100, true)).toBe(1);
    expect(pedalValue(62.5, 100, true)).toBeCloseTo(0.3 + 0.7 * 0.5, 9);
  });
  it('wheel drag: right = steer right (negative), full lock at 35 % of the zone', () => {
    expect(wheelSteer(0, 200)).toBe(0);
    expect(wheelSteer(35, 200)).toBeCloseTo(-0.5, 9);
    expect(wheelSteer(-70, 200)).toBe(1);
    expect(wheelSteer(500, 200)).toBe(-1);
  });
  it('tilt roll in the screen plane: upright 0, turned anticlockwise positive, flat = null, any orientation', () => {
    // Portrait upright, then tilted 20° to the left around the screen normal: up appears to the screen's right.
    expect(tiltRollDeg(90, 0, 0)).toBeCloseTo(0, 6);
    expect(tiltRollDeg(0, 0, 0)).toBeNull();
    // Landscape (angle 90): held upright, the device x axis points up; gamma tilts the long edge.
    expect(tiltRollDeg(0, -90, 90)).toBeCloseTo(0, 6);
    const left = tiltRollDeg(20, -70, 90)!;
    const right = tiltRollDeg(-20, -70, 90)!;
    expect(Math.sign(left)).toBe(-Math.sign(right));
    expect(Math.abs(left)).toBeGreaterThan(15);
    // Landscape the other way round (angle 270) mirrors it.
    expect(tiltRollDeg(-20, 70, 270)!).toBeCloseTo(left, 6);
  });
  it('tilt steer: deadzone, sensitivity, clamp, centre and wrap', () => {
    expect(tiltSteer(0.5, 0, 1, 0.04)).toBe(0);
    expect(tiltSteer(TILT_FULL_DEG, 0, 1, 0)).toBe(1);
    expect(tiltSteer(-TILT_FULL_DEG / 2, 0, 1, 0)).toBeCloseTo(-0.5, 9);
    expect(tiltSteer(TILT_FULL_DEG / 2, 0, 2, 0)).toBe(1);
    expect(tiltSteer(10, 10, 1, 0)).toBe(0);
    expect(tiltSteer(-175, 175, 1, 0)).toBeCloseTo(10 / TILT_FULL_DEG, 9);
  });
});

describe('touch zones → analog path', () => {
  it('gas + brake + steering at once (multi-touch), values latched as analog DriverControls', () => {
    const r = rig();
    r.tin.pointer('down', 'gas', 1, 40, 80, 96, 156);
    r.tin.pointer('down', 'brake', 2, 40, 60, 96, 128);
    r.tin.pointer('down', 'steer', 3, 20, 100, 232, 150);
    r.frame();
    let c = r.frame(100);
    expect(c.analog).toBe(true);
    expect(c.throttleAxis).toBe(1);
    expect(c.brakeAxis).toBe(1);
    expect(c.steerAxis).toBeGreaterThan(0); // left pad = steer left (positive)
    // Lift the brake only: gas stays.
    r.tin.pointer('up', 'brake', 2, 0, 0, 96, 128);
    c = r.frame();
    expect(c.throttleAxis).toBe(1);
    expect(c.brakeAxis).toBe(0);
  });

  it('button pads ramp like a key: partial lock on a short tap, full after the ramp, both pads = centre', () => {
    const r = rig();
    r.frame();
    r.tin.pointer('down', 'steer', 1, 200, 50, 232, 150); // right half
    const c1 = r.frame(50);
    expect(c1.steerAxis).toBeCloseTo(-BUTTON_STEER_RATE * 0.05, 6);
    for (let i = 0; i < 20; i++) r.frame(16);
    expect(r.frame().steerAxis).toBe(-1);
    r.tin.pointer('down', 'steer', 2, 10, 50, 232, 150); // left half too
    for (let i = 0; i < 20; i++) r.frame(16);
    expect(r.frame().steerAxis).toBe(0);
  });

  it('wheel mode follows the drag from where the finger landed', () => {
    const r = rig('touch', { steerMode: 'wheel' });
    r.tin.pointer('down', 'steer', 1, 100, 50, 200, 150);
    r.tin.pointer('move', 'steer', 1, 135, 50, 200, 150);
    expect(r.frame().steerAxis).toBeCloseTo(-0.5, 6);
    r.tin.pointer('up', 'steer', 1, 0, 0, 200, 150);
    expect(r.frame().steerAxis).toBe(0);
  });

  it('pedal slide gives partial throttle from the finger height', () => {
    const r = rig('touch', { pedalSlide: true });
    r.tin.pointer('down', 'gas', 1, 40, 156, 96, 156);
    expect(r.frame().throttleAxis).toBeCloseTo(0.3, 6);
    r.tin.pointer('move', 'gas', 1, 40, 10, 96, 156);
    expect(r.frame().throttleAxis).toBe(1);
  });

  it('release: pointer up, cancel (up from the overlay), blur and releaseAll drop everything', () => {
    const r = rig();
    r.tin.pointer('down', 'gas', 7, 40, 80, 96, 156);
    r.tin.press('drs');
    expect(r.frame().throttleAxis).toBe(1);
    r.win.fire('blur');
    const c = r.frame();
    expect(c.throttleAxis).toBe(0);
    expect(r.input.isHeld('drs')).toBe(false);
    // A move or up for an unknown pointer is ignored.
    r.tin.pointer('move', 'gas', 99, 0, 0, 96, 156);
    r.tin.pointer('up', 'gas', 99, 0, 0, 96, 156);
    expect(r.frame().throttleAxis).toBe(0);
  });

  it('on-screen buttons press actions like keys: edge once, held while down', () => {
    const r = rig();
    const seen: string[] = [];
    r.input.onAction((a) => seen.push(a));
    r.tin.press('drs');
    r.tin.press('ersOvertake');
    let c = r.frame();
    expect(c.drsPressed).toBe(true);
    expect(c.ersOvertakeHeld).toBe(true);
    c = r.frame();
    expect(c.drsPressed).toBe(false);
    expect(c.ersOvertakeHeld).toBe(true);
    r.tin.release('ersOvertake');
    r.tin.release('drs');
    r.tin.release('drs'); // extra release is harmless
    expect(r.frame().ersOvertakeHeld).toBe(false);
    expect(seen).toEqual(['drs', 'ersOvertake']);
  });

  it('keyboard default: touch never drives (analog stays off), and outside driving it hands the analog path back', () => {
    const r = rig('keyboard');
    r.tin.pointer('down', 'gas', 1, 40, 80, 96, 156);
    expect(r.frame().analog).toBe(false);
    const t = rig('touch');
    t.tin.pointer('down', 'gas', 1, 40, 80, 96, 156);
    expect(t.frame().analog).toBe(true);
    t.input.setContext('menu');
    t.tin.poll();
    t.input.setContext('driving');
    const c = controls();
    t.input.latch(c);
    expect(c.analog).toBe(false);
  });

  it("'auto' drives after a touch and stops after a key", () => {
    const r = rig('auto');
    expect(r.frame().analog).toBe(false);
    r.tin.pointer('down', 'gas', 1, 40, 80, 96, 156);
    expect(r.frame().analog).toBe(true);
    r.tin.noteOther();
    expect(r.frame().analog).toBe(false);
  });

  it('haptics: only while touch drives, setting on, rate limited', () => {
    const r = rig();
    r.tin.haptic(10);
    r.tin.haptic(10);
    expect(r.vib).toEqual([10]);
    r.s.controls.touch.haptics = false;
    r.frame(200);
    r.tin.haptic(10);
    expect(r.vib).toEqual([10]);
  });
});

describe('tilt (mocked deviceorientation)', () => {
  it('starts with the tilt mode, low-pass filters, steers with sensitivity / deadzone, calibrates the centre', async () => {
    const r = rig('touch', { steerMode: 'tilt', tiltDeadzone: 0 });
    expect(await r.tin.enableTilt()).toBe('granted');
    expect(r.win.listeners.get('deviceorientation')?.length).toBe(1);
    // Upright landscape: straight.
    r.win.fire('deviceorientation', { beta: 0, gamma: -90 });
    expect(r.frame().steerAxis).toBeCloseTo(0, 6);
    // Turn the phone: the filtered value moves towards the new roll, not in one jump.
    r.win.fire('deviceorientation', { beta: 10, gamma: -80 });
    const first = r.frame(16).steerAxis;
    for (let i = 0; i < 40; i++) r.frame(16);
    const settled = r.frame(16).steerAxis;
    expect(Math.abs(first)).toBeGreaterThan(0);
    expect(Math.abs(first)).toBeLessThan(Math.abs(settled));
    expect(Math.abs(settled)).toBeGreaterThan(0.3);
    // Calibrate here: this roll is the new centre.
    r.tin.calibrateTilt();
    expect(Math.abs(r.s.controls.touch.tiltCenter)).toBeGreaterThan(5);
    expect(Math.abs(r.frame().steerAxis)).toBeLessThan(0.02);
    expect(r.tin.live().tiltOk).toBe(true);
  });

  it('flat phone and null readings are ignored; deadzone swallows wobble', () => {
    const r = rig('touch', { steerMode: 'tilt', tiltDeadzone: 0.1 });
    void r.tin.enableTilt();
    r.win.fire('deviceorientation', { beta: 0, gamma: -90 });
    r.win.fire('deviceorientation', { beta: null as unknown as number, gamma: null as unknown as number });
    r.win.fire('deviceorientation', { beta: 0, gamma: 0 }); // flat: no roll
    for (let i = 0; i < 20; i++) r.frame(16);
    expect(r.frame().steerAxis).toBeCloseTo(0, 6);
    r.win.fire('deviceorientation', { beta: 1, gamma: -89 }); // ~1.4° wobble < 10 % of 25°
    for (let i = 0; i < 20; i++) r.frame(16);
    expect(r.frame().steerAxis).toBe(0);
  });

  it('iOS permission: denied keeps tilt off; dispose removes the listeners', async () => {
    const denied = rig('touch', { steerMode: 'buttons' }, { permission: async () => 'denied' });
    expect(await denied.tin.enableTilt()).toBe('denied');
    expect(denied.win.listeners.get('deviceorientation')?.length ?? 0).toBe(0);
    const ok = rig('touch', { steerMode: 'buttons' }, { permission: async () => 'granted' });
    expect(await ok.tin.enableTilt()).toBe('granted');
    ok.tin.dispose();
    expect(ok.win.listeners.get('deviceorientation')?.length ?? 0).toBe(0);
    expect(ok.win.listeners.get('blur')?.length ?? 0).toBe(0);
  });
});
