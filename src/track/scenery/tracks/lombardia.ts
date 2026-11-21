// Lombardia-only presentation: royal park architecture, mature avenues and heritage venue furniture.
import {
  BufferAttribute, Color, CylinderGeometry, DynamicDrawUsage, Frustum, Group, IcosahedronGeometry, InstancedMesh, Matrix4, Mesh,
  PlaneGeometry, Quaternion, Sphere, Vector3, type BufferGeometry, type MeshStandardMaterial, type Object3D,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { envMaterial, EnvMode } from '../../materials/shared';
import { canvasTexture, makeRand } from '../../mesh/textures';
import { boxInFrame, SBuf, standBoxFrom } from '../stands';
import type { EnvContext, EnvPart } from '../environment';

type Site = { x: number; y: number; z: number; yaw: number; scale: number };
type ParkSites = { villa: Site[]; lodges: Site[]; trees: Site[]; podium: Site[] };
const parkSites = new WeakMap<EnvContext, ParkSites>();

/** Reserve footprints before the general tree/building factories populate the park. */
export function reserveLombardiaSites(c: EnvContext): void {
  const sites: ParkSites = { villa: [], lodges: [], trees: [], podium: [] };
  const rand = makeRand(3817), p = { x: 0, y: 0, z: 0 }, next = { x: 0, y: 0, z: 0 };
  const info = { s: 0, d: 0, covered: false, nearTrack: 0 };
  const existing = c.ex.features.filter((f) => f.kind === 'building').map((f) => ({
    x: (f.xz.reduce((n, v) => n + v[0], 0) / f.xz.length - c.ex.reg.cx) * c.ex.reg.k,
    z: (f.xz.reduce((n, v) => n + v[1], 0) / f.xz.length - c.ex.reg.cz) * c.ex.reg.k,
  }));
  const reserve = (s: number, d: number, hu: number, hv: number): Site | null => {
    c.track.query.worldFromSD(s * c.ex.sScale, d, p);
    c.track.query.worldFromSD(s * c.ex.sScale + 1, d, next);
    const len = Math.hypot(next.x - p.x, next.z - p.z), ux = (next.x - p.x) / len, uz = (next.z - p.z) / len;
    if (existing.some((b) => Math.hypot(b.x - p.x, b.z - p.z) < Math.hypot(hu, hv) + 18)) return null;
    let low = Infinity, high = -Infinity;
    for (const u of [-hu, 0, hu]) for (const v of [-hv, 0, hv]) {
      const x = p.x + ux * u - uz * v, z = p.z + uz * u + ux * v;
      const y = c.ground!.height(x, z, info), k = Math.round(info.s) % c.track.data.count;
      const wall = info.d >= 0 ? c.track.data.wallL[k]! : c.track.data.wallR[k]!;
      if (info.covered || Math.abs(info.d) < wall + 8) return null;
      if (c.blockers.some((b) => Math.abs((x - b.cx) * b.ux + (z - b.cz) * b.uz) < b.hu + 3 && Math.abs((x - b.cx) * b.uz - (z - b.cz) * b.ux) < b.hv + 3)) return null;
      low = Math.min(low, y); high = Math.max(high, y);
    }
    if (high - low > 2.8) return null;
    c.blockers.push({ cx: p.x, cz: p.z, ux, uz, hu: hu + 2, hv: hv + 2 });
    return { x: p.x, y: high + 0.03, z: p.z, yaw: Math.atan2(-uz, ux), scale: 1 };
  };
  // A clearing alongside the approach to the second chicane, visible from both driving cameras.
  for (const s of [1570, 1490, 1660, 4300]) {
    for (const d of [82, -86, 112, -116]) {
      const site = reserve(s, d, 38, 27);
      if (site) {
        sites.villa.push(site);
        c.blockers.push({ cx: site.x, cz: site.z, ux: Math.cos(site.yaw), uz: -Math.sin(site.yaw), hu: 112, hv: 49 });
        break;
      }
    }
    if (sites.villa.length) break;
  }
  for (const [s, d] of [[510, -82], [1940, -68], [3510, 82], [4520, -75]] as const) {
    const site = reserve(s, d, 9, 8); if (site) sites.lodges.push(site);
  }
  for (const s of [5300, 5400, 5500, 5600, 5700, 0, 120, 240]) {
    for (const d of [-70, -100, -145, -185, 80, 110]) {
      const site = reserve(s, d, 17, 12); if (site) { sites.podium.push(site); break; }
    }
    if (sites.podium.length) break;
  }
  for (const [from, to] of [[730, 970], [1410, 1770], [2700, 3500], [3970, 4730]] as const) {
    for (let s = from; s <= to; s += 24) for (const side of [-1, 1]) {
      const k = Math.round(s * c.ex.sScale) % c.track.data.count;
      const wall = side > 0 ? c.track.data.wallL[k]! : c.track.data.wallR[k]!;
      c.track.query.worldFromSD(s * c.ex.sScale, side * (wall + 21), p);
      if (sites.villa.some((v) => Math.hypot(v.x - p.x, v.z - p.z) < 96)) continue;
      const site = reserve(s, side * (wall + 21), 7.5, 7.5);
      if (site) { site.scale = 0.92 + rand() * 0.23; sites.trees.push(site); }
    }
  }
  parkSites.set(c, sites);
}

function architecture(kind: 'villa' | 'lodge' | 'podium'): { body: BufferGeometry; glass: BufferGeometry } {
  const b = new SBuf(), glass = new SBuf(), o = { x: 0, y: 0, z: 0 };
  const cream = new Color(0.65, 0.55, 0.39), trim = new Color(0.83, 0.78, 0.64);
  const stone = new Color(0.33, 0.32, 0.27), green = new Color(0.035, 0.095, 0.065), roof = new Color(0.28, 0.095, 0.045);
  const box = (u: [number, number], v: [number, number], y: [number, number], color: Color): void => boxInFrame(b, o, u, v, y, 1, 0, 0, 1, color);
  const width = kind === 'villa' ? 30 : kind === 'lodge' ? 6 : 14;
  const depth = kind === 'villa' ? 10 : kind === 'lodge' ? 5 : 6;
  const h = kind === 'villa' ? 15 : kind === 'lodge' ? 6 : 7;
  box([-width, width], [-depth, depth], [-3, 0.8], stone);
  box([-width, width], [-depth, depth], [0.8, h], cream);
  for (const y of [0.8, h * 0.5, h - 0.4]) box([-width - 0.3, width + 0.3], [-depth - 0.3, depth + 0.3], [y, y + 0.32], trim);
  for (const side of [-1, 1]) {
    b.quad([[-width - 0.7, h, side * (depth + 0.7)], [width + 0.7, h, side * (depth + 0.7)], [-width + 2, h + 3, 0], [width - 2, h + 3, 0]], [0, 0.96, side * 0.28], roof);
    b.quad([[side * (width + 0.7), h, -depth - 0.7], [side * (width + 0.7), h, depth + 0.7], [side * (width - 2), h + 3, 0], [side * (width - 2), h + 3, 0]], [side * 0.83, 0.55, 0], roof);
    for (let x = -width + 3; x < width; x += 4.8) for (let y = 2; y < h - 2; y += 5.1) {
      const z = side * (depth + 0.04);
      glass.quad([[x - 0.72, y, z], [x + 0.72, y, z], [x - 0.72, y + 2.4, z], [x + 0.72, y + 2.4, z]], [0, 0, side], new Color(x % 3 > 0 ? 1 : 0.16, 0.65, 0.34));
      box([x - 0.9, x + 0.9], [z - 0.13, z + 0.13], [y - 0.2, y], trim);
      box([x - 0.9, x + 0.9], [z - 0.13, z + 0.13], [y + 2.4, y + 2.65], trim);
      for (const dx of [-1.12, 1.12]) box([x + dx - 0.24, x + dx + 0.24], [z - 0.07, z + 0.07], [y, y + 2.4], green);
    }
  }
  for (const x of [-width + 0.35, width - 0.35]) for (const z of [-depth, depth]) box([x - 0.4, x + 0.4], [z - 0.2, z + 0.2], [0.8, h], trim);
  if (kind === 'villa') {
    box([-8, 8], [-13, 13], [0.8, 16.8], cream);
    for (const side of [-1, 1]) {
      box([-8.5, 8.5], [side * 15 - 2.6, side * 15 + 2.6], [10.8, 11.4], trim);
      for (const x of [-7, -3.5, 3.5, 7]) {
        box([x - 0.3, x + 0.3], [side * 16 - 0.3, side * 16 + 0.3], [0.8, 10.8], trim);
        box([x - 0.6, x + 0.6], [side * 16 - 0.6, side * 16 + 0.6], [0.8, 1.2], stone);
      }
      b.quad([[-8.7, 17, side * 13.15], [8.7, 17, side * 13.15], [0, 21, side * 13.15], [0, 21, side * 13.15]], [0, 0, side], trim);
      box([-1.6, 1.6], [side * 13.04 - 0.03, side * 13.04 + 0.03], [1, 6.8], green);
      for (let k = 0; k < 5; k++) box([-8.6, 8.6], [side * 17.8 - 0.5 - k * 0.4, side * 17.8 + 0.5 + k * 0.4], [-0.5 + k * 0.23, -0.27 + k * 0.23], stone);
    }
    box([-8.5, 8.5], [-13.4, 13.4], [16.7, 17.1], trim);
    for (const x of [-22, -14, 14, 22]) box([x - 0.5, x + 0.5], [-1, 0], [16.2, 19.5], cream);
  } else if (kind === 'podium') {
    box([-15, 15], [-8, 8], [7, 7.55], green);
    for (const x of [-10, -5, 0, 5, 10]) box([x - 0.07, x + 0.07], [-8, 8], [7.55, 7.8], trim);
    for (const [x, h0] of [[-4, 0.8], [0, 1.4], [4, 0.45]] as const) box([x - 1.8, x + 1.8], [-10, -7.5], [0.8, h0 + 0.8], trim);
    for (const x of [-10, 0, 10]) {
      box([x - 0.06, x + 0.06], [7, 7.12], [7.5, 15], stone);
      box([x, x + 3], [7, 7.08], [12, 14.5], x === 0 ? cream : green);
    }
  }
  return { body: b.geometry(), glass: glass.geometry() };
}

function avenueGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const color = (geo: BufferGeometry, col: Color): void => {
    const p = geo.getAttribute('position'), rgb = new Float32Array(p.count * 3);
    for (let k = 0; k < p.count; k++) {
      const shade = 0.8 + 0.2 * Math.min(1, Math.max(0, p.getY(k) / 23));
      rgb.set([col.r * shade, col.g * shade, col.b * shade], k * 3);
    }
    geo.setAttribute('color', new BufferAttribute(rgb, 3)); parts.push(geo);
  };
  const bark = new Color(0.23, 0.21, 0.16);
  const trunk = new CylinderGeometry(0.32, 0.65, 12, 7); trunk.translate(0, 6, 0); color(trunk.toNonIndexed(), bark); trunk.dispose();
  for (const [x, z] of [[-4, 2], [4, -2], [1, 3]] as const) {
    const dir = new Vector3(x, 5, z), length = dir.length();
    const branch = new CylinderGeometry(0.12, 0.28, length, 5);
    branch.applyQuaternion(new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), dir.normalize()));
    branch.translate(x / 2, 12.5, z / 2); color(branch.toNonIndexed(), bark); branch.dispose();
  }
  for (const [x, y, z, sx, sy, sz] of [[0, 18, 0, 6.6, 7, 6.3], [-3.8, 16.2, 1.8, 4.7, 5, 4.5], [3.9, 17, -1.6, 4.8, 5.8, 4.8], [0.6, 23, 0.5, 4.2, 4.4, 4.1]] as const) {
    const g = new IcosahedronGeometry(1, 1), p = g.getAttribute('position');
    for (let k = 0; k < p.count; k++) {
      const a = p.getX(k), b = p.getY(k), d = p.getZ(k), hash = Math.sin(a * 17.3 + b * 38.7 + d * 57.1) * 4357.3;
      const radius = 0.88 + 0.22 * (hash - Math.floor(hash));
      p.setXYZ(k, a * radius, b * radius, d * radius);
    }
    g.computeVertexNormals(); g.scale(sx, sy, sz); g.translate(x, y, z); color(g, new Color(0.085, 0.14, 0.045));
  }
  const merged = mergeGeometries(parts)!; for (const g of parts) g.dispose(); return merged;
}

