// Volcano Rim extras (docs/design/tracks-volcano.md §6): molten lava (crater lake, the river under the bridge, the lava
// cone by the hairpin descent; EnvMode.Lava: drifting crust, glowing seams, pulsing), lava light on the track and the cars
// (two point lights that follow the camera to the nearest lava, flashing with the eruptions), one GPU particle system
// (embers over the lava, ash drifting across the rim, steam vents, the ash plume over the crater lit red from below,
// eruption bombs every 40–70 s), the tunnel through the crater wall (shared tunnel set, basalt), the bridge structure
// (deck, basalt piers), basalt column clusters and obsidian boulders, grey ash drifts on the racing surface.
// Empty group on every other track. Draws: lava 1, struct 1, rock 1, lamps 1, columns 1, ash 1, particles 1.

import {
  BufferAttribute, BufferGeometry, Color, Group, InstancedBufferAttribute, InstancedBufferGeometry, InstancedMesh, Matrix4, Mesh,
  NormalBlending, PointLight, Quaternion, RawShaderMaterial, Vector3, type FogExp2, type PerspectiveCamera,
} from 'three';
import type { RenderFrame } from '../../contracts/render';
import type { TrackFrame } from '../../contracts/track';
import { sst, tagS, vnoise, volcanoSites } from '../authoring/volcano-ctrl';
import { VOLC_BRIDGE, VOLC_TUNNEL } from '../authoring/volcano';
import { envMaterial, EnvMode, envUniforms } from '../materials/shared';
import { makeRand } from '../mesh/textures';
import type { EnvContext, EnvPart } from './environment';
import { boxInFrame, SBuf } from './stands';
import { buildTunnel } from './tunnel';

const TAU = Math.PI * 2;

/** Lava surface buffer: position, normal (up), uv in metres along / across the flow. */
class LavaBuf {
  pos: number[] = []; uv: number[] = []; idx: number[] = [];
  quad(p: number[][], uv: number[][]): void {
    const b = this.pos.length / 3;
    for (let k = 0; k < 4; k++) { this.pos.push(p[k]![0]!, p[k]![1]!, p[k]![2]!); this.uv.push(uv[k]![0]!, uv[k]![1]!); }
    // Wind the quad to face up.
    const ux = p[1]![0]! - p[0]![0]!, uz = p[1]![2]! - p[0]![2]!, vx = p[2]![0]! - p[0]![0]!, vz = p[2]![2]! - p[0]![2]!;
    if (uz * vx - ux * vz >= 0) this.idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
    else this.idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);
  }
  geometry(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(this.pos), 3));
    const n = new Float32Array(this.pos.length);
    for (let i = 1; i < n.length; i += 3) n[i] = 1;
    g.setAttribute('normal', new BufferAttribute(n, 3));
    g.setAttribute('uv', new BufferAttribute(new Float32Array(this.uv), 2));
    g.setAttribute('color', new BufferAttribute(new Float32Array(this.pos.length).fill(1), 3));
    g.setIndex(new BufferAttribute(new Uint32Array(this.idx), 1));
    g.computeBoundingSphere();
    return g;
  }
}

/** Basalt column (hexagonal prism, unit radius / height). */
function columnGeometry(): SBuf {
  const b = new SBuf();
  const side = new Color(0.075, 0.07, 0.068), top = new Color(0.1, 0.095, 0.09);
  for (let i = 0; i < 6; i++) {
    const a0 = (i / 6) * TAU, a1 = ((i + 1) / 6) * TAU, am = (a0 + a1) / 2;
    b.quad([[Math.cos(a0), -0.2, Math.sin(a0)], [Math.cos(a1), -0.2, Math.sin(a1)], [Math.cos(a0), 1, Math.sin(a0)], [Math.cos(a1), 1, Math.sin(a1)]], [Math.cos(am), 0, Math.sin(am)], side);
    b.quad([[0, 1.05, 0], [0, 1.05, 0], [Math.cos(a0), 1, Math.sin(a0)], [Math.cos(a1), 1, Math.sin(a1)]], [0, 1, 0], top);
  }
  return b;
}

