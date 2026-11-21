// Settings (DESIGN §5.2, §6.12–§6.13; ui-hud §7): vertical tab list (280 px) on the left, 56 px setting rows on the
// right in a clipped, keyboard-scrolled column, focused-row description in a footer panel. Two focus levels:
// tabs (↑/↓ previews, → / Enter enters) and rows (← on a row without a value, or Esc, returns to the tabs).
// Pointer: hovering a row focuses it (rows level), clicking acts on it (‹ ›, segments, slider track, key chips),
// clicking a tab switches to it, the wheel scrolls the clipped column.
// Key bindings use KeyBindingsApi (label, startRebind, resetBindings); Ctrl/Alt/Meta are refused by the API.

import type { CameraId, QualityId } from '../../contracts/common';
import type { ActionId, PadRebindResult, RebindResult } from '../../contracts/input';
import type { QualityPreset } from '../../contracts/render';
import type { Settings } from '../../contracts/settings';
import type { ScreenId } from '../../contracts/ui';
import { QUALITY_PRESETS } from '../../graphics/index';
import { soundToggleMaster } from '../soundToggle';
import { button, navItem, readonlyRow, selectRow, sliderRow, toggleRow, type Ctl, type Option } from '../controls';
import { h, icon } from '../dom';
import { FocusList } from '../focus/focus';
import * as fmt from '../format';
import { partOf } from '../pointer';
import { assistRows } from './assistRows';
import { keyTestRow, type KeyTestRow } from './keyTest';
import { padChip, padText, setPadChip } from '../padGlyph';
import { padTestRow, type PadTestRow } from './padTest';
import { bottomBar, header, langIndicator, ListScreen } from './base';
import type { ScreenCtx } from './ctx';

const TABS = ['graphics', 'audio', 'controls', 'assists', 'hud', 'language', 'interface'] as const;
type Tab = (typeof TABS)[number];
const BIND_ACTIONS: ActionId[] = [
  'throttle', 'brake', 'steerLeft', 'steerRight', 'gearUp', 'gearDown', 'drs', 'ersOvertake', 'pitLimiter', 'cameraNext', 'lookBack',
  'flashback', 'pause', 'mfdNext', 'mfd1', 'mfd2', 'mfd3', 'mfd4', 'racingLine', 'hudCycle', 'restartLap', 'mainMenu',
];
/** Gamepad bind rows: steering is the stick axis and Start stays pause (it cancels a pad rebind). */
const PAD_BIND_ACTIONS: ActionId[] = BIND_ACTIONS.filter((a) => a !== 'steerLeft' && a !== 'steerRight' && a !== 'pause');
/** The fonts have no arrow glyphs (D-007): arrow keys render as SVG. */
const ARROWS: Record<string, string> = { ArrowUp: 'arrow-up', ArrowDown: 'arrow-down', ArrowLeft: 'arrow-left', ArrowRight: 'arrow-right' };
const ROW_H = 56;
const VIEW_ROWS = 11;

const opt = <T>(v: T, label: () => string): Option<T> => ({ v, label });
/** Device names are not Turkish text: no dotted İ from the tr upper-casing. */
const langEn = (c: Ctl): Ctl => {
  c.el.querySelector<HTMLElement>('.c-ro')!.lang = 'en';
  return c;
};

export class SettingsScreen extends ListScreen {
  private rowsFocus: FocusList;
  private mode: 'tabs' | 'rows' | 'listen' | 'confirm' = 'tabs';
  private panes = new Map<Tab, { el: HTMLElement; inner: HTMLElement; ctls: Ctl[] }>();
  private tab: Tab = 'graphics';
  private title: HTMLElement;
  private foot: HTMLElement;
  private footText: HTMLElement;
  private warnUntil = 0;
  private lost = new Set<ActionId>();
  private renderBar: () => void;
  private renderHead: () => void;
  private renderLang: () => void;
  private resetCtl: Ctl | null = null;
  private keyTest: KeyTestRow | null = null;
  private padTest: PadTestRow | null = null;
  private resetArmed = false;
  private padResetArmed = false;
  private padResetCtl: Ctl | null = null;
  private padListen = false;
  /** Current scroll offset of the visible pane (px); focus set by the pointer only keeps the row visible. */
  private scrollY = 0;
  private byPointer = false;
  /** Row pitch and visible rows: 56 / 11 with keys and mouse; measured on a touch UI, where rows are thumb-sized (touch.css). */
  private rowH = ROW_H;
  private viewRows = VIEW_ROWS;
  private content: HTMLElement;
  private dragged = false;
  private touchTimer: ReturnType<typeof setInterval> | null = null;
  private touchTest: Ctl | null = null;

  constructor(ctx: ScreenCtx) {
    super('settings', ctx);
    this.backdrop = 'ink'; // QC2-04: opaque backdrop, the showroom car showed through the rows
    this.wideScrim = true;
    const hd = header(ctx, this.st);
    this.renderHead = hd.render;
    this.renderLang = langIndicator(ctx, hd.right);
    this.title = h('h1', 'm-h1 m-abs', this.st);
    this.title.style.cssText = 'left:96px;top:150px';
    const nav = h('nav', 'm-nav', this.st);
    nav.style.cssText = 'top:250px;width:280px';
    this.setControls(TABS.map((tb) => {
      const c = navItem(ctx, nav, { id: `settings.tab.${tb}`, label: `settings.tabs.${tb}`, activate: () => this.enterRows() });
      c.el.classList.add('m-tab');
      c.onFocus = () => this.showTab(tb);
      return c;
    }));
    const content = h('div', 'm-abs', this.st);
    this.content = content;
    content.style.cssText = `left:416px;top:250px;width:1000px;height:${ROW_H * VIEW_ROWS}px;overflow:hidden`;
    content.addEventListener('wheel', (e) => {
      if (ctx.live('settings') && this.mode !== 'listen' && e.deltaY !== 0) this.scrollTo(this.scrollY + Math.sign(e.deltaY) * this.rowH * 2);
    }, { passive: true });
    this.touchScroll(content);
    for (const tb of TABS) {
      const el = h('div', 'm-pane', content);
      const inner = h('div', 'm-pane-in', el);
      el.hidden = true;
      this.panes.set(tb, { el, inner, ctls: [] });
    }
    this.foot = h('div', 'm-foot', this.st);
    this.foot.style.cssText = 'left:416px;right:auto;width:1000px;bottom:96px';
    this.footText = h('p', 'm-body', this.foot);
    this.renderBar = bottomBar(ctx, this.st, ['move', 'change', 'select', 'back']);
    this.rowsFocus = new FocusList({ reduced: ctx.reduced, changed: (_it, i) => this.onRowFocus(i) });
    this.buildPanes();
  }

