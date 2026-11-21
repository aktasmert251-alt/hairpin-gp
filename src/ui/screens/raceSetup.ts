// Quick-race setup (DESIGN §5.2; ui-hud §6): 1 KOŞULLAR → 2 TAKIM → 3 AYARLAR → 4 YARDIMLAR, a top stepper with the
// slanted vermilion underline, setting rows on the left over the showroom, CTA at the end of each step. Every
// choice is written into `deps.setup` (SessionConfig); YARIŞA BAŞLA saves the setup to
// `apexgp:v1:lastRaceSetup` and dispatches `startRace`.

import type { Compound, TimeOfDay, WeatherPreset } from '../../contracts/common';
import type { ActionId } from '../../contracts/input';
import type { SessionConfig } from '../../contracts/race';
import type { RaceTrackId } from '../../contracts/track';
import type { ScreenId } from '../../contracts/ui';
import { availableRaceTracks } from '../../game/index';
import { RACE_TRACK_INFO } from '../../data/tracks';
import { RACE_LENGTHS } from '../../data/rules';
import { button, readonlyRow, selectRow, sliderRow, toggleRow, type Ctl, type Option } from '../controls';
import { assistRows } from './assistRows';
import { h } from '../dom';
import * as fmt from '../format';
import { bottomBar, header, ListScreen } from './base';
import type { ScreenCtx } from './ctx';
import { driverOptions } from './teamRows';
import { TrackPreview } from './trackPreview';
import { TeamTraitsPanel } from './teamTraits';
import { customTeamById, teamChoices } from '../../data/customTeams';
import { TEAMS } from '../../data/teams';

const LAST_SETUP_KEY = 'apexgp:v1:lastRaceSetup';
const STEPS: ScreenId[] = ['raceConditions', 'teamSelect', 'raceSettings', 'assists'];
const STEP_KEYS = ['conditions', 'team', 'settings', 'assists'];

type SetupPatch = Partial<Pick<SessionConfig, 'trackId' | 'tod' | 'weather' | 'laps' | 'playerTeamId' | 'playerDriverIdx' | 'aiCount' | 'difficulty' | 'gridPos' | 'startCompound' | 'flashbacks' | 'assists' | 'safetyCar'>>;

type SavedSetup = SetupPatch & { lastAiCount?: number };
let lastAiCount = 19;
/** Suggested AI count on phones (offline quick race and a phone-hosted online room). */
export const MOBILE_AI = 9;

function loadLast(): SavedSetup | null {
  try {
    const raw = localStorage.getItem(LAST_SETUP_KEY);
    return raw ? (JSON.parse(raw) as SavedSetup) : null;
  } catch {
    return null;
  }
}

export function saveLastSetup(c: SessionConfig): void {
  if (c.aiCount > 0) lastAiCount = c.aiCount;
  const p: SavedSetup = {
    trackId: c.trackId, tod: c.tod, weather: c.weather, laps: c.laps, playerTeamId: c.playerTeamId, playerDriverIdx: c.playerDriverIdx, aiCount: c.aiCount,
    difficulty: c.difficulty, gridPos: c.gridPos, startCompound: c.startCompound, flashbacks: c.flashbacks, assists: c.assists, safetyCar: c.safetyCar ?? true, lastAiCount,
  };
  try {
    localStorage.setItem(LAST_SETUP_KEY, JSON.stringify(p));
  } catch {
    /* storage unavailable: setup simply is not remembered */
  }
}

/** Race-length options of a track (RACE_LENGTHS unless the track has its own, e.g. the ≈ 20 km Eifel ring). */
export function lapOptions(id: RaceTrackId): readonly number[] {
  return RACE_TRACK_INFO[id].lapOptions ?? RACE_LENGTHS;
}

/** Track switch: keep laps / opponents when the new track offers them, else its default laps and its AI cap. */
export function trackLimits(id: RaceTrackId, c: Pick<SessionConfig, 'laps' | 'aiCount' | 'gridPos'>): SetupPatch {
  const info = RACE_TRACK_INFO[id];
  const laps = lapOptions(id).includes(c.laps) ? c.laps : info.defaultLaps;
  const aiCount = Math.min(c.aiCount, info.maxAi ?? 19);
  return { trackId: id, laps, aiCount, gridPos: c.gridPos !== 'random' && c.gridPos > aiCount + 1 ? 'random' : c.gridPos };
}

/** Two-compound rule (rules.md §8): dry or variable weather and ≥ 10 laps. */
export function twoCompoundActive(c: Pick<SessionConfig, 'weather' | 'laps'>): boolean {
  return (c.weather === 'dry' || c.weather === 'variable') && c.laps >= 10;
}

