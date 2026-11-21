// Infinite flat asphalt plane TrackQuery for skidpad/bench tests: s = x, d = −z (left of +X), no walls,
// every point in limits. Sim-safe, allocation-free queries.

import type { Vec3 } from '../../../contracts/common';
import type { GroundHit, TrackBundle, TrackData, TrackFrame, TrackHint, TrackQuery, WallHit } from '../../../contracts/track';
import { SURFACE_PROPS_TABLE } from './surfaces';

export function createFlatPlane(length = 1_000_000): TrackBundle {
  const one = (v: number): Float32Array => new Float32Array([v]);
  const e = new Float32Array(0);
  const data: TrackData = {
    id: 'straight', name: { tr: 'Düz zemin', en: 'Flat plane' }, length, ds: 1, count: 1,
    x: one(0), y: one(0), z: one(0), tx: one(1), tz: one(0), curvature: one(0), vCurvature: one(0), grade: one(0), crossSlope: one(0),
    halfWidthL: one(500), halfWidthR: one(500),
    bandTypeL: new Uint8Array(4), bandOuterL: new Float32Array(4), bandTypeR: new Uint8Array(4), bandOuterR: new Float32Array(4),
    wallL: one(0), wallR: one(0), sectors: [length / 3, (2 * length) / 3], timingLines: [], drsZones: [], corners: [], cutZones: [], grid: [],
    pit: {
      length: 0, count: 0, x: e, y: e, z: e, tx: e, tz: e, halfWidth: e, mainSAtSplit: -1, mainSAtMerge: -1, limitStartSp: 0, limitEndSp: 0,
      speedLimitKmh: 80, fastLaneD: 0, workingLaneD: 0, boxes: [],
    },
    walls: [], startGantryS: 0, attribution: [],
  };
  const wrapS = (s: number): number => {
    const r = s % length;
    return r < 0 ? r + length : r;
  };
  const query: TrackQuery = {
    data,
    length,
    frameAt(s: number, out: TrackFrame) {
      out.s = s; out.px = s; out.py = 0; out.pz = 0; out.tx = 1; out.tz = 0; out.lx = 0; out.lz = -1;
      out.halfWidthL = 500; out.halfWidthR = 500; out.crossSlope = 0; out.curvature = 0; out.vCurvature = 0; out.grade = 0; out.sector = 0;
      return out;
    },
    worldFromSD(s: number, d: number, out: Vec3) {
      out.x = s; out.y = 0; out.z = -d;
      return out;
    },
    pitWorldFromSD(sp: number, d: number, out: Vec3) {
      out.x = sp; out.y = 0; out.z = -d;
      return out;
    },
    project(x: number, z: number, _h: TrackHint, out: { s: number; d: number }) {
      out.s = x; out.d = -z;
    },
    ground(x: number, z: number, hint: TrackHint, out: GroundHit) {
      out.y = 0; out.nx = 0; out.ny = 1; out.nz = 0; out.surface = 'asphalt'; out.ribbon = 'main';
      out.s = x; out.d = -z; out.sp = NaN; out.inLimits = true; out.wetLocal = 1;
      hint.s = x;
      return out;
    },
    wallsNear(_x: number, _z: number, _r: number, _out: WallHit[], _max: number) {
      return 0;
    },
    surfaceProps: (t) => SURFACE_PROPS_TABLE[t],
    wrapS,
    deltaS(from: number, to: number) {
      const d = wrapS(to - from);
      return d > length / 2 ? d - length : d;
    },
    sectorAt: () => 0,
  };
  return { data, query };
}
