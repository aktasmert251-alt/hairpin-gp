// Floodlights (S2-Ç2, report §7.12, rendering.md §5.2 night extras): instanced poles from THEME.lights (İstanbul 18 m
// floods every 30 m on alternating sides; Bosphorus 10 m warm street lamps every 25 m on both sides) (1 draw), emissive lamp faces for bloom (1 draw, EnvMode.Lamp), additive glow sprites (1 draw,
// raw shader) and a CPU-baked floodlight lightmap in world XZ sampled by every env material (materials/shared.ts).
// No dynamic or shadowed lights. Night: full; sunset: lightmap × 0.35, lamps × 0.5; day: hidden.

import {
  AdditiveBlending, BufferAttribute, BufferGeometry, Color, DataTexture, Group, InstancedBufferAttribute, InstancedBufferGeometry,
  InstancedMesh, LinearFilter, Matrix4, Mesh, NoColorSpace, Quaternion, RawShaderMaterial, RGBAFormat, Sphere, UnsignedByteType,
  Vector2, Vector3, type FogExp2,
} from 'three';
import type { Vec3 } from '../../contracts/common';
import type { TrackFrame } from '../../contracts/track';
import { envMaterial, EnvMode } from '../materials/shared';
import { NIGHT } from '../sky/rigs';
import { boxInFrame, SBuf } from './stands';
import type { EnvContext, EnvPart } from './environment';

const TEXEL = 0.8;
const FLOOD_COLOR = 0xe8f0ff;
/** 3,000 K street heads. */
const STREET_COLOR = 0xffc68a;
/** Street lamps: arm reach toward the track and the lamp pool size (σ along and across), m. */
const STREET_ARM = 2.6;
const STREET_POOL = 10;

/** Pole base (x, y, z), facing (fx, fz) toward the track, track tangent (tx, tz), pool centre on the track (cx, cz), throw (m),
 *  lamp height h; street lamps carry their own pool size. */
export interface FloodPole {
  x: number; y: number; z: number; fx: number; fz: number; tx: number; tz: number; cx: number; cz: number; throw: number; h: number;
  pool?: number;
}

/** Glow sprite shader, shared with the water light streaks (water.ts): uStretch scales the quad (1, 1 = round glow),
 *  uDrop hangs it below its anchor (streaks on the water), uOmni ignores the lamp direction. */
export const GLOW_VERT = /* glsl */ `
precision highp float;
attribute vec3 position;
attribute vec3 aPos;
attribute vec3 aDir;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform float uSize;
uniform vec2 uStretch;
uniform float uDrop;
uniform float uOmni;
varying vec2 vUv;
varying float vFog;
uniform float uFogDensity;
void main() {
  vUv = position.xy;
  vec4 mv = modelViewMatrix * vec4(aPos, 1.0);
  // The lamps are directional: the glow fades out when the face is seen edge-on or from behind (the housing would
  // otherwise cut a dark hole into the sprite).
  float facing = dot(normalize(mat3(modelViewMatrix) * aDir), normalize(-mv.xyz));
  float k = mix(smoothstep(-0.1, 0.45, facing), 1.0, uOmni);
  mv.xy += position.xy * uSize * uStretch * (0.35 + 0.65 * k);
  mv.y -= uDrop * 0.5 * uSize * uStretch.y;
  float d = -mv.z;
  vFog = exp(-uFogDensity * uFogDensity * d * d) * k;
  gl_Position = projectionMatrix * mv;
}`;

export const GLOW_FRAG = /* glsl */ `
precision highp float;
uniform vec3 uColor;
varying vec2 vUv;
varying float vFog;
void main() {
  float r2 = dot(vUv, vUv) * 4.0;
  float g = (exp(-r2 * 9.0) + 0.12 * exp(-r2 * 3.0)) * (1.0 - smoothstep(0.4, 1.0, r2));
  gl_FragColor = vec4(uColor * g * vFog, 1.0);
}`;

