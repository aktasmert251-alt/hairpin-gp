// Pause (DESIGN §5.2; ui-hud §6): --apx-scrim over the frozen game with the HUD visible underneath; a 560 px left
// panel with the navigation list and a session card on the right. Destructive items open a confirm dialog with
// HAYIR focused; focus stays inside the dialog and returns to the item on close.

import type { ActionId } from '../../contracts/input';
import type { ScreenId } from '../../contracts/ui';
import { button, navItem, type Ctl } from '../controls';
import { h, wordmark } from '../dom';
import { FEATURES } from '../features';
import { FocusList } from '../focus/focus';
import * as fmt from '../format';
import { gsap } from '../motion/gsap';
import { ListScreen } from './base';
import type { ScreenCtx } from './ctx';

type Confirm = 'restart' | 'retire' | 'quit';

export class Pause extends ListScreen {
  private panel: HTMLElement;
  private heading: HTMLElement;
  private card: HTMLElement;
  private dim: HTMLElement;
  private dialog: HTMLElement;
  private dTitle: HTMLElement;
  private dBody: HTMLElement;
  private dFocus: FocusList;
  private dCtls: Ctl[];
  private open: Confirm | null = null;
  /** Time Trial only: restart the current lap (same path as the Backspace `restartLap` action). */
  private lapItem!: Ctl;
  private unQuit: () => void;

  constructor(ctx: ScreenCtx) {
    super('pause', ctx);
    this.overlay = true;
    this.backdrop = 'none';
    this.el.classList.add('is-overlay');
    h('div', 'm-scrim-pause', this.el);
    this.el.insertBefore(this.el.lastChild!, this.st);
    this.panel = h('div', 'm-pause', this.st);
    const wm = wordmark('m-wm', ctx.t('menu.brand'));
    wm.style.cssText = 'position:absolute;left:48px;top:64px;height:40px';
    this.panel.appendChild(wm);
    this.heading = h('h1', 'm-h1', this.panel);
    const nav = h('nav', 'm-nav', this.panel);
    const race = (): boolean => ctx.deps.setup.get().mode === 'race';
    this.setControls([
      navItem(ctx, nav, { id: 'pause.resume', label: 'menu.pause.resume', activate: () => ctx.dispatch({ type: 'resume' }) }),
      (this.lapItem = navItem(ctx, nav, { id: 'pause.restartLap', label: 'menu.pause.restartLap', disabled: () => race() || this.isOnline(), activate: () => this.restartLap() })),
      navItem(ctx, nav, { id: 'pause.restart', label: 'menu.pause.restart', disabled: () => this.isOnline(), activate: () => this.ask('restart') }),
      navItem(ctx, nav, { id: 'pause.settings', label: 'menu.pause.settings', disabled: () => !FEATURES.settings, activate: () => ctx.go('settings') }),
      // Time Trial: the retire slot ends the session and shows the TT summary (QA-19-03).
      navItem(ctx, nav, { id: 'pause.retire', label: 'menu.pause.retire', activate: () => this.ask('retire') }),
      // D-056: main menu, online too (leaves the room).
      navItem(ctx, nav, { id: 'pause.quit', label: 'menu.pause.quit', activate: () => this.ask('quit') }),
    ]);
    // D-056: the in-race M shortcut paused the session; open the main-menu confirmation right away.
    this.unQuit = ctx.deps.bus.on('session:quitRequest', () => {
      if (!this.open) this.ask('quit');
    });
    this.card = h('aside', 'm-session', this.st);
    this.dim = h('div', 'm-dim', this.st);
    this.dialog = h('div', 'm-confirm', this.st);
    this.dialog.setAttribute('role', 'alertdialog');
    this.dialog.setAttribute('aria-modal', 'true');
    this.dTitle = h('h2', 'm-h2', this.dialog);
    this.dBody = h('p', 'm-body', this.dialog);
    this.dTitle.id = 'apx-pause-confirm-title';
    this.dBody.id = 'apx-pause-confirm-body';
    this.dialog.setAttribute('aria-labelledby', this.dTitle.id);
    this.dialog.setAttribute('aria-describedby', this.dBody.id);
    const btns = h('div', 'm-btns', this.dialog);
    this.dCtls = [
      button(ctx, btns, { id: 'pause.confirm.yes', label: () => ctx.t('menu.confirm.yes'), activate: () => this.confirm() }),
      button(ctx, btns, { id: 'pause.confirm.no', label: () => ctx.t('menu.confirm.no'), activate: () => this.close() }),
    ];
    this.dFocus = new FocusList({ reduced: ctx.reduced });
    this.dFocus.setItems(this.dCtls);
    this.dim.hidden = true;
    this.dialog.hidden = true;
  }

  animated(): HTMLElement[] {
    return [this.panel, this.card];
  }

