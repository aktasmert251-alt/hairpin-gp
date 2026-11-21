// Barriers (Ç6): extruded from TrackData.walls (the exact polylines physics uses). Concrete walls with catch fence,
// triple armco on posts, tyre walls with belts, TecPro blocks, pit wall with a debris fence. Merged per 250 m cell
// and material. Bases sit on the shared ground height (track plane inside the barriers) and dip 0.3 m below it.

import { BufferAttribute, BufferGeometry, Color, Group, Mesh, type Material } from 'three';
import { envMaterial } from '../materials/shared';
import type { QualityPreset } from '../../contracts/render';
import type { WallKind } from '../../contracts/track';
import { canvasTexture } from '../mesh/textures';
import type { EnvContext, EnvPart } from './environment';

const CELL = 250;
/** Street circuits are walled on both sides all the way round: coarser cells keep the draw count in budget. */
const CELL_CITY = 400;

class MBuf {
  pos: number[] = [];
  nor: number[] = [];
  uv: number[] = [];
  col: number[] = [];
  idx: number[] = [];
  v(x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, w: number, r = 1, g = 1, b = 1): number {
    this.pos.push(x, y, z);
    this.nor.push(nx, ny, nz);
    this.uv.push(u, w);
    this.col.push(r, g, b);
    return this.pos.length / 3 - 1;
  }
  tri(a: number, b: number, c: number): void {
    this.idx.push(a, b, c);
  }
  quad(a: number, b: number, c: number, d: number): void {
    this.idx.push(a, b, c, b, d, c);
  }
  geometry(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute('normal', new BufferAttribute(new Float32Array(this.nor), 3));
    g.setAttribute('uv', new BufferAttribute(new Float32Array(this.uv), 2));
    g.setAttribute('color', new BufferAttribute(new Float32Array(this.col), 3));
    const n = this.pos.length / 3;
    g.setIndex(n > 65535 ? new BufferAttribute(new Uint32Array(this.idx), 1) : new BufferAttribute(new Uint16Array(this.idx), 1));
    g.computeBoundingSphere();
    return g;
  }
}

type MatKey = 'concrete' | 'metal' | 'tyre' | 'tecpro' | 'fence';