let primed = false;
/** First visit per page: apply the remembered setup (or the ui-hud defaults) onto the setup store. */
export function primeSetup(ctx: ScreenCtx): void {
  if (primed) return;
  primed = true;
  const s = ctx.deps.settings.get();
  // Mobile (2026-11-21): a phone starts with a lighter grid (9 AI); the player can still pick up to the track cap.
  const defaultAi = ctx.deps.touch?.profile().mobile ? MOBILE_AI : 19;
  const defaults: SetupPatch = {
    tod: 'day', weather: 'dry', laps: 5, aiCount: defaultAi, difficulty: s.gameplay.difficulty, gridPos: 'random',
    startCompound: 'auto', flashbacks: s.gameplay.flashbacks, assists: { ...s.assists }, safetyCar: true,
  };
  const last = loadLast();
  const { lastAiCount: rememberedCount, ...rememberedSetup } = last ?? {};
  lastAiCount = Math.max(1, Math.min(19, Math.round(rememberedCount ?? last?.aiCount ?? defaultAi) || defaultAi));
  const teams = teamChoices();
  const patch: SetupPatch = { ...defaults, ...rememberedSetup };
  // The settings value is the one difficulty (the remembered setup kept an old value and hid Settings changes).
  patch.difficulty = s.gameplay.difficulty;
  // D-062: custom teams are online only; a remembered custom team falls back to its base car (or the first team).
  const custom = patch.playerTeamId ? customTeamById(patch.playerTeamId) : undefined;
  if (custom) patch.playerTeamId = custom.baseTeamId;
  if (!patch.playerTeamId || !TEAMS.some((t) => t.id === patch.playerTeamId)) patch.playerTeamId = teams[0]?.id ?? 'anka';
  ctx.deps.setup.set({ ...patch, mode: 'race' } as Partial<SessionConfig>);
}

abstract class SetupStep extends ListScreen {
  protected col: HTMLElement;
  protected rows: HTMLElement;
  protected titleEl: HTMLElement;
  protected subEl: HTMLElement;
  private steps: HTMLElement[] = [];
  private renderBar: () => void;
  private renderHead: () => void;

  constructor(id: ScreenId, ctx: ScreenCtx, cols?: number) {
    super(id, ctx, cols);
    this.wideScrim = true;
    const hd = header(ctx, this.st);
    this.renderHead = hd.render;
    const stepper = h('div', 'm-steps', hd.right);
    STEPS.forEach((_, i) => {
      const s = h('span', '', stepper);
      h('b', 'apx-num', s, String(i + 1));
      h('span', '', s);
      this.steps.push(s);
    });
    this.col = h('div', 'm-abs', this.st);
    this.col.style.cssText = 'left:96px;top:150px;width:780px;display:flex;flex-direction:column';
    this.titleEl = h('h1', 'm-h1', this.col);
    this.subEl = h('p', 'm-body', this.col);
    this.subEl.style.cssText = 'margin:12px 0 20px 0;min-height:56px;max-width:720px';
    this.descEl = this.subEl;
    this.rows = h('div', '', this.col);
    this.renderBar = bottomBar(ctx, this.st, ['move', 'change', 'select', 'back']);
  }

  protected setup(): Readonly<SessionConfig> {
    return this.ctx.deps.setup.get();
  }

  protected patch(p: SetupPatch): void {
    this.ctx.deps.setup.set(p as Partial<SessionConfig>);
  }

  protected stepIndex(): number {
    return STEPS.indexOf(this.id);
  }

  protected next(): void {
    const i = this.stepIndex();
    if (i < STEPS.length - 1) this.ctx.go(STEPS[i + 1]!);
  }

  protected back(): void {
    this.ctx.sound('back');
    const i = this.stepIndex();
    this.ctx.go(i > 0 ? STEPS[i - 1]! : 'mainMenu');
  }

  protected cta(label: string, primary: boolean, activate: () => void): Ctl {
    const wrap = h('div', '', this.col);
    wrap.style.marginTop = '24px';
    return button(this.ctx, wrap, { id: `${this.id}.cta`, label: () => this.ctx.t(label), primary, activate });
  }

  animated(): HTMLElement[] {
    return [this.col];
  }

  override enter(from: ScreenId | null): void {
    primeSetup(this.ctx);
    // Forward entry focuses the first row; back from the next step restores the last index.
    const i = this.stepIndex();
    if (from !== STEPS[i + 1]) this.restoreIndex = this.forwardIndex();
    super.enter(from);
  }

  protected forwardIndex(): number { return 0; }