/** Pole sites: alternating sides, behind the wall, pit side avoided where the pit lane runs alongside. */
export function floodPoleSites(c: EnvContext): FloodPole[] {
  const { data, query: q } = c.track;
  const ex = c.ex;
  const ground = c.ground!;
  const f: TrackFrame = { s: 0, px: 0, py: 0, pz: 0, tx: 1, tz: 0, lx: 0, lz: -1, halfWidthL: 0, halfWidthR: 0, crossSlope: 0, curvature: 0, vCurvature: 0, grade: 0, sector: 0 };
  const P: Vec3 = { x: 0, y: 0, z: 0 };
  const lights = ex.authoring.THEME.lights;
  const street = lights.head === 'street';
  const n = Math.round(data.length / lights.spacing);
  const out: FloodPole[] = [];
  const decks = (ex.authoring.DECKS ?? []).map((dk) => [dk.from * ex.sScale, dk.to * ex.sScale] as const);
  const onDeck = (s: number): boolean => decks.some(([a, b]) => s >= a && s <= b);
  for (let k = 0; k < n; k++) {
    const s = (k * data.length) / n;
    // Tunnels (THEME.lights.skip, authoring basis): no poles over the bore.
    if (lights.skip?.some((r) => q.wrapS(s - r.from * ex.sScale) <= q.wrapS((r.to - r.from) * ex.sScale))) continue;
    const i = Math.round(s) % data.count;
    const pitAlong = ex.mainPitSp[i]! === ex.mainPitSp[i]!;
    const sides: (1 | -1)[] = pitAlong ? [(-ex.pitSide) as 1 | -1] : lights.bothSides ? [1, -1] : [k % 2 === 0 ? 1 : -1];
    q.frameAt(s, f);
    for (const side of sides) {
      const wall = side === 1 ? data.wallL[i]! : data.wallR[i]!;
      const hw = side === 1 ? f.halfWidthL : f.halfWidthR;
      // Street lamps light their own half of the road from just behind the wall; floods aim across the centre line.
      const aim = street ? 0.45 : 0.2;
      const back = street ? 1.2 : 2.5;
      q.worldFromSD(s, side * hw * aim, P);
      const cx = P.x, cz = P.z;
      q.worldFromSD(s, side * (wall + back), P);
      // Facing: toward the track (−side · left normal).
      out.push({
        // On an elevated deck (DECKS) the pole stands on the deck edge, not on the ground far below.
        x: P.x, y: onDeck(s) ? P.y : ground.height(P.x, P.z), z: P.z, fx: -side * f.lx, fz: -side * f.lz, tx: f.tx, tz: f.tz, cx, cz,
        throw: wall + back - hw * aim, h: lights.height, ...(street ? { pool: STREET_POOL } : {}),
      });
    }
  }
  return out;
}

/**
 * Bakes the floodlight lightmap: anisotropic Gaussian pools (along / across the track) aimed just across the centre
 * line, plus a faint wide halo. Texel r = sqrt(E / 1.6), gb = E-weighted mean direction to the lamps (xz).
 */
