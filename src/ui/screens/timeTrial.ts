// Time Trial setup and results (DESIGN §5.2; ui-hud §6). Setup writes the choices into `deps.setup` and dispatches
// `startTimeTrial`; the showroom car follows the chosen livery (ui:focusTeam). Results show a PB banner (new PB =
// green stripe), the session's laps with sectors coloured by status, and the local top 10.

import type { RaceTrackId } from '../../contracts/track';
import type { Compound, TimeOfDay, WeatherPreset } from '../../contracts/common';
import type { ActionId } from '../../contracts/input';
import type { SectorStatus, SessionConfig } from '../../contracts/race';
import type { ScreenId } from '../../contracts/ui';
import { availableRaceTracks } from '../../game/index';
import { RACE_TRACK_INFO } from '../../data/tracks';
import { button, selectRow, type Ctl, type Option } from '../controls';
import { h, icon } from '../dom';
import * as fmt from '../format';
import { gsap } from '../motion/gsap';
import { bottomBar, header, langIndicator, ListScreen } from './base';
import type { ScreenCtx } from './ctx';
import { TrackPreview } from './trackPreview';
import { customTeamById } from '../../data/customTeams';
import { TEAMS } from '../../data/teams';

const opt = <T>(v: T, label: () => string): Option<T> => ({ v, label });

export class TtSetup extends ListScreen {
  private col: HTMLElement;
  private title: HTMLElement;
  private sub: HTMLElement;
  private renderBar: () => void;
  private renderHead: () => void;
  private renderLang: () => void;
  private preview: TrackPreview;

  constructor(ctx: ScreenCtx) {
    super('ttSetup', ctx);
    this.backdrop = 'ink';
    this.preview = new TrackPreview(ctx, this.st);
    this.wideScrim = true;
    const hd = header(ctx, this.st);
    this.renderHead = hd.render;
    this.renderLang = langIndicator(ctx, hd.right);
    this.col = h('div', 'm-abs', this.st);
    this.col.style.cssText = 'left:96px;top:150px;width:780px;display:flex;flex-direction:column';
    this.title = h('h1', 'm-display', this.col);
    this.sub = h('p', 'm-body', this.col);
    this.sub.style.cssText = 'margin:14px 0 22px;min-height:56px;max-width:720px';
    this.descEl = this.sub;
    const rows = h('div', '', this.col);
    const t = ctx.t;
    const s = (): Readonly<SessionConfig> => ctx.deps.setup.get();
    const set = (p: Partial<SessionConfig>): void => ctx.deps.setup.set(p);
    const ctls: Ctl[] = [
      selectRow<RaceTrackId>(ctx, rows, {
        id: 'tt.track', label: () => t('tt.track'), desc: 'tt.desc.track',
        options: () => availableRaceTracks().map((id) => opt(id, () => t(RACE_TRACK_INFO[id].nameKey))),
        get: () => s().trackId, set: (v) => { set({ trackId: v }); this.preview.render(); },
      }),
      selectRow<string>(ctx, rows, {
        id: 'tt.team', label: () => t('tt.team'), desc: 'tt.desc.team',
        // D-062: custom teams are online only.
        options: () => TEAMS.map((tm) => opt(tm.id, () => fmt.upper(tm.name, 'en'))),
        get: () => s().playerTeamId,
        set: (v) => {
          set({ playerTeamId: v });
          this.focus.refreshDisabled();
          ctx.deps.bus.emit('ui:focusTeam', { teamId: v });
        },
      }),
      selectRow<Compound | 'auto'>(ctx, rows, {
        id: 'tt.tyre', label: () => t('tt.tyre'), desc: 'tt.desc.tyre',
        options: () => (['soft', 'medium', 'hard'] as const).map((v) => opt<Compound | 'auto'>(v, () => t(`menu.race.tyreValue.${v}`))),
        get: () => s().startCompound, set: (v) => set({ startCompound: v }),
      }),
      selectRow<TimeOfDay>(ctx, rows, {
        id: 'tt.tod', label: () => t('tt.tod'), desc: 'menu.race.desc.tod',
        options: () => (['day', 'sunset', 'night'] as const).map((v) => opt(v, () => t(`menu.race.todValue.${v}`))),
        get: () => s().tod, set: (v) => set({ tod: v }),
      }),
      selectRow<WeatherPreset>(ctx, rows, {
        id: 'tt.weather', label: () => t('tt.weather'), desc: 'menu.race.desc.weather',
        options: () => (['dry', 'light', 'heavy'] as const).map((v) => opt<WeatherPreset>(v, () => t(`tt.weatherValue.${v}`))),
        get: () => s().weather, set: (v) => set({ weather: v }),
      }),
      selectRow<SessionConfig['ghost']>(ctx, rows, {
        id: 'tt.ghost', label: () => t('tt.ghost'), desc: 'tt.desc.ghost',
        options: () => (['pb', 'rival', 'off'] as const).map((v) => opt(v, () => t(`tt.ghostValue.${v}`))),
        get: () => s().ghost, set: (v) => set({ ghost: v }),
      }),
    ];
    const wrap = h('div', '', this.col);
    wrap.style.marginTop = '28px';
    ctls.push(button(ctx, wrap, {
      id: 'tt.go', label: () => t('tt.go'), primary: true,
      activate: () => {
        ctx.deps.setup.set({ mode: 'timeTrial', aiCount: 0 });
        ctx.dispatch({ type: 'startTimeTrial' });
      },
    }));
    this.setControls(ctls);
    this.renderBar = bottomBar(ctx, this.st, ['move', 'change', 'select', 'back']);
  }

