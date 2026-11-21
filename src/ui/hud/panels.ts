// HUD modal panels (DESIGN §6.9, §6.10, §5.1): MFD (compact 400 × ~262, docked above the wheel, Tab), flashback timeline (880 × 112) and the
// Time Trial panel that replaces the tower. Values are written directly; only open/close is animated
// (y 16 → 0 + opacity, 180 ms apex.out / 140 ms apex.in; reduced = opacity only).

import type { HudModel } from '../../contracts/hud';
import { Attr, h, icon, Txt } from '../dom';
import * as fmt from '../format';
import { gsap } from '../motion/gsap';
import type { ActionId } from '../../contracts/input';
import { padChip, setPadChip } from '../padGlyph';
import type { HudCtx, HudWidget } from './ctx';

function openClose(ctx: HudCtx, el: HTMLElement, open: boolean): void {
  gsap.killTweensOf(el);
  if (open) {
    el.hidden = false;
    if (ctx.reduced()) ctx.track(gsap.fromTo(el, { opacity: 0 }, { opacity: 1, duration: 0.12, ease: 'none' }));
    else ctx.track(gsap.fromTo(el, { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.18, ease: 'apex.out' }));
  } else {
    const done = (): void => {
      el.hidden = true;
    };
    if (ctx.reduced()) ctx.track(gsap.to(el, { opacity: 0, duration: 0.12, ease: 'none', onComplete: done }));
    else ctx.track(gsap.to(el, { opacity: 0, y: 16, duration: 0.14, ease: 'apex.in', onComplete: done }));
  }
}

const PAGES = ['strategy', 'ers', 'brakes', 'weather', 'tyres'] as const;
const WHEELS = ['fl', 'fr', 'rl', 'rr'] as const;

export interface Panel extends HudWidget {
  el: HTMLElement;
  update(m: HudModel): void;
}

