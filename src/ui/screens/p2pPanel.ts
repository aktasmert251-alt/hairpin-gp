// D-064 host-in-browser rooms: the host's invite panel (lobby). Per guest slot: create an invite code, copy it to the friend,
// paste the friend's answer code, see the slot connect. Keyboard / gamepad: its own focus list while open (lobby swaps lists).
import type { P2PModel, P2PSlot } from '../../net/index';
import { P2P_MAX_PLAYERS, buildInviteLink, codeDiag, canInvite, p2p, whatsAppUrl } from '../../net/index';
import { button, selectRow, type Ctl } from '../controls';
import { h } from '../dom';
import type { ScreenCtx } from './ctx';
import { canShare, copyText, pasteText, shareText, touchUi } from './online';

export class P2PInvitePanel {
  readonly el: HTMLElement;
  readonly controls: Ctl[];
  isOpen = false;
  private selected = 0;
  private copyState: 'copyInvite' | 'copied' | 'copyFailed' = 'copyInvite';
  private linkState: 'copyLink' | 'copyLinkDone' | 'copyFailed' = 'copyLink';
  private title: HTMLElement;
  private code: HTMLElement;
  private notice: HTMLElement;
  private status: HTMLElement;
  private inviteLabel: HTMLLabelElement;
  private inviteText: HTMLTextAreaElement;
  private answerLabel: HTMLLabelElement;
  private answer: HTMLTextAreaElement;
  private list: HTMLElement;
  private cleanups: (() => void)[] = [];

