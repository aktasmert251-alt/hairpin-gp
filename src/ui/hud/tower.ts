// Position tower (DESIGN §6.1, §7.4; ui-hud §2). 30 Hz text writes only on change; re-orders run as one GSAP
// y-only FLIP batch (360 ms apex.inOut, ≤ 1 start per 250 ms, instant when > 6 rows move or under reduced motion).
// Collapsed window: P1–P3, a 6 px divider, then the player ±2 (P1–P8 when the player is in the top 5).
// Minimal mode: car ahead, you, car behind. Auto-collapse above an effective hud.scale of 1.1 (D-005).

import type { HudModel, TowerRow } from '../../contracts/hud';
import { Attr, h, icon, Txt } from '../dom';
import * as fmt from '../format';
import { gsap } from '../motion/gsap';
import type { HudCtx, HudWidget } from './ctx';

interface RowView {
  car: number;
  el: HTMLElement;
  wash: HTMLElement;
  pos: Txt; code: Txt; gap: Txt; pen: Txt; tyre: Txt; pit: Txt;
  net: Txt; netState: Attr; netTitle: Attr;
  cmp: Attr; me: Attr; pitA: Attr; out: Attr; badge: Attr; chg: Attr;
  team: string;
  prevPos: number;
  chgUntil: number;
  visible: boolean;
  /** Equals `stamp` when the row is wanted in the current update. */
  want: number;
  /** Layout top in u from layoutSlots() (NaN = hidden). */
  slot: number;
  /** FLIP scratch: visual top in px before a re-order (NaN = not animated). */
  y0: number;
}

/** Border-box row and divider heights in u (hud.css .h-row / .h-tower-div). */
const ROW_U = 30;
const DIV_U = 6;

const FLIP_GAP_MS = 250;
const CHAOS_ROWS = 6;
const CHEVRON_MS = 3000;

export interface Tower extends HudWidget {
  el: HTMLElement;
  update(m: HudModel, autoCollapse: boolean, now: number): void;
}

