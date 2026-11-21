import type { TeamDef, TeamTraits } from '../../contracts/data';
import { h } from '../dom';
import * as fmt from '../format';
import type { ScreenCtx } from './ctx';

const TRAITS: (keyof TeamTraits)[] = ['power', 'lowDrag', 'downforce', 'mechGrip', 'tyreCare', 'ers'];

export class TeamTraitsPanel {
  readonly el: HTMLElement;
  private team: TeamDef | null = null;
  constructor(private ctx: ScreenCtx, parent: HTMLElement) {
    this.el = h('aside', 'm-team-traits', parent);
    this.el.setAttribute('aria-live', 'polite');
    this.el.setAttribute('aria-atomic', 'true');
  }

  render(team = this.team): void {
    if (!team) return;
    this.team = team;
    const ctx = this.ctx;
    this.el.dataset.teamId = team.id;
    this.el.style.setProperty('--team', team.colors.ui ?? team.colors.primary);
    this.el.replaceChildren();
    h('p', 'm-meta', this.el, ctx.t('menu.traits.title'));
    h('h2', 'm-h2', this.el, team.name).lang = 'en';
    if (ctx.deps.net?.get().room) {
      h('p', 'm-body', this.el, ctx.t('net.equalCars'));
      return;
    }
    const pace = h('div', 'm-pace m-meta', this.el);
    h('span', '', pace, ctx.t('menu.traits.pace'));
    const level = Math.max(1, Math.min(5, Math.round(1 + (team.perf + 0.015) / 0.03 * 4)));
    pace.setAttribute('aria-label', ctx.t('menu.traits.paceValue', { n: level }));
    for (let i = 0; i < 5; i++) h('i', i < level ? 'on' : '', pace).setAttribute('aria-hidden', 'true');
    const label = (key: keyof TeamTraits) => ctx.t(`menu.traits.${key}`);
    for (const key of TRAITS) {
      const rating = Math.max(-1, Math.min(1, team.traits[key]));
      const row = h('div', 'm-trait', this.el);
      h('span', '', row, label(key));
      const meter = h('span', 'meter', row);
      meter.setAttribute('role', 'meter');
      meter.setAttribute('aria-label', label(key));
      meter.setAttribute('aria-valuemin', '-1');
      meter.setAttribute('aria-valuemax', '1');
      meter.setAttribute('aria-valuenow', String(rating));
      h('i', '', meter).style.transform = `scaleX(${(rating + 1) / 2})`;
      const value = `${rating > 0 ? '+' : rating < 0 ? '−' : ''}${fmt.decimal(Math.abs(rating), 1, ctx.lang())}`;
      h('b', 'apx-num', row, value);
      meter.setAttribute('aria-valuetext', value);
    }
    const sorted = [...TRAITS].sort((a, b) => team.traits[b] - team.traits[a]);
    const strong = sorted.filter(k => team.traits[k] > 0).slice(0, 2);
    const weak = [...sorted].reverse().filter(k => team.traits[k] < 0).slice(0, 2);
    h('p', 'm-traits-summary', this.el, ctx.t('menu.traits.summary', {
      strong: strong.map(label).join(', ') || ctx.t('menu.traits.balanced'),
      weak: weak.map(label).join(', ') || ctx.t('menu.traits.balanced'),
    }));
    h('p', 'm-meta m-traits-scale', this.el, ctx.t('menu.traits.scale'));
  }
}
