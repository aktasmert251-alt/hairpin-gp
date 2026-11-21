// Race status strip (U7; ui-hud §2 pit panel "inside the wheel module area as a chip row"; DESIGN §2.3 penalties):
// a 400 × 28 chip row directly above the wheel module. Pit: request · PİT 80 limiter (blue) · speeding (red) ·
// box distance · service countdown. Penalty to serve (red, +n SN) and track-limit strikes 1–2 (amber outline),
// 3 (black-and-white flag icon). Values are written directly at 30 Hz; nothing here animates.

import type { HudModel } from '../../contracts/hud';
import { Attr, h, icon, Txt } from '../dom';
import * as fmt from '../format';
import type { HudCtx, HudWidget } from './ctx';

export interface Status extends HudWidget {
  el: HTMLElement;
  update(m: HudModel): void;
}

const BOX_PHASES = new Set(['requested', 'entry', 'limiter', 'boxIn']);

export function createStatus(parent: HTMLElement, ctx: HudCtx): Status {
  const el = h('div', 'h-reg h-stat h-mode-hide', parent);
  el.setAttribute('aria-hidden', 'true');
  const chip = (cls: string): { el: HTMLElement; t: Txt; on: Attr } => {
    const c = h('span', `s-chip ${cls}`, el);
    c.hidden = true;
    return { el: c, t: new Txt(h('span', '', c)), on: new Attr(c, 'data-on') };
  };
  const strikes = chip('s-strike');
  strikes.el.insertBefore(icon('bw-flag', 's-bw'), strikes.el.firstChild);
  const pen = chip('s-pen');
  const req = chip('s-info');
  const box = chip('s-info');
  const svc = chip('s-info');
  const lim = chip('s-lim');
  const spd = chip('s-spd');
  const show = (c: { el: HTMLElement }, on: boolean): void => {
    if (c.el.hidden === on) c.el.hidden = !on;
  };

  return {
    el,
    update(m) {
      const t = ctx.t;
      const lang = ctx.lang();
      const p = m.pit;
      // Pit (null = on track, no stop requested).
      show(req, !!p && !p.inLane && (p.phase === 'none' || p.phase === 'requested'));
      if (p && !req.el.hidden) req.t.set(t('hud.pit.requested'));
      show(lim, !!p && p.inLane && !p.speeding);
      show(spd, !!p && p.inLane && p.speeding);
      if (p && p.inLane) {
        const v = t('hud.pit.limiter', { kmh: fmt.speed(p.limitKmh, ctx.units()) });
        lim.t.set(v);
        spd.t.set(`${t('hud.pit.speeding')} · ${v}`);
      }
      const boxOn = !!p && BOX_PHASES.has(p.phase) && p.boxDistM > 0;
      show(box, boxOn);
      if (p && boxOn) box.t.set(t('hud.pit.box', { m: Math.round(p.boxDistM) }));
      const svcOn = !!p && p.phase === 'stationary';
      show(svc, svcOn);
      if (p && svcOn) svc.t.set(t('hud.pit.service', { s: fmt.decimal(p.serviceLeftS, 1, lang) }));
      // Penalty to serve at the next stop.
      const pz = m.penalty.toServeSec;
      show(pen, pz > 0);
      if (pz > 0) pen.t.set(t('hud.pit.toServe', { s: pz }));
      // Track-limit strikes this race (1–2 warnings, 3 = black-and-white flag; beyond that penalties take over).
      const n = m.penalty.trackLimitWarnings;
      show(strikes, n >= 1 && n <= 3);
      if (n >= 1 && n <= 3) {
        strikes.on.set(n === 3 ? 'bw' : 'warn');
        strikes.t.set(t('hud.pit.strikes', { n }));
      }
    },
    relabel() {
      for (const c of [strikes, pen, req, box, svc, lim, spd]) c.t.reset();
    },
    dispose() {
      el.remove();
    },
  };
}
