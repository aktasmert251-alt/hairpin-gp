// TV director (G5, rendering.md §9.3): 8 hero spots (S/F, T1, T3, T8 ×2, T9, T12, pit) plus auto spots
// every ≈ 220 m on the outside of the local curvature. Hero spots own a car-s window (relative to the spot) and win
// while the car is inside it; otherwise the rig keeps the current auto spot until the car is 60 m past it or more
// than 160 m away, then cuts to the nearest spot ahead. Spot s values are on the OSM basis (5,351.5 m) and scaled
// to the track length. Allocation-free per frame.

import type { TrackFrame, TrackHint, TrackQuery } from '../../contracts/track';

const OSM_LENGTH = 5351.5;

export interface HeroDef {
  id: string;
  /** Spot s (OSM basis, m). */
  s: number;
  /** Lateral offset (+ left); null = outside of the local curvature at halfWidth + |dAuto|. */
  d: number | null;
  dAuto?: number;
  h: number;
  /** Eligible while deltaS(spot, car) ∈ [from, to]. */
  from: number;
  to: number;
  /** Only while the car is in the pit lane. */
  pit?: boolean;
}

export const TV_HEROES: readonly HeroDef[] = [
  // S/F and T1 windows are contiguous: the grid and the run to T1 belong to the T1 hero looking back.
  { id: 'sf', s: 5300, d: -32, h: 12, from: -260, to: -121 },
  { id: 't1', s: 250, d: -60, h: 15, from: -420, to: 60 },
  { id: 't3', s: 930, d: null, dAuto: 34, h: 11, from: -200, to: 50 },
  { id: 't8a', s: 2250, d: -50, h: 12, from: -180, to: 40 },
  { id: 't8b', s: 2392, d: -55, h: 12, from: -100, to: 120 },
  { id: 't9', s: 3230, d: null, dAuto: 32, h: 10, from: -200, to: 50 },
  { id: 't12', s: 4666, d: 40, h: 10, from: -260, to: 60 },
  { id: 'pit', s: 5150, d: 30, h: 9, from: -250, to: 150, pit: true },
];

export interface TvSpot { x: number; y: number; z: number; s: number; hero: number }

/**
 * Scene probe (the rig raycasts the live scene): `inside` = solid geometry at or above the point (stand, roof,
 * terrain); `blocked` = the segment from the camera to a target is occluded before the last 3 m.
 */
export interface TvProbe {
  inside(x: number, y: number, z: number): boolean;
  blocked(x: number, y: number, z: number, tx: number, ty: number, tz: number): boolean;
}

export interface TvDirector {
  /** `probe` validates every spot against the scene (collision-aware placement); null = unvalidated. */
  setTrack(q: TrackQuery | null, probe?: TvProbe | null): void;
  /** Updates the car's s; returns the chosen spot (or null without a track). `cut` is set when the spot changed. */
  choose(px: number, pz: number): TvSpot | null;
  readonly cut: boolean;
  /** Current spot id (hero id or `auto<k>`), for tests and screenshots. */
  spotId(): string;
  /** Force a hero by id (trailer / screenshot); null returns to automatic selection. */
  force(id: string | null): void;
  spots(): readonly TvSpot[];
  /** Last projected car s (debug). */
  carS(): number;
}

