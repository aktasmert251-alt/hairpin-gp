// Grandstands + crowd (Ç7, report §7.9/§7.11). Stands come from the OSM footprints (main grandstand, 14 bleachers,
// the roofed T1 hospitality): oriented rectangle, front toward the nearest track point, stepped seating rows with
// coloured seats, end caps, roof on the main grandstand. Crowd: one InstancedMesh of billboard quads with a canvas
// atlas of 16 silhouettes, tinted per instance, vertex bob in the shader; density = QualityPreset.crowdDensity.

import {
  BufferAttribute, BufferGeometry, Color, Group, InstancedBufferAttribute, InstancedMesh, Matrix4, Mesh, PlaneGeometry, Quaternion, Vector3,
} from 'three';
import type { QualityPreset } from '../../contracts/render';
import { envMaterial, EnvMode } from '../materials/shared';
import type { RawFeature } from '../data/raw';
import { canvasTexture, makeRand } from '../mesh/textures';
import type { EnvContext, EnvPart } from './environment';

export interface StandBox {
  /** Front-centre on the ground, unit axis along the stand (u) and toward the back (v). */
  cx: number; cz: number; ux: number; uz: number; vx: number; vz: number;
  length: number; depth: number; y: number; top: number; roof: boolean; kind: RawFeature['kind'];
}

const GREY = new Color(0.32, 0.32, 0.34);
const SEAT_COLORS = [0x1f4fbf, 0xb3122e, 0xe8b500, 0x0e8c82, 0xd8d8d8, 0x3b1a6b];
const SHIRTS = [0xc8102e, 0xf4f4f2, 0x1e90ff, 0x121314, 0x39f26a, 0xff6a13, 0x13235b, 0xc9a227, 0x0e8c82, 0x3a4048, 0xd7262b, 0x6ec6f0,
  0xff5fa8, 0xffd21a, 0x1f4fbf, 0x8a8f96, 0xe8eef4, 0x5b3a1e, 0x2f6b3a, 0xf2f4f7];

/** Oriented rectangle of a footprint; v points away from the track. */
export function standBoxFrom(f: RawFeature, nearTrack: (x: number, z: number) => [number, number], groundY: (x: number, z: number) => number): StandBox {
  const pts = f.xz;
  let best = 0, ux = 1, uz = 0;
  for (let k = 0; k + 1 < pts.length; k++) {
    const dx = pts[k + 1]![0] - pts[k]![0], dz = pts[k + 1]![1] - pts[k]![1];
    const l = Math.hypot(dx, dz);
    if (l > best) { best = l; ux = dx / l; uz = dz / l; }
  }
  let vx = -uz, vz = ux;
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (const [x, z] of pts) {
    const u = x * ux + z * uz, v = x * vx + z * vz;
    u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
  }
  const um = (u0 + u1) / 2;
  let cx = ux * um + vx * v0, cz = uz * um + vz * v0;
  let bx = ux * um + vx * v1, bz = uz * um + vz * v1;
  // Front = the long side closer to the track.
  const [tx, tz] = nearTrack((cx + bx) / 2, (cz + bz) / 2);
  if (Math.hypot(bx - tx, bz - tz) < Math.hypot(cx - tx, cz - tz)) {
    [cx, cz, bx, bz] = [bx, bz, cx, cz];
    vx = -vx; vz = -vz;
  }
  const depth = v1 - v0;
  const length = u1 - u0;
  let y = Infinity;
  for (const [x, z] of [[cx, cz], [bx, bz], [cx + ux * length / 2, cz + uz * length / 2], [cx - ux * length / 2, cz - uz * length / 2]] as [number, number][]) y = Math.min(y, groundY(x, z));
  return { cx, cz, ux, uz, vx, vz, length, depth, y, top: 0, roof: f.kind === 'grandstand', kind: f.kind };
}

