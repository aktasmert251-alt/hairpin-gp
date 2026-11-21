// Ardennes-only presentation: rural clearings, valley haze and forest-edge race furniture.
import {
  BufferAttribute, Color, Group, IcosahedronGeometry, InstancedMesh, Matrix4, Mesh, PlaneGeometry, Quaternion, Vector3,
  type BufferGeometry, type MeshStandardMaterial, type Object3D,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { envMaterial, EnvMode } from '../../materials/shared';
import { canvasTexture, makeRand } from '../../mesh/textures';
import { boxInFrame, SBuf } from '../stands';
import type { EnvContext, EnvPart } from '../environment';

type RuralSite = { x: number; y: number; z: number; yaw: number; scale: number; barn: boolean };
const ruralSites = new WeakMap<EnvContext, RuralSite[]>();

/** Reserve actual footprints before the existing forest/building factories populate the scene. */
export function reserveArdennesSites(c: EnvContext): void {
  const list: RuralSite[] = [], p = { x: 0, y: 0, z: 0 };
  const info = { s: 0, d: 0, covered: false, nearTrack: 0 };
  const rand = makeRand(7319);
  const occupied = c.ex.features.filter((f) => f.kind === 'building').map((f) => {
    const x = f.xz.reduce((sum, v) => sum + v[0], 0) / f.xz.length;
    const z = f.xz.reduce((sum, v) => sum + v[1], 0) / f.xz.length;
    return { x: (x - c.ex.reg.cx) * c.ex.reg.k, z: (z - c.ex.reg.cz) * c.ex.reg.k };
  });
  for (const [s, side, count] of [[520, 1, 5], [2600, -1, 6], [4700, 1, 4], [5600, -1, 3]] as const) {
    const first = list.length;
    for (let k = 0; k < count; k++) {
      c.track.query.worldFromSD((s + (k - count / 2) * 26) * c.ex.sScale, side * (72 + (k % 2) * 27), p);
      const y = c.ground!.height(p.x, p.z, info);
      const i = Math.round(info.s) % c.track.data.count;
      const wall = info.d >= 0 ? c.track.data.wallL[i]! : c.track.data.wallR[i]!;
      if (info.covered || Math.abs(info.d) < wall + 28 || occupied.some((o) => Math.hypot(o.x - p.x, o.z - p.z) < 32)) continue;
      if (c.blockers.some((b) => {
        const dx = p.x - b.cx, dz = p.z - b.cz;
        return Math.abs(dx * b.ux + dz * b.uz) < b.hu + 14 && Math.abs(dx * b.uz - dz * b.ux) < b.hv + 14;
      })) continue;
      const heights = [-8, 8].flatMap((dx) => [-6, 6].map((dz) => c.ground!.height(p.x + dx, p.z + dz)));
      if (Math.max(...heights) - Math.min(...heights) > 3.6) continue;
      const yaw = 0.3 + rand() * 0.55, scale = 0.85 + rand() * 0.25;
      list.push({ x: p.x, y: Math.max(y, ...heights) + 0.05, z: p.z, yaw, scale, barn: k === count - 1 });
      c.blockers.push({ cx: p.x, cz: p.z, ux: Math.cos(yaw), uz: -Math.sin(yaw), hu: 11, hv: 9 });
    }
    if (s === 4700 && list.length - first >= 3) {
      c.track.query.worldFromSD(s * c.ex.sScale, side * 88, p);
      const next = { x: 0, y: 0, z: 0 }; c.track.query.worldFromSD(s * c.ex.sScale + 1, side * 88, next);
      const length = Math.hypot(next.x - p.x, next.z - p.z);
      c.blockers.push({ cx: p.x, cz: p.z, ux: (next.x - p.x) / length, uz: (next.z - p.z) / length, hu: 98, hv: 38 });
    }
  }
  ruralSites.set(c, list);
}

function ruralGeometry(barn: boolean): { body: BufferGeometry; windows: BufferGeometry } {
  const b = new SBuf(), glass = new SBuf(), o = { x: 0, y: 0, z: 0 };
  const stone = new Color(barn ? 0.22 : 0.43, barn ? 0.14 : 0.40, barn ? 0.08 : 0.34);
  const slate = new Color(0.095, 0.12, 0.14), wood = new Color(0.11, 0.065, 0.035), trim = new Color(0.58, 0.54, 0.43);
  const box = (u: [number, number], v: [number, number], y: [number, number], color: Color): void =>
    boxInFrame(b, o, u, v, y, 1, 0, 0, 1, color);
  box([-6, 6], [-4, 4], [-4, 0.5], new Color(0.24, 0.25, 0.22));
  box([-6, 6], [-4, 4], [0.5, 6], stone);
  for (const side of [-1, 1]) {
    b.quad([[-6.6, 5.9, side * 4.6], [6.6, 5.9, side * 4.6], [-6.6, 9, 0], [6.6, 9, 0]], [0, 0.8, side * 0.6], slate);
    b.quad([[side * 6, 6, -4], [side * 6, 6, 4], [side * 6, 9, 0], [side * 6, 9, 0]], [side, 0, 0], stone);
    box([-6.1, 6.1], [side * 4.02 - 0.09, side * 4.02 + 0.09], [2.95, 3.15], wood);
    for (const x of [-5.8, 5.8]) box([x - 0.2, x + 0.2], [side * 4.05 - 0.1, side * 4.05 + 0.1], [0.5, 6], trim);
    if (barn) {
      box([-2.2, 2.2], [side * 4.08 - 0.04, side * 4.08 + 0.04], [0.1, 3.9], wood);
      for (let x = -5.4; x < 6; x += 1.2) box([x - 0.035, x + 0.035], [side * 4.02 - 0.02, side * 4.02 + 0.02], [3.2, 5.9], trim);
    } else for (const x of [-3.6, 0, 3.6]) for (const y of [1.1, 4]) {
      const z = side * 4.04;
      glass.quad([[x - 0.65, y, z], [x + 0.65, y, z], [x - 0.65, y + 1.3, z], [x + 0.65, y + 1.3, z]], [0, 0, side], new Color(x === 0 ? 0.2 : 0.9, 0.65, 0.32));
      box([x - 0.85, x + 0.85], [side * 4.1 - 0.13, side * 4.1 + 0.13], [y - 0.13, y], trim);
      for (const dx of [-1, 1]) box([x + dx * 0.95 - 0.18, x + dx * 0.95 + 0.18], [side * 4.08 - 0.04, side * 4.08 + 0.04], [y, y + 1.3], wood);
    }
  }
  box([3.5, 4.3], [0.7, 1.5], [6, 10], new Color(0.26, 0.24, 0.21));
  return { body: b.geometry(), windows: glass.geometry() };
}

function marshalGeometry(): BufferGeometry {
  const b = new SBuf(), o = { x: 0, y: 0, z: 0 };
  const stone = new Color(0.3, 0.31, 0.29), wood = new Color(0.22, 0.13, 0.07), dark = new Color(0.055, 0.085, 0.1);
  const box = (u: [number, number], v: [number, number], y: [number, number], color: Color): void =>
    boxInFrame(b, o, u, v, y, 1, 0, 0, 1, color);
  box([-1.8, 1.8], [-1.5, 1.5], [-1.8, 0.45], stone);
  box([-1.65, 1.65], [-1.35, 1.35], [0.45, 1.65], wood);
  box([-1.65, 1.65], [-1.35, 1.35], [1.65, 2.4], dark);
  box([-2, 2], [-1.7, 1.7], [2.4, 2.65], wood);
  box([-1.45, -0.95], [-1.48, -1.4], [1.1, 2.3], new Color(0.65, 0.24, 0.035));
  for (const x of [-1.6, 0, 1.6]) box([x - 0.06, x + 0.06], [-1.42, 1.42], [1.65, 2.4], stone);
  // Slender lattice tower with a white lamp array; illumination uses the existing circuit light rig.
  for (const x of [3.6, 4.4]) for (const z of [-0.4, 0.4]) box([x - 0.055, x + 0.055], [z - 0.055, z + 0.055], [0, 22], stone);
  for (let y = 1; y < 22; y += 2) box([3.55, 4.45], [-0.45, 0.45], [y, y + 0.05], stone);
  box([2, 6], [-0.55, 0.55], [21.6, 22.2], dark);
  return b.geometry();
}

export function createArdennesDetails(c: EnvContext, environment: Object3D): EnvPart {
  const root = new Group(); root.name = 'ardennes.details';
  const geometries: BufferGeometry[] = [], materials: MeshStandardMaterial[] = [], instances: InstancedMesh[] = [];
  const matrix = new Matrix4(), quat = new Quaternion(), pos = new Vector3(), scale = new Vector3(), up = new Vector3(0, 1, 0);
  const rand = makeRand(9031), tint = new Color();
  const mat = envMaterial(c.sh, { name: 'ardennes.rural', family: 'inst', vertexColor: true, roughness: 0.88, wet: 0.85 }); materials.push(mat);
  const glassMat = envMaterial(c.sh, { name: 'ardennes.rural.windows', family: 'inst', mode: EnvMode.Garage, color: 0x182127, vertexColor: true, emissive: 0xffd2a0, emissiveIntensity: 0, roughness: 0.23, wet: 0 }); materials.push(glassMat);
  const addInstances = (geo: BufferGeometry, material: MeshStandardMaterial, sites: readonly RuralSite[], name: string): InstancedMesh => {
    geometries.push(geo);
    const mesh = new InstancedMesh(geo, material, Math.max(1, sites.length)); mesh.name = name;
    sites.forEach((site, i) => {
      quat.setFromAxisAngle(up, site.yaw);
      matrix.compose(pos.set(site.x, site.y, site.z), quat, scale.setScalar(site.scale));
      mesh.setMatrixAt(i, matrix); mesh.setColorAt(i, tint.setScalar(0.85 + (i % 5) * 0.065));
    });
    mesh.count = sites.length; mesh.computeBoundingSphere(); mesh.receiveShadow = true;
    instances.push(mesh); root.add(mesh); return mesh;
  };
  const rural = ruralSites.get(c) ?? [];
  for (const barn of [false, true]) {
    const g = ruralGeometry(barn), sites = rural.filter((site) => site.barn === barn);
    addInstances(g.body, mat, sites, barn ? 'ardennes.barns' : 'ardennes.cottages');
    if (!barn) addInstances(g.windows, glassMat, sites, 'ardennes.cottageWindows'); else g.windows.dispose();
  }

  // Presentation-only barrier batching keeps the forest views within the full-field draw-call budget.
  const batches = new Map<MeshStandardMaterial, Mesh[]>(), barrierMeshes: Mesh[] = [];
  environment.getObjectByName('barriers')?.traverse((object) => {
    if (!(object instanceof Mesh) || Array.isArray(object.material)) return;
    const material = object.material as MeshStandardMaterial;
    const list = batches.get(material) ?? []; list.push(object); batches.set(material, list);
  });
  for (const [material, originals] of batches) {
    const geo = mergeGeometries(originals.map((mesh) => mesh.geometry)); if (!geo) continue;
    geometries.push(geo); const mesh = new Mesh(geo, material); mesh.name = 'ardennes.barriers.batched';
    mesh.receiveShadow = true; mesh.castShadow = c.quality.id === 'ultra'; barrierMeshes.push(mesh); root.add(mesh);
    for (const original of originals) original.visible = false;
  }
  const surfaceBatches = new Map<MeshStandardMaterial, Mesh[]>();
  environment.getObjectByName('track.surface')?.traverse((object) => {
    if (!(object instanceof Mesh) || Array.isArray(object.material)) return;
    const material = object.material as MeshStandardMaterial;
    const list = surfaceBatches.get(material) ?? []; list.push(object); surfaceBatches.set(material, list);
  });
  for (const [material, originals] of surfaceBatches) {
    const geo = mergeGeometries(originals.map((mesh) => mesh.geometry)); if (!geo) continue;
    geometries.push(geo); const mesh = new Mesh(geo, material); mesh.name = 'ardennes.surface.batched'; mesh.receiveShadow = true; root.add(mesh);
    for (const original of originals) original.visible = false;
    if (material.name === 'track.verge') material.color.multiplyScalar(0.9);
    if (material.name === 'track.gravel') material.color.setRGB(0.94, 0.94, 0.85);
  }

  const info = { s: 0, d: 0, covered: false, nearTrack: 0 }, p = { x: 0, y: 0, z: 0 };
  const siteAt = (s: number, d: number, margin: number): RuralSite | null => {
    c.track.query.worldFromSD(s, d, p); const y = c.ground!.height(p.x, p.z, info);
    const i = Math.round(info.s) % c.track.data.count;
    const wall = info.d >= 0 ? c.track.data.wallL[i]! : c.track.data.wallR[i]!;
    if (info.covered || Math.abs(info.d) < wall + margin) return null;
    if (c.blockers.some((b) => Math.abs((p.x - b.cx) * b.ux + (p.z - b.cz) * b.uz) < b.hu + margin && Math.abs((p.x - b.cx) * b.uz - (p.z - b.cz) * b.ux) < b.hv + margin)) return null;
    return { x: p.x, y, z: p.z, yaw: rand() * Math.PI * 2, scale: 1, barn: false };
  };
  const marshalSites: RuralSite[] = [];
  for (let s = 380; s < c.track.data.length; s += 660) {
    const side = Math.floor(s / 660) % 2 ? 1 : -1, i = Math.round(s) % c.track.data.count;
    const wall = side > 0 ? c.track.data.wallL[i]! : c.track.data.wallR[i]!;
    const site = siteAt(s, side * (wall + 9), 6); if (site) marshalSites.push(site);
  }
  addInstances(marshalGeometry(), mat, marshalSites, 'ardennes.marshalShelters');
  const lamps = new SBuf();
  for (const x of [2.4, 3.3, 4.2, 5.1]) boxInFrame(lamps, { x, y: 21.68, z: -0.61 }, [-0.32, 0.32], [-0.035, 0.035], [0, 0.36], 1, 0, 0, 1, new Color(0.9, 0.94, 1), true);
  const lampMat = envMaterial(c.sh, { name: 'ardennes.towerLamps', family: 'inst', mode: EnvMode.Lamp, vertexColor: true, emissive: 0xffffff, emissiveIntensity: 0, wet: 0 }); materials.push(lampMat);
  addInstances(lamps.geometry(), lampMat, marshalSites, 'ardennes.towerLamps');

  const rockGeo = new IcosahedronGeometry(1, 0), colors: number[] = [];
  const vertices = rockGeo.getAttribute('position');
  for (let k = 0; k < vertices.count; k++) {
    const moss = vertices.getY(k) > 0.1;
    colors.push(moss ? 0.17 : 0.29, moss ? 0.22 : 0.30, moss ? 0.11 : 0.28);
  }
  rockGeo.setAttribute('color', new BufferAttribute(new Float32Array(colors), 3));
  geometries.push(rockGeo);
  const rocks: { site: RuralSite; size: number }[] = [];
  for (let s = 780; s < c.track.data.length - 400; s += 43) {
    for (const side of [-1, 1]) {
      const i = Math.round(s) % c.track.data.count, wall = side > 0 ? c.track.data.wallL[i]! : c.track.data.wallR[i]!;
      const site = siteAt(s, side * (wall + 9 + rand() * 6), 6);
      if (site) rocks.push({ site, size: rand() < 0.45 ? 0.3 + rand() * 0.6 : 1.5 + rand() * 2.5 });
    }
  }
  const rockMat = envMaterial(c.sh, { name: 'ardennes.mossyStone', family: 'inst', vertexColor: true, map: c.tex.gravel.map, normalMap: c.tex.gravel.normal, roughness: 0.88, wet: 1 }); materials.push(rockMat);
  const rockMesh = new InstancedMesh(rockGeo, rockMat, rocks.length); rockMesh.name = 'ardennes.outcrops';
  rocks.forEach(({ site, size }, i) => {
    quat.setFromAxisAngle(up, site.yaw); matrix.compose(pos.set(site.x, site.y + size * 0.1, site.z), quat, scale.set(size * 1.4, size * 0.85, size));
    rockMesh.setMatrixAt(i, matrix); rockMesh.setColorAt(i, tint.setScalar(0.75 + rand() * 0.4));
  });
  rockMesh.computeBoundingSphere(); rockMesh.receiveShadow = true; instances.push(rockMesh); root.add(rockMesh);

  const groundBuf = new SBuf(), road = new SBuf();
  const point = (s: number, d: number): number[] => { const out = { x: 0, y: 0, z: 0 }; c.track.query.worldFromSD(s, d, out); return [out.x, out.y + 0.012, out.z]; };
  const strip = (s: number, len: number, d: number, width: number, color: Color): void => {
    const half = (a: number): number => width * 0.5 * (width < 0.2 ? 0.1 + 0.9 * Math.sin(Math.PI * (a - s) / len) : 1);
    for (let a = s; a < s + len; a += 2) {
      const end = Math.min(a + 2, s + len);
      road.quad([point(a, d - half(a)), point(end, d - half(end)), point(a, d + half(a)), point(end, d + half(end))], [0, 1, 0], color);
    }
  };
  for (let s = 65; s < c.track.data.length; s += 120 + rand() * 90) strip(s, 4 + rand() * 10, (rand() - 0.5) * 8, 1 + rand() * 1.5, new Color().setScalar(0.5 + rand() * 0.15));
  for (const corner of c.ex.authoring.CORNERS.filter((corner) => corner.vApex < 180)) for (const d of [-1, 1]) strip(corner.entry * c.ex.sScale - 75, 60, d, 0.14, new Color(0.13, 0.125, 0.12));
  // Conforming gravel/dirt yards around the reserved buildings, beyond every driving surface.
  for (const site of rural) for (let x = -9; x < 9; x += 3) for (let z = -7; z < 7; z += 3) {
    const P = (dx: number, dz: number): number[] => [site.x + dx, c.ground!.height(site.x + dx, site.z + dz) + 0.018, site.z + dz];
    groundBuf.quad([P(x, z), P(x + 3, z), P(x, z + 3), P(x + 3, z + 3)], [0, 1, 0], new Color(0.31 + rand() * 0.08, 0.26, 0.19));
  }
  for (const [buf, name, map, normal] of [[road, 'ardennes.roadWear', c.tex.asphalt.map, c.tex.asphalt.normal], [groundBuf, 'ardennes.farmYards', c.tex.gravel.map, c.tex.gravel.normal]] as const) {
    const geo = buf.geometry(); geometries.push(geo);
    const material = envMaterial(c.sh, { name, family: 'opaque', vertexColor: true, map, normalMap: normal, roughness: 0.87, wet: 0.95, polygonOffset: -1 }); materials.push(material);
    const mesh = new Mesh(geo, material); mesh.name = name; mesh.receiveShadow = true; root.add(mesh);
  }
  const terrain = environment.getObjectByName('terrain.inner');
  if (terrain instanceof Mesh && !Array.isArray(terrain.material)) (terrain.material as MeshStandardMaterial).color.setHex(0xc4c9bb);

  const mistTex = canvasTexture(128, 64, (g) => {
    g.clearRect(0, 0, 128, 64); g.scale(1, 0.5); const gradient = g.createRadialGradient(64, 64, 1, 64, 64, 64);
    gradient.addColorStop(0, 'rgba(167,184,182,0.25)'); gradient.addColorStop(0.5, 'rgba(167,184,182,0.12)'); gradient.addColorStop(1, 'rgba(167,184,182,0)');
    g.fillStyle = gradient; g.fillRect(0, 0, 128, 128);
  });
  const mistGeo = new PlaneGeometry(1, 1); geometries.push(mistGeo);
  const mistMat = envMaterial(c.sh, { name: 'ardennes.valleyMist', family: 'inst', map: mistTex, emissive: 0x9aafac, emissiveIntensity: 0.2, wet: 0, flood: 0, roughness: 1 });
  mistMat.transparent = true; mistMat.depthWrite = false; mistMat.opacity = 0.65; materials.push(mistMat);
  const mistSites: RuralSite[] = [];
  for (const s of [850, 1050, 4200, 4450, 4750]) for (const side of [-1, 1]) {
    const site = siteAt(s * c.ex.sScale, side * 180, 100); if (site) { site.y += 12; mistSites.push(site); }
  }
  const mist = new InstancedMesh(mistGeo, mistMat, Math.max(1, mistSites.length)); mist.count = mistSites.length;
  for (let k = 0; k < mist.count; k++) mist.setColorAt(k, tint.setScalar(1));
  mist.name = 'ardennes.valleyMist'; mist.frustumCulled = false; mist.renderOrder = 6; instances.push(mist); root.add(mist);
  return {
    root,
    applyConditions(cc) {
      glassMat.emissiveIntensity = cc.tod === 'night' ? 0.85 : cc.tod === 'sunset' ? 0.3 : 0;
      lampMat.emissiveIntensity = cc.tod === 'night' ? 7 : cc.tod === 'sunset' ? 1.6 : 0;
      mistMat.opacity = cc.tod === 'night' ? 0.35 : 0.5 + cc.rain * 0.3;
      mistMat.emissiveIntensity = cc.tod === 'night' ? 0.02 : 0.2;
    },
    update(cam) {
      for (let k = 0; k < mistSites.length; k++) {
        const site = mistSites[k]!;
        quat.setFromAxisAngle(up, Math.atan2(cam.position.x - site.x, cam.position.z - site.z));
        matrix.compose(pos.set(site.x, site.y, site.z), quat, scale.set(140, 30, 1)); mist.setMatrixAt(k, matrix);
      }
      mist.instanceMatrix.needsUpdate = true;
    },
    setQuality(q) { for (const mesh of barrierMeshes) mesh.castShadow = q.id === 'ultra'; },
    dispose() {
      for (const mesh of instances) mesh.dispose(); for (const geo of geometries) geo.dispose(); for (const material of materials) material.dispose();
      mistTex.dispose(); ruralSites.delete(c); root.removeFromParent();
    },
  };
}
