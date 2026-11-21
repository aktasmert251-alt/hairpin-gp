import type { NetRoomListing } from '../../contracts/net';
import type { ActionId } from '../../contracts/input';
import type { ScreenId } from '../../contracts/ui';
import { RACE_TRACK_INFO } from '../../data/tracks';
import { button, selectRow, type Ctl } from '../controls';
import { h } from '../dom';
import { bottomBar, header, langIndicator, ListScreen } from './base';
import type { ScreenCtx } from './ctx';
import { clampRoomSettings, codeInput, onlineIdentity, validCode, validServer } from './onlineLogic';
import { MOBILE_AI } from './raceSetup';
import { MAX_CODE_CHARS, buildAnswerLink, codeDiag, P2P_GUEST_URL, P2P_HOST_URL, p2p, takePendingInvite, whatsAppUrl } from '../../net/index';

/** D-064: how this player goes online: the game server, hosting a room in this tab, or joining a host's room by invite code. */
type ConnMode = 'server' | 'host' | 'join';

/** Copies text; on failure selects it in `el` so the player can copy by hand. */
export async function copyText(text: string, el: HTMLElement): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    if (el instanceof HTMLTextAreaElement) el.select();
    else {
      const range = document.createRange(); range.selectNodeContents(el);
      const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range);
    }
    return false;
  }
}

/** Mobile (2026-11-21): system share sheet when there is one (phones); false = not shared (no API, cancelled). */
export async function shareText(text: string): Promise<boolean> {
  const nav = navigator as Navigator & { share?(d: { text: string }): Promise<void> };
  if (typeof nav.share !== 'function') return false;
  try {
    await nav.share({ text });
    return true;
  } catch {
    return false;
  }
}

/** Mobile: clipboard text for a paste button ('' when the API is missing or permission is refused). */
export async function pasteText(): Promise<string> {
  try {
    return (await navigator.clipboard.readText()).trim();
  } catch {
    return '';
  }
}

/** Share / paste buttons only on a touch UI (desktop keeps its focus order and keyboard paste). */
export function touchUi(ctx: ScreenCtx): boolean {
  return ctx.deps.touch?.uiTouch() === true;
}

export function canShare(): boolean {
  return typeof (navigator as Navigator & { share?: unknown }).share === 'function';
}

/** Shared plain-text notice and removal dialog for both online menus. */
export class NetFeedback {
  readonly notice: HTMLElement;
  readonly dialog: HTMLElement;
  readonly back: Ctl;
  private title: HTMLElement;
  private detail: HTMLElement;
  private until: HTMLElement;
  constructor(private ctx: ScreenCtx, parent: HTMLElement, id: string) {
    this.notice = h('aside', 'm-net-notice', parent);
    this.notice.setAttribute('role', 'status');
    this.dialog = h('div', 'm-net-removal', parent);
    this.dialog.setAttribute('role', 'alertdialog');
    this.dialog.setAttribute('aria-modal', 'true');
    const panel = h('div', 'm-net-removal-panel', this.dialog);
    this.title = h('h2', 'm-h2', panel);
    this.title.id = `${id}-removal-title`;
    this.dialog.setAttribute('aria-labelledby', this.title.id);
    this.detail = h('p', 'm-body', panel);
    this.detail.id = `${id}-removal-detail`;
    this.dialog.setAttribute('aria-describedby', this.detail.id);
    this.until = h('p', 'm-body', panel);
    this.back = button(ctx, panel, { id: `${id}.removed.back`, label: () => ctx.t('online.backOnline'), activate: () => {
      ctx.deps.net?.set({ kicked: null, room: null, myId: null, t0ServerMs: null, status: 'offline', error: null });
      ctx.go('online');
    } });
    this.notice.hidden = true;
    this.dialog.hidden = true;
  }
  render(): boolean {
    const m = this.ctx.deps.net?.get();
    this.notice.hidden = !m?.notice;
    this.notice.textContent = m?.notice ?? '';
    const kicked = m?.kicked;
    this.dialog.hidden = !kicked;
    if (!kicked) return false;
    this.title.textContent = this.ctx.t(`net.${kicked.reason}.title`);
    this.detail.textContent = this.ctx.t(`net.${kicked.reason}.detail`);
    this.until.hidden = kicked.reason !== 'banned' || kicked.until === null;
    this.until.textContent = kicked.until === null ? '' : this.ctx.t('net.banned.until', {
      until: new Date(kicked.until).toLocaleString(this.ctx.lang() === 'tr' ? 'tr-TR' : 'en-GB'),
    });
    this.back.render();
    return true;
  }
}