  animated(): HTMLElement[] {
    return [this.st.querySelector('.m-nav')!, ...[...this.panes.values()].map((p) => p.el.parentElement!).slice(0, 1)];
  }

  // ---------------------------------------------------------------- panes
  private s(): Readonly<Settings> {
    return this.ctx.deps.settings.get();
  }

  private set(path: string, v: unknown): void {
    this.ctx.deps.settings.setPath(path, v);
  }

  private quality(): QualityPreset {
    const g = this.s().graphics;
    const base = QUALITY_PRESETS[g.preset === 'custom' ? 'high' : g.preset];
    return { ...base, ...g.custom } as QualityPreset;
  }

  private setCustom(patch: Partial<QualityPreset>): void {
    const g = this.s().graphics;
    const q = this.quality();
    const full: Partial<QualityPreset> = g.preset === 'custom' ? { ...g.custom } : {
      renderScale: q.renderScale, aa: q.aa, smaa: q.smaa, shadowSize: q.shadowSize, ao: q.ao, bloom: q.bloom, mirrors: q.mirrors,
      treeDensity: q.treeDensity, crowdDensity: q.crowdDensity,
    };
    this.set('graphics.custom', { ...full, ...patch });
    this.set('graphics.preset', 'custom');
    this.panes.get('graphics')!.ctls[0]!.render();
  }