  override updateDesc(): void {
    const c = this.focus.current() as Ctl | null;
    this.subEl.textContent = this.ctx.t(c?.desc ?? 'menu.race.desc.assists');
  }

  override render(): void {
    const ctx = this.ctx;
    this.renderHead();
    const i = this.stepIndex();
    this.steps.forEach((s, k) => {
      (s.lastElementChild as HTMLElement).textContent = ctx.t(`menu.steps.${STEP_KEYS[k]}`);
      s.classList.toggle('on', k === i);
      s.classList.toggle('done', k < i);
    });
    this.titleEl.textContent = ctx.t('menu.race.title');
    this.renderBar();
    super.render();
  }
}

const opt = <T>(v: T, label: () => string): Option<T> => ({ v, label });

export class RaceConditions extends SetupStep {
  private preview: TrackPreview;
  constructor(ctx: ScreenCtx) {
    super('raceConditions', ctx);
    this.backdrop = 'ink';
    this.preview = new TrackPreview(ctx, this.st);
    const t = ctx.t;
    const r = this.rows;
    this.setControls([
      selectRow<RaceTrackId>(ctx, r, {
        id: 'race.track', label: () => t('menu.race.track'), desc: 'menu.race.desc.track',
        options: () => availableRaceTracks().map((id) => opt(id, () => t(RACE_TRACK_INFO[id].nameKey))),
        get: () => this.setup().trackId, set: (v) => { this.patch(trackLimits(v, this.setup())); this.preview.render(); },
      }),
      selectRow<TimeOfDay>(ctx, r, {
        id: 'race.tod', label: () => t('menu.race.tod'), desc: 'menu.race.desc.tod',
        options: () => (['day', 'sunset', 'night'] as const).map((v) => opt(v, () => t(`menu.race.todValue.${v}`))),
        get: () => this.setup().tod, set: (v) => this.patch({ tod: v }),
      }),
      selectRow<WeatherPreset>(ctx, r, {
        id: 'race.weather', label: () => t('menu.race.weather'), desc: 'menu.race.desc.weather',
        options: () => (['dry', 'light', 'heavy', 'variable'] as const).map((v) => opt(v, () => t(`menu.race.weatherValue.${v}`))),
        get: () => this.setup().weather, set: (v) => this.patch({ weather: v }),
      }),
      selectRow<number>(ctx, r, {
        id: 'race.laps', label: () => t('menu.race.laps'), desc: 'menu.race.desc.laps',
        options: () => lapOptions(this.setup().trackId).map((v) => opt(v, () => t('menu.race.lapsValue', { n: v }))),
        get: () => this.setup().laps, set: (v) => this.patch({ laps: v }),
      }),
      this.cta('menu.race.next', false, () => this.next()),
    ]);
  }

  override render(): void { super.render(); this.preview.render(false); }
  override animated(): HTMLElement[] { return [...super.animated(), this.preview.el]; }
  override leave(): void { super.leave(); this.preview.stop(); }
  override dispose(): void { this.preview.dispose(); super.dispose(); }
}

export class TeamSelect extends SetupStep {
  private tiles: HTMLElement;
  private tileCtls: Ctl[] = [];
  private driverRows: HTMLElement;
  private driverCtl: Ctl | null = null;
  private traits: TeamTraitsPanel;