export class Online extends ListScreen {
  private col: HTMLElement;
  private directory: HTMLElement;
  private roomRows: HTMLElement;
  private roomHeading: HTMLElement;
  private roomEmpty: HTMLElement;
  private roomControls = new Map<string, Ctl>();
  private visibility: 'public' | 'private' = 'public';
  private feedback: NetFeedback;
  private savedControls: Ctl[] | null = null;
  private title: HTMLElement;
  private description: HTMLElement;
  private message: HTMLElement;
  private fields: { input: HTMLInputElement | HTMLTextAreaElement; label: HTMLElement; hint: HTMLElement; key: string; hintKey: string }[] = [];
  private nameInput!: HTMLInputElement;
  // D-064 host-in-browser
  private connMode: ConnMode = 'server';
  private modeHint!: HTMLElement;
  private privacy!: HTMLElement;
  private phoneHost: HTMLElement | null = null;
  private invite!: HTMLTextAreaElement;
  private answerWrap!: HTMLElement;
  private answerLabel!: HTMLLabelElement;
  private answerText!: HTMLTextAreaElement;
  private answerCopy: 'copyAnswer' | 'copied' | 'copyFailed' = 'copyAnswer';
  private p2pUnsub: (() => void) | null = null;
  private answering = false;
  /** An invite link filled the field: the answer code is made as soon as the nickname is valid. */
  private autoAnswer = false;
  private linked = false;
  private serverOnly: HTMLElement[] = [];
  private p2pOnly: { el: HTMLElement; modes: ConnMode[] }[] = [];
  private code!: HTMLInputElement;
  private server!: HTMLInputElement;
  private advanced = false;
  private serverWrap!: HTMLElement;
  private cleanups: (() => void)[] = [];
  private unsub: (() => void) | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private pollingPaused = false;
  private renderHead: () => void;
  private renderLang: () => void;
  private renderBar: () => void;

