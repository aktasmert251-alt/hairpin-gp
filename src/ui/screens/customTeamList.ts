// "My teams": every saved custom team (up to MAX_SAVED_TEAMS) with race / edit / delete, plus create. Embedded like the
// editor (CustomTeamFlow hides the host stage); the host forwards key, action and render while it is open.
import type { ScreenId } from '../../contracts/ui';
import type { CustomTeam } from '../../data/customTeams';
import { TEAMS } from '../../data/teams';
import { hudStripColor, paletteColor } from '../../data/teamPalette';
import { button, type Ctl } from '../controls';
import { customTeamStore, MAX_SAVED_TEAMS } from '../customTeamStore';
import { h } from '../dom';
import { gsap } from '../motion/gsap';
import { bottomBar, header, ListScreen } from './base';
import type { ScreenCtx } from './ctx';

export type TeamListResult =
  | { type: 'back' }
  | { type: 'pick'; team: CustomTeam | null }
  | { type: 'create' }
  | { type: 'edit'; team: CustomTeam }
  | { type: 'deleted'; team: CustomTeam };

export interface TeamListOptions {
  /** The team in use (marked), or null for a standard team. */
  activeId?: string | null;
  /** Offer "standard team" (null pick). */
  allowNone?: boolean;
  /** Pick buttons are offered (false: manage only). */
  pickable?: boolean;
}

export class CustomTeamList extends ListScreen {
  private title: HTMLElement;
  private count: HTMLElement;
  private note: HTMLElement;
  private head: () => void;
  private bar: () => void;
  private armed: string | null = null;
  private rows: HTMLElement;

  constructor(id: ScreenId, ctx: ScreenCtx, private done: (r: TeamListResult) => void, private opts: TeamListOptions = {}) {
    super(id, ctx);
    delete this.el.dataset.screen;
    this.el.dataset.editor = 'teamList';
    this.el.dataset.active = '1';
    this.head = header(ctx, this.st).render;
    const col = h('div', 'm-team-list', this.st);
    const top = h('div', 'm-team-list-head', col);
    this.title = h('h1', 'm-h1', top);
    this.count = h('span', 'm-meta apx-num', top);
    this.note = h('p', 'm-body', col);
    this.rows = h('div', 'm-team-rows', col);
    const t = ctx.t;
    const ctls: Ctl[] = [];
    const teams = customTeamStore().list();
    const pickable = opts.pickable !== false;
    if (!teams.length) h('p', 'm-body m-team-empty', this.rows).dataset.empty = '';
    for (const team of teams) {
      const row = h('div', 'm-team-row', this.rows);
      row.dataset.teamId = team.id;
      row.style.setProperty('--team', hudStripColor(team.primary));
      const sw = h('div', 'm-livery-swatch m-team-row-swatch', row);
      sw.style.setProperty('--primary', paletteColor(team.primary));
      sw.style.setProperty('--secondary', paletteColor(team.secondary));
      sw.style.setProperty('--accent', paletteColor(team.accent));
      sw.dataset.finish = team.finish;
      h('i', 'secondary', sw); h('i', 'accent', sw);
      const info = h('div', 'm-team-row-info', row);
      const name = h('h3', 'm-team-row-name', info, team.name);
      name.lang = 'en';
      const base = h('p', 'm-meta', info);
      base.dataset.base = TEAMS.find((x) => x.id === team.baseTeamId)?.name ?? team.baseTeamId;
      const tag = h('span', 'm-meta m-team-row-tag', info);
      tag.dataset.tag = '';
      const actions = h('div', 'm-team-row-actions', row);
      if (pickable) ctls.push(button(ctx, actions, { id: `teams.use.${team.id}`, label: () => t('teams.use'), primary: true,
        activate: () => this.done({ type: 'pick', team }) }));
      ctls.push(button(ctx, actions, { id: `teams.edit.${team.id}`, label: () => t('teams.edit'), activate: () => this.done({ type: 'edit', team }) }));
      ctls.push(button(ctx, actions, { id: `teams.delete.${team.id}`,
        label: () => t(this.armed === team.id ? 'teams.confirmDelete' : 'teams.delete'),
        activate: () => {
          if (this.armed !== team.id) { this.armed = team.id; this.render(); return; }
          customTeamStore().remove(team.id);
          this.done({ type: 'deleted', team });
        } }));
    }
    const actions = h('div', 'm-team-actions', col);
    ctls.push(button(ctx, actions, { id: 'teams.create', label: () => t('teams.create'),
      disabled: () => !customTeamStore().canCreate(), activate: () => this.done({ type: 'create' }) }));
    if (pickable && opts.allowNone) ctls.push(button(ctx, actions, { id: 'teams.none', label: () => t('teams.none'), activate: () => this.done({ type: 'pick', team: null }) }));
    ctls.push(button(ctx, actions, { id: 'teams.back', label: () => t('teams.back'), activate: () => this.done({ type: 'back' }) }));
    this.setControls(ctls);
    // Start on the team in use, else the first row.
    const active = opts.activeId ? ctls.findIndex((c) => c.id === `teams.use.${opts.activeId}` || c.id === `teams.edit.${opts.activeId}`) : -1;
    this.restoreIndex = Math.max(0, active);
    this.bar = bottomBar(ctx, this.st, ['move', 'select', 'back']);
  }

  protected back(): void { this.done({ type: 'back' }); }
  animated(): HTMLElement[] { return []; }
  override render(): void {
    super.render(); this.head(); this.bar();
    const t = this.ctx.t;
    const n = customTeamStore().count();
    this.title.textContent = t('teams.listTitle');
    this.count.textContent = t('teams.count', { n, max: MAX_SAVED_TEAMS });
    this.note.textContent = t(n >= MAX_SAVED_TEAMS ? 'teams.error.full' : 'teams.listNote', { max: MAX_SAVED_TEAMS });
    const empty = this.rows.querySelector<HTMLElement>('[data-empty]');
    if (empty) empty.textContent = t('teams.listEmpty');
    for (const row of this.rows.querySelectorAll<HTMLElement>('.m-team-row')) {
      const base = row.querySelector<HTMLElement>('[data-base]')!;
      base.textContent = t('teams.baseOf', { name: base.dataset.base ?? '' });
      const inUse = row.dataset.teamId === this.opts.activeId;
      row.classList.toggle('is-sel', inUse);
      row.querySelector<HTMLElement>('[data-tag]')!.textContent = inUse ? t('teams.inUse') : '';
    }
    this.focus.refreshDisabled();
  }
  override action(a: Parameters<ListScreen['action']>[0]): void {
    // Moving away from an armed delete disarms it.
    if (this.armed && (a === 'menuUp' || a === 'menuDown' || a === 'menuBack')) { this.armed = null; this.render(); if (a === 'menuBack') return; }
    super.action(a);
  }
  override dispose(): void {
    gsap.killTweensOf(this.el.querySelectorAll('*'));
    super.dispose();
  }
}