  constructor(ctx: ScreenCtx) {
    super('teamSelect', ctx, 2);
    this.traits = new TeamTraitsPanel(ctx, this.st);
    this.tiles = h('div', 'm-tiles', this.st);
    this.tiles.style.top = '268px';
    this.driverRows = h('div', 'm-abs', this.st);
    this.driverRows.style.cssText = 'left:96px;top:790px;width:648px';
    this.rows.remove();
    const teams = ctx.deps.teams;
    for (const team of teams.slice(0, 10)) {
      const el = h('button', 'm-tile', this.tiles);
      el.type = 'button';
      el.dataset.focusId = `team.${team.id}`;
      el.style.setProperty('--team', team.colors.ui ?? team.colors.primary);
      h('span', 'bar', el);
      h('span', 'notch', el);
      const name = h('h4', '', el, team.name);
      name.lang = 'en';
      h('p', 'apx-num', el, team.drivers.map((d) => `${d.code} ${d.number}`).join(' · '));
      this.tileCtls.push({
        id: `team.${team.id}`, el, desc: 'menu.race.desc.team',
        onFocus: () => {
          ctx.deps.bus.emit('ui:focusTeam', { teamId: team.id });
          this.traits.render(team);
        },
        activate: () => {
          ctx.sound('confirm');
          // A different team brings its own drivers: the stored index and the "Pilot" row follow at once.
          if (this.setup().playerTeamId !== team.id) this.patch({ playerTeamId: team.id, playerDriverIdx: 0 });
          this.markSelected();
          this.focus.refreshDisabled();
          this.driverCtl?.render();
          this.focus.set(this.tileCtls.length);
        },
        render: () => {},
      });
    }
    const t = ctx.t;
    const driverRow = selectRow<0 | 1>(ctx, this.driverRows, {
      id: 'race.driver', label: () => t('menu.race.driver'), desc: 'menu.race.desc.team',
      options: () => {
        const team = teamChoices().find((x) => x.id === this.setup().playerTeamId) ?? teams[0]!;
        return driverOptions(team);
      },
      get: () => this.setup().playerDriverIdx, set: (v) => this.patch({ playerDriverIdx: v }),
    });
    this.driverCtl = driverRow;
    const focusSelected = (): void => {
      const team = teamChoices().find(t => t.id === this.setup().playerTeamId) ?? teams[0]!;
      this.traits.render(team);
      ctx.deps.bus.emit('ui:focusTeam', { teamId: team.id });
    };
    driverRow.onFocus = focusSelected;
    const baseActivate = driverRow.activate!;
    driverRow.activate = () => {
      void baseActivate;
      ctx.sound('confirm');
      this.next();
    };
    this.col.style.width = '1600px';
    const ctaWrap = h('div', '', this.driverRows);
    ctaWrap.style.marginTop = '24px';
    const cta = button(ctx, ctaWrap, { id: 'teamSelect.cta', label: () => t('menu.race.next'), activate: () => this.next() });
    cta.onFocus = focusSelected;
    // D-062: custom teams are online only (lobby); Quick Race offers the ten teams.
    this.setControls([...this.tileCtls, driverRow, cta]);
  }

  private markSelected(): void {
    const id = this.setup().playerTeamId;
    for (const c of this.tileCtls) c.el.classList.toggle('is-sel', c.id === `team.${id}`);
  }

  override animated(): HTMLElement[] {
    return [this.col, this.tiles, this.driverRows, this.traits.el];
  }

  override stagger(): HTMLElement[] {
    return [];
  }

  override enter(from: ScreenId | null): void {
    // D-062: a custom team saved in the setup from earlier builds falls back to its base car.
    const custom = customTeamById(this.setup().playerTeamId);
    if (custom) this.patch({ playerTeamId: custom.baseTeamId });
    super.enter(from);
    this.markSelected();
    const team = teamChoices().find(t => t.id === this.setup().playerTeamId);
    this.traits.render(team);
    const cur = this.focus.current();
    cur?.onFocus?.();
  }

  override render(): void {
    super.render(); this.traits.render(); this.focus.refreshDisabled();
  }

  protected override forwardIndex(): number {
    return Math.max(0, this.tileCtls.findIndex((c) => c.id === `team.${this.setup().playerTeamId}`));
  }

  override action(a: ActionId): void {
    const f = this.focus;
    const n = this.tileCtls.length;
    const i = f.index;
    if (i < n && (a === 'menuLeft' || a === 'menuRight' || a === 'menuUp' || a === 'menuDown')) {
      const dx = a === 'menuLeft' ? -1 : a === 'menuRight' ? 1 : 0;
      const dy = a === 'menuUp' ? -1 : a === 'menuDown' ? 1 : 0;
      // Down from the last tile row (either column) goes to the driver row, never past it to the CTA.
      if (dy === 1 && i + 2 >= n) {
        f.set(n);
        this.ctx.sound('move');
      } else if (f.moveGrid(dx, dy)) this.ctx.sound('move');
      return;
    }
    if (i === n && a === 'menuUp') {
      const sel = this.tileCtls.findIndex((c) => c.id === `team.${this.setup().playerTeamId}`);
      f.set(sel >= 0 ? sel : n - 1);
      this.ctx.sound('move');
      return;
    }
    super.action(a);
  }
}