  private buildPanes(): void {
    const ctx = this.ctx;
    const t = ctx.t;
    const lang = (): 'tr' | 'en' => ctx.lang();
    const pct = (v: number): string => fmt.pct(Math.round(v * 100), 0, lang());
    // GRAFİK
    {
      const p = this.panes.get('graphics')!.inner;
      const q = (): QualityPreset => this.quality();
      this.panes.get('graphics')!.ctls = [
        selectRow<QualityId | 'custom'>(ctx, p, {
          id: 'set.g.preset', label: () => t('settings.g.preset'), desc: 'settings.desc.preset',
          options: () => {
            const l: (QualityId | 'custom')[] = ['low', 'medium', 'high', 'ultra'];
            if (this.s().graphics.preset === 'custom') l.push('custom');
            return l.map((v) => opt(v, () => t(`settings.g.presetValue.${v}`)));
          },
          get: () => this.s().graphics.preset,
          set: (v) => {
            this.set('graphics.preset', v);
            for (const c of this.panes.get('graphics')!.ctls) c.render();
          },
        }),
        sliderRow(ctx, p, {
          id: 'set.g.renderScale', label: () => t('settings.g.renderScale'), min: 0.5, max: 1, step: 0.05, desc: 'settings.desc.renderScale',
          get: () => q().renderScale, set: (v) => this.setCustom({ renderScale: v }), fmt: (v) => pct(v),
        }),
        selectRow<string>(ctx, p, {
          id: 'set.g.aa', label: () => t('settings.g.aa'), desc: 'settings.desc.preset',
          options: () => ['fxaa', 'MEDIUM', 'HIGH', 'ULTRA'].map((v) => opt(v, () => t(`settings.g.aaValue.${v}`))),
          get: () => (q().aa === 'fxaa' ? 'fxaa' : q().smaa),
          set: (v) => this.setCustom(v === 'fxaa' ? { aa: 'fxaa' } : { aa: 'smaa', smaa: v as QualityPreset['smaa'] }),
        }),
        selectRow<QualityPreset['shadowSize']>(ctx, p, {
          id: 'set.g.shadowSize', label: () => t('settings.g.shadowSize'), desc: 'settings.desc.preset',
          options: () => ([1024, 2048, 4096] as const).map((v) => opt(v, () => String(v))),
          get: () => q().shadowSize, set: (v) => this.setCustom({ shadowSize: v }),
        }),
        selectRow<QualityPreset['ao']>(ctx, p, {
          id: 'set.g.ao', label: () => t('settings.g.ao'), desc: 'settings.desc.preset',
          options: () => (['off', 'half', 'full'] as const).map((v) => opt(v, () => t(`settings.g.aoValue.${v}`))),
          get: () => q().ao, set: (v) => this.setCustom({ ao: v }),
        }),
        toggleRow(ctx, p, { id: 'set.g.bloom', label: () => t('settings.g.bloom'), desc: 'settings.desc.preset', get: () => q().bloom, set: (v) => this.setCustom({ bloom: v }) }),
        selectRow<QualityPreset['mirrors']>(ctx, p, {
          id: 'set.g.mirrors', label: () => t('settings.g.mirrors'), desc: 'settings.desc.preset',
          options: () => (['static', 'low30', 'high60'] as const).map((v) => opt(v, () => t(`settings.g.mirrorsValue.${v}`))),
          get: () => q().mirrors, set: (v) => this.setCustom({ mirrors: v }),
        }),
        sliderRow(ctx, p, {
          id: 'set.g.trees', label: () => t('settings.g.treeDensity'), min: 0.2, max: 1.3, step: 0.1, desc: 'settings.desc.preset',
          get: () => q().treeDensity, set: (v) => this.setCustom({ treeDensity: v }), fmt: (v) => fmt.decimal(v, 1, lang()),
        }),
        sliderRow(ctx, p, {
          id: 'set.g.crowd', label: () => t('settings.g.crowdDensity'), min: 0.2, max: 1, step: 0.1, desc: 'settings.desc.preset',
          get: () => q().crowdDensity, set: (v) => this.setCustom({ crowdDensity: v }), fmt: (v) => fmt.decimal(v, 1, lang()),
        }),
        sliderRow(ctx, p, {
          id: 'set.g.fov', label: () => t('settings.g.fovOffset'), min: -10, max: 10, step: 1, desc: 'settings.desc.preset',
          get: () => this.s().graphics.fovOffset, set: (v) => this.set('graphics.fovOffset', v), fmt: (v) => `${v > 0 ? '+' : v < 0 ? fmt.MINUS : ''}${Math.abs(v)}°`,
        }),
        sliderRow(ctx, p, {
          id: 'set.g.shake', label: () => t('settings.g.cameraShake'), min: 0, max: 1, step: 0.1, desc: 'settings.desc.shake',
          get: () => this.s().graphics.cameraShake, set: (v) => this.set('graphics.cameraShake', v), fmt: pct,
        }),
        toggleRow(ctx, p, { id: 'set.g.motion', label: () => t('settings.g.motionEffects'), desc: 'settings.desc.motion', get: () => this.s().graphics.motionEffects, set: (v) => this.set('graphics.motionEffects', v) }),
        toggleRow(ctx, p, { id: 'set.g.fps', label: () => t('settings.g.showFps'), desc: 'settings.desc.fps', get: () => this.s().graphics.showFps, set: (v) => this.set('graphics.showFps', v) }),
        selectRow<CameraId>(ctx, p, {
          id: 'set.g.camera', label: () => t('settings.g.camera'), desc: 'settings.desc.preset',
          options: () => (['cockpit', 'tcam', 'nose', 'chaseNear', 'chaseFar'] as const).map((v) => opt(v, () => t(`settings.g.cameraValue.${v}`))),
          get: () => this.s().camera.default, set: (v) => this.set('camera.default', v),
        }),
      ];
    }
    // SES
    {
      const p = this.panes.get('audio')!.inner;
      // Sound on/off is master > 0: off stores the level and sets master 0 (silences everything at once), on restores it.
      const sound = toggleRow(ctx, p, { id: 'set.a.sound', label: () => t('settings.a.sound'), desc: 'settings.desc.audio',
        get: () => this.s().audio.master > 0,
        set: (on) => { this.set('audio.master', soundToggleMaster(on, this.s().audio.master)); renderAudio(); } });
      // The toggle and the master slider show one value: either change re-renders the pane.
      const renderAudio = (): void => { for (const c of this.panes.get('audio')!.ctls) c.render(); };
      this.panes.get('audio')!.ctls = [sound, ...(['master', 'engine', 'sfx', 'ambience', 'ui'] as const).map((k) => sliderRow(ctx, p, {
        id: `set.a.${k}`, label: () => t(`settings.a.${k}`), min: 0, max: 1, step: 0.05, desc: 'settings.desc.audio',
        get: () => this.s().audio[k], set: (v) => { this.set(`audio.${k}`, v); if (k === 'master') renderAudio(); }, fmt: pct,
      }))];
    }
    // KONTROLLER
    {
      const p = this.panes.get('controls')!.inner;
      const pad = ctx.deps.pad;
      const hasTouch = ctx.deps.touch?.profile().touch === true;
      const ctls: Ctl[] = [
        // Gamepad (2026-10-27): the keyboard stays the default driving device.
        selectRow<Settings['controls']['device']>(ctx, p, {
          id: 'set.c.device', label: () => t('settings.c.device'), desc: 'settings.desc.device',
          // Mobile (2026-11-21): 'touch' = the on-screen / tilt controls (first-run default on touch-only devices only).
          options: () => (hasTouch || this.s().controls.device === 'touch' ? (['keyboard', 'gamepad', 'auto', 'touch'] as const) : (['keyboard', 'gamepad', 'auto'] as const))
            .map((v) => opt(v, () => t(`settings.c.deviceValue.${v}`))),
          get: () => this.s().controls.device,
          set: (v) => {
            this.set('controls.device', v);
            if (v === 'touch' && this.s().controls.touch.steerMode === 'tilt') void ctx.deps.touch?.enableTilt();
          },
        }),
      ];
      // Touch rows: right under the device on a touch-only device, at the end on a touchscreen laptop, none on a plain desktop.
      const touchFirst = ctx.deps.touch?.profile().touchOnly === true;
      if (touchFirst) ctls.push(...this.touchRows(p));
      ctls.push(langEn(readonlyRow(ctx, p, {
        id: 'set.c.padStatus', label: () => t('settings.c.padStatus'), desc: 'settings.desc.device',
        value: () => pad?.live()?.name ?? t('settings.c.padNone'),
      })));
      // Controller test: a focusable row near the top (live values while the sliders below are tuned).
      this.padTest = padTestRow(ctx, p, pad);
      ctls.push(this.padTest);
      ctls.push(
        selectRow<Settings['controls']['layout']>(ctx, p, {
          id: 'set.c.layout', label: () => t('settings.c.layout'), desc: 'settings.desc.controls',
          options: () => (['combined', 'wasd', 'arrows'] as const).map((v) => opt(v, () => t(`settings.c.layoutValue.${v}`))),
          get: () => this.s().controls.layout, set: (v) => this.set('controls.layout', v),
        }),
        sliderRow(ctx, p, {
          id: 'set.c.steer', label: () => t('settings.c.steer'), min: 0.5, max: 1.5, step: 0.05, desc: 'settings.desc.controls',
          get: () => this.s().controls.steerSensitivity, set: (v) => this.set('controls.steerSensitivity', v), fmt: (v) => fmt.decimal(v, 2, lang()),
        }),
      );
      for (const a of BIND_ACTIONS) ctls.push(this.bindRow(p, a));
      type PadNum = 'steerDeadzone' | 'steerSensitivity' | 'steerLinearity' | 'triggerDeadzone' | 'throttleCurve' | 'brakeCurve' | 'vibrationStrength';
      const padSlider = (id: string, key: PadNum, label: string, min: number, max: number, step: number, f: (v: number) => string): Ctl => sliderRow(ctx, p, {
        id, label: () => t(label), min, max, step, desc: 'settings.desc.pad',
        get: () => this.s().controls.pad[key], set: (v) => this.set(`controls.pad.${key}`, v), fmt: f,
      });
      const dec = (d: number) => (v: number): string => fmt.decimal(v, d, lang());
      const padToggle = (id: string, key: 'speedSteer' | 'vibration', label: string): Ctl => toggleRow(ctx, p, {
        id, label: () => t(label), desc: 'settings.desc.pad', get: () => this.s().controls.pad[key], set: (v) => this.set(`controls.pad.${key}`, v),
      });
      // Built after the keyboard reset button: DOM order must equal focus order (index-based row scrolling).
      const padRows = (): Ctl[] => [
        padSlider('set.c.pad.deadzone', 'steerDeadzone', 'settings.c.padDeadzone', 0, 0.4, 0.01, pct),
        padSlider('set.c.pad.steer', 'steerSensitivity', 'settings.c.padSteer', 0.5, 1.5, 0.05, dec(2)),
        padSlider('set.c.pad.linearity', 'steerLinearity', 'settings.c.padLinearity', 1, 3, 0.1, dec(1)),
        padToggle('set.c.pad.speedSteer', 'speedSteer', 'settings.c.padSpeedSteer'),
        padSlider('set.c.pad.trigger', 'triggerDeadzone', 'settings.c.padTrigger', 0, 0.3, 0.01, pct),
        padSlider('set.c.pad.throttleCurve', 'throttleCurve', 'settings.c.padThrottleCurve', 0.5, 3, 0.1, dec(1)),
        padSlider('set.c.pad.brakeCurve', 'brakeCurve', 'settings.c.padBrakeCurve', 0.5, 3, 0.1, dec(1)),
        padToggle('set.c.pad.vibration', 'vibration', 'settings.c.padVibration'),
        padSlider('set.c.pad.vibStrength', 'vibrationStrength', 'settings.c.padVibStrength', 0, 1, 0.05, pct),
      ];
      this.resetCtl = button(ctx, h('div', 'm-row-btn', p), {
        id: 'set.c.reset', label: () => t(this.resetArmed ? 'settings.c.resetConfirm' : 'settings.c.reset'),
        activate: () => {
          if (!this.resetArmed) {
            this.resetArmed = true;
            this.resetCtl?.render();
            return;
          }
          this.resetArmed = false;
          ctx.deps.keys.resetBindings();
          this.lost.clear();
          for (const c of this.panes.get('controls')!.ctls) c.render();
        },
      });
      ctls.push(this.resetCtl, ...padRows());
      if (pad) {
        for (const a of PAD_BIND_ACTIONS) ctls.push(this.padBindRow(p, a));
        this.padResetCtl = button(ctx, h('div', 'm-row-btn', p), {
          id: 'set.c.pad.reset', label: () => t(this.padResetArmed ? 'settings.c.padResetConfirm' : 'settings.c.padReset'),
          activate: () => {
            if (!this.padResetArmed) {
              this.padResetArmed = true;
              this.padResetCtl?.render();
              return;
            }
            this.padResetArmed = false;
            pad.resetBindings();
            for (const c of this.panes.get('controls')!.ctls) c.render();
          },
        });
        ctls.push(this.padResetCtl);
      }
      if (!touchFirst && hasTouch) ctls.push(...this.touchRows(p));
      this.panes.get('controls')!.ctls = ctls;
      // Key test (not focusable, last in the pane so the row scroll maths above it is unchanged).
      this.keyTest = keyTestRow(ctx, p);
    }
    // YARDIMLAR
    {
      const p = this.panes.get('assists')!.inner;
      const rows = assistRows(ctx, p, {
        idPrefix: 'set.as', desc: 'settings.desc.assists',
        get: () => this.s().assists, set: (v) => this.set('assists', v),
        note: () => (ctx.prev() === 'pause' ? t('settings.nextSession') : ''),
      });
      rows.push(
        sliderRow(ctx, p, {
          id: 'set.as.difficulty', label: () => t('settings.gp.difficulty'), min: 0, max: 110, step: 5, desc: 'settings.desc.assists',
          // One difficulty value: the race setup (what a race actually starts with) follows this slider and vice versa.
          get: () => this.s().gameplay.difficulty, set: (v) => { this.set('gameplay.difficulty', v); this.ctx.deps.setup.set({ difficulty: v }); }, fmt: (v) => String(v),
        }),
        selectRow<number>(ctx, p, {
          id: 'set.as.flashbacks', label: () => t('settings.gp.flashbacks'), desc: 'settings.desc.assists',
          options: () => [0, 3, 5, -1].map((v) => opt(v, () => (v < 0 ? t('menu.race.unlimited') : String(v)))),
          get: () => this.s().gameplay.flashbacks, set: (v) => this.set('gameplay.flashbacks', v),
        }),
      );
      this.panes.get('assists')!.ctls = rows;
    }
    // HUD
    {
      const p = this.panes.get('hud')!.inner;
      this.panes.get('hud')!.ctls = [
        selectRow<Settings['hud']['mode']>(ctx, p, {
          id: 'set.h.mode', label: () => t('settings.h.mode'), desc: 'settings.desc.hudScale',
          options: () => (['full', 'minimal', 'off'] as const).map((v) => opt(v, () => t(`settings.h.modeValue.${v}`))),
          get: () => this.s().hud.mode, set: (v) => this.set('hud.mode', v),
        }),
        toggleRow(ctx, p, { id: 'set.h.minimap', label: () => t('settings.h.minimap'), desc: 'settings.desc.hudScale', get: () => this.s().hud.minimap, set: (v) => this.set('hud.minimap', v) }),
        selectRow<Settings['hud']['units']>(ctx, p, {
          id: 'set.h.units', label: () => t('settings.h.units'), desc: 'settings.desc.hudScale',
          options: () => (['kmh', 'mph'] as const).map((v) => opt(v, () => t(`settings.h.unitsValue.${v}`))),
          get: () => this.s().hud.units, set: (v) => this.set('hud.units', v),
        }),
        sliderRow(ctx, p, {
          id: 'set.h.scale', label: () => t('settings.h.scale'), min: 0.8, max: 1.25, step: 0.05, desc: 'settings.desc.hudScale',
          get: () => this.s().hud.scale, set: (v) => this.set('hud.scale', v), fmt: (v) => fmt.decimal(v, 2, lang()),
        }),
      ];
    }
    // DİL
    {
      const p = this.panes.get('language')!.inner;
      this.panes.get('language')!.ctls = [
        selectRow<'tr' | 'en'>(ctx, p, {
          id: 'set.l.lang', label: () => t('settings.l.lang'), desc: 'settings.desc.language',
          options: () => (['tr', 'en'] as const).map((v) => opt(v, () => t(`settings.l.langValue.${v}`))),
          get: () => ctx.lang(),
          set: (v) => {
            this.set('lang', v);
            ctx.deps.i18n.setLang(v);
          },
        }),
      ];
    }
    // ARAYÜZ
    {
      const p = this.panes.get('interface')!.inner;
      this.panes.get('interface')!.ctls = [
        selectRow<Settings['ui']['animations']>(ctx, p, {
          id: 'set.i.animations', label: () => t('settings.i.animations'), desc: 'settings.desc.animations',
          options: () => (['auto', 'on', 'off'] as const).map((v) => opt(v, () => t(`settings.i.animationsValue.${v}`))),
          get: () => this.s().ui.animations, set: (v) => this.set('ui.animations', v),
        }),
        toggleRow(ctx, p, { id: 'set.i.trailer', label: () => t('settings.i.trailer'), desc: 'settings.desc.trailer', get: () => this.s().ui.trailer, set: (v) => this.set('ui.trailer', v) }),
      ];
    }
  }

