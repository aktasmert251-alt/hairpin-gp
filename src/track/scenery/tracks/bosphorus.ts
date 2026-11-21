// Bosphorus-only dressing. Reads presentation instances; never changes track or collision data.
import { Color, Group, InstancedMesh, Matrix4, Mesh, type BufferGeometry, type MeshStandardMaterial, type Object3D } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { envMaterial, envUniforms } from '../../materials/shared';
import { canvasTexture, makeRand } from '../../mesh/textures';
import { boxInFrame, SBuf } from '../stands';
import { localToWorld } from '../water';
import type { EnvContext, EnvPart } from '../environment';

/** Relief in the same unit frame as skyline.street, so every trim follows its exact building footprint. */
function facadeRelief(style: number): BufferGeometry {
  const b = new SBuf(), o = { x: 0, y: 0, z: 0 };
  const stone = new Color(0.62, 0.57, 0.46), timber = new Color(0.14, 0.075, 0.04);
  const iron = new Color(0.045, 0.055, 0.06), roof = new Color(0.24, 0.095, 0.055);
  const box = (u: [number, number], v: [number, number], y: [number, number], col: Color): void =>
    boxInFrame(b, o, u, v, y, 1, 0, 0, 1, col, true);
  // Projecting cornices, stone plinth and roof cap break the blank block silhouette on all four faces.
  for (const y of [0.13, 0.32, 0.51, 0.70, 0.89, 1]) {
    for (const side of [-1, 1]) {
      box([-0.52, 0.52], [side * 0.5 - 0.018, side * 0.5 + 0.018], [y, y + 0.014], style === 1 ? timber : stone);
      box([side * 0.5 - 0.018, side * 0.5 + 0.018], [-0.5, 0.5], [y, y + 0.014], stone);
    }
  }
  if (style !== 2) {
    // Hipped tiled roof, no copied building silhouette.
    const P = (x: number, y: number, z: number): number[] => [x, y, z];
    for (const side of [-1, 1]) {
      b.quad([P(-0.54, 1.02, side * 0.54), P(0.54, 1.02, side * 0.54), P(-0.32, 1.16, 0), P(0.32, 1.16, 0)], [0, 0.9, side * 0.4], roof);
      b.quad([P(side * 0.54, 1.02, -0.54), P(side * 0.54, 1.02, 0.54), P(side * 0.32, 1.16, 0), P(side * 0.32, 1.16, 0)], [side * 0.8, 0.6, 0], roof);
    }
  }
  for (const side of [-1, 1]) {
    for (const x of [-0.48, -0.16, 0.16, 0.48]) {
      box([x - 0.008, x + 0.008], [side * 0.505 - 0.012, side * 0.505 + 0.012], [0.14, 1], style === 1 ? timber : stone);
    }
    for (const y of [0.32, 0.51, 0.70]) {
      // Timber bay or open steel balcony, set proud of the original facade.
      const v: [number, number] = side > 0 ? [0.51, 0.61] : [-0.61, -0.51];
      box([-0.29, 0.29], v, [y, y + 0.018], stone);
      for (const x of [-0.27, 0, 0.27]) box([x - 0.006, x + 0.006], [side * 0.60 - 0.006, side * 0.60 + 0.006], [y, y + 0.068], iron);
      box([-0.28, 0.28], [side * 0.60 - 0.006, side * 0.60 + 0.006], [y + 0.064, y + 0.072], iron);
    }
    // Striped shop awnings and scalloped valances, above the existing shop windows.
    for (let k = 0; style !== 2 && k < 12; k++) {
      const x0 = -0.46 + k * 0.077, x1 = x0 + 0.077;
      const col = k % 2 ? stone : new Color(style === 1 ? 0.31 : 0.035, style === 1 ? 0.045 : 0.14, 0.065);
      b.quad([[x0, 0.17, side * 0.505], [x1, 0.17, side * 0.505], [x0, 0.135, side * 0.66], [x1, 0.135, side * 0.66]], [0, 0.85, side * 0.3], col);
      box([x0, x1], [side * 0.655 - 0.004, side * 0.655 + 0.004], [0.115, 0.136], col);
    }
  }
  return b.geometry();
}

