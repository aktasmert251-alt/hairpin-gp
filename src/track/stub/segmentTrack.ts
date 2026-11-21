// STUB (Sprint 0, Yönetici): replaced by Çevre in Sprint 1
// Analytic track made of straights and circular arcs, with an exact TrackQuery (round-trip error ~1e-12 m).
// Flat (y = 0), constant half-width, walls at a constant lateral offset. Used by the placeholder oval and
// by the straight physics test track. Sim layer: no three, no DOM, query calls allocate nothing.

import type { SurfaceType, Vec3 } from '../../contracts/common';
import type { GroundHit, PitLaneData, TrackBundle, TrackData, TrackFrame, TrackHint, TrackId, TrackQuery, WallHit } from '../../contracts/track';
import { SURFACE_CODE, SURFACE_PROPS } from '../query/surfaces';

const TWO_PI = Math.PI * 2;

export type SegDef = { kind: 'straight'; len: number } | { kind: 'arc'; radius: number; angle: number; dir: 1 | -1 };

interface Seg {
  arc: boolean;
  s0: number;
  len: number;
  x0: number; z0: number; x1: number; z1: number;
  yaw0: number;
  fx: number; fz: number; lx: number; lz: number;
  r: number; dir: number; cx: number; cz: number; sweep: number;
}

export interface SegmentTrackDef {
  id: TrackId;
  name: { tr: string; en: string };
  segments: readonly SegDef[];
  /** Closed loop (oval) or open line (straight test track: s extrapolates beyond both ends). */
  closed: boolean;
  halfWidth: number;
  lineWidth: number;
  /** Lateral distance from the centreline to both barrier faces. */
  wallOffset: number;
  sectors: [number, number];
  timingLines: TrackData['timingLines'];
  drsZones: TrackData['drsZones'];
  corners: TrackData['corners'];
  grid: TrackData['grid'];
  startGantryS: number;
}

/** A track without a pit lane (documented in PitLaneData): empty arrays, no boxes, split/merge = -1. */
export function emptyPitLane(): PitLaneData {
  const e = new Float32Array(0);
  return {
    length: 0, count: 0, x: e, y: e, z: e, tx: e, tz: e, halfWidth: e,
    mainSAtSplit: -1, mainSAtMerge: -1, limitStartSp: 0, limitEndSp: 0, speedLimitKmh: 80,
    fastLaneD: 0, workingLaneD: 0, boxes: [],
  };
}

function buildSegs(defs: readonly SegDef[]): { segs: Seg[]; length: number } {
  let x = 0;
  let z = 0;
  let yaw = 0;
  let s = 0;
  const segs: Seg[] = [];
  for (const d of defs) {
    const fx = Math.cos(yaw);
    const fz = -Math.sin(yaw);
    const lx = -Math.sin(yaw);
    const lz = -Math.cos(yaw);
    if (d.kind === 'straight') {
      const x1 = x + fx * d.len;
      const z1 = z + fz * d.len;
      segs.push({ arc: false, s0: s, len: d.len, x0: x, z0: z, x1, z1, yaw0: yaw, fx, fz, lx, lz, r: 0, dir: 0, cx: 0, cz: 0, sweep: 0 });
      x = x1;
      z = z1;
      s += d.len;
    } else {
      const cx = x + d.dir * d.radius * lx;
      const cz = z + d.dir * d.radius * lz;
      const len = d.radius * d.angle;
      const yaw1 = yaw + d.dir * d.angle;
      const x1 = cx + d.dir * d.radius * Math.sin(yaw1);
      const z1 = cz + d.dir * d.radius * Math.cos(yaw1);
      segs.push({ arc: true, s0: s, len, x0: x, z0: z, x1, z1, yaw0: yaw, fx, fz, lx, lz, r: d.radius, dir: d.dir, cx, cz, sweep: d.angle });
      x = x1;
      z = z1;
      yaw = yaw1;
      s += len;
    }
  }
  return { segs, length: s };
}

