// Notification banners (DESIGN §6.7, §7.3; ui-hud §3). The presenter owns the queue (CR-05, D-002); the UI shows
// the two highest-priority entries, newest on top, and coalesces by id (same key → same id → updated in place).
// Enter: y −12u → 0 + opacity, 260 ms apex.settle. Exit: opacity → 0, y → −6u, 160 ms apex.in. Stack shift:
// 220 ms apex.inOut. Reduced: opacity only, 120 ms. y is expressed in yPercent of the 56u banner (8u gap).

import type { HudModel } from '../../contracts/hud';
import { Attr, h, icon, Txt } from '../dom';
import * as fmt from '../format';
import { gsap } from '../motion/gsap';
import type { HudCtx, HudWidget } from './ctx';

type Note = HudModel['notifications'][number];

interface BannerView {
  id: number;
  key: string;
  el: HTMLElement;
  title: Txt; detail: Txt; chip: Txt;
  detailA: Attr; chipA: Attr;
  params: Record<string, string | number>;
  slot: number;
  leaving: boolean;
  icon: string;
}

const SLOT = (56 + 8) / 56 * 100;
const MAX_VISIBLE = 2;

function iconFor(key: string, level: Note['level']): string {
  if (key.includes('.lap.fastest') || key.includes('.lap.personalBest')) return 'clock';
  if (key.includes('.flag.chequered') || key.includes('.lap.final')) return 'chequered';
  if (key.includes('.blackWhite')) return 'bw-flag';
  if (key.includes('.flag.')) return 'flag';
  if (key.includes('.penalty.') || key.includes('.jumpStart')) return 'stopwatch';
  if (key.includes('.weather.')) return 'drop';
  if (key.includes('.pit.')) return 'pit';
  if (key.includes('.flashback.')) return 'rewind';
  if (key.includes('.drs.') || key.includes('.ers')) return 'bolt';
  return level === 'good' ? 'check' : level === 'warn' ? 'warn' : level === 'penalty' ? 'stopwatch' : 'info';
}

function colourFor(key: string, level: Note['level']): string {
  if (key.includes('.lap.fastest')) return 'purple';
  if (key.includes('.flag.yellow')) return 'yellow';
  if (key.includes('.flag.blue')) return 'blue';
  if (key.includes('.blackWhite')) return 'bw';
  if (key.includes('.flag.chequered')) return 'chq';
  return level;
}

export interface Banners extends HudWidget {
  el: HTMLElement;
  update(m: HudModel): void;
  setLightsShown(on: boolean): void;
}

