// Results (DESIGN §5.2, §6.14): title + subline, a 1440 px table with 20 rows (team strip, driver in origin-language
// casing, team `lang="en"`, time/gap, best lap with the fastest marked purple + clock, stops, penalty, points),
// player row on --apx-row-hi with the apex notch; no podium colours. Rows reveal P1 first (30 ms stagger).

import type { ActionId } from '../../contracts/input';
import type { ResultsModel, ScreenId } from '../../contracts/ui';
import { button, type Ctl } from '../controls';
import { FocusList } from '../focus/focus';
import { h, icon } from '../dom';
import * as fmt from '../format';
import { gsap } from '../motion/gsap';
import { ListScreen } from './base';
import type { ScreenCtx } from './ctx';

type Row = ResultsModel['rows'][number];

export class Results extends ListScreen {
  private head: HTMLElement;
  private title: HTMLElement;
  private sub: HTMLElement;
  private table: HTMLTableElement;
  private bar: HTMLElement;
  private unsub: (() => void) | null = null;

  constructor(ctx: ScreenCtx) {
    super('results', ctx);
    this.backdrop = 'ink';
    this.head = h('div', 'm-res-head', this.st);
    this.title = h('h1', 'm-h1', this.head);
    this.sub = h('p', 'm-meta', this.head);
    this.table = h('table', 'm-res apx-num', this.st);
    this.bar = h('footer', 'm-bar', this.st);
    const btns = h('div', 'm-btns', this.bar);
    this.setControls([
      // Online: back to the room lobby instead of a restart.
      button(ctx, btns, {
        id: 'results.restart', label: () => ctx.t(this.isOnline() ? 'online.resultsLobby' : 'results.restart'),
        activate: () => ctx.dispatch({ type: this.isOnline() ? 'onlineBackToLobby' : 'restart' }),
      }),
      // D-056: main menu (with a confirmation; online it also leaves the room).
      button(ctx, btns, { id: 'results.menu', label: () => ctx.t('results.continue'), activate: () => this.ask() }),
    ]);
    this.dim = h('div', 'm-dim', this.st);
    this.dialog = h('div', 'm-confirm', this.st);
    this.dialog.setAttribute('role', 'alertdialog');
    this.dialog.setAttribute('aria-modal', 'true');
    const title = h('h2', 'm-h2', this.dialog, '');
    const body = h('p', 'm-body', this.dialog, '');
    title.id = 'apx-results-confirm-title';
    body.id = 'apx-results-confirm-body';
    this.dTitle = title;
    this.dBody = body;
    this.dialog.setAttribute('aria-labelledby', title.id);
    this.dialog.setAttribute('aria-describedby', body.id);
    const dBtns = h('div', 'm-btns', this.dialog);
    this.dCtls = [
      button(ctx, dBtns, { id: 'results.confirm.yes', label: () => ctx.t('menu.confirm.yes'), activate: () => { this.close(); this.exit(); } }),
      button(ctx, dBtns, { id: 'results.confirm.no', label: () => ctx.t('menu.confirm.no'), activate: () => this.close() }),
    ];
    this.dFocus = new FocusList({ reduced: ctx.reduced });
    this.dFocus.setItems(this.dCtls);
    this.dim.hidden = true;
    this.dialog.hidden = true;
  }

  private dim: HTMLElement;
  private dialog: HTMLElement;
  private dTitle: HTMLElement;
  private dBody: HTMLElement;
  private dCtls: Ctl[];
  private dFocus: FocusList;
  private open = false;

  private ask(): void {
    this.open = true;
    this.dTitle.textContent = this.ctx.t(this.isOnline() ? 'menu.confirm.quitOnline' : 'menu.confirm.results');
    this.dBody.textContent = this.ctx.t(this.isOnline() ? 'menu.confirm.quitOnlineBody' : 'menu.confirm.resultsBody');
    for (const x of this.dCtls) x.render();
    this.focus.current()?.el.classList.remove('is-focus');
    this.dim.hidden = false;
    this.dialog.hidden = false;
    this.dFocus.index = -1;
    this.dFocus.set(1, false);
    this.ctx.sound('open');
  }

  private close(): void {
    if (!this.open) return;
    this.open = false;
    this.dim.hidden = true;
    this.dialog.hidden = true;
    this.dFocus.blur();
    this.ctx.sound('close');
    this.focus.set(this.focus.index, false);
    this.focus.current()?.el.focus({ preventScroll: true });
  }

  /** While the confirm dialog is open the pointer reaches only its buttons. */
  protected override pointerHit(target: Element): { list: FocusList; i: number } | null {
    if (!this.open) return super.pointerHit(target);
    const el = target.closest<HTMLElement>('[data-focus-id]');
    const i = el ? this.dFocus.items.findIndex((x) => x.el === el) : -1;
    return i >= 0 ? { list: this.dFocus, i } : null;
  }

  override key(code: string): boolean {
    return this.open ? false : super.key(code);
  }

  animated(): HTMLElement[] {
    return [this.head];
  }

  override stagger(): HTMLElement[] {
    return [];
  }

  protected back(): void {
    this.ctx.sound('back');
    this.ask();
  }

  private isOnline(): boolean { return this.ctx.deps.net?.get().room?.phase === 'results' || !!this.ctx.hudLast()?.net; }
  private exit(): void { this.ctx.dispatch({ type: 'quitToMenu' }); }

