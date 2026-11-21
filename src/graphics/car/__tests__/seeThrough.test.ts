import { describe, expect, it } from 'vitest';
import { BufferGeometry, Ray, Triangle, Vector3 } from 'three';
import { buildBody, CONCEPT_IDS, inletCentre } from '../carModel';

/** First triangle hit along a ray over all body geometries; returns whether it faces the ray (front face) or null. */
function firstHit(geos: BufferGeometry[], ray: Ray): boolean | null {
  let best = Infinity;
  let front: boolean | null = null;
  const a = new Vector3(), b = new Vector3(), c = new Vector3(), hit = new Vector3(), n = new Vector3();
  const tri = new Triangle();
  for (const g of geos) {
    const p = g.getAttribute('position');
    const idx = g.index;
    const count = idx ? idx.count : p.count;
    for (let i = 0; i < count; i += 3) {
      const ia = idx ? idx.getX(i) : i, ib = idx ? idx.getX(i + 1) : i + 1, ic = idx ? idx.getX(i + 2) : i + 2;
      a.fromBufferAttribute(p, ia);
      b.fromBufferAttribute(p, ib);
      c.fromBufferAttribute(p, ic);
      if (!ray.intersectTriangle(a, b, c, false, hit)) continue;
      const d = hit.distanceTo(ray.origin);
      if (d < best) {
        best = d;
        tri.set(a, b, c).getNormal(n);
        front = n.dot(ray.direction) < 0;
      }
    }
  }
  return front;
}

describe('no see-through bodywork (closed duct, consistent winding)', () => {
  for (const concept of CONCEPT_IDS) {
    it(`${concept}: looking into the sidepod inlet hits a front face (dark duct back wall), LOD0 and LOD1`, () => {
      for (const lod of [0, 1] as const) {
        const body = buildBody(lod, concept);
        const geos = Object.entries(body.geo).filter(([k]) => k !== 'flap' && k !== 'steer').map(([, g]) => g!);
        const c = inletCentre(concept);
        for (const [dx, dy] of [[0, 0], [0.04, 0.03], [-0.04, -0.03], [0.05, -0.02]] as const) {
          const ray = new Ray(new Vector3(c.x + dx, c.y + dy, c.z + 0.6), new Vector3(0, 0, -1));
          expect(firstHit(geos, ray), `${concept} LOD${lod} ray ${dx},${dy}`).toBe(true);
        }
      }
    });
  }

  // Regression guard: 300 deterministic rays from a 7 m sphere at random points of the car; the first surface hit must
  // face the ray (a back face first = a hole or inverted winding you can see through). A few grazing hits on thin
  // plates are tolerated (< 2.5 %).
  for (const concept of CONCEPT_IDS) {
    it(`${concept}: random exterior rays hit front faces first (LOD0)`, () => {
      const body = buildBody(0, concept);
      const geos = Object.entries(body.geo).filter(([k]) => k !== 'flap' && k !== 'steer').map(([, g]) => g!);
      let seed = 7;
      const rnd = (): number => (seed = (seed * 16807) % 2147483647) / 2147483647;
      let total = 0, back = 0;
      for (let r = 0; r < 300; r++) {
        const th = rnd() * Math.PI * 2, ph = (rnd() - 0.3) * 1.2;
        const o = new Vector3(Math.cos(th) * Math.cos(ph) * 7, 0.4 + Math.sin(ph) * 7, Math.sin(th) * Math.cos(ph) * 7);
        const t = new Vector3((rnd() - 0.5) * 1.6, 0.05 + rnd() * 0.85, -2.5 + rnd() * 5.5);
        const f = firstHit(geos, new Ray(o, t.sub(o).normalize()));
        if (f === null) continue;
        total++;
        if (!f) back++;
      }
      expect(back / total).toBeLessThan(0.025);
    });
  }
});
