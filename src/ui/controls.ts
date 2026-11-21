// Menu controls (DESIGN §6.11–§6.13): navigation item, setting rows (stepper/select, toggle, slider, read-only),
// buttons and the primary CTA. Every control is a Focusable with a stable data-focus-id and re-renders its labels
// on demand (language change). Value changes animate per §7.3 (stepper x ±8 → 0, toggle thumb 180 ms).

import { h, icon } from './dom';
import type { Focusable } from './focus/focus';
import { gsap } from './motion/gsap';
import { partOf, sliderValueAt, stepIndex } from './pointer';
import type { ScreenCtx } from './screens/ctx';

export interface Ctl extends Focusable {
  id: string;
  render(): void;
  /** i18n key of the footer description for this control. */
  desc?: string;
  /** Stepper / toggle / slider: ← at its minimum stays on the row instead of leaving the list level. */
  value?: boolean;
  /** Pointer click on `target` inside the control (chevron, segment, chip); the list falls back to activate(). */
  click?(target: Node): void;
  /** Pointer down inside the control (slider scrub). */
  press?(e: PointerEvent): void;
}

function base(tag: 'button', cls: string, id: string, parent: HTMLElement): HTMLButtonElement {
  const el = h(tag, cls, parent);
  el.type = 'button';
  el.dataset.focusId = id;
  h('span', 'notch', el);
  return el;
}

export function navItem(ctx: ScreenCtx, parent: HTMLElement, o: { id: string; label: string; meta?: () => string; disabled?: () => boolean; activate: () => void; desc?: string }): Ctl {
  const el = base('button', 'm-item', o.id, parent);
  const lbl = h('span', 'lbl', el);
  const meta = o.meta ? h('span', 'meta', el) : null;
  return {
    id: o.id, el, desc: o.desc,
    disabled: o.disabled,
    activate() {
      if (o.disabled?.()) {
        ctx.sound('error');
        return;
      }
      ctx.sound('confirm');
      el.classList.add('is-press');
      setTimeout(() => el.classList.remove('is-press'), 140);
      o.activate();
    },
    render() {
      lbl.textContent = ctx.t(o.label);
      if (meta && o.meta) meta.textContent = o.meta();
    },
  };
}

export interface Option<T> { v: T; label: () => string }

function rowShell(ctx: ScreenCtx, parent: HTMLElement, id: string, label: () => string): { el: HTMLButtonElement; ctl: HTMLElement; setLabel(): void } {
  const el = base('button', 'm-row', id, parent);
  const lbl = h('span', 'lbl', el);
  const ctl = h('span', 'ctl', el);
  return { el, ctl, setLabel: () => (lbl.textContent = label()) };
}

/** Stepper select: `‹ YÜKSEK ›` with option ticks. ← / → / chevrons clamp at the ends (chevrons dim there, D-040: ← never
 * jumps to the last value); Enter / row click cycles and wraps from the last value to the first. */
