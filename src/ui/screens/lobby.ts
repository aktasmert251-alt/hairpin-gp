import type { TimeOfDay, WeatherPreset } from '../../contracts/common';
import type { ActionId } from '../../contracts/input';
import type { NetLaps, NetLobbyModel, NetPlayerInfo, NetRoomSettings } from '../../contracts/net';
import type { RaceTrackId } from '../../contracts/track';
import type { ScreenId } from '../../contracts/ui';
import { RACE_TRACK_INFO } from '../../data/tracks';
import { availableRaceTracks } from '../../game/index';
import { button, selectRow, sliderRow, toggleRow, type Ctl } from '../controls';
import { h } from '../dom';
import { gsap } from '../motion/gsap';
import { bottomBar, header, langIndicator, ListScreen } from './base';
import type { ScreenCtx } from './ctx';
import { canStartLobby, carAvailable, clampRoomSettings, countdownNumber, lobbyTeamBase } from './onlineLogic';
import { NetFeedback } from './online';
import { driverOptions } from './teamRows';
import type { NetCustomTeam, NetRaceMode } from '../../contracts/net';
import type { TeamDef } from '../../contracts/data';
import { customTeamDef, parseCustomTeam, type CustomTeam } from '../../data/customTeams';
import { TEAMS } from '../../data/teams';
import { customTeamStore, newCustomTeamId } from '../customTeamStore';
import { CustomTeamFlow } from './customTeamFlow';
import { p2p } from '../../net/index';
import { P2PInvitePanel } from './p2pPanel';