/** MFD (§6.9): 5 slanted page ticks + title, up to 4 option rows (key chip, label, value), footer hints. */
export function createMfd(parent: HTMLElement, ctx: HudCtx): Panel {
  const el = h('div', 'h-reg h-mfd', parent);
  el.hidden = true;
  el.setAttribute('role', 'group');
  const head = h('div', 'mfd-head', el);
  const ticks = h('div', 'mfd-ticks', head);
  // Touch: tapping the header cycles the page (Tab).
  head.addEventListener('pointerdown', (e) => {
    if (!ctx.act) return;
    e.preventDefault();
    ctx.act('mfdNext');
  });
  const tickEls = PAGES.map(() => h('i', '', ticks));
  const tickA = tickEls.map((e) => new Attr(e, 'data-on'));
  // Time Trial skips STRATEJİ (ui-hud §4), so its tick is hidden there.
  const stratTick = new Attr(tickEls[0]!, 'data-show');
  const titleEl = h('span', 'mfd-title', head);
  titleEl.id = 'apx-mfd-title';
  el.setAttribute('aria-labelledby', titleEl.id);
  const title = new Txt(titleEl);
  const MFD_ACTIONS: readonly ActionId[] = ['mfd1', 'mfd2', 'mfd3', 'mfd4'];
  const rows = [0, 1, 2, 3].map((i) => {
    const r = h('div', 'mfd-row', el);
    const k = h('span', 'apx-kc', r, String(i + 1));
    const l = new Txt(h('span', 'lbl', r));
    const v = new Txt(h('span', 'val apx-num', r));
    const on = h('span', 'on', r);
    on.appendChild(icon('check'));
    // Touch (2026-11-21): a tapped row acts like its number key (the MFD takes pointers only in the touch layout).
    r.addEventListener('pointerdown', (e) => {
      if (!ctx.act) return;
      e.preventDefault();
      ctx.act(MFD_ACTIONS[i]!);
    });
    return { r, k, l, v, onA: new Attr(r, 'data-on'), show: new Attr(r, 'data-show') };
  });
  const foot = h('div', 'mfd-foot', el);
  const info = new Txt(h('span', 'info apx-num', foot));
  const hintEl = h('span', 'hint', foot);
  const hint = new Txt(hintEl);
  let open = false;
  /** Gamepad hint state: '' = keyboard; else the buttons the chips show (rebuilt only when that changes). */
  let padSig = '';
  const padHints = (): void => {
    const next = ctx.padButton('mfdNext');
    const picks = MFD_ACTIONS.map((a) => ctx.padButton(a));
    const sig = next === null ? '' : `${next}|${picks.join(',')}|${ctx.lang()}`;
    if (sig === padSig) return;
    padSig = sig;
    rows.forEach((r, i) => {
      const b = picks[i];
      if (sig && b !== null && b !== undefined) setPadChip(r.k, b);
      else {
        r.k.classList.remove('apx-pad');
        delete r.k.dataset.pad;
        r.k.textContent = String(i + 1);
      }
    });
    if (sig) {
      hint.reset();
      hintEl.replaceChildren();
      padChip(hintEl, next!);
      h('span', '', hintEl, ` ${ctx.t('hud.mfd.hintNext')} · ${ctx.t('hud.mfd.hintPick')}`);
    } else {
      hintEl.replaceChildren();
      hint.reset();
    }
  };
  const set = (i: number, label: string, value: string, on: boolean, chip = true): void => {
    const row = rows[i]!;
    row.show.set(label ? '1' : '0');
    row.l.set(label);
    row.v.set(value);
    row.onA.set(on ? '1' : '0');
    row.k.style.visibility = chip ? '' : 'hidden';
  };
  return {
    el,
    update(m) {
      const f = m.mfd;
      if (f.open !== open) {
        open = f.open;
        openClose(ctx, el, open);
      }
      if (!open) return;
      const t = ctx.t;
      const lang = ctx.lang();
      const pi = PAGES.indexOf(f.page);
      tickA.forEach((a, i) => a.set(i === pi ? '1' : '0'));
      stratTick.set(m.mode === 'timeTrial' ? '0' : '1');
      title.set(t(`hud.mfd.page.${f.page}`));
      let infoText = '';
      switch (f.page) {
        case 'strategy':
          set(0, t('hud.mfd.box'), t(f.boxRequested ? 'hud.mfd.boxOn' : 'hud.mfd.boxOff'), f.boxRequested);
          set(1, t('hud.mfd.nextTyre'), t(`hud.tyre.name.${f.nextCompound}`), false);
          set(2, t('hud.mfd.gapMode'), t(m.gapMode === 'leader' ? 'hud.tower.toLeader' : 'hud.tower.interval'), false);
          set(3, t('hud.mfd.tower'), t(m.towerExpanded ? 'hud.mfd.expanded' : 'hud.mfd.collapsed'), false);
          infoText = t('hud.mfd.pitLoss', { s: fmt.decimal(f.pitLossS, 1, lang) }) + (f.rejoinPos ? ` · ${t('hud.mfd.rejoin', { p: f.rejoinPos })}` : '')
            + (m.penalty.toServeSec > 0 ? ` · ${t('hud.pit.toServe', { s: m.penalty.toServeSec })}` : '');
          break;
        case 'ers': {
          const mode = m.car.ers.mode;
          set(0, t('hud.wheel.mode.none'), '', !f.ersAuto && mode === 'none');
          set(1, t('hud.wheel.mode.medium'), '', !f.ersAuto && mode === 'medium');
          set(2, t('hud.wheel.mode.hotlap'), '', !f.ersAuto && mode === 'hotlap');
          set(3, t('hud.mfd.ersAuto'), '', f.ersAuto);
          infoText = `${t('hud.wheel.ers')} ${fmt.pctOf(m.car.ers.soc, lang)} · ${t('hud.mfd.lapUsed', { p: fmt.pctOf(m.car.ers.lapUsed, lang) })}`;
          break;
        }
        case 'brakes': {
          const b = m.car.brakeBias <= 1 ? m.car.brakeBias * 100 : m.car.brakeBias;
          set(0, t('hud.mfd.biasDown'), '', false);
          set(1, t('hud.mfd.biasUp'), '', false);
          set(2, t('hud.mfd.biasDefault'), '', Math.abs(b - 57.5) < 0.05);
          set(3, '', '', false);
          infoText = `${t('hud.wheel.brake')} ${fmt.pct(b, 1, lang)}`;
          break;
        }
        case 'weather':
          for (let i = 0; i < 4; i++) {
            const c = f.forecast[i];
            if (!c) set(i, '', '', false, false);
            else set(i, t('hud.mfd.forecast', { min: c.inMin }), `${t('hud.mfd.rainPct', { r: Math.round(c.rain * 100) })} · ${t('hud.mfd.probPct', { p: Math.round(c.probability * 100) })}`, false, false);
          }
          break;
        case 'tyres': {
          const ty = m.car.tyre;
          WHEELS.forEach((w, i) => {
            const wear = ty.wear[i]!;
            set(i, t(`hud.mfd.wheel.${w}`), `${fmt.pct(Math.round(wear <= 1 ? wear * 100 : wear), 0, lang)} · ${fmt.temp(ty.tempC[i]!, false)} · ${t(`hud.mfd.state.${ty.state[i]}`)}`, false, false);
          });
          infoText = `${t(`hud.tyre.name.${ty.compound}`)} · ${t('hud.tyre.age', { n: ty.ageLaps })}`;
          break;
        }
      }
      info.set(infoText);
      padHints();
      if (!padSig) hint.set(`${ctx.key('Tab')} ${t('hud.mfd.hintNext')} · 1–4 ${t('hud.mfd.hintPick')}`);
    },
    relabel() {
      padSig = '-';
      title.reset();
      for (const r of rows) {
        r.l.reset();
        r.v.reset();
      }
    },
    dispose() {
      gsap.killTweensOf(el);
      el.remove();
    },
  };
}