  /** Touch controls rows (mobile, 2026-11-21): steering mode, size, opacity, left-handed, tilt tuning + centre, pedals, haptics, live test. */
  private touchRows(p: HTMLElement): Ctl[] {
    const ctx = this.ctx;
    const t = ctx.t;
    const touch = ctx.deps.touch!;
    const lang = (): 'tr' | 'en' => ctx.lang();
    const ts = (): Readonly<Settings['controls']['touch']> => this.s().controls.touch;
    const pct = (v: number): string => fmt.pct(Math.round(v * 100), 0, lang());
    const dec = (d: number) => (v: number): string => fmt.decimal(v, d, lang());
    type Num = 'size' | 'opacity' | 'tiltSensitivity' | 'tiltDeadzone';
    const slider = (key: Num, label: string, desc: string, min: number, max: number, step: number, f: (v: number) => string): Ctl => sliderRow(ctx, p, {
      id: `set.c.touch.${key}`, label: () => t(label), min, max, step, desc,
      get: () => ts()[key], set: (v) => this.set(`controls.touch.${key}`, v), fmt: f,
    });
    const toggle = (key: 'leftHanded' | 'pedalSlide' | 'haptics', label: string, desc: string): Ctl => toggleRow(ctx, p, {
      id: `set.c.touch.${key}`, label: () => t(label), desc, get: () => ts()[key], set: (v) => this.set(`controls.touch.${key}`, v),
    });
    const tiltOff = (): boolean => ts().steerMode !== 'tilt';
    let calibrated = false;
    const rows: Ctl[] = [
      selectRow<Settings['controls']['touch']['steerMode']>(ctx, p, {
        id: 'set.c.touch.steerMode', label: () => t('touch.settings.steerMode'), desc: 'touch.desc.steerMode',
        options: () => (['buttons', 'wheel', 'tilt'] as const).map((v) => opt(v, () => t(`touch.settings.steerModeValue.${v}`))),
        get: () => ts().steerMode,
        set: (v) => {
          this.set('controls.touch.steerMode', v);
          // iOS asks for motion access inside this tap; Android simply starts the sensor.
          if (v === 'tilt') void touch.enableTilt();
          for (const c of rows) c.render();
        },
        note: () => (ts().steerMode === 'tilt' && !touch.profile().secure ? t('touch.settings.tiltNeedsHttps') : ''),
      }),
      slider('size', 'touch.settings.size', 'touch.desc.size', 0.8, 1.3, 0.05, dec(2)),
      slider('opacity', 'touch.settings.opacity', 'touch.desc.size', 0.2, 1, 0.05, pct),
      toggle('leftHanded', 'touch.settings.leftHanded', 'touch.desc.leftHanded'),
      sliderRow(ctx, p, {
        id: 'set.c.touch.tiltSensitivity', label: () => t('touch.settings.tiltSensitivity'), min: 0.5, max: 2, step: 0.05, desc: 'touch.desc.tilt',
        get: () => ts().tiltSensitivity, set: (v) => this.set('controls.touch.tiltSensitivity', v), fmt: dec(2), disabled: tiltOff,
      }),
      sliderRow(ctx, p, {
        id: 'set.c.touch.tiltDeadzone', label: () => t('touch.settings.tiltDeadzone'), min: 0, max: 0.2, step: 0.01, desc: 'touch.desc.tilt',
        get: () => ts().tiltDeadzone, set: (v) => this.set('controls.touch.tiltDeadzone', v), fmt: pct, disabled: tiltOff,
      }),
      button(ctx, h('div', 'm-row-btn', p), {
        id: 'set.c.touch.calibrate', desc: 'touch.desc.calibrate', disabled: tiltOff,
        label: () => (calibrated ? `${t('touch.settings.calibrate')} · ${t('touch.settings.calibrated', { d: fmt.decimal(ts().tiltCenter, 1, lang()) })}` : t('touch.settings.calibrate')),
        activate: () => {
          touch.calibrateTilt();
          calibrated = true;
          ctx.sound('confirm');
          setTimeout(() => this.touchTest?.render(), 0);
          for (const c of rows) c.render();
        },
      }),
      toggle('pedalSlide', 'touch.settings.pedalSlide', 'touch.desc.pedalSlide'),
      toggle('haptics', 'touch.settings.haptics', 'touch.desc.haptics'),
    ];
    this.touchTest = readonlyRow(ctx, p, {
      id: 'set.c.touch.test', label: () => t('touch.settings.test'), desc: 'touch.desc.tilt',
      value: () => {
        const l = touch.live();
        return t('touch.settings.testValues', { a: l.tiltOk ? fmt.decimal(l.tiltDeg, 1, lang()) : '—', s: fmt.decimal(l.steer, 2, lang()), t: pct(l.throttle), b: pct(l.brake) });
      },
    });
    rows.push(this.touchTest);
    return rows;
  }