export function selectRow<T>(ctx: ScreenCtx, parent: HTMLElement, o: {
  id: string; label: () => string; options: () => Option<T>[]; get: () => T; set: (v: T) => void; disabled?: () => boolean; desc?: string; note?: () => string;
}): Ctl {
  const s = rowShell(ctx, parent, o.id, o.label);
  const step = h('span', 'c-step', s.ctl);
  const l = icon('chev-l');
  const valEl = h('span', 'val', step);
  const r = icon('chev-r');
  step.insertBefore(l, valEl);
  step.appendChild(r);
  const ix = h('span', 'ix', step);
  const note = o.note ? h('span', 'note', s.ctl) : null;
  const idx = (): number => Math.max(0, o.options().findIndex((x) => x.v === o.get()));
  const draw = (): void => {
    const opts = o.options();
    const i = idx();
    valEl.textContent = opts[i]?.label() ?? '';
    if (ix.childElementCount !== opts.length) {
      ix.replaceChildren();
      for (let k = 0; k < opts.length; k++) h('i', '', ix);
    }
    for (let k = 0; k < ix.children.length; k++) ix.children[k]!.classList.toggle('on', k === i);
    l.classList.toggle('dim', i === 0);
    r.classList.toggle('dim', i === opts.length - 1);
    if (note && o.note) note.textContent = o.note();
  };
  const change = (d: 1 | -1): boolean => {
    if (o.disabled?.()) return false;
    const opts = o.options();
    const i = stepIndex(idx(), d, opts.length, true);
    if (i === null) {
      ctx.sound('error');
      return false;
    }
    o.set(opts[i]!.v);
    ctx.sound('toggle');
    draw();
    gsap.killTweensOf(valEl);
    if (!ctx.reduced()) ctx.track(gsap.fromTo(valEl, { x: 8 * d, opacity: 0 }, { x: 0, opacity: 1, duration: 0.14, ease: 'apex.out', clearProps: 'transform,opacity' }));
    return true;
  };
  const ctl: Ctl = {
    id: o.id, el: s.el, desc: o.desc, disabled: o.disabled, value: true,
    left: () => change(-1),
    right: () => change(1),
    // ‹ / › step; anywhere else on the row does what Enter does (screens may override activate).
    click: (t) => {
      const k = partOf(t, [l, r]);
      if (k >= 0) change(k === 0 ? -1 : 1);
      else ctl.activate?.();
    },
    activate: () => {
      const opts = o.options();
      if (o.disabled?.() || idx() < opts.length - 1) {
        change(1);
        return;
      }
      // Enter on the last value goes back to the first.
      if (opts.length > 1) {
        o.set(opts[0]!.v);
        ctx.sound('toggle');
        draw();
      }
    },
    render() {
      s.setLabel();
      draw();
    },
  };
  return ctl;
}

/** Segmented KAPALI | AÇIK toggle; ← / → / Enter flips. */
export function toggleRow(ctx: ScreenCtx, parent: HTMLElement, o: { id: string; label: () => string; get: () => boolean; set: (v: boolean) => void; disabled?: () => boolean; desc?: string }): Ctl {
  const s = rowShell(ctx, parent, o.id, o.label);
  s.el.setAttribute('role', 'switch');
  const seg = h('span', 'c-seg', s.ctl);
  h('i', 'thumb', seg);
  const off = h('span', '', seg);
  const on = h('span', '', seg);
  const draw = (): void => {
    const v = o.get();
    seg.dataset.on = v ? '1' : '0';
    s.el.setAttribute('aria-checked', String(v));
    off.classList.toggle('on', !v);
    on.classList.toggle('on', v);
  };
  const flip = (to?: boolean): boolean => {
    if (o.disabled?.()) return false;
    const v = to ?? !o.get();
    if (v === o.get()) return false;
    o.set(v);
    ctx.sound('toggle');
    draw();
    return true;
  };
  return {
    id: o.id, el: s.el, desc: o.desc, disabled: o.disabled, value: true,
    left: () => flip(false),
    right: () => flip(true),
    activate: () => void flip(),
    // A segment sets its value; anywhere else on the row flips.
    click: (t) => {
      const k = partOf(t, [off, on]);
      void (k >= 0 ? flip(k === 1) : flip());
    },
    render() {
      s.setLabel();
      s.el.setAttribute('aria-label', o.label());
      off.textContent = ctx.t('menu.ctl.off');
      on.textContent = ctx.t('menu.ctl.on');
      draw();
    },
  };
}