function promenadeKit(): BufferGeometry {
  const b = new SBuf(), o = { x: 0, y: 0, z: 0 };
  const metal = new Color(0.045, 0.065, 0.07), wood = new Color(0.28, 0.14, 0.065), pale = new Color(0.65, 0.59, 0.46);
  const box = (u: [number, number], v: [number, number], y: [number, number], col: Color): void =>
    boxInFrame(b, o, u, v, y, 1, 0, 0, 1, col, true);
  for (const x of [-1, 1]) box([x - 0.08, x + 0.08], [-0.3, 0.3], [0, 0.48], metal);
  for (let k = 0; k < 4; k++) box([-1.3, 1.3], [-0.32 + k * 0.17, -0.2 + k * 0.17], [0.47, 0.54], wood);
  for (const y of [0.72, 0.91]) box([-1.3, 1.3], [0.30, 0.37], [y, y + 0.12], wood);
  box([2, 2.6], [-0.3, 0.3], [0, 0.95], metal);
  box([1.96, 2.64], [-0.34, 0.34], [0.95, 1.02], pale);
  // Street flag: fictional two-colour pennant, no emblems or text.
  box([-3.04, -2.96], [-0.04, 0.04], [0, 6.4], metal);
  box([-2.98, -1.45], [-0.025, 0.025], [4.1, 5.2], new Color(0.34, 0.045, 0.055));
  box([-2.98, -1.45], [-0.03, 0.03], [5.2, 5.6], pale);
  box([5.94, 6.06], [-0.06, 0.06], [0, 5.3], metal);
  box([5.65, 6.35], [-0.35, 0.35], [5.3, 5.42], metal);
  box([5.72, 6.28], [-0.28, 0.28], [4.8, 4.9], metal);
  return b.geometry();
}