  /** Key-binding row: label + 2 chips; ← / → pick the slot, Enter listens for the next key. */
  private bindRow(parent: HTMLElement, action: ActionId): Ctl {
    const ctx = this.ctx;
    const el = h('button', 'm-row m-bind', parent);
    el.type = 'button';
    el.dataset.focusId = `set.c.bind.${action}`;
    h('span', 'notch', el);
    const lbl = h('span', 'lbl', el);
    const chips = h('span', 'ctl', el);
    const c0 = h('span', 'apx-kc', chips);
    const c1 = h('span', 'apx-kc', chips);
    let slot = 0;
    let listening = -1;
    const draw = (): void => {
      lbl.textContent = ctx.t(`settings.c.action.${action}`);
      const codes = ctx.deps.keys.bindings()[action] ?? [];
      [c0, c1].forEach((c, i) => {
        const code = codes[i];
        const arrow = listening !== i && code ? ARROWS[code] : undefined;
        if (arrow) c.replaceChildren(icon(arrow));
        else c.textContent = listening === i ? ctx.t('settings.c.listening') : code ? ctx.upper(ctx.deps.keys.label(code)) : ctx.t('settings.c.empty');
        c.classList.toggle('is-listen', listening === i);
        c.classList.toggle('is-focus', el.classList.contains('is-focus') && slot === i && listening < 0);
        c.classList.toggle('is-empty', !code && listening !== i);
        c.classList.toggle('is-lost', !code && i === 0 && this.lost.has(action));
      });
    };
    const ctl: Ctl = {
      id: `set.c.bind.${action}`, el, desc: action === 'gearDown' ? 'settings.desc.reverse' : 'settings.desc.controls', // D-040
      left: () => {
        if (slot === 0) return false;
        slot = 0;
        ctx.sound('move');
        draw();
        return true;
      },
      right: () => {
        if (slot === 1) return false;
        slot = 1;
        ctx.sound('move');
        draw();
        return true;
      },
      onFocus: () => draw(),
      // A click on a chip picks that slot; then listen as Enter does.
      click: (t) => {
        const k = partOf(t, [c0, c1]);
        if (k >= 0) slot = k;
        ctl.activate!();
      },
      activate: () => {
        listening = slot;
        this.mode = 'listen';
        ctx.sound('open');
        draw();
        // Defer so the Enter that opened listening is not captured as the new key.
        setTimeout(() => ctx.deps.keys.startRebind(action, slot, (r) => this.onRebind(r, () => {
          listening = -1;
          draw();
        })), 0);
      },
      render: draw,
    };
    return ctl;
  }