export class Lobby extends ListScreen {
  private feedback: NetFeedback;
  private savedControls: Ctl[] | null = null;
  private visibilityBadge: HTMLElement;
  private title: HTMLElement;
  private codeText: HTMLElement;
  private codeLabel: HTMLElement;
  private roster: HTMLElement;
  private playerLabel: HTMLElement;
  private count: HTMLElement;
  private ai: HTMLElement;
  private carLabel: HTMLElement;
  private equalCars: HTMLElement;
  private settingsLabel: HTMLElement;
  private ownerNote: HTMLElement;
  private message: HTMLElement;
  private startHint: HTMLElement;
  private body: HTMLElement;
  private actions: HTMLElement;
  private overlayEl: HTMLElement;
  private countdownLabel: HTMLElement;
  private digit: HTMLElement;
  private copyState: 'copy' | 'copied' | 'copyFailed' = 'copy';
  private copySequence = 0;
  private unsub: (() => void) | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private locked = false;
  private alive = true;
  private renderHead: () => void;
  private renderLang: () => void;
  private renderBar: () => void;
  private emptySettings: NetRoomSettings;
  private playerControls = new Map<number, Ctl>();
  private modeHint!: HTMLElement;
  private customHint!: HTMLElement;
  private teamFlow!: CustomTeamFlow;
  /** The saved local team I last brought to the room (its room copy has a server id and may sit on another base car). */
  private sentLocalId: string | null = null;
  // D-064 host-in-browser: host notice / guest "host paused" banner and the host's invite panel.
  private p2pBanner!: HTMLElement;
  private panel!: P2PInvitePanel;
  private panelSaved: { ctls: Ctl[]; index: number } | null = null;
  private p2pUnsub: (() => void) | null = null;
  private warnTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(ctx: ScreenCtx) {
    super('lobby', ctx);
    this.backdrop = 'ink';
    const setup = ctx.deps.setup.get();
    this.emptySettings = { trackId: setup.trackId, laps: 5, weather: 'dry', tod: 'day', aiCount: 0, difficulty: 70, visibility: 'public' };
    const hd = header(ctx, this.st);
    this.renderHead = hd.render;
    this.renderLang = langIndicator(ctx, hd.right);
    const head = h('div', 'm-lobby-head', this.st);
    this.title = h('h1', 'm-h1', head);
    this.message = h('p', 'm-body m-net-message', head);
    this.message.setAttribute('role', 'status');
    this.p2pBanner = h('p', 'm-body m-p2p-banner', head);
    this.p2pBanner.setAttribute('role', 'status');
    this.p2pBanner.hidden = true;
    const code = h('div', 'm-room-code', this.st);
    this.codeLabel = h('p', 'm-meta', code);
    this.codeText = h('p', 'apx-num', code);
    // D-064: in a direct room without the pairing mailbox the 6-character code alone cannot bring a friend in (they need the
    // invite code / link), so this button opens the invite panel instead of copying the code.
    const inviteOnly = (): boolean => p2p().store.get().role === 'host' && !p2p().store.get().relay;
    const copy = button(ctx, code, { id: 'lobby.copy', label: () => (inviteOnly() ? ctx.t('p2p.inviteFriend') : ctx.t(`online.${this.copyState}`)),
      disabled: () => !this.model()?.room, activate: () => { if (inviteOnly()) this.openPanel(); else void this.copyCode(); } });
    this.body = h('div', 'm-lobby-body', this.st);
    const left = h('div', 'm-lobby-players', this.body);
    const rosterHead = h('div', 'm-lobby-section', left);
    this.playerLabel = h('h2', 'm-h2', rosterHead);
    this.count = h('span', 'm-meta apx-num', rosterHead);
    this.roster = h('div', 'm-player-grid', left);
    this.ai = h('p', 'm-body m-ai-summary apx-num', left);
    this.carLabel = h('h2', 'm-h2 m-car-heading', left);
    const carRows = h('div', 'm-lobby-car', left);
    this.equalCars = h('p', 'm-body m-equal-cars', carRows);
    const team = selectRow<string>(ctx, carRows, {
      id: 'lobby.team', label: () => ctx.t('online.team'),
      options: () => ctx.deps.teams.filter((t) => this.available(t.id, 0) || this.available(t.id, 1)).map((t) => ({ v: t.id, label: () => this.teamOf(t.id)?.name ?? t.name })),
      get: () => this.me()?.teamId ?? ctx.deps.teams[0]!.id,
      set: (teamId) => this.pickCar(teamId, this.available(teamId, 0) ? 0 : 1), disabled: () => !this.editable() || !this.me(),
    });
    team.el.querySelector('.val')!.setAttribute('lang', 'en');
    const driver = selectRow<0 | 1>(ctx, carRows, {
      id: 'lobby.driver', label: () => ctx.t('online.driver'),
      options: () => {
        const id = this.me()?.teamId;
        const selected = ctx.deps.teams.find((t) => t.id === id) ?? ctx.deps.teams[0]!;
        return driverOptions(selected, (idx) => this.available(selected.id, idx));
      },
      get: () => this.me()?.driverIdx ?? 0, set: (idx) => { const me = this.me(); if (me) this.pickCar(me.teamId, idx); },
      disabled: () => !this.editable() || !this.me(),
    });
    // D-062: custom team (online only): pick a saved team, create one or edit mine; it takes its base car's seats.
    const customRow = selectRow<string>(ctx, carRows, {
      id: 'lobby.customTeam', label: () => ctx.t('online.customTeam'),
      options: () => [{ v: '', label: () => ctx.t('online.customNone') }, ...customTeamStore().list().map((tm) => ({ v: tm.id, label: () => tm.name }))],
      get: () => this.myLocalTeamId(),
      set: (id) => { if (this.editable()) this.sendTeam(id ? customTeamStore().get(id) ?? null : null); },
      disabled: () => !this.editable() || !this.me(),
    });
    customRow.el.querySelector('.val')!.setAttribute('lang', 'en');
    const teamActions = h('div', 'm-team-actions', carRows);
    const createTeam = button(ctx, teamActions, { id: 'lobby.createTeam', label: () => ctx.t('teams.create'),
      disabled: () => !this.editable() || !this.me(), activate: () => this.openEditor(false) });
    const editTeam = button(ctx, teamActions, { id: 'lobby.editTeam', label: () => ctx.t('teams.edit'),
      disabled: () => !this.editable() || !this.myTeam(), activate: () => this.openEditor(true) });
    const manageTeams = button(ctx, teamActions, { id: 'lobby.manageTeams', label: () => ctx.t('teams.manage'),
      disabled: () => !this.editable() || !this.me(), activate: () => { if (this.editable()) { this.pinLocalTeam(); this.teamFlow.openList(); } } });
    this.customHint = h('p', 'm-body m-equal-cars', carRows);
    this.teamFlow = new CustomTeamFlow(ctx, this.id, this.el, this.st, {
      defaultBase: () => this.me()?.teamId ?? TEAMS[0]!.id,
      activeId: () => this.myLocalTeamId() || null,
      // A new team is brought to the room at once; an edit is re-sent only for the team I race with.
      saved: (team, created) => { if (this.editable() && (created || (team.id === this.sentLocalId && this.myTeam()))) this.sendTeam(team); },
      deleted: (team) => { if (this.editable() && team.id === this.sentLocalId && this.myTeam()) this.sendTeam(null); },
      picked: (team) => { if (this.editable()) this.sendTeam(team); },
      closed: () => this.render(),
      list: { allowNone: true },
    });
    const right = h('div', 'm-lobby-settings', this.body);
    this.settingsLabel = h('h2', 'm-h2', right);
    this.ownerNote = h('p', 'm-body', right);
    const rows = h('div', '', right);
    const disabled = (): boolean => !this.editable() || !this.owner();
    this.visibilityBadge = h('p', 'm-meta m-visibility-badge', right);
    right.insertBefore(this.visibilityBadge, rows);
    this.modeHint = h('p', 'm-body m-mode-hint', right);
    const settings: Ctl[] = [
      // D-061 race mode (owner; everyone sees the value and its rules).
      selectRow<NetRaceMode>(ctx, rows, { id: 'lobby.mode', label: () => ctx.t('online.mode'),
        options: () => (['normal', 'kasap'] as const).map((v) => ({ v, label: () => ctx.t(`online.modeValue.${v}`) })),
        get: () => this.settings().mode ?? 'normal', set: (mode) => this.patch({ mode }), disabled }),
      selectRow<'public' | 'private'>(ctx, rows, { id: 'lobby.visibility', label: () => ctx.t('online.visibility'),
        options: () => (['public', 'private'] as const).map((v) => ({ v, label: () => ctx.t(`online.visibilityValue.${v}`) })),
        get: () => this.settings().visibility ?? 'public', set: (visibility) => this.patch({ visibility }), disabled }),
      selectRow<RaceTrackId>(ctx, rows, { id: 'lobby.track', label: () => ctx.t('menu.race.track'),
        options: () => availableRaceTracks().map((v) => ({ v, label: () => ctx.t(RACE_TRACK_INFO[v].nameKey) })),
        get: () => this.settings().trackId, set: (trackId) => this.patch({ trackId }), disabled }),
      selectRow<NetLaps>(ctx, rows, { id: 'lobby.laps', label: () => ctx.t('menu.race.laps'),
        options: () => ([1, 3, 5, 10] as const).map((v) => ({ v, label: () => ctx.t('menu.race.lapsValue', { n: v }) })),
        get: () => this.settings().laps, set: (laps) => this.patch({ laps }), disabled }),
      selectRow<WeatherPreset>(ctx, rows, { id: 'lobby.weather', label: () => ctx.t('menu.race.weather'),
        options: () => (['dry', 'light', 'heavy', 'variable'] as const).map((v) => ({ v, label: () => ctx.t(`menu.race.weatherValue.${v}`) })),
        get: () => this.settings().weather, set: (weather) => this.patch({ weather }), disabled }),
      selectRow<TimeOfDay>(ctx, rows, { id: 'lobby.tod', label: () => ctx.t('menu.race.tod'),
        options: () => (['day', 'sunset', 'night'] as const).map((v) => ({ v, label: () => ctx.t(`menu.race.todValue.${v}`) })),
        get: () => this.settings().tod, set: (tod) => this.patch({ tod }), disabled }),
      toggleRow(ctx, rows, { id: 'lobby.aiEnabled', label: () => ctx.t('menu.race.aiOpponents'),
        get: () => this.settings().aiCount > 0,
        set: (enabled) => this.patch({ aiCount: enabled ? Math.max(0, 20 - (this.model()?.room?.players.length ?? 0)) : 0 }),
        disabled: () => disabled() || (this.model()?.room?.players.length ?? 0) >= 20 }),
      selectRow<number>(ctx, rows, { id: 'lobby.aiCount', label: () => ctx.t('online.aiCount'),
        options: () => Array.from({ length: Math.max(0, Math.min(19, 20 - (this.model()?.room?.players.length ?? 0))) }, (_, i) => ({ v: i + 1, label: () => String(i + 1) })),
        get: () => this.settings().aiCount, set: (aiCount) => this.patch({ aiCount }), disabled: () => disabled() || this.settings().aiCount === 0 }),
      sliderRow(ctx, rows, { id: 'lobby.difficulty', label: () => ctx.t('online.difficulty'), min: 0, max: 110, step: 1,
        get: () => this.settings().difficulty, set: (difficulty) => this.patch({ difficulty }), fmt: String, disabled }),
    ];
    this.actions = h('div', 'm-lobby-actions', this.st);
    const ready = button(ctx, this.actions, { id: 'lobby.ready', label: () => ctx.t(this.me()?.ready ? 'online.unready' : 'online.ready'),
      disabled: () => !this.editable() || !this.me()?.connected, activate: () => {
        const me = this.me(); if (me && this.editable()) ctx.dispatch({ type: 'onlineReady', ready: !me.ready });
      } });
    ready.el.setAttribute('aria-pressed', 'false');
    const start = button(ctx, this.actions, { id: 'lobby.start', label: () => ctx.t('online.start'), primary: true,
      disabled: () => !this.model() || !canStartLobby(this.model()!), activate: () => ctx.dispatch({ type: 'onlineStart' }) });
    const invites = button(ctx, this.actions, { id: 'lobby.p2pInvites', label: () => ctx.t('p2p.guests'),
      disabled: () => p2p().store.get().role !== 'host' || !this.editable(), activate: () => this.openPanel() });
    const leave = button(ctx, this.actions, { id: 'lobby.leave', label: () => ctx.t('online.leave'), activate: () => this.back() });
    this.startHint = h('p', 'm-body', this.actions);
    this.focus.dispose(); this.setControls([copy, team, driver, customRow, createTeam, editTeam, manageTeams, ...settings, ready, start, invites, leave]);
    this.panel = new P2PInvitePanel(ctx, this.st, () => this.closePanel());
    this.panel.move = (d) => this.focus.move(d);
    this.overlayEl = h('div', 'm-countdown', this.st);
    this.overlayEl.setAttribute('role', 'status');
    this.overlayEl.setAttribute('aria-live', 'assertive');
    this.overlayEl.tabIndex = -1;
    this.countdownLabel = h('p', 'm-meta', this.overlayEl);
    this.digit = h('p', 'apx-num', this.overlayEl);
    this.overlayEl.hidden = true;
    this.feedback = new NetFeedback(ctx, this.st, 'lobby');
    this.renderBar = bottomBar(ctx, this.st, ['move', 'change', 'select', 'back']);
  }