export function createBosphorusDetails(c: EnvContext, environment: Object3D): EnvPart {
  const root = new Group(); root.name = 'bosphorus.details';
  const geometries: BufferGeometry[] = [], meshes: InstancedMesh[] = [], materials: MeshStandardMaterial[] = [];
  const mat = envMaterial(c.sh, { name: 'bosphorus.relief', family: 'inst', vertexColor: true, roughness: 0.82, wet: 0.65 });
  materials.push(mat);
  const m = new Matrix4(), white = new Color(1, 1, 1);
  // The shore view sees many 400 m barrier cells simultaneously. Batch compatible static meshes for this track only.
  // Originals retain ownership of their materials/geometries; this part owns and releases only the merged copies.
  const barrierBatches = new Map<MeshStandardMaterial, Mesh[]>();
  environment.getObjectByName('barriers')?.traverse((object) => {
    if (!(object instanceof Mesh) || Array.isArray(object.material)) return;
    const material = object.material as MeshStandardMaterial;
    const list = barrierBatches.get(material) ?? []; list.push(object); barrierBatches.set(material, list);
  });
  const batchedBarriers: Mesh[] = [];
  for (const [material, originals] of barrierBatches) {
    const geo = mergeGeometries(originals.map((mesh) => mesh.geometry));
    if (!geo) continue;
    geometries.push(geo);
    const mesh = new Mesh(geo, material); mesh.name = 'bosphorus.barriers.batched';
    mesh.receiveShadow = true; mesh.castShadow = c.quality.id === 'ultra';
    batchedBarriers.push(mesh); root.add(mesh);
    for (const original of originals) original.visible = false;
  }
  // The city has long open sightlines: coalesce its short surface strips by material as well.
  const surfaceBatches = new Map<MeshStandardMaterial, Mesh[]>();
  environment.getObjectByName('track.surface')?.traverse((object) => {
    if (!(object instanceof Mesh) || Array.isArray(object.material)) return;
    const material = object.material as MeshStandardMaterial;
    const list = surfaceBatches.get(material) ?? []; list.push(object); surfaceBatches.set(material, list);
  });
  for (const [material, originals] of surfaceBatches) {
    const geo = mergeGeometries(originals.map((mesh) => mesh.geometry));
    if (!geo) continue;
    geometries.push(geo);
    const mesh = new Mesh(geo, material); mesh.name = 'bosphorus.surface.batched'; mesh.receiveShadow = true;
    root.add(mesh);
    for (const original of originals) original.visible = false;
  }
  const street = environment.getObjectByName('skyline.street');
  if (street instanceof InstancedMesh) {
    for (let style = 0; style < 3; style++) {
      const geo = facadeRelief(style); geometries.push(geo);
      const mesh = new InstancedMesh(geo, mat, Math.ceil(street.count / 3));
      mesh.name = `bosphorus.facade.${style}`;
      let n = 0;
      for (let k = style; k < street.count; k += 3) {
        street.getMatrixAt(k, m); mesh.setMatrixAt(n, m); mesh.setColorAt(n++, white);
      }
      mesh.count = n; mesh.computeBoundingSphere(); mesh.receiveShadow = true;
      meshes.push(mesh); root.add(mesh);
    }
  }

  const rand = makeRand(8403);
  const kitGeo = promenadeKit(); geometries.push(kitGeo);
  const kits = new InstancedMesh(kitGeo, mat, 70); kits.name = 'bosphorus.promenade.furniture';
  const groundInfo = { s: 0, d: 0, covered: false, nearTrack: 0 };
  let count = 0;
  if (c.ex.local) {
    const [x0, z0] = localToWorld(c.ex, 0, 0), [x1, z1] = localToWorld(c.ex, 1, 0);
    const yaw = Math.atan2(-(z1 - z0), x1 - x0);
    for (let u = -570; u < 1100; u += 28) {
      const [x, z] = localToWorld(c.ex, u, -7);
      const y = c.ground!.height(x, z, groundInfo);
      if (groundInfo.covered || y < -0.1) continue;
      const i = Math.round(groundInfo.s) % c.track.data.count;
      const wall = groundInfo.d > 0 ? c.track.data.wallL[i]! : c.track.data.wallR[i]!;
      if (Math.abs(groundInfo.d) < wall + 6) continue;
      m.makeRotationY(yaw); m.setPosition(x, y + 0.05, z);
      kits.setMatrixAt(count, m); kits.setColorAt(count++, white);
    }
  }
  kits.count = count; kits.computeBoundingSphere(); kits.receiveShadow = true; root.add(kits); meshes.push(kits);

  const lantern = new SBuf();
  boxInFrame(lantern, { x: 6, y: 4.9, z: 0 }, [-0.21, 0.21], [-0.21, 0.21], [0, 0.37], 1, 0, 0, 1, new Color(1, 0.76, 0.47), true);
  const lanternGeo = lantern.geometry(); geometries.push(lanternGeo);
  const lampMat = envMaterial(c.sh, { name: 'bosphorus.quayLanterns', family: 'inst', vertexColor: true, emissive: 0xffcf91, emissiveIntensity: 0, wet: 0 }); materials.push(lampMat);
  const lamps = new InstancedMesh(lanternGeo, lampMat, Math.max(1, count));
  for (let k = 0; k < count; k++) { kits.getMatrixAt(k, m); lamps.setMatrixAt(k, m); lamps.setColorAt(k, white); }
  lamps.count = count; lamps.computeBoundingSphere(); root.add(lamps); meshes.push(lamps);

  const quay = new SBuf();
  if (c.ex.local) {
    const [ax, az] = localToWorld(c.ex, 0, 0), [bx, bz] = localToWorld(c.ex, 1, 0);
    const ux = bx - ax, uz = bz - az, vx = uz, vz = -ux;
    for (let u = -570; u < 1100; u += 6) {
      const [x, z] = localToWorld(c.ex, u + 3, -11);
      const y = c.ground!.height(x, z, groundInfo);
      if (groundInfo.covered || y < -0.1) continue;
      const o = { x, y: y + 0.025, z };
      boxInFrame(quay, o, [-2.98, 2.98], [-1.7, 1.7], [-0.03, 0], ux, uz, vx, vz, new Color(u % 12 === 0 ? 0.38 : 0.44, 0.39, 0.35));
      for (const a of [-2.8, 2.8]) boxInFrame(quay, o, [a - 0.035, a + 0.035], [1.75, 1.82], [0, 1.1], ux, uz, vx, vz, new Color(0.05, 0.075, 0.08));
      for (const h of [0.55, 1.05]) boxInFrame(quay, o, [-3, 3], [1.75, 1.82], [h, h + 0.06], ux, uz, vx, vz, new Color(0.05, 0.075, 0.08));
    }
    for (const u of [-490, 670]) {
      const [x, z] = localToWorld(c.ex, u, -28);
      const o = { x, y: -0.1, z };
      boxInFrame(quay, o, [-3, 3], [-14, 14], [-0.45, 0], ux, uz, vx, vz, new Color(0.19, 0.12, 0.07));
      for (const a of [-2.7, 2.7]) for (const v of [-12, -4, 4, 12]) {
        boxInFrame(quay, o, [a - 0.13, a + 0.13], [v - 0.13, v + 0.13], [-3, 0.8], ux, uz, vx, vz, new Color(0.055, 0.065, 0.065));
      }
    }
  }
  const quayGeo = quay.geometry(); geometries.push(quayGeo);
  const quayMat = envMaterial(c.sh, { name: 'bosphorus.quayStone', family: 'opaque', vertexColor: true, roughness: 0.8, wet: 0.9 }); materials.push(quayMat);
  const paving = new Mesh(quayGeo, quayMat); paving.receiveShadow = true; root.add(paving);

  // Conforming road overlays, raised only 12 mm and polygon-offset to avoid depth conflict.
  const road = new SBuf();
  const point = (s: number, d: number): number[] => {
    const p = { x: 0, y: 0, z: 0 }; c.track.query.worldFromSD(s, d, p); return [p.x, p.y + 0.012, p.z];
  };
  const strip = (s: number, len: number, d: number, w: number, color: Color): void => {
    for (let a = s; a < s + len; a += 2) road.quad([point(a, d - w / 2), point(Math.min(a + 2, s + len), d - w / 2), point(a, d + w / 2), point(Math.min(a + 2, s + len), d + w / 2)], [0, 1, 0], color);
  };
  for (let s = 80; s < c.track.data.length; s += 87 + rand() * 60) {
    strip(s, 3 + rand() * 9, (rand() - 0.5) * 7, 0.8 + rand() * 1.8, new Color().setScalar(0.46 + rand() * 0.18));
    if (rand() > 0.55) strip(s, 13, -3.9, 0.035, new Color(0.09, 0.085, 0.08));
  }
  for (const corner of c.ex.authoring.CORNERS) {
    const start = corner.entry * c.track.data.length / c.ex.authoring.OSM_LENGTH - 70;
    for (const d of [-1.0, 1.0]) strip(start, 48, d, 0.14, new Color(0.12, 0.115, 0.11));
  }
  const roadGeo = road.geometry(); geometries.push(roadGeo);
  const roadMat = envMaterial(c.sh, { name: 'bosphorus.roadWear', family: 'opaque', vertexColor: true, map: c.tex.asphalt.map, normalMap: c.tex.asphalt.normal, roughnessMap: c.tex.asphalt.rough, roughness: 0.88, polygonOffset: -1 });
  materials.push(roadMat);
  const wear = new Mesh(roadGeo, roadMat); wear.name = 'bosphorus.roadWear'; wear.receiveShadow = true; root.add(wear);

  const foam = canvasTexture(128, 128, (g) => {
    g.clearRect(0, 0, 128, 128);
    const noise = makeRand(82);
    for (let k = 0; k < 1700; k++) {
      const x = noise() * 128, y = noise() * 128;
      g.fillStyle = `rgba(206,223,218,${0.3 + noise() * 0.65})`;
      g.fillRect(x, y, 1 + noise() * 4, 1 + noise() * 2);
    }
  });
  const wake = new SBuf();
  for (const side of [-1, 1]) {
    const base = wake.pos.length / 3;
    wake.quad([[-28, 0.09, side * 3], [-94, 0.09, side * 15], [-28, 0.09, side * 4], [-94, 0.09, side * 19]], [0, 1, 0], new Color(0.48, 0.56, 0.54));
    wake.uv.splice(base * 2, 8, 0, 0, 1, 0, 0, 1, 1, 1);
  }
  const wakeGeo = wake.geometry(); geometries.push(wakeGeo);
  const wakeMat = envMaterial(c.sh, { name: 'bosphorus.ferryWakes', family: 'instCutout', map: foam, alphaTest: 0.42, roughness: 0.55, wet: 0, flood: 0.3 }); materials.push(wakeMat);
  const ferries = environment.getObjectByName('water.ferries');
  const wakes = new InstancedMesh(wakeGeo, wakeMat, ferries instanceof InstancedMesh ? ferries.count : 0);
  wakes.name = 'bosphorus.ferryWakes'; wakes.frustumCulled = false;
  for (let k = 0; k < wakes.count; k++) wakes.setColorAt(k, white);
  meshes.push(wakes); root.add(wakes);
  return {
    root,
    applyConditions(cc) {
      lampMat.emissiveIntensity = cc.tod === 'night' ? 2.4 : cc.tod === 'sunset' ? 0.7 : 0;
      // Existing window and dome shaders, adjusted only for this track after their original conditions handlers.
      const facades = environment.getObjectByName('skyline.blocks');
      if (facades instanceof InstancedMesh) envUniforms(facades.material as MeshStandardMaterial).uApxP.value.x = cc.tod === 'night' ? 2.1 : cc.tod === 'sunset' ? 0.6 : 0;
    },
    setQuality(q) { for (const mesh of batchedBarriers) mesh.castShadow = q.id === 'ultra'; },
    update() {
      if (!(ferries instanceof InstancedMesh)) return;
      for (let k = 0; k < ferries.count; k++) { ferries.getMatrixAt(k, m); wakes.setMatrixAt(k, m); }
      wakes.instanceMatrix.needsUpdate = true;
    },
    dispose() {
      foam.dispose();
      for (const mesh of meshes) mesh.dispose();
      for (const geo of geometries) geo.dispose();
      for (const material of materials) material.dispose();
      root.removeFromParent();
    },
  };
}