export function createBarriers(c: EnvContext): EnvPart & { triangles: number } {
  const { track, ex, tex } = c;
  const ground = c.ground!;
  const data = track.data;
  // City and the long desert lap: bigger merge cells (fewer draws).
  const cell = ex.authoring.THEME.backdrop === 'valley' ? 1600 : ex.authoring.THEME.backdrop === 'city' || ex.authoring.THEME.backdrop === 'desert' || ex.authoring.THEME.backdrop === 'islands' ? CELL_CITY : CELL;

  // ---- materials ---------------------------------------------------------------------------------------
  const sh = c.sh;
  const concrete = envMaterial(sh, { name: 'barrier.concrete', family: 'opaque', vertexColor: true, map: tex.concrete.map, normalMap: tex.concrete.normal, roughness: 0.92, wet: 0.8 });
  const metal = envMaterial(sh, { name: 'barrier.metal', family: 'cutout', vertexColor: true, color: 0xb4bcc4, roughness: 0.42, metalness: 0.85, wet: 0.6 });
  const tyre = envMaterial(sh, { name: 'barrier.tyre', family: 'opaque', vertexColor: true, roughness: 0.82, wet: 0.7 });
  const tecpro = envMaterial(sh, { name: 'barrier.tecpro', family: 'opaque', vertexColor: true, roughness: 0.55, wet: 0.7 });
  const fenceTex = canvasTexture(128, 128, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.strokeStyle = 'rgba(200,205,210,1)';
    g.lineWidth = 3;
    const n = 4;
    for (let k = -n; k <= 2 * n; k++) {
      g.beginPath();
      g.moveTo((k * w) / n, 0);
      g.lineTo((k * w) / n + h, h);
      g.stroke();
      g.beginPath();
      g.moveTo((k * w) / n, 0);
      g.lineTo((k * w) / n - h, h);
      g.stroke();
    }
  });
  const fence = envMaterial(sh, { name: 'barrier.fence', family: 'cutout', vertexColor: true, map: fenceTex, alphaTest: 0.35, coverage: 1, roughness: 0.5, metalness: 0.6, wet: 0.4 });
  const mats: Record<MatKey, Material> = { concrete, metal, tyre, tecpro, fence };

  const cells = new Map<string, MBuf>();
  const buf = (x: number, z: number, m: MatKey): MBuf => {
    const key = `${Math.floor(x / cell)},${Math.floor(z / cell)},${m}`;
    let b = cells.get(key);
    if (!b) {
      b = new MBuf();
      cells.set(key, b);
    }
    return b;
  };

  // Garage fronts of the pit lane are the pit building itself (no barrier mesh there).
  const skipPieces = new Set<number>();
  // Only the concrete piece along the box section (street circuits have concrete main walls in the same chain).
  const pit = data.pit;
  const nearBoxes = (x: number, z: number): boolean => {
    if (pit.boxes.length === 0) return false;
    const j0 = Math.max(0, Math.floor((pit.boxes[0]!.sp - 80) / ex.pitDsp));
    const j1 = Math.min(pit.count - 1, Math.ceil((pit.boxes[pit.boxes.length - 1]!.sp + 80) / ex.pitDsp));
    for (let j = j0; j <= j1; j += 2) if ((pit.x[j]! - x) ** 2 + (pit.z[j]! - z) ** 2 < 14 * 14) return true;
    return false;
  };
  for (const ch of ex.chains) {
    if (ch.role !== 'leftOuter') continue;
    for (const wi of ch.pieces) {
      const w = data.walls[wi]!;
      const m = 2 * Math.floor(w.xz.length / 4);
      if (w.kind === 'concrete' && nearBoxes(w.xz[m]!, w.xz[m + 1]!)) skipPieces.add(wi);
    }
  }
  const pitWallPit = new Set(ex.chains.filter((ch) => ch.role === 'pitWallPit').flatMap((ch) => ch.pieces));
  const fenceKinds = new Set<WallKind>(['concrete', 'pitwall']);
  const railing = ex.authoring.THEME.bridgeRailing === true;
  const gInfo: { s: number; d: number; covered: boolean; nearTrack: number; below?: number } = { s: 0, d: 0, covered: false, nearTrack: 0 };

  let triangles = 0;
  const white = new Color(0.72, 0.72, 0.7);
  const tmp = new Color();

  for (const w of data.walls) {
    if (skipPieces.has(w.id) || pitWallPit.has(w.id)) continue;
    const n = w.xz.length / 2;
    if (n < 2) continue;
    // Per-vertex inward normal (toward the drivable side) and base height.
    const nx = new Float64Array(n), nz = new Float64Array(n), by = new Float64Array(n), cum = new Float64Array(n);
    const onDeck = new Uint8Array(n);
    for (let k = 0; k < n; k++) {
      const a = Math.max(0, k - 1), b = Math.min(n - 1, k + 1);
      const dx = w.xz[b * 2]! - w.xz[a * 2]!;
      const dz = w.xz[b * 2 + 1]! - w.xz[a * 2 + 1]!;
      const l = Math.hypot(dx, dz) || 1;
      nx[k] = (w.drivableSide * dz) / l;
      nz[k] = (-w.drivableSide * dx) / l;
      by[k] = ground.height(w.xz[k * 2]!, w.xz[k * 2 + 1]!, gInfo) - 0.3;
      // THEME.bridgeRailing (sea bridges): on an elevated deck the concrete wall is a low parapet (top 0.5 m) with no
      // catch fence, so the sea stays in view from the cockpit; the scenery adds a slim railing.
      if (railing && Number.isFinite(gInfo.below) && w.kind === 'concrete') { onDeck[k] = 1; by[k] -= 0.6; }
      if (k > 0) cum[k] = cum[k - 1]! + Math.hypot(w.xz[k * 2]! - w.xz[k * 2 - 2]!, w.xz[k * 2 + 1]! - w.xz[k * 2 - 1]!);
    }
    const X = (k: number): number => w.xz[k * 2]!;
    const Z = (k: number): number => w.xz[k * 2 + 1]!;
    const H = w.height + 0.3;

    // Generic extrusion of a closed-top profile: points (back offset, height) from the face toward the back.
    const extrude = (m: MatKey, profile: [number, number][], colorAt: (k: number, seg: number) => Color, uScale = 1): void => {
      for (let k = 0; k + 1 < n; k++) {
        const b = buf(X(k), Z(k), m);
        const ring: number[][] = [];
        for (const kk of [k, k + 1]) {
          const row: number[] = [];
          for (let pi = 0; pi < profile.length; pi++) {
            const [back, h] = profile[pi]!;
            const pn = profile[Math.min(profile.length - 1, pi + 1)]!;
            const pp = profile[Math.max(0, pi - 1)]!;
            // Profile normal (2D in back/up), mapped to world (−n is "back").
            let tb = pn[0] - pp[0];
            let th = pn[1] - pp[1];
            const tl = Math.hypot(tb, th) || 1;
            tb /= tl;
            th /= tl;
            // Outward normal of the clockwise profile (back → +x, up → +y), mapped to world (back = −n).
            const nb = -th;
            const nh = tb;
            const col = colorAt(kk, k);
            row.push(b.v(X(kk) - nx[kk]! * back, by[kk]! + h, Z(kk) - nz[kk]! * back, -nx[kk]! * nb, nh, -nz[kk]! * nb, cum[kk]! * uScale, h + back, col.r, col.g, col.b));
          }
          ring.push(row);
        }
        for (let pi = 0; pi + 1 < profile.length; pi++) {
          // The winding follows the drivable side (walls with the track on their right run mirrored).
          if (w.drivableSide > 0) b.quad(ring[0]![pi]!, ring[0]![pi + 1]!, ring[1]![pi]!, ring[1]![pi + 1]!);
          else b.quad(ring[0]![pi + 1]!, ring[0]![pi]!, ring[1]![pi + 1]!, ring[1]![pi]!);
          triangles += 2;
        }
      }
    };
    const plain = (cc: Color) => (): Color => cc;

    if (w.kind === 'concrete' || w.kind === 'pitwall') {
      const th = w.kind === 'pitwall' ? ex.pitWallThickness : 0.6;
      const prof: [number, number][] = [[0, 0], [0, H - 0.06], [0.04, H], [th - 0.04, H], [th, H - 0.06], [th, 0]];
      const stripe = new Color(0.36, 0.36, 0.35);
      extrude('concrete', prof, (kk) => {
        // Painted base stripe / white top (vertex colour × concrete texture).
        return Math.floor(cum[kk]! / 12) % 2 === 0 ? tmp.copy(white) : tmp.copy(stripe).lerp(white, 0.6);
      });
    } else if (w.kind === 'armco') {
      // Three W-beam rails on posts (face plane at the wall line).
      const rails: [number, number][][] = [[0.38, 0.69], [0.7, 1.01]].map(([y0, y1]) => [
        [0.05, y0! + 0.3], [0.0, y0! + 0.3 + 0.08], [0.03, (y0! + y1!) / 2 + 0.3], [0.0, y1! + 0.3 - 0.08], [0.05, y1! + 0.3],
      ]);
      const gal = new Color(1, 1, 1);
      for (const r of rails) extrude('metal', r, plain(gal), 0.5);
      // Posts every 2 m (behind the rails).
      for (let k = 0; k < n; k++) {
        const b = buf(X(k), Z(k), 'metal');
        const px = X(k) - nx[k]! * 0.12, pz = Z(k) - nz[k]! * 0.12;
        const tx = -nz[k]!, tz = nx[k]!;
        const hw = 0.06, hd = 0.06;
        const corners: [number, number][] = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]];
        const base = by[k]!;
        const top = base + 1.05 + 0.3;
        for (let e = 0; e < 4; e++) {
          const [a0, b0] = corners[e]!;
          const [a1, b1] = corners[(e + 1) % 4]!;
          const ex0 = px + tx * a0 + nx[k]! * b0, ez0 = pz + tz * a0 + nz[k]! * b0;
          const ex1 = px + tx * a1 + nx[k]! * b1, ez1 = pz + tz * a1 + nz[k]! * b1;
          const fnx = (ez1 - ez0), fnz = -(ex1 - ex0);
          const fl = Math.hypot(fnx, fnz) || 1;
          const i0 = b.v(ex0, base, ez0, fnx / fl, 0, fnz / fl, 0, 0, 0.8, 0.8, 0.82);
          const i1 = b.v(ex1, base, ez1, fnx / fl, 0, fnz / fl, 1, 0, 0.8, 0.8, 0.82);
          const i2 = b.v(ex0, top, ez0, fnx / fl, 0, fnz / fl, 0, 1, 0.8, 0.8, 0.82);
          const i3 = b.v(ex1, top, ez1, fnx / fl, 0, fnz / fl, 1, 1, 0.8, 0.8, 0.82);
          b.quad(i0, i1, i2, i3);
          triangles += 2;
        }
      }
    } else if (w.kind === 'tyres') {
      // Tyre stack 1.0 m with a belt front: dark rubber, white/red belt panels every 4 m.
      const prof: [number, number][] = [[0, 0], [0, H], [1.15, H], [1.15, 0]];
      const red = new Color(0.55, 0.06, 0.06);
      const blk = new Color(0.13, 0.13, 0.14);
      extrude('tyre', prof, (kk) => (Math.floor(cum[kk]! / 4) % 2 === 0 ? tmp.copy(blk) : tmp.copy(red)));
    } else if (w.kind === 'tecpro') {
      const prof: [number, number][] = [[0, 0], [0, H - 0.05], [0.05, H], [0.85, H], [0.9, H - 0.05], [0.9, 0]];
      const blue = new Color(0.04, 0.16, 0.55);
      const red = new Color(0.6, 0.05, 0.05);
      extrude('tecpro', prof, (kk) => (Math.floor(cum[kk]! / 1.5) % 2 === 0 ? tmp.copy(blue) : tmp.copy(red)));
    }

    // Catch fence on concrete walls and the pit wall (alpha-tested, posts every 4 m).
    if (fenceKinds.has(w.kind)) {
      const top = w.kind === 'pitwall' ? 2.8 : 3.6;
      const back = w.kind === 'pitwall' ? ex.pitWallThickness * 0.5 : 0.5;
      for (let k = 0; k + 1 < n; k++) {
        if (onDeck[k] && onDeck[k + 1]) continue;
        const b = buf(X(k), Z(k), 'fence');
        const y0a = by[k]! + H, y0b = by[k + 1]! + H;
        const xa = X(k) - nx[k]! * back, za = Z(k) - nz[k]! * back;
        const xb = X(k + 1) - nx[k + 1]! * back, zb = Z(k + 1) - nz[k + 1]! * back;
        const i0 = b.v(xa, y0a, za, nx[k]!, 0, nz[k]!, cum[k]! / 0.5, 0, 0.9, 0.9, 0.9);
        const i1 = b.v(xb, y0b, zb, nx[k + 1]!, 0, nz[k + 1]!, cum[k + 1]! / 0.5, 0, 0.9, 0.9, 0.9);
        const i2 = b.v(xa, y0a + top, za, nx[k]!, 0, nz[k]!, cum[k]! / 0.5, top / 0.5, 0.9, 0.9, 0.9);
        const i3 = b.v(xb, y0b + top, zb, nx[k + 1]!, 0, nz[k + 1]!, cum[k + 1]! / 0.5, top / 0.5, 0.9, 0.9, 0.9);
        b.quad(i0, i1, i2, i3);
        triangles += 2;
      }
      // Fence posts (thin, every 4 m) in the metal material.
      for (let k = 0; k < n; k += 2) {
        if (onDeck[k]) continue;
        const b = buf(X(k), Z(k), 'metal');
        const px = X(k) - nx[k]! * back, pz = Z(k) - nz[k]! * back;
        const tx = -nz[k]!, tz = nx[k]!;
        const r = 0.05;
        const y0 = by[k]! + H, y1 = y0 + top + 0.2;
        for (const [ax, az] of [[tx, tz], [nx[k]!, nz[k]!]] as [number, number][]) {
          const i0 = b.v(px - ax * r, y0, pz - az * r, -az, 0, ax, 0, 0, 0.5, 0.5, 0.52);
          const i1 = b.v(px + ax * r, y0, pz + az * r, -az, 0, ax, 1, 0, 0.5, 0.5, 0.52);
          const i2 = b.v(px - ax * r, y1, pz - az * r, -az, 0, ax, 0, 1, 0.5, 0.5, 0.52);
          const i3 = b.v(px + ax * r, y1, pz + az * r, -az, 0, ax, 1, 1, 0.5, 0.5, 0.52);
          b.quad(i0, i1, i2, i3);
          triangles += 2;
        }
      }
    }
  }

  const group = new Group();
  group.name = 'barriers';
  const geos: BufferGeometry[] = [];
  const meshes: Mesh[] = [];
  for (const [key, b] of cells) {
    if (b.idx.length === 0) continue;
    const m = key.split(',')[2] as MatKey;
    const g = b.geometry();
    geos.push(g);
    const mesh = new Mesh(g, mats[m]);
    mesh.name = `barrier.${key}`;
    mesh.receiveShadow = true;
    mesh.castShadow = c.quality.id === 'ultra';
    mesh.matrixAutoUpdate = false;
    meshes.push(mesh);
    group.add(mesh);
  }
  return {
    root: group,
    triangles,
    setQuality(q: QualityPreset) {
      for (const m of meshes) m.castShadow = q.id === 'ultra';
    },
    dispose() {
      for (const g of geos) g.dispose();
      for (const m of Object.values(mats)) m.dispose();
      fenceTex.dispose();
      group.removeFromParent();
    },
  };
}