  private model(): Readonly<NetLobbyModel> | undefined { return this.ctx.deps.net?.get(); }
  /** D-062: the room's custom team on a base car, presented like a team (name, colours). */
  private teamOf(baseId: string): TeamDef | undefined {
    const e = this.model()?.room?.teams?.find((x) => x.team.baseTeamId === baseId);
    const t = e ? parseCustomTeam(e.team) : null;
    return t ? { ...customTeamDef(t), id: baseId } : undefined;
  }
  private myTeam(): NetCustomTeam | undefined {
    const m = this.model();
    return m?.room?.teams?.find((e) => e.ownerId === m.myId)?.team;
  }
  /** The saved local team behind my room team: the one I sent, else one with the same name and colours. */
  private myLocalTeamId(): string {
    const mine = this.myTeam();
    if (!mine) return '';
    const same = (t: CustomTeam): boolean => t.name === mine.name && t.primary === mine.primary && t.secondary === mine.secondary
      && t.accent === mine.accent && t.finish === mine.finish;
    const sent = this.sentLocalId ? customTeamStore().get(this.sentLocalId) : undefined;
    if (sent && same(sent)) return sent.id;
    return customTeamStore().list().find(same)?.id ?? '';
  }
  /** Remembers which saved team my room team is before an edit can change its name or colours. */
  private pinLocalTeam(): void {
    const id = this.myLocalTeamId();
    this.sentLocalId = this.myTeam() ? id || null : null;
  }
  /** Brings a saved team (or none) to the room on a base car no other player's custom team uses. */
  private sendTeam(team: CustomTeam | null): void {
    const m = this.model();
    if (!team || !m?.room) {
      this.sentLocalId = null;
      this.ctx.dispatch({ type: 'onlineSetTeam', team: null });
      return;
    }
    const base = lobbyTeamBase(team.baseTeamId, TEAMS.map((t) => t.id), m.room.players, m.room.teams ?? [], m.myId) ?? team.baseTeamId;
    this.sentLocalId = team.id;
    this.ctx.dispatch({ type: 'onlineSetTeam', team: { ...team, baseTeamId: base } });
  }
  private openEditor(edit: boolean): void {
    if (!this.editable()) return;
    const mine = this.myTeam();
    if (!edit || !mine) { this.teamFlow.open(); return; }
    // The editor edits a saved team: my local team, else a fresh local copy of the room team (never the server id).
    this.pinLocalTeam();
    let local = this.sentLocalId ? customTeamStore().get(this.sentLocalId) : undefined;
    if (!local) {
      const copy = parseCustomTeam({ ...mine, id: newCustomTeamId() });
      if (copy && customTeamStore().save(copy)) { local = copy; this.sentLocalId = copy.id; }
      else if (copy) local = copy; // store full: the editor shows why it cannot save
    }
    this.teamFlow.open(local);
  }
  private settings(): NetRoomSettings {
    const room = this.model()?.room;
    return clampRoomSettings(room?.settings ?? this.emptySettings, room?.players.length ?? 0);
  }
  private owner(): boolean { const m = this.model(); return !!m?.room && m.myId === m.room.ownerId; }
  private me(): NetPlayerInfo | undefined { const m = this.model(); return m?.room?.players.find((p) => p.id === m.myId); }
  private editable(): boolean { const m = this.model(); return m?.status === 'online' && m.room?.phase === 'lobby'; }
  private available(teamId: string, idx: 0 | 1): boolean {
    const m = this.model(); return carAvailable(m?.room?.players ?? [], m?.myId ?? null, teamId, idx);
  }
  private pickCar(teamId: string, driverIdx: 0 | 1): void {
    if (!this.editable() || !this.me() || !this.available(teamId, driverIdx)) return;
    this.ctx.dispatch({ type: 'onlineSetCar', teamId, driverIdx });
  }
  private patch(patch: Partial<NetRoomSettings>): void {
    if (!this.owner() || !this.editable()) return;
    this.ctx.dispatch({ type: 'onlineSettings', settings: clampRoomSettings({ ...this.settings(), ...patch }, this.model()!.room!.players.length) });
  }