  constructor(private ctx: ScreenCtx, parent: HTMLElement, private onClose: () => void) {
    const t = ctx.t;
    this.el = h('div', 'm-p2p-panel', parent);
    this.el.setAttribute('role', 'dialog');
    this.el.setAttribute('aria-modal', 'true');
    this.el.hidden = true;
    const panel = h('div', 'm-p2p-panel-box', this.el);
    const head = h('div', 'm-p2p-panel-head', panel);
    this.title = h('h2', 'm-h2', head);
    this.title.id = 'p2p-panel-title';
    this.el.setAttribute('aria-labelledby', this.title.id);
    this.code = h('p', 'apx-num m-p2p-display', head);
    this.notice = h('p', 'm-body m-p2p-privacy', panel);
    const newInvite = button(ctx, panel, { id: 'p2p.newInvite', label: () => t('p2p.newInvite'), primary: true,
      disabled: () => !canInvite(this.model().slots, P2P_MAX_PLAYERS), activate: () => {
        this.copyState = 'copyInvite'; this.linkState = 'copyLink';
        void p2p().newInvite().then(() => {
          const s = this.model().slots.at(-1);
          if (s) this.selected = s.n;
          this.render();
        });
      } });
    const slot = selectRow<number>(ctx, panel, { id: 'p2p.slot', label: () => t('p2p.slot'),
      options: () => {
        const slots = this.model().slots;
        return slots.length ? slots.map((s) => ({ v: s.n, label: () => t('p2p.slotValue', { n: s.n }) })) : [{ v: 0, label: () => t('p2p.slotNone') }];
      },
      get: () => this.slot()?.n ?? 0, set: (n) => { this.selected = n; this.copyState = 'copyInvite'; this.linkState = 'copyLink'; this.answer.value = ''; this.render(); },
      disabled: () => this.model().slots.length < 2 });
    this.status = h('p', 'm-body m-p2p-status', panel);
    this.status.setAttribute('role', 'status');
    const inviteWrap = h('div', 'm-net-field m-p2p-code', panel);
    this.inviteLabel = h('label', 'm-meta', inviteWrap);
    this.inviteText = h('textarea', 'm-net-input m-p2p-text', inviteWrap);
    this.inviteText.id = 'p2p-invite-out';
    this.inviteText.readOnly = true;
    this.inviteText.rows = 3;
    this.inviteText.spellcheck = false;
    this.inviteLabel.htmlFor = this.inviteText.id;
    const waiting = (): boolean => !!this.slot()?.invite && this.slot()?.state === 'waiting';
    // One tap: the invite as a link (the code sits in the URL fragment, which never reaches a server), straight into a message.
    const whatsApp = button(ctx, inviteWrap, { id: 'p2p.sendWhatsApp', label: () => t('p2p.sendWhatsApp'), primary: true,
      disabled: () => !waiting(), activate: () => this.sendMessage() });
    const copyLink = button(ctx, inviteWrap, { id: 'p2p.copyLink', label: () => t(`p2p.${this.linkState}`),
      disabled: () => !waiting(), activate: () => void this.copyLink() });
    const copy = button(ctx, inviteWrap, { id: 'p2p.copyInvite', label: () => t(`p2p.${this.copyState}`),
      disabled: () => !this.slot()?.invite || this.slot()?.state !== 'waiting', activate: () => void this.copy() });
    // Mobile: share sheet for the invite, a paste button for the answer (touch UI only; desktop keeps its focus order).
    const share: Ctl[] = touchUi(ctx) && canShare() ? [button(ctx, inviteWrap, { id: 'p2p.shareInvite', label: () => t('touch.online.share'),
      disabled: () => !this.slot()?.invite || this.slot()?.state !== 'waiting',
      activate: () => { const s = this.slot(); if (s?.invite) void shareText(this.link(s.invite)); } })] : [];
    const answerWrap = h('div', 'm-net-field m-p2p-code', panel);
    this.answerLabel = h('label', 'm-meta', answerWrap);
    this.answer = h('textarea', 'm-net-input m-p2p-text', answerWrap);
    this.answer.id = 'p2p-answer-in';
    this.answer.rows = 3;
    this.answer.spellcheck = false;
    this.answer.dataset.focusId = 'p2p.answer';
    this.answerLabel.htmlFor = this.answer.id;
    const answerCtl: Ctl = { id: 'p2p.answer', el: this.answer, render() {}, disabled: () => this.slot()?.state !== 'waiting',
      activate: () => this.answer.focus() };
    const paste: Ctl[] = touchUi(ctx) ? [button(ctx, answerWrap, { id: 'p2p.pasteAnswer', label: () => t('touch.online.paste'),
      disabled: () => this.slot()?.state !== 'waiting',
      activate: () => void pasteText().then((s) => { if (!s) return; this.answer.value = s; onPaste(); this.render(); }) })] : [];
    const connect = button(ctx, answerWrap, { id: 'p2p.connect', label: () => t('p2p.connect'), primary: true,
      disabled: () => this.slot()?.state !== 'waiting' || !this.answer.value.trim(), activate: () => this.connect() });
    // Paste-detect: an answer code pasted into the field connects at once.
    const onPaste = (): void => { setTimeout(() => { if (this.answer.value.trim().startsWith('HP1A.')) this.connect(); }, 0); };
    const onInput = (): void => this.render();
    const onKey = (e: KeyboardEvent): void => {
      if (e.code === 'Escape') { e.preventDefault(); e.stopPropagation(); this.close(); }
      else if (e.code === 'ArrowDown' || e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'ArrowUp') {
        e.preventDefault(); e.stopPropagation();
        // Focus moves through the lobby's list (it owns the FocusList).
        this.move?.(e.code === 'ArrowUp' ? -1 : 1);
      }
    };
    this.answer.addEventListener('paste', onPaste);
    this.answer.addEventListener('input', onInput);
    this.answer.addEventListener('keydown', onKey);
    this.cleanups.push(() => {
      this.answer.removeEventListener('paste', onPaste);
      this.answer.removeEventListener('input', onInput);
      this.answer.removeEventListener('keydown', onKey);
    });
    const cancel = button(ctx, panel, { id: 'p2p.cancelSlot', label: () => t('p2p.cancelSlot'),
      disabled: () => { const s = this.slot(); return !s || s.state === 'connected' || s.state === 'closed'; },
      activate: () => { const s = this.slot(); if (s) p2p().cancelSlot(s.n); this.render(); } });
    this.list = h('ul', 'm-p2p-slots', panel);
    const back = button(ctx, panel, { id: 'p2p.close', label: () => t('online.back'), activate: () => this.close() });
    this.controls = [newInvite, slot, whatsApp, copyLink, copy, ...share, answerCtl, ...paste, connect, cancel, back];
  }

