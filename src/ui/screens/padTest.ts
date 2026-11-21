// Settings → Controls "controller test" row (2026-10-27): live left-stick / trigger values of the active pad, raw (thin
// marker) and as the sim receives them (bar, after deadzone / curve / gain), plus the face and shoulder buttons lit while
// down. A focusable row without an action; refreshed every animation frame while the settings screen is shown (start / stop).

import type { GamepadApi } from '../../contracts/input';
import type { Ctl } from '../controls';
import { h } from '../dom';
import * as fmt from '../format';
import { padChip } from '../padGlyph';
import type { ScreenCtx } from './ctx';

const BUTTONS = [0, 1, 2, 3, 4, 5, 8, 9] as const;

export interface PadTestRow extends Ctl {
  start(): void;
  stop(): void;
  dispose(): void;
}

export function padTestRow(ctx: ScreenCtx, parent: HTMLElement, pad: GamepadApi | undefined): PadTestRow {
  const el = h('div', 'm-row m-keytest m-padtest', parent);
  el.dataset.focusId = 'set.c.padTest';
  h('span', 'notch', el);
  const lbl = h('span', 'lbl', el);
  const ctl = h('span', 'ctl', el);
  const bar = (cls: string): { fill: HTMLElement; raw: HTMLElement } => {
    const b = h('span', `m-pt-bar ${cls}`, ctl);
    return { fill: h('i', '', b), raw: h('b', '', b) };
  };
  const steer = bar('is-steer');
  const thr = bar('');
  const brk = bar('');
  const vals = h('span', 'm-kt-max apx-num', ctl);
  const chips = BUTTONS.map((b) => padChip(ctl, b));
  let raf = 0;
  let lastText = '';

  const paint = (): void => {
    const l = pad?.live() ?? null;
    el.dataset.on = l ? '1' : '0';
    const text = l
      ? `${ctx.t('settings.c.padTestValues', { s: fmt.decimal(-l.steer, 2, ctx.lang()), t: fmt.decimal(l.throttle, 2, ctx.lang()), b: fmt.decimal(l.brake, 2, ctx.lang()) })}`
      : ctx.t('settings.c.padTestNone');
    if (text !== lastText) {
      lastText = text;
      vals.textContent = text;
    }
    // Steer: centred bar (stick right = right); pedals: left-anchored.
    const s = l ? -l.steer : 0;
    steer.fill.style.transform = `translateX(${s < 0 ? 50 + s * 50 : 50}%) scaleX(${Math.abs(s) * 0.5})`;
    steer.raw.style.left = `${50 + (l ? l.rawSteer : 0) * 50}%`;
    thr.fill.style.transform = `scaleX(${l ? l.throttle : 0})`;
    thr.raw.style.left = `${(l ? l.rawThrottle : 0) * 100}%`;
    brk.fill.style.transform = `scaleX(${l ? l.brake : 0})`;
    brk.raw.style.left = `${(l ? l.rawBrake : 0) * 100}%`;
    BUTTONS.forEach((b, i) => chips[i]!.classList.toggle('is-on', l !== null && (l.buttons & (1 << b)) !== 0));
  };
  const frame = (): void => {
    paint();
    raf = requestAnimationFrame(frame);
  };
  const render = (): void => {
    lbl.textContent = ctx.t('settings.c.padTest');
    lastText = '';
    paint();
  };
  render();
  return {
    id: 'set.c.padTest', el, desc: 'settings.desc.pad',
    activate: () => {},
    render,
    start() {
      if (!raf) raf = requestAnimationFrame(frame);
    },
    stop() {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    },
    dispose() {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      el.remove();
    },
  };
}
