// D-040 wrong-way banner: centred above the car while `HudModel.wrongWay` is true. Red = alarm (DESIGN §2.1 rule 7),
// banner anatomy of §6.7 at a larger scale (stripe, icon, title, divider, detail; right end slanted 12°).
// Motion as a notification (§7.3): in y −12u → 0 + opacity, 260 ms apex.settle; out opacity → 0, y → −6u,
// 160 ms apex.in; reduced: opacity only, 120 ms. No pulsing (photosensitivity), nothing else animates.

import type { HudModel } from '../../contracts/hud';
import { h, icon, Txt } from '../dom';
import { gsap } from '../motion/gsap';
import type { HudCtx, HudWidget } from './ctx';

export interface WrongWay extends HudWidget {
  el: HTMLElement;
  update(m: HudModel): void;
}

export function createWrongWay(parent: HTMLElement, ctx: HudCtx): WrongWay {
  const el = h('div', 'h-reg h-ww h-mode-hide', parent);
  el.setAttribute('role', 'alert');
  el.hidden = true;
  h('span', 'stripe', el);
  el.appendChild(icon('warn', 'ic'));
  const title = new Txt(h('span', 'title', el));
  h('span', 'div', el);
  const detail = new Txt(h('span', 'detail', el));
  let on = false;

  const label = (): void => {
    title.set(ctx.t('hud.wrongWay.title'));
    detail.set(ctx.t('hud.wrongWay.detail'));
  };
  label();

  const show = (v: boolean): void => {
    on = v;
    gsap.killTweensOf(el);
    if (v) {
      el.hidden = false;
      if (ctx.reduced()) ctx.track(gsap.fromTo(el, { opacity: 0, y: 0 }, { opacity: 1, duration: 0.12, ease: 'none' }));
      else ctx.track(gsap.fromTo(el, { opacity: 0, y: -12 * ctx.k() }, { opacity: 1, y: 0, duration: 0.26, ease: 'apex.settle' }));
      return;
    }
    const done = (): void => {
      el.hidden = true;
    };
    if (ctx.reduced()) ctx.track(gsap.to(el, { opacity: 0, duration: 0.12, ease: 'none', onComplete: done }));
    else ctx.track(gsap.to(el, { opacity: 0, y: -6 * ctx.k(), duration: 0.16, ease: 'apex.in', onComplete: done }));
  };

  return {
    el,
    update(m) {
      if (m.wrongWay !== on) show(m.wrongWay);
    },
    relabel() {
      title.reset();
      detail.reset();
      label();
    },
    dispose() {
      gsap.killTweensOf(el);
      el.remove();
    },
  };
}