export function bakeFloodMap(poles: FloodPole[], box: [number, number, number, number]): { data: Uint8Array; w: number; h: number } {
  const [x0, z0, bw, bh] = box;
  const w = Math.min(2048, Math.ceil(bw / TEXEL));
  const h = Math.min(2048, Math.ceil(bh / TEXEL));
  const sx = bw / w, sz = bh / h;
  const E = new Float32Array(w * h);
  const DX = new Float32Array(w * h);
  const DZ = new Float32Array(w * h);
  const EY = new Float32Array(w * h);
  const HALO = 42, R = 3 * HALO;
  for (const p of poles) {
    // Pool centred on the track (just across the centre line); long throws spread the pool across.
    const cx = p.cx, cz = p.cz;
    const SA = p.pool ?? 15, SC = p.pool ?? Math.max(14, 0.75 * p.throw);
    const lx = p.x + p.fx * 2.4, lz = p.z + p.fz * 2.4;
    const i0 = Math.max(0, Math.floor((cx - R - x0) / sx)), i1 = Math.min(w - 1, Math.ceil((cx + R - x0) / sx));
    const j0 = Math.max(0, Math.floor((cz - R - z0) / sz)), j1 = Math.min(h - 1, Math.ceil((cz + R - z0) / sz));
    for (let j = j0; j <= j1; j++) {
      const z = z0 + (j + 0.5) * sz;
      for (let i = i0; i <= i1; i++) {
        const x = x0 + (i + 0.5) * sx;
        const dx = x - cx, dz = z - cz;
        const a = dx * p.tx + dz * p.tz;
        const b = dx * p.fx + dz * p.fz;
        const r2 = dx * dx + dz * dz;
        if (r2 > R * R) continue;
        const e = Math.exp(-(a * a) / (2 * SA * SA) - (b * b) / (2 * SC * SC)) + 0.12 * Math.exp(-r2 / (2 * HALO * HALO));
        if (e < 1e-3) continue;
        const ux = lx - x, uz = lz - z;
        const inv = 1 / Math.hypot(ux, p.h, uz);
        const k = j * w + i;
        E[k] = E[k]! + e;
        DX[k] = DX[k]! + e * ux * inv;
        DZ[k] = DZ[k]! + e * uz * inv;
        EY[k] = EY[k]! + e * p.y;
      }
    }
  }
  const data = new Uint8Array(w * h * 4);
  for (let k = 0; k < w * h; k++) {
    const e = E[k]!;
    data[k * 4] = Math.round(255 * Math.sqrt(Math.min(1, e / 1.6)));
    const dx = e > 1e-4 ? DX[k]! / e : 0, dz = e > 1e-4 ? DZ[k]! / e : 0;
    data[k * 4 + 1] = Math.round(255 * (0.5 + 0.5 * Math.max(-1, Math.min(1, dx))));
    data[k * 4 + 2] = Math.round(255 * (0.5 + 0.5 * Math.max(-1, Math.min(1, dz))));
    // a = height of the lit surface (E-weighted pole base y + 128 m, 1 m steps; 0 = no pool): the shader dims the pool
    // on ground far below it (the plateau under the Desert Cliff ramp), never above it.
    data[k * 4 + 3] = e > 1e-4 ? Math.max(1, Math.min(255, Math.round(EY[k]! / e + 128))) : 0;
  }
  return { data, w, h };
}

function poleGeometry(HEIGHT: number, street: boolean): BufferGeometry {
  const b = new SBuf();
  const o = { x: 0, y: 0, z: 0 };
  const steel = new Color(0.32, 0.33, 0.35);
  const dark = new Color(0.05, 0.05, 0.055);
  if (street) {
    // Slim street lamp: mast, arm toward the track, flat head housing.
    boxInFrame(b, o, [-0.12, 0.12], [-0.12, 0.12], [0, HEIGHT + 0.1], 1, 0, 0, 1, steel);
    boxInFrame(b, o, [-0.05, 0.05], [0, STREET_ARM], [HEIGHT - 0.05, HEIGHT + 0.05], 1, 0, 0, 1, steel, true);
    boxInFrame(b, o, [-0.28, 0.28], [STREET_ARM - 0.35, STREET_ARM + 0.45], [HEIGHT - 0.12, HEIGHT + 0.1], 1, 0, 0, 1, dark, true);
    return b.geometry();
  }
  // Local frame: u = x, v = z (toward the track), y up.
  boxInFrame(b, o, [-0.22, 0.22], [-0.22, 0.22], [0, HEIGHT + 0.4], 1, 0, 0, 1, steel);
  boxInFrame(b, o, [-0.08, 0.08], [0, 2.3], [HEIGHT - 0.35, HEIGHT - 0.15], 1, 0, 0, 1, steel, true);
  boxInFrame(b, o, [-1.7, 1.7], [2.0, 2.45], [HEIGHT - 0.8, HEIGHT + 1.1], 1, 0, 0, 1, dark, true);
  return b.geometry();
}