const PVERT = /* glsl */ `
precision highp float;
attribute vec3 position;
attribute vec4 aSeed;   // type, seed, life, phase
attribute vec3 aOrigin;
attribute vec4 aVel;    // drift / launch velocity xyz, size
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform float uTime;
uniform float uErupt;   // s since the last eruption (large = none)
uniform float uNight;
uniform float uFogDensity;
varying vec2 vUv;
varying vec4 vCol;
varying float vFog;
float h1(float x) { return fract(sin(x * 91.17) * 43758.5453); }
void main() {
  float type = aSeed.x, seed = aSeed.y, life = aSeed.z;
  float age = fract(uTime / life + aSeed.w);
  vec3 p = aOrigin;
  float size = aVel.w;
  vec4 col = vec4(0.0);
  if (type < 0.5) {
    // Ember: rises off the lava with a wobble, cooling from yellow to dull red.
    p += vec3(sin(age * 9.0 + seed * 20.0) * 2.0, age * (12.0 + 28.0 * h1(seed)), cos(age * 7.0 + seed * 13.0) * 2.0);
    vec3 c = mix(vec3(6.0, 3.2, 0.8), vec3(2.4, 0.25, 0.02), age);
    col = vec4(c, (1.0 - age) * smoothstep(0.0, 0.08, age));
  } else if (type < 1.5) {
    // Ash flake: drifts on the breeze, settling.
    p += aVel.xyz * age * life + vec3(sin(age * 11.0 + seed * 30.0) * 1.5, -age * 6.0, 0.0);
    col = vec4(mix(vec3(0.22, 0.21, 0.2), vec3(0.55, 0.2, 0.08), uNight * 0.5), 0.55 * sin(age * 3.1416));
  } else if (type < 2.5) {
    // Steam column: rises and spreads.
    p += vec3(aVel.x * age * 14.0, age * 26.0, aVel.z * age * 14.0);
    size *= 0.35 + 1.4 * age;
    col = vec4(vec3(0.85, 0.85, 0.82) * mix(1.0, 0.12, uNight), mix(0.32, 0.2, uNight) * (1.0 - age) * smoothstep(0.0, 0.15, age));
  } else if (type < 3.5) {
    // Ash plume over the crater: climbs ~1 km, drifting downwind, lit red from below at night.
    p += vec3(aVel.x * age * 600.0, age * 950.0, aVel.z * age * 600.0) + vec3(sin(seed * 40.0), 0.0, cos(seed * 40.0)) * (20.0 + 120.0 * age);
    size *= 0.4 + 1.6 * age;
    vec3 c = mix(vec3(0.16, 0.15, 0.15), vec3(0.3, 0.28, 0.27), age) * mix(1.0, 0.12, uNight);
    // Lit from below by the lava: a red glow fading up the column (strong at night, a warm tint by day).
    c += vec3(1.5, 0.3, 0.06) * (1.0 - smoothstep(0.0, 0.55, age)) * mix(0.12, 0.85, uNight);
    col = vec4(c, 0.55 * smoothstep(0.0, 0.06, age) * (1.0 - smoothstep(0.75, 1.0, age)));
  } else if (type > 4.5) {
    // Glow over the lava lake: a slow, breathing orange haze that lights the crater air (strong at night).
    p += vec3(0.0, sin(age * 6.2832) * 4.0, 0.0);
    col = vec4(vec3(1.6, 0.42, 0.08) * mix(0.5, 1.0, uNight), 0.16 * mix(0.35, 1.0, uNight) * sin(age * 3.1416));
  } else {
    // Eruption bomb: ballistic arc during the first 7 s after an eruption.
    float t = uErupt - h1(seed) * 1.5;
    if (t > 0.0 && t < 7.0) {
      p += aVel.xyz * t + vec3(0.0, -4.9 * t * t, 0.0);
      col = vec4(vec3(7.0, 2.6, 0.5) * (1.0 - t / 7.0) + vec3(0.6, 0.1, 0.0), 1.0 - smoothstep(5.0, 7.0, t));
    }
  }
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  mv.xy += position.xy * size;
  float d = -mv.z;
  vFog = exp(-uFogDensity * uFogDensity * d * d);
  vUv = position.xy;
  vCol = col;
  gl_Position = projectionMatrix * mv;
}
`;
const PFRAG = /* glsl */ `
precision highp float;
uniform vec3 uFogColor;
varying vec2 vUv;
varying vec4 vCol;
varying float vFog;
void main() {
  float r = length(vUv);
  float a = vCol.a * (1.0 - smoothstep(0.35, 1.0, r));
  if (a < 0.004) discard;
  gl_FragColor = vec4(mix(uFogColor, vCol.rgb, vFog), a * mix(0.3, 1.0, vFog));
}
`;

