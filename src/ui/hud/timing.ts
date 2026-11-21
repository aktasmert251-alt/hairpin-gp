// Timing panel (DESIGN §6.2; ui-hud §2). The only place with the lap counter (D-006). Sector flash on
// completion: a white overlay .85 → 0 over 480 ms (apex.out); reduced motion outlines the cell for 1 s.

import type { HudModel } from '../../contracts/hud';
import { Attr, h, icon, Txt } from '../dom';
import * as fmt from '../format';
import { gsap } from '../motion/gsap';
import type { HudCtx, HudWidget } from './ctx';

export interface Timing extends HudWidget {
  el: HTMLElement;
  update(m: HudModel, now: number): void;
}

interface SecView { el: HTMLElement; st: Attr; hl: Attr; v: Txt; lbl: HTMLElement; flash: HTMLElement; hlUntil: number }

export function createTiming(parent: HTMLElement, ctx: HudCtx): Timing {
  const el = h('div', 'h-reg h-timing h-mode-hide', parent);
  el.setAttribute('aria-hidden', 'true');
  const a = h('div', 't-a', el);
  const posBox = h('div', 't-pos apx-num', a);
  const posV = new Txt(h('span', '', posBox));
  const posOf = new Txt(h('small', 'apx-num', posBox));
  const flag = h('span', 't-flag', a);
  flag.append(icon('flag', 'fi-flag'), icon('bw-flag', 'fi-bw'), icon('chequered', 'fi-chq'));
  const flagT = new Txt(h('span', '', flag));
  const lapBox = h('div', 't-lap', a);
  const lapL = h('span', 'h-lbl15', lapBox);
  const lapV = h('span', 'v apx-num', lapBox);
  const lapCur = new Txt(h('span', '', lapV));
  const lapTot = new Txt(h('small', '', lapV));
  const b = h('div', 't-b', el);
  const cur = new Txt(h('span', 't-cur apx-num', b));
  const deltaEl = h('span', 't-chip t-delta apx-num', b);
  const delta = new Txt(deltaEl);
  const deltaA = new Attr(deltaEl, 'data-d');
  const inv = h('span', 't-chip t-inv', b);
  const c = h('div', 't-c', el);
  const lastBox = h('div', '', c);
  const lastL = h('span', 'h-lbl', lastBox);
  const last = new Txt(h('span', 'v apx-num', lastBox));
  const bestBox = h('div', '', c);
  const bestL = h('span', 'h-lbl', bestBox);
  const best = new Txt(h('span', 'v apx-num', bestBox));
  const secRow = h('div', 't-sec', el);
  const secs: SecView[] = [];
  for (let i = 0; i < 3; i++) {
    const s = h('div', 'sec', secRow);
    h('div', 'bar', s);
    const meta = h('div', 'meta', s);
    const lbl = h('span', 'h-lbl', meta);
    const v = new Txt(h('span', 'v apx-num', meta));
    const flash = h('span', 'flash', s);
    secs.push({ el: s, st: new Attr(s, 'data-st'), hl: new Attr(s, 'data-hl'), v, lbl, flash, hlUntil: 0 });
  }
  const invalidA = new Attr(el, 'data-invalid');
  const flagA = new Attr(el, 'data-flag');
  let prevSector = -1;
  let prevLap = -1;

  const relabel = (): void => {
    lapL.textContent = ctx.t('hud.timing.lap');
    lastL.textContent = ctx.t('hud.timing.last');
    bestL.textContent = ctx.t('hud.timing.best');
    inv.textContent = ctx.t('hud.timing.invalid');
    flagT.reset();
    secs.forEach((s, i) => (s.lbl.textContent = ctx.t('hud.timing.sector', { n: i + 1 })));
  };
  relabel();

  const flash = (i: number, now: number): void => {
    const s = secs[i]!;
    if (ctx.reduced()) {
      s.hl.set('1');
      s.hlUntil = now + 1000;
      return;
    }
    ctx.track(gsap.fromTo(s.flash, { opacity: 0.85 }, { opacity: 0, duration: 0.48, ease: 'apex.out' }));
  };

  return {
    el,
    update(m, now) {
      const tm = m.timing;
      const race = m.mode === 'race';
      const showPos = m.position !== null && race;
      if (posBox.hidden === showPos) posBox.hidden = !showPos;
      if (m.position && showPos) {
        posV.set(`P${m.position.pos}`);
        posOf.set(`/${m.position.of}`);
      }
      lapCur.set(String(Math.max(1, m.lap.current)));
      lapTot.set(m.lap.total !== null ? `/${m.lap.total}` : '');
      cur.set(fmt.lapTime(tm.curLapMs));
      invalidA.set(tm.invalid ? '1' : '0');
      if (tm.deltaMs === null || !Number.isFinite(tm.deltaMs)) deltaA.set('none');
      else {
        deltaA.set(tm.deltaMs < 0 ? 'faster' : 'slower');
        delta.set(fmt.delta(tm.deltaMs));
      }
      last.set(fmt.lapTime(tm.lastLapMs));
      best.set(fmt.lapTime(tm.bestLapMs));
      const cs = tm.curSector;
      // One flag chip, highest priority first: chequered > black-and-white > blue > yellow in the current sector.
      const fl = m.flags;
      const fk = fl.chequered ? 'chq' : fl.blackWhite ? 'bw' : fl.blue ? 'blue' : fl.yellow[cs] ? 'yellow' : 'none';
      flagA.set(fk);
      if (fk !== 'none') flagT.set(ctx.t(`hud.timing.${fk}`));
      // A sector completes when curSector advances (or wraps at the line).
      if (prevSector >= 0 && cs !== prevSector && (m.lap.current === prevLap || cs === 0)) flash(prevSector, now);
      prevSector = cs;
      prevLap = m.lap.current;
      for (let i = 0; i < 3; i++) {
        const s = secs[i]!;
        const d = tm.sectors[i]!;
        if (i === cs) {
          s.st.set('live');
          s.v.set(fmt.EMPTY);
        } else if (i < cs && d.ms > 0) {
          s.st.set(d.status);
          s.v.set(fmt.sectorTime(d.ms));
        } else {
          s.st.set('none');
          s.v.set(fmt.EMPTY);
        }
        if (s.hlUntil !== 0 && now >= s.hlUntil) {
          s.hl.set('0');
          s.hlUntil = 0;
        }
      }
    },
    relabel,
    dispose() {
      el.remove();
    },
  };
}