  private openPanel(): void {
    if (p2p().store.get().role !== 'host' || this.panel.isOpen) return;
    this.panelSaved = { ctls: this.ctls, index: this.focus.index };
    this.body.inert = true; this.actions.inert = true;
    this.panel.open();
    this.focus.dispose(); this.setControls(this.panel.controls); this.focus.set(0, false);
  }

  private closePanel(): void {
    const saved = this.panelSaved;
    this.panelSaved = null;
    this.body.inert = false; this.actions.inert = false;
    if (saved) { this.focus.dispose(); this.setControls(saved.ctls); this.focus.set(saved.index, false); }
    this.render();
  }

  /** D-064: the room code a player shares: the host-in-browser display code, else the server room code. */
  private shareCode(): string | null {
    const m = p2p().store.get();
    return m.role !== 'none' && m.display ? m.display : this.model()?.room?.code ?? null;
  }

  private renderP2PBanner(): void {
    const m = p2p().store.get();
    const t = this.ctx.t;
    const text = m.role === 'host' ? t(m.hiddenWarn ? 'p2p.hiddenWarn' : 'p2p.hostNotice') : m.role === 'guest' && m.hostPaused ? t('p2p.hostPaused') : '';
    this.p2pBanner.hidden = !text;
    this.p2pBanner.textContent = text;
    this.p2pBanner.classList.toggle('is-warn', m.hiddenWarn || m.hostPaused);
    if (m.hiddenWarn && this.warnTimer === null) {
      this.warnTimer = setTimeout(() => { this.warnTimer = null; p2p().dismissWarning(); }, 15_000);
    }
  }

