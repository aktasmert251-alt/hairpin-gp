// GPU particle pool (docs/design/rendering.md §8.1). One InstancedBufferGeometry per family; motion is analytic in
// the vertex shader: p(t) = p0 + v0·(1 − e^(−k·t))/k + ½·g·t². The CPU only writes newly spawned slots in a ring
// and uploads them with addUpdateRange(). No per-frame integration, no allocation.

import {
  AdditiveBlending, BufferAttribute, type Blending, DynamicDrawUsage, InstancedBufferAttribute, InstancedBufferGeometry, Mesh, NormalBlending,
  ShaderMaterial, type Texture, Vector2,
} from 'three';

export type ParticleKind = 'billboard' | 'streak';

export interface PoolOptions {
  max: number;
  kind: ParticleKind;
  drag: number;
  gravity: number;
  /** Flipbook texture (4×4 cells) for billboards; streaks use a procedural gradient. */
  map: Texture | null;
  blending: Blending;
  /** Soft-particle fade distance (m). */
  softFade: number;
  /** Ground bounce restitution (sparks), 0 = none. */
  bounce: number;
  name: string;
  /** Near-camera fade [start, end] in m of view depth (default 0.3–0.8; big spray billboards fade earlier). */
  nearFade?: [number, number];
  /** QC2-10: billboards stretch along their screen-projected horizontal launch velocity by this many seconds (0 = round). */
  stretch?: number;
}

const VERT = /* glsl */ `
#include <common>
attribute vec3 aP0;
attribute vec3 aV0;
attribute vec4 aTime;      // birth, life, size0, size1
attribute vec4 aColor;     // rgb (linear, may be HDR), alpha0
attribute vec3 aExtra;     // rotation, flipbook cell, ground y
uniform float uTime;
uniform float uDrag;
uniform float uGravity;
uniform float uBounce;
uniform float uStreak;
uniform float uStretch;
varying vec2 vUv;
varying vec4 vColor;
varying float vViewZ;
varying float vT;
varying float vFogDepth;
void main() {
  float t = uTime - aTime.x;
  float life = aTime.y;
  if (t < 0.0 || t > life) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  float k = max(uDrag, 1e-3);
  float e = exp(-k * t);
  vec3 p = aP0 + aV0 * (1.0 - e) / k + vec3(0.0, -0.5 * uGravity * t * t, 0.0);
  vec3 vel = aV0 * e + vec3(0.0, -uGravity * t, 0.0);
  float gy = aExtra.z;
  if (uBounce > 0.0 && p.y < gy) { p.y = gy + (gy - p.y) * uBounce; vel.y = -vel.y * uBounce; }
  float u = t / life;
  vT = u;
  float size = mix(aTime.z, aTime.w, 1.0 - (1.0 - u) * (1.0 - u));
  vec4 mv = viewMatrix * vec4(p, 1.0);
  vec2 corner = position.xy; // -0.5..0.5
  if (uStreak > 0.5) {
    // Streak along the screen-space velocity: length = speed × 0.025 s, width = size.
    vec3 vv = (viewMatrix * vec4(vel, 0.0)).xyz;
    float len = max(0.02, length(vel) * 0.025);
    vec2 dir = length(vv.xy) > 1e-4 ? normalize(vv.xy) : vec2(1.0, 0.0);
    vec2 side = vec2(dir.y, -dir.x); // (side, dir) must keep the quad winding (det = +1)
    mv.xyz += vec3(dir * corner.y * len - dir * 0.5 * len + side * corner.x * size, 0.0);
    vUv = corner + 0.5;
  } else {
    float r = aExtra.x + t * 0.6 * (fract(aExtra.x * 13.1) - 0.5);
    float c = cos(r), s = sin(r);
    vec2 q = vec2(c * corner.x - s * corner.y, s * corner.x + c * corner.y) * size;
    // QC2-10: consecutive puffs of a fast car overlap into one plume: scale the quad along the screen-projected launch
    // direction (positive scale, so the winding is kept).
    vec2 hv = (viewMatrix * vec4(aV0.x, 0.0, aV0.z, 0.0)).xy;
    float hl = length(hv);
    if (uStretch > 0.0 && hl > 1e-3) {
      vec2 sd = hv / hl;
      q += sd * dot(q, sd) * (uStretch * hl / size);
    }
    mv.xy += q;
    float cell = aExtra.y;
    vUv = (corner + 0.5 + vec2(mod(cell, 4.0), floor(cell / 4.0))) * 0.25;
  }
  vColor = aColor;
  vViewZ = mv.z;
  vFogDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = /* glsl */ `