/** Flashback timeline (§6.10): 15 one-second ticks, discarded span (head → now) at 30 %, head written directly. */
export function createFlashback(parent: HTMLElement, ctx: HudCtx): Panel {
  const el = h('div', 'h-reg h-fb', parent);
  el.hidden = true;
  const top = h('div', 'fb-top', el);
  const title = h('span', 'fb-title', top);
  const left = new Txt(h('span', 'h-lbl15', top));
  const off = new Txt(h('span', 'fb-off apx-num', top));
  const track = h('div', 'fb-track', el);
  for (let i = 1; i < 15; i++) h('i', '', track).style.left = `${(i / 15) * 100}%`;
  const avail = h('b', 'fb-avail', track);
  const gone = h('b', 'fb-gone', track);
  const head = h('span', 'fb-head', track);
  const hints = h('div', 'fb-hints', el);
  const mk = (keys: (string | number | { icon: string })[], label: string): void => {
    const s = h('span', '', hints);
    for (const k of keys) {
      if (typeof k === 'number') {
        padChip(s, k);
        continue;
      }
      const c = h('span', 'apx-kc', s);
      if (typeof k === 'string') c.textContent = k;
      else c.appendChild(icon(k.icon));
    }
    h('span', 'lbl', s, label);
  };
  let open = false;
  let lastHead = -1;
  const relabel = (): void => {
    title.textContent = ctx.t('hud.flashback.title');
    hints.replaceChildren();
    // Gamepad: D-pad ← → scrub, A apply, B cancel (the fixed menu buttons).
    const pad = ctx.padButton('menuConfirm') !== null;
    mk(pad ? [14, 15] : [{ icon: 'arrow-left' }, { icon: 'arrow-right' }], ctx.t('hud.flashback.scrub'));
    mk([pad ? 0 : ctx.key('Enter')], ctx.t('hud.flashback.apply'));
    mk([pad ? 1 : ctx.key('Escape')], ctx.t('hud.flashback.cancel'));
    left.reset();
    off.reset();
  };
  relabel();
  return {
    el,
    update(m) {
      const fb = m.flashback;
      if (fb.open !== open) {
        open = fb.open;
        openClose(ctx, el, open);
      }
      if (!open) return;
      left.set(ctx.t('hud.flashback.left', { n: fb.left < 0 ? ctx.t('hud.flashback.unlimited') : fb.left }));
      off.set(ctx.t('hud.flashback.sec', { v: fmt.signedSec(fb.offsetSec) }));
      const x = Math.max(0, Math.min(1, (15 + fb.offsetSec) / 15));
      const q = Math.round(x * 1000);
      if (q !== lastHead) {
        lastHead = q;
        head.style.transform = `translateX(${x * 840}px)`;
        gone.style.transform = `scaleX(${1 - x})`;
        avail.style.transform = `scaleX(${Math.min(1, fb.maxSec / 15)})`;
      }
    },
    relabel,
    dispose() {
      gsap.killTweensOf(el);
      el.remove();
    },
  };
}

export interface TtSource { pbMs: number; laps: readonly { n: number; ms: number; valid: boolean }[]; ghost: 'off' | 'pb' | 'rival' }

/** Time Trial panel (§5.1): personal best, ghost mode and the last 5 laps with ✓/✗. Replaces the tower. */
export function createTtPanel(parent: HTMLElement, ctx: HudCtx, src: () => TtSource | null): Panel {
  const el = h('div', 'h-reg h-ttp h-mode-hide', parent);
  el.hidden = true;
  el.setAttribute('aria-hidden', 'true');
  const lbl = h('div', 'h-lbl', el);
  const pb = new Txt(h('div', 'ttp-pb apx-num', el));
  const ghost = new Txt(h('div', 'h-lbl ttp-ghost', el));
  const list = h('div', 'ttp-laps', el);
  let sig = '';
  const relabel = (): void => {
    lbl.textContent = ctx.t('hud.tt.pb');
    sig = '';
  };
  relabel();
  return {
    el,
    update(m) {
      const show = m.mode === 'timeTrial';
      if (el.hidden === show) el.hidden = !show;
      if (!show) return;
      const s = src();
      const pbMs = s?.pbMs ?? m.timing.bestLapMs;
      const laps = s?.laps ?? [];
      const key = `${pbMs}|${laps.length}|${s?.ghost}`;
      if (key === sig) return;
      sig = key;
      pb.set(fmt.lapTime(pbMs));
      ghost.set(`${ctx.t('hud.tt.ghost')} · ${ctx.t(`hud.tt.ghostMode.${s?.ghost ?? 'off'}`)}`);
      list.replaceChildren();
      for (const l of laps.slice(-5).reverse()) {
        const r = h('div', 'ttp-lap', list);
        r.dataset.valid = l.valid ? '1' : '0';
        h('span', 'h-lbl', r, ctx.t('hud.tt.lapN', { n: l.n }));
        h('span', 'v apx-num', r, fmt.lapTime(l.ms));
        r.appendChild(icon(l.valid ? 'check' : 'cross'));
      }
    },
    relabel,
    dispose() {
      el.remove();
    },
  };
}
