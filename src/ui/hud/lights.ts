// Start lights (DESIGN §6.8, §7.3): 5 pods × 2 lamps light left → right; lights out = all off in the same frame;
// the housing exits 800 ms later (opacity → 0, y → −8u, 200 ms apex.in; reduced = opacity 120 ms).
// Lamp-on is a 60 ms opacity step; start timing itself is never altered by motion settings.

import type { HudModel } from '../../contracts/hud';
import { Attr, h } from '../dom';
import { gsap } from '../motion/gsap';
import type { HudCtx, HudWidget } from './ctx';

export interface Lights extends HudWidget {
  el: HTMLElement;
  /** Returns true while the housing occupies the top-centre slot. */
  update(m: HudModel, now: number): boolean;
}

export function createLights(parent: HTMLElement, ctx: HudCtx): Lights {
  const el = h('div', 'h-reg h-lights h-mode-hide', parent);
  el.setAttribute('aria-hidden', 'true');
  const pods: Attr[] = [];
  for (let i = 0; i < 5; i++) {
    const p = h('div', 'h-pod', el);
    h('i', 'h-lamp', p).appendChild(document.createElement('i'));
    h('i', 'h-lamp', p).appendChild(document.createElement('i'));
    pods.push(new Attr(p, 'data-on'));
  }
  el.hidden = true;
  let lit = -1;
  let outAt = 0;
  let exiting = false;
  let shown = false;

  const show = (): void => {
    if (shown) return;
    shown = true;
    exiting = false;
    gsap.killTweensOf(el);
    gsap.set(el, { opacity: 1, yPercent: 0 });
    el.hidden = false;
  };
  const hide = (): void => {
    shown = false;
    exiting = false;
    el.hidden = true;
  };

  return {
    el,
    update(m, now) {
      const sl = m.startLights;
      if (sl.visible && !sl.out) {
        show();
        outAt = 0;
        if (sl.lit !== lit) {
          lit = sl.lit;
          for (let i = 0; i < 5; i++) pods[i]!.set(i < lit ? '1' : '0');
        }
        return true;
      }
      if (sl.out && shown) {
        if (outAt === 0) {
          outAt = now;
          lit = 0;
          for (let i = 0; i < 5; i++) pods[i]!.set('0');
        }
        if (!exiting && now - outAt >= 800) {
          exiting = true;
          if (ctx.reduced()) ctx.track(gsap.to(el, { opacity: 0, duration: 0.12, ease: 'none', onComplete: hide }));
          else ctx.track(gsap.to(el, { opacity: 0, yPercent: -5.8, duration: 0.2, ease: 'apex.in', onComplete: hide }));
        }
        return true;
      }
      if (!sl.visible && shown && !exiting) hide();
      if (!sl.visible) {
        lit = -1;
        outAt = 0;
      }
      return shown;
    },
    relabel() {},
    dispose() {
      gsap.killTweensOf(el);
      el.remove();
    },
  };
}