  /** Gamepad binding row: label + one badge; Enter / A listens for the next pad button (Start or Esc cancels). */
  private padBindRow(parent: HTMLElement, action: ActionId): Ctl {
    const ctx = this.ctx;
    const pad = ctx.deps.pad!;
    const el = h('button', 'm-row m-bind', parent);
    el.type = 'button';
    el.dataset.focusId = `set.c.padBind.${action}`;
    h('span', 'notch', el);
    const lbl = h('span', 'lbl', el);
    const chips = h('span', 'ctl', el);
    const c0 = padChip(chips, 0);
    let listening = false;
    const plain = (text: string): void => {
      c0.classList.remove('apx-pad');
      delete c0.dataset.pad;
      c0.textContent = text;
    };
    const draw = (): void => {
      lbl.textContent = ctx.t('settings.c.padBind', { action: ctx.t(`settings.c.action.${action}`) });
      const b = pad.bindings()[action]?.[0];
      if (listening) plain(ctx.t('settings.c.padListening'));
      else if (b === undefined) plain(ctx.t('settings.c.empty'));
      else setPadChip(c0, b);
      c0.classList.toggle('is-listen', listening);
      c0.classList.toggle('is-empty', b === undefined && !listening);
      c0.classList.toggle('is-lost', b === undefined && !listening && this.lost.has(action));
    };
    return {
      id: `set.c.padBind.${action}`, el, desc: 'settings.desc.padBind',
      onFocus: () => draw(),
      activate: () => {
        listening = true;
        this.mode = 'listen';
        this.padListen = true;
        ctx.sound('open');
        draw();
        pad.startRebind(action, (r) => this.onPadRebind(r, () => {
          listening = false;
          draw();
        }));
      },
      render: draw,
    };
  }

  private onPadRebind(r: PadRebindResult, done: () => void): void {
    const ctx = this.ctx;
    this.mode = 'rows';
    this.padListen = false;
    done();
    if (r.ok) {
      this.lost.delete(r.action);
      if (r.replaced) {
        this.lost.add(r.replaced);
        this.warn(ctx.t('settings.c.padReplaced', { key: padText(r.button), action: ctx.t(`settings.c.action.${r.replaced}`) }));
      }
      ctx.sound('confirm');
    } else if (r.reason === 'reserved') {
      this.warn(ctx.t('settings.c.padReserved'));
      ctx.sound('error');
    } else ctx.sound('back');
    for (const c of this.panes.get('controls')!.ctls) c.render();
  }