  constructor(ctx: ScreenCtx) {
    super('online', ctx);
    this.wideScrim = true;
    const hd = header(ctx, this.st);
    this.renderHead = hd.render;
    this.renderLang = langIndicator(ctx, hd.right);
    this.col = h('div', 'm-online', this.st);
    this.title = h('h1', 'm-h1', this.col);
    this.description = h('p', 'm-body', this.col);
    // D-064: connection mode (server / host in this tab / join by invite code).
    const p2pParam = new URLSearchParams(location.search).get('p2p');
    // Static hosting (GitHub Pages build sets VITE_STATIC_HOST=1) has no game server behind the page: default to hosting a room.
    this.connMode = p2pParam === 'host' || p2pParam === 'join' ? p2pParam : import.meta.env.VITE_STATIC_HOST === '1' ? 'host' : 'server';
    const mode = selectRow<ConnMode>(ctx, this.col, { id: 'online.connMode', label: () => ctx.t('p2p.connMode'),
      options: () => (['server', 'host', 'join'] as const).map((v) => ({ v, label: () => ctx.t(`p2p.connModeValue.${v}`) })),
      get: () => this.connMode, set: (v) => { this.connMode = v; this.render(); } });
    this.modeHint = h('p', 'm-body m-p2p-hint', this.col);
    const name = this.field('online.name', 'online.name', 'online.nameHint', 64);
    this.nameInput = name.el as HTMLInputElement;
    this.nameInput.value = new URLSearchParams(location.search).get('name') ?? '';
    // Invite link: the nickname is committed (Enter / next field / keyboard "done") -> the answer code is made.
    const onName = (): void => this.maybeAutoAnswer();
    this.nameInput.addEventListener('change', onName);
    this.cleanups.push(() => this.nameInput.removeEventListener('change', onName));
    this.privacy = h('p', 'm-body m-p2p-privacy', this.col);
    this.privacy.setAttribute('role', 'note');
    this.p2pOnly.push({ el: this.privacy, modes: ['host', 'join'] });
    const hostStart = button(ctx, this.col, { id: 'online.hostStart', label: () => ctx.t('p2p.hostStart'), primary: true,
      disabled: () => this.connMode !== 'host' || !this.validP2P(), activate: () => this.hostRoom() });
    this.p2pOnly.push({ el: hostStart.el, modes: ['host'] });
    const invite = this.field('online.invite', 'p2p.invite', p2p().store.get().relay ? 'p2p.inviteHintRelay' : 'p2p.inviteHint', MAX_CODE_CHARS, true);
    this.invite = invite.el as HTMLTextAreaElement;
    invite.disabled = () => this.connMode !== 'join';
    this.p2pOnly.push({ el: this.invite.parentElement!, modes: ['join'] });
    const onPaste = (): void => {
      // Paste-detect: a full invite pasted with a valid nickname answers at once.
      setTimeout(() => { if (this.invite.value.trim().startsWith('HP1I.') && this.validP2P()) void this.answerInvite(); }, 0);
    };
    this.invite.addEventListener('paste', onPaste);
    this.cleanups.push(() => this.invite.removeEventListener('paste', onPaste));
    // Mobile: a big paste button (long-press paste on a small field is fiddly) and the phone-host warning.
    const mobile: Ctl[] = [];
    if (touchUi(ctx)) {
      const paste = button(ctx, this.col, { id: 'online.pasteInvite', label: () => ctx.t('touch.online.paste'),
        disabled: () => this.connMode !== 'join', activate: () => void pasteText().then((s) => {
          if (!s) return;
          this.invite.value = s.slice(0, MAX_CODE_CHARS);
          onPaste();
          this.render();
        }) });
      this.p2pOnly.push({ el: paste.el, modes: ['join'] });
      mobile.push(paste);
    }
    if (ctx.deps.touch?.profile().mobile) {
      const warn = h('p', 'm-body m-p2p-privacy m-phone-host', this.col);
      warn.setAttribute('role', 'note');
      this.p2pOnly.push({ el: warn, modes: ['host'] });
      this.phoneHost = warn;
    }
    const makeAnswer = button(ctx, this.col, { id: 'online.makeAnswer', label: () => ctx.t('p2p.makeAnswer'), primary: true,
      disabled: () => this.connMode !== 'join' || this.answering || !this.validP2P() || !this.invite.value.trim(), activate: () => void this.answerInvite() });
    this.p2pOnly.push({ el: makeAnswer.el, modes: ['join'] });
    // The answer code sits in the right column (free in the p2p modes), so the left column keeps its height.
    this.answerWrap = h('div', 'm-net-field m-p2p-code m-p2p-side', this.st);
    this.answerLabel = h('label', 'm-meta', this.answerWrap);
    this.answerText = h('textarea', 'm-net-input m-p2p-text', this.answerWrap);
    this.answerText.readOnly = true;
    this.answerText.id = 'online-answer';
    this.answerText.rows = 3;
    this.answerText.spellcheck = false;
    this.answerLabel.htmlFor = this.answerText.id;
    const copyAnswer = button(ctx, this.answerWrap, { id: 'online.copyAnswer', label: () => ctx.t(`p2p.${this.answerCopy}`),
      disabled: () => this.connMode !== 'join' || !p2p().store.get().guest.answer, activate: () => void this.copyAnswer() });
    const shareAnswer: Ctl[] = touchUi(ctx) && canShare() ? [button(ctx, this.answerWrap, { id: 'online.shareAnswer', label: () => ctx.t('touch.online.share'),
      disabled: () => this.connMode !== 'join' || !p2p().store.get().guest.answer,
      activate: () => { const a = p2p().store.get().guest.answer; if (a) void shareText(`${ctx.t('p2p.whatsAppAnswerLink', { link: buildAnswerLink(a) })}`); } })] : [];
    // One tap: the answer code on its own line in a message to the host (wa.me opens WhatsApp / WhatsApp Web with the text prefilled).
    const sendAnswer = button(ctx, this.answerWrap, { id: 'online.sendAnswer', label: () => ctx.t('p2p.sendWhatsApp'), primary: true,
      disabled: () => this.connMode !== 'join' || !p2p().store.get().guest.answer, activate: () => this.sendAnswerMessage() });
    const visibility = selectRow<'public' | 'private'>(ctx, this.col, { id: 'online.visibility', label: () => ctx.t('online.visibility'),
      options: () => (['public', 'private'] as const).map((v) => ({ v, label: () => ctx.t(`online.visibilityValue.${v}`) })),
      get: () => this.visibility, set: (v) => { this.visibility = v; this.render(); } });
    const create = button(ctx, this.col, { id: 'online.create', label: () => ctx.t('online.create'), primary: true,
      disabled: () => !this.valid(false), activate: () => this.connect(false) });
    const code = this.field('online.code', 'online.code', 'online.codeHint', 5);
    this.code = code.el as HTMLInputElement;
    this.code.value = codeInput(new URLSearchParams(location.search).get('room') ?? '');
    this.code.spellcheck = false;
    const join = button(ctx, this.col, { id: 'online.join', label: () => ctx.t('online.join'),
      disabled: () => !this.valid(true), activate: () => this.connect(true) });
    code.disabled = () => this.connMode !== 'server';
    this.serverOnly.push(visibility.el, create.el, this.code.parentElement!, join.el);
    const advanced = button(ctx, this.col, { id: 'online.advanced', label: () => ctx.t('online.advanced'), activate: () => {
      this.advanced = !this.advanced;
      this.render();
      if (this.advanced) this.focus.set(this.ctls.findIndex((c) => c.id === 'online.server'));
    } });
    advanced.el.setAttribute('aria-controls', 'online-server-field');
    const server = this.field('online.server', 'online.server', 'online.serverHint', 256);
    this.server = server.el as HTMLInputElement;
    this.server.value = new URLSearchParams(location.search).get('server') ?? '';
    this.advanced = !!this.server.value;
    this.server.spellcheck = false;
    this.serverWrap = this.server.parentElement!;
    this.serverWrap.id = 'online-server-field';
    server.disabled = () => !this.advanced;
    const back = button(ctx, this.col, { id: 'online.back', label: () => ctx.t('online.back'), activate: () => this.back() });
    this.directory = h('div', 'm-room-directory', this.st);
    const directoryHead = h('div', 'm-room-directory-head', this.directory);
    this.roomHeading = h('h2', 'm-h2', directoryHead);
    const quickJoin = button(ctx, directoryHead, { id: 'online.quickJoin', label: () => ctx.t('online.quickJoin'),
      disabled: () => !this.valid(false), activate: () => {
        if (!this.valid(false) || ctx.deps.net?.get().kicked) return;
        this.pollingPaused = false;
        const server = this.server.value.trim();
        ctx.dispatch({ type: 'onlineQuickJoin', name: onlineIdentity(this.nameInput.value)!.name, ...(server ? { server } : {}) });
      } });
    this.serverOnly.push(advanced.el, this.directory);
    for (const c of [visibility, create, join, quickJoin, advanced]) {
      const own = c.disabled;
      c.disabled = () => this.connMode !== 'server' || !!own?.();
    }
    server.disabled = () => this.connMode !== 'server' || !this.advanced;
    this.focus.dispose(); this.setControls([mode, name, hostStart, invite, ...mobile, makeAnswer, sendAnswer, copyAnswer, ...shareAnswer, visibility, create, code, join, quickJoin, advanced, server, back]);
    this.roomRows = h('div', 'm-room-rows', this.directory);
    this.roomEmpty = h('p', 'm-body m-room-empty', this.directory);
    this.message = h('p', 'm-body m-net-message', this.col);
    this.message.setAttribute('role', 'status');
    this.feedback = new NetFeedback(ctx, this.st, 'online');
    this.renderBar = bottomBar(ctx, this.st, ['move', 'select', 'back']);
    const tab = (e: KeyboardEvent): void => {
      if (e.code !== 'Tab' || e.ctrlKey || e.altKey || e.metaKey || !ctx.live('online')) return;
      e.preventDefault(); e.stopPropagation(); this.focus.move(e.shiftKey ? -1 : 1);
    };
    this.el.addEventListener('keydown', tab);
    this.cleanups.push(() => this.el.removeEventListener('keydown', tab));
  }