  animated(): HTMLElement[] {
    return [this.col, this.preview.el];
  }

  protected back(): void {
    this.ctx.sound('back');
    this.ctx.go('mainMenu');
  }

  override enter(from: ScreenId | null): void {
    const s = this.ctx.deps.setup.get();
    const patch: Partial<SessionConfig> = {};
    if (s.startCompound === 'auto' || s.startCompound === 'inter' || s.startCompound === 'wet') patch.startCompound = 'soft';
    if (s.weather === 'variable') patch.weather = 'dry';
    if (!['pb', 'rival', 'off'].includes(s.ghost)) patch.ghost = 'pb';
    // D-062: a custom team saved in the setup from earlier builds falls back to its base car.
    const custom = customTeamById(s.playerTeamId);
    if (custom) patch.playerTeamId = custom.baseTeamId;
    if (Object.keys(patch).length) this.ctx.deps.setup.set(patch);
    if (from === 'mainMenu') this.restoreIndex = 0;
    super.enter(from);
    this.ctx.deps.bus.emit('ui:focusTeam', { teamId: this.ctx.deps.setup.get().playerTeamId });
  }

  override render(): void {
    super.render();
    this.focus.refreshDisabled();
    this.renderHead();
    this.renderLang();
    this.title.textContent = this.ctx.t('tt.title');
    this.renderBar();
    this.preview.render(false);
  }

  override leave(): void { super.leave(); this.preview.stop(); }
  override dispose(): void { this.preview.dispose(); super.dispose(); }
}

export class TtResults extends ListScreen {
  private head: HTMLElement;
  private banner: HTMLElement;
  private laps: HTMLTableElement;
  private top: HTMLElement;

  constructor(ctx: ScreenCtx) {
    super('ttResults', ctx);
    this.backdrop = 'ink';
    this.head = h('div', 'm-res-head', this.st);
    this.banner = h('div', 'm-pb', this.st);
    this.laps = h('table', 'm-res m-tt apx-num', this.st);
    this.top = h('aside', 'm-top10', this.st);
    const bar = h('footer', 'm-bar', this.st);
    const btns = h('div', 'm-btns', bar);
    this.setControls([
      button(ctx, btns, { id: 'ttResults.retry', label: () => ctx.t('tt.results.retry'), activate: () => ctx.dispatch({ type: 'restart' }) }),
      button(ctx, btns, { id: 'ttResults.menu', label: () => ctx.t('tt.results.menu'), activate: () => ctx.dispatch({ type: 'quitToMenu' }) }),
    ]);
  }

  animated(): HTMLElement[] {
    return [this.head, this.banner, this.top];
  }

  override stagger(): HTMLElement[] {
    return [];
  }