export function createTower(parent: HTMLElement, ctx: HudCtx): Tower {
  const el = h('div', 'h-reg h-tower h-mode-hide', parent);
  const onlineState = new Attr(el, 'data-online');
  el.setAttribute('aria-hidden', 'true');
  const head = h('div', 'h-tower-head h-lbl', el);
  const headA = h('span', '', head);
  const headSep = h('span', '', head, '·');
  const headB = h('b', '', head);
  const ping = new Txt(h('span', 'h-net-ping apx-num', head));
  const body = h('div', 'h-tower-body', el);
  const divider = h('div', 'h-tower-div');
  const headLabel = new Txt(headA);
  const headMode = new Txt(headB);
  void headSep;

  const views = new Map<number, RowView>();
  let order: number[] = []; // car ids in DOM order (visible and hidden)
  const sorted: TowerRow[] = [];
  const byPos = (a: TowerRow, b: TowerRow): number => a.pos - b.pos;
  let stamp = 0;
  let lastFlip = -1e9;
  let gapMode: HudModel['gapMode'] | null = null;

  const makeRow = (car: number): RowView => {
    const row = h('div', 'h-row');
    const posC = h('span', 'pos apx-num', row);
    posC.append(icon('up', 'chg up'), icon('down', 'chg dn'));
    const posT = h('span', '', posC);
    h('span', 'strip', row);
    h('span', '', row);
    const code = h('span', 'code', row);
    const tyre = h('span', 'h-tyre', row);
    h('span', '', row);
    const badge = h('span', 'badge', row);
    const pen = h('span', 'b-pen apx-num', badge);
    h('span', 'b-drs', badge, ctx.t('hud.tower.drs'));
    const fl = h('span', 'b-fl', badge);
    fl.appendChild(icon('clock'));
    const fin = h('span', 'b-fin', badge);
    fin.appendChild(icon('chequered'));
    const net = h('span', 'b-net', row);
    const gapC = h('span', 'gap', row);
    const gapV = h('span', 'gapv apx-num', gapC);
    const pitC = h('span', 'pitc', gapC);
    const wash = h('span', 'wash', row);
    row.dataset.car = String(car);
    row.hidden = true;
    // Seed GSAP's transform / opacity caches now, so the first re-order never parses computed styles mid-race.
    gsap.set(row, { y: 0 });
    gsap.set(wash, { opacity: 0 });
    return {
      car, el: row, wash,
      pos: new Txt(posT), code: new Txt(code), gap: new Txt(gapV), pen: new Txt(pen), tyre: new Txt(tyre), pit: new Txt(pitC),
      net: new Txt(net), netState: new Attr(row, 'data-net'), netTitle: new Attr(net, 'title'),
      cmp: new Attr(tyre, 'data-cmp'), me: new Attr(row, 'data-me'), pitA: new Attr(row, 'data-pit'), out: new Attr(row, 'data-out'),
      badge: new Attr(row, 'data-badge'), chg: new Attr(row, 'data-chg'),
      team: '', prevPos: 0, chgUntil: 0, visible: false, want: 0, slot: NaN, y0: NaN,
    };
  };

  const writeRow = (v: RowView, r: TowerRow, m: HudModel, now: number): void => {
    v.pos.set(String(r.pos));
    v.code.set(r.code);
    if (r.teamColor !== v.team) {
      v.team = r.teamColor;
      v.el.style.setProperty('--team', r.teamColor);
    }
    v.cmp.set(r.compound);
    v.tyre.set(ctx.t(`hud.tyre.letter.${r.compound}`));
    v.me.set(r.isPlayer ? '1' : '0');
    const out = r.status === 'dnf' || r.status === 'dsq';
    v.out.set(out ? '1' : '0');
    v.pitA.set(r.inPit && !out ? '1' : '0');
    if (r.inPit) v.pit.set(ctx.t('hud.tower.pit'));
    let gap: string;
    if (out) gap = ctx.t(r.status === 'dnf' ? 'hud.tower.dnf' : 'hud.tower.dsq');
    else if (r.pos === 1) gap = ctx.t('hud.tower.leader');
    else if (r.lapsDown > 0) gap = fmt.lapsDown(r.lapsDown, ctx.t);
    else gap = fmt.gap(r.gapMs);
    v.gap.set(gap);
    let badge = '';
    if (r.penaltySec > 0) {
      badge = 'pen';
      v.pen.set(`+${Math.round(r.penaltySec)}`);
    } else if (r.drs) badge = 'drs';
    else if (r.fastest) badge = 'fl';
    else if (r.status === 'finished') badge = 'fin';
    v.badge.set(badge);
    v.netState.set(r.net ?? '');
    v.net.set(r.net === 'stale' ? ctx.t('online.tower.staleBadge') : r.net === 'dc' ? ctx.t('online.tower.dcBadge') : '');
    v.netTitle.set(r.net ? ctx.t(`online.tower.${r.net}`) : '');
    // No chevrons on the grid (the order settles before lights out).
    if (v.prevPos !== 0 && r.pos !== v.prevPos && !out && !m.startLights.visible) {
      v.chg.set(r.pos < v.prevPos ? 'up' : 'dn');
      v.chgUntil = now + CHEVRON_MS;
    } else if (v.chgUntil !== 0 && now >= v.chgUntil) {
      v.chg.set('');
      v.chgUntil = 0;
    }
  };

  /** Rows to show for the current mode (sorted is in position order). */
  const mark = (car: number): void => {
    views.get(car)!.want = stamp;
  };
  /** Marks the rows to show for the current mode (sorted is in position order); returns the divider slot. */
  const pickVisible = (m: HudModel, autoCollapse: boolean): number => {
    stamp++;
    const n = sorted.length;
    let me = 0;
    for (let i = 0; i < n; i++) if (sorted[i]!.isPlayer) { me = i; break; }
    if (m.visible === 'minimal') {
      for (let i = Math.max(0, me - 1); i <= Math.min(n - 1, me + 1); i++) mark(sorted[i]!.car);
      return -1;
    }
    const expanded = m.towerExpanded && !autoCollapse;
    if (expanded || n <= 8) {
      for (const r of sorted) mark(r.car);
      return -1;
    }
    if (me < 5) {
      for (let i = 0; i < Math.min(8, n); i++) mark(sorted[i]!.car);
      return -1;
    }
    for (let i = 0; i < 3; i++) mark(sorted[i]!.car);
    const lo = Math.max(3, me - 2);
    const hi = Math.min(n - 1, me + 2);
    for (let i = lo; i <= hi; i++) mark(sorted[i]!.car);
    return lo > 3 ? 2 : -1;
  };

  const applyOrder = (m: HudModel, now: number, divAfter: number): void => {
    // Desired DOM order: every row by position (hidden ones too) so FLIP deltas stay meaningful.
    let same = order.length === sorted.length;
    if (same) for (let i = 0; i < sorted.length; i++) if (order[i] !== sorted[i]!.car) { same = false; break; }
    let visChanged = false;
    for (const v of views.values()) if (v.visible !== (v.want === stamp)) { visChanged = true; break; }
    if (same && !visChanged) {
      placeDivider(divAfter);
      return;
    }
    if (!same) {
      // Chaos guard and throttle (§7.4).
      let moved = 0;
      if (order.length === sorted.length) for (let i = 0; i < sorted.length; i++) if (order[i] !== sorted[i]!.car) moved++;
      const animate = !ctx.reduced() && order.length === sorted.length && moved <= CHAOS_ROWS && !m.startLights.visible;
      // Throttled: the next update after the slot opens applies the latest order.
      if (animate && now - lastFlip < FLIP_GAP_MS) return;
      // FLIP "first" (`y0`) was read in update() before any write of this frame.
      // Overtake wash on rows that gained (skipped in chaos).
      if (animate) {
        for (const r of sorted) {
          const v = views.get(r.car)!;
          const oldIdx = order.indexOf(r.car);
          if (v.visible && oldIdx > sorted.indexOf(r)) ctx.track(gsap.fromTo(v.wash, { opacity: 0.35 }, { opacity: 0, duration: 0.6, ease: 'apex.out' }));
        }
      }
      order = sorted.map((r) => r.car);
      // Move only rows that are out of place (one insertBefore for a car gaining 5 places): re-appending every row
      // rebuilds all their layout objects and cost ~10 ms per re-order.
      let cur = body.firstElementChild;
      for (const car of order) {
        const e = views.get(car)!.el;
        if (cur === divider) cur = cur.nextElementSibling;
        if (e === cur) cur = cur.nextElementSibling;
        else body.insertBefore(e, cur);
      }
      divAt = -2; // the divider follows a slot, whose row may have changed
      setVisibility();
      placeDivider(divAfter);
      layoutSlots(divAfter);
      if (animate) {
        // FLIP "last, invert, play" from the computed slots: no layout read. y only; the contents never scale.
        lastFlip = now;
        const k = ctx.k();
        for (const v of views.values()) {
          if (Number.isNaN(v.y0) || Number.isNaN(v.slot)) continue;
          const dy = v.y0 - v.slot * k;
          if (Math.abs(dy) < 0.5) continue;
          ctx.track(gsap.fromTo(v.el, { y: dy }, { y: 0, duration: 0.36, ease: 'apex.inOut', overwrite: true }));
        }
      }
      return;
    }
    setVisibility();
    placeDivider(divAfter);
    layoutSlots(divAfter);
  };

  /** Layout top of every visible row in u (border-box rows 30u, divider 6u after slot `divAfter`); NaN = hidden. */
  const layoutSlots = (divAfter: number): void => {
    let y = 0;
    for (let i = 0; i < sorted.length; i++) {
      const v = views.get(sorted[i]!.car)!;
      v.slot = v.visible ? y : NaN;
      if (v.visible) y += ROW_U;
      if (i === divAfter) y += DIV_U;
    }
  };

  const setVisibility = (): void => {
    for (const v of views.values()) {
      const vis = v.want === stamp;
      if (vis === v.visible) continue;
      v.visible = vis;
      v.el.hidden = !vis;
      if (vis && !ctx.reduced()) ctx.track(gsap.fromTo(v.el, { opacity: 0 }, { opacity: 1, duration: 0.12, ease: 'apex.out', clearProps: 'opacity' }));
    }
  };

  let divAt = -2;
  const placeDivider = (after: number): void => {
    if (after === divAt) return;
    divAt = after;
    if (after < 0) {
      divider.remove();
      return;
    }
    const v = views.get(sorted[after]!.car)!;
    v.el.after(divider);
  };

  const relabel = (): void => {
    headLabel.set(ctx.t('hud.tower.head'));
    headMode.reset();
    if (gapMode) headMode.set(ctx.t(gapMode === 'leader' ? 'hud.tower.toLeader' : 'hud.tower.interval'));
    for (const v of views.values()) {
      v.gap.reset();
      v.tyre.reset();
      v.pit.reset();
      v.net.reset();
      v.el.querySelector('.b-drs')!.textContent = ctx.t('hud.tower.drs');
    }
  };
  relabel();

  return {
    el,
    update(m, autoCollapse, now) {
      const hide = m.mode !== 'race' || m.tower.length === 0;
      if (el.hidden !== hide) el.hidden = hide;
      if (hide) return;
      let online = !!m.net;
      for (const r of m.tower) if (r.net !== undefined) online = true;
      onlineState.set(online ? '1' : '0');
      ping.set(m.net ? ctx.t('online.tower.ping', { n: Math.round(m.net.rttMs) }) : '');
      if (m.gapMode !== gapMode) {
        gapMode = m.gapMode;
        headMode.set(ctx.t(gapMode === 'leader' ? 'hud.tower.toLeader' : 'hud.tower.interval'));
      }
      sorted.length = 0;
      for (const r of m.tower) sorted.push(r);
      sorted.sort(byPos);
      // FLIP "first": on an order change, every visible row's visual y in px = computed slot + in-flight tween y (an
      // interrupted move continues from where it is). Slots are arithmetic, so the re-order never reads layout; the
      // Flip plugin's per-element matrix walks cost 14–27 ms here for 20 rows (gate ≤ 2 ms), hence by hand.
      let reorder = order.length !== sorted.length;
      if (!reorder) for (let i = 0; i < sorted.length; i++) if (order[i] !== sorted[i]!.car) { reorder = true; break; }
      if (reorder && !ctx.reduced()) {
        const k = ctx.k();
        for (const v of views.values()) v.y0 = v.slot * k + (gsap.isTweening(v.el) ? (gsap.getProperty(v.el, 'y') as number) : 0);
      }
      for (const r of sorted) {
        let v = views.get(r.car);
        if (!v) {
          v = makeRow(r.car);
          views.set(r.car, v);
        }
        writeRow(v, r, m, now);
      }
      // Cars that left the model (session change) are removed.
      if (views.size > sorted.length) {
        for (const [car, v] of views) if (!sorted.some((r) => r.car === car)) { v.el.remove(); views.delete(car); }
        order = order.filter((c) => views.has(c));
      }
      applyOrder(m, now, pickVisible(m, autoCollapse));
      for (const r of sorted) views.get(r.car)!.prevPos = r.pos;
    },
    relabel,
    dispose() {
      el.remove();
      views.clear();
    },
  };
}