  private field(id: string, key: string, hintKey: string, maxLength: number, multiline = false): Ctl {
    const wrap = h('div', 'm-net-field', this.col);
    const label = h('label', 'm-meta', wrap);
    let input: HTMLInputElement | HTMLTextAreaElement;
    if (multiline) {
      input = h('textarea', 'm-net-input m-p2p-text', wrap);
      input.rows = 3;
      input.spellcheck = false;
    } else {
      input = h('input', 'm-net-input', wrap);
      input.type = 'text';
    }
    input.id = id;
    input.dataset.focusId = id;
    input.maxLength = maxLength;
    input.autocomplete = 'off';
    label.htmlFor = id;
    const hint = h('p', 'm-body', wrap);
    hint.id = `${id}-hint`;
    input.setAttribute('aria-describedby', hint.id);
    this.fields.push({ input, label, hint, key, hintKey });
    const change = (): void => {
      if (id === 'online.code') input.value = codeInput(input.value);
      this.render();
    };
    input.addEventListener('input', change);
    this.cleanups.push(() => input.removeEventListener('input', change));
    const focus = (): void => {
      const i = this.ctls.findIndex((c) => c.el === input);
      if (i >= 0) this.focus.set(i, false);
    };
    const onFieldKey = (e: KeyboardEvent): void => {
      if (e.ctrlKey || e.altKey || e.metaKey || e.isComposing || !this.ctx.live('online')) return;
      const action = e.code === 'ArrowUp' ? 'menuUp' : e.code === 'ArrowDown' || e.code === 'Enter' || e.code === 'NumpadEnter' ? 'menuDown' : null;
      if (!action && e.code !== 'Escape') return;
      e.preventDefault(); e.stopPropagation();
      if (action) this.action(action); else this.back();
    };
    const el: HTMLElement = input;
    el.addEventListener('focus', focus);
    el.addEventListener('keydown', onFieldKey);
    this.cleanups.push(() => { el.removeEventListener('focus', focus); el.removeEventListener('keydown', onFieldKey); });
    return { id, el: input, render() {}, activate: () => this.focus.move(1) };
  }

