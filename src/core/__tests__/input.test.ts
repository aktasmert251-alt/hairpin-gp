import { describe, expect, it, vi, type Mock } from 'vitest';
import type { ActionId } from '../../contracts/input';
import type { DriverControls } from '../../contracts/vehicle';
import { DEFAULT_BINDINGS, bindingsForLayout } from '../input/bindings';
import { createInputManager, type KeyEventLike } from '../input/InputManager';

function key(code: string, extra: Partial<KeyEventLike> = {}): KeyEventLike & { preventDefault: Mock<() => void> } {
  return { code, repeat: false, ctrlKey: false, altKey: false, metaKey: false, ...extra, preventDefault: vi.fn<() => void>() };
}

function controls(): DriverControls {
  return { throttle: false, brake: false, left: false, right: false, gearUpPressed: false, gearDownPressed: false, drsPressed: false, ersOvertakeHeld: false, pitLimiterPressed: false, ersModeSel: 'auto', brakeBias: 0.575, boxRequest: false, nextCompound: 'medium', steerSensitivity: 1, analog: false, steerAxis: 0, throttleAxis: 0, brakeAxis: 0 };
}

describe('InputManager', () => {
  it('latches an edge for exactly one tick', () => {
    const im = createInputManager();
    im.setContext('driving');
    const c = controls();
    im.handleKeyDown(key('KeyE'));
    im.latch(c);
    expect(c.gearUpPressed).toBe(true);
    im.latch(c);
    expect(c.gearUpPressed).toBe(false);
    im.handleKeyUp(key('KeyE'));
    im.latch(c);
    expect(c.gearUpPressed).toBe(false);
  });

  it('keeps two quick presses as two ticks and ignores auto-repeat', () => {
    const im = createInputManager();
    im.setContext('driving');
    const c = controls();
    im.handleKeyDown(key('KeyE'));
    im.handleKeyUp(key('KeyE'));
    im.handleKeyDown(key('KeyE'));
    im.handleKeyDown(key('KeyE', { repeat: true }));
    const seen: boolean[] = [];
    for (let i = 0; i < 4; i++) {
      im.latch(c);
      seen.push(c.gearUpPressed);
    }
    expect(seen).toEqual([true, true, false, false]);
  });

  it('never loses a tap shorter than a tick and holds levels while pressed', () => {
    const im = createInputManager();
    im.setContext('driving');
    const c = controls();
    im.handleKeyDown(key('KeyW'));
    im.handleKeyUp(key('KeyW'));
    im.latch(c);
    expect(c.throttle).toBe(true);
    im.latch(c);
    expect(c.throttle).toBe(false);
    im.handleKeyDown(key('ArrowLeft'));
    im.handleKeyDown(key('KeyA'));
    im.handleKeyUp(key('ArrowLeft'));
    im.latch(c);
    expect(c.left).toBe(true); // KeyA still held
    im.handleKeyUp(key('KeyA'));
    im.latch(c);
    expect(c.left).toBe(false);
  });

  it('prevents default only for bound, modifier-free keys', () => {
    const im = createInputManager();
    im.setContext('driving');
    const space = key('Space');
    im.handleKeyDown(space);
    expect(space.preventDefault).toHaveBeenCalled();
    const unbound = key('KeyZ');
    im.handleKeyDown(unbound);
    expect(unbound.preventDefault).not.toHaveBeenCalled();
    const ctrlW = key('KeyW', { ctrlKey: true });
    im.handleKeyDown(ctrlW);
    expect(ctrlW.preventDefault).not.toHaveBeenCalled();
    const c = controls();
    im.latch(c);
    expect(c.throttle).toBe(false);
  });

  it('maps codes per context and emits menu actions (with repeat for navigation)', () => {
    const im = createInputManager();
    const got: ActionId[] = [];
    im.onAction((a) => got.push(a));
    im.setContext('menu');
    im.handleKeyDown(key('KeyS'));
    im.handleKeyDown(key('KeyS', { repeat: true }));
    im.handleKeyDown(key('Enter'));
    im.handleKeyDown(key('Enter', { repeat: true }));
    im.handleKeyDown(key('Escape'));
    expect(got).toEqual(['menuDown', 'menuDown', 'menuConfirm', 'menuBack']);
    const c = controls();
    im.latch(c);
    expect(c.brake).toBe(false); // menu context never drives the car
    im.setContext('driving');
    got.length = 0;
    im.handleKeyDown(key('Escape'));
    im.handleKeyDown(key('KeyC'));
    expect(got).toEqual(['pause', 'cameraNext']);
  });

  it('rebinds with conflict resolution and rejects modifiers', () => {
    const changed = vi.fn();
    const im = createInputManager({ onBindingsChanged: changed });
    const r = im.setBinding('gearUp', 0, 'KeyQ');
    expect(r).toEqual({ ok: true, action: 'gearUp', code: 'KeyQ', slot: 0, replaced: 'gearDown' });
    expect(im.bindings().gearUp).toEqual(['KeyQ']);
    expect(im.bindings().gearDown).toEqual([]);
    // menuUp shares W with throttle but lives in another context: no conflict.
    expect(im.setBinding('throttle', 1, 'KeyI')).toMatchObject({ ok: true, replaced: null });
    expect(im.bindings().throttle).toEqual(['KeyW', 'KeyI']);
    expect(im.setBinding('drs', 0, 'ControlLeft')).toEqual({ ok: false, action: 'drs', reason: 'modifier' });
    expect(im.setBinding('drs', 0, 'F5')).toEqual({ ok: false, action: 'drs', reason: 'reserved' });
    expect(changed).toHaveBeenCalledTimes(2);
    im.resetBindings();
    expect(im.bindings().gearDown).toEqual([...DEFAULT_BINDINGS.gearDown]);
  });

  it('resetBindings restores the layout defaults when resetDefaults is given', () => {
    const im = createInputManager({ resetDefaults: () => bindingsForLayout('wasd') });
    im.setBinding('throttle', 1, 'KeyI');
    im.resetBindings();
    expect(im.bindings()).toEqual(bindingsForLayout('wasd'));
    expect(im.bindings().throttle).not.toContain('ArrowUp');
  });

  it('captures the next key in rebind mode and cancels with Escape', () => {
    const im = createInputManager();
    im.setContext('driving');
    const results: unknown[] = [];
    im.startRebind('cameraNext', 0, (r) => results.push(r));
    expect(im.context()).toBe('rebind');
    im.handleKeyDown(key('AltLeft', { altKey: true }));
    im.startRebind('cameraNext', 0, (r) => results.push(r));
    im.handleKeyDown(key('KeyB'));
    im.startRebind('lookBack', 0, (r) => results.push(r));
    im.handleKeyDown(key('Escape'));
    expect(results).toEqual([
      { ok: false, action: 'cameraNext', reason: 'modifier' },
      { ok: true, action: 'cameraNext', code: 'KeyB', slot: 0, replaced: null },
      { ok: false, action: 'lookBack', reason: 'cancelled' },
    ]);
    expect(im.context()).toBe('driving');
  });

  it('labels keys and supports synthetic presses with auto-release', () => {
    let now = 0;
    const im = createInputManager({ translate: (k) => (k === 'common.keys.Space' ? 'Boşluk' : k), now: () => now });
    expect(im.label('KeyW')).toBe('W');
    expect(im.label('Digit3')).toBe('3');
    expect(im.label('Space')).toBe('Boşluk');
    expect(im.label('ArrowLeft')).toBe('←');
    im.setContext('driving');
    const c = controls();
    im.press('throttle', 100);
    im.latch(c);
    expect(c.throttle).toBe(true);
    now = 150;
    im.pollFrame();
    im.latch(c);
    expect(c.throttle).toBe(false);
  });

  it('derives the wasd / arrows layouts from the combined defaults', () => {
    expect(bindingsForLayout('wasd').throttle).toEqual(['KeyW']);
    expect(bindingsForLayout('arrows').steerLeft).toEqual(['ArrowLeft']);
    expect(bindingsForLayout('arrows').menuUp).toEqual(['ArrowUp', 'KeyW']);
  });
});

