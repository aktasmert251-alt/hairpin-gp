// S-AR-02: TR and EN dictionaries are interchangeable (ARCHITECTURE §10.3).
//   * every `<ns>.tr.ts` has an `<ns>.en.ts` next to it (and the reverse);
//   * every namespace is defined in exactly one module folder, in the folder of its owner;
//   * identical key sets and identical `{param}` names per key; no empty values; balanced braces;
//   * D-003: track names are pre-composed upper case in their own language.

import { describe, expect, it } from 'vitest';
import { LANGS, collectDictionaries, flattenDict } from '../../src/core/i18n/dictionaries';
import { SRC, rel, walkFiles } from '../helpers/paths';

const PARAM = /\{([^{}]*)\}/g;

function paramsOf(s: string): string[] {
  return [...s.matchAll(PARAM)].map((m) => m[1]!).sort();
}

/** ARCHITECTURE §10.3: namespaces and the folder that owns them. Unknown namespaces are allowed (new modules) but listed. */
const NAMESPACE_HOME: Record<string, string> = {
  common: 'src/core/i18n', errors: 'src/core/i18n', tracks: 'src/core/i18n',
  notify: 'src/game/hud/i18n',
  menu: 'src/ui/i18n', settings: 'src/ui/i18n', hud: 'src/ui/i18n', results: 'src/ui/i18n', tt: 'src/ui/i18n', loading: 'src/ui/i18n', credits: 'src/ui/i18n',
};

const tables = collectDictionaries();
const dictFiles = walkFiles(SRC, (f) => /\/i18n\/[^/]+\.(tr|en)\.ts$/.test(f)).map(rel);

describe('S-AR-02 i18n parity', () => {
  it('discovers dictionaries and both languages', () => {
    expect(LANGS).toEqual(['tr', 'en']);
    expect(dictFiles.length).toBeGreaterThanOrEqual(10);
    expect(Object.keys(tables.tr).length).toBeGreaterThanOrEqual(5);
  });

  it('every <ns>.tr.ts has an <ns>.en.ts in the same folder and vice versa', () => {
    const set = new Set(dictFiles);
    const missing: string[] = [];
    for (const f of dictFiles) {
      const other = f.endsWith('.tr.ts') ? f.replace(/\.tr\.ts$/, '.en.ts') : f.replace(/\.en\.ts$/, '.tr.ts');
      if (!set.has(other)) missing.push(`${f}  has no sibling ${other}`);
    }
    expect(missing, missing.join('\n')).toEqual([]);
  });

  it('each namespace is defined exactly once and lives in the folder of its owner', () => {
    const problems: string[] = [];
    for (const [ns, dirs] of Object.entries(tables.sources)) {
      if (dirs.length !== 1) problems.push(`namespace "${ns}" is defined in ${dirs.length} folders: ${dirs.join(', ')}`);
      const home = NAMESPACE_HOME[ns];
      if (home && dirs[0] !== `/${home}`) problems.push(`namespace "${ns}" should live in ${home} (found ${dirs[0]})`);
    }
    expect(problems, problems.join('\n')).toEqual([]);
  });

  it('TR and EN define the same namespaces, keys and {param} names', () => {
    expect(Object.keys(tables.en).sort(), 'namespaces').toEqual(Object.keys(tables.tr).sort());
    const problems: string[] = [];
    for (const ns of Object.keys(tables.tr)) {
      const tr = flattenDict(tables.tr[ns]!, ns, new Map());
      const en = flattenDict(tables.en[ns]!, ns, new Map());
      for (const k of tr.keys()) if (!en.has(k)) problems.push(`${k}: missing in EN`);
      for (const k of en.keys()) if (!tr.has(k)) problems.push(`${k}: missing in TR`);
      for (const [k, v] of tr) {
        const e = en.get(k);
        if (e === undefined) continue;
        const pt = paramsOf(v).join(',');
        const pe = paramsOf(e).join(',');
        if (pt !== pe) problems.push(`${k}: {params} differ (tr: ${pt || '-'}, en: ${pe || '-'})`);
      }
    }
    expect(problems, problems.join('\n')).toEqual([]);
  });

  it('values are non-empty strings with balanced braces and no leftover placeholders', () => {
    const problems: string[] = [];
    for (const lang of LANGS) {
      for (const [ns, dict] of Object.entries(tables[lang])) {
        for (const [k, v] of flattenDict(dict, ns, new Map())) {
          if (v.trim().length === 0) problems.push(`${k} (${lang}): empty`);
          const stripped = v.replace(PARAM, '');
          if (/[{}]/.test(stripped)) problems.push(`${k} (${lang}): unbalanced brace in "${v}"`);
          if (/\bTODO\b|\bFIXME\b|\blorem\b/i.test(v)) problems.push(`${k} (${lang}): placeholder text "${v}"`);
        }
      }
    }
    expect(problems, problems.join('\n')).toEqual([]);
  });

  it('D-003: track names are pre-composed upper case in their own language', () => {
    const tr = flattenDict(tables.tr.tracks ?? {}, 'tracks', new Map());
    const en = flattenDict(tables.en.tracks ?? {}, 'tracks', new Map());
    expect(tr.size).toBeGreaterThanOrEqual(3);
    for (const [k, v] of tr) expect(v, `${k} (tr)`).toBe(v.toLocaleUpperCase('tr-TR'));
    for (const [k, v] of en) expect(v, `${k} (en)`).toBe(v.toLocaleUpperCase('en-US'));
    expect(tr.get('tracks.istanbul')).toBe('İSTANBUL CIRCUIT');
    expect(en.get('tracks.istanbul')).toBe('ISTANBUL CIRCUIT');
  });

  it('no long sentence is identical in TR and EN (untranslated copy)', () => {
    // Cheap guard: a TR value identical to its EN value is allowed only for short technical tokens (units, key names, brand).
    const same: string[] = [];
    for (const ns of Object.keys(tables.tr)) {
      const tr = flattenDict(tables.tr[ns]!, ns, new Map());
      const en = flattenDict(tables.en[ns]!, ns, new Map());
      for (const [k, v] of tr) if (en.get(k) === v && v.length > 24 && /\s/.test(v)) same.push(`${k}: "${v}"`);
    }
    expect(same, `long sentences that are identical in TR and EN (untranslated?):\n${same.join('\n')}`).toEqual([]);
  });
});
