// Desert Cliff extras (docs/design/tracks-cliff.md §7–§8): the elevated T1 ramp in white / sand architectural concrete
// (panelled fascias with LED housings, a sculpted soffit, tapered Y-columns on the plateau, a cantilever blade web over
// the escarpment), continuous LED strips (fascias, catch-fence tops, two lines under the deck), and the entertainment
// city around the circuit: towers and a hospitality building (façade program), a glass grandstand (authoring STANDS),
// a rollercoaster with a vertical loop, a drop tower and a big wheel, a water-park lagoon with slides, parking with cars,
// desert roads and palm groves. Empty group on every other track. Draws: structure (incl. parked cars) 1, LEDs 1,
// towers 1, palms 1, lagoon 1. Env families only.

import { Color, Group, InstancedBufferAttribute, InstancedMesh, Matrix4, Mesh, Quaternion, Vector3 } from 'three';
import type { TrackFrame } from '../../contracts/track';
import { plateauInside } from '../authoring/cliff-ctrl';
import { envMaterial, EnvMode, envUniforms } from '../materials/shared';
import { makeRand } from '../mesh/textures';
import type { EnvContext, EnvPart } from './environment';
import { blockGeometry } from './skyline';
import { boxInFrame, SBuf } from './stands';

const sst = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Walkway beyond the barrier (m): wide enough for the floodlight poles at wall + 2.5. */
const WALK = 3.6;
/** LED line height above the deck along the catch fences (concrete 1.1 m + fence). */
const FENCE_LED = 4.3;
/** Fascia panel length (m) and the soffit cross-section samples. */
const PANEL = 9;
const SOFFIT = [0, 0.18, 0.4, 0.6, 0.82, 1];

/** Palm in a unit frame: tapering trunk and eight drooping fronds (flat boxes, no double-sided program needed). */
function palmGeometry(): SBuf {
  const b = new SBuf();
  const bark = new Color(0.2, 0.14, 0.08), leaf = new Color(0.06, 0.13, 0.035);
  for (let k = 0; k < 6; k++) {
    const r = 0.32 - k * 0.03;
    boxInFrame(b, { x: Math.sin(k * 0.5) * 0.15, y: k * 1.6, z: 0 }, [-r, r], [-r, r], [0, 1.65], 1, 0, 0, 1, bark);
  }
  for (let f = 0; f < 8; f++) {
    const a = (f / 8) * Math.PI * 2;
    const ux = Math.cos(a), uz = Math.sin(a);
    for (let k = 0; k < 3; k++) {
      const u0 = 0.4 + k * 1.4, u1 = u0 + 1.5;
      const y0 = 9.7 - 0.25 * k * k, y1 = 9.7 - 0.25 * (k + 1) * (k + 1);
      const w = 0.55 - k * 0.12;
      const p = (u: number, v: number, y: number): number[] => [ux * u - uz * v, y, uz * u + ux * v];
      b.quad([p(u0, -w, y0), p(u1, -w, y1), p(u0, w, y0), p(u1, w, y1)], [0, 1, 0], leaf);
      b.quad([p(u0, w, y0 - 0.05), p(u1, w, y1 - 0.05), p(u0, -w, y0 - 0.05), p(u1, -w, y1 - 0.05)], [0, -1, 0], leaf);
    }
  }
  return b;
}

/** Quad between two cross-section points (a0 → b0 at station s, a1 → b1 at station e), outward normal n. */
type V3 = number[];