/** Slider: track 220 × 4, thumb, value box; ← / → step. */
export function sliderRow(ctx: ScreenCtx, parent: HTMLElement, o: {
  id: string; label: () => string; min: number; max: number; step: number; get: () => number; set: (v: number) => void; fmt: (v: number) => string; disabled?: () => boolean; desc?: string;
}): Ctl {
  const s = rowShell(ctx, parent, o.id, o.label);
  s.el.setAttribute('role', 'slider');
  s.el.setAttribute('aria-valuemin', String(o.min));
  s.el.setAttribute('aria-valuemax', String(o.max));
  const sl = h('span', 'c-slider', s.ctl);
  const tr = h('span', 'tr', sl);
  const fill = h('i', '', tr);
  const thumb = h('b', '', tr);
  const v = h('span', 'v apx-num', sl);
  const draw = (): void => {
    const x = o.get();
    const f = (x - o.min) / (o.max - o.min || 1);
    fill.style.transform = `scaleX(${Math.max(0, Math.min(1, f))})`;
    thumb.style.left = `${Math.max(0, Math.min(1, f)) * 100}%`;
    v.textContent = o.fmt(x);
    s.el.setAttribute('aria-valuenow', String(x));
    s.el.setAttribute('aria-valuetext', o.fmt(x));
  };
  const change = (d: 1 | -1): boolean => {
    if (o.disabled?.()) return false;
    const cur = o.get();
    const next = Math.round((cur + d * o.step) / o.step) * o.step;
    const clamped = Math.max(o.min, Math.min(o.max, Number(next.toFixed(4))));
    if (clamped === cur) {
      ctx.sound('error');
      return false;
    }
    o.set(clamped);
    ctx.sound('move');
    draw();
    return true;
  };
  /** Pointer scrub: the value under x, same set/sound/draw as the arrow keys. */
  const scrub = (x: number): void => {
    const b = tr.getBoundingClientRect();
    const next = sliderValueAt(x, b.left, b.width, o.min, o.max, o.step);
    if (next === o.get()) return;
    o.set(next);
    ctx.sound('move');
    draw();
  };
  return {
    id: o.id, el: s.el, desc: o.desc, disabled: o.disabled, value: true,
    left: () => change(-1),
    right: () => change(1),
    click: () => {},
    // Down on the track (its hit area is padded in CSS) jumps there; moving with the button held scrubs.
    press: (e) => {
      if (o.disabled?.() || e.button !== 0 || !tr.contains(e.target as Node)) return;
      scrub(e.clientX);
      sl.setPointerCapture(e.pointerId);
      const move = (m: PointerEvent): void => scrub(m.clientX);
      const end = (): void => {
        sl.removeEventListener('pointermove', move);
        sl.removeEventListener('pointerup', end);
        sl.removeEventListener('pointercancel', end);
        if (sl.hasPointerCapture(e.pointerId)) sl.releasePointerCapture(e.pointerId);
      };
      sl.addEventListener('pointermove', move);
      sl.addEventListener('pointerup', end);
      sl.addEventListener('pointercancel', end);
    },
    render() {
      s.setLabel();
      s.el.setAttribute('aria-label', o.label());
      draw();
    },
  };
}

/** Read-only value row (skipped by focus when `focusable` is false). */
export function readonlyRow(ctx: ScreenCtx, parent: HTMLElement, o: { id: string; label: () => string; value: () => string; desc?: string }): Ctl {
  const s = rowShell(ctx, parent, o.id, o.label);
  const v = h('span', 'c-ro', s.ctl);
  return {
    id: o.id, el: s.el, desc: o.desc,
    activate: () => ctx.sound('error'),
    render() {
      s.setLabel();
      v.textContent = o.value();
    },
  };
}

/** Primary CTA (vermilion, slanted) or a plain bordered button. */
export function button(ctx: ScreenCtx, parent: HTMLElement, o: { id: string; label: () => string; primary?: boolean; activate: () => void; disabled?: () => boolean; desc?: string }): Ctl {
  const el = h('button', o.primary ? 'm-cta' : 'm-btn', parent);
  el.type = 'button';
  el.dataset.focusId = o.id;
  if (!o.primary) h('span', 'notch', el);
  const lbl = h('span', '', el);
  return {
    id: o.id, el, desc: o.desc, disabled: o.disabled,
    activate() {
      if (o.disabled?.()) {
        ctx.sound('error');
        return;
      }
      ctx.sound('confirm');
      el.classList.add('is-press');
      setTimeout(() => el.classList.remove('is-press'), 140);
      o.activate();
    },
    render() {
      lbl.textContent = o.label();
    },
  };
}
