// Old-banking ruins (tracks.md §2.10, Lombardia): OSM 'ruin' polylines become a 12 m weathered, moss-tinted concrete
// ribbon banked 0° → 28° by curvature with broken railings; 'bridge' ruin ways crossing the circuit become a concrete
// overpass (6 m clearance over the track, 1.8 m deck with a 0.9 m parapet fascia, piers ≥ 3 m behind the barriers). One concrete + one railing mesh (2 draws).
// The ribbon is cut where it would reach the track or its barriers; segments push tree/building blockers.

import { Color, Group, Mesh } from 'three';
import { envMaterial } from '../materials/shared';
import { SBuf } from './stands';
import type { EnvContext, EnvPart } from './environment';

const WIDTH = 12;
const STEP = 6;
const CLEARANCE = 6;
const DECK = 1.8;
/** Overpass edge parapet (solid concrete upstand that also forms the fascia seen from the track). */
const PARAPET = 0.9;
const MAX_BANK = (28 * Math.PI) / 180;

type P3 = [number, number, number];

export function createRuins(c: EnvContext): EnvPart & { triangles: number } {
  const { ex } = c;
  const { data } = c.track;
  const ground = c.ground!;
  const group = new Group();
  group.name = 'ruins';
  const ruins = ex.features.filter((f) => f.kind === 'ruin');
  if (ruins.length === 0) return { root: group, triangles: 0, dispose() {} };

  const reg = ex.reg;
  const toW = (x: number, z: number): [number, number] => [(x - reg.cx) * reg.k, (z - reg.cz) * reg.k];
  const info = { s: 0, d: 0, covered: false, nearTrack: 0 };
  /** Distance outside the barrier on the point's side (negative = inside the barriers). */
  const outsideWall = (x: number, z: number): number => {
    ground.height(x, z, info);
    const k = Math.round(info.s) % data.count;
    return Math.abs(info.d) - (info.d >= 0 ? data.wallL[k]! : data.wallR[k]!);
  };

  // Deck height per bridge way: track surface under the crossing + clearance (highest along the way).
  const bridgeY = new Map<number, number>();
  for (const f of ruins) {
    if (!f.bridge) continue;
    let y = -Infinity;
    const pts = f.xz.map(([x, z]) => toW(x, z));
    for (let k = 0; k + 1 < pts.length; k++) {
      for (let t = 0; t <= 1; t += 0.05) {
        const x = pts[k]![0] + (pts[k + 1]![0] - pts[k]![0]) * t, z = pts[k]![1] + (pts[k + 1]![1] - pts[k]![1]) * t;
        y = Math.max(y, ground.height(x, z));
      }
    }
    bridgeY.set(f.id, y + CLEARANCE + DECK);
  }
  // Bridge end points: non-bridge ruin ways ramp up to the deck within 120 m of them.
  const ends: { x: number; z: number; y: number }[] = [];
  for (const f of ruins) {
    if (!f.bridge) continue;
    for (const p of [f.xz[0]!, f.xz[f.xz.length - 1]!]) {
      const [x, z] = toW(p[0], p[1]);
      ends.push({ x, z, y: bridgeY.get(f.id)! });
    }
  }

  const concrete = new SBuf();
  const rail = new SBuf();
  const mossy = new Color(0.33, 0.34, 0.29), stained = new Color(0.4, 0.39, 0.36), under = new Color(0.16, 0.16, 0.15);
  // The concrete map averages ~0.09 linear: multipliers > 1 give the overpass a light, weathered-concrete albedo (~0.2).
  const fascia = new Color(2.4, 2.35, 2.2), pier = new Color(1.5, 1.47, 1.38);
  const railC = new Color(0.22, 0.17, 0.12);
  let seed = 1;
  const rnd = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647);

  for (const f of ruins) {
    // Resample at STEP.
    const src = f.xz.map(([x, z]) => toW(x, z));
    const pts: [number, number][] = [];
    for (let k = 0; k + 1 < src.length; k++) {
      const [ax, az] = src[k]!, [bx, bz] = src[k + 1]!;
      const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / STEP));
      for (let m = 0; m < n; m++) pts.push([ax + ((bx - ax) * m) / n, az + ((bz - az) * m) / n]);
    }
    pts.push(src[src.length - 1]!);
    if (pts.length < 2) continue;
    const isBridge = !!f.bridge;
    if (isBridge) {
      // OSM bridge ways are short: extend the deck along its axis until both ends stand ≥ 4 m behind the barriers.
      for (const atEnd of [false, true]) {
        for (let guard = 0; guard < 30; guard++) {
          const e = atEnd ? pts[pts.length - 1]! : pts[0]!;
          const p = atEnd ? pts[pts.length - 2]! : pts[1]!;
          if (outsideWall(e[0], e[1]) > 4) break;
          const dx = e[0] - p[0], dz = e[1] - p[1], l = Math.hypot(dx, dz) || 1;
          const q: [number, number] = [e[0] + (dx / l) * 2, e[1] + (dz / l) * 2];
          if (atEnd) pts.push(q);
          else pts.unshift(q);
        }
      }
    }
    const deckY = bridgeY.get(f.id) ?? 0;
    // Per-vertex frame, height, bank.
    const n = pts.length;
    const rows: { l: P3; r: P3; lb: P3; rb: P3; ok: boolean; tx: number; tz: number }[] = [];
    for (let i = 0; i < n; i++) {
      const a = pts[Math.max(0, i - 1)]!, b = pts[Math.min(n - 1, i + 1)]!;
      let tx = b[0] - a[0], tz = b[1] - a[1];
      const tl = Math.hypot(tx, tz) || 1;
      tx /= tl;
      tz /= tl;
      const lx = tz, lz = -tx;
      // Signed curvature from the turn over ±2 samples.
      const a2 = pts[Math.max(0, i - 2)]!, b2 = pts[Math.min(n - 1, i + 2)]!;
      const h1 = Math.atan2(pts[i]![1] - a2[1], pts[i]![0] - a2[0]), h2 = Math.atan2(b2[1] - pts[i]![1], b2[0] - pts[i]![0]);
      let dh = h2 - h1;
      if (dh > Math.PI) dh -= 2 * Math.PI;
      if (dh < -Math.PI) dh += 2 * Math.PI;
      const kappa = dh / Math.max(1, Math.hypot(b2[0] - a2[0], b2[1] - a2[1]) / 2);
      const bank = isBridge ? 0 : Math.min(MAX_BANK, Math.abs(kappa) * 120);
      const [x, z] = pts[i]!;
      let y = ground.height(x, z) + 0.15;
      if (isBridge) y = deckY;
      else {
        for (const e of ends) {
          const d = Math.hypot(e.x - x, e.z - z);
          if (d < 120) y = Math.max(y, e.y - (e.y - y) * Math.min(1, d / 120));
        }
      }
      // The outside of the curve rises (kappa > 0: turning left → outside is the right).
      const rise = Math.tan(bank) * WIDTH;
      const yl = y + (kappa < 0 ? rise : 0), yr = y + (kappa > 0 ? rise : 0);
      const hw = WIDTH / 2;
      const l: P3 = [x + lx * hw, yl, z + lz * hw], r: P3 = [x - lx * hw, yr, z - lz * hw];
      const lb: P3 = [l[0], Math.min(yl, y) - (isBridge ? DECK : 0.6), l[2]], rb: P3 = [r[0], Math.min(yr, y) - (isBridge ? DECK : 0.6), r[2]];
      // Never reach the track: ground-level ribbons stop 4 m outside the barriers (bridges pass over).
      const ok = isBridge || (outsideWall(l[0], l[2]) > 4 && outsideWall(r[0], r[2]) > 4 && outsideWall(x, z) > 4);
      rows.push({ l, r, lb, rb, ok, tx, tz });
    }
    for (let i = 0; i + 1 < n; i++) {
      const A = rows[i]!, B = rows[i + 1]!;
      if (!A.ok || !B.ok) continue;
      const weather = rnd();
      const top = weather < 0.55 ? mossy : stained;
      concrete.quad([A.l, A.r, B.l, B.r], [0, 1, 0], top);
      concrete.quad([A.l, A.lb, B.l, B.lb], [A.tz, 0, -A.tx], isBridge ? fascia : stained);
      concrete.quad([A.r, A.rb, B.r, B.rb], [-A.tz, 0, A.tx], isBridge ? fascia : stained);
      if (isBridge) {
        concrete.quad([A.lb, A.rb, B.lb, B.rb], [0, -1, 0], under);
        // Parapets: outer face continues the deck side up as one tall fascia, plus inner face and cap.
        const up = (p: P3, inset: number, side: number): P3 => [p[0] - side * A.tz * inset, p[1] + PARAPET, p[2] + side * A.tx * inset];
        for (const [a, b, side] of [[A.l, B.l, 1], [A.r, B.r, -1]] as [P3, P3, number][]) {
          const n: P3 = [side * A.tz, 0, -side * A.tx];
          const ia: P3 = [a[0] - side * A.tz * 0.3, a[1], a[2] + side * A.tx * 0.3], ib: P3 = [b[0] - side * A.tz * 0.3, b[1], b[2] + side * A.tx * 0.3];
          concrete.quad([up(a, 0, side), a, up(b, 0, side), b], n, fascia);
          concrete.quad([ia, up(a, 0.3, side), ib, up(b, 0.3, side)], [-n[0], 0, -n[2]], stained);
          concrete.quad([up(a, 0, side), up(b, 0, side), up(a, 0.3, side), up(b, 0.3, side)], [0, 1, 0], stained);
        }
      }
      // Broken railing on both edges: posts every 6 m, a top rail where the neighbour post survives.
      for (const [p, q] of [[A.l, B.l], [A.r, B.r]] as [P3, P3][]) {
        if (isBridge || rnd() < 0.3) continue;
        const post = (o: P3): void => {
          const s = 0.06;
          rail.quad([[o[0] - s, o[1], o[2]], [o[0] + s, o[1], o[2]], [o[0] - s, o[1] + 1.1, o[2]], [o[0] + s, o[1] + 1.1, o[2]]], [0, 0, 1], railC);
          rail.quad([[o[0], o[1], o[2] - s], [o[0], o[1], o[2] + s], [o[0], o[1] + 1.1, o[2] - s], [o[0], o[1] + 1.1, o[2] + s]], [1, 0, 0], railC);
        };
        post(p);
        if (rnd() < 0.6) rail.quad([[p[0], p[1] + 1.0, p[2]], [q[0], q[1] + 1.0, q[2]], [p[0], p[1] + 1.1, p[2]], [q[0], q[1] + 1.1, q[2]]], [A.tz, 0, -A.tx], railC);
      }
      // Tree / building blockers along the ribbon.
      if (i % 4 === 0) {
        const cx = (A.l[0] + A.r[0]) / 2, cz = (A.l[2] + A.r[2]) / 2;
        c.blockers.push({ cx, cz, ux: A.tx, uz: A.tz, hu: STEP * 2.5, hv: WIDTH / 2 + 3 });
      }
    }
    // Overpass piers at the bridge ends and every 20 m along it, wherever they stand ≥ 3 m behind the barriers.
    if (isBridge) {
      const step = Math.max(1, Math.round(20 / STEP));
      for (let i = 0; i < n; i = i + step >= n && i !== n - 1 ? n - 1 : i + step) {
        const R = rows[i]!;
        const [x, z] = pts[i]!;
        if (outsideWall(x, z) < 3 + 0.8) continue;
        const gy = ground.height(x, z);
        const w = 0.8;
        const ux = R.tx, uz = R.tz, vx = R.tz, vz = -R.tx;
        const top = R.lb[1];
        const corner = (a: number, b: number, y: number): P3 => [x + ux * a + vx * b, y, z + uz * a + vz * b];
        for (const [a0, b0, a1, b1, nx, nz] of [[-w, -4, w, -4, -vx, -vz], [w, 4, -w, 4, vx, vz], [-w, 4, -w, -4, -ux, -uz], [w, -4, w, 4, ux, uz]] as const) {
          concrete.quad([corner(a0, b0, gy - 0.5), corner(a1, b1, gy - 0.5), corner(a0, b0, top), corner(a1, b1, top)], [nx, 0, nz], pier);
        }
      }
    }
  }

  const concreteMat = envMaterial(c.sh, { name: 'ruins.concrete', family: 'opaque', vertexColor: true, map: c.tex.concrete.map, normalMap: c.tex.concrete.normal, roughness: 0.95, wet: 0.7 });
  const railMat = envMaterial(c.sh, { name: 'ruins.rail', family: 'opaque', vertexColor: true, roughness: 0.8, metalness: 0.3, wet: 0.5 });
  const geos = [concrete.geometry(), rail.geometry()];
  const mats = [concreteMat, railMat];
  geos.forEach((g, k) => {
    const m = new Mesh(g, mats[k]);
    m.name = `ruins.${k === 0 ? 'concrete' : 'rail'}`;
    m.castShadow = k === 0 && c.quality.id !== 'low';
    m.receiveShadow = true;
    m.matrixAutoUpdate = false;
    group.add(m);
  });
  const triangles = geos.reduce((a, g) => a + g.index!.count / 3, 0);
  return {
    root: group,
    triangles,
    dispose() {
      for (const g of geos) g.dispose();
      for (const m of mats) m.dispose();
      group.removeFromParent();
    },
  };
}