export function createCliff(c: EnvContext): EnvPart & { triangles: number } {
  const group = new Group();
  group.name = 'cliff';
  const decksA = c.ex.authoring.DECKS ?? [];
  if (c.ex.authoring.id !== 'cliff' || decksA.length === 0) return { root: group, triangles: 0, dispose: () => group.removeFromParent() };
  const { data, query: q } = c.track;
  const ex = c.ex;
  const ground = c.ground!;
  const rand = makeRand(2034);
  const f: TrackFrame = { s: 0, px: 0, py: 0, pz: 0, tx: 1, tz: 0, lx: 0, lz: -1, halfWidthL: 0, halfWidthR: 0, crossSlope: 0, curvature: 0, vCurvature: 0, grade: 0, sector: 0 };
  const P = { x: 0, y: 0, z: 0 };
  const st = new SBuf();
  const led = new SBuf();
  const info = { s: 0, d: 0, covered: false, nearTrack: 0 };
  const mapE = (x: number): number => x / ex.reg.k + ex.reg.cx;
  const mapN = (z: number): number => -(z / ex.reg.k + ex.reg.cz);
  const wx = (E: number): number => (E - ex.reg.cx) * ex.reg.k;
  const wz = (N: number): number => (-N - ex.reg.cz) * ex.reg.k;
  let tris = 0;

  // ---- the ramp deck (from the first to the last DECKS row) ----
  const s0 = q.wrapS(Math.min(...decksA.map((d) => d.from)) * ex.sScale), s1 = q.wrapS(Math.max(...decksA.map((d) => d.to)) * ex.sScale);
  const STEP = 3;
  // Vertex colours multiply the grey concrete map (≈ 0.55): > 1 gives white / sand architectural concrete.
  const white = new Color(1.65, 1.6, 1.5), sand = new Color(1.5, 1.33, 1.08), joint = new Color(0.75, 0.7, 0.62);
  const housing = new Color(0.2, 0.2, 0.22), soffitC = new Color(1.55, 1.48, 1.34), web = new Color(1.6, 1.52, 1.38);
  const cyan = new Color(0.35, 0.85, 1), magenta = new Color(1, 0.25, 0.75), warm = new Color(1, 0.95, 0.88);
  const W = (s: number, side: 1 | -1): number => (side === 1 ? data.wallL : data.wallR)[Math.round(s) % data.count]! + WALK;
  const at = (s: number, d: number, y: number): V3 => {
    q.worldFromSD(s, d, P);
    return [P.x, P.y + y, P.z];
  };
  /** Deck height above the natural ground at s (0 where the ramp meets the plateau). */
  const lift = (s: number): number => {
    q.worldFromSD(s, 0, P);
    return P.y - ground.dem(P.x, P.z);
  };
  /** Structural depth at the centre line: 2.4 m on the plateau, 4.5 m where the deck overhangs the escarpment. */
  const depth = (s: number): number => {
    const h = lift(s);
    return h < 1.5 ? 0 : 2.4 + 2.1 * sst(45, 90, h);
  };
  /** Escarpment overhang: > 0 metres beyond the cliff edge under the centre line. */
  const beyond = (s: number): number => {
    q.worldFromSD(s, 0, P);
    return -plateauInside(mapE(P.x), mapN(P.z));
  };
  let colAcc = 0;
  for (let s = s0; s < s1 - 1e-6; s += STEP) {
    const e = Math.min(s1, s + STEP);
    const da = depth(s), de = depth(e);
    if (da <= 0 && de <= 0) continue;
    q.frameAt(s, f);
    const L0 = W(s, 1), L1 = W(e, 1), R0 = -W(s, -1), R1 = -W(e, -1);
    // Panelled fascia: white panels with a sand band below, a dark joint every PANEL metres.
    const isJoint = Math.floor(s / PANEL) !== Math.floor(e / PANEL);
    const fasc = white;
    // Walkway tops.
    st.quad([at(s, L0 - WALK, -0.04), at(e, L1 - WALK, -0.04), at(s, L0, -0.04), at(e, L1, -0.04)], [0, 1, 0], sand);
    st.quad([at(s, R0, -0.04), at(e, R1, -0.04), at(s, R0 + WALK, -0.04), at(e, R1 + WALK, -0.04)], [0, 1, 0], sand);
    // Fascias: LED housing band (dark, recessed look) at the top, white panel, sand plinth band; the edge is 75 % of the
    // centre depth (the soffit vaults down towards the middle).
    for (const side of [1, -1] as const) {
      const dA = side === 1 ? L0 : R0, dE = side === 1 ? L1 : R1;
      const n = [side * f.lx, 0, side * f.lz];
      const ea = 0.75 * da + 0.8, ee = 0.75 * de + 0.8;
      const strip = (y0a: number, y0e: number, y1a: number, y1e: number, col: Color): void => {
        const p = [at(s, dA, -y0a), at(e, dE, -y0e), at(s, dA, -y1a), at(e, dE, -y1e)];
        st.quad(side === 1 ? p : [p[1]!, p[0]!, p[3]!, p[2]!], n, col);
      };
      strip(0.75, 0.75, 0, 0, housing);
      strip(ea * 0.86, ee * 0.86, 0.75, 0.75, fasc);
      strip(ea, ee, ea * 0.86, ee * 0.86, sand);
      // Panel joint: a 0.25 m dark reveal standing 2 cm proud of the fascia.
      if (isJoint) {
        const sj = (Math.floor(e / PANEL) * PANEL), dj = side === 1 ? W(sj, 1) + 0.02 : -W(sj, -1) - 0.02;
        const jp = [at(sj - 0.12, dj, -ea), at(sj + 0.12, dj, -ea), at(sj - 0.12, dj, -0.75), at(sj + 0.12, dj, -0.75)];
        st.quad(side === 1 ? jp : [jp[1]!, jp[0]!, jp[3]!, jp[2]!], n, joint);
      }
      // LED line inside the housing, and the housing bar on top of the catch fence.
      const ledCol = Math.floor(s / 60) % 4 === 3 ? magenta : cyan;
      const lp = [at(s, dA + side * 0.03, -0.55), at(e, dE + side * 0.03, -0.55), at(s, dA + side * 0.03, -0.25), at(e, dE + side * 0.03, -0.25)];
      led.quad(side === 1 ? lp : [lp[1]!, lp[0]!, lp[3]!, lp[2]!], n, ledCol);
      const fa = side * (W(s, side) - WALK - 0.25), fe = side * (W(e, side) - WALK - 0.25);
      st.quad([at(s, fa, FENCE_LED + 0.3), at(e, fe, FENCE_LED + 0.3), at(s, fa + side * 0.35, FENCE_LED + 0.3), at(e, fe + side * 0.35, FENCE_LED + 0.3)], [0, 1, 0], housing);
      st.quad([at(s, fa + side * 0.35, FENCE_LED - 0.1), at(e, fe + side * 0.35, FENCE_LED - 0.1), at(s, fa + side * 0.35, FENCE_LED + 0.3), at(e, fe + side * 0.35, FENCE_LED + 0.3)], n, housing);
      led.quad([at(s, fa - side * 0.02, FENCE_LED), at(e, fe - side * 0.02, FENCE_LED), at(s, fa - side * 0.02, FENCE_LED + 0.2), at(e, fe - side * 0.02, FENCE_LED + 0.2)], [-side * f.lx, 0, -side * f.lz], warm);
    }
    // Sculpted soffit: a shallow vault across the width (edges at 75 % of the centre depth).
    const dep = (t: number, d0: number): number => d0 * (0.75 + 0.25 * Math.sin(Math.PI * t)) + 0.8;
    for (let k = 0; k + 1 < SOFFIT.length; k++) {
      const ta = SOFFIT[k]!, tb = SOFFIT[k + 1]!;
      const pa = R0 + (L0 - R0) * ta, pb = R0 + (L0 - R0) * tb, qa = R1 + (L1 - R1) * ta, qb = R1 + (L1 - R1) * tb;
      st.quad([at(s, pa, -dep(ta, da)), at(e, qa, -dep(ta, de)), at(s, pb, -dep(tb, da)), at(e, qb, -dep(tb, de))], [0, -1, 0], soffitC);
    }
    // Two LED lines along the soffit.
    for (const t of [0.3, 0.7]) {
      const pa = R0 + (L0 - R0) * t, qa = R1 + (L1 - R1) * t;
      led.quad([at(s, pa - 0.2, -dep(t, da) - 0.03), at(e, qa - 0.2, -dep(t, de) - 0.03), at(s, pa + 0.2, -dep(t, da) - 0.03), at(e, qa + 0.2, -dep(t, de) - 0.03)], [0, -1, 0], Math.floor(s / 60) % 4 === 3 ? magenta : cyan);
    }
    // Cantilever blade: a tapered central web under the deck where it overhangs the escarpment (deepest at the edge).
    const bA = beyond(s), bE = beyond(e);
    if (bA > -20 || bE > -20) {
      const wd = (b: number): number => 30 * sst(-20, 0, b) * (1 - sst(0, 150, b));
      const wa = wd(bA), we = wd(bE);
      if (wa > 0.5 || we > 0.5) {
        const mid = (L0 + R0) / 2, mie = (L1 + R1) / 2;
        for (const side of [1, -1] as const) {
          const ofs = side * 1.4;
          const p = [at(s, mid + ofs, -dep(0.5, da) - wa), at(e, mie + ofs, -dep(0.5, de) - we), at(s, mid + ofs * 1.6, -dep(0.5, da)), at(e, mie + ofs * 1.6, -dep(0.5, de))];
          st.quad(side === 1 ? p : [p[1]!, p[0]!, p[3]!, p[2]!], [side * f.lx, 0, side * f.lz], web);
        }
        st.quad([at(s, mid - 1.4, -dep(0.5, da) - wa), at(e, mie - 1.4, -dep(0.5, de) - we), at(s, mid + 1.4, -dep(0.5, da) - wa), at(e, mie + 1.4, -dep(0.5, de) - we)], [0, -1, 0], sand);
      }
    }
    // Tapered Y-columns every 42 m where the plateau is below (none beyond the edge: the blade cantilevers).
    colAcc += STEP;
    const h = lift(s);
    if (colAcc >= 42 && h > 4 && h < 90 && bA < -25) {
      colAcc = 0;
      const mid = (L0 + R0) / 2;
      q.worldFromSD(s, mid, P);
      const gy = ground.dem(P.x, P.z);
      const top = P.y - dep(0.5, da);
      const H = top - gy;
      // Shaft tapering from 2.6 × 2.0 m at the foot to 1.6 × 1.4 m, then a flared head (Y) under the soffit.
      const shaftTop = gy + H * 0.78;
      const tp = (u: number, v: number, y: number): V3 => [P.x + f.tx * u + f.lx * v, y, P.z + f.tz * u + f.lz * v];
      const box = (u0: number, v0: number, y0: number, u1: number, v1: number, y1: number, col: Color): void => {
        const faces: [number, number, number, number, V3][] = [[1, 1, -1, 1, [f.lx, 0, f.lz]], [-1, -1, 1, -1, [-f.lx, 0, -f.lz]], [1, -1, 1, 1, [f.tx, 0, f.tz]], [-1, 1, -1, -1, [-f.tx, 0, -f.tz]]];
        for (const [ua, va, ub, vb, n] of faces) {
          st.quad([tp(ua * u0, va * v0, y0), tp(ub * u0, vb * v0, y0), tp(ua * u1, va * v1, y1), tp(ub * u1, vb * v1, y1)], n, col);
        }
      };
      box(1.3, 1.0, gy - 1, 0.8, 0.7, shaftTop, white);
      box(0.8, 0.7, shaftTop, 1.6, (L0 - R0) * 0.32, top + 0.2, white);
      c.blockers.push({ cx: P.x, cz: P.z, ux: f.tx, uz: f.tz, hu: 8, hv: 8 });
    }
  }

  // ---- theme park: rollercoaster with a vertical loop, drop tower, big wheel ----
  const red = new Color(0.72, 0.08, 0.05), steel = new Color(0.82, 0.82, 0.84), yellow = new Color(0.85, 0.62, 0.06), teal = new Color(0.1, 0.55, 0.6);
  const rail = (pts: V3[], col: Color, sup: boolean): void => {
    for (let k = 0; k + 1 < pts.length; k++) {
      const A = pts[k]!, B = pts[k + 1]!;
      const dx = B[0]! - A[0]!, dz = B[2]! - A[2]!, l = Math.hypot(dx, dz) || 1;
      const nx = -dz / l, nz = dx / l;
      for (const off of [-0.7, 0.7]) {
        const o0 = off - 0.14, o1 = off + 0.14;
        st.quad([[A[0]! + nx * o0, A[1]!, A[2]! + nz * o0], [B[0]! + nx * o0, B[1]!, B[2]! + nz * o0], [A[0]! + nx * o1, A[1]!, A[2]! + nz * o1], [B[0]! + nx * o1, B[1]!, B[2]! + nz * o1]], [0, 1, 0], col);
        st.quad([[A[0]! + nx * off, A[1]! - 0.6, A[2]! + nz * off], [B[0]! + nx * off, B[1]! - 0.6, B[2]! + nz * off], [A[0]! + nx * off, A[1]!, A[2]! + nz * off], [B[0]! + nx * off, B[1]!, B[2]! + nz * off]], [nx, 0, nz], col);
      }
      if (sup && k % 3 === 0) {
        const gy = ground.dem(A[0]!, A[2]!);
        boxInFrame(st, { x: A[0]!, y: gy - 0.5, z: A[2]! }, [-0.4, 0.4], [-0.4, 0.4], [0, A[1]! - gy], dx / l, dz / l, nx, nz, steel);
      }
    }
  };
  const rc = { x: wx(1720), z: wz(560), r: 150 };
  const coaster: V3[] = [];
  const N = 120;
  for (let k = 0; k <= N; k++) {
    const a = (k / N) * Math.PI * 2;
    const r = rc.r * (1 + 0.28 * Math.sin(3 * a));
    const x = rc.x + Math.cos(a) * r * 1.4, z = rc.z + Math.sin(a) * r;
    coaster.push([x, ground.dem(x, z) + 12 + 30 * Math.max(0, Math.sin(2 * a + 0.5)) + 10 * Math.max(0, Math.sin(5 * a)), z]);
  }
  rail(coaster, red, true);
  // Vertical loop (radius 16 m) standing beside the circuit loop, on four legs.
  {
    const lx = rc.x - rc.r * 1.4 - 30, lz = rc.z, gy = ground.dem(lx, lz);
    const loop: V3[] = [];
    for (let k = 0; k <= 40; k++) {
      const a = (k / 40) * Math.PI * 2;
      loop.push([lx + Math.sin(a) * 16 + (k / 40) * 3, gy + 18 - Math.cos(a) * 16, lz + (k / 40) * 3]);
    }
    rail(loop, yellow, false);
    for (const [u, v] of [[-12, -4], [12, -4], [-12, 7], [12, 7]]) boxInFrame(st, { x: lx + u, y: gy - 0.5, z: lz + v }, [-0.5, 0.5], [-0.5, 0.5], [0, 20], 1, 0, 0, 1, steel);
  }
  // Drop tower: 110 m mast, ring gondola, cap.
  {
    const x = wx(930), z = wz(650), gy = ground.dem(x, z);
    boxInFrame(st, { x, y: gy - 1, z }, [-2.2, 2.2], [-2.2, 2.2], [0, 112], 1, 0, 0, 1, white);
    boxInFrame(st, { x, y: gy + 40, z }, [-6, 6], [-6, 6], [0, 3], 1, 0, 0, 1, teal);
    boxInFrame(st, { x, y: gy + 112, z }, [-4, 4], [-4, 4], [0, 4], 1, 0, 0, 1, red);
    c.blockers.push({ cx: x, cz: z, ux: 1, uz: 0, hu: 12, hv: 12 });
  }
  // Big wheel: 60 m rim of 24 segments, 12 spokes, A-frame legs, cabins.
  {
    const x = wx(300), z = wz(640), gy = ground.dem(x, z), R = 30, cy = gy + R + 6;
    const rim = (a: number): V3 => [x + Math.cos(a) * R, cy + Math.sin(a) * R, z];
    for (let k = 0; k < 24; k++) {
      const a0 = (k / 24) * Math.PI * 2, a1 = ((k + 1) / 24) * Math.PI * 2;
      const p0 = rim(a0), p1 = rim(a1);
      st.quad([[p0[0]!, p0[1]!, z - 0.6], [p1[0]!, p1[1]!, z - 0.6], [p0[0]!, p0[1]!, z + 0.6], [p1[0]!, p1[1]!, z + 0.6]], [Math.cos(a0), Math.sin(a0), 0], white);
      if (k % 2 === 0) {
        st.quad([[x, cy - 0.3, z], [p0[0]!, p0[1]! - 0.3, z], [x, cy + 0.3, z], [p0[0]!, p0[1]! + 0.3, z]], [0, 0, 1], steel);
        boxInFrame(st, { x: p0[0]!, y: p0[1]! - 3.5, z }, [-1.3, 1.3], [-1.3, 1.3], [0, 2.8], 1, 0, 0, 1, k % 4 === 0 ? teal : red);
      }
    }
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      st.quad([[x + sx * 14, gy, z + sz * 6], [x, cy, z + sz * 1.2], [x + sx * 14 + 1.2, gy, z + sz * 6], [x + 1.2 * sx, cy, z + sz * 1.2]], [0, 0, sz], steel);
    }
    c.blockers.push({ cx: x, cz: z, ux: 1, uz: 0, hu: 36, hv: 14 });
  }

  // ---- water park: a raised lagoon basin with a white rim, a beach and slides ----
  const lag = { x: wx(640), z: wz(400), a: 170, b: 95 };
  let lagY = -Infinity, lagLo = Infinity;
  for (let k = 0; k < 48; k++) {
    const t = (k / 48) * Math.PI * 2;
    for (const r of [0, 0.5, 1.05]) {
      const gy = ground.dem(lag.x + Math.cos(t) * lag.a * r, lag.z + Math.sin(t) * lag.b * r);
      lagY = Math.max(lagY, gy);
      lagLo = Math.min(lagLo, gy);
    }
  }
  lagY += 0.9;
  const rimC = new Color(0.9, 0.88, 0.84), beach = new Color(0.82, 0.72, 0.55);
  const lagoon = new SBuf();
  const water = new Color(1, 1, 1);
  for (let k = 0; k < 48; k++) {
    const t0 = (k / 48) * Math.PI * 2, t1 = ((k + 1) / 48) * Math.PI * 2;
    const e = (t: number, r: number, y: number): V3 => [lag.x + Math.cos(t) * lag.a * r, y, lag.z + Math.sin(t) * lag.b * r];
    lagoon.quad([e(t0, 0, lagY), e(t1, 0, lagY), e(t0, 1, lagY), e(t1, 1, lagY)], [0, 1, 0], water);
    st.quad([e(t0, 1, lagY + 0.25), e(t1, 1, lagY + 0.25), e(t0, 1.03, lagY + 0.25), e(t1, 1.03, lagY + 0.25)], [0, 1, 0], rimC);
    st.quad([e(t0, 1.03, lagY + 0.25), e(t1, 1.03, lagY + 0.25), e(t0, 1.16, lagY - 0.2), e(t1, 1.16, lagY - 0.2)], [0, 1, 0], beach);
    st.quad([e(t0, 1.16, lagLo - 1), e(t1, 1.16, lagLo - 1), e(t0, 1.16, lagY - 0.2), e(t1, 1.16, lagY - 0.2)], [Math.cos(t0), 0, Math.sin(t0)], beach);
  }
  // Slides: three coloured helices from a 22 m tower on the north shore.
  {
    const tx = lag.x, tz = lag.z - lag.b - 25;
    boxInFrame(st, { x: tx, y: lagY - 1, z: tz }, [-4, 4], [-4, 4], [0, 23], 1, 0, 0, 1, white);
    [teal, yellow, red].forEach((col, j) => {
      const pts: V3[] = [];
      for (let k = 0; k <= 50; k++) {
        const a = (k / 50) * Math.PI * 4 + j * 2.1;
        const r = 9 + k * 0.5;
        pts.push([tx + Math.cos(a) * r, lagY + 22 - k * 0.42, tz + Math.sin(a) * r * 0.6 + k * 0.9]);
      }
      rail(pts, col, false);
    });
  }
  c.blockers.push({ cx: lag.x, cz: lag.z, ux: 1, uz: 0, hu: lag.a + 30, hv: lag.b + 50 });

  // ---- parking with cars, desert roads ----
  const asph = new Color(0.16, 0.15, 0.14), line = new Color(0.75, 0.73, 0.68);
  const park = { x: wx(140), z: wz(330), w: 260, d: 110 };
  const pyOf = (x: number, z: number): number => ground.dem(x, z) + 0.45;
  const PG = 20;
  for (let i = 0; i < park.w / PG; i++) for (let j = 0; j < park.d / PG; j++) {
    const xa = park.x - park.w / 2 + i * PG, za = park.z - park.d / 2 + j * PG;
    st.quad([[xa, pyOf(xa, za), za], [xa + PG, pyOf(xa + PG, za), za], [xa, pyOf(xa, za + PG), za + PG], [xa + PG, pyOf(xa + PG, za + PG), za + PG]], [0, 1, 0], asph);
  }
  const cars: { x: number; y: number; z: number; yaw: number; col: Color }[] = [];
  const CAR_COL = [0xf2f2f2, 0x1a1a1c, 0x8a8f96, 0xb8241c, 0x23415f, 0xc9c3b4, 0x4a5a3a];
  for (let row = 0; row < 4; row++) {
    const zr = park.z - park.d / 2 + 14 + row * 26;
    for (let k = 0; k < 46; k++) {
      const xr = park.x - park.w / 2 + 8 + k * 5.4;
      st.quad([[xr - 2.7, pyOf(xr, zr) + 0.02, zr - 3], [xr - 2.6, pyOf(xr, zr) + 0.02, zr - 3], [xr - 2.7, pyOf(xr, zr) + 0.02, zr + 3], [xr - 2.6, pyOf(xr, zr) + 0.02, zr + 3]], [0, 1, 0], line);
      if (rand() < 0.22) continue;
      cars.push({ x: xr, y: pyOf(xr, zr), z: zr + (rand() - 0.5) * 0.6, yaw: Math.PI / 2 + (rand() < 0.5 ? 0 : Math.PI), col: new Color(CAR_COL[Math.floor(rand() * CAR_COL.length)]!).convertSRGBToLinear() });
    }
  }
  // Parked cars baked into the structure buffer (body in the car colour, dark glasshouse and wheels).
  const glass = new Color(0.05, 0.06, 0.07), tyre = new Color(0.03, 0.03, 0.03);
  for (const cr of cars) {
    const ux = Math.cos(cr.yaw), uz = -Math.sin(cr.yaw);
    const o = { x: cr.x, y: cr.y, z: cr.z };
    boxInFrame(st, o, [-2.25, 2.25], [-0.9, 0.9], [0.25, 0.95], ux, uz, -uz, ux, cr.col.multiplyScalar(1.8));
    boxInFrame(st, o, [-1.2, 1.1], [-0.8, 0.8], [0.95, 1.45], ux, uz, -uz, ux, glass);
    boxInFrame(st, o, [-1.9, 1.9], [-0.92, 0.92], [0, 0.3], ux, uz, -uz, ux, tyre);
  }
  c.blockers.push({ cx: park.x, cz: park.z, ux: 1, uz: 0, hu: park.w / 2 + 6, hv: park.d / 2 + 6 });
  const road = (pts: [number, number][], hw: number): void => {
    for (let k = 0; k + 1 < pts.length; k++) {
      const [ax, az] = [wx(pts[k]![0]), wz(pts[k]![1])], [bx, bz] = [wx(pts[k + 1]![0]), wz(pts[k + 1]![1])];
      const l = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.ceil(l / 10));
      const nx = -(bz - az) / l, nz = (bx - ax) / l;
      for (let m = 0; m < n; m++) {
        const x0 = ax + ((bx - ax) * m) / n, z0 = az + ((bz - az) * m) / n, x1 = ax + ((bx - ax) * (m + 1)) / n, z1 = az + ((bz - az) * (m + 1)) / n;
        st.quad([[x0 - nx * hw, pyOf(x0 - nx * hw, z0 - nz * hw), z0 - nz * hw], [x1 - nx * hw, pyOf(x1 - nx * hw, z1 - nz * hw), z1 - nz * hw],
          [x0 + nx * hw, pyOf(x0 + nx * hw, z0 + nz * hw), z0 + nz * hw], [x1 + nx * hw, pyOf(x1 + nx * hw, z1 + nz * hw), z1 + nz * hw]], [0, 1, 0], asph);
        c.blockers.push({ cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, ux: (bx - ax) / l, uz: (bz - az) / l, hu: l / n / 2 + 1, hv: hw + 3 });
      }
    }
  };
  // Infield boulevard: parking → lagoon → drop tower → big wheel → parking.
  road([[270, 330], [460, 330], [520, 300], [800, 290], [880, 380], [900, 560], [700, 720], [420, 740], [300, 700], [160, 600], [140, 390]], 6);

  const stGeo = st.geometry();
  const stMat = envMaterial(c.sh, { name: 'cliff.struct', family: 'opaque', vertexColor: true, map: c.tex.concrete.map, normalMap: c.tex.concrete.normal, roughness: 0.8, wet: 0.5 });
  const stMesh = new Mesh(stGeo, stMat);
  stMesh.name = 'cliff.struct';
  stMesh.castShadow = true;
  stMesh.receiveShadow = true;
  stMesh.matrixAutoUpdate = false;
  group.add(stMesh);
  const ledGeo = led.geometry();
  const ledMat = envMaterial(c.sh, { name: 'cliff.leds', family: 'opaque', mode: EnvMode.Lamp, vertexColor: true, emissive: 0xffffff, emissiveIntensity: 0.5, roughness: 0.3, wet: 0, flood: 0 });
  const ledMesh = new Mesh(ledGeo, ledMat);
  ledMesh.name = 'cliff.leds';
  ledMesh.matrixAutoUpdate = false;
  group.add(ledMesh);
  const lagGeo = lagoon.geometry();
  const lagMat = envMaterial(c.sh, { name: 'cliff.lagoon', family: 'opaque', mode: EnvMode.Water, roughness: 0.05, wet: 0, flood: 0.6, param: 1 });
  const lagMesh = new Mesh(lagGeo, lagMat);
  lagMesh.name = 'cliff.lagoon';
  lagMesh.receiveShadow = true;
  lagMesh.matrixAutoUpdate = false;
  group.add(lagMesh);
  tris += (stGeo.index!.count + ledGeo.index!.count + lagGeo.index!.count) / 3;

  // ---- entertainment-city towers + hospitality building (1 draw, the façade program: lit windows at night) ----
  type Tower = { x: number; y: number; z: number; w: number; d: number; h: number; yaw: number; col: number; seed: number };
  const towers: Tower[] = [];
  const TINT = [0x8fb4c8, 0xc9b27a, 0x9aa7b8, 0xe0d6c2, 0x7d96aa, 0xd9c49a];
  // Hospitality pavilion and glass grandstand back beside the ramp foot (north side).
  {
    q.frameAt(q.wrapS(470 * ex.sScale), f);
    q.worldFromSD(q.wrapS(470 * ex.sScale), 34, P);
    towers.push({ x: P.x, y: ground.dem(P.x, P.z), z: P.z, w: 170, d: 26, h: 19, yaw: Math.atan2(-f.tz, f.tx), col: 0x9fc3d6, seed: 0.37 });
    c.blockers.push({ cx: P.x, cz: P.z, ux: f.tx, uz: f.tz, hu: 95, hv: 22 });
  }
  const clusters = [{ e: 2000, n: 850, r: 260, k: 12 }, { e: 450, n: 1500, r: 260, k: 12 }, { e: 1650, n: -80, r: 160, k: 6 }, { e: -520, n: 520, r: 120, k: 5 }];
  for (const cl of clusters) {
    for (let k = 0, tries = 0; k < cl.k && tries < cl.k * 25; tries++) {
      const a = rand() * Math.PI * 2, r = Math.sqrt(rand()) * cl.r;
      const x = wx(cl.e) + Math.cos(a) * r, z = wz(cl.n) + Math.sin(a) * r;
      const y = ground.height(x, z, info);
      if (info.nearTrack > 0.01 || plateauInside(mapE(x), mapN(z)) < 30 || towers.some((t) => Math.hypot(t.x - x, t.z - z) < 60)) continue;
      if (c.blockers.some((b) => Math.abs((x - b.cx) * b.ux + (z - b.cz) * b.uz) < b.hu + 20 && Math.abs((x - b.cx) * b.uz - (z - b.cz) * b.ux) < b.hv + 20)) continue;
      const w = 24 + rand() * 22, d = 20 + rand() * 18;
      towers.push({ x, y, z, w, d, h: 40 + rand() * rand() * 180, yaw: rand() * Math.PI, col: TINT[Math.floor(rand() * TINT.length)]!, seed: rand() });
      c.blockers.push({ cx: x, cz: z, ux: 1, uz: 0, hu: Math.max(w, d) / 2 + 4, hv: Math.max(w, d) / 2 + 4 });
      k++;
    }
  }
  const tGeo = blockGeometry();
  const tApx = new InstancedBufferAttribute(new Float32Array(Math.max(1, towers.length) * 4), 4);
  tGeo.setAttribute('aApx', tApx);
  const tMat = envMaterial(c.sh, { name: 'cliff.towers', family: 'inst', mode: EnvMode.Facade, vertexColor: true, roughness: 0.3, metalness: 0.45, wet: 0.4, flood: 0.5 });
  const tMesh = new InstancedMesh(tGeo, tMat, Math.max(1, towers.length));
  tMesh.name = 'cliff.towers';
  const m4 = new Matrix4(), qt = new Quaternion(), up = new Vector3(0, 1, 0), pv = new Vector3(), sv = new Vector3(), tint = new Color();
  towers.forEach((t, k) => {
    qt.setFromAxisAngle(up, t.yaw);
    m4.compose(pv.set(t.x, t.y - 2, t.z), qt, sv.set(t.w, t.h + 2, t.d));
    tMesh.setMatrixAt(k, m4);
    tMesh.setColorAt(k, tint.setHex(t.col).convertSRGBToLinear());
    tApx.setXYZW(k, Math.floor(t.seed * 97), t.w, t.d, t.h + 2);
  });
  tMesh.count = towers.length;
  tMesh.castShadow = c.quality.id !== 'low';
  tMesh.receiveShadow = true;
  tMesh.computeBoundingSphere();
  group.add(tMesh);
  tris += (towers.length * tGeo.index!.count) / 3;

  // ---- palms: paddock edge, the lagoon groves, the boulevard, the T11 stand, two oases ----
  const palms: { x: number; y: number; z: number; s: number; r: number }[] = [];
  const pw = { x: 0, y: 0, z: 0 };
  const addPalm = (x: number, z: number): void => {
    const y = ground.height(x, z, info);
    if (info.covered || info.nearTrack > 0.3) return;
    palms.push({ x, y, z, s: 0.8 + rand() * 0.5, r: rand() * 6.28 });
  };
  for (const [a, b, side, dOff] of [[6990, 7230, 1, 150], [0, 280, 1, 150], [6990, 7230, -1, 40], [0, 280, -1, 40], [4380, 4480, -1, 50]] as const) {
    for (let s = a; s < b; s += 14) {
      const sw = q.wrapS(s * ex.sScale);
      const i = Math.round(sw) % data.count;
      q.worldFromSD(sw, side * ((side === 1 ? data.wallL[i]! : data.wallR[i]!) + dOff), pw);
      addPalm(pw.x, pw.z);
    }
  }
  for (let k = 0; k < 90; k++) {
    const t = rand() * Math.PI * 2, r = 1.22 + rand() * 0.35;
    addPalm(lag.x + Math.cos(t) * lag.a * r, lag.z + Math.sin(t) * lag.b * r);
  }
  for (const [e, n] of [[-300, 900], [1500, 1350], [600, 980]] as const) {
    for (let k = 0; k < 28; k++) {
      const a = rand() * Math.PI * 2, r = Math.sqrt(rand()) * 45;
      addPalm(wx(e) + Math.cos(a) * r, wz(n) + Math.sin(a) * r);
    }
  }
  const pGeo = palmGeometry().geometry();
  const pMat = envMaterial(c.sh, { name: 'cliff.palms', family: 'inst', vertexColor: true, roughness: 0.85, wet: 0.3, flood: 0.8 });
  const pMesh = new InstancedMesh(pGeo, pMat, Math.max(1, palms.length));
  pMesh.name = 'cliff.palms';
  const white1 = new Color(1, 1, 1);
  palms.forEach((p, k) => {
    qt.setFromAxisAngle(up, p.r);
    m4.compose(pv.set(p.x, p.y - 0.2, p.z), qt, sv.setScalar(p.s));
    pMesh.setMatrixAt(k, m4);
    pMesh.setColorAt(k, white1);
  });
  pMesh.count = palms.length;
  pMesh.castShadow = c.quality.id !== 'low';
  pMesh.computeBoundingSphere();
  group.add(pMesh);
  tris += (palms.length * pGeo.index!.count) / 3;

  return {
    root: group,
    triangles: tris,
    applyConditions(cc) {
      // LEDs: dim by day (the housings read as fixtures), bright after dark; tower windows lit at night.
      ledMat.emissiveIntensity = cc.tod === 'night' ? 2.6 : cc.tod === 'sunset' ? 1.6 : 0.5;
      envUniforms(tMat).uApxP.value.x = cc.tod === 'night' ? 1.6 : cc.tod === 'sunset' ? 0.45 : 0;
    },
    setQuality(qp) {
      tMesh.castShadow = qp.id !== 'low';
      pMesh.castShadow = qp.id !== 'low';
    },
    dispose() {
      for (const g of [stGeo, ledGeo, lagGeo, tGeo, pGeo]) g.dispose();
      for (const m of [stMat, ledMat, lagMat, tMat, pMat]) m.dispose();
      tMesh.dispose();
      pMesh.dispose();
      group.removeFromParent();
    },
  };
}
