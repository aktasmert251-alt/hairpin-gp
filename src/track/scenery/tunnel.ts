// Bored tunnel set shared by the authored tracks (alpine, aegean): inner shell with a flattened arch, lamp strips on
// both shoulders, the rock overburden over the bore (never below the roof nor the terrain) and the portal faces with a
// concrete head frame. Geometry goes into the caller's buffers (shell + portals → st, overburden → rock, lamps → lamps).

import { Color } from 'three';
import type { TrackFrame } from '../../contracts/track';
import type { EnvContext } from './environment';
import type { SBuf } from './stands';

const sst = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export const WALL_H = 5.5;
export const ROOF_RISE = 2.2;

/** `from`/`to`: authoring-basis s range of the bore; `ridge(E, N)`: rock height above the road (map metres). */
/** `tint(x, z, y)` (optional): rock colour of the overburden and the portal faces (default grey alpine rock). */
export function buildTunnel(c: EnvContext, st: SBuf, rock: SBuf, lamps: SBuf, from: number, to: number, ridge: (e: number, n: number) => number,
  tint?: (x: number, z: number, y: number) => Color): void {
  const { data, query: q } = c.track;
  const ex = c.ex;
  const ground = c.ground!;
  const mapE = (x: number): number => x / ex.reg.k + ex.reg.cx;
  const mapN = (z: number): number => -(z / ex.reg.k + ex.reg.cz);
  const f: TrackFrame = { s: 0, px: 0, py: 0, pz: 0, tx: 1, tz: 0, lx: 0, lz: -1, halfWidthL: 0, halfWidthR: 0, crossSlope: 0, curvature: 0, vCurvature: 0, grade: 0, sector: 0 };
  const P = { x: 0, y: 0, z: 0 };
  const s0 = q.wrapS(from * ex.sScale), s1 = q.wrapS(to * ex.sScale);
  const conc = new Color(0.55, 0.54, 0.51), soot = new Color(0.2, 0.2, 0.2), lampC = new Color(1, 0.86, 0.62);
  const STEP = 3;
  /** Profile point of the bore at lateral parameter k (0..1 left wall foot → arch → right wall foot), local (d, y). */
  const halfAt = (s: number): number => Math.max(data.wallL[Math.round(s) % data.count]!, data.wallR[Math.round(s) % data.count]!) + 0.3;
  const prof = (W: number): [number, number, number, number][] => {
    // (d, y, nd, ny): inward normals.
    const out: [number, number, number, number][] = [[W, -0.3, -1, 0], [W, WALL_H, -1, 0]];
    for (let k = 1; k < 8; k++) {
      const a = (k / 8) * Math.PI;
      const d = W * Math.cos(a), y = WALL_H + ROOF_RISE * Math.sin(a);
      out.push([d, y, -Math.cos(a) / W, -Math.sin(a) / ROOF_RISE]);
    }
    out.push([-W, WALL_H, 1, 0], [-W, -0.3, 1, 0]);
    return out;
  };
  const world = (s: number, d: number, y: number): number[] => {
    q.worldFromSD(s, d, P);
    return [P.x, P.y + y, P.z];
  };
  for (let s = s0; s < s1 - 1e-6; s += STEP) {
    const e = Math.min(s1, s + STEP);
    q.frameAt(s, f);
    const W = halfAt(s);
    const pr = prof(W);
    for (let k = 0; k + 1 < pr.length; k++) {
      const [da, ya, na, ma] = pr[k]!, [db, yb] = pr[k + 1]!;
      const nl = Math.hypot(na, ma) || 1;
      // Normal in world: lateral component along the left normal (lx, lz).
      const n = [(f.lx * na) / nl, ma / nl, (f.lz * na) / nl];
      const col = ya < 1.2 && yb < 1.2 ? soot : conc;
      st.quad([world(s, da, ya), world(e, da, ya), world(s, db, yb), world(e, db, yb)], n, col);
    }
    // Lamp strips: a 3 m light every 12 m on both shoulders of the arch.
    if (Math.floor(s / 12) !== Math.floor(e / 12)) {
      for (const side of [1, -1]) {
        const d = side * (W - 0.15);
        lamps.quad([world(s, d, WALL_H - 0.3), world(Math.min(s1, s + 3), d, WALL_H - 0.3), world(s, d, WALL_H + 0.25), world(Math.min(s1, s + 3), d, WALL_H + 0.25)],
          [-side * f.lx, 0, -side * f.lz], lampC);
      }
    }
  }

  // Overburden: the rock spur over the bore, a grid patch in (s, d); its height is the full spur above the road,
  // never below the roof (+2.6 m) nor below the terrain. Portal faces close it at both ends.
  const OB_D = 85, OB_DS = 5;
  const dsN = Math.round((2 * OB_D) / OB_DS);
  const sN = Math.max(2, Math.ceil((s1 - s0) / 5));
  const obY = (s: number, d: number): number => {
    q.worldFromSD(s, d, P);
    const road = q.worldFromSD(s, 0, { x: 0, y: 0, z: 0 }).y;
    const gy = ground.height(P.x, P.z);
    const W = halfAt(s);
    const rg = ridge(mapE(P.x), mapN(P.z));
    // Rounded crest across the bore, broken up by a little noise (no flat slab).
    const k = sst(W + 20, OB_D, Math.abs(d));
    const crest = Math.max(rg, WALL_H + ROOF_RISE + 2.6) * (1 - 0.3 * (Math.abs(d) / OB_D) ** 2);
    const rough = 1.6 * Math.sin(P.x * 0.21 + P.z * 0.13) * Math.sin(P.z * 0.17 - P.x * 0.07) * sst(W + 4, W + 14, Math.abs(d));
    const top = road + crest * (1 - k) + rg * 0.85 * k + rough;
    return Math.max(gy + 0.25, top);
  };
  const obPos: number[][] = [];
  for (let a = 0; a <= sN; a++) {
    const s = s0 + ((s1 - s0) * a) / sN;
    for (let b = 0; b <= dsN; b++) {
      const d = -OB_D + b * OB_DS;
      const y = obY(s, d);
      q.worldFromSD(s, d, P);
      obPos.push([P.x, y, P.z]);
    }
  }
  const rockCol = tint ?? ((x: number, z: number, y: number): Color => {
    const h = Math.sin(x * 0.051 + z * 0.037) * 0.5 + Math.sin(x * 0.013 - z * 0.021) * 0.5;
    const g = 0.36 + 0.08 * h;
    return y > 0 ? new Color(g, g * 0.97, g * 0.92) : new Color(g * 1.1, g * 1.08, g * 1.02);
  });
  for (let a = 0; a < sN; a++) {
    for (let b = 0; b < dsN; b++) {
      const A = obPos[a * (dsN + 1) + b]!, B = obPos[(a + 1) * (dsN + 1) + b]!, Cc = obPos[a * (dsN + 1) + b + 1]!, D = obPos[(a + 1) * (dsN + 1) + b + 1]!;
      const ux = B[0]! - A[0]!, uy = B[1]! - A[1]!, uz = B[2]! - A[2]!;
      const vx = Cc[0]! - A[0]!, vy = Cc[1]! - A[1]!, vz = Cc[2]! - A[2]!;
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
      if (nx * nx + ny * ny + nz * nz < 1e-12) { nx = 0; ny = 1; nz = 0; }
      rock.quad([A, B, Cc, D], [nx, ny, nz], rockCol(A[0]!, A[2]!, A[1]!));
    }
  }
  // Portal faces (rock beyond, a concrete head frame around the arch).
  for (const [s, out] of [[s0, -1], [s1, 1]] as const) {
    q.frameAt(s, f);
    const W = halfAt(s);
    const n = [out * f.tx * 0.7, 0.7, out * f.tz * 0.7];
    for (let b = 0; b < dsN; b++) {
      const da = -OB_D + b * OB_DS, db = da + OB_DS;
      // Split the column at the bore edges so the opening follows the arch.
      const cuts = [da, db];
      for (const e of [-W, W]) if (e > da && e < db) cuts.splice(1, 0, e);
      cuts.sort((x, y) => x - y);
      for (let k = 0; k + 1 < cuts.length; k++) {
        const u0 = cuts[k]!, u1 = cuts[k + 1]!;
        const um = (u0 + u1) / 2;
        const inBore = Math.abs(um) < W;
        const bot = (d: number): number => {
          if (inBore) return WALL_H + ROOF_RISE * Math.sqrt(Math.max(0, 1 - (d / W) ** 2));
          q.worldFromSD(s, d, P);
          return ground.height(P.x, P.z) - q.worldFromSD(s, 0, { x: 0, y: 0, z: 0 }).y - 1;
        };
        const road = q.worldFromSD(s, 0, { x: 0, y: 0, z: 0 }).y;
        const t0 = obY(s, u0) - road, t1 = obY(s, u1) - road;
        const frame = Math.abs(um) < W + 3;
        q.worldFromSD(s, u0, P);
        const col = frame ? conc : tint ? tint(P.x, P.z, P.y + (t0 + bot(u0)) / 2) : rockCol(u0, s, 0);
        // Rock beyond the concrete head frame leans back: its foot sits up to 0.5 m out per metre of height (blended
        // per vertex so neighbouring columns stay joined).
        const lean = (u: number): number => out * 0.5 * sst(W + 3, W + 14, Math.abs(u));
        const b0 = bot(u0), b1 = bot(u1);
        st.quad([world(s + lean(u0) * (t0 - b0), u0, b0), world(s + lean(u1) * (t1 - b1), u1, b1), world(s, u0, t0), world(s, u1, t1)], n, col);
      }
    }
  }
}
