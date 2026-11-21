// Alpine Pass extras (docs/design/tracks-alpine.md §5, §9): the lake, the bored tunnel (inner shell, portals, rock
// overburden, lamp strips), the cable car (stations, towers, cables; cabins moving on the render clock) and the chalet
// villages. Empty group on every other track. Draws: lake 1, tunnel + cable-car statics 1, overburden 1, lamps 1,
// cabins 1, chalets 1. Every material is an env family (no new programs).

import { Color, Group, InstancedMesh, Matrix4, Mesh, PlaneGeometry, Quaternion, Vector3, type PerspectiveCamera } from 'three';
import type { TrackFrame } from '../../contracts/track';
import type { RenderFrame } from '../../contracts/render';
import { CABLE, LAKE, TUNNEL, VILLAGES, tunnelRidge } from '../authoring/alpine-ctrl';
import { envMaterial, EnvMode } from '../materials/shared';
import { makeRand } from '../mesh/textures';
import type { EnvContext, EnvPart } from './environment';
import { boxInFrame, SBuf } from './stands';
import { buildTunnel } from './tunnel';

const sst = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const CABINS = 4; // per direction
const CABLE_SPEED = 6; // m/s

/** Chalet in a unit frame (u, v ∈ ±0.5, y 0..1): plaster base, larch upper floor, balcony, gabled charcoal roof. */
function chaletGeometry(): SBuf {
  const b = new SBuf();
  const o = { x: 0, y: 0, z: 0 };
  const plaster = new Color(0.78, 0.77, 0.73), wood = new Color(0.2, 0.11, 0.055), roof = new Color(0.075, 0.075, 0.08);
  const dark = new Color(0.035, 0.035, 0.04), sill = new Color(0.55, 0.12, 0.08);
  boxInFrame(b, o, [-0.5, 0.5], [-0.5, 0.5], [-0.35, 0.42], 1, 0, 0, 1, plaster);
  boxInFrame(b, o, [-0.5, 0.5], [-0.5, 0.5], [0.42, 0.74], 1, 0, 0, 1, wood);
  // Balcony on the long front, windows with red flower boxes.
  boxInFrame(b, o, [-0.46, 0.46], [0.5, 0.6], [0.44, 0.5], 1, 0, 0, 1, wood);
  for (const u of [-0.3, 0, 0.3]) {
    b.quad([[u - 0.08, 0.15, 0.502], [u + 0.08, 0.15, 0.502], [u - 0.08, 0.3, 0.502], [u + 0.08, 0.3, 0.502]], [0, 0, 1], dark);
    boxInFrame(b, o, [u - 0.09, u + 0.09], [0.5, 0.54], [0.12, 0.15], 1, 0, 0, 1, sill);
    b.quad([[u - 0.07, 0.53, 0.502], [u + 0.07, 0.53, 0.502], [u - 0.07, 0.66, 0.502], [u + 0.07, 0.66, 0.502]], [0, 0, 1], dark);
  }
  // Gable ends (wood) and the two roof slopes with overhang (ridge along u).
  for (const s of [-1, 1]) {
    b.quad([[s * 0.5, 0.74, -0.5], [s * 0.5, 0.74, 0.5], [s * 0.5, 1.0, 0], [s * 0.5, 1.0, 0]], [s, 0, 0], wood);
    const e = s * 0.66;
    b.quad([[-0.62, 0.7, e], [0.62, 0.7, e], [-0.62, 1.02, 0], [0.62, 1.02, 0]], [0, 0.9, s * 0.45], roof);
    b.quad([[-0.62, 0.67, e], [0.62, 0.67, e], [-0.62, 0.99, 0], [0.62, 0.99, 0]], [0, -0.9, -s * 0.45], roof);
  }
  return b;
}