export function createBanners(parent: HTMLElement, ctx: HudCtx & { has(key: string): boolean }): Banners {
  const el = h('div', 'h-reg h-banners h-mode-hide', parent);
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  const lightsA = new Attr(el, 'data-lights');
  const views = new Map<number, BannerView>();
  const pick: Note[] = [];
  const byRank = (a: Note, b: Note): number => (b.priority ?? 0) - (a.priority ?? 0) || b.id - a.id;
  const byNewest = (a: Note, b: Note): number => b.id - a.id;

  const text = (v: BannerView, n: Note): void => {
    const p = fmt.formatParams(n.params, ctx.lang());
    const k = n.key;
    v.title.set(ctx.has(`${k}.title`) ? ctx.t(`${k}.title`, p) : ctx.t(k, p));
    const d = ctx.has(`${k}.detail`) ? ctx.t(`${k}.detail`, p) : '';
    v.detail.set(d);
    v.detailA.set(d ? '1' : '0');
    const c = ctx.has(`${k}.chip`) ? ctx.t(`${k}.chip`, p) : '';
    v.chip.set(c);
    v.chipA.set(c ? '1' : '0');
  };

  const paramsChanged = (v: BannerView, n: Note): boolean => {
    const p = n.params;
    let count = 0;
    for (const key in p) {
      count++;
      if (v.params[key] !== p[key]) return true;
    }
    for (const key in v.params) count--;
    return count !== 0;
  };

  const pool: BannerView[] = [];
  const create = (n: Note, slot: number): BannerView => {
    const ic = iconFor(n.key, n.level);
    let v = pool.pop();
    if (!v) {
      const b = h('div', 'h-ban');
      h('span', 'stripe', b);
      b.appendChild(icon(ic, 'ic'));
      const title = new Txt(h('span', 'title', b));
      h('span', 'div', b);
      const detail = new Txt(h('span', 'detail apx-num', b));
      const chip = new Txt(h('span', 'chip apx-num', b));
      v = {
        id: n.id, key: n.key, el: b, title, detail, chip, detailA: new Attr(b, 'data-detail'), chipA: new Attr(b, 'data-chip'),
        params: {}, slot, leaving: false, icon: ic,
      };
    } else if (v.icon !== ic) {
      v.el.children[1]!.replaceWith(icon(ic, 'ic'));
      v.icon = ic;
    }
    v.id = n.id;
    v.key = n.key;
    v.slot = slot;
    v.leaving = false;
    v.params = { ...n.params };
    const b = v.el;
    b.dataset.lvl = colourFor(n.key, n.level);
    if (n.level === 'penalty') b.setAttribute('role', 'alert');
    else b.removeAttribute('role');
    text(v, n);
    el.appendChild(b);
    gsap.set(b, { xPercent: -50, yPercent: slot * SLOT });
    if (ctx.reduced()) ctx.track(gsap.fromTo(b, { opacity: 0 }, { opacity: 1, duration: 0.12, ease: 'none' }));
    else ctx.track(gsap.fromTo(b, { opacity: 0, yPercent: slot * SLOT - 21.4 }, { opacity: 1, yPercent: slot * SLOT, duration: 0.26, ease: 'apex.settle' }));
    return v;
  };

  const recycle = (v: BannerView): void => {
    v.el.remove();
    if (views.get(v.id) === v) views.delete(v.id);
    if (pool.length < 4) pool.push(v);
  };

  const leave = (v: BannerView): void => {
    v.leaving = true;
    gsap.killTweensOf(v.el);
    const done = (): void => recycle(v);
    if (ctx.reduced()) ctx.track(gsap.to(v.el, { opacity: 0, duration: 0.12, ease: 'none', onComplete: done }));
    else ctx.track(gsap.to(v.el, { opacity: 0, yPercent: v.slot * SLOT - 10.7, duration: 0.16, ease: 'apex.in', onComplete: done }));
  };

  return {
    el,
    setLightsShown(on) {
      lightsA.set(on ? '1' : '0');
    },
    update(m) {
      const list = m.notifications;
      pick.length = 0;
      for (const n of list) pick.push(n);
      if (pick.length > MAX_VISIBLE) {
        pick.sort(byRank);
        pick.length = MAX_VISIBLE;
      }
      pick.sort(byNewest);
      // Leaving: visible views whose id is no longer picked.
      for (const v of views.values()) {
        if (v.leaving) continue;
        let keep = false;
        for (const n of pick) if (n.id === v.id) { keep = true; break; }
        if (!keep) leave(v);
      }
      for (let slot = 0; slot < pick.length; slot++) {
        const n = pick[slot]!;
        const v = views.get(n.id);
        if (!v || v.leaving) {
          if (v) {
            gsap.killTweensOf(v.el);
            recycle(v);
          }
          views.set(n.id, create(n, slot));
          continue;
        }
        if (v.key !== n.key || paramsChanged(v, n)) {
          v.key = n.key;
          v.params = { ...n.params };
          text(v, n);
        }
        if (v.slot !== slot) {
          v.slot = slot;
          if (ctx.reduced()) gsap.set(v.el, { yPercent: slot * SLOT });
          else ctx.track(gsap.to(v.el, { yPercent: slot * SLOT, duration: 0.22, ease: 'apex.inOut', overwrite: 'auto' }));
        }
      }
    },
    relabel() {
      for (const v of views.values()) {
        v.title.reset();
        v.detail.reset();
        v.chip.reset();
        v.params = {};
      }
    },
    dispose() {
      for (const v of views.values()) gsap.killTweensOf(v.el);
      views.clear();
      el.remove();
    },
  };
}