class SBuf {
  pos: number[] = []; nor: number[] = []; col: number[] = []; uv: number[] = []; idx: number[] = [];
  quad(p: number[][], n: number[], c: Color): void {
    const b = this.pos.length / 3;
    for (const q of p) {
      this.pos.push(q[0]!, q[1]!, q[2]!);
      this.nor.push(n[0]!, n[1]!, n[2]!);
      this.col.push(c.r, c.g, c.b);
      this.uv.push(q[0]! * 0.25, q[1]! * 0.25 + q[2]! * 0.25);
    }
    // Wind so the geometric normal agrees with the given one.
    const a = p[0]!, e1 = p[1]!, e2 = p[2]!;
    const ux = e1[0]! - a[0]!, uy = e1[1]! - a[1]!, uz = e1[2]! - a[2]!;
    const vx = e2[0]! - a[0]!, vy = e2[1]! - a[1]!, vz = e2[2]! - a[2]!;
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    if (cx * n[0]! + cy * n[1]! + cz * n[2]! >= 0) this.idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
    else this.idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);
  }
  geometry(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute('normal', new BufferAttribute(new Float32Array(this.nor), 3));
    g.setAttribute('color', new BufferAttribute(new Float32Array(this.col), 3));
    g.setAttribute('uv', new BufferAttribute(new Float32Array(this.uv), 2));
    g.setIndex(this.pos.length / 3 > 65535 ? new BufferAttribute(new Uint32Array(this.idx), 1) : new BufferAttribute(new Uint16Array(this.idx), 1));
    g.computeBoundingSphere();
    return g;
  }
}

/** Axis-aligned box in a stand frame (u along, v back, y up) → 5 visible faces. */
export function boxInFrame(b: SBuf, o: { x: number; y: number; z: number }, u: [number, number], v: [number, number], y: [number, number],
  ux: number, uz: number, vx: number, vz: number, c: Color, bottom = false): void {
  const P = (uu: number, vv: number, yy: number): number[] => [o.x + ux * uu + vx * vv, o.y + yy, o.z + uz * uu + vz * vv];
  const [u0, u1] = u, [v0, v1] = v, [y0, y1] = y;
  b.quad([P(u0, v0, y1), P(u1, v0, y1), P(u0, v1, y1), P(u1, v1, y1)], [0, 1, 0], c);
  b.quad([P(u0, v0, y0), P(u1, v0, y0), P(u0, v0, y1), P(u1, v0, y1)], [-vx, 0, -vz], c);
  b.quad([P(u1, v1, y0), P(u0, v1, y0), P(u1, v1, y1), P(u0, v1, y1)], [vx, 0, vz], c);
  b.quad([P(u0, v1, y0), P(u0, v0, y0), P(u0, v1, y1), P(u0, v0, y1)], [-ux, 0, -uz], c);
  b.quad([P(u1, v0, y0), P(u1, v1, y0), P(u1, v0, y1), P(u1, v1, y1)], [ux, 0, uz], c);
  if (bottom) b.quad([P(u0, v1, y0), P(u1, v1, y0), P(u0, v0, y0), P(u1, v0, y0)], [0, -1, 0], c);
}
export { SBuf };