  private onRebind(r: RebindResult, done: () => void): void {
    const ctx = this.ctx;
    this.mode = 'rows';
    done();
    if (r.ok) {
      this.lost.delete(r.action);
      if (r.replaced) {
        this.lost.add(r.replaced);
        this.warn(ctx.t('settings.c.replaced', { key: ctx.upper(ctx.deps.keys.label(r.code)), action: ctx.t(`settings.c.action.${r.replaced}`) }));
      }
      ctx.sound('confirm');
    } else if (r.reason === 'modifier') {
      this.warn(ctx.t('settings.c.modifier'));
      ctx.sound('error');
    } else if (r.reason === 'reserved') {
      this.warn(ctx.t('settings.c.reserved'));
      ctx.sound('error');
    } else ctx.sound('back');
    for (const c of this.panes.get('controls')!.ctls) c.render();
    this.keyTest?.render();
  }

  private warn(text: string): void {
    this.warnUntil = performance.now() + 3000;
    this.foot.dataset.warn = '1';
    this.footText.textContent = text;
    setTimeout(() => {
      if (performance.now() >= this.warnUntil) {
        delete this.foot.dataset.warn;
        this.updateDesc();
      }
    }, 3050);
  }

  // ---------------------------------------------------------------- focus
  private showTab(tb: Tab): void {
    this.tab = tb;
    for (const [k, p] of this.panes) p.el.hidden = k !== tb;
    const pane = this.panes.get(tb)!;
    for (const c of pane.ctls) c.render();
    this.scrollY = 0;
    pane.inner.style.transform = 'translateY(0)';
    this.measure();
    this.updateDesc();
  }

  /** Touch UI: thumb-sized rows (touch.css) change the pitch; on a phone the column also shrinks to what the screen shows. */
  private measure(): void {
    const touch = this.ctx.deps.touch?.uiTouch() === true;
    const row = this.panes.get(this.tab)!.inner.querySelector<HTMLElement>('.m-row');
    this.rowH = touch && row && row.offsetHeight > 0 ? row.offsetHeight : ROW_H;
    let rows = VIEW_ROWS;
    if (touch) {
      const kv = parseFloat(getComputedStyle(this.el).getPropertyValue('--mkv')) || 1;
      const avail = Math.min(ROW_H * VIEW_ROWS, window.innerHeight / kv - 250 - 24);
      rows = Math.max(3, Math.floor(avail / this.rowH));
    }
    this.viewRows = rows;
    this.content.style.height = `${this.rowH * rows}px`;
    this.content.style.touchAction = touch ? 'none' : '';
    this.scrollTo(this.scrollY);
  }

