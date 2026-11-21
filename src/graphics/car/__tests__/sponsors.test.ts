import { describe, expect, it } from 'vitest';
import { TEAMS } from '../../../data/teams';
import { SPONSOR_BRANDS, TEAM_SPONSORS } from '../sponsors';

describe('car sponsors (fictional, unique per team)', () => {
  const sets = TEAMS.map((t) => TEAM_SPONSORS[t.id]!);

  it('every team has a deal whose brands all exist, with 2–3 secondary sponsors', () => {
    for (const d of sets) {
      expect(d).toBeTruthy();
      if (d.title) expect(SPONSOR_BRANDS[d.title]).toBeTruthy();
      expect(d.extra.length).toBeGreaterThanOrEqual(2);
      expect(d.extra.length).toBeLessThanOrEqual(3);
      for (const e of d.extra) expect(SPONSOR_BRANDS[e]).toBeTruthy();
    }
  });

  it('no two teams share a sponsor set; a sponsor is on ≤ 2 teams and title on ≤ 1', () => {
    const keys = sets.map((d) => [d.title ?? '-', ...[...d.extra].sort()].join('|'));
    expect(new Set(keys).size).toBe(keys.length);
    const uses = new Map<string, number>();
    const titles = new Map<string, number>();
    for (const d of sets) {
      for (const k of [d.title, ...d.extra]) if (k) uses.set(k, (uses.get(k) ?? 0) + 1);
      if (d.title) titles.set(d.title, (titles.get(d.title) ?? 0) + 1);
    }
    for (const n of uses.values()) expect(n).toBeLessThanOrEqual(2);
    for (const n of titles.values()) expect(n).toBe(1);
  });

  it('every brand has its own treatment and colour pair; Turkish glyphs are pre-composed', () => {
    const brands = Object.values(SPONSOR_BRANDS);
    const looks = brands.map((b) => [b.family, b.weight, b.track, b.slant, b.mode, b.emblem].join('|'));
    expect(new Set(looks).size).toBe(brands.length);
    expect(new Set(brands.map((b) => `${b.bg}/${b.fg}`)).size).toBe(brands.length);
    expect(SPONSOR_BRANDS['akLastik']!.text).toBe('AK LASTİK');
    expect(SPONSOR_BRANDS['ayro']!.text).toBe('AYRO OIL');
    expect(SPONSOR_BRANDS['goksu']!.text + ' ' + SPONSOR_BRANDS['goksu']!.small).toBe('GÖKSU HAVACILIK');
  });
});
