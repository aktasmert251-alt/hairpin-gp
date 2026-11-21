// Touch controls overlay (mobile, 2026-11-21). DOM/CSS only: steering zone bottom left (pads, drag wheel or tilt gauge),
// GAS / BRAKE pedals bottom right, thumb buttons in the side gutters (pause, camera, MFD, pit | DRS, ERS, gears).
// Multi-touch through pointer events with pointerId tracking and pointer capture; every pointer is released on
// pointerup / pointercancel / lostpointercapture, and everything on hide / blur. The zone math lives in
// core/input/touch (TouchApi); this file only reports pointers and mirrors the live values (30 Hz, cached writes).

import type { ActionId, TouchApi, TouchZone } from '../../contracts/input';
import type { HudModel } from '../../contracts/hud';
import type { Settings } from '../../contracts/settings';
import { Attr, h, icon } from '../dom';
import type { TFn } from '../format';

export interface TouchOverlay {
  el: HTMLElement;
  /** Shown while racing with touch driving; hiding releases every pointer. */
  setShown(on: boolean): void;
  /** Settings changed (mode, size, opacity, left-handed). */
  apply(s: Readonly<Settings['controls']['touch']>, manualGears: boolean): void;
  /** 30 Hz from the HUD update: pedal fill, wheel angle, pad states, TT (no pit). */
  update(m: HudModel): void;
  relabel(): void;
  dispose(): void;
}

interface Track { zone?: TouchZone; act?: ActionId; el: HTMLElement; rect: DOMRect }

const LEFT_BUTTONS: readonly { act: ActionId; key: string; cls: string }[] = [
  { act: 'pause', key: 'touch.pause', cls: 't-pause' },
  { act: 'cameraNext', key: 'touch.camera', cls: 't-cam' },
  { act: 'mfdNext', key: 'touch.mfd', cls: 't-mfd' },
];
const RIGHT_BUTTONS: readonly { act: ActionId; key: string; cls: string }[] = [
  { act: 'drs', key: 'touch.drs', cls: 't-drs' },
  { act: 'ersOvertake', key: 'touch.ers', cls: 't-ers' },
  { act: 'gearUp', key: 'touch.gearUp', cls: 't-gup' },
  { act: 'gearDown', key: 'touch.gearDown', cls: 't-gdn' },
];