export function createLombardiaDetails(c: EnvContext, environment: Object3D): EnvPart {
  const root = new Group(); root.name = 'lombardia.details';
  const geometries: BufferGeometry[] = [], materials: MeshStandardMaterial[] = [], instances: InstancedMesh[] = [];
  const architectureMeshes: InstancedMesh[] = [];
  const sites = parkSites.get(c) ?? { villa: [], lodges: [], trees: [], podium: [] };
  const matrix = new Matrix4(), quat = new Quaternion(), pos = new Vector3(), scale = new Vector3(), up = new Vector3(0, 1, 0), tint = new Color();
  const mat = envMaterial(c.sh, { name: 'lombardia.architecture', family: 'inst', vertexColor: true, roughness: 0.85, wet: 0.7 }); materials.push(mat);
  const glassMat = envMaterial(c.sh, { name: 'lombardia.windows', family: 'inst', mode: EnvMode.Garage, color: 0x182127, vertexColor: true, emissive: 0xffd6a4, emissiveIntensity: 0, roughness: 0.25, wet: 0 }); materials.push(glassMat);
  const addInstances = (geo: BufferGeometry, material: MeshStandardMaterial, list: Site[], name: string): InstancedMesh => {
    geometries.push(geo); const mesh = new InstancedMesh(geo, material, Math.max(1, list.length)); mesh.name = name;
    list.forEach((site, k) => {
      quat.setFromAxisAngle(up, site.yaw); matrix.compose(pos.set(site.x, site.y, site.z), quat, scale.setScalar(site.scale));
      mesh.setMatrixAt(k, matrix); mesh.setColorAt(k, tint.setScalar(0.91 + (k % 5) * 0.045));
    });
    mesh.count = list.length; mesh.computeBoundingSphere(); mesh.receiveShadow = true;
    instances.push(mesh); root.add(mesh); return mesh;
  };
  for (const [kind, list] of [['villa', sites.villa], ['lodge', sites.lodges], ['podium', sites.podium]] as const) {
    const geo = architecture(kind), body = addInstances(geo.body, mat, list, `lombardia.${kind}`);
    body.castShadow = c.quality.id !== 'low'; architectureMeshes.push(body);
    addInstances(geo.glass, glassMat, list, `lombardia.${kind}.windows`);
  }
  const trees = addInstances(avenueGeometry(), mat, sites.trees, 'lombardia.planeTreeAvenues');
  const treeFrustum = new Frustum(), clip = new Matrix4(), treeSphere = new Sphere();
  trees.geometry.computeBoundingSphere(); trees.frustumCulled = false;
  trees.instanceMatrix.setUsage(DynamicDrawUsage); trees.instanceColor!.setUsage(DynamicDrawUsage);
  // The existing near forest supplies High shadows; the full avenue adds its shadows on Ultra.
  trees.castShadow = c.quality.id === 'ultra';

  // Merge only this track's existing surface/barrier chunks, retaining their exact vertices and attributes.
  const barrierMeshes: Mesh[] = [];
  for (const name of ['track.surface', 'barriers']) {
    const batches = new Map<MeshStandardMaterial, Mesh[]>();
    environment.getObjectByName(name)?.traverse((object) => {
      if (!(object instanceof Mesh) || Array.isArray(object.material)) return;
      const material = object.material as MeshStandardMaterial, list = batches.get(material) ?? [];
      list.push(object); batches.set(material, list);
    });
    for (const [material, originals] of batches) {
      const geo = mergeGeometries(originals.map((mesh) => mesh.geometry)); if (!geo) continue;
      geometries.push(geo); const mesh = new Mesh(geo, material); mesh.name = `lombardia.${name}.batched`; mesh.receiveShadow = true;
      if (name === 'barriers') { mesh.castShadow = c.quality.id === 'ultra'; barrierMeshes.push(mesh); }
      root.add(mesh); for (const original of originals) original.visible = false;
    }
  }

  const detail = new SBuf(), green = new Color(0.035, 0.095, 0.065), steel = new Color(0.24, 0.27, 0.25), cream = new Color(0.65, 0.62, 0.5);
  const reg = c.ex.reg;
  for (const feature of c.ex.features.filter((f) => f.kind === 'grandstand')) {
    const f = { ...feature, xz: feature.xz.map(([x, z]) => [(x - reg.cx) * reg.k, (z - reg.cz) * reg.k] as [number, number]) };
    const b = standBoxFrom(f, (x, z) => {
      const info = { s: 0, d: 0, covered: false, nearTrack: 0 }; c.ground!.height(x, z, info);
      const k = Math.round(info.s) % c.track.data.count; return [c.track.data.x[k]!, c.track.data.z[k]!];
    }, (x, z) => c.ground!.height(x, z));
    const rows = Math.max(4, Math.min(34, Math.floor((b.depth - 1) / 0.85))), ry = 1.6 + rows * 0.45 + 5;
    const o = { x: b.cx, y: b.y, z: b.cz }, half = b.length / 2;
    // Narrow fascia below the existing roof, with proud ribs above it (no coplanar overlays).
    boxInFrame(detail, o, [-half - 1, half + 1], [-4.16, -4.03], [ry - 0.55, ry + 0.72], b.ux, b.uz, b.vx, b.vz, green, true);
    for (let u = -half; u < half; u += 9) boxInFrame(detail, o, [u - 0.08, u + 0.08], [-4.2, rows * 0.85 + 1.5], [ry + 0.73, ry + 0.9], b.ux, b.uz, b.vx, b.vz, steel);
    for (let u = -half; u < half; u += 18) boxInFrame(detail, o, [u - 0.2, u + 0.2], [-4.19, -4.16], [ry - 0.3, ry + 0.4], b.ux, b.uz, b.vx, b.vz, cream);
  }
  const detailMat = envMaterial(c.sh, { name: 'lombardia.heritageSteel', family: 'opaque', vertexColor: true, roughness: 0.7, wet: 0.65 }); materials.push(detailMat);
  const detailGeo = detail.geometry(); geometries.push(detailGeo); root.add(new Mesh(detailGeo, detailMat));

  // Weathered construction joints and moss on the existing banking; positions and driving clearance stay intact.
  const ruins = environment.getObjectByName('ruins.concrete');
  if (ruins instanceof Mesh) {
    const geo = ruins.geometry, p = geo.getAttribute('position'), colors = geo.getAttribute('color');
    for (let k = 0; k < p.count; k++) {
      const n = Math.sin(p.getX(k) * 0.22) * Math.sin(p.getZ(k) * 0.16), seam = Math.abs(Math.sin(p.getX(k) * 0.53 + p.getZ(k) * 0.35));
      const shade = seam < 0.13 ? 0.6 : 0.85 + n * 0.18;
      colors.setXYZ(k, colors.getX(k) * shade, colors.getY(k) * (shade + 0.035), colors.getZ(k) * shade * 0.91);
    }
    colors.needsUpdate = true;
  }

  const rand = makeRand(6218), road = new SBuf(), litter = new SBuf(), court = new SBuf(), garden = new SBuf(), lamps = new SBuf();
  for (const site of sites.villa) {
    const ux = Math.cos(site.yaw), uz = -Math.sin(site.yaw), vx = -uz, vz = ux;
    const P = (u: number, v: number): number[] => {
      const x = site.x + ux * u + vx * v, z = site.z + uz * u + vz * v;
      return [x, c.ground!.height(x, z) + 0.026, z];
    };
    for (const side of [-1, 1]) {
      for (let u = -34; u < 34; u += 2) for (let v = 18; v < 24; v += 2) {
        court.quad([P(u, side * v), P(u + 2, side * v), P(u, side * (v + 2)), P(u + 2, side * (v + 2))], [0, 1, 0], new Color(1.5 + rand() * 0.15, 1.4, 1.13));
      }
      for (const u of [-33, 33]) {
        const p = P(u, side * 20), o = { x: p[0]!, y: p[1]!, z: p[2]! };
        boxInFrame(garden, o, [-0.09, 0.09], [-0.09, 0.09], [0, 5], ux, uz, vx, vz, steel);
        boxInFrame(garden, o, [-0.32, 0.32], [-0.32, 0.32], [4.8, 5.55], ux, uz, vx, vz, green);
        boxInFrame(lamps, o, [-0.23, 0.23], [-0.23, 0.23], [4.95, 5.4], ux, uz, vx, vz, cream);
      }
      for (const u of [-22, 22]) {
        const p = P(u, side * 26);
        boxInFrame(garden, { x: p[0]!, y: p[1]!, z: p[2]! }, [-9, 9], [-0.6, 0.6], [-0.4, 0.9], ux, uz, vx, vz, green);
      }
    }
  }
  for (const [buf, name, mode] of [[garden, 'gardenFurniture', EnvMode.Plain], [lamps, 'gardenLamps', EnvMode.Lamp]] as const) {
    const geo = buf.geometry(); geometries.push(geo);
    const material = envMaterial(c.sh, { name: `lombardia.${name}`, family: 'opaque', vertexColor: true, mode, emissive: mode === EnvMode.Lamp ? 0xffdfb0 : 0, emissiveIntensity: 0, wet: 0.3 }); materials.push(material);
    const mesh = new Mesh(geo, material); mesh.name = `lombardia.${name}`; root.add(mesh);
  }
  const lampMat = materials[materials.length - 1]!;
  const point = (s: number, d: number): number[] => { const p = { x: 0, y: 0, z: 0 }; c.track.query.worldFromSD(s, d, p); return [p.x, p.y + 0.015, p.z]; };
  const strip = (s: number, len: number, d: number, width: number, col: Color): void => {
    for (let a = s; a < s + len; a += 2) {
      const end = Math.min(a + 2, s + len), w0 = width * (0.15 + 0.85 * Math.sin(Math.PI * (a - s) / len)) / 2, w1 = width * (0.15 + 0.85 * Math.sin(Math.PI * (end - s) / len)) / 2;
      road.quad([point(a, d - w0), point(end, d - w1), point(a, d + w0), point(end, d + w1)], [0, 1, 0], col);
    }
  };
  for (let s = 80; s < c.track.data.length; s += 155 + rand() * 70) strip(s, 3 + rand() * 8, (rand() - 0.5) * 9, 0.8 + rand() * 1.6, new Color().setScalar(0.58 + rand() * 0.13));
  for (const corner of c.ex.authoring.CORNERS.filter((corner) => corner.vApex <= 200)) {
    for (const d of [-0.85, 0.85]) strip(corner.entry * c.ex.sScale - 86, 72, d, 0.12, new Color(0.15, 0.145, 0.14));
  }
  for (const site of sites.trees) for (let k = 0; k < 7; k++) {
    const x = site.x + (rand() - 0.5) * 15, z = site.z + (rand() - 0.5) * 15, size = 0.25 + rand() * 0.9;
    const P = (dx: number, dz: number): number[] => [x + dx, c.ground!.height(x + dx, z + dz) + 0.025, z + dz];
    litter.quad([P(-size, -size * 0.4), P(size, -size * 0.4), P(-size, size * 0.4), P(size, size * 0.4)], [0, 1, 0], new Color(0.18 + rand() * 0.12, 0.14 + rand() * 0.07, 0.045));
  }
  for (const [buf, name, map, normal] of [[road, 'roadWear', c.tex.asphalt.map, c.tex.asphalt.normal], [litter, 'leafLitter', c.tex.gravel.map, c.tex.gravel.normal], [court, 'palazzoCourt', c.tex.concrete.map, c.tex.concrete.normal]] as const) {
    const geo = buf.geometry(); geometries.push(geo);
    const material = envMaterial(c.sh, { name: `lombardia.${name}`, family: 'opaque', vertexColor: true, map, normalMap: normal, roughness: 0.9, wet: 0.9, polygonOffset: -1 }); materials.push(material);
    const mesh = new Mesh(geo, material); mesh.name = `lombardia.${name}`; mesh.receiveShadow = true; root.add(mesh);
  }

  const hazeTex = canvasTexture(128, 64, (g) => {
    g.clearRect(0, 0, 128, 64); g.scale(1, 0.5); const gradient = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gradient.addColorStop(0, 'rgba(210,204,178,0.13)'); gradient.addColorStop(0.6, 'rgba(210,204,178,0.05)'); gradient.addColorStop(1, 'rgba(210,204,178,0)');
    g.fillStyle = gradient; g.fillRect(0, 0, 128, 128);
  });
  const hazeMat = envMaterial(c.sh, { name: 'lombardia.lowlandHaze', family: 'inst', map: hazeTex, emissive: 0xb9b6a5, emissiveIntensity: 0.2, wet: 0, flood: 0 });
  hazeMat.transparent = true; hazeMat.depthWrite = false; materials.push(hazeMat);
  const hazeSites: Site[] = [];
  for (const s of [900, 2200, 3200, 4400]) {
    const p = { x: 0, y: 0, z: 0 }; c.track.query.worldFromSD(s * c.ex.sScale, 185, p);
    hazeSites.push({ ...p, y: c.ground!.height(p.x, p.z) + 10, yaw: 0, scale: 1 });
  }
  const haze = addInstances(new PlaneGeometry(1, 1), hazeMat, hazeSites, 'lombardia.lowlandHaze'); haze.frustumCulled = false; haze.renderOrder = 6;
  // Bake static architecture into two draws. Repeated trees retain their instanced draw, and the source nodes
  // remain inspectable for footprint QA. Every temporary transformed geometry is released immediately.
  const staticBatches = new Map<MeshStandardMaterial, Mesh[]>();
  for (const name of ['villa', 'lodge', 'podium']) for (const suffix of ['', '.windows']) {
    const object = root.getObjectByName(`lombardia.${name}${suffix}`)! as InstancedMesh;
    const material = suffix ? glassMat : mat, list = staticBatches.get(material) ?? [];
    list.push(object); staticBatches.set(material, list);
  }
  for (const name of ['gardenFurniture']) {
    const object = root.getObjectByName(`lombardia.${name}`)! as Mesh;
    staticBatches.get(mat)!.push(object);
  }
  environment.getObjectByName('buildings')?.traverse((object) => {
    if (object instanceof Mesh && !Array.isArray(object.material) && object.material.name === 'buildings.osm') staticBatches.get(mat)!.push(object);
  });
  const roofDetail = root.children.find((o) => o instanceof Mesh && o.geometry === detailGeo)! as Mesh;
  staticBatches.get(mat)!.push(roofDetail);
  const staticMeshes: Mesh[] = [];
  for (const [material, originals] of staticBatches) {
    const transformed: BufferGeometry[] = [];
    for (const original of originals) {
      if (original instanceof InstancedMesh) {
        for (let k = 0; k < original.count; k++) {
          original.getMatrixAt(k, matrix); const geo = original.geometry.clone(); geo.applyMatrix4(matrix);
          const colors = geo.getAttribute('color'); tint.fromBufferAttribute(original.instanceColor!, k);
          for (let i = 0; i < colors.count; i++) colors.setXYZ(i, colors.getX(i) * tint.r, colors.getY(i) * tint.g, colors.getZ(i) * tint.b);
          transformed.push(geo);
        }
      } else transformed.push(original.geometry.clone());
      original.visible = false;
    }
    const geo = mergeGeometries(transformed); for (const g of transformed) g.dispose();
    if (!geo) continue;
    geometries.push(geo); const mesh = new Mesh(geo, material); mesh.name = `lombardia.architecture.${material === mat ? 'solid' : 'glass'}`;
    mesh.receiveShadow = true; mesh.castShadow = material === mat && c.quality.id !== 'low'; staticMeshes.push(mesh); root.add(mesh);
  }
  return {
    root,
    applyConditions(cc) {
      glassMat.emissiveIntensity = cc.tod === 'night' ? 0.65 : cc.tod === 'sunset' ? 0.22 : 0;
      lampMat.emissiveIntensity = cc.tod === 'night' ? 5 : cc.tod === 'sunset' ? 1.3 : 0;
      hazeMat.opacity = cc.tod === 'night' ? 0.12 : cc.tod === 'sunset' ? 0.7 : 0.4 + cc.rain * 0.2;
      hazeMat.emissiveIntensity = cc.tod === 'night' ? 0.015 : 0.2;
      haze.visible = cc.tod !== 'night';
    },
    update(cam) {
      // Conservative whole-crown culling, with no distance LOD transition or allocation in the update path.
      cam.updateMatrixWorld(); clip.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse); treeFrustum.setFromProjectionMatrix(clip);
      let count = 0;
      for (let k = 0; k < sites.trees.length; k++) {
        const site = sites.trees[k]!; quat.setFromAxisAngle(up, site.yaw);
        matrix.compose(pos.set(site.x, site.y, site.z), quat, scale.setScalar(site.scale));
        treeSphere.copy(trees.geometry.boundingSphere!).applyMatrix4(matrix); treeSphere.radius += 2;
        if (c.quality.id !== 'ultra' && !treeFrustum.intersectsSphere(treeSphere)) continue;
        trees.setMatrixAt(count, matrix); trees.setColorAt(count, tint.setScalar(0.91 + (k % 5) * 0.045)); count++;
      }
      trees.count = count; trees.instanceMatrix.needsUpdate = true; trees.instanceColor!.needsUpdate = true;
      for (let k = 0; k < hazeSites.length; k++) {
        const site = hazeSites[k]!; quat.setFromAxisAngle(up, Math.atan2(cam.position.x - site.x, cam.position.z - site.z));
        matrix.compose(pos.set(site.x, site.y, site.z), quat, scale.set(230, 38, 1)); haze.setMatrixAt(k, matrix);
      }
      haze.instanceMatrix.needsUpdate = true;
    },
    setQuality(q) {
      trees.castShadow = q.id === 'ultra'; for (const mesh of architectureMeshes) mesh.castShadow = q.id !== 'low';
      for (const mesh of staticMeshes) mesh.castShadow = mesh.material === mat && q.id !== 'low';
      for (const mesh of barrierMeshes) mesh.castShadow = q.id === 'ultra';
    },
    dispose() {
      for (const mesh of instances) mesh.dispose(); for (const geo of geometries) geo.dispose(); for (const material of materials) material.dispose();
      hazeTex.dispose(); parkSites.delete(c); root.removeFromParent();
    },
  };
}