  /** D-064: host / join by invite need a nickname and WebRTC; the server address field does not apply. */
  private validP2P(): boolean {
    const status = this.ctx.deps.net?.get().status;
    return !!this.ctx.deps.net && status !== 'connecting' && status !== 'reconnecting' && !!onlineIdentity(this.nameInput.value) && p2p().supported();
  }

  private hostRoom(): void {
    if (this.connMode !== 'host' || !this.validP2P()) return;
    const setup = this.ctx.deps.setup.get();
    this.ctx.dispatch({ type: 'onlineCreate', name: onlineIdentity(this.nameInput.value)!.name, server: P2P_HOST_URL, settings: clampRoomSettings({
      // Mobile: a phone host runs the room and its AI in this tab, so it starts with fewer AI.
      visibility: 'private', trackId: setup.trackId, laps: 5, tod: setup.tod, weather: setup.weather, aiCount: this.ctx.deps.touch?.profile().mobile ? MOBILE_AI : 19, difficulty: setup.difficulty,
    }, 1) });
  }

  private async answerInvite(): Promise<void> {
    if (this.answering || this.connMode !== 'join' || !this.validP2P()) return;
    this.answering = true;
    this.answerCopy = 'copyAnswer';
    this.render();
    try {
      const room = await p2p().joinInvite(this.invite.value);
      if (room) this.ctx.dispatch({ type: 'onlineJoin', name: onlineIdentity(this.nameInput.value)!.name, code: room, server: P2P_GUEST_URL });
    } finally {
      this.answering = false;
      this.render();
    }
  }