  private async copyCode(): Promise<void> {
    const code = this.shareCode();
    if (!code) return;
    const sequence = ++this.copySequence;
    try { await navigator.clipboard.writeText(code); this.copyState = 'copied'; }
    catch {
      this.copyState = 'copyFailed';
      if (this.alive && sequence === this.copySequence) {
        const range = document.createRange(); range.selectNodeContents(this.codeText);
        const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range);
      }
    }
    if (this.alive && sequence === this.copySequence) this.ctls[0]!.render();
  }

  protected back(): void { this.ctx.dispatch({ type: 'onlineLeave' }); }
  animated(): HTMLElement[] { return [this.body, this.actions]; }
  override stagger(): HTMLElement[] { return []; }
  override action(a: ActionId): void {
    if (this.teamFlow.editor) { this.teamFlow.editor.action(a); return; }
    if (this.panel.isOpen) { if (a === 'menuBack') this.panel.close(); else super.action(a); return; }
    if (this.model()?.kicked) { if (a === 'menuConfirm') this.feedback.back.activate?.(); return; }
    if (this.locked) { if (a === 'menuBack') this.back(); return; }
    super.action(a);
  }
  override key(code: string): boolean {
    if (this.teamFlow.editor) return this.teamFlow.editor.key(code);
    if (this.panel.editing()) return false;
    if (this.locked) return code === 'Home' || code === 'End' || code === 'Tab';
    if (code === 'Tab') { this.focus.move(1); return true; }
    return super.key(code);
  }

  override enter(from: ScreenId | null): void {
    this.stop();
    this.copyState = 'copy';
    this.restoreIndex = 0;
    super.enter(from);
    if (this.locked) { this.focus.blur(); this.overlayEl.focus({ preventScroll: true }); }
    this.unsub = this.ctx.deps.net?.subscribe(() => this.render()) ?? null;
    this.p2pUnsub = p2p().store.subscribe(() => this.render());
    this.timer = setInterval(() => this.renderCountdown(), 100);
  }
  private stop(): void {
    this.unsub?.(); this.unsub = null;
    this.p2pUnsub?.(); this.p2pUnsub = null;
    if (this.warnTimer !== null) clearTimeout(this.warnTimer);
    this.warnTimer = null;
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    gsap.killTweensOf(this.digit);
  }
  override leave(): void { this.panel.close(); this.teamFlow.dispose(); super.leave(); this.copySequence++; this.stop(); }

  private renderCountdown(): void {
    const m = this.model();
    const locked = !m?.kicked && (m?.room?.phase === 'countdown' || m?.room?.phase === 'loading');
    this.overlayEl.hidden = !locked;
    this.body.inert = locked;
    this.actions.inert = locked;
    if (locked !== this.locked) {
      this.locked = locked;
      if (locked) { this.focus.blur(); this.overlayEl.focus({ preventScroll: true }); }
      else this.focus.set(this.restoreIndex, false);
    }
    if (!locked) return;
    this.countdownLabel.textContent = this.ctx.t(m?.t0ServerMs === null ? 'online.loading' : 'online.countdown');
    const n = m?.t0ServerMs == null ? '' : countdownNumber(m.t0ServerMs, Date.now());
    const text = n === 0 ? this.ctx.t('online.go') : String(n);
    if (this.digit.textContent === text) return;
    this.digit.textContent = text;
    gsap.killTweensOf(this.digit);
    if (!this.ctx.reduced()) this.ctx.track(gsap.fromTo(this.digit, { opacity: 0, scale: 0.94 }, { opacity: 1, scale: 1, duration: 0.18, ease: 'apex.out', clearProps: 'transform,opacity' }));
  }

  override render(): void {
    if (this.teamFlow?.editor) { this.teamFlow.editor.render(); return; }
    if (this.panel?.isOpen) {
      // The invite panel covers the lobby; it closes when the race starts or the room is no longer mine to host.
      if (this.model()?.room?.phase !== 'lobby' || p2p().store.get().role !== 'host') this.panel.close();
      else { this.panel.render(); this.renderP2PBanner(); this.focus.refreshDisabled(); return; }
    }
    if (this.savedControls) { this.focus.dispose(); this.setControls(this.savedControls); this.savedControls = null; }
    super.render();
    const t = this.ctx.t;
    const m = this.model();
    const room = m?.room;
    this.renderHead(); this.renderLang(); this.renderBar();
    this.title.textContent = t('online.lobby');
    this.codeLabel.textContent = t(p2p().store.get().role !== 'none' ? 'p2p.displayCode' : 'online.roomCode');
    this.codeText.textContent = room ? this.shareCode() ?? '—' : '—';
    this.renderP2PBanner();
    this.ctls.find((c) => c.id === 'lobby.p2pInvites')!.el.hidden = p2p().store.get().role !== 'host';
    this.playerLabel.textContent = t('online.players');
    this.count.textContent = `${room?.players.length ?? 0}/20 ${t('online.players')}`;
    this.carLabel.textContent = t('online.car');
    this.equalCars.textContent = t('net.equalCars');
    this.settingsLabel.textContent = t('online.settings');
    this.ownerNote.textContent = t('online.ownerSettings');
    this.ctls.find((c) => c.id === 'lobby.visibility')!.el.hidden = !this.owner();
    this.ctls.find((c) => c.id === 'lobby.aiCount')!.el.hidden = this.settings().aiCount === 0;
    this.modeHint.textContent = t(`online.modeHint.${this.settings().mode ?? 'normal'}`);
    const mine = this.myTeam();
    const owner = room?.teams?.find((e) => e.team.baseTeamId === this.me()?.teamId);
    this.customHint.textContent = owner && !mine
      ? t('online.customOwnedBy', { name: room?.players.find((p) => p.id === owner.ownerId)?.name ?? '' })
      : t('online.customHint');
    this.visibilityBadge.hidden = this.owner();
    this.visibilityBadge.textContent = t(`online.visibilityValue.${room?.settings.visibility ?? 'public'}`);
    this.message.textContent = t(!m ? 'online.unavailable' : m.error ? `online.error.${m.error}` : !room ? 'online.emptyRoom' : `online.status.${m.status}`);
    const players = room?.players ?? [];
    const focusedId = (this.focus.current() as Ctl | null)?.id;
    let rosterChanged = players.length !== this.playerControls.size;
    for (const [id, ctl] of this.playerControls) {
      if (!players.some((p) => p.id === id)) { ctl.el.remove(); this.playerControls.delete(id); }
    }
    const rosterControls: Ctl[] = [];
    for (const player of players) {
      let ctl = this.playerControls.get(player.id);
      if (!ctl) {
        const el = h('article', 'm-player-card', this.roster);
        const id = `lobby.player.${player.id}`;
        el.dataset.focusId = id;
        ctl = { id, el, render() {} };
        this.playerControls.set(player.id, ctl);
        rosterChanged = true;
      }
      rosterControls.push(ctl);
      const card = ctl.el;
      card.replaceChildren();
      card.dataset.playerId = String(player.id);
      const team = this.teamOf(player.teamId) ?? this.ctx.deps.teams.find((x) => x.id === player.teamId);
      card.style.setProperty('--team', team?.colors.ui ?? team?.colors.primary ?? 'var(--apx-fg-3)');
      h('h3', 'name', card, player.name);
      const flags = h('p', 'm-meta', card);
      flags.textContent = [player.id === room!.ownerId ? t('online.owner') : '', player.id === m!.myId ? t('online.you') : ''].filter(Boolean).join(' · ');
      h('p', 'team', card, team?.name ?? player.teamId).lang = 'en';
      const state = h('div', 'state', card);
      const ready = h('span', 'ready', state, player.ready ? `✓ ${t('online.ready')}` : t('online.waiting'));
      ready.dataset.ready = String(player.ready);
      h('span', 'ping apx-num', state, t(player.connected ? 'online.ping' : 'online.disconnected', { n: Math.round(player.pingMs) }));
    }
    if (rosterChanged) {
      const controls = this.ctls.filter((c) => !c.id.startsWith('lobby.player.'));
      controls.splice(1, 0, ...rosterControls);
      this.focus.dispose(); this.setControls(controls);
      if (focusedId) this.focus.set(Math.max(0, controls.findIndex((c) => c.id === focusedId)), false);
    }
    const settings = this.settings();
    this.ai.textContent = t('online.ai', { n: settings.aiCount, total: settings.aiCount + (room?.players.length ?? 0) });
    this.ctls.find((c) => c.id === 'lobby.ready')!.el.setAttribute('aria-pressed', String(this.me()?.ready ?? false));
    this.ctls.find((c) => c.id === 'lobby.start')!.el.hidden = !this.owner();
    this.startHint.textContent = t(m && canStartLobby(m) ? 'online.allReady' : 'online.waiting');
    this.focus.refreshDisabled();
    if (this.focus.current()?.disabled?.()) this.focus.set(this.focus.index, false);
    this.renderCountdown();
    const removed = this.feedback.render();
    if (removed) {
      this.overlayEl.hidden = true;
      this.body.inert = true; this.actions.inert = true;
      this.savedControls = this.ctls; this.focus.dispose(); this.setControls([this.feedback.back]); this.focus.set(0, false);
    }
  }

  override dispose(): void { this.alive = false; this.copySequence++; this.stop(); this.teamFlow.dispose(); this.panel.dispose(); super.dispose(); }
}
