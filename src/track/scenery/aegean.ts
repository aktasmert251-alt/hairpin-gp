// Aegean Islands extras (docs/design/tracks-aegean.md §7–§8): the sea (deep Aegean blue → shallow turquoise near the
// islands, foam on the coasts, round the piers and along the breakwater), the bridge decks over every sea span (white
// concrete, walkways that carry the floodlight poles, warm LED edge lines, paired piers into the sea), the cable-stayed
// bridge (two H pylons, fans of stays), the floating pontoon with its rubble breakwater, the tunnel through the
// headland, the harbour (quay, mole, lighthouse, moored yachts), island villages (white cubic houses with lit windows,
// blue-domed chapels, bougainvillea), windmills, and boats and seagulls moving on the render clock.
// Draws: sea 1, structure 1, rock 1, lamps 1, houses 1, domes 1, flowers 1, boats 1, gulls 1.

import {
  BufferAttribute, BufferGeometry, Color, Group, IcosahedronGeometry, InstancedBufferAttribute, InstancedMesh, Matrix4, Mesh, Quaternion, Vector3,
  type PerspectiveCamera,
} from 'three';
import type { RenderFrame } from '../../contracts/render';
import type { TrackFrame } from '../../contracts/track';
import { CABLE_BRIDGE, HARBOUR, PONTOON, SEA_Y, TUNNEL, VILLAGES, WINDMILLS, tunnelRidge } from '../authoring/aegean-ctrl';
import { envMaterial, EnvMode, envUniforms } from '../materials/shared';
import { makeRand } from '../mesh/textures';
import type { EnvContext, EnvPart } from './environment';
import { blockGeometry } from './skyline';
import { boxInFrame, SBuf } from './stands';
import { buildTunnel } from './tunnel';
import { ferryGeometry, yachtGeometry } from './water';

const sst = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Walkway beyond the barrier (m): carries the floodlight poles at wall + 2.5. */
const WALK = 3.6;
const PIER_STEP = 32;
const SEA_HALF = 6000, SEA_STEP = 40;
type V3 = number[];

/** Seagull: two thin wing quads in a shallow V (unit ≈ 1.6 m span). */
function gullGeometry(): SBuf {
  const b = new SBuf();
  const w = new Color(0.95, 0.95, 0.95);
  b.quad([[0, 0, -0.15], [0, 0, 0.15], [-0.8, 0.22, -0.1], [-0.8, 0.22, 0.12]], [0, 1, 0], w);
  b.quad([[0, 0, 0.15], [0, 0, -0.15], [0.8, 0.22, 0.12], [0.8, 0.22, -0.1]], [0, 1, 0], w);
  b.quad([[-0.8, 0.2, 0.12], [-0.8, 0.2, -0.1], [0, -0.02, 0.15], [0, -0.02, -0.15]], [0, -1, 0], w);
  b.quad([[0.8, 0.2, -0.1], [0.8, 0.2, 0.12], [0, -0.02, -0.15], [0, -0.02, 0.15]], [0, -1, 0], w);
  return b;
}

