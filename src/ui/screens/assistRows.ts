// Assist rows shared by the race setup (step 4) and the settings YARDIMLAR tab: preset + the 10 AssistSettings
// rows (ui-hud §7). Editing any row turns the preset into ÖZEL; picking a preset applies it (core ASSIST_PRESETS).

import type { AssistSettings } from '../../contracts/race';
import { ASSIST_PRESETS } from '../../core/index';
import { selectRow, toggleRow, type Ctl, type Option } from '../controls';
import type { ScreenCtx } from './ctx';

export type PresetId = keyof typeof ASSIST_PRESETS | 'custom';

export function presetOf(a: AssistSettings): PresetId {
  for (const k of ['beginner', 'intermediate', 'expert'] as const) {
    const p = ASSIST_PRESETS[k];
    if ((Object.keys(p) as (keyof AssistSettings)[]).every((f) => p[f] === a[f])) return k;
  }
  return 'custom';
}

const opt = <T>(v: T, label: () => string): Option<T> => ({ v, label });

export function assistRows(ctx: ScreenCtx, parent: HTMLElement, o: { idPrefix: string; get: () => AssistSettings; set: (a: AssistSettings) => void; desc: string; note?: () => string }): Ctl[] {
  const t = ctx.t;
  const a = o.get;
  let rows: Ctl[] = [];
  const setA = (p: Partial<AssistSettings>): void => {
    o.set({ ...a(), ...p });
    rows[0]?.render();
  };
  const bool = (k: 'steering' | 'abs' | 'pit' | 'ers' | 'drs' | 'kbBrakeLimiter'): Ctl =>
    toggleRow(ctx, parent, { id: `${o.idPrefix}.${k}`, label: () => t(`menu.assists.${k}`), desc: o.desc, get: () => a()[k], set: (v) => setA({ [k]: v }) });
  rows = [
    selectRow<PresetId>(ctx, parent, {
      id: `${o.idPrefix}.preset`, label: () => t('menu.assists.preset'), desc: o.desc, note: o.note,
      options: () => {
        const list: PresetId[] = presetOf(a()) === 'custom' ? ['beginner', 'intermediate', 'expert', 'custom'] : ['beginner', 'intermediate', 'expert'];
        return list.map((v) => opt(v, () => t(`menu.assists.presetValue.${v}`)));
      },
      get: () => presetOf(a()),
      set: (v) => {
        if (v === 'custom') return;
        o.set({ ...ASSIST_PRESETS[v] });
        for (const r of rows) r.render();
      },
    }),
    bool('steering'),
    selectRow<AssistSettings['braking']>(ctx, parent, {
      id: `${o.idPrefix}.braking`, label: () => t('menu.assists.braking'), desc: o.desc,
      options: () => (['off', 'low', 'medium', 'high'] as const).map((v) => opt(v, () => t(`menu.assists.level.${v}`))),
      get: () => a().braking, set: (v) => setA({ braking: v }),
    }),
    bool('abs'),
    selectRow<AssistSettings['tc']>(ctx, parent, {
      id: `${o.idPrefix}.tc`, label: () => t('menu.assists.tc'), desc: o.desc,
      options: () => (['off', 'medium', 'full'] as const).map((v) => opt(v, () => t(`menu.assists.level.${v}`))),
      get: () => a().tc, set: (v) => setA({ tc: v }),
    }),
    selectRow<AssistSettings['gearbox']>(ctx, parent, {
      id: `${o.idPrefix}.gearbox`, label: () => t('menu.assists.gearbox'), desc: o.desc,
      options: () => (['auto', 'manual'] as const).map((v) => opt(v, () => t(`menu.assists.gearboxValue.${v}`))),
      get: () => a().gearbox, set: (v) => setA({ gearbox: v }),
    }),
    selectRow<AssistSettings['racingLine']>(ctx, parent, {
      id: `${o.idPrefix}.racingLine`, label: () => t('menu.assists.racingLine'), desc: o.desc,
      options: () => (['off', 'corners', 'full'] as const).map((v) => opt(v, () => t(`menu.assists.lineValue.${v}`))),
      get: () => a().racingLine, set: (v) => setA({ racingLine: v }),
    }),
    bool('pit'),
    bool('ers'),
    bool('drs'),
    bool('kbBrakeLimiter'),
  ];
  return rows;
}