  private sendAnswerMessage(): void {
    const code = p2p().store.get().guest.answer;
    if (!code) return;
    window.open(whatsAppUrl(`${this.ctx.t('p2p.whatsAppAnswerLink', { link: buildAnswerLink(code) })}`), '_blank', 'noopener');
  }

  private maybeAutoAnswer(): void {
    if (!this.autoAnswer || this.connMode !== 'join' || !this.invite.value.trim() || !this.validP2P()) return;
    this.autoAnswer = false;
    void this.answerInvite();
  }

  /** An invite link opened this page: join mode with the invite filled in (the nickname is still asked for). */
  private takeLinkInvite(): void {
    const code = takePendingInvite();
    if (!code) return;
    this.connMode = 'join';
    this.invite.value = code.slice(0, MAX_CODE_CHARS);
    this.autoAnswer = true;
    this.linked = true;
  }

  private async copyAnswer(): Promise<void> {
    const code = p2p().store.get().guest.answer;
    if (!code) return;
    this.answerCopy = (await copyText(code, this.answerText)) ? 'copied' : 'copyFailed';
    this.render();
  }

  private valid(join: boolean): boolean {
    const status = this.ctx.deps.net?.get().status;
    return this.connMode === 'server' && !!this.ctx.deps.net && status !== 'connecting' && status !== 'reconnecting'
      && !!onlineIdentity(this.nameInput.value, join ? this.code.value : undefined)
      && validServer(this.server.value, location.protocol === 'https:');
  }

  private connect(join: boolean): void {
    if (!this.valid(join)) return;
    this.pollingPaused = false;
    const identity = onlineIdentity(this.nameInput.value, join ? this.code.value : undefined)!;
    const server = this.server.value.trim();
    if (join) this.ctx.dispatch({ type: 'onlineJoin', name: identity.name, code: identity.code!, ...(server ? { server } : {}) });
    else {
      const setup = this.ctx.deps.setup.get();
      this.ctx.dispatch({ type: 'onlineCreate', name: identity.name, settings: clampRoomSettings({
        visibility: this.visibility, trackId: setup.trackId, laps: 5, tod: setup.tod, weather: setup.weather, aiCount: 19, difficulty: setup.difficulty,
      }, 1), ...(server ? { server } : {}) });
    }
  }

