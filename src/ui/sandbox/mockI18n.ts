// Sandbox-only i18n: the real dictionaries plus a fallback `notify` namespace (Örnek veri) used only while the
// Lead's `src/game/hud/i18n/notify.*.ts` does not exist yet. Shape the UI reads (proposed to the Lead):
// `notify.<path>.title` (required), `.detail` and `.chip` (optional), all sentence case, `{param}` names as ui-hud §3.2.

import type { Lang } from '../../contracts/common';
import { collectDictionaries, createI18n, type I18nImpl } from '../../core/i18n/index';
import type { Dict } from '../../core/i18n/types';

const TR: Dict = {
  lap: {
    fastest: { title: 'en hızlı tur', detail: '{code} · {time}' },
    personalBest: { title: 'kişisel en iyi', detail: '{time} · {delta}' },
  },
  limits: { warning: { title: 'pist sınırları {n}/3', detail: 'T{corner} · bir sonraki ihlal ceza' } },
  start: { jumpStart: { title: 'erken kalkış', chip: '+{s} sn' } },
  flag: { yellow: { title: 'sarı bayrak', detail: 'sektör {n}' }, blue: { title: 'mavi bayrak', detail: 'arkadan gelen: {code}' } },
  drs: { enabled: { title: 'DRS etkin' } },
  weather: { rainSoon: { title: 'yağmur {min} dk içinde', detail: '%{p} olasılık' }, intersNow: { title: 'pite gir', detail: 'ara lastik' } },
};
const EN: Dict = {
  lap: {
    fastest: { title: 'fastest lap', detail: '{code} · {time}' },
    personalBest: { title: 'personal best', detail: '{time} · {delta}' },
  },
  limits: { warning: { title: 'track limits {n}/3', detail: 'T{corner} · next offence penalised' } },
  start: { jumpStart: { title: 'jump start', chip: '+{s} sec' } },
  flag: { yellow: { title: 'yellow flag', detail: 'sector {n}' }, blue: { title: 'blue flag', detail: 'car behind: {code}' } },
  drs: { enabled: { title: 'DRS enabled' } },
  weather: { rainSoon: { title: 'rain in {min} min', detail: '{p}% chance' }, intersNow: { title: 'box for inters', detail: 'intermediates' } },
};

export function createSandboxI18n(lang: Lang): I18nImpl {
  const all = collectDictionaries();
  const tables = { tr: { ...all.tr }, en: { ...all.en } };
  if (!tables.tr.notify) tables.tr.notify = TR;
  if (!tables.en.notify) tables.en.notify = EN;
  return createI18n({ lang, tables });
}
