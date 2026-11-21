import type { ScreenId } from '../../contracts/ui';
import { customTeamDef, validateTeamName, type CustomTeam } from '../../data/customTeams';
import { TEAMS } from '../../data/teams';
import { hudStripColor, paletteColor, TEAM_PALETTE, type TeamPaletteId } from '../../data/teamPalette';
import { button, selectRow, type Ctl } from '../controls';
import { customTeamStore, MAX_SAVED_TEAMS, newCustomTeamId } from '../customTeamStore';
import { h } from '../dom';
import { gsap } from '../motion/gsap';
import { bottomBar, header, ListScreen } from './base';
import type { ScreenCtx } from './ctx';
import { TeamTraitsPanel } from './teamTraits';

/** What the embedded editor did when it closed. */
export interface TeamEditResult { saved?: CustomTeam; created?: boolean; deleted?: CustomTeam }

/** Embedded setup screen: no global navigation or online contract changes. */
export class CustomTeamEditor extends ListScreen {
  private draft: CustomTeam;
  private input: HTMLInputElement;
  private nameLabel: HTMLElement;
  private error: HTMLElement;
  private title: HTMLElement;
  private note: HTMLElement;
  private preview: HTMLElement;
  private strip: HTMLElement;
  private traits: TeamTraitsPanel;
  private head: () => void;
  private bar: () => void;
  private cleanups: (() => void)[] = [];

  private readonly existing: CustomTeam | undefined;

  constructor(id: ScreenId, ctx: ScreenCtx, private done: (r: TeamEditResult) => void, existing?: CustomTeam, defaultBase?: string) {
    super(id, ctx);
    delete this.el.dataset.screen;
    this.el.dataset.editor = 'team';
    this.el.dataset.active = '1';
    this.existing = existing;
    this.draft = existing ? { ...existing } : {
      id: newCustomTeamId(), name: '', baseTeamId: defaultBase ?? TEAMS[0]!.id,
      primary: 'teal', secondary: 'white', accent: 'gold', finish: 'gloss',
    };
    if (!TEAMS.some(t => t.id === this.draft.baseTeamId)) this.draft.baseTeamId = TEAMS[0]!.id;
    this.head = header(ctx, this.st).render;
    const col = h('div', 'm-team-editor', this.st);
    this.title = h('h1', 'm-h1', col);
    this.note = h('p', 'm-body', col);
    const field = h('div', 'm-team-name', col);
    this.nameLabel = h('label', 'm-meta', field);
    this.input = h('input', 'm-team-input', field);
    this.input.id = `${id}-custom-name`;
    this.input.dataset.focusId = 'custom.name';
    this.nameLabel.setAttribute('for', this.input.id);
    this.input.value = this.draft.name;
    this.input.autocomplete = 'off';
    this.input.maxLength = 80;
    this.error = h('p', 'm-body m-team-error', field);
    this.error.id = `${this.input.id}-error`;
    this.error.setAttribute('aria-live', 'polite');
    this.input.setAttribute('aria-describedby', this.error.id);
    const onInput = (): void => { this.draft.name = this.input.value; this.render(); };
    const onFocus = (): void => { this.focus.set(0, false); };
    const onKey = (e: KeyboardEvent): void => {
      if (e.ctrlKey || e.altKey || e.metaKey || e.isComposing) return;
      if (['Enter', 'NumpadEnter', 'ArrowDown', 'ArrowUp', 'Escape'].includes(e.code)) {
        e.preventDefault(); e.stopPropagation();
        if (e.code === 'Escape') this.back(); else this.focus.move(e.code === 'ArrowUp' ? -1 : 1);
      }
    };
    this.input.addEventListener('input', onInput);
    this.input.addEventListener('focus', onFocus);
    this.input.addEventListener('keydown', onKey);
    this.cleanups.push(() => {
      this.input.removeEventListener('input', onInput); this.input.removeEventListener('focus', onFocus); this.input.removeEventListener('keydown', onKey);
    });
    const tab = (e: KeyboardEvent): void => {
      if (e.code !== 'Tab' || e.ctrlKey || e.altKey || e.metaKey) return;
      e.preventDefault(); e.stopPropagation();
      if (!this.focus.move(e.shiftKey ? -1 : 1)) this.focus.set(e.shiftKey ? this.ctls.length - 1 : 0);
    };
    this.el.addEventListener('keydown', tab);
    this.cleanups.push(() => this.el.removeEventListener('keydown', tab));

    const details = h('div', 'm-team-editor-details', this.st);
    this.traits = new TeamTraitsPanel(ctx, details);
    this.traits.el.classList.add('m-editor-traits');
    const rows = h('div', '', col);
    const ctls: Ctl[] = [
      { id: 'custom.name', el: this.input, render() {}, activate: () => this.focus.move(1) },
      selectRow<string>(ctx, rows, {
        id: 'custom.base', label: () => ctx.t('teams.base'),
        options: () => TEAMS.map(t => ({ v: t.id, label: () => t.name })),
        get: () => this.draft.baseTeamId,
        set: id => { this.draft.baseTeamId = id; this.render(); },
      }),
      ...(['primary', 'secondary', 'accent'] as const).map(key => this.palette(rows, key)),
      selectRow<CustomTeam['finish']>(ctx, rows, {
        id: 'custom.finish', label: () => ctx.t('teams.finish'),
        options: () => (['gloss', 'matte', 'metallic'] as const).map(v => ({ v, label: () => ctx.t(`teams.${v}`) })),
        get: () => this.draft.finish, set: v => { this.draft.finish = v; this.render(); },
      }),
    ];
    const actions = h('div', 'm-team-actions', col);
    ctls[1]!.el.querySelector<HTMLElement>('.val')!.lang = 'en';
    ctls.push(button(ctx, actions, { id: 'custom.save', label: () => ctx.t('teams.save'), primary: true,
      disabled: () => !!this.saveError(),
      activate: () => {
        if (!customTeamStore().save(this.draft)) { this.render(); return; }
        this.done({ saved: customTeamStore().get(this.draft.id), created: !existing });
      },
    }));
    if (existing) ctls.push(button(ctx, actions, { id: 'custom.delete', label: () => ctx.t('teams.delete'), activate: () => {
      customTeamStore().remove(existing.id);
      this.done({ deleted: existing });
    } }));
    ctls.push(button(ctx, actions, { id: 'custom.cancel', label: () => ctx.t('teams.cancel'), activate: () => this.done({}) }));
    this.setControls(ctls);
    const previewWrap = h('aside', 'm-team-preview', details);
    h('p', 'm-meta', previewWrap).dataset.previewLabel = '';
    this.preview = h('div', 'm-livery-swatch', previewWrap);
    h('i', 'secondary', this.preview); h('i', 'accent', this.preview);
    this.strip = h('p', 'm-team-strip m-meta', previewWrap);
    this.bar = bottomBar(ctx, this.st, ['move', 'change', 'select', 'back']);
  }

