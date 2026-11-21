// i18n service (§3.10): t(key, params) with {name} substitution, TR default, EN second, tr-TR upper-casing.

import type { Lang } from '../../contracts/common';
import type { EventBus, EventMap } from '../../contracts/events';
import type { I18n } from '../../contracts/ui';
import { LANGS, collectDictionaries, flattenDict, type NamespaceTables } from './dictionaries';

export type { Dict, DictOf } from './types';
export { LANGS, collectDictionaries, flattenDict } from './dictionaries';

export interface I18nImpl extends I18n {
  has(key: string): boolean;
  /** Locale-aware upper-casing for the current language (tr: i -> İ, ı -> I). */
  upper(s: string): string;
  /** Keys looked up but missing in the current language (dev aid). */
  missing(): readonly string[];
}

export interface I18nOptions {
  lang?: Lang;
  bus?: EventBus<EventMap>;
  tables?: NamespaceTables;
  /** Keep <html lang> in sync (default true when a document exists). */
  syncDocumentLang?: boolean;
}

/** Upper-cases with Turkish rules for 'tr' (istanbul -> İSTANBUL) and English rules otherwise. */
export function upperFor(s: string, lang: Lang): string {
  return s.toLocaleUpperCase(lang === 'tr' ? 'tr-TR' : 'en-US');
}

export function lowerFor(s: string, lang: Lang): string {
  return s.toLocaleLowerCase(lang === 'tr' ? 'tr-TR' : 'en-US');
}

const PARAM_RE = /\{(\w+)\}/g;

export function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(PARAM_RE, (m, name: string) => (Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : m));
}

export function isLang(v: unknown): v is Lang {
  return v === 'tr' || v === 'en';
}

export function createI18n(opts: I18nOptions = {}): I18nImpl {
  const tables = opts.tables ?? collectDictionaries();
  const flat: Record<Lang, Map<string, string>> = { tr: new Map(), en: new Map() };
  for (const l of LANGS) {
    for (const [ns, dict] of Object.entries(tables[l])) flattenDict(dict, ns, flat[l]);
  }
  const sync = opts.syncDocumentLang ?? typeof document !== 'undefined';
  let current: Lang = opts.lang ?? 'tr';
  const missing = new Set<string>();

  const applyDocLang = (): void => {
    if (sync && typeof document !== 'undefined') document.documentElement.lang = current;
  };
  applyDocLang();

  return {
    lang: () => current,
    setLang(l) {
      if (l === current) return;
      current = l;
      applyDocLang();
      opts.bus?.emit('lang:changed', { lang: l });
    },
    t(key, params) {
      let s = flat[current].get(key);
      if (s === undefined) {
        if (!missing.has(key)) {
          missing.add(key);
          console.warn(`[i18n] missing key "${key}" (${current})`);
        }
        s = flat.tr.get(key) ?? key;
      }
      return interpolate(s, params);
    },
    has: (key) => flat[current].has(key),
    upper: (s) => upperFor(s, current),
    missing: () => [...missing],
  };
}