  private drawRooms(): void {
    const rooms = this.ctx.deps.net?.get().rooms ?? [];
    const focused = (this.focus.current() as Ctl | null)?.id;
    let changed = false;
    for (const [code, ctl] of this.roomControls) {
      if (!rooms.some((r) => r.code === code)) { ctl.el.remove(); this.roomControls.delete(code); changed = true; }
    }
    for (const room of rooms) {
      let ctl = this.roomControls.get(room.code);
      if (!ctl) {
        const code = room.code;
        const current = (): NetRoomListing | undefined => this.ctx.deps.net?.get().rooms?.find((r) => r.code === code);
        ctl = button(this.ctx, this.roomRows, { id: `online.room.${code}`, label: () => {
          const r = current();
          return r ? this.ctx.t(RACE_TRACK_INFO[r.track].nameKey) : '';
        }, disabled: () => {
          const r = current(); return !r || r.state !== 'lobby' || r.humans >= r.capacity || !this.valid(false);
        }, activate: () => {
          if (!this.valid(false)) return;
          this.pollingPaused = false;
          const server = this.server.value.trim();
          this.ctx.dispatch({ type: 'onlineJoin', name: onlineIdentity(this.nameInput.value)!.name, code, ...(server ? { server } : {}) });
        } });
        ctl.el.classList.add('m-room-row');
        const rowElement = ctl.el;
        ctl.onFocus = () => rowElement.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        h('span', 'm-room-detail', ctl.el);
        h('span', 'm-room-state m-meta', ctl.el);
        this.roomControls.set(code, ctl); changed = true;
      }
      const index = rooms.indexOf(room);
      if (this.roomRows.children[index] !== ctl.el) {
        this.roomRows.insertBefore(ctl.el, this.roomRows.children[index] ?? null); changed = true;
      }
      ctl.render();
      ctl.el.querySelector('.m-room-detail')!.textContent = [
        this.ctx.t('menu.race.lapsValue', { n: room.laps }),
        this.ctx.t(`menu.race.weatherValue.${room.weather}`), this.ctx.t(`menu.race.todValue.${room.tod}`), room.owner,
        // D-061: the race mode badge (Kasap = no rules).
        this.ctx.t(`online.modeValue.${room.mode ?? 'normal'}`),
      ].join(' · ');
      ctl.el.querySelector('.m-room-state')!.textContent = `${room.humans}/${room.capacity} · ${this.ctx.t(`online.roomState.${room.state}`)}`;
    }
    this.roomHeading.textContent = this.ctx.t('online.rooms');
    this.roomEmpty.hidden = rooms.length > 0;
    this.roomEmpty.textContent = this.ctx.t(this.ctx.deps.net?.get().status === 'online' ? 'online.noRooms' : 'online.directoryHint');
    if (changed) {
      const controls = this.ctls.filter((c) => !c.id.startsWith('online.room.'));
      const at = controls.findIndex((c) => c.id === 'online.advanced');
      controls.splice(at, 0, ...rooms.map((r) => this.roomControls.get(r.code)!));
      this.focus.dispose(); this.setControls(controls);
      if (focused) this.focus.set(Math.max(0, controls.findIndex((c) => c.id === focused)), false);
    }
  }

  override action(a: ActionId): void {
    if (this.ctx.deps.net?.get().kicked) { if (a === 'menuConfirm') this.feedback.back.activate?.(); return; }
    super.action(a);
  }

  protected back(): void { this.ctx.go('mainMenu'); }
  animated(): HTMLElement[] { return [this.col, this.directory]; }

  override key(code: string): boolean {
    const editing = this.fields.some((f) => f.input === document.activeElement);
    return editing ? false : super.key(code);
  }

  private pollRooms(): void {
    const net = this.ctx.deps.net?.get();
    if (this.pollTimer === null || this.pollingPaused || this.connMode !== 'server' || !this.valid(false) || !net || net.kicked || net.room || net.status === 'error') return;
    const server = this.server.value.trim();
    this.ctx.dispatch({ type: 'onlineListRooms', name: onlineIdentity(this.nameInput.value)!.name, ...(server ? { server } : {}) });
  }

  private stopPolling(): void {
    if (this.pollTimer !== null) clearInterval(this.pollTimer);
    this.pollTimer = null;
  }

  override enter(from: ScreenId | null): void {
    this.stopPolling();
    this.unsub?.();
    this.unsub = this.ctx.deps.net?.subscribe(() => this.render()) ?? null;
    this.p2pUnsub?.();
    this.p2pUnsub = p2p().store.subscribe(() => this.render());
    this.takeLinkInvite();
    super.enter(from);
    if (this.linked) this.focus.set(this.ctls.findIndex((c) => c.id === 'online.name'));
    this.maybeAutoAnswer();
    this.pollTimer = setInterval(() => this.pollRooms(), 3000);
    this.pollRooms();
  }
  override leave(): void { super.leave(); this.stopPolling(); this.unsub?.(); this.unsub = null; this.p2pUnsub?.(); this.p2pUnsub = null; }