export function createVolcano(c: EnvContext): EnvPart & { triangles: number; heatSources?: Float32Array } {
  const group = new Group();
  group.name = 'volcano';
  if (c.ex.authoring.id !== 'volcano') return { root: group, triangles: 0, dispose: () => group.removeFromParent() };
  const { data, query: q } = c.track;
  const ex = c.ex;
  const ground = c.ground!;
  const rand = makeRand(6113);
  const S = volcanoSites();
  const P = { x: 0, y: 0, z: 0 };
  const f: TrackFrame = { s: 0, px: 0, py: 0, pz: 0, tx: 1, tz: 0, lx: 0, lz: -1, halfWidthL: 0, halfWidthR: 0, crossSlope: 0, curvature: 0, vCurvature: 0, grade: 0, sector: 0 };
  // Raw (map) → world: authored tracks register 1:1 up to the centring offset.
  const wx = (x: number): number => (x - ex.reg.cx) * ex.reg.k;
  const wz = (z: number): number => (z - ex.reg.cz) * ex.reg.k;
  const geos: { dispose(): void }[] = [];
  const mats: { dispose(): void }[] = [];
  let tris = 0;
  const addMesh = (name: string, g: BufferGeometry, m: ReturnType<typeof envMaterial>, shadow: boolean): Mesh => {
    const mesh = new Mesh(g, m);
    mesh.name = name;
    mesh.castShadow = shadow;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
    geos.push(g);
    mats.push(m);
    tris += g.index!.count / 3;
    return mesh;
  };

  // ---- lava: crater lake (rings, flow outward), the river ribbon (flow downhill), the cone's pool ----
  const lava = new LavaBuf();
  const lavaPts: { x: number; y: number; z: number }[] = [];
  {
    const C = S.crater, cx = wx(C.x), cz = wz(C.z);
    const RINGS = 10, SEG = 64;
    for (let r = 0; r < RINGS; r++) {
      const r0 = (C.lake * r) / RINGS, r1 = (C.lake * (r + 1)) / RINGS;
      for (let k = 0; k < SEG; k++) {
        const a0 = (k / SEG) * TAU, a1 = ((k + 1) / SEG) * TAU;
        const v = (a: number, rr: number): number[] => [cx + Math.cos(a) * rr, C.lakeY, cz + Math.sin(a) * rr];
        lava.quad([v(a0, r0), v(a1, r0), v(a0, r1), v(a1, r1)], [[r0, a0 * 60], [r0, a1 * 60], [r1, a0 * 60], [r1, a1 * 60]]);
      }
    }
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * TAU;
      lavaPts.push({ x: cx + Math.cos(a) * C.lake * 0.8, y: C.lakeY + 30, z: cz + Math.sin(a) * C.lake * 0.8 });
    }
    const R = S.river;
    let u = 0;
    for (let k = 0; k + 1 < R.length; k++) {
      const a = R[k]!, b = R[k + 1]!;
      const l = Math.hypot(b.x - a.x, b.z - a.z);
      const nx = -(b.z - a.z) / l, nz = (b.x - a.x) / l;
      const W = 13;
      lava.quad([[wx(a.x) - nx * W, a.y, wz(a.z) - nz * W], [wx(b.x) - nx * W, b.y, wz(b.z) - nz * W], [wx(a.x) + nx * W, a.y, wz(a.z) + nz * W], [wx(b.x) + nx * W, b.y, wz(b.z) + nz * W]],
        [[u, -W], [u + l, -W], [u, W], [u + l, W]]);
      if (k % 3 === 0) lavaPts.push({ x: wx(a.x), y: a.y + 22, z: wz(a.z) });
      u += l;
    }
    const O = S.cone, ox = wx(O.x), oz = wz(O.z);
    const py = ground.dem(ox, oz) + 0.6;
    for (let k = 0; k < 24; k++) {
      const a0 = (k / 24) * TAU, a1 = ((k + 1) / 24) * TAU, rr = O.r * 0.42;
      lava.quad([[ox, py, oz], [ox, py, oz], [ox + Math.cos(a0) * rr, py, oz + Math.sin(a0) * rr], [ox + Math.cos(a1) * rr, py, oz + Math.sin(a1) * rr]], [[0, 0], [0, 0], [rr, a0 * 20], [rr, a1 * 20]]);
    }
    lavaPts.push({ x: ox, y: py + 18, z: oz });
    // Lava fissures beyond the barriers: short glowing streams running down the flanks, in view from the road.
    for (const [tag, off, d, len, wid] of [
      ['t7', 30, 34, 160, 4], ['crest', 40, -38, 140, 3.5], ['rim', 60, 30, 180, 4.5], ['rim', 300, 34, 150, 4], ['rim', 120, -36, 120, 3],
      ['vents', 20, 36, 160, 4], ['sweep', 150, -38, 170, 4], ['sw6', 30, 40, 150, 3.5], ['flank', 120, 36, 120, 3],
      ['sf', 120, -60, 160, 3.5], ['sw2', 20, -40, 150, 4], ['rim1', 10, 34, 140, 4], ['rimA', 10, 30, 90, 3],
      ['sw4', 20, -36, 150, 4], ['sw8', 10, 38, 150, 3.5], ['fixB', 20, -36, 120, 3.5], ['tunnel', 360, -32, 120, 4],
    ] as const) {
      const sBase = q.wrapS(tagS(tag, off) * ex.sScale);
      let u0 = 0;
      for (let k = 0; k < len / 6; k++) {
        const sa = q.wrapS(sBase + k * 6), sb = q.wrapS(sBase + (k + 1) * 6);
        const side = Math.sign(d);
        const ka = Math.round(sa) % data.count, kb = Math.round(sb) % data.count;
        const da = side * ((side > 0 ? data.wallL[ka]! : data.wallR[ka]!) + Math.abs(d) - 22 + 7 * (1 + Math.sin(k * 0.35 + off)));
        const db = side * ((side > 0 ? data.wallL[kb]! : data.wallR[kb]!) + Math.abs(d) - 22 + 7 * (1 + Math.sin((k + 1) * 0.35 + off)));
        const pa: number[][] = [], wv = wid * (0.7 + 0.5 * vnoise(k * 0.4, off));
        for (const [ss, dd] of [[sa, da - wv], [sb, db - wv], [sa, da + wv], [sb, db + wv]] as const) {
          q.worldFromSD(ss, dd, P);
          pa.push([P.x, ground.height(P.x, P.z) + 0.25, P.z]);
        }
        lava.quad(pa, [[u0, -wv], [u0 + 6, -wv], [u0, wv], [u0 + 6, wv]]);
        u0 += 6;
        if (k % 8 === 4) { q.worldFromSD(sa, da, P); lavaPts.push({ x: P.x, y: ground.height(P.x, P.z) + 14, z: P.z }); }
      }
    }
  }
  const lavaMat = envMaterial(c.sh, { name: 'volc.lava', family: 'opaque', mode: EnvMode.Lava, emissive: 0x000000, emissiveIntensity: 1, roughness: 0.9, wet: 0, flood: 0, param: 1 });
  addMesh('volc.lava', lava.geometry(), lavaMat, false);

  // ---- structures: tunnel (basalt), bridge (deck fascia, soffit, basalt piers) ----
  const st = new SBuf(), rock = new SBuf(), lamps = new SBuf();
  const basalt = (): Color => new Color(0.09, 0.085, 0.08).multiplyScalar(0.8 + 0.4 * rand());
  buildTunnel(c, st, rock, lamps, VOLC_TUNNEL.from, VOLC_TUNNEL.to, () => 32, () => basalt());
  {
    const s0 = q.wrapS(VOLC_BRIDGE.from * ex.sScale), s1 = q.wrapS(VOLC_BRIDGE.to * ex.sScale);
    const conc = new Color(0.5, 0.48, 0.46), soffit = new Color(0.3, 0.29, 0.28);
    const at = (s: number, d: number, y: number): number[] => { q.worldFromSD(s, d, P); return [P.x, P.y + y, P.z]; };
    for (let s = s0; s < s1; s += 4) {
      const e = Math.min(s1, s + 4);
      q.frameAt(s, f);
      const L0 = data.wallL[Math.round(s)]! + 0.6, R0 = -data.wallR[Math.round(s)]! - 0.6;
      const L1 = data.wallL[Math.round(e)]! + 0.6, R1 = -data.wallR[Math.round(e)]! - 0.6;
      st.quad([at(s, R0, -2.6), at(e, R1, -2.6), at(s, L0, -2.6), at(e, L1, -2.6)], [0, -1, 0], soffit);
      st.quad([at(s, L0, -2.6), at(e, L1, -2.6), at(s, L0, 0), at(e, L1, 0)], [f.lx, 0, f.lz], conc);
      st.quad([at(e, R1, -2.6), at(s, R0, -2.6), at(e, R1, 0), at(s, R0, 0)], [-f.lx, 0, -f.lz], conc);
    }
    // Two basalt piers either side of the river, down to the valley floor.
    for (const t of [0.3, 0.7]) {
      const s = s0 + (s1 - s0) * t;
      q.frameAt(s, f);
      q.worldFromSD(s, 0, P);
      const top = P.y - 2.6, gy = ground.dem(P.x, P.z) - 2;
      boxInFrame(rock, { x: P.x, y: gy, z: P.z }, [-3, 3], [-5.5, 5.5], [0, top - gy], f.tx, f.tz, f.lx, f.lz, new Color(0.08, 0.075, 0.07));
    }
  }

  // ---- basalt column clusters (tunnel portals, the hairpins, the spiral) and obsidian boulders by the rim ----
  type Inst = { x: number; y: number; z: number; r: number; h: number; col: Color };
  const cols: Inst[] = [];
  const info = { s: 0, d: 0, covered: false, nearTrack: 0 };
  const clear = (x: number, z: number): boolean => {
    ground.height(x, z, info);
    if (info.covered || info.nearTrack > 0.25) return false;
    const k = Math.round(info.s) % data.count;
    return Math.abs(info.d) > (info.d >= 0 ? data.wallL[k]! : data.wallR[k]!) + 3;
  };
  const cluster = (x: number, z: number, R: number, n: number, hMax: number): void => {
    for (let k = 0, tries = 0; k < n && tries < n * 8; tries++) {
      const a = rand() * TAU, r = Math.sqrt(rand()) * R;
      const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
      if (!clear(px, pz)) continue;
      const h = hMax * (0.35 + 0.65 * (1 - r / R)) * (0.7 + 0.3 * rand());
      cols.push({ x: px, y: ground.height(px, pz) - 0.5, z: pz, r: 0.9 + 0.5 * rand(), h, col: new Color(1, 1, 1).multiplyScalar(0.8 + 0.4 * rand()) });
      k++;
    }
  };
  const sd = (tag: string, off: number, d: number): [number, number] => {
    const s = q.wrapS(tagS(tag, off) * ex.sScale);
    q.worldFromSD(s, d, P);
    return [P.x, P.z];
  };
  for (const [tag, off, d, R, n, h] of [
    ['tunnel', -10, 14, 22, 40, 16], ['tunnel', -10, -14, 22, 40, 16], ['tunnel', 330, 14, 20, 30, 14], ['tunnel', 330, -14, 20, 30, 14],
    ['hp1', 30, -30, 26, 30, 10], ['hp2', 30, 30, 26, 30, 10], ['hp3', 30, 40, 30, 40, 14], ['sp1', 30, -30, 24, 30, 10],
    ['t1', 30, 40, 24, 24, 8], ['crest', 60, -26, 20, 20, 9], ['vents', 40, 26, 20, 18, 8], ['sweep', 120, -30, 24, 24, 9],
  ] as const) {
    const [x, z] = sd(tag, off, d);
    cluster(x, z, R, n, h);
  }
  // Obsidian boulders scattered on the rim and flanks (glassy, near-black).
  for (let k = 0, tries = 0; k < 160 && tries < 3000; tries++) {
    const s = rand() * data.length, side = rand() < 0.5 ? 1 : -1;
    const k2 = Math.round(s) % data.count;
    q.worldFromSD(s, side * ((side > 0 ? data.wallL[k2]! : data.wallR[k2]!) + 6 + rand() * 60), P);
    if (!clear(P.x, P.z)) continue;
    cols.push({ x: P.x, y: ground.height(P.x, P.z) - 0.6, z: P.z, r: 1.2 + 2 * rand(), h: 0.9 + 1.6 * rand(), col: new Color(0.35, 0.35, 0.42) });
    k++;
  }
  const colGeo = columnGeometry().geometry();
  const colMat = envMaterial(c.sh, { name: 'volc.columns', family: 'inst', vertexColor: true, roughness: 0.55, metalness: 0.1, wet: 0.6, flood: 0.8 });
  const colMesh = new InstancedMesh(colGeo, colMat, Math.max(1, cols.length));
  colMesh.name = 'volc.columns';
  const m4 = new Matrix4(), qt = new Quaternion(), up = new Vector3(0, 1, 0), pv = new Vector3(), sv = new Vector3();
  cols.forEach((o, k) => {
    qt.setFromAxisAngle(up, rand() * TAU);
    m4.compose(pv.set(o.x, o.y, o.z), qt, sv.set(o.r, o.h, o.r));
    colMesh.setMatrixAt(k, m4);
    colMesh.setColorAt(k, o.col);
  });
  colMesh.count = cols.length;
  colMesh.castShadow = c.quality.id !== 'low';
  colMesh.receiveShadow = true;
  colMesh.computeBoundingSphere();
  group.add(colMesh);
  geos.push(colGeo);
  mats.push(colMat);
  tris += (cols.length * colGeo.index!.count) / 3;

  // ---- grey ash drifts on the racing surface (ASH ranges), ragged edges ----
  const ash = new SBuf();
  for (const a of ex.ash) {
    for (let s = a.from; s < a.to; s += 2) {
      const e = Math.min(a.to, s + 2);
      const fade = Math.min(1, (s - a.from) / 12, (a.to - e) / 12);
      for (let k = -6; k < 6; k++) {
        const n = vnoise(s / 6, k * 0.7 + 3);
        if (n * fade < 0.4) continue;
        const d0 = k + 0.05 + 0.4 * (vnoise(s / 3, k) - 0.5), d1 = k + 1 + 0.4 * (vnoise(s / 3, k + 1) - 0.5);
        const yy = (ss: number, dd: number): number[] => { q.worldFromSD(ss, dd, P); return [P.x, P.y + 0.025, P.z]; };
        const g = 0.17 + 0.06 * vnoise(s / 2, k + 9);
        ash.quad([yy(s, d0), yy(e, d0), yy(s, d1), yy(e, d1)], [0, 1, 0], new Color(g, g * 0.97, g * 0.94));
      }
    }
  }
  const ashMat = envMaterial(c.sh, { name: 'volc.ash', family: 'opaque', vertexColor: true, roughness: 1, wet: 0.7, flood: 1, polygonOffset: -2 });
  if (ash.pos.length) addMesh('volc.ash', ash.geometry(), ashMat, false);
  else mats.push(ashMat);

  addMesh('volc.struct', st.geometry(), envMaterial(c.sh, { name: 'volc.struct', family: 'opaque', vertexColor: true, map: c.tex.concrete.map, normalMap: c.tex.concrete.normal, roughness: 0.85, wet: 0.5 }), true);
  addMesh('volc.rock', rock.geometry(), envMaterial(c.sh, { name: 'volc.rock', family: 'opaque', vertexColor: true, map: c.tex.dirt.map, normalMap: c.tex.concrete.normal, roughness: 0.75, wet: 0.5 }), true);
  const lampMat = envMaterial(c.sh, { name: 'volc.lamps', family: 'opaque', mode: EnvMode.Lamp, vertexColor: true, emissive: 0xffffff, emissiveIntensity: 3, roughness: 0.3, wet: 0, flood: 0 });
  addMesh('volc.lamps', lamps.geometry(), lampMat, false);

  // ---- particles: embers, ash, steam, plume, eruption bombs (one draw) ----
  type Pt = { type: number; x: number; y: number; z: number; vx: number; vy: number; vz: number; size: number; life: number };
  const pts: Pt[] = [];
  const C = S.crater, ccx = wx(C.x), ccz = wz(C.z);
  const pq = c.quality.id;
  const scale = pq === 'low' ? 0.35 : pq === 'medium' ? 0.6 : pq === 'ultra' ? 1.6 : 1;
  for (let k = 0; k < 1400 * scale; k++) {
    const L = lavaPts[Math.floor(rand() * lavaPts.length)]!;
    pts.push({ type: 0, x: L.x + (rand() - 0.5) * 40, y: L.y - 5, z: L.z + (rand() - 0.5) * 40, vx: 0, vy: 0, vz: 0, size: 0.25 + 0.35 * rand(), life: 3 + 4 * rand() });
  }
  for (let k = 0; k < 400 * scale; k++) {
    const a = rand() * TAU, r = Math.sqrt(rand()) * C.lake;
    pts.push({ type: 0, x: ccx + Math.cos(a) * r, y: C.lakeY, z: ccz + Math.sin(a) * r, vx: 0, vy: 0, vz: 0, size: 0.6 + 0.8 * rand(), life: 4 + 4 * rand() });
  }
  for (let k = 0; k < 1100 * scale; k++) {
    const s = rand() * data.length;
    q.worldFromSD(s, (rand() - 0.5) * 120, P);
    pts.push({ type: 1, x: P.x, y: P.y + 2 + 12 * rand(), z: P.z, vx: 2.5 + rand(), vy: 0, vz: -1 + 2 * rand(), size: 0.12 + 0.12 * rand(), life: 8 + 6 * rand() });
  }
  for (const [tag, off, d] of [['vents', 20, 22], ['vents', 60, -24], ['sweep', 40, 30], ['rim', 60, -26], ['rim', 300, -30], ['rimA', 20, -28], ['t7', 20, 30], ['spiral', 60, -24], ['tunnel', 360, 22], ['hp3', 10, 30]] as const) {
    const [x, z] = sd(tag, off, d);
    const y = ground.height(x, z);
    for (let k = 0; k < 30 * Math.min(1, scale + 0.2); k++) pts.push({ type: 2, x: x + (rand() - 0.5) * 3, y, z: z + (rand() - 0.5) * 3, vx: 0.3 + 0.2 * rand(), vy: 0, vz: -0.2 + 0.4 * rand(), size: 2 + 2 * rand(), life: 5 + 3 * rand() });
  }
  for (let k = 0; k < 140; k++) {
    pts.push({ type: 3, x: ccx + (rand() - 0.5) * 80, y: C.lakeY + 10, z: ccz + (rand() - 0.5) * 80, vx: 0.8, vy: 0, vz: -0.3, size: 70 + 60 * rand(), life: 50 + 20 * rand() });
  }
  for (let k = 0; k < 40; k++) {
    const a = rand() * TAU, r = Math.sqrt(rand()) * C.lake * 0.9;
    pts.push({ type: 5, x: ccx + Math.cos(a) * r, y: C.lakeY + 15 + 40 * rand(), z: ccz + Math.sin(a) * r, vx: 0, vy: 0, vz: 0, size: 50 + 50 * rand(), life: 9 + 6 * rand() });
  }
  for (let k = 0; k < 220; k++) {
    const a = rand() * TAU, sp = 12 + 30 * rand();
    pts.push({ type: 4, x: ccx + (rand() - 0.5) * 60, y: C.lakeY + 2, z: ccz + (rand() - 0.5) * 60, vx: Math.cos(a) * sp, vy: 30 + 45 * rand(), vz: Math.sin(a) * sp, size: 0.8 + 1.6 * rand(), life: 1 });
  }
  const pg = new InstancedBufferGeometry();
  pg.setAttribute('position', new BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, -1, 1, 0, 1, 1, 0]), 3));
  pg.setIndex([0, 1, 2, 2, 1, 3]);
  const seedA = new Float32Array(pts.length * 4), origA = new Float32Array(pts.length * 3), velA = new Float32Array(pts.length * 4);
  pts.forEach((p, k) => {
    seedA.set([p.type, rand(), p.life, rand()], k * 4);
    origA.set([p.x, p.y, p.z], k * 3);
    velA.set([p.vx, p.vy, p.vz, p.size], k * 4);
  });
  pg.setAttribute('aSeed', new InstancedBufferAttribute(seedA, 4));
  pg.setAttribute('aOrigin', new InstancedBufferAttribute(origA, 3));
  pg.setAttribute('aVel', new InstancedBufferAttribute(velA, 4));
  pg.instanceCount = pts.length;
  const pMat = new RawShaderMaterial({
    vertexShader: PVERT, fragmentShader: PFRAG, transparent: true, depthWrite: false, blending: NormalBlending,
    uniforms: { uTime: { value: 0 }, uErupt: { value: 1e4 }, uNight: { value: 0 }, uFogDensity: { value: 0 }, uFogColor: { value: new Color() } },
  });
  const pMesh = new Mesh(pg, pMat);
  pMesh.name = 'volc.particles';
  pMesh.frustumCulled = false;
  pMesh.renderOrder = 5;
  group.add(pMesh);
  geos.push(pg);
  mats.push(pMat);
  tris += pts.length * 2;

  // ---- lava light: two point lights at the nearest lava to the camera ----
  const lights = [new PointLight(0xff5a1e, 0, 380, 2), new PointLight(0xff6a24, 0, 380, 2)];
  for (const l of lights) { l.castShadow = false; group.add(l); }
  const craterLight = { x: ccx, y: C.lakeY + 40, z: ccz };
  let lightK = 1;
  // Eruptions: deterministic schedule from the clock (every 40–70 s).
  const eruptAt = (t: number): number => {
    let e = 25;
    let k = 0;
    let last = -1e4;
    while (e <= t && k < 100000) { last = e; e += 40 + 30 * vnoise(k * 0.731, 1.7); k++; }
    return t - last;
  };
  let night = 0;

  // Heat sources for the shimmer pass: lava points brought down to 4 m over the surface.
  const heatSources = new Float32Array(lavaPts.length * 3);
  lavaPts.forEach((L, k) => heatSources.set([L.x, ground.height(L.x, L.z) + 4, L.z], k * 3));

  return {
    root: group,
    triangles: tris,
    heatSources,
    update(cam: PerspectiveCamera, frame: RenderFrame) {
      const t = frame.time;
      const since = eruptAt(t);
      const flash = since < 8 ? Math.exp(-since * 0.6) : 0;
      pMat.uniforms.uTime!.value = t;
      pMat.uniforms.uErupt!.value = since;
      const fog = c.ctx.scene.fog as FogExp2 | null;
      pMat.uniforms.uFogDensity!.value = fog && 'density' in fog ? fog.density : 0;
      if (fog) (pMat.uniforms.uFogColor!.value as Color).copy(fog.color);
      envUniforms(lavaMat).uApxP.value.x = (night > 0.5 ? 1.35 : 1) * (1 + 1.6 * flash);
      // Nearest two lava points (the crater light during an eruption).
      let b0 = -1, b1 = -1, d0 = Infinity, d1 = Infinity;
      for (let k = 0; k < lavaPts.length; k++) {
        const L = lavaPts[k]!;
        const d = (L.x - cam.position.x) ** 2 + (L.z - cam.position.z) ** 2;
        if (d < d0) { d1 = d0; b1 = b0; d0 = d; b0 = k; } else if (d < d1) { d1 = d; b1 = k; }
      }
      const base = (night > 0.5 ? 9000 : 2200) * lightK;
      const put = (l: PointLight, k: number, d: number): void => {
        const L = k >= 0 ? lavaPts[k]! : craterLight;
        l.position.set(L.x, L.y, L.z);
        l.intensity = base * (1 - sst(200, 380, Math.sqrt(d))) * (0.9 + 0.1 * Math.sin(t * 7 + k));
      };
      put(lights[0]!, b0, d0);
      if (flash > 0.02) {
        lights[1]!.position.set(craterLight.x, craterLight.y, craterLight.z);
        lights[1]!.intensity = 60000 * flash * lightK;
      } else put(lights[1]!, b1, d1);
    },
    applyConditions(cc) {
      night = cc.tod === 'night' ? 1 : cc.tod === 'sunset' ? 0.4 : 0;
      pMat.uniforms.uNight!.value = night;
      lampMat.emissiveIntensity = cc.tod === 'day' ? 1.5 : 3;
    },
    setQuality(qp) {
      colMesh.castShadow = qp.id !== 'low';
      lightK = qp.id === 'low' ? 0 : 1;
    },
    dispose() {
      for (const g of geos) g.dispose();
      for (const m of mats) m.dispose();
      colMesh.dispose();
      group.removeFromParent();
    },
  };
}