export function createTvDirector(): TvDirector {
  let track: TrackQuery | null = null;
  const list: TvSpot[] = [];
  let cur = -1;
  let forced = -1;
  let cutFlag = false;
  const hint: TrackHint = { s: 0, ribbon: 'main', sp: 0 };
  let haveS = false;
  const proj = { s: 0, d: 0 };
  const fr: TrackFrame = { s: 0, px: 0, py: 0, pz: 0, tx: 1, tz: 0, lx: 0, lz: 1, halfWidthL: 7, halfWidthR: 7, crossSlope: 0, curvature: 0, vCurvature: 0, grade: 0, sector: 0 };
  let lastX = 0, lastZ = 0;

  let probe: TvProbe | null = null;
  const tgt = { x: 0, y: 0, z: 0 };
  const trackPoint = (s: number): typeof tgt => {
    const q = track!;
    q.frameAt(q.wrapS(s), fr);
    tgt.x = fr.px;
    tgt.y = fr.py + 0.8;
    tgt.z = fr.pz;
    return tgt;
  };
  const SETBACK = [0, 8, 16, 28];
  const RAISE = [0, 6, 12];

  /**
   * Collision-aware placement: preferred side first, then the other; behind the barrier (wall + 4 m) with growing
   * setback and height until the probe says the camera is in free air and sees the track at s, s − 60 and s + 30.
   */
  const spotAt = (s: number, d: number | null, dAuto: number, h: number, hero: number): TvSpot => {
    const q = track!;
    const ss = q.wrapS(s);
    q.frameAt(ss, fr);
    const i = Math.min(q.data.count - 1, Math.max(0, Math.round(ss / q.data.ds)));
    const pref = d !== null ? Math.sign(d) || 1 : fr.curvature < 0 ? 1 : -1;
    const first = d !== null ? Math.abs(d) : 0;
    for (let k = 0; k < 2; k++) {
      const side = k === 0 ? pref : -pref;
      const hw = side > 0 ? fr.halfWidthL : fr.halfWidthR;
      const wallRaw = side > 0 ? q.data.wallL[i]! : q.data.wallR[i]!;
      const wall = Number.isFinite(wallRaw) && wallRaw > 0 && wallRaw < 200 ? wallRaw : hw + 10;
      const base = Math.max(first, hw + dAuto * 0.5, wall + 4);
      for (let a = 0; a < SETBACK.length; a++) {
        const dd = side * (base + SETBACK[a]!);
        q.frameAt(ss, fr);
        const x = fr.px + fr.lx * dd, z = fr.pz + fr.lz * dd;
        for (let b = 0; b < RAISE.length; b++) {
          const y = fr.py + h + RAISE[b]!;
          if (probe) {
            if (probe.inside(x, y, z)) continue;
            let t = trackPoint(ss);
            if (probe.blocked(x, y, z, t.x, t.y, t.z)) continue;
            t = trackPoint(ss - 60);
            if (probe.blocked(x, y, z, t.x, t.y, t.z)) continue;
            t = trackPoint(ss + 30);
            if (probe.blocked(x, y, z, t.x, t.y, t.z)) continue;
          }
          return { x, y, z, s: ss, hero };
        }
      }
    }
    // Nothing passed: high above the preferred side's barrier.
    q.frameAt(ss, fr);
    const hw = pref > 0 ? fr.halfWidthL : fr.halfWidthR;
    const dd = pref * (Math.max(first, hw + 12));
    return { x: fr.px + fr.lx * dd, y: fr.py + h + 25, z: fr.pz + fr.lz * dd, s: ss, hero };
  };

  const globalS = (x: number, z: number): number => {
    const dt = track!.data;
    let best = Infinity, bi = 0;
    for (let i = 0; i < dt.count; i += 4) {
      const dx = dt.x[i]! - x, dz = dt.z[i]! - z;
      const d2 = dx * dx + dz * dz;
      if (d2 < best) {
        best = d2;
        bi = i;
      }
    }
    return bi * dt.ds;
  };

  return {
    get cut() {
      return cutFlag;
    },
    setTrack(q, pr = null) {
      track = q;
      probe = pr;
      list.length = 0;
      cur = -1;
      haveS = false;
      if (!q) return;
      const k = q.length / OSM_LENGTH;
      for (let i = 0; i < TV_HEROES.length; i++) {
        const h = TV_HEROES[i]!;
        list.push(spotAt(h.s * k, h.d, h.dAuto ?? 30, h.h, i));
      }
      // Auto spots, skipping those within 110 m of a hero.
      const n = Math.max(1, Math.round(q.length / 220));
      for (let j = 0; j < n; j++) {
        const s = (j * q.length) / n;
        let near = false;
        for (let i = 0; i < TV_HEROES.length; i++) if (Math.abs(q.deltaS(s, TV_HEROES[i]!.s * k)) < 110) near = true;
        if (!near) list.push(spotAt(s, null, 30, 9, -1));
      }
    },
    choose(px, pz) {
      cutFlag = false;
      if (!track || list.length === 0) return null;
      const q = track;
      // Car s: local projection with a hint; global coarse search on first use or after a teleport.
      const jump = (px - lastX) * (px - lastX) + (pz - lastZ) * (pz - lastZ) > 60 * 60;
      if (!haveS || jump) {
        hint.s = globalS(px, pz);
        hint.ribbon = 'main';
        haveS = true;
      }
      lastX = px;
      lastZ = pz;
      q.project(px, pz, hint, proj);
      hint.s = proj.s;
      const carS = proj.s;
      q.frameAt(carS, fr);
      const inPit = proj.d > fr.halfWidthL + 4;
      const k = q.length / OSM_LENGTH;
      let want = -1;
      if (forced >= 0) want = forced;
      else {
        for (let i = 0; i < TV_HEROES.length; i++) {
          const h = TV_HEROES[i]!;
          if (h.pit && !inPit) continue;
          const rel = q.deltaS(h.s * k, carS);
          if (rel >= h.from && rel <= h.to) {
            want = i;
            break;
          }
        }
        if (want < 0) {
          // Keep the current auto spot while valid; else the nearest auto spot ahead.
          if (cur >= TV_HEROES.length) {
            const sp = list[cur]!;
            const rel = q.deltaS(sp.s, carS);
            const dist = Math.hypot(sp.x - px, sp.z - pz);
            if (rel <= 60 && dist <= 160) want = cur;
          }
          if (want < 0) {
            let best = Infinity;
            for (let i = TV_HEROES.length; i < list.length; i++) {
              const ahead = q.deltaS(carS, list[i]!.s);
              if (ahead >= 10 && ahead < best) {
                best = ahead;
                want = i;
              }
            }
          }
        }
      }
      if (want !== cur) {
        cur = want;
        cutFlag = true;
      }
      return cur >= 0 ? list[cur]! : null;
    },
    spotId() {
      if (cur < 0) return 'none';
      return cur < TV_HEROES.length ? TV_HEROES[cur]!.id : `auto${cur - TV_HEROES.length}`;
    },
    force(id) {
      forced = id === null ? -1 : TV_HEROES.findIndex((h) => h.id === id);
    },
    spots: () => list,
    carS: () => hint.s,
  };
}
