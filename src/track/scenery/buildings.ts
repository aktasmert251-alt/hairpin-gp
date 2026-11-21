// OSM buildings and the residential backdrop (Ç7, report §7.9): footprints extruded (flat roofs, plaster walls),
// excluding the circuit complex (replaced by the procedural pit building) and the T1 hospitality (stands.ts);
// the OSM residential polygon and the northern hills get instanced houses with terracotta roofs.

import { BufferAttribute, BufferGeometry, Color, Group, InstancedMesh, Matrix4, Mesh, Quaternion, Vector3 } from 'three';
import { envMaterial, EnvMode } from '../materials/shared';
import { makeRand } from '../mesh/textures';
import { boxInFrame, SBuf } from './stands';
import { SPONSORS } from './trackside';
import type { EnvContext, EnvPart } from './environment';

function houseGeometry(): BufferGeometry {
  // 1 × 1 × 1 box (walls) + gable roof, unit footprint centred at the origin; vertex colours walls / roof.
  const b = new SBuf();
  const wall = new Color(0.5, 0.46, 0.38);
  const roof = new Color(0.36, 0.09, 0.04);
  const P = (x: number, y: number, z: number): number[] => [x, y, z];
  b.quad([P(-0.5, 0, 0.5), P(0.5, 0, 0.5), P(-0.5, 1, 0.5), P(0.5, 1, 0.5)], [0, 0, 1], wall);
  b.quad([P(0.5, 0, -0.5), P(-0.5, 0, -0.5), P(0.5, 1, -0.5), P(-0.5, 1, -0.5)], [0, 0, -1], wall);
  b.quad([P(-0.5, 0, -0.5), P(-0.5, 0, 0.5), P(-0.5, 1, -0.5), P(-0.5, 1, 0.5)], [-1, 0, 0], wall);
  b.quad([P(0.5, 0, 0.5), P(0.5, 0, -0.5), P(0.5, 1, 0.5), P(0.5, 1, -0.5)], [1, 0, 0], wall);
  // Gable ends (triangles as degenerate quads) and roof slopes.
  b.quad([P(-0.5, 1, 0.5), P(0.5, 1, 0.5), P(0, 1.45, 0.5), P(0, 1.45, 0.5)], [0, 0, 1], wall);
  b.quad([P(0.5, 1, -0.5), P(-0.5, 1, -0.5), P(0, 1.45, -0.5), P(0, 1.45, -0.5)], [0, 0, -1], wall);
  b.quad([P(-0.56, 0.96, -0.56), P(-0.56, 0.96, 0.56), P(0, 1.47, -0.56), P(0, 1.47, 0.56)], [-0.67, 0.74, 0], roof);
  b.quad([P(0.56, 0.96, 0.56), P(0.56, 0.96, -0.56), P(0, 1.47, 0.56), P(0, 1.47, -0.56)], [0.67, 0.74, 0], roof);
  return b.geometry();
}

