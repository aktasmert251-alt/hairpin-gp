// Track surface meshes (Ç4): main ribbon, edge lines, kerbs (flat with sawtooth, yellow sausages), astroturf,
// run-offs (plain / painted / gravel), grass verges to the barrier, S/F line, grid boxes, DRS lines, pit ribbon
// with lines and box markings. 250 m chunks, one mesh per material per chunk; u = s, v = d (metres).

import { BufferAttribute, BufferGeometry, Color, Mesh, type Material } from 'three';
import type { Vec3 } from '../../contracts/common';
import type { TrackBundle, TrackFrame } from '../../contracts/track';
import { TEAMS } from '../../data/teams';
import type { TrackExtras } from '../build/extras';
import { SURFACE_TYPES } from '../query/surfaces';
import type { TrackMaterials } from './materials';

const CHUNK_DEFAULT = 250;
const LINE_W = 0.12;
const LIP = 2;

class Buf {
  pos: number[] = [];
  nor: number[] = [];
  uv: number[] = [];
  apx: number[] = [];
  col: number[] = [];
  idx: number[] = [];
  /** Vertex colour of the following vertices (markings kind 4: team-coloured box lines). */
  rgb: [number, number, number] = [1, 1, 1];
  /** `puddles`: the asphalt buffers carry a puddle propensity in aApx.z (wet look, Ç3). */
  constructor(readonly puddles = false) {}
  v(x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, w: number, a: number, b = 0, c = 0): number {
    this.pos.push(x, y, z);
    this.nor.push(nx, ny, nz);
    this.uv.push(u, w);
    this.apx.push(a, b, c);
    this.col.push(this.rgb[0], this.rgb[1], this.rgb[2]);
    return this.pos.length / 3 - 1;
  }
  quad(a: number, b: number, c: number, d: number): void {
    // a, b = row r with b to the right of a (looking along +s); c, d = the same columns on row r+1. Faces up.
    this.idx.push(a, b, c, b, d, c);
  }
  empty(): boolean {
    return this.idx.length === 0;
  }
  geometry(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute('normal', new BufferAttribute(new Float32Array(this.nor), 3));
    g.setAttribute('uv', new BufferAttribute(new Float32Array(this.uv), 2));
    g.setAttribute('aApx', new BufferAttribute(new Float32Array(this.apx), 3));
    g.setAttribute('color', new BufferAttribute(new Float32Array(this.col), 3));
    const n = this.pos.length / 3;
    g.setIndex(n > 65535 ? new BufferAttribute(new Uint32Array(this.idx), 1) : new BufferAttribute(new Uint16Array(this.idx), 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

// Canonical lateral slots per side.
const KERB = 0, ASTRO = 1, ROA = 2, SAUS = 3, ROB = 4, GRAVEL = 5, BASE = 6;
const NSLOT = 7;

export interface SurfaceBuild { meshes: Mesh[]; geometries: BufferGeometry[]; triangles: number }

export function buildTrackSurface(track: TrackBundle, ex: TrackExtras, mats: TrackMaterials): SurfaceBuild {
  // Sea-bridge and valley tracks are seen in long views (over the water, across the valley): longer chunks, fewer draws.
  const CHUNK = ex.authoring.THEME.backdrop === 'valley' ? 100000 : ex.authoring.THEME.backdrop === 'islands' ? 400 : CHUNK_DEFAULT;
  const { data, query: q } = track;
  const N = data.count;
  const L = data.length;
  const f: TrackFrame = { s: 0, px: 0, py: 0, pz: 0, tx: 1, tz: 0, lx: 0, lz: -1, halfWidthL: 0, halfWidthR: 0, crossSlope: 0, curvature: 0, vCurvature: 0, grade: 0, sector: 0 };
  const p: Vec3 = { x: 0, y: 0, z: 0 };
  const meshes: Mesh[] = [];
  const geometries: BufferGeometry[] = [];
  let triangles = 0;

  // ---- rows (adaptive along s) --------------------------------------------------------------------------
  const keep = new Uint8Array(N);
  const differs = (i: number, j: number): boolean => {
    for (let b = 0; b < 4; b++) {
      if (data.bandTypeL[i * 4 + b] !== data.bandTypeL[j * 4 + b] || data.bandTypeR[i * 4 + b] !== data.bandTypeR[j * 4 + b]) return true;
      if (Math.abs(data.bandOuterL[i * 4 + b]! - data.bandOuterL[j * 4 + b]!) > 0.05) return true;
      if (Math.abs(data.bandOuterR[i * 4 + b]! - data.bandOuterR[j * 4 + b]!) > 0.05) return true;
    }
    return Math.abs(data.wallL[i]! - data.wallL[j]!) > 0.05 || Math.abs(data.wallR[i]! - data.wallR[j]!) > 0.05 || ex.kerbL[i] !== ex.kerbL[j] || ex.kerbR[i] !== ex.kerbR[j];
  };
  for (let i = 0; i < N; i++) {
    const a = (i - 1 + N) % N;
    const b = (i + 1) % N;
    if (i % 3 === 0 || Math.abs(data.curvature[i]!) > 1 / 900 || i % CHUNK === 0 || differs(i, a) || differs(i, b)) keep[i] = 1;
  }
  const rows: number[] = [];
  for (let i = 0; i < N; i++) if (keep[i]) rows.push(i);
  rows.push(L); // closing row (s = L ≡ 0)

  // Pit inner (main-facing) edge as a main-d magnitude on the pit side (clips the pit-side bands where the pit ribbon
  // runs beside the main track).
  const pit = data.pit;
  const pitDsp = ex.pitDsp;
  const sg = ex.pitSide;
  const pitInnerAt = (i: number): number => {
    const sp = ex.mainPitSp[i]!;
    if (!(sp === sp)) return Infinity;
    const j = Math.min(pit.count - 1, Math.max(0, Math.round(sp / pitDsp)));
    const dm = ex.pitMainD[j]!;
    if (Math.abs(dm) > ex.pitNearD) return Infinity;
    return sg * dm - pit.halfWidth[j]!;
  };

  // Column offsets per row and side: [hw, kerb, astro, roA, saus, roB, gravel, base] (8 boundaries).
  const cols = (i: number, side: 1 | -1, out: Float64Array, typeOut: Uint8Array): void => {
    const hw = side === 1 ? data.halfWidthL[i]! : data.halfWidthR[i]!;
    const T = side === 1 ? data.bandTypeL : data.bandTypeR;
    const O = side === 1 ? data.bandOuterL : data.bandOuterR;
    const wall = side === 1 ? data.wallL[i]! : data.wallR[i]!;
    const w = new Float64Array(NSLOT);
    let prev = hw;
    let hasSaus = false, hasGravel = false;
    for (let b = 0; b < 4; b++) {
      const t = SURFACE_TYPES[T[i * 4 + b]!];
      if (t === 'kerbSausage') hasSaus = true;
      if (t === 'gravel') hasGravel = true;
    }
    let baseType = 0;
    let sausSeen = false;
    for (let b = 0; b < 4; b++) {
      const t = SURFACE_TYPES[T[i * 4 + b]!];
      if (t === 'concrete') baseType = 1;
      const o = O[i * 4 + b]!;
      const width = o - prev;
      prev = Math.max(prev, o);
      if (width <= 1e-4) continue;
      let slot = BASE;
      if (t === 'kerbFlat') slot = KERB;
      else if (t === 'astroturf') slot = ASTRO;
      else if (t === 'kerbSausage') { slot = SAUS; sausSeen = true; }
      else if (t === 'gravel') slot = GRAVEL;
      else if (t === 'runoffAsphalt') slot = (hasSaus && !sausSeen) || (hasGravel && !hasSaus) ? ROA : ROB;
      w[slot] = w[slot]! + width;
    }
    let o = hw;
    out[0] = o;
    for (let k = 0; k < NSLOT; k++) {
      o += w[k]!;
      out[k + 1] = o;
    }
    let outer = Math.max(o, wall + 0.8);
    if (side === sg) outer = Math.min(outer, Math.max(hw, pitInnerAt(i)));
    // Clip every boundary to the outer limit (pit ribbon beside the track).
    for (let k = 0; k <= NSLOT; k++) out[k] = Math.min(out[k]!, outer);
    out[NSLOT] = Math.max(out[NSLOT - 1]!, outer);
    typeOut[0] = baseType;
  };

  const normalAt = (s: number, d: number, n: number[]): void => {
    q.frameAt(s, f);
    const flat = d > f.halfWidthL + LIP || d < -f.halfWidthR - LIP;
    const c = flat ? 0 : f.crossSlope;
    const nx = -(f.grade * f.tx + c * f.tz);
    const nz = -(f.grade * f.tz - c * f.tx);
    const inv = 1 / Math.hypot(nx, 1, nz);
    n[0] = nx * inv;
    n[1] = inv;
    n[2] = nz * inv;
  };
  const nrm = [0, 1, 0];
  const lineDAt = (s: number): number => ex.lineD[Math.round(s) % N]!;
  const painted = (s: number, side: 1 | -1): boolean => {
    for (const pr of ex.paint) {
      if (pr.side !== side) continue;
      const len = q.wrapS(pr.toS - pr.fromS);
      if (q.wrapS(s - pr.fromS) <= len) return true;
    }
    return false;
  };

  // Puddle propensity (wet look): water collects at the low edge of the camber, in sags and where the grade is flat.
  const pc: Vec3 = { x: 0, y: 0, z: 0 };
  const puddleAt = (s: number, d: number, y: number, surf: number): number => {
    if (surf > 0.5) return surf > 2.5 ? 0.35 : 0.45;
    q.worldFromSD(s, 0, pc);
    const yc = pc.y;
    q.worldFromSD(s - 25, 0, pc);
    const ya = pc.y;
    q.worldFromSD(s + 25, 0, pc);
    const sag = Math.min(1, Math.max(0, (ya + pc.y - 2 * yc) * 2.5));
    q.frameAt(s, f);
    const flat = 1 - Math.min(1, Math.abs(f.grade) / 0.04);
    const low = Math.min(1, Math.max(0, (yc - y) * 6));
    const edge = Math.min(1, Math.abs(d) / Math.max(1, d > 0 ? f.halfWidthL : f.halfWidthR));
    return Math.min(1, Math.max(0, 0.08 + 0.3 * sag + 0.22 * flat + 0.25 * edge + 0.3 * low * edge));
  };

  // ---- main ribbon, per chunk ----------------------------------------------------------------------------
  const nChunks = Math.ceil(L / CHUNK);
  const colA = new Float64Array(NSLOT + 1);
  const colB = new Float64Array(NSLOT + 1);
  const tA = new Uint8Array(1);
  const tB = new Uint8Array(1);
  for (let c = 0; c < nChunks; c++) {
    const s0 = c * CHUNK;
    const s1 = Math.min(L, (c + 1) * CHUNK);
    const rr = rows.filter((s) => s >= s0 && s <= s1);
    const asphalt = new Buf(true);
    const markings = new Buf();
    const verge = new Buf();
    const gravel = new Buf();
    const concrete = new Buf();

    const vtx = (buf: Buf, s: number, d: number, lift: number, a: number, b = 0): number => {
      q.worldFromSD(s, d, p);
      normalAt(s, d, nrm);
      return buf.v(p.x, p.y + lift, p.z, nrm[0]!, nrm[1]!, nrm[2]!, s, d, a, b, buf.puddles ? puddleAt(s, d, p.y, a) : 0);
    };

    // Asphalt (3 columns) and edge lines.
    for (let r = 0; r + 1 < rr.length; r++) {
      const sa = rr[r]!;
      const sb = rr[r + 1]!;
      const ia = sa % N;
      const ib = sb % N;
      const la = lineDAt(sa);
      const lb = lineDAt(sb);
      const hRa = data.halfWidthR[ia]!, hLa = data.halfWidthL[ia]!, hRb = data.halfWidthR[ib]!, hLb = data.halfWidthL[ib]!;
      const a0 = vtx(asphalt, sa, -hRa, 0, 0, la), a1 = vtx(asphalt, sa, 0, 0, 0, la), a2 = vtx(asphalt, sa, hLa, 0, 0, la);
      const b0 = vtx(asphalt, sb, -hRb, 0, 0, lb), b1 = vtx(asphalt, sb, 0, 0, 0, lb), b2 = vtx(asphalt, sb, hLb, 0, 0, lb);
      asphalt.quad(a1, a0, b1, b0);
      asphalt.quad(a2, a1, b2, b1);
      // White lines (inside the limits).
      for (const side of [1, -1] as const) {
        const ha = side === 1 ? hLa : hRa;
        const hb = side === 1 ? hLb : hRb;
        const i0 = vtx(markings, sa, side * (ha - LINE_W), 0, 0, 0), i1 = vtx(markings, sa, side * ha, 0, 0, 1);
        const j0 = vtx(markings, sb, side * (hb - LINE_W), 0, 0, 0), j1 = vtx(markings, sb, side * hb, 0, 0, 1);
        if (side === 1) markings.quad(i1, i0, j1, j0);
        else markings.quad(i0, i1, j0, j1);
      }
      // Bands per side, slot by slot.
      for (const side of [1, -1] as const) {
        cols(ia, side, colA, tA);
        cols(ib, side, colB, tB);
        for (let k = 0; k < NSLOT; k++) {
          const wa = colA[k + 1]! - colA[k]!;
          const wb = colB[k + 1]! - colB[k]!;
          if (wa <= 1e-3 && wb <= 1e-3) continue;
          const da0 = side * colA[k]!, da1 = side * colA[k + 1]!, db0 = side * colB[k]!, db1 = side * colB[k + 1]!;
          const emit = (buf: Buf, a: number, prof: number[] | null): void => {
            // prof: lateral profile heights at evenly spaced columns (null = flat 2 columns).
            const n = prof ? prof.length : 2;
            const ra: number[] = [];
            const rb: number[] = [];
            for (let m = 0; m < n; m++) {
              const t = m / (n - 1);
              const h = prof ? prof[m]! : 0;
              ra.push(vtx(buf, sa, da0 + (da1 - da0) * t, h, a, t));
              rb.push(vtx(buf, sb, db0 + (db1 - db0) * t, h, a, t));
            }
            for (let m = 0; m + 1 < n; m++) {
              if (side === 1) buf.quad(ra[m + 1]!, ra[m]!, rb[m + 1]!, rb[m]!);
              else buf.quad(ra[m]!, ra[m + 1]!, rb[m]!, rb[m + 1]!);
            }
          };
          if (k === KERB) emit(markings, 1, [0.004, 0.022, 0.028, 0.016, 0.004]);
          else if (k === SAUS) emit(markings, 2, [0.0, 0.07, 0.11, 0.12, 0.11, 0.07, 0.0]);
          else if (k === ASTRO) emit(verge, 1, null);
          else if (k === ROA || k === ROB) emit(asphalt, painted(sa, side) ? 3 : 1, null);
          else if (k === GRAVEL) emit(gravel, 0, null);
          else if (tA[0] === 1) emit(concrete, 0, null);
          else emit(verge, 0, null);
        }
      }
    }

    // Decals: S/F chequer, grid boxes, DRS lines (white), within this chunk.
    const decal = (sA: number, sB: number, d0: number, d1: number, kind: number): void => {
      if (!(sA >= s0 && sA < s1)) return;
      const a = vtx(markings, sA, d0, 0, kind, 0), b = vtx(markings, sA, d1, 0, kind, 1);
      const cc = vtx(markings, sB, d0, 0, kind, 0), dd = vtx(markings, sB, d1, 0, kind, 1);
      markings.quad(b, a, dd, cc);
    };
    if (c === 0) {
      decal(0, 1.0, -data.halfWidthR[0]! + LINE_W, data.halfWidthL[0]! - LINE_W, 3);
    }
    for (const g of data.grid) {
      const sF = g.s + 2.7;
      decal(sF, sF + 0.15, g.d - 1.15, g.d + 1.15, 0);
      decal(sF - 1.4, sF, g.d - 1.15, g.d - 1.0, 0);
      decal(sF - 1.4, sF, g.d + 1.0, g.d + 1.15, 0);
    }
    for (const t of data.timingLines) {
      if (t.kind === 'drsDetect' || t.kind === 'drsActivate') {
        const i = Math.round(t.s) % N;
        decal(t.s, t.s + 0.2, -data.halfWidthR[i]! + LINE_W, data.halfWidthL[i]! - LINE_W, 0);
      }
    }

    for (const [buf, mat] of [[asphalt, mats.asphalt], [markings, mats.markings], [verge, mats.verge], [gravel, mats.gravel], [concrete, mats.concrete]] as const) {
      if (buf.empty()) continue;
      const g = buf.geometry();
      geometries.push(g);
      triangles += buf.idx.length / 3;
      const m = new Mesh(g, mat as Material);
      m.name = `track.${(mat as Material).name}.c${c}`;
      m.receiveShadow = true;
      m.castShadow = false;
      m.matrixAutoUpdate = false;
      meshes.push(m);
    }
  }

  // ---- pit ribbon -------------------------------------------------------------------------------------
  if (pit.count > 1) {
    const PC = pit.count;
    const per = Math.ceil(PC / 4);
    const pp: Vec3 = { x: 0, y: 0, z: 0 };
    for (let c = 0; c < 4; c++) {
      const j0 = c * per;
      const j1 = Math.min(PC - 1, (c + 1) * per);
      if (j1 <= j0) continue;
      const asphalt = new Buf(true);
      const markings = new Buf();
      const concrete = new Buf();
      const pv = (buf: Buf, j: number, d: number, lift: number, a: number, b = 0): number => {
        const sp = j * pitDsp;
        q.pitWorldFromSD(sp, d, pp);
        const ja = Math.min(PC - 2, j);
        const g = (pit.y[ja + 1]! - pit.y[ja]!) / pitDsp;
        const nx = -g * pit.tx[j]!;
        const nz = -g * pit.tz[j]!;
        const inv = 1 / Math.hypot(nx, 1, nz);
        return buf.v(pp.x, pp.y + lift, pp.z, nx * inv, inv, nz * inv, sp, d, a, b, buf.puddles ? 0.3 + 0.25 * Math.abs(d) / Math.max(1, pit.halfWidth[ja]!) : 0);
      };
      // Inner (main-facing) edge, signed pit d, clipped to the main pit-side edge where the ribbons overlap (split/merge).
      const innerD = (j: number): number => {
        const hw = pit.halfWidth[j]!;
        const dm = ex.pitMainD[j]!;
        if (Math.abs(dm) > ex.pitNearD) return -sg * hw;
        const s = ex.pitMainS[j]!;
        const hwMain = (sg === 1 ? data.halfWidthL : data.halfWidthR)[Math.round(s) % N]!;
        return sg * Math.min(hw - 0.05, Math.max(-hw, hwMain - sg * dm));
      };
      const leftD = (j: number): number => (sg === 1 ? pit.halfWidth[j]! : innerD(j));
      const rightD = (j: number): number => (sg === 1 ? innerD(j) : -pit.halfWidth[j]!);
      const boxFrom = pit.boxes.length ? pit.boxes[0]!.sp - 14 : 0;
      const boxTo = pit.boxes.length ? pit.boxes[pit.boxes.length - 1]!.sp + 14 : -1;
      for (let j = j0; j < j1; j++) {
        const k = j + 1;
        const ra = rightD(j), rb = rightD(k);
        const la = leftD(j), lb = leftD(k);
        const a0 = pv(asphalt, j, ra, 0, 2), a1 = pv(asphalt, j, la, 0, 2);
        const b0 = pv(asphalt, k, rb, 0, 2), b1 = pv(asphalt, k, lb, 0, 2);
        asphalt.quad(a1, a0, b1, b0);
        // Edge lines (garage side always; main side where not merged into the main ribbon).
        const lineQuad = (da: number, db: number, w: number): void => {
          const i0 = pv(markings, j, da, 0, 0, 0), i1 = pv(markings, j, da + w, 0, 0, 1);
          const k0 = pv(markings, k, db, 0, 0, 0), k1 = pv(markings, k, db + w, 0, 0, 1);
          markings.quad(i1, i0, k1, k0);
        };
        const leftFree = la >= pit.halfWidth[j]! - 0.01, rightFree = ra <= -pit.halfWidth[j]! + 0.01;
        if (leftFree) lineQuad(la - LINE_W, lb - LINE_W, LINE_W);
        if (rightFree) lineQuad(ra, rb, LINE_W);
        const sp = j * pitDsp;
        if (sp >= boxFrom && sp <= boxTo) lineQuad(-0.06, -0.06, LINE_W);
        // Concrete apron to the garage-side barrier.
        const oa = ex.pitOuterWallD[j]! + 0.6 * sg, ob = ex.pitOuterWallD[k]! + 0.6 * sg;
        const ea = sg * pit.halfWidth[j]!, eb = sg * pit.halfWidth[k]!;
        const c0 = pv(concrete, j, ea, 0, 0), c1 = pv(concrete, j, oa, 0, 0);
        const d0 = pv(concrete, k, eb, 0, 0), d1 = pv(concrete, k, ob, 0, 0);
        if (sg === 1) concrete.quad(c1, c0, d1, d0);
        else concrete.quad(c0, c1, d0, d1);
      }
      // Limiter lines and box outlines.
      const across = (sp: number, w: number, kind: number): void => {
        const j = Math.round(sp / pitDsp);
        if (j < j0 || j >= j1) return;
        const hw = pit.halfWidth[j]!;
        const jb = Math.min(PC - 1, j + Math.max(1, Math.round(w / pitDsp)));
        const a = pv(markings, j, -hw, 0, kind), b = pv(markings, j, hw, 0, kind);
        const c2 = pv(markings, jb, -hw, 0, kind), d2 = pv(markings, jb, hw, 0, kind);
        markings.quad(b, a, d2, c2);
      };
      across(pit.limitStartSp, 0.4, 0);
      across(pit.limitEndSp, 0.4, 0);
      // Box outlines in the team's UI colour (D-001: colors.ui ?? primary), markings kind 4 = vertex colour.
      for (const box of pit.boxes) {
        const jA = Math.round((box.sp - 3) / pitDsp);
        const jB = Math.round((box.sp + 3) / pitDsp);
        if (jA < j0 || jB >= j1) continue;
        const team = TEAMS.find((t) => t.id === box.teamId);
        const col = new Color(team ? (team.colors.ui ?? team.colors.primary) : '#f2f4f7');
        markings.rgb = [col.r, col.g, col.b];
        for (let j = jA; j < jB; j++) {
          for (const dd of [box.d - 1.75, box.d + 1.55]) {
            const a = pv(markings, j, dd, 0, 4), b = pv(markings, j, dd + 0.2, 0, 4);
            const c2 = pv(markings, j + 1, dd, 0, 4), d2 = pv(markings, j + 1, dd + 0.2, 0, 4);
            markings.quad(b, a, d2, c2);
          }
        }
        across(box.sp + 3, 0.2, 4);
        markings.rgb = [1, 1, 1];
      }
      for (const [buf, mat] of [[asphalt, mats.asphalt], [markings, mats.markings], [concrete, mats.concrete]] as const) {
        if (buf.empty()) continue;
        const g = buf.geometry();
        geometries.push(g);
        triangles += buf.idx.length / 3;
        const m = new Mesh(g, mat as Material);
        m.name = `pit.${(mat as Material).name}.c${c}`;
        m.receiveShadow = true;
        m.matrixAutoUpdate = false;
        meshes.push(m);
      }
    }
  }
  return { meshes, geometries, triangles };
}
