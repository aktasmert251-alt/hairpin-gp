// Heat haze (G10, rendering.md §4.4): Ultra only (`lens: 'all'`), dry track (wetness < 0.1), day or sunset.
// One camera-facing sprite per visible car within 60 m, at the exhaust (model (0, 0.55, −2.45)), 1.6 × 1.0 m, drawn into
// a half-resolution signed RG16F target as a UV offset (peak 0.0015) from value noise scrolling up at 1.5 Hz. The
// ScreenDistortionEffect adds it to the sample position. Additive blending; cleared to 0 = no offset.

import {
  AdditiveBlending, BufferAttribute, HalfFloatType, InstancedBufferAttribute, InstancedBufferGeometry, LinearFilter, Mesh, RGFormat, Scene,
  ShaderMaterial, WebGLRenderTarget, type PerspectiveCamera, type Texture, type WebGLRenderer,
} from 'three';

const MAX = 32;

const VERT = /* glsl */ `
attribute vec4 aPos; // xyz world exhaust, w = fade
attribute vec3 aExt; // sprite width, height (m), amplitude (1 = exhaust)
varying vec2 vQ;
varying float vFade;
void main() {
  vQ = position.xy;
  vFade = aPos.w * aExt.z;
  vec4 mv = viewMatrix * vec4(aPos.xyz + vec3(0.0, 0.35, 0.0), 1.0);
  mv.xy += position.xy * aExt.xy;
  gl_Position = projectionMatrix * mv;
  if (aPos.w <= 0.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform float uTime;
varying vec2 vQ;
varying float vFade;
float hh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vn(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hh(i), hh(i + vec2(1.0, 0.0)), f.x), mix(hh(i + vec2(0.0, 1.0)), hh(i + vec2(1.0, 1.0)), f.x), f.y);
}
void main() {
  // Envelope: strongest just above the exhaust, fading to the sprite edges.
  vec2 q = vQ * 2.0;
  float env = (1.0 - smoothstep(0.4, 1.0, abs(q.x))) * (1.0 - smoothstep(-0.2, 1.0, q.y)) * smoothstep(-1.0, -0.7, q.y);
  vec2 p = vQ * vec2(6.0, 4.0) - vec2(0.0, uTime * 1.5 * 4.0);
  vec2 n = vec2(vn(p), vn(p + 17.3)) * 2.0 - 1.0;
  gl_FragColor = vec4(n * 0.0015 * env * vFade, 0.0, 1.0);
}
`;

export interface HeatHaze {
  readonly texture: Texture;
  /** Sets sprite i (world exhaust position, fade 0..1; optional size w × h m and amplitude, default an exhaust 1.6 × 1.0, 1);
   *  call `render` with the count afterwards. */
  set(i: number, x: number, y: number, z: number, fade: number, w?: number, h?: number, amp?: number): void;
  render(renderer: WebGLRenderer, camera: PerspectiveCamera, time: number, count: number): void;
  setSize(w: number, h: number): void;
  compile(renderer: WebGLRenderer, camera: PerspectiveCamera): void;
  dispose(): void;
}

export function createHeatHaze(): HeatHaze {
  const rt = new WebGLRenderTarget(2, 2, { type: HalfFloatType, format: RGFormat, depthBuffer: false, stencilBuffer: false, magFilter: LinearFilter, minFilter: LinearFilter });
  rt.texture.name = 'lens.haze';
  const geo = new InstancedBufferGeometry();
  geo.setAttribute('position', new BufferAttribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]), 3));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  const pos = new InstancedBufferAttribute(new Float32Array(MAX * 4), 4);
  geo.setAttribute('aPos', pos);
  const ext = new InstancedBufferAttribute(new Float32Array(MAX * 3), 3);
  geo.setAttribute('aExt', ext);
  geo.instanceCount = 0;
  const mat = new ShaderMaterial({
    name: 'lens.haze', vertexShader: VERT, fragmentShader: FRAG, uniforms: { uTime: { value: 0 } },
    depthTest: false, depthWrite: false, transparent: true, blending: AdditiveBlending, side: 2,
  });
  const mesh = new Mesh(geo, mat);
  mesh.frustumCulled = false;
  const scene = new Scene();
  scene.add(mesh);

  return {
    texture: rt.texture,
    set(i, x, y, z, fade, w = 1.6, h = 1.0, amp = 1) {
      if (i >= MAX) return;
      pos.setXYZW(i, x, y, z, fade);
      ext.setXYZ(i, w, h, amp);
    },
    render(r, camera, time, count) {
      geo.instanceCount = Math.min(MAX, count);
      pos.clearUpdateRanges();
      pos.addUpdateRange(0, geo.instanceCount * 4);
      pos.needsUpdate = true;
      ext.clearUpdateRanges();
      ext.addUpdateRange(0, geo.instanceCount * 3);
      ext.needsUpdate = true;
      mat.uniforms['uTime']!.value = time;
      const prev = r.getRenderTarget();
      const prevAlpha = r.getClearAlpha();
      r.setRenderTarget(rt);
      r.setClearColor(0x000000, 0);
      r.clear(true, false, false);
      if (geo.instanceCount > 0) r.render(scene, camera);
      r.setRenderTarget(prev);
      r.setClearColor(0x000000, prevAlpha);
    },
    setSize(w, h) {
      rt.setSize(Math.max(2, Math.round(w / 2)), Math.max(2, Math.round(h / 2)));
    },
    compile(r, camera) {
      const prev = r.getRenderTarget();
      r.setRenderTarget(rt);
      r.compile(scene, camera);
      r.setRenderTarget(prev);
    },
    dispose() {
      geo.dispose();
      mat.dispose();
      rt.dispose();
    },
  };
}