  private palette(parent: HTMLElement, key: 'primary' | 'secondary' | 'accent'): Ctl {
    const el = h('button', 'm-palette', parent);
    el.type = 'button'; el.dataset.focusId = `custom.${key}`;
    const label = h('span', 'm-meta', el);
    const chips = h('span', 'm-palette-chips', el);
    for (const p of TEAM_PALETTE) {
      const chip = h('span', '', chips); chip.dataset.paletteId = p.id;
      chip.style.backgroundColor = p.hex;
    }
    const change = (step: number): void => {
      const index = TEAM_PALETTE.findIndex(p => p.id === this.draft[key]);
      this.draft[key] = TEAM_PALETTE[(index + step + TEAM_PALETTE.length) % TEAM_PALETTE.length]!.id;
      this.render();
    };
    return { id: `custom.${key}`, el, value: true, left: () => change(-1), right: () => change(1), activate: () => change(1),
      click: target => {
        const chip = target instanceof Element ? target.closest<HTMLElement>('[data-palette-id]') : null;
        if (chip) { this.draft[key] = chip.dataset.paletteId as TeamPaletteId; this.render(); } else change(1);
      },
      render: () => {
        label.textContent = `${this.ctx.t(`teams.${key}`)} · ${this.ctx.t(`teams.colors.${this.draft[key]}`)}`;
        el.setAttribute('aria-label', label.textContent);
        for (const chip of chips.children) {
          const id = (chip as HTMLElement).dataset.paletteId!;
          chip.classList.toggle('selected', id === this.draft[key]);
          chip.setAttribute('title', this.ctx.t(`teams.colors.${id}`));
        }
      },
    };
  }

  /** Name rules first, then the store rules (unique name, at most MAX_SAVED_TEAMS). */
  private saveError(): string | null {
    const name = validateTeamName(this.input.value).error;
    if (name) return name;
    const store = customTeamStore().check({ ...this.draft, name: this.input.value });
    return store === 'invalid' ? 'characters' : store;
  }

  protected back(): void { this.done({}); }
  animated(): HTMLElement[] { return []; }
  override key(code: string): boolean { return document.activeElement === this.input ? false : super.key(code); }
  override render(): void {
    super.render(); this.head(); this.bar();
    const t = this.ctx.t;
    this.title.textContent = t(this.existing ? 'teams.editTitle' : 'teams.title'); this.note.textContent = t('teams.note');
    this.nameLabel.textContent = t('teams.name');
    const error = this.saveError();
    this.input.setAttribute('aria-invalid', String(!!error));
    this.error.textContent = t(error ? `teams.error.${error}` : 'teams.nameHint', { max: MAX_SAVED_TEAMS });
    this.focus.refreshDisabled();
    this.traits.render(TEAMS.find(tm => tm.id === this.draft.baseTeamId));
    this.preview.style.setProperty('--primary', paletteColor(this.draft.primary));
    this.preview.style.setProperty('--secondary', paletteColor(this.draft.secondary));
    this.preview.style.setProperty('--accent', paletteColor(this.draft.accent));
    this.preview.dataset.finish = this.draft.finish;
    this.preview.setAttribute('aria-label', customTeamDef(this.draft).name || t('teams.preview'));
    this.preview.parentElement!.querySelector('[data-preview-label]')!.textContent = t('teams.preview');
    this.strip.style.borderColor = hudStripColor(this.draft.primary);
    this.strip.textContent = t('teams.strip');
  }
  override dispose(): void {
    for (const cleanup of this.cleanups) cleanup();
    gsap.killTweensOf(this.el.querySelectorAll('*'));
    super.dispose();
  }
}