export function buildSegmentTrack(def: SegmentTrackDef): TrackBundle {
  const { segs, length: rawLength } = buildSegs(def.segments);
  // Snap tiny float drift so an integral design length stays integral (ds = 1).
  const length = Math.abs(rawLength - Math.round(rawLength)) < 1e-6 ? Math.round(rawLength) : rawLength;
  const closed = def.closed;
  const hw = def.halfWidth;
  const asphaltEdge = hw - def.lineWidth;
  const wall = def.wallOffset;
  const [s2, s3] = def.sectors;
  const last = segs.length - 1;

  const wrapS = (s: number): number => {
    const r = s % length;
    return r < 0 ? r + length : r;
  };

  const segAt = (s: number): Seg => {
    for (let i = last; i > 0; i--) if (s >= segs[i]!.s0) return segs[i]!;
    return segs[0]!;
  };

  const sectorAt = (s: number): 0 | 1 | 2 => {
    const w = wrapS(s);
    return w < s2 ? 0 : w < s3 ? 1 : 2;
  };

  const frameAt = (s: number, out: TrackFrame): TrackFrame => {
    const sw = closed ? wrapS(s) : s;
    const g = segAt(sw);
    const u = sw - g.s0;
    let yaw: number;
    let x: number;
    let z: number;
    let k: number;
    if (!g.arc) {
      yaw = g.yaw0;
      x = g.x0 + g.fx * u;
      z = g.z0 + g.fz * u;
      k = 0;
    } else {
      yaw = g.yaw0 + (g.dir * u) / g.r;
      x = g.cx + g.dir * g.r * Math.sin(yaw);
      z = g.cz + g.dir * g.r * Math.cos(yaw);
      k = g.dir / g.r;
    }
    out.s = sw;
    out.px = x;
    out.py = 0;
    out.pz = z;
    out.tx = Math.cos(yaw);
    out.tz = -Math.sin(yaw);
    out.lx = -Math.sin(yaw);
    out.lz = -Math.cos(yaw);
    out.halfWidthL = hw;
    out.halfWidthR = hw;
    out.crossSlope = 0;
    out.curvature = k;
    out.vCurvature = 0;
    out.grade = 0;
    out.sector = sectorAt(sw);
    return out;
  };

  const scratchFrame: TrackFrame = {
    s: 0, px: 0, py: 0, pz: 0, tx: 1, tz: 0, lx: 0, lz: -1, halfWidthL: hw, halfWidthR: hw,
    crossSlope: 0, curvature: 0, vCurvature: 0, grade: 0, sector: 0,
  };
  const scratchSD = { s: 0, d: 0 };
  const scratchHint: TrackHint = { s: 0, ribbon: 'main', sp: NaN };

  const worldFromSD =(s: number, d: number, out: Vec3): Vec3 => {
    const f = frameAt(s, scratchFrame);
    out.x = f.px + f.lx * d;
    out.y = f.py + f.crossSlope * d;
    out.z = f.pz + f.lz * d;
    return out;
  };

  const project = (x: number, z: number, _hint: TrackHint, out: { s: number; d: number }): void => {
    // The stub has at most a handful of segments, so a global search is both exact and cheap.
    let bestErr = Infinity;
    let bestS = 0;
    let bestD = 0;
    for (let i = 0; i <= last; i++) {
      const g = segs[i]!;
      let u: number;
      let d: number;
      let err: number;
      if (!g.arc) {
        const dx = x - g.x0;
        const dz = z - g.z0;
        u = dx * g.fx + dz * g.fz;
        d = dx * g.lx + dz * g.lz;
        const extendBack = !closed && i === 0;
        const extendFwd = !closed && i === last;
        if (u < 0 && !extendBack) {
          err = Math.sqrt(u * u + d * d);
          u = 0;
        } else if (u > g.len && !extendFwd) {
          const e = u - g.len;
          err = Math.sqrt(e * e + d * d);
          u = g.len;
        } else err = d < 0 ? -d : d;
      } else {
        const vx = x - g.cx;
        const vz = z - g.cz;
        const dist = Math.sqrt(vx * vx + vz * vz);
        const yaw = Math.atan2(g.dir * vx, g.dir * vz);
        let delta = g.dir * (yaw - g.yaw0);
        delta -= Math.floor(delta / TWO_PI) * TWO_PI;
        d = g.dir * (g.r - dist);
        if (delta <= g.sweep) {
          u = delta * g.r;
          err = d < 0 ? -d : d;
        } else if (delta - g.sweep < TWO_PI - delta) {
          u = g.len;
          err = Math.hypot(x - g.x1, z - g.z1);
        } else {
          u = 0;
          err = Math.hypot(x - g.x0, z - g.z0);
        }
      }
      if (err < bestErr) {
        bestErr = err;
        bestS = g.s0 + u;
        bestD = d;
      }
    }
    out.s = closed ? wrapS(bestS) : bestS;
    out.d = bestD;
  };

  const ground = (x: number, z: number, hint: TrackHint, out: GroundHit): GroundHit => {
    project(x, z, hint, scratchSD);
    const d = scratchSD.d;
    const ad = d < 0 ? -d : d;
    const surface: SurfaceType = ad <= asphaltEdge ? 'asphalt' : ad <= hw ? 'line' : 'grass';
    out.y = 0;
    out.nx = 0;
    out.ny = 1;
    out.nz = 0;
    out.surface = surface;
    out.ribbon = 'main';
    out.s = scratchSD.s;
    out.d = d;
    out.sp = NaN;
    out.inLimits = ad <= hw;
    out.wetLocal = 1;
    hint.s = scratchSD.s;
    hint.ribbon = 'main';
    hint.sp = NaN;
    return out;
  };

  const wallsNear = (x: number, z: number, radius: number, out: WallHit[], max: number): number => {
    project(x, z, scratchHint, scratchSD);
    const f = frameAt(scratchSD.s, scratchFrame);
    const d = scratchSD.d;
    let n = 0;
    const distL = wall - d;
    if (distL < radius && n < max) {
      const h = out[n] ?? (out[n] = { nx: 0, nz: 0, px: 0, pz: 0, dist: 0, wallId: 0, kind: 'concrete' });
      h.nx = -f.lx;
      h.nz = -f.lz;
      h.px = f.px + f.lx * wall;
      h.pz = f.pz + f.lz * wall;
      h.dist = distL;
      h.wallId = 0;
      h.kind = 'concrete';
      n++;
    }
    const distR = d + wall;
    if (distR < radius && n < max) {
      const h = out[n] ?? (out[n] = { nx: 0, nz: 0, px: 0, pz: 0, dist: 0, wallId: 1, kind: 'concrete' });
      h.nx = f.lx;
      h.nz = f.lz;
      h.px = f.px - f.lx * wall;
      h.pz = f.pz - f.lz * wall;
      h.dist = distR;
      h.wallId = 1;
      h.kind = 'concrete';
      n++;
    }
    return n;
  };

  // ---- Baked TrackData arrays (1 m samples) ---------------------------------------------------
  const count = Math.max(2, closed ? Math.round(length) : Math.round(length) + 1);
  const f32 = (): Float32Array => new Float32Array(count);
  const data: TrackData = {
    id: def.id,
    name: def.name,
    length,
    ds: 1,
    count,
    x: f32(), y: f32(), z: f32(), tx: f32(), tz: f32(),
    curvature: f32(), vCurvature: f32(), grade: f32(), crossSlope: f32(),
    halfWidthL: f32(), halfWidthR: f32(),
    bandTypeL: new Uint8Array(count * 4), bandOuterL: new Float32Array(count * 4),
    bandTypeR: new Uint8Array(count * 4), bandOuterR: new Float32Array(count * 4),
    wallL: f32(), wallR: f32(),
    sectors: [s2, s3],
    timingLines: def.timingLines,
    drsZones: def.drsZones,
    corners: def.corners,
    cutZones: [],
    grid: def.grid,
    pit: emptyPitLane(),
    walls: [],
    startGantryS: def.startGantryS,
    attribution: [],
  };
  const fr: TrackFrame = { ...scratchFrame };
  const grass = SURFACE_CODE.grass;
  for (let i = 0; i < count; i++) {
    frameAt(i, fr);
    data.x[i] = fr.px;
    data.y[i] = fr.py;
    data.z[i] = fr.pz;
    data.tx[i] = fr.tx;
    data.tz[i] = fr.tz;
    data.curvature[i] = fr.curvature;
    data.halfWidthL[i] = hw;
    data.halfWidthR[i] = hw;
    data.wallL[i] = wall;
    data.wallR[i] = wall;
    for (let b = 0; b < 4; b++) {
      data.bandTypeL[i * 4 + b] = grass;
      data.bandTypeR[i * 4 + b] = grass;
      data.bandOuterL[i * 4 + b] = wall;
      data.bandOuterR[i * 4 + b] = wall;
    }
  }
  const p: Vec3 = { x: 0, y: 0, z: 0 };
  for (const side of [1, -1] as const) {
    const xz = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
      worldFromSD(i, side * wall, p);
      xz[i * 2] = p.x;
      xz[i * 2 + 1] = p.z;
    }
    data.walls.push({ id: side === 1 ? 0 : 1, kind: 'concrete', height: 1, xz, drivableSide: side === 1 ? -1 : 1 });
  }

  const query: TrackQuery = {
    data,
    length,
    frameAt,
    worldFromSD,
    // No pit lane on the stub tracks: pit coordinates map onto the main ribbon (sp = s).
    pitWorldFromSD: (sp, d, out) => worldFromSD(sp, d, out),
    project,
    ground,
    wallsNear,
    surfaceProps: (t) => SURFACE_PROPS[t],
    wrapS,
    deltaS(from, to) {
      const d = wrapS(to - from);
      return d > length / 2 ? d - length : d;
    },
    sectorAt,
  };
  return { data, query };
}