  override action(a: ActionId): void {
    if (this.open) {
      const f = this.dFocus;
      if (a === 'menuLeft' || a === 'menuUp') f.move(-1) && this.ctx.sound('move');
      else if (a === 'menuRight' || a === 'menuDown') f.move(1) && this.ctx.sound('move');
      else if (a === 'menuConfirm') f.current()?.activate?.();
      else if (a === 'menuBack') this.close();
      return;
    }
    if (a === 'menuLeft') return super.action('menuUp');
    if (a === 'menuRight') return super.action('menuDown');
    super.action(a);
  }

  override enter(from: ScreenId | null): void {
    this.restoreIndex = 0;
    this.open = false;
    this.dim.hidden = true;
    this.dialog.hidden = true;
    super.enter(from);
    this.unsub = this.ctx.deps.results.subscribe(() => this.renderTable(false));
    this.reveal();
  }

  override leave(): void {
    super.leave();
    this.unsub?.();
    this.unsub = null;
  }

  private reveal(): void {
    const rows = Array.from(this.table.tBodies[0]?.rows ?? []);
    if (rows.length === 0) return;
    if (this.ctx.reduced()) {
      this.ctx.track(gsap.fromTo(rows, { opacity: 0 }, { opacity: 1, duration: 0.12, ease: 'none' }));
      return;
    }
    // 220 ms each, 30 ms stagger, ≤ 900 ms total.
    const each = Math.min(0.03, 0.68 / Math.max(1, rows.length - 1));
    this.ctx.track(gsap.fromTo(rows, { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.22, ease: 'apex.out', stagger: each, delay: 0.08, clearProps: 'transform' }));
  }

  private timeCell(r: Row, leader: Row | undefined): string {
    const t = this.ctx.t;
    if (r.status === 'dnf') return t('results.retired');
    if (r.status === 'dsq') return t('results.dsq');
    if (r.pos === 1 || r === leader) return r.totalMs > 0 ? fmt.raceTime(r.totalMs) : fmt.EMPTY;
    if (r.lapsDown > 0) return t('results.lapsDown', { n: r.lapsDown });
    return fmt.gap(r.gapMs);
  }

  private renderTable(_animate: boolean): void {
    const ctx = this.ctx;
    const t = ctx.t;
    const res = ctx.deps.results.get();
    const setup = ctx.deps.setup.get();
    this.title.textContent = t('results.heading');
    this.sub.textContent = ctx.upper(t('results.sub', { track: t(`tracks.${setup.trackId}`), laps: setup.laps }));
    // Projected classification (rules §9): any row still running marks the table provisional.
    const provisional = res.rows.some((r) => r.status === 'running');
    if (provisional) h('span', 'm-prov', this.sub, t('results.provisional'));
    const tb = this.table;
    tb.replaceChildren();
    const thead = h('thead', '', tb);
    const hr = h('tr', '', thead);
    const cols: [string, string][] = [['results.pos', 'c'], ['', ''], ['results.driver', 'nm'], ['results.team', 'tm'], ['results.time', 'r tt'], ['results.best', 'r bl'], ['results.pit', 'c ps'], ['results.penalty', 'c pn'], ['results.points', 'r pt']];
    for (const [k, cls] of cols) h('th', cls, hr, k ? t(k) : '');
    const body = h('tbody', '', tb);
    const rows = [...res.rows].sort((a, b) => a.pos - b.pos);
    const leader = rows[0];
    for (const r of rows) {
      const team = ctx.deps.teams.find((x) => x.id === r.teamId);
      const drv = team?.drivers.find((d) => d.name === r.name);
      const tr = h('tr', '', body);
      if (drv && team && setupPlayer(setup, team.id, team.drivers.indexOf(drv))) tr.classList.add('me');
      if (r.status === 'dnf' || r.status === 'dsq') tr.classList.add('out');
      if (r.status === 'running') tr.classList.add('prov');
      const p = h('td', 'p', tr);
      h('span', 'notch', p);
      p.appendChild(document.createTextNode(String(r.pos)));
      const st = h('td', 'st', tr);
      st.style.setProperty('--team', team ? team.colors.ui ?? team.colors.primary : '#949EAB');
      const nm = h('td', 'nm', tr);
      const name = h('span', '', nm, r.name);
      name.lang = drv ? fmt.langForNat(drv.nat) : 'en';
      if (drv) h('small', '', nm, drv.code);
      const tm = h('td', 'tm', tr, team?.name ?? r.teamId);
      tm.lang = 'en';
      h('td', 'r tt', tr, this.timeCell(r, leader));
      const bl = h('td', 'r bl', tr);
      if (r.car === res.fastestCar && r.bestLapMs > 0) {
        bl.classList.add('fl');
        bl.appendChild(icon('clock'));
      }
      bl.appendChild(document.createTextNode(r.bestLapMs > 0 ? fmt.lapTime(r.bestLapMs) : fmt.EMPTY));
      h('td', 'c ps', tr, String(r.stops));
      h('td', 'c pn pen', tr, r.penaltySec > 0 ? t('results.penaltySec', { s: r.penaltySec }) : '');
      h('td', 'r pt', tr, String(r.points));
    }
  }

  override render(): void {
    super.render();
    this.ctls[0]!.el.hidden = this.isOnline();
    this.focus.refreshDisabled();
    this.renderTable(false);
  }
}

function setupPlayer(s: { playerTeamId: string; playerDriverIdx: number }, teamId: string, idx: number): boolean {
  return s.playerTeamId === teamId && s.playerDriverIdx === idx;
}
