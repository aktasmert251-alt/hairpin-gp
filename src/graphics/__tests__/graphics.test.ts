// Grafik-3B unit tests: QUALITY_PRESETS = rendering.md §10, LUT identity (§4.3), car budgets and footprint (§7.1, §7.2).

import { describe, expect, it } from 'vitest';
import { QUALITY_PRESETS, rendererPixelRatio } from '../presets';
import { buildLutData, LUT_SIZE } from '../post/lut';
import { GRADES, NEUTRAL_GRADE } from '../post/lutPresets';
import { boundsOf, buildBody } from '../car/carModel';
import { buildWheels, FRONT_W, REAR_W, wheelTriangles } from '../car/wheels';

describe('QUALITY_PRESETS (rendering.md §10)', () => {
  const table = {
    renderScale: [0.75, 0.9, 1.0, 1.0], aa: ['fxaa', 'smaa', 'smaa', 'smaa'], smaa: ['MEDIUM', 'MEDIUM', 'HIGH', 'ULTRA'],
    shadowSize: [1024, 2048, 2048, 4096], shadowExtent: [35, 55, 70, 90], shadowRadius: [1, 2, 3, 4], ao: ['off', 'off', 'half', 'full'],
    bloom: [false, true, true, true], lut: [false, true, true, true], lens: ['droplets', 'dropletsCA', 'dropletsCA', 'all'],
    envSize: [128, 256, 256, 512], anisotropy: [2, 4, 8, 16], carLod: [[15, 80, 600], [25, 100, 800], [30, 120, 1000], [45, 160, 1500]],
    mirrors: ['static', 'static', 'low30', 'high60'], treeDensity: [0.35, 0.6, 1.0, 1.3], crowdDensity: [0.3, 0.6, 1.0, 1.0],
    grassCards: [0, 12000, 30000, 60000], rainStreaks: [2000, 4000, 8000, 12000], sprayPerCar: [24, 48, 96, 160],
    smokeMax: [256, 512, 1024, 2048], skidQuads: [1000, 2000, 4000, 8000], far: [1800, 2500, 3500, 4500],
  } as const;
  const ids = ['low', 'medium', 'high', 'ultra'] as const;
  for (const [field, values] of Object.entries(table)) {
    it(`${field} matches the table`, () => {
      ids.forEach((id, i) => expect((QUALITY_PRESETS[id] as unknown as Record<string, unknown>)[field]).toEqual(values[i]));
    });
  }
  it('ids are consistent', () => ids.forEach((id) => expect(QUALITY_PRESETS[id].id).toBe(id)));
  it('caps HiDPI density per quality and retains renderScale', () => {
    const caps = [1, 1.25, 1.5, 2];
    ids.forEach((id, i) => {
      const q = QUALITY_PRESETS[id];
      expect(rendererPixelRatio(q, 3)).toBeCloseTo(caps[i]! * q.renderScale);
      expect(rendererPixelRatio(q, 1)).toBe(q.renderScale);
      expect(rendererPixelRatio(q, 0.9)).toBeCloseTo(0.9 * q.renderScale);
    });
  });
});

describe('procedural LUT (rendering.md §4.3)', () => {
  it('neutral grade maps every lattice point to itself within 1/255', () => {
    const d = buildLutData(NEUTRAL_GRADE);
    const n = LUT_SIZE;
    let worst = 0;
    let i = 0;
    for (let b = 0; b < n; b++) {
      for (let g = 0; g < n; g++) {
        for (let r = 0; r < n; r++) {
          const exp = [r, g, b].map((v) => Math.round((v / (n - 1)) * 255));
          for (let c = 0; c < 3; c++) worst = Math.max(worst, Math.abs(d[i + c]! - exp[c]!));
          i += 4;
        }
      }
    }
    expect(worst).toBeLessThanOrEqual(1);
  });
  it('grades stay in range and keep white near white', () => {
    for (const g of Object.values(GRADES)) {
      const d = buildLutData(g);
      const last = (LUT_SIZE ** 3 - 1) * 4;
      expect(Math.min(d[last]!, d[last + 1]!, d[last + 2]!)).toBeGreaterThan(200);
    }
  });
});