function crowdAtlas() {
  // 8 × 2 cells (64 × 128): R = clothing mask, G = skin, B = hair/cap, A = coverage.
  return canvasTexture(512, 256, (g) => {
    g.clearRect(0, 0, 512, 256);
    const rand = makeRand(77);
    for (let k = 0; k < 16; k++) {
      const ox = (k % 8) * 64;
      const oy = Math.floor(k / 8) * 128;
      const cx = ox + 32 + (rand() - 0.5) * 6;
      const shoulder = 17 + rand() * 6;
      const headY = oy + 36 + rand() * 8;
      // Torso (clothing) – red channel.
      g.fillStyle = 'rgb(255,0,0)';
      g.beginPath();
      g.moveTo(cx - shoulder, oy + 128);
      g.lineTo(cx - shoulder, headY + 30);
      g.quadraticCurveTo(cx, headY + 14, cx + shoulder, headY + 30);
      g.lineTo(cx + shoulder, oy + 128);
      g.fill();
      // Arms raised (cheering) in some variants, a flag in two.
      if (k % 4 === 1 || k === 6) {
        g.lineWidth = 7;
        g.strokeStyle = 'rgb(255,0,0)';
        g.beginPath();
        g.moveTo(cx - shoulder + 3, headY + 32);
        g.lineTo(cx - shoulder - 6, headY - 14);
        g.moveTo(cx + shoulder - 3, headY + 32);
        g.lineTo(cx + shoulder + 6, headY - 14);
        g.stroke();
        g.fillStyle = 'rgb(0,255,0)';
        for (const sx of [-1, 1]) {
          g.beginPath();
          g.arc(cx + sx * (shoulder + 6), headY - 17, 4, 0, Math.PI * 2);
          g.fill();
        }
      }
      if (k === 9 || k === 14) {
        g.fillStyle = 'rgb(255,0,0)';
        g.fillRect(cx + shoulder - 2, oy + 6, 3, headY + 30 - oy);
        g.fillRect(cx + shoulder, oy + 6, 22, 15);
      }
      // Head (skin) and hair / cap (blue channel).
      g.fillStyle = 'rgb(0,255,0)';
      g.beginPath();
      g.ellipse(cx, headY + 4, 9, 11, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = 'rgb(0,0,255)';
      g.beginPath();
      if (k % 3 === 0) {
        g.ellipse(cx, headY - 3, 10, 6, 0, Math.PI, 0);
        g.fillRect(cx - 2, headY - 3, 14, 3);
      } else g.ellipse(cx, headY - 2, 9.5, 6.5, 0, Math.PI, 0);
      g.fill();
    }
  }, false);
}

export function createStands(c: EnvContext): EnvPart & { boxes: StandBox[]; triangles: number } {
  const { track, ex } = c;
  const ground = c.ground!;
  const { data, query: q } = track;
  const rand = makeRand(4242);

  // Nearest track point (centreline sample) for orientation.
  const nearTrack = (x: number, z: number): [number, number] => {
    let best = Infinity, bi = 0;
    for (let i = 0; i < data.count; i += 3) {
      const d2 = (data.x[i]! - x) ** 2 + (data.z[i]! - z) ** 2;
      if (d2 < best) { best = d2; bi = i; }
    }
    return [data.x[bi]!, data.z[bi]!];
  };
  const reg = ex.reg;
  const feats = ex.features.filter((f) => f.kind === 'bleachers' || f.kind === 'grandstand' || (f.kind === 'building' && f.building === 'roof'))
    .map((f) => ({ ...f, xz: f.xz.map(([x, z]) => [(x - reg.cx) * reg.k, (z - reg.cz) * reg.k] as [number, number]) }));
  // Authored stands (street circuits): world rectangles from (s, d), split into ≤ 160 m straight pieces.
  const pw = { x: 0, y: 0, z: 0 };
  const wSD = (s: number, d: number): [number, number] => { q.worldFromSD(q.wrapS(s), d, pw); return [pw.x, pw.z]; };
  for (const [k, st] of (ex.authoring.STANDS ?? []).entries()) {
    const len = q.wrapS((st.to - st.from) * ex.sScale);
    const n = Math.max(1, Math.ceil(len / 160));
    for (let m = 0; m < n; m++) {
      const s0 = st.from * ex.sScale + (len * m) / n + 2, s1 = st.from * ex.sScale + (len * (m + 1)) / n - 2;
      const i = Math.round(q.wrapS((s0 + s1) / 2)) % data.count;
      const hw = st.side === 1 ? data.halfWidthL[i]! : data.halfWidthR[i]!;
      const d0 = st.side * (hw + st.setback), d1 = st.side * (hw + st.setback + st.depth);
      feats.push({ kind: st.kind, id: -1 - k * 10 - m, xz: [wSD(s0, d0), wSD(s1, d0), wSD(s1, d1), wSD(s0, d1), wSD(s0, d0)] });
    }
  }
  const boxes = feats.map((f) => standBoxFrom(f, nearTrack, (x, z) => ground.height(x, z)));

  const structure = new SBuf();
  const roofBuf = new SBuf();
  const concrete = new Color(0.3, 0.3, 0.29);
  const darkC = new Color(0.1, 0.1, 0.11);
  const seat = new Color();
  const roofCol = new Color(0.62, 0.63, 0.64);
  const steel = new Color(0.2, 0.21, 0.23);
  const pilasterC = new Color(0.6, 0.6, 0.58);
  // Rear wall and end caps: light rendered concrete (the QC daylight note: the 0.3 front-wall tone read near-black).
  const backC = new Color(1.0, 0.97, 0.9);
  type Seat = { x: number; y: number; z: number; fx: number; fz: number };
  const seats: Seat[] = [];

  for (const b of boxes) {
    const isHosp = b.kind === 'building';
    const rowD = 0.85;
    const rise = isHosp ? 0 : 0.45;
    const rows = isHosp ? 0 : Math.max(4, Math.min(34, Math.floor((b.depth - 1) / rowD)));
    const front = isHosp ? 0 : 1.6;
    const o = { x: b.cx, y: b.y, z: b.cz };
    const L2 = b.length / 2;
    seat.setHex(SEAT_COLORS[Math.floor(rand() * SEAT_COLORS.length)]!);
    const P = (u: number, v: number, y: number): number[] => [o.x + b.ux * u + b.vx * v, o.y + y, o.z + b.uz * u + b.vz * v];
    if (isHosp) {
      // Roofed hospitality: glass box on a plinth with an overhanging white roof.
      const hd = Math.max(8, b.depth);
      boxInFrame(structure, o, [-L2, L2], [0, hd], [0, 8], b.ux, b.uz, b.vx, b.vz, new Color(0.18, 0.22, 0.27));
      // QC2-17: plinth, floor slab band and mullions on the glazed track-facing side.
      boxInFrame(structure, o, [-L2 - 0.05, L2 + 0.05], [-0.05, hd + 0.05], [0, 0.6], b.ux, b.uz, b.vx, b.vz, concrete);
      boxInFrame(structure, o, [-L2 - 0.05, L2 + 0.05], [-0.08, hd + 0.05], [3.9, 4.4], b.ux, b.uz, b.vx, b.vz, roofCol);
      for (let u = -L2; u <= L2 + 0.01; u += Math.max(1.6, b.length / Math.round(b.length / 1.8))) {
        boxInFrame(structure, o, [u - 0.06, u + 0.06], [-0.06, 0], [0.6, 8], b.ux, b.uz, b.vx, b.vz, darkC);
      }
      boxInFrame(roofBuf, o, [-L2 - 2, L2 + 2], [-3, Math.max(8, b.depth) + 1], [8, 8.6], b.ux, b.uz, b.vx, b.vz, roofCol, true);
      b.top = 8.6;
      continue;
    }
    // Front wall.
    structure.quad([P(-L2, 0, 0), P(L2, 0, 0), P(-L2, 0, front), P(L2, 0, front)], [-b.vx, 0, -b.vz], concrete);
    for (let r = 0; r < rows; r++) {
      const y0 = front + r * rise;
      const v0 = r * rowD;
      const v1 = v0 + rowD;
      // Tread (seats colour, an aisle every 22 m shows as concrete) and riser.
      const segs = Math.max(1, Math.round(b.length / 22));
      for (let sgi = 0; sgi < segs; sgi++) {
        const ua = -L2 + (b.length * sgi) / segs;
        const ub = -L2 + (b.length * (sgi + 1)) / segs - 1.2;
        structure.quad([P(ua, v0, y0), P(ub, v0, y0), P(ua, v1, y0), P(ub, v1, y0)], [0, 1, 0], seat);
        structure.quad([P(ub, v0, y0), P(ub + 1.2, v0, y0), P(ub, v1, y0), P(ub + 1.2, v1, y0)], [0, 1, 0], concrete);
        for (let u = ua + 0.3; u < ub - 0.2; u += 0.56) {
          seats.push({ x: o.x + b.ux * u + b.vx * (v0 + 0.45), y: o.y + y0, z: o.z + b.uz * u + b.vz * (v0 + 0.45), fx: -b.vx, fz: -b.vz });
        }
      }
      structure.quad([P(-L2, v1, y0), P(L2, v1, y0), P(-L2, v1, y0 + rise), P(L2, v1, y0 + rise)], [-b.vx, 0, -b.vz], darkC);
    }
    const vb = rows * rowD;
    const top = front + rows * rise;
    b.top = top;
    // Back wall, top rail and end caps.
    structure.quad([P(L2, vb, 0), P(-L2, vb, 0), P(L2, vb, top + 1.1), P(-L2, vb, top + 1.1)], [b.vx, 0, b.vz], backC);
    // QC2-17: rear pilasters every ~8 m, a capping band and exit doors at ground level every ~24 m.
    const nPil = Math.max(1, Math.round(b.length / 8));
    for (let k = 0; k <= nPil; k++) {
      const u = -L2 + (b.length * k) / nPil;
      boxInFrame(structure, o, [u - 0.3, u + 0.3], [vb, vb + 0.35], [0, top + 1.1], b.ux, b.uz, b.vx, b.vz, pilasterC);
      if (k % 3 === 1 && k < nPil) {
        const ud = u + b.length / nPil / 2;
        structure.quad([P(ud + 1.2, vb + 0.02, 0), P(ud - 1.2, vb + 0.02, 0), P(ud + 1.2, vb + 0.02, 2.6), P(ud - 1.2, vb + 0.02, 2.6)], [b.vx, 0, b.vz], darkC);
      }
    }
    boxInFrame(structure, o, [-L2, L2], [vb, vb + 0.4], [top + 0.5, top + 1.1], b.ux, b.uz, b.vx, b.vz, pilasterC);
    for (const side of [-1, 1]) {
      const u = side * L2;
      const nx = side * b.ux, nz = side * b.uz;
      for (let r = 0; r <= rows; r++) {
        const v0 = r === 0 ? 0 : (r - 1) * rowD + rowD;
        const v1 = r === rows ? vb + 0.01 : (r + 1) * rowD;
        const h = r === rows ? top + 1.1 : front + r * rise;
        const pts = side > 0 ? [P(u, v0, 0), P(u, v1, 0), P(u, v0, h), P(u, v1, h)] : [P(u, v1, 0), P(u, v0, 0), P(u, v1, h), P(u, v0, h)];
        if (r < rows) structure.quad(pts, [nx, 0, nz], backC);
      }
    }
    if (b.roof) {
      // Cantilevered roof on rear columns.
      const ry = top + 5;
      boxInFrame(roofBuf, o, [-L2 - 1, L2 + 1], [-4, vb + 1.5], [ry, ry + 0.7], b.ux, b.uz, b.vx, b.vz, roofCol, true);
      for (let u = -L2; u <= L2 + 0.1; u += 24) boxInFrame(roofBuf, o, [u - 0.35, u + 0.35], [vb + 0.2, vb + 0.9], [0, ry], b.ux, b.uz, b.vx, b.vz, steel);
      b.top = ry + 0.7;
    }
  }

  const group = new Group();
  group.name = 'stands';
  const standMat = envMaterial(c.sh, { name: 'stands', family: 'opaque', vertexColor: true, roughness: 0.85, map: c.tex.concrete.map, wet: 0.5 });
  const roofMat = envMaterial(c.sh, { name: 'stands.roof', family: 'cutout', vertexColor: true, roughness: 0.55, metalness: 0.2, wet: 0.3 });
  const sGeo = structure.geometry();
  const rGeo = roofBuf.geometry();
  const sMesh = new Mesh(sGeo, standMat);
  const rMesh = new Mesh(rGeo, roofMat);
  for (const m of [sMesh, rMesh]) {
    m.castShadow = c.quality.id !== 'low';
    m.receiveShadow = true;
    m.matrixAutoUpdate = false;
    group.add(m);
  }

  // ---- crowd ----------------------------------------------------------------------------------------------
  const atlas = crowdAtlas();
  // Crowd: instCutout family, EnvMode.Crowd (aApx = variant, phase; bob animated by the shared uApxTime).
  const crowdMat = envMaterial(c.sh, { name: 'crowd', family: 'instCutout', mode: EnvMode.Crowd, map: atlas, alphaTest: 0.5, roughness: 0.9, wet: 0, flood: 0.8 });
  const crowdGeo = new PlaneGeometry(0.62, 1.2);
  crowdGeo.translate(0, 0.62, 0);
  // Deterministic shuffle so a density cut keeps an even subset.
  for (let k = seats.length - 1; k > 0; k--) {
    const j = Math.floor(rand() * (k + 1));
    [seats[k], seats[j]] = [seats[j]!, seats[k]!];
  }
  const maxN = seats.length;
  const crowd = new InstancedMesh(crowdGeo, crowdMat, Math.max(1, maxN));
  crowd.name = 'crowd';
  const vp = new Float32Array(Math.max(1, maxN) * 2);
  const m4 = new Matrix4();
  const quat = new Quaternion();
  const up = new Vector3(0, 1, 0);
  const pos = new Vector3();
  const scl = new Vector3();
  const col = new Color();
  seats.forEach((s, k) => {
    quat.setFromAxisAngle(up, Math.atan2(s.fx, s.fz));
    pos.set(s.x, s.y, s.z);
    const sc = 0.9 + rand() * 0.2;
    scl.set(sc, sc, 1);
    m4.compose(pos, quat, scl);
    crowd.setMatrixAt(k, m4);
    col.setHex(SHIRTS[Math.floor(rand() * SHIRTS.length)]!).lerp(GREY, 0.25 + rand() * 0.3).multiplyScalar(0.55 + rand() * 0.35);
    crowd.setColorAt(k, col);
    vp[k * 2] = Math.floor(rand() * 16);
    vp[k * 2 + 1] = rand();
  });
  crowdGeo.setAttribute('aApx', new InstancedBufferAttribute(vp, 2));
  crowd.count = Math.round(maxN * c.quality.crowdDensity);
  crowd.castShadow = false;
  crowd.receiveShadow = true;
  crowd.computeBoundingSphere();
  group.add(crowd);

  const triangles = sGeo.index!.count / 3 + rGeo.index!.count / 3 + crowd.count * 2;
  void q;
  return {
    root: group,
    boxes,
    triangles,
    setQuality(qp: QualityPreset) {
      crowd.count = Math.round(maxN * qp.crowdDensity);
      sMesh.castShadow = rMesh.castShadow = qp.id !== 'low';
    },
    dispose() {
      sGeo.dispose();
      rGeo.dispose();
      crowdGeo.dispose();
      standMat.dispose();
      roofMat.dispose();
      crowdMat.dispose();
      atlas.dispose();
      crowd.dispose();
      group.removeFromParent();
    },
  };
}