  /** Set by the lobby: moves its focus list (the answer field's arrow keys). */
  move: ((d: number) => void) | null = null;

  private model(): Readonly<P2PModel> {
    return p2p().store.get();
  }

  private slot(): P2PSlot | undefined {
    const slots = this.model().slots;
    return slots.find((s) => s.n === this.selected) ?? slots.at(-1);
  }

  private connect(): void {
    const s = this.slot();
    if (!s || s.state !== 'waiting' || !this.answer.value.trim()) return;
    void p2p().acceptAnswer(s.n, this.answer.value).then(() => {
      if (this.slot()?.state !== 'waiting') this.answer.value = '';
      this.render();
    });
  }

  private link(invite: string): string {
    return buildInviteLink(invite);
  }

  /** wa.me opens WhatsApp (phone app, WhatsApp Web or desktop app) with the message prefilled; the link only, never the raw code. */
  private sendMessage(): void {
    const s = this.slot();
    if (!s?.invite) return;
    window.open(whatsAppUrl(this.ctx.t('p2p.whatsAppInvite', { link: this.link(s.invite) })), '_blank', 'noopener');
  }

  private async copyLink(): Promise<void> {
    const s = this.slot();
    if (!s?.invite) return;
    this.linkState = (await copyText(this.link(s.invite), this.inviteText)) ? 'copyLinkDone' : 'copyFailed';
    this.render();
  }

  private async copy(): Promise<void> {
    const s = this.slot();
    if (!s?.invite) return;
    this.copyState = (await copyText(s.invite, this.inviteText)) ? 'copied' : 'copyFailed';
    this.render();
  }

  open(): void {
    this.isOpen = true;
    this.el.hidden = false;
    this.copyState = 'copyInvite'; this.linkState = 'copyLink';
    this.render();
  }

  close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.el.hidden = true;
    this.onClose();
  }

  /** The answer field is being typed in (the lobby leaves keys to it). */
  editing(): boolean {
    return this.isOpen && document.activeElement === this.answer;
  }

  render(): void {
    const t = this.ctx.t;
    const m = this.model();
    const s = this.slot();
    this.title.textContent = t('p2p.guests');
    this.code.textContent = m.display;
    this.notice.textContent = t('p2p.privacy');
    this.status.textContent = !s ? t('p2p.slotNone')
      : `${t('p2p.slotValue', { n: s.n })} · ${s.error ? t(`p2p.error.${s.error}`, { detail: codeDiag.last }) : t(`p2p.slotState.${s.state}`, { ping: s.pingMs })}`;
    this.inviteLabel.textContent = t('p2p.invite');
    const invite = s?.state === 'waiting' ? s.invite : '';
    if (this.inviteText.value !== invite) this.inviteText.value = invite;
    this.answerLabel.textContent = t('p2p.answerIn');
    this.answer.placeholder = t('p2p.answerInHint');
    this.list.replaceChildren(...m.slots.map((x) => {
      const li = h('li', `m-p2p-slot is-${x.state}`);
      li.textContent = `${t('p2p.slotValue', { n: x.n })} · ${x.error ? t(`p2p.error.${x.error}`, { detail: codeDiag.last }) : t(`p2p.slotState.${x.state}`, { ping: x.pingMs })}`;
      return li;
    }));
    for (const c of this.controls) c.render();
  }

  dispose(): void {
    for (const c of this.cleanups) c();
    this.cleanups = [];
  }
}