describe('simultaneous driving keys (2026-10-23: brake not registered while steering)', () => {
  it('steer + brake + throttle held together all latch, in any press order, with either key set', () => {
    for (const keys of [['KeyA', 'KeyS', 'KeyW'], ['KeyS', 'KeyD'], ['ArrowLeft', 'ArrowDown'], ['ArrowDown', 'ArrowRight', 'ArrowUp'], ['KeyD', 'ArrowDown']]) {
      const im = createInputManager();
      im.setContext('driving');
      const c = controls();
      for (const k of keys) im.handleKeyDown(key(k));
      for (let tick = 0; tick < 3; tick++) {
        im.latch(c);
        expect(c.brake, keys.join('+')).toBe(true);
        expect(c.left || c.right, keys.join('+')).toBe(true);
      }
      // Releasing the steer key keeps the brake; releasing the brake keeps the steer.
      im.handleKeyUp(key(keys[0]!));
      im.latch(c);
      expect(c.brake || c.left || c.right).toBe(true);
    }
  });

  it('a key whose first keydown was missed (held across a window blur) registers from its auto-repeat', () => {
    const im = createInputManager();
    im.setContext('driving');
    const c = controls();
    im.handleKeyDown(key('KeyA'));
    im.handleKeyDown(key('KeyS'));
    im.releaseAll(); // window blur while both keys stay physically down
    im.latch(c);
    expect(c.brake).toBe(false);
    im.handleKeyDown(key('KeyS', { repeat: true }));
    im.handleKeyDown(key('KeyA', { repeat: true }));
    im.latch(c);
    expect(c.brake).toBe(true);
    expect(c.left).toBe(true);
    im.handleKeyUp(key('KeyS'));
    im.latch(c);
    expect(c.brake).toBe(false);
    expect(c.left).toBe(true);
  });
});