export function createAegean(c: EnvContext): EnvPart & { triangles: number } {
  const group = new Group();
  group.name = 'aegean';
  const decksA = c.ex.authoring.DECKS ?? [];
  if (c.ex.authoring.id !== 'aegean') return { root: group, triangles: 0, dispose: () => group.removeFromParent() };
  const { data, query: q } = c.track;
  const ex = c.ex;
  const ground = c.ground!;
  const rand = makeRand(1821);
  const f: TrackFrame = { s: 0, px: 0, py: 0, pz: 0, tx: 1, tz: 0, lx: 0, lz: -1, halfWidthL: 0, halfWidthR: 0, crossSlope: 0, curvature: 0, vCurvature: 0, grade: 0, sector: 0 };
  const P = { x: 0, y: 0, z: 0 };
  const info = { s: 0, d: 0, covered: false, nearTrack: 0 };
  const wx = (E: number): number => (E - ex.reg.cx) * ex.reg.k;
  const wz = (N: number): number => (-N - ex.reg.cz) * ex.reg.k;
  const S = (s: number): number => q.wrapS(s * ex.sScale);
  const st = new SBuf();
  const rock = new SBuf();
  const lamps = new SBuf();
  const foam: { x: number; z: number; r: number }[] = [];
  const foamLines: [number, number, number, number, number][] = []; // x0, z0, x1, z1, half width
  let tris = 0;

  const white = new Color(1.55, 1.52, 1.45), cream = new Color(1.35, 1.28, 1.12), dark = new Color(0.16, 0.17, 0.18);
  const steel = new Color(0.8, 0.82, 0.85), warm = new Color(1, 0.86, 0.6), blue = new Color(0.08, 0.25, 0.62);
  const at = (s: number, d: number, y: number): V3 => {
    q.worldFromSD(s, d, P);
    return [P.x, P.y + y, P.z];
  };
  const W = (s: number, side: 1 | -1): number => (side === 1 ? data.wallL : data.wallR)[Math.round(s) % data.count]! + WALK;

  // ---- bridge decks over every sea span ----
  const STEP = 3;
  const pon0 = S(PONTOON.from), pon1 = S(PONTOON.to);
  const inPontoon = (s: number): boolean => s > pon0 && s < pon1;
  for (const dk of decksA) {
    const s0 = S(dk.from), s1 = S(dk.to);
    let pierAcc = PIER_STEP / 2;
    for (let s = s0; s < s1 - 1e-6; s += STEP) {
      const e = Math.min(s1, s + STEP);
      q.frameAt(s, f);
      const L0 = W(s, 1), L1 = W(e, 1), R0 = -W(s, -1), R1 = -W(e, -1);
      const pont = inPontoon(s);
      const depth = pont ? 0.9 : 1.6;
      // Walkways, fascias (white with a cream lower band), flat soffit.
      st.quad([at(s, L0 - WALK, -0.04), at(e, L1 - WALK, -0.04), at(s, L0, -0.04), at(e, L1, -0.04)], [0, 1, 0], cream);
      st.quad([at(s, R0, -0.04), at(e, R1, -0.04), at(s, R0 + WALK, -0.04), at(e, R1 + WALK, -0.04)], [0, 1, 0], cream);
      for (const side of [1, -1] as const) {
        const dA = side === 1 ? L0 : R0, dE = side === 1 ? L1 : R1;
        const n = [side * f.lx, 0, side * f.lz];
        const p = [at(s, dA, -depth), at(e, dE, -depth), at(s, dA, 0), at(e, dE, 0)];
        st.quad(side === 1 ? p : [p[1]!, p[0]!, p[3]!, p[2]!], n, white);
        // Warm LED edge line under the walkway lip (always on; a necklace of light over the water at night).
        const lp = [at(s, dA + side * 0.03, -0.45), at(e, dE + side * 0.03, -0.45), at(s, dA + side * 0.03, -0.25), at(e, dE + side * 0.03, -0.25)];
        lamps.quad(side === 1 ? lp : [lp[1]!, lp[0]!, lp[3]!, lp[2]!], n, warm);
        // Slim railing on the low parapet (barriers.ts drops the catch fence on decks): posts every 3 m, a top rail.
        const rA = side * (W(s, side) - WALK + 0.2), rE = side * (W(e, side) - WALK + 0.2);
        const top0 = 1.25;
        const tr = [at(s, rA - side * 0.04, top0), at(e, rE - side * 0.04, top0), at(s, rA + side * 0.04, top0), at(e, rE + side * 0.04, top0)];
        st.quad(tr, [0, 1, 0], steel);
        const tf = [at(s, rA - side * 0.04, top0 - 0.08), at(e, rE - side * 0.04, top0 - 0.08), at(s, rA - side * 0.04, top0), at(e, rE - side * 0.04, top0)];
        st.quad(side === 1 ? [tf[1]!, tf[0]!, tf[3]!, tf[2]!] : tf, [-side * f.lx, 0, -side * f.lz], steel);
        const mf = [at(s, rA - side * 0.04, 0.84), at(e, rE - side * 0.04, 0.84), at(s, rA - side * 0.04, 0.89), at(e, rE - side * 0.04, 0.89)];
        st.quad(side === 1 ? [mf[1]!, mf[0]!, mf[3]!, mf[2]!] : mf, [-side * f.lx, 0, -side * f.lz], steel);
        q.worldFromSD(s, rA, P);
        boxInFrame(st, { x: P.x, y: P.y + 0.45, z: P.z }, [-0.04, 0.04], [-0.04, 0.04], [0, top0 - 0.45], f.tx, f.tz, f.lx, f.lz, steel);
      }
      st.quad([at(s, R0, -depth), at(e, R1, -depth), at(s, L0, -depth), at(e, L1, -depth)], [0, -1, 0], pont ? dark : cream);
      // Piers (pairs of round-ish columns down to the sea floor) or, on the pontoon, floats at the waterline.
      pierAcc += STEP;
      if (pierAcc >= (pont ? 18 : PIER_STEP)) {
        pierAcc = 0;
        for (const dd of [-0.32, 0.32]) {
          const d = dd * (L0 - R0) + (L0 + R0) / 2;
          q.worldFromSD(s, d, P);
          const gy = ground.dem(P.x, P.z);
          if (gy > SEA_Y - 0.3) continue; // on the shore: the abutment fill carries it
          if (pont) {
            boxInFrame(st, { x: P.x, y: SEA_Y - 1.2, z: P.z }, [-7, 7], [-2.4, 2.4], [0, P.y - depth - SEA_Y + 1.2], f.tx, f.tz, f.lx, f.lz, dark);
            foam.push({ x: P.x, z: P.z, r: 6 });
          } else {
            const top = P.y - depth;
            boxInFrame(st, { x: P.x, y: gy - 1, z: P.z }, [-1.3, 1.3], [-1.3, 1.3], [0, top - gy + 1], f.tx, f.tz, f.lx, f.lz, white);
            boxInFrame(st, { x: P.x, y: gy - 1, z: P.z }, [-0.95, 0.95], [-1.65, 1.65], [0, top - gy + 1], f.tx, f.tz, f.lx, f.lz, white);
            foam.push({ x: P.x, z: P.z, r: 3.2 });
          }
        }
      }
    }
  }

  // ---- cable-stayed bridge: two H pylons 62 m above the deck, fans of stays to both walkways ----
  for (const ps of CABLE_BRIDGE.pylons) {
    const s = S(ps);
    q.frameAt(s, f);
    const L = W(s, 1) + 1.5, R = -W(s, -1) - 1.5;
    q.worldFromSD(s, 0, P);
    const deckY = P.y;
    const H = 62;
    const gy = ground.dem(P.x, P.z);
    for (const d of [L, R]) {
      q.worldFromSD(s, d, P);
      // Legs taper from 3.2 × 4.5 m at the sea floor to 2 × 3 m at the top.
      boxInFrame(st, { x: P.x, y: gy - 1, z: P.z }, [-2.2, 2.2], [-1.6, 1.6], [0, deckY - gy - 1], f.tx, f.tz, f.lx, f.lz, white);
      boxInFrame(st, { x: P.x, y: deckY - 2, z: P.z }, [-1.5, 1.5], [-1.0, 1.0], [0, H + 2], f.tx, f.tz, f.lx, f.lz, white);
      foam.push({ x: P.x, z: P.z, r: 5 });
    }
    // Cross beams under the deck and near the top.
    const mid = (L + R) / 2;
    q.worldFromSD(s, mid, P);
    boxInFrame(st, { x: P.x, y: deckY - 3.2, z: P.z }, [-1.4, 1.4], [R - mid, L - mid], [0, 1.6], f.tx, f.tz, f.lx, f.lz, white);
    boxInFrame(st, { x: P.x, y: deckY + H - 8, z: P.z }, [-1.2, 1.2], [R - mid, L - mid], [0, 2.2], f.tx, f.tz, f.lx, f.lz, white);
    // Aircraft-warning lamps on the tops.
    for (const d of [L, R]) {
      q.worldFromSD(s, d, P);
      boxInFrame(lamps, { x: P.x, y: deckY + H, z: P.z }, [-0.5, 0.5], [-0.5, 0.5], [0, 0.8], 1, 0, 0, 1, new Color(1, 0.1, 0.05));
    }
    // Stays: from 12 anchors down the pylon to the walkway every 14 m, 160 m either way.
    for (const side of [1, -1] as const) {
      const dPy = side === 1 ? L : R;
      q.worldFromSD(s, dPy, P);
      const px = P.x, pz = P.z;
      for (let k = 1; k <= 11; k++) {
        for (const dir of [-1, 1]) {
          const sa = s + dir * k * 14;
          const dw = side * (W(sa, side) - 1.2);
          const A = [px, deckY + H - 10 - k * 2.6, pz];
          const B = at(sa, dw, 0.2);
          const ux = B[0]! - A[0]!, uz = B[2]! - A[2]!, ul = Math.hypot(ux, uz) || 1;
          const nx = -uz / ul * 0.09, nz = ux / ul * 0.09;
          st.quad([[A[0]! - nx, A[1]!, A[2]! - nz], [B[0]! - nx, B[1]!, B[2]! - nz], [A[0]! + nx, A[1]!, A[2]! + nz], [B[0]! + nx, B[1]!, B[2]! + nz]], [0, 1, 0], steel);
          st.quad([[A[0]!, A[1]! - 0.18, A[2]!], [B[0]!, B[1]! - 0.18, B[2]!], [A[0]!, A[1]!, A[2]!], [B[0]!, B[1]!, B[2]!]], [nz / 0.09, 0, -nx / 0.09], steel);
        }
      }
    }
  }

  // ---- pontoon breakwater: rubble mound on the open-sea side (left), foam along it ----
  for (let s = pon0; s < pon1; s += 7) {
    q.frameAt(s, f);
    const d0 = W(s, 1) + 3;
    for (let k = 0; k < 3; k++) {
      const d = d0 + k * 4.5 + rand() * 2;
      q.worldFromSD(s + rand() * 4, d, P);
      const sz = 2.2 + rand() * 1.6;
      const yaw = rand() * Math.PI;
      const ux = Math.cos(yaw), uz = Math.sin(yaw);
      const g = 0.42 + rand() * 0.12;
      boxInFrame(rock, { x: P.x, y: SEA_Y - 3, z: P.z }, [-sz, sz], [-sz * 0.8, sz * 0.8], [0, 3 + 1.4 + (2 - k) * 0.9 + rand()], ux, uz, -uz, ux, new Color(g, g * 0.97, g * 0.92));
    }
    q.worldFromSD(s, d0 + 13, P);
    const p2 = { x: P.x, z: P.z };
    q.worldFromSD(s + 7, d0 + 13, P);
    foamLines.push([p2.x, p2.z, P.x, P.z, 5]);
  }

  // ---- tunnel through the headland: ochre limestone with strata, scrub on the ledges ----
  const ochre = (x: number, z: number, y: number): Color => {
    const sh = (y - SEA_Y) / 3.4 + 0.5 * Math.sin(x * 0.045 + z * 0.031);
    const band = sh - Math.floor(sh);
    const h = Math.sin(Math.floor(sh) * 12.9898 + 4.1) * 43758.5453;
    const tone = h - Math.floor(h);
    const ledge = band > 0.85 ? 0.72 : 1;
    const veg = Math.sin(x * 0.11 + z * 0.07) * Math.sin(z * 0.13 - x * 0.05) > 0.55 && band < 0.4;
    // Vertex colours tint the grey rock map (they are clamped to 1): a saturated warm tint reads as ochre limestone.
    if (veg) return new Color(0.3, 0.42, 0.14);
    const k = (0.78 + 0.22 * tone) * ledge;
    return new Color(1.0 * k, 0.62 * k, 0.3 * k);
  };
  buildTunnel(c, st, rock, lamps, TUNNEL.from, TUNNEL.to, tunnelRidge, ochre);
  {
    const s0 = S(TUNNEL.from), s1 = S(TUNNEL.to);
    q.frameAt((s0 + s1) / 2, f);
    c.blockers.push({ cx: f.px, cz: f.pz, ux: f.tx, uz: f.tz, hu: (s1 - s0) / 2 + 12, hv: 90 });
  }

  // ---- harbour on the main island's south shore: quay wall + promenade, cafés with awnings, quay lamps, flags,
  // fishing boats along the quay, a mole with the lighthouse; quay buildings join the roadside houses below ----
  type RHouse = { x: number; y: number; z: number; w: number; d: number; h: number; yaw: number; tone: number };
  const rhouses: RHouse[] = [];
  const quay: [number, number][] = [];
  for (let e = HARBOUR.e0; e <= HARBOUR.e1; e += 10) {
    let n = HARBOUR.nFrom;
    while (n > HARBOUR.nFrom - 260 && ground.dem(wx(e), wz(n)) > SEA_Y + 0.2) n -= 3;
    if (n > HARBOUR.nFrom - 260) quay.push([wx(e), wz(n)]);
  }
  for (let k = 1; k + 1 < quay.length; k++) quay[k] = [(quay[k - 1]![0] + 2 * quay[k]![0] + quay[k + 1]![0]) / 4, (quay[k - 1]![1] + 2 * quay[k]![1] + quay[k + 1]![1]) / 4];
  const quayY = SEA_Y + 1.6;
  const stone = new Color(1.0, 0.92, 0.78), paving = new Color(1.25, 1.18, 1.05);
  const awnings = [new Color(0.08, 0.25, 0.65), new Color(0.75, 0.14, 0.08), new Color(0.95, 0.85, 0.75), new Color(0.1, 0.5, 0.45)];
  const boatCols = [new Color(0.1, 0.3, 0.75), new Color(0.75, 0.15, 0.08), new Color(0.9, 0.75, 0.1), new Color(1.3, 1.3, 1.3), new Color(0.1, 0.55, 0.4)];
  let quayLen = 0;
  for (let k = 0; k + 1 < quay.length; k++) {
    const [ax, az] = quay[k]!, [bx, bz] = quay[k + 1]!;
    const dx = bx - ax, dz = bz - az, l = Math.hypot(dx, dz) || 1;
    // Landward normal: towards the island (higher ground).
    let nx = -dz / l, nz = dx / l;
    if (ground.dem(ax + nx * 20, az + nz * 20) < ground.dem(ax - nx * 20, az - nz * 20)) { nx = -nx; nz = -nz; }
    st.quad([[ax, SEA_Y - 3, az], [bx, SEA_Y - 3, bz], [ax, quayY, az], [bx, quayY, bz]], [-nx, 0, -nz], stone);
    const gA = Math.max(quayY, ground.height(ax + nx * 14, az + nz * 14) + 0.05), gB = Math.max(quayY, ground.height(bx + nx * 14, bz + nz * 14) + 0.05);
    st.quad([[ax, quayY, az], [bx, quayY, bz], [ax + nx * 14, gA, az + nz * 14], [bx + nx * 14, gB, bz + nz * 14]], [0, 1, 0], paving);
    foamLines.push([ax - nx * 1.5, az - nz * 1.5, bx - nx * 1.5, bz - nz * 1.5, 1.6]);
    quayLen += l;
    // Every 20 m: a quay lamp; every 40 m: a café (awning on posts, tables); fishing boats moored off the quay.
    const steps = Math.max(1, Math.round(l / 10));
    for (let m = 0; m < steps; m++) {
      const t = (m + 0.5) / steps;
      const px = ax + dx * t, pz = az + dz * t;
      const slot = Math.round((quayLen - l + l * t) / 10);
      if (slot % 2 === 0) {
        boxInFrame(st, { x: px + nx * 1.5, y: quayY, z: pz + nz * 1.5 }, [-0.08, 0.08], [-0.08, 0.08], [0, 4.2], 1, 0, 0, 1, dark);
        boxInFrame(lamps, { x: px + nx * 1.5, y: quayY + 4.2, z: pz + nz * 1.5 }, [-0.25, 0.25], [-0.25, 0.25], [0, 0.45], 1, 0, 0, 1, warm);
      }
      if (slot % 4 === 1) {
        const col = awnings[(slot >> 2) % awnings.length]!;
        const cx = px + nx * 8, cz = pz + nz * 8, cy = Math.max(quayY, ground.height(cx, cz));
        for (const [u, v] of [[-3.5, -2.5], [3.5, -2.5], [-3.5, 2.5], [3.5, 2.5]] as const) boxInFrame(st, { x: cx + (dx / l) * u + nx * v, y: cy, z: cz + (dz / l) * u + nz * v }, [-0.06, 0.06], [-0.06, 0.06], [0, 2.6], 1, 0, 0, 1, dark);
        boxInFrame(st, { x: cx, y: cy + 2.6, z: cz }, [-3.8, 3.8], [-2.9, 2.9], [0, 0.25], dx / l, dz / l, nx, nz, col);
        for (const [u, v] of [[-2, -1], [0, 1], [2, -1], [-1.5, 1.2], [1.8, 0.9]] as const) boxInFrame(st, { x: cx + (dx / l) * u + nx * v, y: cy, z: cz + (dz / l) * u + nz * v }, [-0.4, 0.4], [-0.4, 0.4], [0, 0.75], 1, 0, 0, 1, white);
      }
      if (slot % 3 !== 2) {
        const bc = boatCols[(slot * 7) % boatCols.length]!;
        const bxp = px - nx * 4, bzp = pz - nz * 4;
        boxInFrame(st, { x: bxp, y: SEA_Y - 0.4, z: bzp }, [-3, 3], [-1.1, 1.1], [0, 1.2], -nz, nx, nx, nz, bc);
        boxInFrame(st, { x: bxp, y: SEA_Y + 0.8, z: bzp }, [-0.8, 0.6], [-0.7, 0.7], [0, 1.0], -nz, nx, nx, nz, white);
        foam.push({ x: bxp, z: bzp, r: 2.2 });
      }
      // Pennant flags on poles every 30 m.
      if (slot % 3 === 0) {
        const fx = px + nx * 13, fz = pz + nz * 13, fy = Math.max(quayY, ground.height(fx, fz));
        boxInFrame(st, { x: fx, y: fy, z: fz }, [-0.06, 0.06], [-0.06, 0.06], [0, 7], 1, 0, 0, 1, white);
        st.quad([[fx, fy + 6.9, fz], [fx + (dx / l) * 2.2, fy + 6.5, fz + (dz / l) * 2.2], [fx, fy + 6.0, fz], [fx + (dx / l) * 2.2, fy + 6.5, fz + (dz / l) * 2.2]], [nx, 0, nz], slot % 2 ? blue : white);
      }
    }
    // Quay buildings behind the promenade (where the track leaves room), 2–3 storeys.
    const nb = Math.floor(l / 12);
    for (let m = 0; m < nb; m++) {
      const t = (m + 0.5) / nb;
      const x = ax + dx * t + nx * 22, z = az + dz * t + nz * 22;
      const y = ground.height(x, z, info);
      const ii = Math.round(info.s) % data.count;
      if (info.covered || Math.abs(info.d) < (info.d >= 0 ? data.wallL[ii]! : data.wallR[ii]!) + 4) continue;
      rhouses.push({ x, y: Math.min(y, quayY + 2), z, w: 10 + rand() * 3, d: 8, h: 6 + Math.floor(rand() * 2) * 3, yaw: Math.atan2(-dz, dx), tone: rand() });
    }
  }
  const hx = quay.length ? quay[Math.floor(quay.length / 2)]![0] : wx(HARBOUR.e0), hz = quay.length ? quay[Math.floor(quay.length / 2)]![1] : wz(HARBOUR.nFrom);
  {
    // Mole: from the west end of the quay out round the basin to the lighthouse, 10 m wide, 2 m above the sea.
    const [ax, az] = quay[0] ?? [hx, hz];
    const lhx = wx(HARBOUR.lighthouse[0]), lhz = wz(HARBOUR.lighthouse[1]);
    const n = 14;
    for (let k = 0; k < n; k++) {
      const t0 = k / n, t1 = (k + 1) / n;
      const bend = (t: number): [number, number] => [ax + (lhx - ax) * t, az + (lhz - az) * t + Math.sin(t * Math.PI) * 60];
      const [x0, z0] = bend(t0), [x1, z1] = bend(t1);
      const dx = x1 - x0, dz = z1 - z0, l = Math.hypot(dx, dz);
      boxInFrame(st, { x: (x0 + x1) / 2, y: SEA_Y - 6, z: (z0 + z1) / 2 }, [-l / 2 - 0.5, l / 2 + 0.5], [-5, 5], [0, 7.6], dx / l, dz / l, -dz / l, dx / l, stone);
      foamLines.push([x0, z0, x1, z1, 7]);
    }
    // Lighthouse: white tower, red gallery, lamp room (lit at night).
    const ly = SEA_Y + 1.6;
    boxInFrame(st, { x: lhx, y: ly, z: lhz }, [-2.2, 2.2], [-2.2, 2.2], [0, 18], 1, 0, 0, 1, white);
    boxInFrame(st, { x: lhx, y: ly + 18, z: lhz }, [-3, 3], [-3, 3], [0, 0.8], 1, 0, 0, 1, new Color(0.65, 0.06, 0.04));
    boxInFrame(lamps, { x: lhx, y: ly + 18.8, z: lhz }, [-1.4, 1.4], [-1.4, 1.4], [0, 2.4], 1, 0, 0, 1, new Color(1, 0.92, 0.7));
    boxInFrame(st, { x: lhx, y: ly + 21.2, z: lhz }, [-1.8, 1.8], [-1.8, 1.8], [0, 1.2], 1, 0, 0, 1, new Color(0.65, 0.06, 0.04));
  }

  // ---- roadside island life: white houses with blue doors and shutters close to the track, bunting over the
  // spectator banks, beach umbrellas and people on the coves ----
  const onIsland = (sPoly: number): boolean => !decksA.some((dk) => sPoly > dk.from - 10 && sPoly < dk.to + 10) && !(sPoly > TUNNEL.from - 40 && sPoly < TUNNEL.to + 40);
  for (let sp = 0; sp < c.ex.authoring.OSM_LENGTH; sp += 19) {
    if (!onIsland(sp)) continue;
    const side = (Math.floor(sp / 19) % 2 ? 1 : -1) as 1 | -1;
    // Main straight right side: the pit and paddock.
    if (side === -1 && (sp > 5640 || sp < 260)) continue;
    const s = S(sp);
    const i = Math.round(s) % data.count;
    const wall = side === 1 ? data.wallL[i]! : data.wallR[i]!;
    q.worldFromSD(s, side * (wall + 9 + rand() * 12), P);
    const hxp = P.x, hzp = P.z;
    const y = ground.height(hxp, hzp, info);
    if (info.covered || y < SEA_Y + 2.5) continue;
    if (c.blockers.some((b) => Math.abs((hxp - b.cx) * b.ux + (hzp - b.cz) * b.uz) < b.hu + 6 && Math.abs((hxp - b.cx) * b.uz - (hzp - b.cz) * b.ux) < b.hv + 6)) continue;
    q.frameAt(s, f);
    let lo = y;
    for (const [ox, oz] of [[-5, -5], [5, -5], [-5, 5], [5, 5]] as const) lo = Math.min(lo, ground.height(hxp + ox, hzp + oz));
    rhouses.push({ x: hxp, y: lo, z: hzp, w: 7 + rand() * 4, d: 6 + rand() * 3, h: rand() < 0.3 ? 6.2 : 3.4, yaw: Math.atan2(-f.tz, f.tx) + (side === 1 ? Math.PI : 0), tone: rand() });
  }
  for (const h of rhouses) c.blockers.push({ cx: h.x, cz: h.z, ux: Math.cos(h.yaw), uz: -Math.sin(h.yaw), hu: h.w / 2 + 2, hv: h.d / 2 + 2 });
  // Bunting: strings of pennants between poles behind the walls on the start straight, at T1 and at the harbour.
  const pennant = [new Color(0.08, 0.25, 0.7), new Color(1.3, 1.3, 1.3), new Color(0.85, 0.15, 0.1), new Color(0.95, 0.8, 0.1)];
  for (const [a, b, side] of [[5700, 6080, 1], [10, 240, 1], [660, 800, 1], [5300, 5560, -1]] as const) {
    let prev: V3 | null = null;
    for (let sp = a; sp <= b; sp += 24) {
      const s = S(sp), i = Math.round(s) % data.count;
      const wall = side === 1 ? data.wallL[i]! : data.wallR[i]!;
      q.frameAt(s, f);
      const pole = at(s, side * (wall + 1.2), 0);
      const gy = ground.height(pole[0]!, pole[2]!);
      boxInFrame(st, { x: pole[0]!, y: gy, z: pole[2]! }, [-0.07, 0.07], [-0.07, 0.07], [0, 7.5], 1, 0, 0, 1, white);
      const top: V3 = [pole[0]!, gy + 7.3, pole[2]!];
      if (prev) {
        for (let k = 0; k < 10; k++) {
          const t0 = k / 10, t1 = (k + 0.7) / 10;
          const sag = (t: number): number => -1.4 * Math.sin(Math.PI * t);
          const p0 = [prev[0]! + (top[0]! - prev[0]!) * t0, prev[1]! + (top[1]! - prev[1]!) * t0 + sag(t0), prev[2]! + (top[2]! - prev[2]!) * t0];
          const p1 = [prev[0]! + (top[0]! - prev[0]!) * t1, prev[1]! + (top[1]! - prev[1]!) * t1 + sag(t1), prev[2]! + (top[2]! - prev[2]!) * t1];
          const mid = [(p0[0]! + p1[0]!) / 2, (p0[1]! + p1[1]!) / 2 - 0.9, (p0[2]! + p1[2]!) / 2];
          st.quad([p0, p1, mid, mid], [f.lx, 0, f.lz], pennant[k % pennant.length]!);
          st.quad([p1, p0, mid, mid], [-f.lx, 0, -f.lz], pennant[k % pennant.length]!);
        }
      }
      prev = top;
    }
  }
  // Coves: umbrellas (pole + 8-sided canopy) and bathers on the sand bands near the circuit.
  {
    const umb = [new Color(0.1, 0.3, 0.8), new Color(1.3, 1.3, 1.25), new Color(0.9, 0.2, 0.1), new Color(0.95, 0.75, 0.1), new Color(0.1, 0.6, 0.5)];
    const skin = [new Color(0.75, 0.5, 0.35), new Color(0.55, 0.35, 0.22), new Color(0.85, 0.62, 0.48)];
    let nU = 0;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i < data.count; i += 20) { x0 = Math.min(x0, data.x[i]!); x1 = Math.max(x1, data.x[i]!); z0 = Math.min(z0, data.z[i]!); z1 = Math.max(z1, data.z[i]!); }
    for (let z = z0 - 200; z < z1 + 200 && nU < 260; z += 7) {
      for (let x = x0 - 200; x < x1 + 200 && nU < 260; x += 7) {
        const jx = x + (rand() - 0.5) * 5, jz = z + (rand() - 0.5) * 5;
        const dem = ground.dem(jx, jz);
        if (dem < SEA_Y + 0.6 || dem > SEA_Y + 1.8) continue;
        const gy = ground.height(jx, jz, info);
        if (info.nearTrack > 0.3 || info.covered || rand() > 0.4) continue;
        if (c.blockers.some((b) => Math.abs((jx - b.cx) * b.ux + (jz - b.cz) * b.uz) < b.hu && Math.abs((jx - b.cx) * b.uz - (jz - b.cz) * b.ux) < b.hv)) continue;
        nU++;
        const col = umb[nU % umb.length]!;
        boxInFrame(st, { x: jx, y: gy, z: jz }, [-0.04, 0.04], [-0.04, 0.04], [0, 2.3], 1, 0, 0, 1, white);
        for (let k = 0; k < 8; k++) {
          const a0 = (k / 8) * Math.PI * 2, a1 = ((k + 1) / 8) * Math.PI * 2;
          st.quad([[jx, gy + 2.6, jz], [jx, gy + 2.6, jz], [jx + Math.cos(a0) * 1.4, gy + 2.0, jz + Math.sin(a0) * 1.4], [jx + Math.cos(a1) * 1.4, gy + 2.0, jz + Math.sin(a1) * 1.4]], [0, 1, 0], k % 2 ? col : white);
        }
        for (let p = 0; p < 2; p++) {
          const px = jx + (rand() - 0.5) * 4, pz = jz + (rand() - 0.5) * 4;
          const sk = skin[Math.floor(rand() * skin.length)]!;
          if (rand() < 0.4) {
            boxInFrame(st, { x: px, y: gy, z: pz }, [-0.18, 0.18], [-0.12, 0.12], [0, 1.45], 1, 0, 0, 1, sk);
            boxInFrame(st, { x: px, y: gy + 1.45, z: pz }, [-0.11, 0.11], [-0.11, 0.11], [0, 0.24], 1, 0, 0, 1, sk);
          } else {
            const a = rand() * Math.PI, ux = Math.cos(a), uz = Math.sin(a);
            boxInFrame(st, { x: px, y: gy, z: pz }, [-0.9, 0.9], [-0.35, 0.35], [0, 0.06], ux, uz, -uz, ux, umb[(nU + p) % umb.length]!);
            boxInFrame(st, { x: px, y: gy + 0.06, z: pz }, [-0.8, 0.8], [-0.2, 0.2], [0, 0.22], ux, uz, -uz, ux, sk);
          }
        }
      }
    }
  }

  // ---- windmills on the ridge of the windmill island ----
  for (const [e, n] of WINDMILLS) {
    const x = wx(e), z = wz(n), gy = ground.height(x, z);
    boxInFrame(st, { x, y: gy - 1, z }, [-3, 3], [-3, 3], [0, 10], 1, 0, 0, 1, white);
    boxInFrame(st, { x, y: gy + 9, z }, [-2.4, 2.4], [-2.4, 2.4], [0, 2.4], 1, 0, 0, 1, new Color(0.35, 0.22, 0.12));
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + 0.4;
      const sx = Math.cos(a), sy = Math.sin(a);
      st.quad([[x - 3.3, gy + 10 + sy * 0.4 - sx * 0.6, z + sx * 0.4], [x - 3.3, gy + 10 + sy * 0.4 + sx * 0.6, z - sx * 0.4 + sy * 0],
        [x - 3.3, gy + 10 + sy * 8 - sx * 0.6, z + sx * 8], [x - 3.3, gy + 10 + sy * 8 + sx * 0.6, z + sx * 8 + sy * 0.0]], [-1, 0, 0], new Color(1.2, 1.15, 1.05));
    }
    c.blockers.push({ cx: x, cz: z, ux: 1, uz: 0, hu: 8, hv: 8 });
  }

  // ---- villages: white cubic houses (façade program: lit windows at night), chapels with blue domes, bougainvillea ----
  type House = { x: number; y: number; z: number; w: number; d: number; h: number; yaw: number; seed: number };
  const houses: House[] = [];
  const domes: { x: number; y: number; z: number; r: number }[] = [];
  const flowers: { x: number; y: number; z: number; s: number }[] = [];
  for (const v of VILLAGES) {
    const vx = wx(v.e), vz = wz(v.n);
    for (let k = 0, tries = 0; k < v.count && tries < v.count * 15; tries++) {
      const a = rand() * Math.PI * 2, r = Math.sqrt(rand()) * v.r;
      const x = vx + Math.cos(a) * r, z = vz + Math.sin(a) * r;
      const y = ground.height(x, z, info);
      if (info.covered || info.nearTrack > 0.02 || y < SEA_Y + 2.5) continue;
      if (houses.some((h) => Math.hypot(h.x - x, h.z - z) < 11)) continue;
      if (c.blockers.some((b) => Math.abs((x - b.cx) * b.ux + (z - b.cz) * b.uz) < b.hu + 5 && Math.abs((x - b.cx) * b.uz - (z - b.cz) * b.ux) < b.hv + 5)) continue;
      let lo = y;
      for (const [ox, oz] of [[-4, -4], [4, -4], [-4, 4], [4, 4]] as const) lo = Math.min(lo, ground.height(x + ox, z + oz));
      const w = 7 + rand() * 5, d = 6 + rand() * 4;
      houses.push({ x, y: lo, z, w, d, h: rand() < 0.35 ? 6.6 : 3.6, yaw: Math.round(rand() * 3) * (Math.PI / 2) + (rand() - 0.5) * 0.2, seed: rand() });
      if (rand() < 0.35) flowers.push({ x: x + (rand() - 0.5) * w, y: lo + 1.5 + rand() * 1.5, z: z + (rand() - 0.5) * d, s: 1.2 + rand() * 1.2 });
      if (rand() < 0.08) domes.push({ x, y: lo + 3.6, z, r: 2.4 + rand() * 1.2 });
      k++;
    }
  }
  for (const h of houses) c.blockers.push({ cx: h.x, cz: h.z, ux: Math.cos(h.yaw), uz: -Math.sin(h.yaw), hu: h.w / 2 + 2, hv: h.d / 2 + 2 });
  const hGeo = blockGeometry();
  const hApx = new InstancedBufferAttribute(new Float32Array(Math.max(1, houses.length) * 4), 4);
  hGeo.setAttribute('aApx', hApx);
  const hMat = envMaterial(c.sh, { name: 'aegean.houses', family: 'inst', mode: EnvMode.Facade, vertexColor: true, roughness: 0.85, wet: 0.4, flood: 0.8 });
  const hMesh = new InstancedMesh(hGeo, hMat, Math.max(1, houses.length));
  hMesh.name = 'aegean.houses';
  const m4 = new Matrix4(), qt = new Quaternion(), up = new Vector3(0, 1, 0), pv = new Vector3(), sv = new Vector3(), tint = new Color();
  houses.forEach((h, k) => {
    qt.setFromAxisAngle(up, h.yaw);
    m4.compose(pv.set(h.x, h.y - 1, h.z), qt, sv.set(h.w, h.h + 1, h.d));
    hMesh.setMatrixAt(k, m4);
    hMesh.setColorAt(k, tint.setRGB(1.5, 1.48, 1.42));
    hApx.setXYZW(k, Math.floor(h.seed * 97), h.w, h.d, h.h + 1);
  });
  hMesh.count = houses.length;
  hMesh.castShadow = c.quality.id !== 'low';
  hMesh.receiveShadow = true;
  hMesh.computeBoundingSphere();
  group.add(hMesh);
  tris += (houses.length * hGeo.index!.count) / 3;

  // Roadside / quay houses: white cube (unit frame) with a blue door and shutters on the front, a roof parapet and a
  // bougainvillea patch climbing one corner (1 draw).
  const rhGeo = (() => {
    const b = new SBuf();
    const o = { x: 0, y: 0, z: 0 };
    const wht = new Color(1.5, 1.48, 1.42), blu = new Color(0.06, 0.22, 0.62), mag = new Color(0.62, 0.05, 0.38), dk = new Color(0.08, 0.08, 0.1);
    boxInFrame(b, o, [-0.5, 0.5], [-0.5, 0.5], [-0.15, 1], 1, 0, 0, 1, wht);
    boxInFrame(b, o, [-0.52, 0.52], [-0.52, 0.52], [1, 1.06], 1, 0, 0, 1, wht);
    b.quad([[-0.08, 0, 0.503], [0.08, 0, 0.503], [-0.08, 0.62, 0.503], [0.08, 0.62, 0.503]], [0, 0, 1], blu);
    for (const u of [-0.32, 0.3]) {
      b.quad([[u - 0.06, 0.35, 0.503], [u + 0.06, 0.35, 0.503], [u - 0.06, 0.62, 0.503], [u + 0.06, 0.62, 0.503]], [0, 0, 1], dk);
      b.quad([[u - 0.12, 0.33, 0.506], [u - 0.06, 0.33, 0.506], [u - 0.12, 0.64, 0.506], [u - 0.06, 0.64, 0.506]], [0, 0, 1], blu);
      b.quad([[u + 0.06, 0.33, 0.506], [u + 0.12, 0.33, 0.506], [u + 0.06, 0.64, 0.506], [u + 0.12, 0.64, 0.506]], [0, 0, 1], blu);
    }
    b.quad([[0.503, 0, 0.5], [0.503, 0, 0.15], [0.503, 0.95, 0.5], [0.503, 0.85, 0.1]], [1, 0, 0], mag);
    b.quad([[0.2, 0.75, 0.506], [0.5, 0.75, 0.506], [0.25, 1.0, 0.506], [0.5, 1.0, 0.506]], [0, 0, 1], mag);
    return b.geometry();
  })();
  const rhMat = envMaterial(c.sh, { name: 'aegean.roadsideHouses', family: 'inst', vertexColor: true, roughness: 0.85, wet: 0.4, flood: 0.9 });
  const rhMesh = new InstancedMesh(rhGeo, rhMat, Math.max(1, rhouses.length));
  rhMesh.name = 'aegean.roadsideHouses';
  const tones = [new Color(1, 1, 1), new Color(1, 0.97, 0.9), new Color(0.98, 0.9, 0.76), new Color(1, 0.95, 0.95)];
  rhouses.forEach((h, k) => {
    qt.setFromAxisAngle(up, h.yaw);
    m4.compose(pv.set(h.x, h.y, h.z), qt, sv.set(h.w, h.h, h.d));
    rhMesh.setMatrixAt(k, m4);
    rhMesh.setColorAt(k, tones[Math.floor(h.tone * tones.length)]!);
  });
  rhMesh.count = rhouses.length;
  rhMesh.castShadow = c.quality.id !== 'low';
  rhMesh.receiveShadow = true;
  rhMesh.computeBoundingSphere();
  group.add(rhMesh);
  tris += (rhouses.length * rhGeo.index!.count) / 3;

  /** Instanced env materials multiply a vertex colour: give the plain icosahedra a white one. */
  const whiteColours = (g: BufferGeometry): BufferGeometry => {
    g.setAttribute('color', new BufferAttribute(new Float32Array(g.getAttribute('position').count * 3).fill(1), 3));
    return g;
  };
  const domeGeo = whiteColours(new IcosahedronGeometry(1, 2));
  const domeMat = envMaterial(c.sh, { name: 'aegean.domes', family: 'inst', vertexColor: true, roughness: 0.4, wet: 0.5 });
  const domeMesh = new InstancedMesh(domeGeo, domeMat, Math.max(1, domes.length));
  domeMesh.name = 'aegean.domes';
  domes.forEach((d, k) => {
    m4.compose(pv.set(d.x, d.y, d.z), qt.identity(), sv.set(d.r, d.r * 0.85, d.r));
    domeMesh.setMatrixAt(k, m4);
    domeMesh.setColorAt(k, blue);
  });
  domeMesh.count = domes.length;
  domeMesh.computeBoundingSphere();
  group.add(domeMesh);
  const flGeo = whiteColours(new IcosahedronGeometry(1, 0));
  const flMat = envMaterial(c.sh, { name: 'aegean.bougainvillea', family: 'inst', vertexColor: true, roughness: 0.9, wet: 0.3 });
  const magenta = new Color(0.62, 0.05, 0.36);
  const flMesh = new InstancedMesh(flGeo, flMat, Math.max(1, flowers.length));
  flMesh.name = 'aegean.bougainvillea';
  flowers.forEach((fl, k) => {
    m4.compose(pv.set(fl.x, fl.y, fl.z), qt.setFromAxisAngle(up, fl.s * 3), sv.set(fl.s, fl.s * 0.8, fl.s * 0.6));
    flMesh.setMatrixAt(k, m4);
    flMesh.setColorAt(k, magenta);
  });
  flMesh.count = flowers.length;
  flMesh.computeBoundingSphere();
  group.add(flMesh);
  tris += domes.length * 80 + flowers.length * 20;

  // ---- moving boats (ferries; sailing yachts and speedboats share the yacht mesh with the moored ones) ----
  const ferryGeo = ferryGeometry().body.geometry();
  const yachtGeo = yachtGeometry().geometry();
  type Route = { cx: number; cz: number; rx: number; rz: number; speed: number; phase: number; kind: 0 | 1 };
  const routes: Route[] = [
    { cx: wx(-650), cz: wz(300), rx: 260, rz: 900, speed: 6, phase: 0, kind: 0 },
    { cx: wx(800), cz: wz(1700), rx: 1100, rz: 220, speed: 7, phase: 2, kind: 0 },
    { cx: wx(780), cz: wz(380), rx: 260, rz: 170, speed: 4, phase: 0.3, kind: 1 },
    { cx: wx(780), cz: wz(380), rx: 230, rz: 150, speed: 4.5, phase: 2.6, kind: 1 },
    { cx: wx(600), cz: wz(700), rx: 170, rz: 110, speed: 5, phase: 4, kind: 1 },
    { cx: wx(2200), cz: wz(200), rx: 260, rz: 700, speed: 5, phase: 1, kind: 1 },
    { cx: wx(2150), cz: wz(-900), rx: 400, rz: 200, speed: 4, phase: 3, kind: 1 },
    { cx: wx(-300), cz: wz(-1000), rx: 500, rz: 230, speed: 12, phase: 0.7, kind: 1 },
    { cx: wx(1100), cz: wz(-1000), rx: 450, rz: 160, speed: 13, phase: 2.2, kind: 1 },
  ];
  // Moored yachts in the harbour basin (static, part of the same yacht mesh).
  const moored: { x: number; z: number; yaw: number }[] = [];
  for (let k = 1; k + 1 < quay.length; k += 2) {
    const [ax, az] = quay[k - 1]!, [bx, bz] = quay[k + 1]!;
    const l = Math.hypot(bx - ax, bz - az) || 1;
    let nx = (bz - az) / l, nz = -(bx - ax) / l;
    if (ground.dem(quay[k]![0] + nx * 20, quay[k]![1] + nz * 20) > ground.dem(quay[k]![0] - nx * 20, quay[k]![1] - nz * 20)) { nx = -nx; nz = -nz; }
    moored.push({ x: quay[k]![0] + nx * 22, z: quay[k]![1] + nz * 22, yaw: Math.atan2(-nz, nx) });
  }
  const ferryMat = envMaterial(c.sh, { name: 'aegean.ferries', family: 'inst', vertexColor: true, roughness: 0.5, wet: 0.3 });
  const nF = routes.filter((r) => r.kind === 0).length, nY = routes.length - nF + moored.length;
  const ferries = new InstancedMesh(ferryGeo, ferryMat, nF);
  const yachts = new InstancedMesh(yachtGeo, ferryMat, nY);
  ferries.name = 'aegean.ferries';
  yachts.name = 'aegean.yachts';
  for (const m of [ferries, yachts]) { m.frustumCulled = false; m.castShadow = false; group.add(m); }
  const one = new Vector3(1, 1, 1);
  const placeBoats = (time: number): void => {
    let fi = 0, yi = 0;
    for (const r of routes) {
      const per = (2 * Math.PI * Math.sqrt((r.rx * r.rx + r.rz * r.rz) / 2)) / r.speed;
      const a = ((time / per) * Math.PI * 2 + r.phase) % (Math.PI * 2);
      const x = r.cx + Math.cos(a) * r.rx, z = r.cz + Math.sin(a) * r.rz;
      const vx = -Math.sin(a) * r.rx, vz = Math.cos(a) * r.rz;
      qt.setFromAxisAngle(up, Math.atan2(-vz, vx));
      m4.compose(pv.set(x, SEA_Y + (r.kind === 0 ? 0 : 0.1), z), qt, one);
      if (r.kind === 0) ferries.setMatrixAt(fi++, m4);
      else yachts.setMatrixAt(yi++, m4);
    }
    for (const m of moored) {
      qt.setFromAxisAngle(up, m.yaw);
      m4.compose(pv.set(m.x, SEA_Y + 0.1, m.z), qt, one);
      yachts.setMatrixAt(yi++, m4);
    }
    ferries.instanceMatrix.needsUpdate = true;
    yachts.instanceMatrix.needsUpdate = true;
  };
  const wcol = new Color(1, 1, 1);
  for (let k = 0; k < nF; k++) ferries.setColorAt(k, wcol);
  for (let k = 0; k < nY; k++) yachts.setColorAt(k, wcol);
  placeBoats(0);
  tris += (nF * ferryGeo.index!.count + nY * yachtGeo.index!.count) / 3;
  for (const m of moored) foam.push({ x: m.x, z: m.z, r: 2 });

  // ---- seagulls circling over the harbour and the bridges ----
  const GULLS = 24;
  const gGeo = gullGeometry().geometry();
  const gMat = envMaterial(c.sh, { name: 'aegean.gulls', family: 'inst', vertexColor: true, roughness: 0.8, wet: 0, flood: 0.5 });
  const gulls = new InstancedMesh(gGeo, gMat, GULLS);
  gulls.name = 'aegean.gulls';
  gulls.frustumCulled = false;
  for (let k = 0; k < GULLS; k++) gulls.setColorAt(k, wcol);
  group.add(gulls);
  const gullC = [[hx, hz], [wx(700), wz(-560)], [wx(800), wz(1150)], [wx(1650), wz(500)]];
  const gs = new Vector3();
  const placeGulls = (time: number): void => {
    for (let k = 0; k < GULLS; k++) {
      const cc = gullC[k % gullC.length]!;
      const r = 30 + (k * 13) % 50, w = 0.12 + ((k * 7) % 5) * 0.02;
      const a = time * w * (k % 2 ? 1 : -1) + k;
      const flap = 0.8 + 0.25 * Math.sin(time * 6 + k);
      qt.setFromAxisAngle(up, -a + (k % 2 ? 0 : Math.PI));
      m4.compose(pv.set(cc[0]! + Math.cos(a) * r, SEA_Y + 22 + (k % 7) * 3 + Math.sin(time * 0.7 + k) * 2, cc[1]! + Math.sin(a) * r), qt, gs.set(1.4, 1.4 * flap, 1.4));
      gulls.setMatrixAt(k, m4);
    }
    gulls.instanceMatrix.needsUpdate = true;
  };
  placeGulls(0);

  // ---- the sea: one grid (shallowness and coast foam in the vertex colour), foam rings and lines appended ----
  {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i < data.count; i += 10) { x0 = Math.min(x0, data.x[i]!); x1 = Math.max(x1, data.x[i]!); z0 = Math.min(z0, data.z[i]!); z1 = Math.max(z1, data.z[i]!); }
    const cx = Math.round((x0 + x1) / 2 / SEA_STEP) * SEA_STEP, cz = Math.round((z0 + z1) / 2 / SEA_STEP) * SEA_STEP;
    const n = (2 * SEA_HALF) / SEA_STEP + 1;
    const pos: number[] = [], col: number[] = [], nor: number[] = [], idx: number[] = [];
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const x = cx - SEA_HALF + i * SEA_STEP, z = cz - SEA_HALF + j * SEA_STEP;
      const dem = ground.dem(x, z);
      pos.push(x, SEA_Y, z);
      nor.push(0, 1, 0);
      col.push(sst(-30, -6, dem), sst(-6.2, -4.6, dem) * 0.85, 0);
    }
    for (let j = 0; j + 1 < n; j++) for (let i = 0; i + 1 < n; i++) {
      const a = j * n + i, b = a + 1, cc = a + n, d = cc + 1;
      // Skip quads fully under high land (never visible).
      if (ground.dem(pos[a * 3]!, pos[a * 3 + 2]!) > 4 && ground.dem(pos[d * 3]!, pos[d * 3 + 2]!) > 4) continue;
      idx.push(a, cc, b, b, cc, d);
    }
    const ring = (x: number, z: number, r: number): void => {
      const b0 = pos.length / 3;
      pos.push(x, SEA_Y + 0.05, z);
      nor.push(0, 1, 0);
      col.push(0.6, 1, 0);
      for (let k = 0; k < 10; k++) {
        const a = (k / 10) * Math.PI * 2;
        pos.push(x + Math.cos(a) * r, SEA_Y + 0.05, z + Math.sin(a) * r);
        nor.push(0, 1, 0);
        col.push(0.6, 0.15, 0);
      }
      for (let k = 0; k < 10; k++) idx.push(b0, b0 + 1 + ((k + 1) % 10), b0 + 1 + k);
    };
    // Open-sea skirt out to 40 km (deep colour) so the sea meets the horizon.
    {
      const R = 40000, a0 = SEA_HALF;
      const b0 = pos.length / 3;
      for (const [x, z] of [[-a0, -a0], [a0, -a0], [a0, a0], [-a0, a0], [-R, -R], [R, -R], [R, R], [-R, R]] as const) {
        pos.push(cx + x, SEA_Y - 0.02, cz + z);
        nor.push(0, 1, 0);
        col.push(0, 0, 0);
      }
      for (let k = 0; k < 4; k++) {
        const i0 = b0 + k, i1 = b0 + ((k + 1) % 4), o0 = b0 + 4 + k, o1 = b0 + 4 + ((k + 1) % 4);
        idx.push(i0, o0, i1, i1, o0, o1);
      }
    }
    for (const fo of foam) ring(fo.x, fo.z, fo.r);
    for (const [ax, az, bx, bz, hw] of foamLines) {
      const dx = bx - ax, dz = bz - az, l = Math.hypot(dx, dz) || 1, nx = -dz / l * hw, nz = dx / l * hw;
      const b0 = pos.length / 3;
      for (const [x, z, g] of [[ax - nx, az - nz, 0.1], [bx - nx, bz - nz, 0.1], [ax, az, 1], [bx, bz, 1], [ax + nx, az + nz, 0.1], [bx + nx, bz + nz, 0.1]] as const) {
        pos.push(x, SEA_Y + 0.05, z);
        nor.push(0, 1, 0);
        col.push(0.5, g, 0);
      }
      idx.push(b0, b0 + 2, b0 + 1, b0 + 1, b0 + 2, b0 + 3, b0 + 2, b0 + 4, b0 + 3, b0 + 3, b0 + 4, b0 + 5);
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
    g.setAttribute('normal', new BufferAttribute(new Float32Array(nor), 3));
    g.setAttribute('color', new BufferAttribute(new Float32Array(col), 3));
    g.setIndex(new BufferAttribute(new Uint32Array(idx), 1));
    g.computeBoundingSphere();
    const seaMat = envMaterial(c.sh, { name: 'aegean.sea', family: 'opaque', mode: EnvMode.Water, vertexColor: true, roughness: 0.05, wet: 0, flood: 0.08 });
    const sea = new Mesh(g, seaMat);
    sea.name = 'aegean.sea';
    sea.receiveShadow = true;
    sea.matrixAutoUpdate = false;
    group.add(sea);
    tris += idx.length / 3;
    group.userData.sea = { g, seaMat };
  }

  // ---- the static buffers ----
  const stGeo = st.geometry();
  const stMat = envMaterial(c.sh, { name: 'aegean.struct', family: 'opaque', vertexColor: true, map: c.tex.concrete.map, normalMap: c.tex.concrete.normal, roughness: 0.75, wet: 0.5 });
  const stMesh = new Mesh(stGeo, stMat);
  stMesh.name = 'aegean.struct';
  stMesh.castShadow = true;
  stMesh.receiveShadow = true;
  stMesh.matrixAutoUpdate = false;
  group.add(stMesh);
  const rockGeo = rock.geometry();
  const rockMat = envMaterial(c.sh, { name: 'aegean.rock', family: 'opaque', vertexColor: true, map: c.tex.concrete.map, normalMap: c.tex.dirt.normal, roughness: 0.95, wet: 0.7 });
  const rockMesh = new Mesh(rockGeo, rockMat);
  rockMesh.name = 'aegean.rock';
  rockMesh.castShadow = true;
  rockMesh.receiveShadow = true;
  rockMesh.matrixAutoUpdate = false;
  group.add(rockMesh);
  const lampGeo = lamps.geometry();
  const lampMat = envMaterial(c.sh, { name: 'aegean.lamps', family: 'opaque', mode: EnvMode.Lamp, vertexColor: true, emissive: 0xffffff, emissiveIntensity: 0.6, roughness: 0.3, wet: 0, flood: 0 });
  const lampMesh = new Mesh(lampGeo, lampMat);
  lampMesh.name = 'aegean.lamps';
  lampMesh.matrixAutoUpdate = false;
  group.add(lampMesh);
  tris += (stGeo.index!.count + rockGeo.index!.count + lampGeo.index!.count) / 3;
  const { g: seaGeo, seaMat } = group.userData.sea as { g: BufferGeometry; seaMat: ReturnType<typeof envMaterial> };

  return {
    root: group,
    triangles: tris,
    update(_cam: PerspectiveCamera, frame: RenderFrame) {
      placeBoats(frame.time);
      placeGulls(frame.time);
    },
    applyConditions(cc) {
      lampMat.emissiveIntensity = cc.tod === 'night' ? 2.4 : cc.tod === 'sunset' ? 1.5 : 0.6;
      envUniforms(hMat).uApxP.value.x = cc.tod === 'night' ? 1.4 : cc.tod === 'sunset' ? 0.4 : 0;
      gulls.visible = cc.tod !== 'night';
    },
    setQuality(qp) {
      hMesh.castShadow = qp.id !== 'low';
    },
    dispose() {
      for (const g of [stGeo, rockGeo, lampGeo, hGeo, rhGeo, domeGeo, flGeo, ferryGeo, yachtGeo, gGeo, seaGeo]) g.dispose();
      for (const m of [stMat, rockMat, lampMat, hMat, rhMat, domeMat, flMat, ferryMat, gMat, seaMat]) m.dispose();
      for (const m of [hMesh, rhMesh, domeMesh, flMesh, ferries, yachts, gulls]) m.dispose();
      group.removeFromParent();
    },
  };
}