/** Lamp face: tilted ≈ 13° down toward the track, in front of the housing. */
function lampGeometry(HEIGHT: number, street: boolean): BufferGeometry {
  const g = new BufferGeometry();
  const y0 = HEIGHT - 0.7, y1 = HEIGHT + 1.0;
  const yl = HEIGHT - 0.13;
  // Street head: a downward-facing lens under the housing.
  const pos = street
    ? [0.24, yl, STREET_ARM - 0.3, -0.24, yl, STREET_ARM - 0.3, 0.24, yl, STREET_ARM + 0.4, -0.24, yl, STREET_ARM + 0.4]
    : [-1.6, y0, 2.5, 1.6, y0, 2.5, -1.6, y1, 2.9, 1.6, y1, 2.9];
  const ny = street ? -1 : -0.229, nz = street ? 0 : 0.973;
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array([0, ny, nz, 0, ny, nz, 0, ny, nz, 0, ny, nz]), 3));
  g.setAttribute('color', new BufferAttribute(new Float32Array(12).fill(1), 3));
  g.setIndex([0, 1, 2, 1, 3, 2]);
  g.computeBoundingSphere();
  return g;
}

export function createFloodlights(c: EnvContext): EnvPart & { poles: number } {
  const { data } = c.track;
  const poles = floodPoleSites(c);
  const L = c.ex.authoring.THEME.lights;
  const street = L.head === 'street';
  const HEIGHT = L.height;
  const COLOR = L.color ?? (street ? STREET_COLOR : FLOOD_COLOR);
  for (const p of poles) c.blockers.push({ cx: p.x, cz: p.z, ux: p.tx, uz: p.tz, hu: 3, hv: 3 });
  const group = new Group();
  group.name = 'floodlights';

  // ---- poles + lamp faces (2 instanced draws, shared `inst` program) ------------------------------------
  const poleGeo = poleGeometry(HEIGHT, street);
  const lampGeo = lampGeometry(HEIGHT, street);
  const poleMat = envMaterial(c.sh, { name: 'flood.poles', family: 'inst', vertexColor: true, roughness: 0.5, metalness: 0.6, wet: 0.5 });
  const lampMat = envMaterial(c.sh, { name: 'flood.lamps', family: 'inst', mode: EnvMode.Lamp, vertexColor: true, emissive: 0xffffff, roughness: 0.3, wet: 0, flood: 0 });
  const poleMesh = new InstancedMesh(poleGeo, poleMat, poles.length);
  const lampMesh = new InstancedMesh(lampGeo, lampMat, poles.length);
  poleMesh.name = 'flood.poles';
  lampMesh.name = 'flood.lamps';
  const m4 = new Matrix4();
  const qt = new Quaternion();
  const zAxis = new Vector3(0, 0, 1);
  const dir = new Vector3();
  const pos = new Vector3();
  const one = new Vector3(1, 1, 1);
  const white = new Color(1, 1, 1);
  const glowPos = new Float32Array(poles.length * 3);
  const glowDir = new Float32Array(poles.length * 3);
  poles.forEach((p, k) => {
    qt.setFromUnitVectors(zAxis, dir.set(p.fx, 0, p.fz));
    m4.compose(pos.set(p.x, p.y, p.z), qt, one);
    poleMesh.setMatrixAt(k, m4);
    lampMesh.setMatrixAt(k, m4);
    poleMesh.setColorAt(k, white);
    lampMesh.setColorAt(k, white);
    if (street) {
      glowPos.set([p.x + p.fx * (STREET_ARM + 0.05), p.y + HEIGHT - 0.3, p.z + p.fz * (STREET_ARM + 0.05)], k * 3);
      // Mostly downward, so it still faces a driver on the road below.
      glowDir.set([p.fx * 0.5, -0.866, p.fz * 0.5], k * 3);
    } else {
      glowPos.set([p.x + p.fx * 2.9, p.y + HEIGHT + 0.15, p.z + p.fz * 2.9], k * 3);
      // Lamp-face normal (13° down toward the track, see lampGeometry).
      glowDir.set([p.fx * 0.973, -0.229, p.fz * 0.973], k * 3);
    }
  });
  poleMesh.computeBoundingSphere();
  lampMesh.computeBoundingSphere();
  poleMesh.castShadow = c.quality.id !== 'low';
  poleMesh.receiveShadow = false;
  group.add(poleMesh, lampMesh);

  // ---- glow sprites (1 draw; raw shader → one program in every render target) ---------------------------
  const quad = new InstancedBufferGeometry();
  quad.setAttribute('position', new BufferAttribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, -0.5, 0.5, 0, 0.5, 0.5, 0]), 3));
  quad.setIndex([0, 1, 2, 1, 3, 2]);
  quad.setAttribute('aPos', new InstancedBufferAttribute(glowPos, 3));
  quad.setAttribute('aDir', new InstancedBufferAttribute(glowDir, 3));
  quad.instanceCount = poles.length;
  const glowMat = new RawShaderMaterial({
    name: 'flood.glow', vertexShader: GLOW_VERT, fragmentShader: GLOW_FRAG,
    uniforms: { uSize: { value: NIGHT.glowSize * (street ? 0.45 : 1) }, uStretch: { value: new Vector2(1, 1) }, uDrop: { value: 0 }, uOmni: { value: 0 }, uColor: { value: new Color() }, uFogDensity: { value: 0 } },
    transparent: true, depthWrite: false, blending: AdditiveBlending,
  });
  const glow = new Mesh(quad, glowMat);
  glow.name = 'flood.glow';
  glow.renderOrder = 10;
  {
    const sp = new Sphere();
    sp.setFromPoints(poles.map((p) => new Vector3(p.x, p.y + HEIGHT, p.z)));
    sp.radius += NIGHT.glowSize;
    quad.boundingSphere = sp;
  }
  group.add(glow);

  // ---- lightmap (baked lazily on the first sunset / night) ----------------------------------------------
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < data.count; i++) {
    minX = Math.min(minX, data.x[i]!); maxX = Math.max(maxX, data.x[i]!);
    minZ = Math.min(minZ, data.z[i]!); maxZ = Math.max(maxZ, data.z[i]!);
  }
  const M = 140;
  const box: [number, number, number, number] = [minX - M, minZ - M, maxX - minX + 2 * M, maxZ - minZ + 2 * M];
  let map: DataTexture | null = null;
  const ensureMap = (): void => {
    if (map) return;
    const baked = bakeFloodMap(poles, box);
    map = new DataTexture(baked.data, baked.w, baked.h, RGBAFormat, UnsignedByteType);
    map.colorSpace = NoColorSpace;
    map.magFilter = map.minFilter = LinearFilter;
    map.generateMipmaps = false;
    map.needsUpdate = true;
    c.sh.setFloodMap(map, box);
  };

  const lampCol = new Color();
  return {
    root: group,
    poles: poles.length,
    applyConditions(cc) {
      const k = cc.tod === 'night' ? 1 : cc.tod === 'sunset' ? NIGHT.sunsetFactor : 0;
      // Street lamps are street furniture: they stay by day (unlit); flood poles only exist for the night event.
      group.visible = k > 0 || street;
      glow.visible = k > 0;
      if (k > 0) ensureMap();
      c.sh.setFlood(NIGHT.FLOOD_GROUND_INTENSITY * k, COLOR, cc.tod === 'night' ? 1 : 0);
      const lampK = cc.tod === 'night' ? 1 : k > 0 ? 0.5 : 0;
      lampCol.setHex(COLOR).multiplyScalar(NIGHT.lampEmissive * lampK);
      for (let i = 0; i < poles.length; i++) lampMesh.setColorAt(i, lampCol);
      lampMesh.instanceColor!.needsUpdate = true;
      glowMat.uniforms.uColor!.value.setHex(COLOR).multiplyScalar(NIGHT.glowIntensity * lampK);
    },
    update() {
      const fog = c.ctx.scene.fog as FogExp2 | null;
      glowMat.uniforms.uFogDensity!.value = fog && 'density' in fog ? fog.density : 0;
    },
    setQuality(qp) {
      poleMesh.castShadow = qp.id !== 'low';
    },
    dispose() {
      poleGeo.dispose();
      lampGeo.dispose();
      quad.dispose();
      poleMat.dispose();
      lampMat.dispose();
      glowMat.dispose();
      poleMesh.dispose();
      lampMesh.dispose();
      map?.dispose();
      c.sh.setFloodMap(null, box);
      group.removeFromParent();
    },
  };
}
