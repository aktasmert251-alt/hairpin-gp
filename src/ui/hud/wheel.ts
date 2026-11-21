// Steering-wheel module (DESIGN §6.3): 15 shift LEDs, speed, gear, DRS / PİT chips, brake bias, ERS bar and mode.
// LEDs use `data-on`; bars use scaleX; nothing here is tweened. Shift-now = all blue and limiter = all red, both
// steady; the pit limiter alternates halves blue/amber at 2 Hz (steady under reduced motion).

import type { HudModel } from '../../contracts/hud';
import { Attr, h, ScaleX, Txt } from '../dom';
import * as fmt from '../format';
import type { HudCtx, HudWidget } from './ctx';

export interface Wheel extends HudWidget {
  el: HTMLElement;
  update(m: HudModel, now: number): void;
}

export function createWheel(parent: HTMLElement, ctx: HudCtx): Wheel {
  const el = h('div', 'h-reg h-wheel h-mode-hide', parent);
  el.setAttribute('aria-hidden', 'true');
  const ledRow = h('div', 'w-leds', el);
  const ledMode = new Attr(ledRow, 'data-m');
  const leds: Attr[] = [];
  for (let i = 0; i < 15; i++) leds.push(new Attr(h('i', 'w-led', ledRow), 'data-on'));
  const mid = h('div', 'w-mid', el);
  const sp = h('div', 'w-speed', mid);
  const speed = new Txt(h('span', 'v apx-num', sp));
  const unit = h('span', 'h-lbl', sp);
  const gear = new Txt(h('div', 'w-gear apx-num', mid));
  const right = h('div', 'w-right', mid);
  const drsEl = h('span', 'w-chip w-drs', right);
  const drsT = h('span', '', drsEl);
  const drs = new Attr(drsEl, 'data-st');
  const pitEl = h('span', 'w-chip w-pit', right);
  const pitT = h('span', '', pitEl);
  const biasBox = h('span', 'w-bias', right);
  const biasL = h('span', 'h-lbl', biasBox);
  const bias = new Txt(h('span', 'v apx-num', biasBox));
  // Brake indicator (2026-10-23): lit while the brake input is applied, so a key the keyboard drops is visible.
  const brk = new Attr(biasBox, 'data-brk');
  const ers = h('div', 'w-ers', el);
  const ersL = h('span', 'h-lbl', ers);
  const track = h('span', 'track', ers);
  const fill = new ScaleX(h('i', 'fill', track));
  const used = new ScaleX(h('i', '', h('span', 'used', track)));
  const soc = new Txt(h('span', 'v apx-num', ers));
  const modeEl = h('span', 'w-mode', ers);
  const mode = new Txt(h('span', '', modeEl));
  const ersA = new Attr(el, 'data-ers');
  let lit = -1;
  let units: 'kmh' | 'mph' | '' = '';

  const relabel = (): void => {
    units = '';
    drsT.textContent = ctx.t('hud.wheel.drs');
    pitT.textContent = ctx.t('hud.wheel.pit');
    biasL.textContent = ctx.t('hud.wheel.brake');
    ersL.textContent = ctx.t('hud.wheel.ers');
    mode.reset();
    bias.reset();
    soc.reset();
  };
  relabel();

  return {
    el,
    update(m, now) {
      const c = m.car;
      // LEDs
      if (c.pitLimiter) ledMode.set(ctx.reduced() || Math.floor(now / 250) % 2 === 0 ? 'pitA' : 'pitB');
      else if (c.limiter) ledMode.set('lim');
      else if (c.shiftNow) ledMode.set('shift');
      else ledMode.set('n');
      const n = Math.max(0, Math.min(15, Math.round(c.shiftLeds)));
      if (n !== lit) {
        lit = n;
        for (let i = 0; i < 15; i++) leds[i]!.set(i < n ? '1' : '0');
      }
      const u = ctx.units();
      if (u !== units) {
        units = u;
        unit.textContent = ctx.t(`hud.unit.${u}`);
      }
      speed.set(fmt.speed(c.kmh, u));
      gear.set(fmt.gear(c.gear));
      drs.set(c.drs);
      if (pitEl.hidden === c.pitLimiter) pitEl.hidden = !c.pitLimiter;
      const lang = ctx.lang();
      bias.set(fmt.pct(c.brakeBias <= 1 ? c.brakeBias * 100 : c.brakeBias, 1, lang));
      brk.set(c.brake > 0.05 ? '1' : '0');
      fill.set(c.ers.soc);
      used.set(c.ers.lapUsed);
      soc.set(fmt.pctOf(c.ers.soc, lang));
      const em = c.ers.overtake ? 'overtake' : c.ers.mode;
      ersA.set(em);
      mode.set(ctx.t(`hud.wheel.mode.${em}`));
    },
    relabel,
    dispose() {
      el.remove();
    },
  };
}