/** Cable-car cabin: red body, dark window band, grey hanger (local: u along the cable, origin at the grip). */
function cabinGeometry(): SBuf {
  const b = new SBuf();
  const o = { x: 0, y: 0, z: 0 };
  const red = new Color(0.62, 0.05, 0.04), dark = new Color(0.03, 0.035, 0.045), grey = new Color(0.45, 0.45, 0.46);
  boxInFrame(b, o, [-0.08, 0.08], [-0.08, 0.08], [-3.2, 0], 1, 0, 0, 1, grey);
  boxInFrame(b, o, [-1.6, 1.6], [-1.2, 1.2], [-5.9, -3.2], 1, 0, 0, 1, red, true);
  boxInFrame(b, o, [-1.62, 1.62], [-1.22, 1.22], [-4.4, -3.6], 1, 0, 0, 1, dark);
  boxInFrame(b, o, [-1.7, 1.7], [-1.3, 1.3], [-3.3, -3.1], 1, 0, 0, 1, grey);
  return b;
}

export function createAlpine(c: EnvContext): EnvPart & { triangles: number } {
  const group = new Group();
  group.name = 'alpine';
  if (c.ex.authoring.id !== 'alpine') return { root: group, triangles: 0, dispose: () => group.removeFromParent() };
  const { data, query: q } = c.track;
  const ex = c.ex;
  const ground = c.ground!;
  const rand = makeRand(1963);
  const reg = ex.reg;
  const mapE = (x: number): number => x / reg.k + reg.cx;
  const mapN = (z: number): number => -(z / reg.k + reg.cz);
  const wx = (E: number): number => (E - reg.cx) * reg.k;
  const wz = (N: number): number => (-N - reg.cz) * reg.k;
  const info = { s: 0, d: 0, covered: false, nearTrack: 0 };
  const f: TrackFrame = { s: 0, px: 0, py: 0, pz: 0, tx: 1, tz: 0, lx: 0, lz: -1, halfWidthL: 0, halfWidthR: 0, crossSlope: 0, curvature: 0, vCurvature: 0, grade: 0, sector: 0 };
  const P = { x: 0, y: 0, z: 0 };
  let tris = 0;

  // ---- lake (1 draw): water plane south of the main straight, clipped by the shore terrain ----
  let minX = Infinity, maxX = -Infinity;
  for (let i = 0; i < data.count; i++) { minX = Math.min(minX, data.x[i]!); maxX = Math.max(maxX, data.x[i]!); }
  const lakeGeo = new PlaneGeometry(9000, 4200, 30, 14);
  lakeGeo.rotateX(-Math.PI / 2);
  lakeGeo.translate((minX + maxX) / 2, LAKE.y, wz(LAKE.nNorth) + 2100 - 40);
  const lakeMat = envMaterial(c.sh, { name: 'alpine.lake', family: 'opaque', mode: EnvMode.Water, roughness: 0.05, wet: 0, flood: 0.6 });
  const lake = new Mesh(lakeGeo, lakeMat);
  lake.name = 'alpine.lake';
  lake.receiveShadow = true;
  lake.matrixAutoUpdate = false;
  group.add(lake);

  // No trees or props on the water.
  c.blockers.push({ cx: (minX + maxX) / 2, cz: wz(LAKE.nNorth - 30) + 3000, ux: 1, uz: 0, hu: 5000, hv: 3000 });

  // ---- tunnel shell, portals and the cable-car statics (1 draw, concrete map × vertex colour) ----
  const st = new SBuf();
  const lamps = new SBuf();
  const rock = new SBuf();
  buildTunnel(c, st, rock, lamps, TUNNEL.from, TUNNEL.to, tunnelRidge);
  const s0 = q.wrapS(TUNNEL.from * ex.sScale), s1 = q.wrapS(TUNNEL.to * ex.sScale);
  const OB_D = 85;

  // ---- cable car: valley station → towers → mountain station; cabins on two cables ----
  const ax = wx(CABLE.from[0]), az = wz(CABLE.from[1]);
  const bx = wx(CABLE.to[0]), bz = wz(CABLE.to[1]);
  const len2 = Math.hypot(bx - ax, bz - az);
  const cu = [(bx - ax) / len2, (bz - az) / len2];
  const cv = [-cu[1]!, cu[0]!];
  const ya = ground.height(ax, az), yb = ground.height(bx, bz);
  const steel = new Color(0.32, 0.33, 0.35), white = new Color(0.8, 0.79, 0.76), red = new Color(0.55, 0.06, 0.05);
  for (const [x, z, y] of [[ax, az, ya], [bx, bz, yb]] as const) {
    boxInFrame(st, { x, y, z }, [-9, 9], [-6, 6], [-3, 9], cu[0]!, cu[1]!, cv[0]!, cv[1]!, white);
    boxInFrame(st, { x, y, z }, [-10, 10], [-7, 7], [9, 10.5], cu[0]!, cu[1]!, cv[0]!, cv[1]!, red);
    boxInFrame(st, { x, y, z }, [-1, 1], [-5, 5], [10.5, 14], cu[0]!, cu[1]!, cv[0]!, cv[1]!, steel);
  }
  const tops: [number, number, number][] = [[ax, ya + 13.5, az]];
  const NT = 6;
  for (let k = 1; k <= NT; k++) {
    let t = k / (NT + 1);
    let x = ax + (bx - ax) * t, z = az + (bz - az) * t;
    for (let m = 0; m < 12; m++) {
      ground.height(x, z, info);
      if (!info.covered && info.nearTrack < 0.01) break;
      t += (m % 2 ? -1 : 1) * 0.012 * (m + 1);
      x = ax + (bx - ax) * t;
      z = az + (bz - az) * t;
    }
    const gy = ground.height(x, z);
    const line = ya + 13.5 + (yb - ya) * t;
    const top = Math.max(line, gy + 22);
    boxInFrame(st, { x, y: gy, z }, [-1.1, 1.1], [-1.1, 1.1], [-2, top - gy], cu[0]!, cu[1]!, cv[0]!, cv[1]!, steel);
    boxInFrame(st, { x, y: top, z }, [-0.8, 0.8], [-4.2, 4.2], [-0.4, 0.4], cu[0]!, cu[1]!, cv[0]!, cv[1]!, steel);
    tops.push([x, top, z]);
    c.blockers.push({ cx: x, cz: z, ux: cu[0]!, uz: cu[1]!, hu: 6, hv: 6 });
  }
  tops.push([bx, yb + 13.5, bz]);
  // Cables: thin dark boxes between successive tops, 3.5 m either side.
  const cableCol = new Color(0.05, 0.05, 0.055);
  for (let k = 0; k + 1 < tops.length; k++) {
    const A = tops[k]!, B = tops[k + 1]!;
    for (const side of [-3.5, 3.5]) {
      const ox = cv[0]! * side, oz = cv[1]! * side;
      const p0 = [A[0] + ox, A[1], A[2] + oz], p1 = [B[0] + ox, B[1], B[2] + oz];
      st.quad([[p0[0]! - cv[0]! * 0.08, p0[1]!, p0[2]! - cv[1]! * 0.08], [p1[0]! - cv[0]! * 0.08, p1[1]!, p1[2]! - cv[1]! * 0.08],
        [p0[0]! + cv[0]! * 0.08, p0[1]!, p0[2]! + cv[1]! * 0.08], [p1[0]! + cv[0]! * 0.08, p1[1]!, p1[2]! + cv[1]! * 0.08]], [0, 1, 0], cableCol);
      st.quad([[p0[0]!, p0[1]! - 0.16, p0[2]!], [p1[0]!, p1[1]! - 0.16, p1[2]!], [p0[0]!, p0[1]!, p0[2]!], [p1[0]!, p1[1]!, p1[2]!]], [cv[0]!, 0, cv[1]!], cableCol);
    }
  }
  const cum: number[] = [0];
  for (let k = 1; k < tops.length; k++) cum.push(cum[k - 1]! + Math.hypot(tops[k]![0] - tops[k - 1]![0], tops[k]![1] - tops[k - 1]![1], tops[k]![2] - tops[k - 1]![2]));
  const cableLen = cum[cum.length - 1]!;
  for (const [x, z] of [[ax, az], [bx, bz]] as const) c.blockers.push({ cx: x, cz: z, ux: cu[0]!, uz: cu[1]!, hu: 22, hv: 18 });

  // Trees and props never grow through the overburden.
  {
    const sm = (s0 + s1) / 2;
    q.frameAt(sm, f);
    c.blockers.push({ cx: f.px, cz: f.pz, ux: f.tx, uz: f.tz, hu: (s1 - s0) / 2 + 12, hv: OB_D + 5 });
  }

  const stGeo = st.geometry();
  const stMat = envMaterial(c.sh, { name: 'alpine.struct', family: 'opaque', vertexColor: true, map: c.tex.concrete.map, normalMap: c.tex.concrete.normal, roughness: 0.9, wet: 0.5 });
  const stMesh = new Mesh(stGeo, stMat);
  stMesh.name = 'alpine.struct';
  stMesh.castShadow = true;
  stMesh.receiveShadow = true;
  stMesh.matrixAutoUpdate = false;
  group.add(stMesh);
  const rockGeo = rock.geometry();
  const rockMat = envMaterial(c.sh, { name: 'alpine.rock', family: 'opaque', vertexColor: true, map: c.tex.dirt.map, normalMap: c.tex.dirt.normal, roughness: 0.95, wet: 0.6 });
  const rockMesh = new Mesh(rockGeo, rockMat);
  rockMesh.name = 'alpine.rock';
  rockMesh.castShadow = true;
  rockMesh.receiveShadow = true;
  rockMesh.matrixAutoUpdate = false;
  group.add(rockMesh);
  const lampGeo = lamps.geometry();
  const lampMat = envMaterial(c.sh, { name: 'alpine.lamps', family: 'opaque', mode: EnvMode.Lamp, vertexColor: true, emissive: 0xffffff, emissiveIntensity: 2.2, roughness: 0.3, wet: 0, flood: 0 });
  const lampMesh = new Mesh(lampGeo, lampMat);
  lampMesh.name = 'alpine.lamps';
  lampMesh.matrixAutoUpdate = false;
  group.add(lampMesh);
  tris += (stGeo.index!.count + rockGeo.index!.count + lampGeo.index!.count) / 3;

  // ---- cabins (1 draw, moved on the render clock) ----
  const cabGeo = cabinGeometry().geometry();
  const cabMat = envMaterial(c.sh, { name: 'alpine.cabins', family: 'inst', vertexColor: true, roughness: 0.4, metalness: 0.2, wet: 0.5 });
  const cabins = new InstancedMesh(cabGeo, cabMat, 2 * CABINS);
  cabins.name = 'alpine.cabins';
  cabins.castShadow = true;
  cabins.frustumCulled = false;
  const white1 = new Color(1, 1, 1);
  for (let k = 0; k < 2 * CABINS; k++) cabins.setColorAt(k, white1);
  group.add(cabins);
  tris += (2 * CABINS * cabGeo.index!.count) / 3;
  const m4 = new Matrix4();
  const qt = new Quaternion();
  const up = new Vector3(0, 1, 0);
  const pos = new Vector3();
  const one = new Vector3(1, 1, 1);
  const yaw = Math.atan2(-cu[1]!, cu[0]!);
  const placeCabins = (time: number): void => {
    for (let k = 0; k < 2 * CABINS; k++) {
      const dir = k < CABINS ? 1 : -1;
      const ph = ((time * CABLE_SPEED) / cableLen + (k % CABINS) / CABINS) % 1;
      const u = (dir === 1 ? ph : 1 - ph) * cableLen;
      let j = 1;
      while (j < cum.length - 1 && cum[j]! < u) j++;
      const A = tops[j - 1]!, B = tops[j]!;
      const t = (u - cum[j - 1]!) / (cum[j]! - cum[j - 1]! || 1);
      const side = dir === 1 ? -3.5 : 3.5;
      pos.set(A[0] + (B[0] - A[0]) * t + cv[0]! * side, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t + cv[1]! * side);
      qt.setFromAxisAngle(up, yaw);
      m4.compose(pos, qt, one);
      cabins.setMatrixAt(k, m4);
    }
    cabins.instanceMatrix.needsUpdate = true;
  };
  placeCabins(0);

  // ---- chalet villages (1 draw) ----
  const ch = chaletGeometry();
  const chGeo = ch.geometry();
  const spots: { x: number; y: number; z: number; w: number; d: number; h: number; rot: number }[] = [];
  for (const v of VILLAGES) {
    const vx = wx(v.e), vz = wz(v.n);
    let tries = 0;
    let placed = 0;
    while (placed < v.count && tries < v.count * 12) {
      tries++;
      const a = rand() * Math.PI * 2, r = Math.sqrt(rand()) * v.r;
      const x = vx + Math.cos(a) * r, z = vz + Math.sin(a) * r;
      const w = 9 + rand() * 5, d = 8 + rand() * 4;
      if (spots.some((p) => Math.hypot(p.x - x, p.z - z) < 16)) continue;
      const y = ground.height(x, z, info);
      if (info.covered || info.nearTrack > 0.02) continue;
      if (c.blockers.some((b) => {
        const dx = x - b.cx, dz = z - b.cz;
        return Math.abs(dx * b.ux + dz * b.uz) < b.hu + 6 && Math.abs(dx * b.uz - dz * b.ux) < b.hv + 6;
      })) continue;
      // Sit on the lowest corner (the plaster base goes into the slope).
      let lo = y;
      for (const [ox, oz] of [[-w / 2, -d / 2], [w / 2, -d / 2], [-w / 2, d / 2], [w / 2, d / 2]] as const) lo = Math.min(lo, ground.height(x + ox, z + oz));
      if (y - lo > 5) continue;
      spots.push({ x, y: lo, z, w, d, h: 8 + rand() * 3, rot: Math.round(rand() * 4) * (Math.PI / 2) + (rand() - 0.5) * 0.3 });
      placed++;
    }
  }
  const chalets = new InstancedMesh(chGeo, envMaterial(c.sh, { name: 'alpine.chalets', family: 'inst', vertexColor: true, roughness: 0.85, wet: 0.5 }), Math.max(1, spots.length));
  chalets.name = 'alpine.chalets';
  const tint = new Color();
  spots.forEach((p, k) => {
    qt.setFromAxisAngle(up, p.rot);
    m4.compose(pos.set(p.x, p.y, p.z), qt, new Vector3(p.w, p.h, p.d));
    chalets.setMatrixAt(k, m4);
    chalets.setColorAt(k, tint.setRGB(0.9 + rand() * 0.2, 0.9 + rand() * 0.15, 0.88 + rand() * 0.15));
    c.blockers.push({ cx: p.x, cz: p.z, ux: Math.cos(p.rot), uz: -Math.sin(p.rot), hu: p.w / 2 + 3, hv: p.d / 2 + 3 });
  });
  chalets.count = spots.length;
  chalets.castShadow = c.quality.id !== 'low';
  chalets.receiveShadow = true;
  chalets.computeBoundingSphere();
  group.add(chalets);
  tris += (spots.length * chGeo.index!.count) / 3;

  return {
    root: group,
    triangles: tris,
    update(_cam: PerspectiveCamera, frame: RenderFrame) {
      placeCabins(frame.time);
    },
    setQuality(qp) {
      chalets.castShadow = qp.id !== 'low';
    },
    dispose() {
      lakeGeo.dispose();
      lakeMat.dispose();
      stGeo.dispose();
      stMat.dispose();
      rockGeo.dispose();
      rockMat.dispose();
      lampGeo.dispose();
      lampMat.dispose();
      cabGeo.dispose();
      cabMat.dispose();
      cabins.dispose();
      chGeo.dispose();
      (chalets.material as { dispose(): void }).dispose();
      chalets.dispose();
      group.removeFromParent();
    },
  };
}
