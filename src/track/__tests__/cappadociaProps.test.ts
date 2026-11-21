// Cappadocia prop builders (scenery/cappadociaProps.ts): instance counts follow the placement lists, each group stays
// within its draw budget, balloons drift deterministically and hide at night, carved windows light up at night.
import { Texture, Vector3, type InstancedMesh, type Mesh, type MeshStandardMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import type { ConditionsFrame } from '../../contracts/conditions';
import type { RenderFrame } from '../../contracts/render';
import { createEnvShared } from '../materials/shared';
import { createBalloons, createCaveDwellings, createFairyChimneys, createOrchards, createStoneVillage, type PropPart, type PropsEnv } from '../scenery/cappadociaProps';

const env = (): PropsEnv => {
  const t = new Texture();
  return {
    sh: createEnvShared(),
    tex: { concrete: { map: t, normal: t, rough: t }, dirt: { map: t, normal: t } },
    quality: { id: 'high' },
    ground: { height: (x: number, z: number) => 0.01 * x + 0.02 * z },
  };
};
const cond = (tod: ConditionsFrame['tod']): ConditionsFrame => ({ tod, rain: 0, wetness: 0, lineWetness: 0, cloud: 0, time: 0 });
const meshes = (p: PropPart): Mesh[] => p.root.children as Mesh[];

describe('cappadocia props', () => {
  it('fairy chimneys: one instance per cone (clusters expand), ≤ 2 draws, windows lit only after dark', () => {
    const p = createFairyChimneys(env(), [{ x: 0, z: 0, h: 30, cluster: 3, caves: true }, { x: 50, z: 10, h: 12 }, { x: -40, z: 20, h: 22, cluster: 2, caves: true }]);
    const m = meshes(p);
    expect(m.length).toBeLessThanOrEqual(2);
    expect((m[0] as InstancedMesh).count).toBe(6);
    expect(p.triangles).toBeGreaterThan(1000);
    const lamp = m[1]!.material as MeshStandardMaterial;
    p.applyConditions!(cond('day'));
    expect(lamp.emissiveIntensity).toBe(0);
    p.applyConditions!(cond('night'));
    expect(lamp.emissiveIntensity).toBeGreaterThan(1);
    p.dispose();
    expect(p.root.parent).toBeNull();
  });

  it('cave dwellings + castle: 2 draws, openings on every face and the castle', () => {
    const p = createCaveDwellings(env(), [{ x: 0, z: 0, nx: 0, nz: 1, w: 60, h: 30 }], { x: 200, z: 0, r: 40, h: 60 });
    const m = meshes(p);
    expect(m.length).toBe(2);
    const holes = m[1]!.geometry.getAttribute('position').count / 4;
    expect(holes).toBeGreaterThan(60);
    p.dispose();
  });

  it('balloons: 1 draw, deterministic drift and rise, hidden at night', () => {
    const area = { x: 0, z: 0, r: 800, yMin: 80, yMax: 260, count: 12 };
    const a = createBalloons(env(), area), b = createBalloons(env(), area);
    expect(meshes(a).length).toBe(1);
    expect((meshes(a)[0] as InstancedMesh).count).toBe(12);
    const f = {} as RenderFrame;
    const p0 = a.positionOf(3, new Vector3());
    for (let k = 0; k < 600; k++) { a.update!(null as never, f, 1 / 60); b.step(1 / 60); }
    const pa = a.positionOf(3, new Vector3()), pb = b.positionOf(3, new Vector3());
    expect(pa.distanceTo(pb)).toBeLessThan(1e-6);
    expect(pa.distanceTo(p0)).toBeGreaterThan(5);
    for (let k = 0; k < 12; k++) {
      const p = a.positionOf(k, new Vector3());
      expect(Math.abs(p.x)).toBeLessThanOrEqual(800);
      expect(p.y).toBeGreaterThanOrEqual(80);
      expect(p.y).toBeLessThanOrEqual(260);
    }
    a.applyConditions!(cond('night'));
    expect(meshes(a)[0]!.visible).toBe(false);
    a.dispose();
    b.dispose();
  });

  it('stone village and orchards: instances follow the lists, ≤ 3 + 2 draws', () => {
    const houses = Array.from({ length: 20 }, (_, k) => ({ x: (k % 5) * 14, z: Math.floor(k / 5) * 14, w: 8, d: 7, h: 4 + (k % 3) * 3, yaw: 0.1 * k }));
    const v = createStoneVillage(env(), houses, { x: 100, z: 0, yaw: 0.3 }, [[[0, -20], [60, -20], [60, 40]]]);
    expect(meshes(v).length).toBeLessThanOrEqual(3);
    expect((meshes(v)[0] as InstancedMesh).count).toBe(20);
    v.applyConditions!(cond('night'));
    v.dispose();
    const o = createOrchards(env(), [{ x: 0, z: 0, w: 60, d: 26, yaw: 0 }], [{ x: 100, z: 0, w: 48, d: 36, yaw: 0.4 }]);
    const om = meshes(o);
    expect(om.length).toBe(2);
    expect((om[0] as InstancedMesh).count).toBe(11 * 5);
    expect((om[1] as InstancedMesh).count).toBe(8 * 6);
    o.dispose();
  });
});