  /** Touch: drag the clipped column to scroll it; a drag never also clicks the row it started on. */
  private touchScroll(content: HTMLElement): void {
    let drag: { id: number; y: number; s: number; moved: boolean } | null = null;
    const kv = (): number => parseFloat(getComputedStyle(this.el).getPropertyValue('--mkv')) || 1;
    content.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch' || this.mode === 'listen') return;
      drag = { id: e.pointerId, y: e.clientY, s: this.scrollY, moved: false };
      this.dragged = false;
    });
    content.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const dy = e.clientY - drag.y;
      if (!drag.moved && Math.abs(dy) < 10) return;
      drag.moved = true;
      this.dragged = true;
      this.scrollTo(drag.s - dy / kv());
    });
    const end = (e: PointerEvent): void => {
      if (drag && e.pointerId === drag.id) drag = null;
    };
    content.addEventListener('pointerup', end);
    content.addEventListener('pointercancel', end);
    content.addEventListener('click', (e) => {
      if (!this.dragged) return;
      this.dragged = false;
      e.stopPropagation();
    }, true);
  }

  private scrollTo(y: number): void {
    const pane = this.panes.get(this.tab)!;
    this.scrollY = Math.max(0, Math.min(Math.max(0, pane.ctls.length - this.viewRows) * this.rowH, y));
    pane.inner.style.transform = `translateY(${-this.scrollY}px)`;
  }

  private enterRows(): void {
    const pane = this.panes.get(this.tab)!;
    this.rowsFocus.setItems(pane.ctls);
    this.mode = 'rows';
    this.rowsFocus.set(0);
  }

  private leaveRows(): void {
    this.rowsFocus.blur();
    this.mode = 'tabs';
    this.resetArmed = false;
    this.resetCtl?.render();
    this.focus.set(this.focus.index, false);
    this.focus.current()?.el.focus({ preventScroll: true }); // QC2-14
    this.updateDesc();
  }

  private onRowFocus(i: number): void {
    const pane = this.panes.get(this.tab)!;
    const total = pane.ctls.length;
    // Keyboard centres the row; the pointer only keeps it visible (re-centring would move rows under the cursor).
    const rh = this.rowH;
    const vr = this.viewRows;
    if (this.byPointer) this.scrollTo(Math.max((i + 1 - vr) * rh, Math.min(i * rh, this.scrollY)));
    else this.scrollTo(Math.max(0, Math.min(total - vr, i - Math.floor(vr / 2))) * rh);
    for (const c of pane.ctls) if (c.el.classList.contains('m-bind')) c.render();
    this.updateDesc();
  }

  protected override updateDesc(): void {
    if (!this.footText || this.foot.dataset.warn) return;
    const c = (this.mode === 'tabs' ? null : this.rowsFocus.current()) as Ctl | null;
    const first = this.panes.get(this.tab)?.ctls[0];
    const key = c?.desc ?? first?.desc;
    this.footText.textContent = key ? this.ctx.t(key) : '';
  }

  // ---------------------------------------------------------------- pointer
  private rowAt(target: Element): number {
    const el = target.closest<HTMLElement>('[data-focus-id]');
    return el ? this.panes.get(this.tab)!.ctls.findIndex((c) => c.el === el) : -1;
  }

  /** Pointer on row i: rows level with that row focused, as ↑/↓ would. False when the row cannot take focus. */
  private pointRow(i: number): boolean {
    if (this.mode !== 'tabs' && this.mode !== 'rows') return false;
    const ctls = this.panes.get(this.tab)!.ctls;
    if (ctls[i]!.disabled?.()) return false;
    if (this.mode === 'tabs') {
      this.rowsFocus.setItems(ctls);
      this.mode = 'rows';
    }
    if (i !== this.rowsFocus.index) {
      this.byPointer = true;
      if (this.rowsFocus.set(i)) this.ctx.sound('move');
      this.byPointer = false;
    }
    if (ctls[i] !== this.resetCtl && this.resetArmed) {
      this.resetArmed = false;
      this.resetCtl?.render();
    }
    return true;
  }

  // Tabs are click-only: hover-previewing them would swap the pane while the cursor travels to the rows.
  protected override pointerOver(target: Element): void {
    const i = this.rowAt(target);
    if (i >= 0) this.pointRow(i);
  }

  protected override pointerDown(e: PointerEvent): void {
    const i = this.rowAt(e.target as Element);
    if (i >= 0 && this.pointRow(i)) this.panes.get(this.tab)!.ctls[i]!.press?.(e);
  }

  protected override pointerClick(target: Element): void {
    if (this.mode !== 'tabs' && this.mode !== 'rows') return;
    const i = this.rowAt(target);
    if (i >= 0) {
      if (!this.pointRow(i)) return;
      const c = this.panes.get(this.tab)!.ctls[i]!;
      if (c.click) c.click(target);
      else c.activate?.();
      return;
    }
    const hit = this.pointerHit(target);
    if (!hit) return;
    if (this.mode === 'rows') this.leaveRows();
    this.pointerFocus(hit.list, hit.i);
  }

  protected back(): void {
    this.ctx.sound('back');
    this.ctx.go(this.ctx.prev() === 'pause' ? 'pause' : 'mainMenu');
  }

  override action(a: Parameters<ListScreen['action']>[0]): void {
    if (this.mode === 'listen') {
      // A pad rebind swallows pad input; Esc on the keyboard cancels it.
      if (this.padListen && a === 'menuBack') this.ctx.deps.pad?.cancelRebind();
      return;
    }
    // Gamepad LB / RB: previous / next tab from either level.
    if (a === 'menuTabPrev' || a === 'menuTabNext') {
      if (this.mode === 'rows') this.leaveRows();
      if (this.focus.move(a === 'menuTabPrev' ? -1 : 1)) this.ctx.sound('move');
      return;
    }
    if (this.mode === 'tabs') {
      if (a === 'menuRight') {
        this.ctx.sound('confirm');
        this.enterRows();
        return;
      }
      super.action(a);
      return;
    }
    const f = this.rowsFocus;
    const cur = f.current();
    switch (a) {
      case 'menuUp':
        if (f.move(-1)) this.ctx.sound('move');
        break;
      case 'menuDown':
        if (f.move(1)) this.ctx.sound('move');
        break;
      case 'menuLeft':
        // A value control at its minimum stays; only rows that cannot consume ← (buttons, key chips at slot 0) leave.
        if (!cur?.left || (cur.left() === false && !(cur as Ctl).value)) this.leaveRows();
        break;
      case 'menuRight':
        cur?.right?.();
        break;
      case 'menuConfirm':
        cur?.activate?.();
        break;
      case 'menuBack':
        this.ctx.sound('back');
        this.leaveRows();
        break;
      default:
        break;
    }
    if (this.mode === 'rows' && cur !== this.resetCtl && this.resetArmed) {
      this.resetArmed = false;
      this.resetCtl?.render();
    }
    if (this.mode === 'rows' && cur !== this.padResetCtl && this.padResetArmed) {
      this.padResetArmed = false;
      this.padResetCtl?.render();
    }
  }

  override key(code: string): boolean {
    if (this.mode === 'listen') return true;
    if (this.mode === 'rows') {
      if (code === 'Home') return this.rowsFocus.home() || true;
      if (code === 'End') return this.rowsFocus.end() || true;
      return false;
    }
    return super.key(code);
  }

  override enter(from: ScreenId | null): void {
    this.mode = 'tabs';
    this.rowsFocus.blur();
    delete this.foot.dataset.warn;
    super.enter(from);
    this.showTab(TABS[Math.max(0, this.focus.index)]!);
    this.keyTest?.render();
    this.padTest?.render();
    this.padTest?.start();
    // Touch test row: live tilt / pedal values while the settings are open.
    if (this.touchTest && !this.touchTimer) this.touchTimer = setInterval(() => this.touchTest?.render(), 200);
  }

  override dispose(): void {
    this.keyTest?.dispose();
    this.keyTest = null;
    this.padTest?.dispose();
    this.padTest = null;
    if (this.touchTimer) clearInterval(this.touchTimer);
    this.touchTimer = null;
    this.rowsFocus.dispose();
    super.dispose();
  }

  override leave(): void {
    if (this.mode === 'listen') {
      this.ctx.deps.keys.cancelRebind();
      this.ctx.deps.pad?.cancelRebind();
    }
    this.padListen = false;
    this.padTest?.stop();
    if (this.touchTimer) clearInterval(this.touchTimer);
    this.touchTimer = null;
    this.mode = 'tabs';
    super.leave();
  }

  override render(): void {
    super.render();
    this.renderHead();
    this.renderLang();
    this.title.textContent = this.ctx.t('settings.heading');
    this.renderBar();
    for (const c of this.panes.get(this.tab)!.ctls) c.render();
    this.updateDesc();
  }
}
