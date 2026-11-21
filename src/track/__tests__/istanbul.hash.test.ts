// G1 regression gate (tracks.md §4): the İstanbul TrackData (and the extras the scenery reads) must hash identically
// before and after the pipeline generalisation. The pinned value was recorded on the pre-G1 build (2026-10-11).
import { describe, expect, it } from 'vitest';
import { buildTrackDataFull } from '../build/buildTrackData';
import { hashArrays } from '../build/geometry';
import { ISTANBUL } from '../authoring/istanbul';
import { ISTANBUL_RAW } from '../data/raw';

const PINNED = 'b202b714';

describe('İstanbul build hash (G1 gate)', () => {
  it('TrackData arrays, walls, pit, grid, timing and extras are unchanged', () => {
    const { data: d, extras: e } = buildTrackDataFull(ISTANBUL_RAW, ISTANBUL);
    const enc = new TextEncoder();
    const meta = enc.encode(JSON.stringify({
      id: d.id, length: d.length, sectors: d.sectors, timing: d.timingLines, drs: d.drsZones, corners: d.corners,
      cuts: d.cutZones, grid: d.grid, boxes: d.pit.boxes, pitMeta: [d.pit.length, d.pit.mainSAtSplit, d.pit.mainSAtMerge, d.pit.fastLaneD, d.pit.workingLaneD],
      walls: d.walls.map((w) => [w.kind, w.height, w.drivableSide]), chains: e.chains, paint: e.paint, puddles: e.puddles,
      pitRange: e.pitRange, boxMainS: e.boxMainS, kinds: [e.wallKindL.join(''), e.wallKindR.join('')],
    }));
    const h = hashArrays([
      d.x, d.y, d.z, d.tx, d.tz, d.curvature, d.vCurvature, d.grade, d.crossSlope, d.halfWidthL, d.halfWidthR,
      d.bandTypeL, d.bandOuterL, d.bandTypeR, d.bandOuterR, d.wallL, d.wallR, d.pit.x, d.pit.y, d.pit.z, d.pit.tx, d.pit.tz,
      d.pit.halfWidth, ...d.walls.map((w) => w.xz), e.lineD, e.pitMainS, e.pitMainD, e.mainPitSp, e.pitWallD, e.pitOuterWallD,
      e.kerbL, e.kerbR, meta,
    ]);
    console.log(`istanbul hash ${h}`);
    expect(h).toBe(PINNED);
  });
});