export class RaceSettings extends SetupStep {
  constructor(ctx: ScreenCtx) {
    super('raceSettings', ctx);
    const t = ctx.t;
    const r = this.rows;
    this.setControls([
      toggleRow(ctx, r, {
        id: 'race.aiEnabled', label: () => t('menu.race.aiOpponents'), desc: 'menu.race.desc.aiOpponents',
        get: () => this.setup().aiCount > 0,
        set: (enabled) => {
          if (this.setup().aiCount > 0) lastAiCount = this.setup().aiCount;
          this.setAiCount(enabled ? Math.min(lastAiCount, RACE_TRACK_INFO[this.setup().trackId].maxAi ?? 19) : 0);
        },
      }),
      sliderRow(ctx, r, {
        id: 'race.opponents', label: () => t('menu.race.opponents'), min: 1, max: RACE_TRACK_INFO[this.setup().trackId].maxAi ?? 19, step: 1, desc: 'menu.race.desc.opponents',
        // The grid list depends on the opponent count (re-rendered here too for pointer scrubs).
        get: () => this.setup().aiCount, set: (v) => this.setAiCount(v), fmt: (v) => String(v),
        disabled: () => this.setup().aiCount === 0,
      }),
      sliderRow(ctx, r, {
        id: 'race.difficulty', label: () => t('menu.race.difficulty'), min: 0, max: 110, step: 5, desc: 'menu.race.desc.difficulty',
        get: () => this.setup().difficulty, set: (v) => { this.patch({ difficulty: v }); this.ctx.deps.settings.setPath('gameplay.difficulty', v); }, fmt: (v) => String(v),
      }),
      selectRow<number | 'random'>(ctx, r, {
        id: 'race.grid', label: () => t('menu.race.grid'), desc: 'menu.race.desc.grid',
        options: () => [opt<number | 'random'>('random', () => t('menu.race.gridRandom')), ...Array.from({ length: this.setup().aiCount + 1 }, (_, i) => opt<number | 'random'>(i + 1, () => `P${i + 1}`))],
        get: () => {
          const g = this.setup().gridPos;
          return g === 'random' || g <= this.setup().aiCount + 1 ? g : 'random';
        },
        set: (v) => this.patch({ gridPos: v }),
      }),
      selectRow<Compound | 'auto'>(ctx, r, {
        id: 'race.startTyre', label: () => t('menu.race.startTyre'), desc: 'menu.race.desc.startTyre',
        options: () => (['auto', 'soft', 'medium', 'hard', 'inter', 'wet'] as const).map((v) => opt(v, () => t(`menu.race.tyreValue.${v}`))),
        get: () => this.setup().startCompound, set: (v) => this.patch({ startCompound: v }),
      }),
      selectRow<number>(ctx, r, {
        id: 'race.flashbacks', label: () => t('menu.race.flashbacks'), desc: 'menu.race.desc.flashbacks',
        options: () => [0, 3, 5, -1].map((v) => opt(v, () => (v < 0 ? t('menu.race.unlimited') : String(v)))),
        get: () => this.setup().flashbacks, set: (v) => this.patch({ flashbacks: v }),
      }),
      readonlyRow(ctx, r, {
        id: 'race.twoCompound', label: () => t('menu.race.twoCompound'), desc: 'menu.race.desc.twoCompound',
        value: () => t(twoCompoundActive(this.setup()) ? 'menu.race.twoCompoundOn' : 'menu.race.twoCompoundOff'),
      }),
      toggleRow(ctx, r, {
        id: 'race.safetyCar', label: () => t('menu.race.safetyCar'), desc: 'menu.race.desc.safetyCar',
        get: () => this.setup().safetyCar ?? true,
        set: (safetyCar) => { this.patch({ safetyCar }); saveLastSetup(this.setup()); },
      }),
      this.cta('menu.race.next', false, () => this.next()),
    ]);
  }

  private setAiCount(aiCount: number): void {
    if (aiCount > 0) lastAiCount = aiCount;
    const gridPos = this.setup().gridPos;
    this.patch({ aiCount, gridPos: gridPos !== 'random' && gridPos > aiCount + 1 ? 'random' : gridPos });
    this.render();
  }

  override render(): void {
    super.render();
    this.ctls.find((c) => c.id === 'race.opponents')!.el.hidden = this.setup().aiCount === 0;
    this.focus.refreshDisabled();
  }
}

export class Assists extends SetupStep {
  constructor(ctx: ScreenCtx) {
    super('assists', ctx);
    const rows = assistRows(ctx, this.rows, {
      idPrefix: 'assists', desc: 'menu.race.desc.assists',
      get: () => this.setup().assists, set: (v) => this.patch({ assists: v }),
    });
    const start = this.cta('menu.race.start', true, () => {
      const cfg = this.setup();
      ctx.deps.setup.set({ mode: 'race', mandatoryStop: twoCompoundActive(cfg) } as Partial<SessionConfig>);
      saveLastSetup(ctx.deps.setup.get() as SessionConfig);
      ctx.dispatch({ type: 'startRace' });
    });
    this.setControls([...rows, start]);
    this.rows.style.marginTop = '-8px';
    this.subEl.style.marginBottom = '12px';
  }
}