  protected back(): void {
    this.ctx.sound('back');
    this.ctx.dispatch({ type: 'quitToMenu' });
  }

  override action(a: ActionId): void {
    if (a === 'menuLeft') return super.action('menuUp');
    if (a === 'menuRight') return super.action('menuDown');
    super.action(a);
  }

  override enter(from: ScreenId | null): void {
    this.restoreIndex = 0;
    super.enter(from);
    const rows = Array.from(this.laps.tBodies[0]?.rows ?? []);
    if (rows.length && !this.ctx.reduced()) this.ctx.track(gsap.fromTo(rows, { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.22, ease: 'apex.out', stagger: 0.03, clearProps: 'transform' }));
  }

  override render(): void {
    super.render();
    const ctx = this.ctx;
    const t = ctx.t;
    const tt = ctx.deps.tt.get();
    this.head.replaceChildren();
    h('h1', 'm-h1', this.head, t('tt.results.title'));
    h('p', 'm-meta', this.head, ctx.upper(t(`tracks.${this.ctx.deps.setup.get().trackId}`)));
    // PB banner
    const isNew = tt.pbMs > 0 && tt.laps.some((l) => l.valid && l.ms === tt.pbMs);
    this.banner.replaceChildren();
    this.banner.dataset.new = isNew ? '1' : '0';
    h('span', 'stripe', this.banner);
    h('span', 'm-meta', this.banner, t(isNew ? 'tt.results.newPb' : 'tt.results.pb'));
    h('span', 'v apx-num', this.banner, fmt.lapTime(tt.pbMs));
    // Laps
    const valid = tt.laps.filter((l) => l.valid);
    const best = [0, 1, 2].map((i) => Math.min(...valid.map((l) => l.sectors[i]!).filter((x) => x > 0), Infinity));
    const tb = this.laps;
    tb.replaceChildren();
    const hr = h('tr', '', h('thead', '', tb));
    for (const [k, cls] of [['tt.results.lap', 'c'], ['tt.results.time', 'r'], ['', 'r'], ['', 'r'], ['', 'r'], ['tt.results.valid', 'c']] as const) h('th', cls, hr, k ? t(k) : '');
    (hr.children[2] as HTMLElement).textContent = t('hud.timing.sector', { n: 1 });
    (hr.children[3] as HTMLElement).textContent = t('hud.timing.sector', { n: 2 });
    (hr.children[4] as HTMLElement).textContent = t('hud.timing.sector', { n: 3 });
    const body = h('tbody', '', tb);
    if (tt.laps.length === 0) h('td', 'c empty', h('tr', '', body), t('tt.results.noLaps')).colSpan = 6;
    for (const l of tt.laps.slice(-12)) {
      const tr = h('tr', '', body);
      if (l.valid && l.ms === tt.pbMs) tr.classList.add('me');
      if (!l.valid) tr.classList.add('out');
      h('td', 'p', tr, String(l.n));
      h('td', 'r', tr, fmt.lapTime(l.ms));
      for (let i = 0; i < 3; i++) {
        const ms = l.sectors[i]!;
        const st: SectorStatus = !l.valid || !(ms > 0) ? 'none' : ms <= best[i]! ? 'purple' : 'yellow';
        const td = h('td', `r sec-${st}`, tr, fmt.sectorTime(ms));
        void td;
      }
      const v = h('td', 'c', tr);
      v.appendChild(icon(l.valid ? 'check' : 'cross'));
    }
    // Local top 10
    this.top.replaceChildren();
    h('p', 'm-meta', this.top, t('tt.results.top10'));
    const list = h('ol', '', this.top);
    if (tt.top10.length === 0) h('li', 'empty', list, t('tt.results.top10Empty'));
    tt.top10.slice(0, 10).forEach((e, i) => {
      const li = h('li', '', list);
      h('span', 'n apx-num', li, String(i + 1));
      const tm = ctx.deps.teams.find((x) => x.id === e.teamId);
      const nm = h('span', 'tm', li, tm?.name ?? e.teamId);
      nm.lang = 'en';
      h('span', 'v apx-num', li, fmt.lapTime(e.ms));
    });
  }
}