export function createTouchOverlay(parent: HTMLElement, touch: TouchApi, t: TFn, opts: { pitRequest(): void }): TouchOverlay {
  const el = h('div', 'apx-touch', parent);
  el.dataset.on = '0';
  el.setAttribute('aria-hidden', 'true');
  const steer = h('div', 't-steer', el);
  steer.dataset.zone = 'steer';
  const padL = h('div', 't-pad t-l', steer);
  padL.appendChild(icon('chev-l'));
  const padR = h('div', 't-pad t-r', steer);
  padR.appendChild(icon('chev-r'));
  const wheel = h('div', 't-wheel', steer);
  h('i', '', wheel);
  const tilt = h('div', 't-tilt', steer);
  const gauge = h('div', 't-gauge', tilt);
  const needle = h('b', '', gauge);
  const centerBtn = h('div', 't-btn t-center', tilt);
  centerBtn.dataset.cmd = 'center';
  const enableBtn = h('div', 't-btn t-enable', tilt);
  enableBtn.dataset.cmd = 'enable';
  const brake = h('div', 't-pedal t-brake', el);
  brake.dataset.zone = 'brake';
  const brakeFill = h('i', '', brake);
  const brakeLbl = h('span', '', brake);
  const gas = h('div', 't-pedal t-gas', el);
  gas.dataset.zone = 'gas';
  const gasFill = h('i', '', gas);
  const gasLbl = h('span', '', gas);
  const colL = h('div', 't-col t-col-l', el);
  const colR = h('div', 't-col t-col-r', el);
  const mkBtn = (col: HTMLElement, b: { act: ActionId; key: string; cls: string }): HTMLElement => {
    const e = h('div', `t-btn ${b.cls}`, col);
    e.dataset.act = b.act;
    e.dataset.key = b.key;
    return e;
  };
  const leftBtns = LEFT_BUTTONS.map((b) => mkBtn(colL, b));
  const pitBtn = h('div', 't-btn t-pit', colL);
  pitBtn.dataset.cmd = 'pit';
  pitBtn.dataset.key = 'touch.pit';
  const rightBtns = RIGHT_BUTTONS.map((b) => mkBtn(colR, b));
  const pauseBtn = leftBtns[0]!;
  pauseBtn.textContent = '';
  h('i', '', pauseBtn);
  h('i', '', pauseBtn);
  const camBtn = leftBtns[1]!;
  camBtn.appendChild(icon('camera'));

  const lA = new Attr(padL, 'data-on');
  const rA = new Attr(padR, 'data-on');
  const gasA = new Attr(gas, 'data-on');
  const brkA = new Attr(brake, 'data-on');
  const ttA = new Attr(el, 'data-tt');
  const tiltA = new Attr(el, 'data-tilt');
  let lastGas = -1;
  let lastBrk = -1;
  let lastSteer = 99;
  let lastNeedle = 99;
  let shown = false;
  const tracks = new Map<number, Track>();

  const relabel = (): void => {
    brakeLbl.textContent = t('touch.brake');
    gasLbl.textContent = t('touch.gas');
    centerBtn.textContent = t('touch.tiltCenter');
    enableBtn.textContent = t('touch.tiltEnable');
    pitBtn.textContent = t('touch.pit');
    for (const b of [...leftBtns.slice(2), ...rightBtns]) b.textContent = t(b.dataset.key!);
    camBtn.setAttribute('aria-label', t('touch.camera'));
    pauseBtn.setAttribute('aria-label', t('touch.pause'));
  };
  relabel();

  const local = (tr: Track, e: PointerEvent): [number, number] => [e.clientX - tr.rect.left, e.clientY - tr.rect.top];

  const end = (id: number): void => {
    const tr = tracks.get(id);
    if (!tr) return;
    tracks.delete(id);
    tr.el.classList.remove('is-down');
    if (tr.zone) touch.pointer('up', tr.zone, id, 0, 0, tr.rect.width, tr.rect.height);
    else if (tr.act) touch.release(tr.act);
  };

  const onDown = (e: PointerEvent): void => {
    if (!shown) return;
    e.preventDefault();
    const target = e.target as Element;
    const cmd = target.closest<HTMLElement>('[data-cmd]');
    if (cmd) {
      const c = cmd.dataset.cmd;
      if (c === 'center') touch.calibrateTilt();
      // 'enable' runs on pointerup: iOS grants motion permission only inside the touchend-like activation.
      else if (c === 'pit') opts.pitRequest();
      cmd.classList.add('is-down');
      setTimeout(() => cmd.classList.remove('is-down'), 120);
      touch.haptic(8);
      return;
    }
    const z = target.closest<HTMLElement>('[data-zone], [data-act]');
    if (!z) return;
    try {
      z.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic pointers (tests) may not be capturable */
    }
    const tr: Track = { el: z, rect: z.getBoundingClientRect() };
    if (z.dataset.zone) tr.zone = z.dataset.zone as TouchZone;
    else tr.act = z.dataset.act as ActionId;
    end(e.pointerId);
    tracks.set(e.pointerId, tr);
    z.classList.add('is-down');
    if (tr.zone) {
      const [x, y] = local(tr, e);
      touch.pointer('down', tr.zone, e.pointerId, x, y, tr.rect.width, tr.rect.height);
    } else if (tr.act) {
      touch.press(tr.act);
      touch.haptic(8);
    }
  };
  const onMove = (e: PointerEvent): void => {
    const tr = tracks.get(e.pointerId);
    if (!tr?.zone) return;
    e.preventDefault();
    const [x, y] = local(tr, e);
    touch.pointer('move', tr.zone, e.pointerId, x, y, tr.rect.width, tr.rect.height);
  };
  const onUp = (e: PointerEvent): void => {
    if (e.type === 'pointerup' && (e.target as Element).closest?.('[data-cmd="enable"]')) {
      void touch.enableTilt().then((r) => tiltA.set(r === 'granted' ? 'on' : 'off'));
    }
    end(e.pointerId);
  };
  const block = (e: Event): void => e.preventDefault();
  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', onUp);
  el.addEventListener('lostpointercapture', onUp);
  el.addEventListener('contextmenu', block);
  // iOS: stop the double-tap zoom / scroll gestures that pointer events alone do not cancel.
  el.addEventListener('touchstart', block, { passive: false });
  el.addEventListener('touchmove', block, { passive: false });

  const releaseAll = (): void => {
    for (const id of [...tracks.keys()]) end(id);
    touch.releaseAll();
  };
  const onBlur = (): void => releaseAll();
  window.addEventListener('blur', onBlur);

  return {
    el,
    setShown(on) {
      if (on === shown) return;
      shown = on;
      el.dataset.on = on ? '1' : '0';
      if (!on) releaseAll();
    },
    apply(s, manualGears) {
      el.dataset.mode = s.steerMode;
      el.dataset.lh = s.leftHanded ? '1' : '0';
      el.dataset.gears = manualGears ? '1' : '0';
      el.style.setProperty('--t-size', String(s.size));
      el.style.setProperty('--t-op', String(s.opacity));
      if (s.steerMode === 'tilt' && !tiltA.el.dataset.tilt) tiltA.set(touch.profile().ios ? 'ask' : 'on');
    },
    update(m) {
      if (!shown) return;
      const l = touch.live();
      ttA.set(m.mode === 'timeTrial' ? '1' : '0');
      const g = Math.round(l.throttle * 20);
      if (g !== lastGas) {
        lastGas = g;
        gasFill.style.transform = `scaleY(${g / 20})`;
        gasA.set(g > 0 ? '1' : '0');
      }
      const b = Math.round(l.brake * 20);
      if (b !== lastBrk) {
        lastBrk = b;
        brakeFill.style.transform = `scaleY(${b / 20})`;
        brkA.set(b > 0 ? '1' : '0');
      }
      const st = Math.round(l.steer * 50);
      if (st !== lastSteer) {
        lastSteer = st;
        // steerAxis + = left: the wheel turns anticlockwise.
        wheel.style.transform = `rotate(${-st * 1.8}deg)`;
        lA.set(st > 2 ? '1' : '0');
        rA.set(st < -2 ? '1' : '0');
      }
      const nd = l.tiltOk ? Math.round(Math.max(-1, Math.min(1, l.steer)) * 50) : 0;
      if (nd !== lastNeedle) {
        lastNeedle = nd;
        needle.style.transform = `translateX(${-nd}%)`;
      }
      if (l.tiltOk && tiltA.el.dataset.tilt !== 'on') tiltA.set('on');
    },
    relabel,
    dispose() {
      releaseAll();
      window.removeEventListener('blur', onBlur);
      el.remove();
    },
  };
}