export function createBuildings(c: EnvContext, blocked: (x: number, z: number) => boolean): EnvPart & { triangles: number } {
  const { ex } = c;
  const ground = c.ground!;
  const sea = c.ex.authoring.THEME.sea;
  const reg = ex.reg;
  const rand = makeRand(1453);
  const toW = (xz: [number, number][]): [number, number][] => xz.map(([x, z]) => [(x - reg.cx) * reg.k, (z - reg.cz) * reg.k]);
  const group = new Group();
  group.name = 'buildings';

  // ---- OSM footprints ----------------------------------------------------------------------------------
  // QC2-17: façades get a dark plinth, punched windows per floor (piers between them, a sill ledge under each row),
  // an entrance with a canopy on the longest wall, a parapet with a cap (some in a fictional sponsor colour) and
  // rooftop plant / stair housing; wall colours vary per building. All in the same two meshes (0 extra draws).
  const b = new SBuf();
  const walls = [
    new Color(0.4, 0.38, 0.34), new Color(0.31, 0.32, 0.33), new Color(0.38, 0.33, 0.26),
    new Color(0.25, 0.27, 0.3), new Color(0.44, 0.42, 0.38), new Color(0.36, 0.3, 0.27),
  ];
  const accents = SPONSORS.filter((s) => s.name !== 'apex' && s.name !== 'dalga').map((s) => new Color(s.bg));
  const roofC = new Color(0.16, 0.16, 0.17);
  const capC = new Color(0.55, 0.55, 0.53);
  const plinthC = new Color(0.12, 0.12, 0.125);
  const sillC = new Color(0.6, 0.6, 0.58);
  const plantC = new Color(0.3, 0.31, 0.32);
  const doorC = new Color(0.03, 0.035, 0.04);
  // Window glass: vertex colour = the window's light at night (EnvMode.Garage emissive, see applyConditions).
  const glass = new SBuf();
  const warm = new Color(1.0, 0.82, 0.58), cool = new Color(0.72, 0.82, 1.0), off = new Color(0.04, 0.04, 0.05);
  const windowLight = (): Color => { const r = rand(); return r < 0.5 ? warm : r < 0.7 ? cool : off; };
  for (const f of ex.features) {
    if (f.kind !== 'building' || f.building === 'roof') continue;
    const pts = toW(f.xz);
    if (pts.length < 4) continue;
    let cx = 0, cz = 0;
    for (const [x, z] of pts) { cx += x; cz += z; }
    cx /= pts.length; cz /= pts.length;
    if (blocked(cx, cz)) continue;
    // yLow: lowest corner (walls start below it); y0: the floor level = highest corner, so a sloping site does not bury
    // the ground-floor windows.
    let yLow = Infinity, y0 = -Infinity;
    for (const [x, z] of pts) { const gy = ground.height(x, z); yLow = Math.min(yLow, gy); y0 = Math.max(y0, gy); }
    y0 += 0.15;
    const h = (f.levels ? f.levels * 3.2 : 4.5 + rand() * 4) + 0.5;
    const col = walls[Math.floor(rand() * walls.length)]!;
    const parC = rand() < 0.45 ? accents[Math.floor(rand() * accents.length)]! : capC;
    const winW = 1.3 + rand() * 0.9; // narrow punched windows … wide ribbon-like ones
    // Walls (polygon may be closed: last == first).
    const n = pts.length - (pts[0]![0] === pts[pts.length - 1]![0] && pts[0]![1] === pts[pts.length - 1]![1] ? 1 : 0);
    let area = 0, longest = 0, longK = 0;
    for (let k = 0; k < n; k++) {
      const a = pts[k]!, e = pts[(k + 1) % n]!;
      area += a[0] * e[1] - e[0] * a[1];
      const l = Math.hypot(e[0] - a[0], e[1] - a[1]);
      if (l > longest) { longest = l; longK = k; }
    }
    const sgn = area > 0 ? 1 : -1;
    const floors = Math.max(1, Math.round(h / 3.4));
    for (let k = 0; k < n; k++) {
      const a = pts[k]!, e = pts[(k + 1) % n]!;
      const dx = e[0] - a[0], dz = e[1] - a[1];
      const l = Math.hypot(dx, dz) || 1;
      // Outward normal for the polygon's winding.
      const nx = (sgn * dz) / l, nz = (-sgn * dx) / l;
      const N: [number, number, number] = [nx, 0, nz];
      const W = (t: number, off: number, y: number): number[] => [a[0] + dx * t + nx * off, y, a[1] + dz * t + nz * off];
      // Proud horizontal band (front + top face) from t0..t1 at offset `off`.
      const band = (t0: number, t1: number, off: number, ya: number, yb: number, c: Color, top = true): void => {
        b.quad([W(t0, off, ya), W(t1, off, ya), W(t0, off, yb), W(t1, off, yb)], N, c);
        if (top) b.quad([W(t0, 0, yb), W(t1, 0, yb), W(t0, off, yb), W(t1, off, yb)], [0, 1, 0], c);
      };
      b.quad([W(0, 0, yLow - 0.5), W(1, 0, yLow - 0.5), W(0, 0, y0 + h), W(1, 0, y0 + h)], N, col);
      band(0, 1, 0.06, yLow - 0.5, y0 + 0.55, plinthC);
      // Parapet (proud of the wall, above the roof) with a light cap.
      band(0, 1, 0.1, y0 + h - 0.45, y0 + h + 0.35, parC, false);
      band(0, 1, 0.14, y0 + h + 0.35, y0 + h + 0.45, capC);
      if (l < 3) continue;
      // Window bays: piers between punched windows; the longest wall gets the entrance in its middle bay.
      const bays = Math.max(1, Math.floor((l - 1.0) / (winW + 1.0)));
      const pitch = (l - 1.0) / bays;
      const door = k === longK && l > 5 ? Math.floor(bays / 2) : -1;
      for (let fl = 0; fl < floors; fl++) {
        const ya = y0 + fl * 3.4 + 1.0, yb = Math.min(y0 + h - 0.6, ya + 1.5);
        if (yb - ya < 0.5) continue;
        band(0.35 / l, 1 - 0.35 / l, 0.09, ya - 0.14, ya, sillC);
        for (let w = 0; w < bays; w++) {
          const mid = (0.5 + (w + 0.5) * pitch) / l, hw = Math.min(winW, pitch - 0.6) / 2 / l;
          if (fl === 0 && w === door) continue;
          glass.quad([W(mid - hw, 0.03, ya), W(mid + hw, 0.03, ya), W(mid - hw, 0.03, yb), W(mid + hw, 0.03, yb)], N, windowLight());
        }
      }
      if (door >= 0) {
        const mid = (0.5 + (door + 0.5) * pitch) / l, hw = 1.1 / l;
        b.quad([W(mid - hw, 0.07, y0), W(mid + hw, 0.07, y0), W(mid - hw, 0.07, y0 + 2.5), W(mid + hw, 0.07, y0 + 2.5)], N, doorC);
        glass.quad([W(mid - hw * 0.8, 0.08, y0 + 0.1), W(mid + hw * 0.8, 0.08, y0 + 0.1), W(mid - hw * 0.8, 0.08, y0 + 2.3), W(mid + hw * 0.8, 0.08, y0 + 2.3)], N, warm);
        // Entrance canopy: slab 1.4 m deep (front, top, underside).
        const c0 = mid - hw * 1.6, c1 = mid + hw * 1.6;
        band(c0, c1, 1.4, y0 + 2.75, y0 + 3.0, parC);
        b.quad([W(c0, 1.4, y0 + 2.75), W(c1, 1.4, y0 + 2.75), W(c0, 0, y0 + 2.75), W(c1, 0, y0 + 2.75)], [0, -1, 0], capC);
      }
    }
    // Flat roof: fan triangulation (footprints are small, mostly convex).
    for (let k = 1; k + 1 < n; k++) {
      const a = pts[0]!, e = pts[k]!, g = pts[k + 1]!;
      b.quad([[a[0], y0 + h, a[1]], [e[0], y0 + h, e[1]], [g[0], y0 + h, g[1]], [g[0], y0 + h, g[1]]], [0, 1, 0], roofC);
    }
    // Rooftop: plant and a stair housing on the larger footprints, a single AC unit on the small ones.
    const ex0 = pts[1]![0] - pts[0]![0], ez0 = pts[1]![1] - pts[0]![1];
    const el = Math.hypot(ex0, ez0) || 1;
    const ux = ex0 / el, uz = ez0 / el;
    const top = { x: cx, y: y0 + h, z: cz };
    if (Math.abs(area) / 2 > 120) {
      boxInFrame(b, top, [-1.6, 1.6], [-1.0, 1.0], [0, 1.3], ux, uz, -uz, ux, plantC);
      boxInFrame(b, top, [2.4, 3.6], [-0.6, 0.6], [0, 0.9], ux, uz, -uz, ux, plantC);
      boxInFrame(b, top, [-4.6, -2.4], [-1.4, 1.4], [0, 2.6], ux, uz, -uz, ux, col);
      boxInFrame(b, top, [-4.75, -2.25], [-1.55, 1.55], [2.6, 2.75], ux, uz, -uz, ux, capC);
      boxInFrame(b, top, [0.6, 0.7], [1.6, 1.7], [0, 4.5], ux, uz, -uz, ux, plantC);
    } else {
      boxInFrame(b, top, [-0.7, 0.7], [-0.5, 0.5], [0, 0.8], ux, uz, -uz, ux, plantC);
    }
  }
  const bGeo = b.geometry();
  const bMat = envMaterial(c.sh, { name: 'buildings.osm', family: 'opaque', vertexColor: true, roughness: 0.85, wet: 0.5 });
  const bMesh = new Mesh(bGeo, bMat);
  bMesh.castShadow = c.quality.id !== 'low';
  bMesh.receiveShadow = true;
  bMesh.matrixAutoUpdate = false;
  group.add(bMesh);
  const gGeo = glass.geometry();
  const gMat = envMaterial(c.sh, {
    name: 'buildings.glass', family: 'opaque', mode: EnvMode.Garage, color: 0x10161c, emissive: 0xffffff, emissiveIntensity: 0,
    roughness: 0.12, metalness: 0.8, wet: 0, flood: 0.3,
  });
  const gMesh = new Mesh(gGeo, gMat);
  gMesh.receiveShadow = true;
  gMesh.matrixAutoUpdate = false;
  group.add(gMesh);

  // ---- residential houses (OSM residential polygon + a band on the northern slopes) -------------------------
  const res = ex.features.filter((f) => f.kind === 'residential').map((f) => toW(f.xz));
  const inPoly = (x: number, z: number, p: [number, number][]): boolean => {
    let inside = false;
    for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
      const [xi, zi] = p[i]!, [xj, zj] = p[j]!;
      if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
    }
    return inside;
  };
  const spots: { x: number; z: number }[] = [];
  for (const p of res) {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const [x, z] of p) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    for (let z = z0; z < z1; z += 22) for (let x = x0; x < x1; x += 22) {
      const jx = x + (rand() - 0.5) * 12, jz = z + (rand() - 0.5) * 12;
      if (rand() < 0.75 && inPoly(jx, jz, p)) spots.push({ x: jx, z: jz });
    }
  }
  let minZ = Infinity, minX = Infinity, maxX = -Infinity;
  for (let i = 0; i < c.track.data.count; i++) {
    minZ = Math.min(minZ, c.track.data.z[i]!);
    minX = Math.min(minX, c.track.data.x[i]!);
    maxX = Math.max(maxX, c.track.data.x[i]!);
  }
  // Village clusters on the northern hills (beyond the forest edge, inside the DEM area).
  // (Not in the tuff valley: Cappadocia builds its own stone village.)
  for (let k = 0; k < (ex.authoring.THEME.backdrop === 'valley' || ex.authoring.THEME.backdrop === 'volcanic' ? 0 : 7); k++) {
    const vx = minX - 300 + (k / 6) * (maxX - minX + 600) + (rand() - 0.5) * 120;
    const vz = minZ - 650 - rand() * 400;
    for (let m = 0; m < 70; m++) {
      const a = rand() * Math.PI * 2, r = Math.sqrt(rand()) * 160;
      spots.push({ x: vx + Math.cos(a) * r, z: vz + Math.sin(a) * r * 0.7 });
    }
  }
  const info = { s: 0, d: 0, covered: false, nearTrack: 0 };
  const houses: { x: number; y: number; z: number; w: number; d: number; h: number; rot: number }[] = [];
  for (const sp of spots) {
    if (blocked(sp.x, sp.z)) continue;
    const y = ground.height(sp.x, sp.z, info);
    if (info.covered || info.nearTrack > 0.05) continue;
    // Sea tracks: never on the water or the beach.
    if (sea && y < sea.y + 2) continue;
    houses.push({ x: sp.x, y, z: sp.z, w: 7 + rand() * 6, d: 6 + rand() * 4, h: 3 + Math.floor(rand() * 3) * 2.8, rot: rand() * Math.PI });
  }
  const hGeo = houseGeometry();
  const hMat = envMaterial(c.sh, { name: 'buildings.houses', family: 'inst', vertexColor: true, roughness: 0.9, wet: 0.5 });
  const hMesh = new InstancedMesh(hGeo, hMat, Math.max(1, houses.length));
  const m4 = new Matrix4();
  const q = new Quaternion();
  const up = new Vector3(0, 1, 0);
  const tint = new Color();
  houses.forEach((h, k) => {
    q.setFromAxisAngle(up, h.rot);
    m4.compose(new Vector3(h.x, h.y - 0.4, h.z), q, new Vector3(h.w, h.h + 0.4, h.d));
    hMesh.setMatrixAt(k, m4);
    tint.setRGB(0.85 + rand() * 0.3, 0.85 + rand() * 0.25, 0.8 + rand() * 0.25);
    hMesh.setColorAt(k, tint);
  });
  hMesh.count = houses.length;
  hMesh.castShadow = c.quality.id === 'ultra';
  hMesh.receiveShadow = true;
  hMesh.computeBoundingSphere();
  group.add(hMesh);
  void BufferAttribute;
  const triangles = bGeo.index!.count / 3 + gGeo.index!.count / 3 + houses.length * (hGeo.index!.count / 3);
  return {
    root: group,
    triangles,
    applyConditions(cc) {
      gMat.emissiveIntensity = cc.tod === 'night' ? 0.4 : cc.tod === 'sunset' ? 0.18 : 0;
    },
    setQuality(qp) {
      bMesh.castShadow = qp.id !== 'low';
      hMesh.castShadow = qp.id === 'ultra';
    },
    dispose() {
      bGeo.dispose();
      gGeo.dispose();
      hGeo.dispose();
      bMat.dispose();
      gMat.dispose();
      hMat.dispose();
      hMesh.dispose();
      group.removeFromParent();
    },
  };
}