  private ask(c: Confirm): void {
    if (this.isOnline() && c === 'restart') return;
    this.open = c;
    const onlineKey = c === 'quit' ? 'menu.confirm.quitOnline' : 'online.leaveRaceTitle';
    const key = c === 'retire' && this.isTt() ? 'endTt' : c;
    this.dTitle.textContent = this.ctx.t(this.isOnline() ? onlineKey : `menu.confirm.${key}`);
    this.dBody.textContent = this.ctx.t(this.isOnline() ? (c === 'quit' ? 'menu.confirm.quitOnlineBody' : 'online.leaveRaceBody') : `menu.confirm.${key}Body`);
    for (const x of this.dCtls) x.render();
    this.focus.current()?.el.classList.remove('is-focus');
    this.dim.hidden = false;
    this.dialog.hidden = false;
    this.dFocus.index = -1;
    this.dFocus.set(1, false);
    this.ctx.sound('open');
    if (!this.ctx.reduced()) this.ctx.track(gsap.fromTo(this.dialog, { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.18, ease: 'apex.out', clearProps: 'opacity' }));
  }

  private close(): void {
    if (!this.open) return;
    this.open = null;
    this.dim.hidden = true;
    this.dialog.hidden = true;
    this.dFocus.blur();
    this.ctx.sound('close');
    this.focus.set(this.focus.index, false);
    this.focus.current()?.el.focus({ preventScroll: true });
  }

  private confirm(): void {
    const c = this.open;
    this.close();
    if (c === 'restart') this.ctx.dispatch({ type: 'restart' });
    else if (c === 'retire') this.ctx.dispatch({ type: this.isOnline() ? 'onlineLeave' : 'retire' });
    else if (c === 'quit') this.ctx.dispatch({ type: 'quitToMenu' });
  }

  protected back(): void {
    this.ctx.sound('back');
    this.ctx.dispatch({ type: 'resume' });
  }

  override action(a: ActionId): void {
    if (!this.open) {
      super.action(a);
      return;
    }
    const f = this.dFocus;
    if (a === 'menuLeft' || a === 'menuUp') f.move(-1) && this.ctx.sound('move');
    else if (a === 'menuRight' || a === 'menuDown') f.move(1) && this.ctx.sound('move');
    else if (a === 'menuConfirm') f.current()?.activate?.();
    else if (a === 'menuBack') this.close();
  }

  /** While the confirm dialog is open the pointer reaches only its buttons (the dim covers the list). */
  protected override pointerHit(target: Element): { list: FocusList; i: number } | null {
    if (!this.open) return super.pointerHit(target);
    const el = target.closest<HTMLElement>('[data-focus-id]');
    const i = el ? this.dFocus.items.findIndex((x) => x.el === el) : -1;
    return i >= 0 ? { list: this.dFocus, i } : null;
  }

  /** D-028: the glue resumes and restarts the lap (same path as Backspace). */
  private restartLap(): void {
    if (this.isOnline()) return;
    this.ctx.dispatch({ type: 'restartLap' });
  }

  override key(code: string): boolean {
    return this.open ? false : super.key(code);
  }

  override enter(from: ScreenId | null): void {
    if (from !== 'settings') this.restoreIndex = 0;
    this.open = null;
    this.dim.hidden = true;
    this.dialog.hidden = true;
    super.enter(from);
  }

  private renderCard(): void {
    const ctx = this.ctx;
    const m = ctx.hudLast();
    const c = this.card;
    c.replaceChildren();
    h('p', 'm-meta', c, ctx.t('menu.pause.session'));
    h('h2', 'm-h2', c, ctx.t(`tracks.${ctx.deps.setup.get().trackId}`)).style.marginTop = '10px';
    const g = h('div', 'grid', c);
    const cell = (label: string, v: string): void => {
      const d = h('div', '', g);
      h('p', 'm-meta', d, ctx.t(label));
      h('p', 'v apx-num', d, v);
    };
    cell('menu.pause.lap', m ? (m.lap.total ? `${m.lap.current}/${m.lap.total}` : String(m.lap.current)) : fmt.EMPTY);
    cell('menu.pause.position', m?.position ? `P${m.position.pos}/${m.position.of}` : fmt.EMPTY);
    cell('menu.pause.best', fmt.lapTime(m?.timing.bestLapMs ?? 0));
    cell('menu.pause.last', fmt.lapTime(m?.timing.lastLapMs ?? 0));
    if (this.isOnline()) h('p', 'm-body', c, ctx.t('online.pauseHint')).style.marginTop = '20px';
  }

  override dispose(): void {
    this.unQuit();
    super.dispose();
  }

  private isTt(): boolean { return this.ctx.deps.setup.get().mode === 'timeTrial'; }

  private isOnline(): boolean {
    const phase = this.ctx.deps.net?.get().room?.phase;
    return !!this.ctx.hudLast()?.net || phase === 'racing' || phase === 'finishing' || phase === 'countdown';
  }

  override render(): void {
    super.render();
    const online = this.isOnline();
    this.lapItem.el.hidden = this.ctx.deps.setup.get().mode === 'race' || online;
    this.ctls.find((c) => c.id === 'pause.restart')!.el.hidden = online;
    this.ctls.find((c) => c.id === 'pause.retire')!.el.querySelector('.lbl')!.textContent = this.ctx.t(online ? 'online.leaveRace' : this.isTt() ? 'menu.pause.endTt' : 'menu.pause.retire');
    this.heading.textContent = this.ctx.t(online ? 'online.pause' : 'menu.pause.heading');
    this.heading.style.fontSize = online ? '36px' : '';
    this.focus.refreshDisabled();
    this.renderCard();
  }
}
