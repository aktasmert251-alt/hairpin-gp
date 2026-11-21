import { describe, expect, it } from 'vitest';
import { boundsOf, buildBody, CONCEPT_IDS, conceptOf } from '../carModel';
import { TEAMS } from '../../../data/teams';

describe('car concepts (per-team body variants)', () => {
  it('every team and the safety car map to a concept; at least 4 distinct concepts are used', () => {
    const used = new Set([...TEAMS.map((t) => conceptOf(t.id)), conceptOf('safetyCar')]);
    for (const c of used) expect(CONCEPT_IDS).toContain(c);
    expect(used.size).toBe(4);
    expect(conceptOf('unknown-custom')).toBe('arrow');
  });

  for (const c of CONCEPT_IDS) {
    it(`${c}: LOD0 body ≤ 42k tris, LOD1 ≤ 11k, same draw groups, 5.6 × 2.0 m footprint`, () => {
      const b0 = buildBody(0, c);
      const b1 = buildBody(1, c);
      expect(b0.triangles).toBeLessThanOrEqual(42_000);
      expect(b1.triangles).toBeLessThanOrEqual(11_000);
      expect(Object.keys(b0.geo).sort()).toEqual(Object.keys(buildBody(0).geo).sort());
      expect(Object.keys(b1.geo).length).toBeLessThanOrEqual(3);
      const b = boundsOf(b0);
      expect(b.max.z).toBeGreaterThan(3.0);
      expect(b.max.z).toBeLessThan(3.16);
      expect(b.min.z).toBeGreaterThan(-2.66);
      expect(b.max.x).toBeLessThanOrEqual(1.0);
      expect(b.min.y).toBeGreaterThanOrEqual(0.025);
      expect(b.max.y).toBeLessThan(1.04);
    });
  }
});