#include <common>
#include <packing>
uniform sampler2D uMap;
uniform sampler2D uDepth;
uniform vec2 uRes;
uniform float uNear;
uniform float uFar;
uniform float uSoft;
uniform float uStreak;
uniform vec3 uLight;
uniform vec2 uNearFade;
uniform vec4 uFog; // rgb fog colour (linear), FogExp2 density
varying float vFogDepth;
varying vec2 vUv;
varying vec4 vColor;
varying float vViewZ;
varying float vT;
void main() {
  float a;
  vec3 col;
  if (uStreak > 0.5) {
    // HDR spark: #fff1c0 ×8 → #ff8a2a ×3 → 0, bright head fading along the streak.
    vec3 hot = vec3(1.0, 0.88, 0.53) * 8.0;
    vec3 warm = vec3(1.0, 0.25, 0.02) * 3.0;
    col = mix(hot, warm, smoothstep(0.0, 0.6, vT)) * (1.0 - smoothstep(0.6, 1.0, vT));
    float across = 1.0 - abs(vUv.x - 0.5) * 2.0;
    a = across * mix(0.25, 1.0, vUv.y);
    col *= vColor.rgb;
  } else {
    vec4 tex = texture2D(uMap, vUv);
    // Round mask inside the flipbook cell: a billboard never shows its square outline, even when huge on screen.
    vec2 lc = fract(vUv * 4.0) - 0.5;
    a = tex.a * vColor.a * (1.0 - vT) * (1.0 - vT) * (1.0 - smoothstep(0.1, 0.5, length(lc)));
    col = vColor.rgb * uLight * mix(0.85, 1.05, tex.r);
    // Same FogExp2 as the scene (the FX scene has no fog of its own).
    float fd = uFog.w * vFogDepth;
    col = mix(col, uFog.rgb, 1.0 - exp(-fd * fd));
  }
  // Soft particles (Medium+) or near-camera fade (Low).
  if (uSoft > 0.0) {
    float d = unpackRGBAToDepth(texture2D(uDepth, gl_FragCoord.xy / uRes));
    float sceneZ = perspectiveDepthToViewZ(d, uNear, uFar);
    a *= smoothstep(0.0, uSoft, vViewZ - sceneZ);
  }
  a *= smoothstep(uNearFade.x, uNearFade.y, -vViewZ);
  if (a < 0.002) discard;
  gl_FragColor = vec4(col * (uStreak > 0.5 ? a : 1.0), uStreak > 0.5 ? 1.0 : a);
}
`;

export class ParticlePool {
  readonly mesh: Mesh;
  readonly max: number;
  private readonly geo: InstancedBufferGeometry;
  private readonly p0: InstancedBufferAttribute;
  private readonly v0: InstancedBufferAttribute;
  private readonly time: InstancedBufferAttribute;
  private readonly color: InstancedBufferAttribute;
  private readonly extra: InstancedBufferAttribute;
  readonly material: ShaderMaterial;
  private head = 0;
  private dirtyFrom = -1;
  private dirtyTo = -1;
  private wrapped = false;
  private readonly attrs: InstancedBufferAttribute[];

  constructor(o: PoolOptions) {
    this.max = o.max;
    const g = new InstancedBufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]), 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const mk = (size: number): InstancedBufferAttribute => {
      const a = new InstancedBufferAttribute(new Float32Array(o.max * size), size);
      a.setUsage(DynamicDrawUsage);
      return a;
    };
    this.p0 = mk(3);
    this.v0 = mk(3);
    this.time = mk(4);
    this.color = mk(4);
    this.extra = mk(3);
    // Unborn slots: birth far in the future.
    for (let i = 0; i < o.max; i++) this.time.setXYZW(i, 1e9, 0, 0, 0);
    g.setAttribute('aP0', this.p0);
    g.setAttribute('aV0', this.v0);
    g.setAttribute('aTime', this.time);
    g.setAttribute('aColor', this.color);
    g.setAttribute('aExtra', this.extra);
    this.attrs = [this.p0, this.v0, this.time, this.color, this.extra];
    g.instanceCount = o.max;
    this.geo = g;
    this.material = new ShaderMaterial({
      name: `vfx.${o.name}`,
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uTime: { value: 0 }, uDrag: { value: o.drag }, uGravity: { value: o.gravity }, uBounce: { value: o.bounce },
        uStreak: { value: o.kind === 'streak' ? 1 : 0 }, uMap: { value: o.map }, uDepth: { value: null }, uRes: { value: new Vector2(1, 1) },
        uNear: { value: 0.1 }, uFar: { value: 1000 }, uSoft: { value: 0 }, uLight: { value: [1, 1, 1] }, uStretch: { value: o.stretch ?? 0 }, uFog: { value: [0, 0, 0, 0] },
        uNearFade: { value: new Vector2(o.nearFade?.[0] ?? 0.3, o.nearFade?.[1] ?? 0.8) },
      },
      transparent: true,
      depthWrite: false,
      blending: o.kind === 'streak' ? AdditiveBlending : o.blending ?? NormalBlending,
    });
    this.material.userData['softFade'] = o.softFade;
    this.mesh = new Mesh(g, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
    this.mesh.name = `vfx.${o.name}`;
  }

  /** Writes one particle into the ring (no allocation). */
  spawn(t: number, px: number, py: number, pz: number, vx: number, vy: number, vz: number, life: number, s0: number, s1: number,
    r: number, g: number, b: number, a: number, rot: number, cell: number, groundY: number): void {
    const i = this.head;
    this.p0.setXYZ(i, px, py, pz);
    this.v0.setXYZ(i, vx, vy, vz);
    this.time.setXYZW(i, t, life, s0, s1);
    this.color.setXYZW(i, r, g, b, a);
    this.extra.setXYZ(i, rot, cell, groundY);
    if (this.dirtyFrom < 0) this.dirtyFrom = i;
    this.dirtyTo = i;
    this.head = (i + 1) % this.max;
    if (this.head === 0) this.wrapped = true;
  }

  /** Uploads the slots written since the last flush (one or two ranges). */
  flush(time: number): void {
    this.material.uniforms['uTime']!.value = time;
    if (this.dirtyFrom < 0) return;
    for (let ai = 0; ai < this.attrs.length; ai++) {
      const a = this.attrs[ai]!;
      a.clearUpdateRanges();
      if (this.wrapped || this.dirtyTo < this.dirtyFrom) {
        a.addUpdateRange(0, this.max * a.itemSize);
      } else {
        a.addUpdateRange(this.dirtyFrom * a.itemSize, (this.dirtyTo - this.dirtyFrom + 1) * a.itemSize);
      }
      a.needsUpdate = true;
    }
    this.dirtyFrom = -1;
    this.dirtyTo = -1;
    this.wrapped = false;
  }

  /** Kills every particle (flashback / session reset). */
  clear(): void {
    for (let i = 0; i < this.max; i++) this.time.setXYZW(i, 1e9, 0, 0, 0);
    this.time.clearUpdateRanges();
    this.time.needsUpdate = true;
    this.head = 0;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.geo.dispose();
    this.material.dispose();
  }
}