  override render(): void {
    const restored = this.savedControls;
    if (restored) { this.focus.dispose(); this.setControls(restored); this.savedControls = null; }
    super.render();
    this.renderHead(); this.renderLang(); this.renderBar();
    this.drawRooms();
    const removed = this.feedback.render();
    if (removed) this.pollingPaused = true;
    this.col.inert = removed; this.directory.inert = removed;
    if (removed && !this.savedControls) {
      this.savedControls = this.ctls;
      this.focus.dispose(); this.setControls([this.feedback.back]); this.focus.set(0, false);
    } else if (restored) this.focus.set(0, false);
    this.title.textContent = this.ctx.t('online.title');
    this.description.textContent = this.ctx.t('online.description');
    this.serverWrap.hidden = !this.advanced;
    this.el.querySelector('[data-focus-id="online.advanced"]')!.setAttribute('aria-expanded', String(this.advanced));
    for (const f of this.fields) {
      f.label.textContent = this.ctx.t(f.key);
      const invalid = f.input === this.invite ? false
        : f.input === this.nameInput ? !!f.input.value && !onlineIdentity(f.input.value)
        : f.input === this.code ? !!f.input.value && !validCode(f.input.value)
          : !validServer(f.input.value, location.protocol === 'https:');
      f.input.setAttribute('aria-invalid', String(invalid));
      f.hint.textContent = this.ctx.t(invalid ? (f.input === this.nameInput ? 'online.badName' : f.input === this.code ? 'online.badCode' : 'online.badServer') : f.hintKey);
    }
    const net = this.ctx.deps.net?.get();
    this.message.textContent = this.ctx.t(!net ? 'online.unavailable' : net.error ? `online.error.${net.error}` : `online.status.${net.status}`);
    this.renderP2P();
    this.focus.refreshDisabled();
    if (this.focus.current()?.disabled?.()) this.focus.set(this.focus.index, false);
  }

  /** D-064: mode-dependent parts, the privacy notice and the guest's answer code / status. */
  private renderP2P(): void {
    const t = this.ctx.t;
    const mode = this.connMode;
    const m = p2p().store.get();
    for (const el of this.serverOnly) el.hidden = mode !== 'server';
    for (const x of this.p2pOnly) x.el.hidden = !x.modes.includes(mode);
    this.modeHint.textContent = t(this.linked && mode === 'join' ? 'p2p.fromLink' : `p2p.modeHint.${mode}`);
    this.privacy.textContent = t(p2p().supported() ? 'p2p.privacy' : 'p2p.unsupported');
    if (this.phoneHost) this.phoneHost.textContent = t('touch.online.phoneHost');
    const guest = m.role === 'guest' || mode === 'join' ? m.guest : null;
    this.answerWrap.hidden = mode !== 'join' || !guest?.answer || m.hostLeft;
    this.answerLabel.textContent = t('p2p.answer');
    if (this.answerText.value !== (guest?.answer ?? '')) this.answerText.value = guest?.answer ?? '';
    if (mode === 'server') return;
    // The status line speaks for the p2p flow: host left > guest error / state > net status.
    const net = this.ctx.deps.net?.get();
    if (m.hostLeft) this.message.textContent = t('p2p.hostLeft');
    else if (mode === 'join' && guest && guest.state !== 'idle') this.message.textContent = guest.error ? t(`p2p.error.${guest.error}`, { detail: codeDiag.last }) : t(`p2p.guestState.${guest.state}`);
    else if (net?.error) this.message.textContent = t(`online.error.${net.error}`);
  }

  override dispose(): void {
    this.stopPolling();
    this.p2pUnsub?.();
    this.unsub?.();
    for (const cleanup of this.cleanups) cleanup();
    super.dispose();
  }
}