describe('procedural car (rendering.md §7)', () => {
  const lods = [0, 1, 2] as const;
  const bodies = lods.map((l) => buildBody(l));
  const wheels = lods.map((l) => buildWheels(l));
  const caps = [60_000, 15_000, 3_000];

  it('LOD triangle budgets incl. 4 wheels: ≤ 60k / 15k / 3k', () => {
    lods.forEach((l) => {
      const total = bodies[l]!.triangles + 4 * wheelTriangles(wheels[l]!);
      expect(total).toBeLessThanOrEqual(caps[l]!);
    });
  });

  it('LOD0 has ≤ 8 body draw groups, LOD1 ≤ 3', () => {
    // LOD0 materials + separate DRS flap and steering-wheel meshes; LOD1 paint, carbon+trim, emissive.
    expect(Object.keys(bodies[0]!.geo).length).toBeLessThanOrEqual(8);
    expect(Object.keys(bodies[1]!.geo).length).toBeLessThanOrEqual(3);
  });

  it('footprint matches 5.6 × 2.0 m (front axle z +1.962, rear −1.638)', () => {
    const b = boundsOf(bodies[0]!);
    // Body: nose tip ≈ +3.05 … rear-wing trailing edge ≈ −2.55 (the DRS flap mesh is stored pivot-relative).
    expect(b.max.z).toBeGreaterThan(3.0);
    expect(b.max.z).toBeLessThan(3.16);
    expect(b.min.z).toBeLessThan(-2.5);
    expect(b.min.z).toBeGreaterThan(-2.66);
    // Width: front wing endplates ±~0.97; wheels (rear centre ±0.775 + 0.405/2) bring the car to ±0.98.
    expect(b.max.x).toBeLessThanOrEqual(1.0);
    expect(0.775 + REAR_W / 2).toBeLessThanOrEqual(1.0);
    expect(0.8 + FRONT_W / 2).toBeLessThanOrEqual(1.0);
    // Heights: plank 0.03, T-cam top ≈ 1.02.
    expect(b.min.y).toBeGreaterThanOrEqual(0.025);
    expect(b.max.y).toBeLessThan(1.04);
  });
});

describe('pit crew (G12)', async () => {
  const { createPitCrew } = await import('../car/pitCrew');
  const { TEAMS } = await import('../../data/teams');
  // Straight pit lane along +z, garages toward +x.
  const q = {
    data: { pit: { boxes: TEAMS.map((t, k) => ({ teamId: t.id, sp: 100 + 14 * k, d: 3 })) } },
    pitWorldFromSD: (sp: number, d: number, out: { x: number; y: number; z: number }) => Object.assign(out, { x: d, y: 0, z: sp }),
  } as unknown as Parameters<typeof createPitCrew>[0];
  const car = (teamId: string, inPitBox: boolean) => ({ teamId, inPitBox, isGhost: false });
  const frame = (time: number, cars: unknown[]) => ({ time, cars }) as unknown as Parameters<NonNullable<ReturnType<typeof createPitCrew>>['update']>[0];
  const pose = (crew: NonNullable<ReturnType<typeof createPitCrew>>, box: number) => (crew.mesh.geometry.getAttribute('iPose').getX(box * 8));

  it('one instanced draw, 8 per box, <= 20k triangles', () => {
    const crew = createPitCrew(q)!;
    const g = crew.mesh.geometry;
    const tris = (g.index ? g.index.count : g.getAttribute('position').count) / 3;
    expect(crew.mesh.count).toBe(TEAMS.length * 8);
    expect(tris * crew.mesh.count).toBeLessThanOrEqual(20_000);
    crew.dispose();
  });
  it('wait -> work while in the box -> release for 1.5 s -> wait', () => {
    const crew = createPitCrew(q)!;
    const t = TEAMS[2]!.id;
    crew.update(frame(0, [car(t, false)]));
    expect(pose(crew, 2)).toBe(0);
    crew.update(frame(1, [car(t, true)]));
    expect(pose(crew, 2)).toBe(1);
    expect(pose(crew, 3)).toBe(0);
    crew.update(frame(2, [car(t, false)]));
    expect(pose(crew, 2)).toBe(2);
    crew.update(frame(2.6, [car(t, false)]));
    expect(pose(crew, 2)).toBe(0);
    crew.dispose();
  });
});
