import { afterEach, describe, expect, it } from 'vitest';
import { customTeamDef, parseCustomTeam, resolvedTeam, sessionTeamChoices, setActiveCustomTeam, setCustomTeamCatalog, validateTeamName, type CustomTeam } from '../customTeams';
import { TEAM_PALETTE, contrast, hudStripColor } from '../teamPalette';
import { TEAMS } from '../teams';
import { buildLineup, defaultSessionConfig } from '../../game/createSim';
import { createCustomTeamStore, CUSTOM_TEAMS_KEY } from '../../ui/customTeamStore';

const team: CustomTeam = { id: 'custom-test', name: 'Deniz GP', baseTeamId: 'meridian', primary: 'navy', secondary: 'mint', accent: 'gold', finish: 'metallic' };
afterEach(() => setCustomTeamCatalog([]));

describe('custom team data', () => {
  it('normalizes NFC, trims names, and counts Unicode characters', () => {
    expect(validateTeamName('  Gu\u0308nes\u0327 GP  ')).toEqual({ name: 'Güneş GP', error: null });
    expect(validateTeamName('A'.repeat(20)).error).toBeNull();
    for (const name of ['A', 'A'.repeat(21)]) expect(validateTeamName(name).error).toBe('length');
  });
  it('rejects markup, controls, bidi and reserved names including separator/case variants', () => {
    const reserved = [[70, 49], [70, 101, 114, 114, 97, 114, 105], [77, 99, 76, 97, 114, 101, 110], [82, 101, 100, 32, 66, 117, 108, 108], [65, 108, 112, 105, 110, 101]];
    for (const codes of reserved) expect(validateTeamName(String.fromCharCode(...codes)).error).toBe('reserved');
    expect(validateTeamName(String.fromCharCode(70, 32, 45, 32, 49)).error).toBe('reserved');
    for (const name of ['<b>GP</b>', 'GP\nTeam', 'GP\u202eTeam', 'GP\u2066Team', 'GP\u0000Team', 'GP&copy;']) expect(validateTeamName(name).error).toBe('characters');
  });
  it('accepts only known bases, palette ids, finishes and safe custom ids', () => {
    expect(parseCustomTeam(JSON.parse(JSON.stringify(team)))).toEqual(team);
    for (const patch of [{ baseTeamId: 'unknown' }, { primary: '#123456' }, { finish: 'chrome' }, { id: 'meridian' }, { name: '<script>' }]) expect(parseCustomTeam({ ...team, ...patch })).toBeNull();
    expect(parseCustomTeam(null)).toBeNull();
    expect(Object.keys(parseCustomTeam({ ...team, injected: true })!)).not.toContain('injected');
  });
  it('guarantees strip contrast for all 24 colours on panel composites and raised graphite', () => {
    expect(TEAM_PALETTE).toHaveLength(24);
    for (const p of TEAM_PALETTE) for (const panel of ['#090B0E', '#151920', '#1E242C', '#27292B']) expect(contrast(hudStripColor(p.id), panel)).toBeGreaterThanOrEqual(3);
  });
  it('replaces exactly two base seats and preserves performance and driver order', () => {
    setCustomTeamCatalog([team]);
    const base = TEAMS.find(t => t.id === team.baseTeamId)!;
    const cfg = defaultSessionConfig({ playerTeamId: team.id, aiCount: 19, seed: 42 });
    const custom = buildLineup(cfg), stock = buildLineup({ ...cfg, playerTeamId: team.baseTeamId });
    expect(custom).toHaveLength(20);
    expect(custom.filter(e => e.team.id === base.id)).toHaveLength(2);
    expect(custom.filter(e => e.team.name === team.name)).toHaveLength(2);
    expect(custom.map(e => e.team.id)).toEqual(stock.map(e => e.team.id));
    expect(custom.map(e => e.driver.id)).toEqual(stock.map(e => e.driver.id));
    for (const [i, entry] of custom.entries()) {
      expect(entry.team.perf).toBe(stock[i]!.team.perf);
      expect(entry.team.traits).toEqual(stock[i]!.team.traits);
    }
    const def = customTeamDef(team);
    expect(def.name).toBe(team.name); expect(def.colors.primary).toBe('#13235B');
    expect(buildLineup({ ...cfg, mode: 'timeTrial' })).toHaveLength(1);
    expect(base.id).toBe('meridian');
  });
  it('maps only the active base car for graphics/HUD and clears that mapping for stock/online sessions', () => {
    setCustomTeamCatalog([team]); setActiveCustomTeam(team.id);
    const mapped = sessionTeamChoices().find(t => t.id === team.baseTeamId)!;
    expect(mapped.name).toBe(team.name);
    expect(resolvedTeam(team.baseTeamId)).toEqual(mapped);
    expect(mapped.colors.ui).toBe(hudStripColor(team.primary));
    setActiveCustomTeam(null);
    expect(resolvedTeam(team.baseTeamId)).toBe(TEAMS.find(t => t.id === team.baseTeamId));
  });
});

describe('custom team persistence', () => {
  it('round-trips edits, deletes and canonical JSON using its own storage key', () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
    const store = createCustomTeamStore(() => storage);
    expect(store.save(team)).toBe(true);
    store.save({ ...team, name: 'Kıyı GP' });
    expect(JSON.parse(values.get(CUSTOM_TEAMS_KEY)!)).toHaveLength(1);
    const loaded = createCustomTeamStore(() => storage);
    expect(loaded.list()[0]!.name).toBe('Kıyı GP');
    loaded.remove(team.id); expect(JSON.parse(values.get(CUSTOM_TEAMS_KEY)!)).toEqual([]);
  });
  it('works with missing, throwing and corrupt storage, and filters malformed entries', () => {
    for (const storage of [() => undefined, () => { throw new Error('denied'); }, () => ({ getItem: () => '{', setItem: () => { throw new Error('full'); } })]) {
      const store = createCustomTeamStore(storage);
      expect(store.save(team)).toBe(true); expect(store.list()).toEqual([team]);
      expect(store.save({ ...team, primary: 'invalid' } as unknown as CustomTeam)).toBe(false);
      store.remove(team.id); expect(store.list()).toEqual([]);
    }
    const store = createCustomTeamStore(() => ({ getItem: () => JSON.stringify([team, team, { ...team, id: 'bad' }]), setItem() {} }));
    expect(store.list()).toEqual([team]);
  });
});
