// Namespace discovery (§2/§3.10): every `/src/**/i18n/<ns>.<lang>.ts` default export becomes namespace `<ns>`.
// No shared registry file: adding a pair of files is enough. Namespace names must be unique across modules.

import type { Lang } from '../../contracts/common';
import type { Dict } from './types';

export const LANGS: readonly Lang[] = ['tr', 'en'];

export type NamespaceTables = Record<Lang, Record<string, Dict>>;

const modules = import.meta.glob('/src/**/i18n/*.{tr,en}.ts', { eager: true, import: 'default' });

/** Groups the discovered dictionaries by language and namespace; reports duplicate namespaces. */
export function collectDictionaries(): NamespaceTables & { sources: Record<string, string[]> } {
  const out: NamespaceTables = { tr: {}, en: {} };
  const sources: Record<string, string[]> = {};
  for (const [path, mod] of Object.entries(modules)) {
    const m = /\/([^/]+)\.(tr|en)\.ts$/.exec(path);
    if (!m) continue;
    const ns = m[1]!;
    const lang = m[2] as Lang;
    const dir = path.slice(0, path.length - m[0].length);
    if (lang === 'tr') (sources[ns] ??= []).push(dir);
    if (out[lang][ns]) {
      console.error(`[i18n] duplicate namespace "${ns}" (${lang}) at ${path}`);
      continue;
    }
    if (typeof mod !== 'object' || mod === null) {
      console.error(`[i18n] ${path} has no default-exported dictionary`);
      continue;
    }
    out[lang][ns] = mod as Dict;
  }
  return { ...out, sources };
}

/** Flattens a nested dictionary into `prefix.path -> string`. */
export function flattenDict(dict: Dict, prefix: string, out: Map<string, string>): Map<string, string> {
  for (const [k, v] of Object.entries(dict)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') out.set(key, v);
    else flattenDict(v, key, out);
  }
  return out;
}
