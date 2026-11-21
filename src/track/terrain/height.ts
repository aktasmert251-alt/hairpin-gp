// Ground height for presentation (terrain mesh, scenery placement, barrier bases): the track plane inside the barriers
// (exactly what TrackQuery.worldFromSD gives), the pit lane / paddock flat at pit height, and EU-DEM beyond, blended
// with smoothstep over 45 m (report §7.10).

import type { Vec3 } from '../../contracts/common';
import type { TrackBundle, TrackHint } from '../../contracts/track';
import type { TrackExtras } from '../build/extras';

export interface GroundHeight {
  /** Ground y at (x, z). `info` (optional) receives the nearest main s, d and whether the point is under track meshes. */
  height(x: number, z: number, info?: GroundInfo): number;
  dem(x: number, z: number): number;
}

export interface GroundInfo {
  s: number; d: number; covered: boolean; nearTrack: number;
  /** Under an elevated deck (DECKS): the natural ground below the deck (the terrain mesh uses it); NaN elsewhere. */
  below?: number;
}

const smooth = (e0: number, e1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

export function createGroundHeight(track: TrackBundle, ex: TrackExtras): GroundHeight {
  const { data, query: q } = track;
  const N = data.count;
  const t = ex.terrain;
  const reg = ex.reg;
  const dem = (x: number, z: number): number => {
    if (!t) return 0;
    // World → raw coordinates (inverse registration), then bilinear in the grid.
    const rx = x / reg.k + reg.cx;
    const rz = z / reg.k + reg.cz;
    let u = (rx - t.x0) / t.step;
    let v = (rz - t.z0) / t.step;
    u = Math.min(t.nx - 1.001, Math.max(0, u));
    v = Math.min(t.nz - 1.001, Math.max(0, v));
    const i = Math.floor(u);
    const j = Math.floor(v);
    const fu = u - i;
    const fv = v - j;
    const y = t.y;
    const a = y[j * t.nx + i]!, b = y[j * t.nx + i + 1]!, c = y[(j + 1) * t.nx + i]!, d = y[(j + 1) * t.nx + i + 1]!;
    return (a * (1 - fu) + b * fu) * (1 - fv) + (c * (1 - fu) + d * fu) * fv;
  };

  // Coarse grid of centreline samples (every 2 m) for nearest-section lookup.
  const CELL = 40;
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < N; i++) {
    minX = Math.min(minX, data.x[i]!); maxX = Math.max(maxX, data.x[i]!);
    minZ = Math.min(minZ, data.z[i]!); maxZ = Math.max(maxZ, data.z[i]!);
  }
  minX -= 400; minZ -= 400; maxX += 400; maxZ += 400;
  const GW = Math.ceil((maxX - minX) / CELL) + 1;
  const GH = Math.ceil((maxZ - minZ) / CELL) + 1;
  const cells: number[][] = Array.from({ length: GW * GH }, () => []);
  for (let i = 0; i < N; i += 2) cells[Math.floor((data.x[i]! - minX) / CELL) + Math.floor((data.z[i]! - minZ) / CELL) * GW]!.push(i);
  const pitCells: number[][] = Array.from({ length: GW * GH }, () => []);
  for (let j = 0; j < data.pit.count; j += 2) pitCells[Math.floor((data.pit.x[j]! - minX) / CELL) + Math.floor((data.pit.z[j]! - minZ) / CELL) * GW]!.push(j);

  const nearest = (x: number, z: number, cl: number[][], X: Float32Array, Z: Float32Array): number => {
    const cx = Math.floor((x - minX) / CELL);
    const cz = Math.floor((z - minZ) / CELL);
    let best = Infinity;
    let bi = -1;
    for (let r = 0; r <= 4 && (bi < 0 || r <= 1 + Math.ceil(Math.sqrt(best) / CELL)); r++) {
      for (let oz = -r; oz <= r; oz++) for (let ox = -r; ox <= r; ox++) {
        if (Math.max(Math.abs(ox), Math.abs(oz)) !== r) continue;
        const gx = cx + ox, gz = cz + oz;
        if (gx < 0 || gz < 0 || gx >= GW || gz >= GH) continue;
        for (const i of cl[gx + gz * GW]!) {
          const dx = X[i]! - x, dz = Z[i]! - z;
          const d2 = dx * dx + dz * dz;
          if (d2 < best) { best = d2; bi = i; }
        }
      }
    }
    return bi;
  };

  const hint: TrackHint = { s: 0, ribbon: 'main', sp: NaN };
  const sd = { s: 0, d: 0 };
  const p: Vec3 = { x: 0, y: 0, z: 0 };
  const pitDsp = ex.pitDsp;

  // Authored shore (Bosphorus): crisp seawall at v = seawallV for |u| ≤ seawallU (the 100 m DEM grid cannot hold it).
  const loc = ex.local;
  const sb = loc ? Math.sin((loc.beta * Math.PI) / 180) : 0, cb = loc ? Math.cos((loc.beta * Math.PI) / 180) : 0;
  const shore = (x: number, z: number, y: number): number => {
    if (!loc) return y;
    const dE = x / reg.k + reg.cx - loc.anchor[0], dN = -(z / reg.k + reg.cz - loc.anchor[1]);
    const u = dE * sb + dN * cb, v = -dE * cb + dN * sb;
    if (Math.abs(u) > loc.seawallU || v < loc.seawallV - 300) return y;
    return v >= loc.seawallV ? Math.max(y, 0.15) : Math.min(y, -6);
  };

  // Elevated decks (Desert Cliff ramp), built s: the natural ground stays under them (no embankment); height() still
  // returns the deck surface inside the barriers (barrier bases, kerbs), the terrain mesh takes `info.below`.
  const decks = (ex.authoring.DECKS ?? []).map((dk) => [dk.from * ex.sScale, dk.to * ex.sScale] as const);
  const onDeck = (s: number): boolean => decks.some(([a, b]) => s >= a && s <= b);

  const height = (x: number, z: number, info?: GroundInfo): number => {
    const demY = shore(x, z, dem(x, z));
    let below = NaN;
    const i = nearest(x, z, cells, data.x, data.z);
    let y = demY;
    let covered = false;
    let near = 0;
    let s = 0, d = 1e9;
    let mainClear = Infinity; // metres beyond the main track's barrier line (negative inside it)
    if (i >= 0) {
      hint.s = i;
      q.project(x, z, hint, sd);
      s = sd.s;
      d = sd.d;
      const k = Math.round(s) % N;
      const edge = d >= 0 ? Math.max(data.halfWidthL[k]!, data.wallL[k]!) : Math.max(data.halfWidthR[k]!, data.wallR[k]!);
      const ad = Math.abs(d);
      const yPlane = q.worldFromSD(s, d, p).y;
      // Reject projections that ended at the search window edge (far from this section).
      const fx = p.x - x, fz = p.z - z;
      if (fx * fx + fz * fz < 4) {
        covered = ad <= edge + 0.8;
        mainClear = ad - edge;
        // Fall zones: the terrain drops right at the lip (no 45 m blend onto the road plane).
        const fall = ex.falls.some((fz) => s >= fz.from - 15 && s <= fz.to + 15 && fz.side * d > 0);
        const w = fall ? smooth(edge + 0.5, edge + 4, ad) : smooth(edge + 1, edge + 46, ad);
        y = yPlane + (demY - yPlane) * w;
        // Steeply banked sections (the Eifel bowl, > 3.4°): the 10 m terrain grid cannot follow the curved, tilted surface,
        // so the ground under it drops further (no grass through the concrete). Tracks banked ≤ 3° are unaffected.
        const cs = Math.abs(data.crossSlope[k]!);
        if (covered && cs > 0.06) y -= (cs - 0.06) * 16;
        near = 1 - smooth(edge, edge + 60, ad);
        if (decks.length && onDeck(s)) {
          // Deck height above the natural ground decides how much of the embankment disappears.
          const k = smooth(1.5, 4, yPlane - demY);
          if (k > 0) {
            if (covered) below = yPlane + (demY - yPlane) * k;
            else y = y + (demY - y) * k;
          }
        }
      }
    }
    // Pit lane, garages and paddock: flat at pit height (paddock ≈ 110 m deep behind the garages).
    if (data.pit.count > 1) {
      const j = nearest(x, z, pitCells, data.pit.x, data.pit.z);
      if (j >= 0) {
        const tx = data.pit.tx[j]!, tz = data.pit.tz[j]!;
        const vx = x - data.pit.x[j]!, vz = z - data.pit.z[j]!;
        const along = vx * tx + vz * tz;
        const dp = ex.pitSide * (vx * tz - vz * tx); // toward the garages
        const sp = j * pitDsp + along;
        if (Math.abs(along) < 3 && sp > 0 && sp < data.pit.length) {
          const py = data.pit.y[j]!;
          const hw = data.pit.halfWidth[j]!;
          const box = ex.pitSide * ex.pitOuterWallD[j]!;
          const paddock = sp > data.pit.limitStartSp && sp < data.pit.limitEndSp + 40 ? 115 : 20;
          if (dp >= -hw - 0.5 && dp <= box + 0.6) {
            y = py;
            covered = true;
            near = 1;
          } else if (dp > box && dp < box + paddock + 40) {
            // The main track wins: where it runs behind the paddock (Ardennes: the descent after T1) the flat pit-height
            // pad fades out over 4..30 m beyond its barrier line instead of burying the road under a grass bank.
            // (Only for a different section of the main track, not the straight beside the pit lane.)
            const other = Math.abs(q.deltaS(s, ex.pitMainS[j]!)) > 80;
            const keep = other ? smooth(4, 30, mainClear) : 1;
            const w = 1 - (1 - smooth(box + paddock, box + paddock + 40, dp)) * keep;
            y = py + (y - py) * w;
            near = Math.max(near, 1 - w);
            // Garages + paddock slab (pitBuilding.ts) cover the first 118 m behind the garage line.
            if (paddock > 100 && dp < box + 118 && keep > 0.99) covered = true;
          } else if (dp < -hw - 0.5) {
            // Away from the garages (the entry / exit roads, the gap to the main track): ease the terrain onto the lane
            // over 1..30 m like the main track's verge blend. Without it the 10 m terrain grid bridged a bank straight
            // across the narrow exit road (İstanbul pit exit beside a main track ≈ 1 m higher, Ardennes exit hairpin:
            // grass up to 1.2 m over the concrete). Higher ground is always lowered (the main road and its bands sit on
            // their own meshes above it); lower ground is only lifted away from the main track.
            const yPit = py + (y - py) * smooth(1, 30, -dp - hw);
            y = y > yPit ? yPit : y + (yPit - y) * smooth(2, 12, mainClear);
            near = Math.max(near, 1 - smooth(1, 30, -dp - hw));
          }
        }
      }
    }
    if (info) {
      info.s = s;
      info.d = d;
      info.covered = covered;
      info.nearTrack = near;
      info.below = below;
    }
    return y;
  };
  return { height, dem };
}
