import { describe, expect, it } from 'vitest';
import { LANGS, collectDictionaries, createI18n, flattenDict, interpolate, upperFor } from '../i18n/index';

const PARAM = /\{(\w+)\}/g;

function params(s: string): string[] {
  return [...s.matchAll(PARAM)].map((m) => m[1]!).sort();
}

describe('i18n', () => {
  const tables = collectDictionaries();

  it('discovers the namespaces through import.meta.glob', () => {
    for (const ns of ['common', 'errors', 'tracks', 'menu', 'settings', 'hud', 'results', 'loading']) {
      expect(Object.keys(tables.tr)).toContain(ns);
    }
    for (const [ns, dirs] of Object.entries(tables.sources)) expect(dirs, `namespace ${ns}`).toHaveLength(1);
  });

  it('has identical key sets and {params} in TR and EN for every namespace', () => {
    expect(Object.keys(tables.en).sort()).toEqual(Object.keys(tables.tr).sort());
    for (const ns of Object.keys(tables.tr)) {
      const tr = flattenDict(tables.tr[ns]!, ns, new Map());
      const en = flattenDict(tables.en[ns]!, ns, new Map());
      expect([...en.keys()].sort(), `keys of ${ns}`).toEqual([...tr.keys()].sort());
      for (const [k, v] of tr) {
        expect(v.trim().length, `${k} (tr) is empty`).toBeGreaterThan(0);
        expect(params(en.get(k)!), `params of ${k}`).toEqual(params(v));
      }
    }
    expect(LANGS).toEqual(['tr', 'en']);
  });

  it('translates with substitution, falls back to TR then to the key', () => {
    const i18n = createI18n({ lang: 'en', syncDocumentLang: false });
    expect(i18n.t('errors.session', { message: 'x' })).toBe('Something went wrong: x');
    i18n.setLang('tr');
    expect(i18n.t('menu.title.pressAnyKey')).toBe('Başlamak için bir tuşa bas');
    expect(i18n.t('no.such.key')).toBe('no.such.key');
    expect(interpolate('{a}+{b}={c}', { a: 1, b: 2 })).toBe('1+2={c}');
  });

  it('upper-cases with Turkish rules and keeps D-003 track names pre-composed', () => {
    expect(upperFor('istanbul', 'tr')).toBe('İSTANBUL');
    expect(upperFor('istanbul', 'en')).toBe('ISTANBUL');
    expect(upperFor('ılık iğne', 'tr')).toBe('ILIK İĞNE');
    const i18n = createI18n({ lang: 'tr', syncDocumentLang: false });
    expect(i18n.t('tracks.istanbul')).toBe('İSTANBUL CIRCUIT');
    i18n.setLang('en');
    expect(i18n.t('tracks.istanbul')).toBe('ISTANBUL CIRCUIT');
  });
});
