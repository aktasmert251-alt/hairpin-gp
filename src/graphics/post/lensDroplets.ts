// Lens droplets (rendering.md §4.4, G6): analytic raindrops on the lens, drawn as one instanced quad batch into a
// half-resolution RGBA16F distortion target (RG = UV offset 0.5-biased, B = mask, A = rim) that the
// ScreenDistortionEffect samples. Slot k of N cycles with period P; position, radius and life come from
// hash(k, cycle, seed), so the result depends only on (time, rate, speed) and `seek(t)` is deterministic.
// Motion: below 80 km/h drops slide down 0.02 screen/s; at speed they streak radially outward (cockpit, nose).

import {
  BufferAttribute, CustomBlending, HalfFloatType, InstancedBufferAttribute, InstancedBufferGeometry, LinearFilter, MaxEquation, Mesh, OneFactor,
  OrthographicCamera, RGBAFormat, Scene, ShaderMaterial, WebGLRenderTarget, type Texture, type WebGLRenderer,
} from 'three';

const MAX_SLOTS = 48;
const PERIOD = 3.4;

const VERT = /* glsl */ `
attribute float aSlot;
uniform float uTime;
uniform float uRate;
uniform float uN;
uniform float uSeed;
uniform float uAspect;
uniform float uRadial;
uniform float uSlide;
varying vec2 vQ;
varying float vFade;
varying float vStretch;
float h(float a, float b, float c) {
  return fract(sin(a * 12.9898 + b * 78.233 + c * 37.719) * 43758.5453);
}
void main() {
  vFade = 0.0;
  vQ = position.xy * 2.0;
  vStretch = 1.0;
  if (aSlot >= uN) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  float phase = h(aSlot, 0.0, uSeed) * ${PERIOD.toFixed(1)};
  float tt = uTime + phase;
  float cyc = floor(tt / ${PERIOD.toFixed(1)});
  float tau = tt - cyc * ${PERIOD.toFixed(1)};
  float life = 1.0 + 2.0 * h(aSlot, cyc, uSeed + 3.0);
  float isOn = step(h(aSlot, cyc, uSeed + 1.0), uRate * ${PERIOD.toFixed(1)} / uN);
  if (isOn < 0.5 || tau > life) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  // Screen position in [0,1]² (x right, y up); radius in screen heights.
  vec2 p = vec2(h(aSlot, cyc, uSeed + 5.0), 0.12 + 0.86 * h(aSlot, cyc, uSeed + 7.0));
  float r = 0.012 + 0.023 * h(aSlot, cyc, uSeed + 9.0);
  vec2 dir = vec2(0.0, -1.0);
  float speed = uSlide;
  if (uRadial > 0.0) {
    vec2 c = (p - 0.5) * vec2(uAspect, 1.0);
    dir = length(c) > 1e-3 ? normalize(c) : vec2(0.0, 1.0);
    speed = uRadial;
    vStretch = 1.0 + 6.0 * uRadial;
  }
  vec2 off = dir * speed * tau;
  p += off / vec2(uAspect, 1.0);
  vFade = smoothstep(0.0, 0.1, tau) * (1.0 - smoothstep(life - 0.4, life, tau));
  // Quad: stretched along the motion direction for fast drops.
  vec2 side = vec2(dir.y, -dir.x); // (side, dir) keeps the quad's CCW winding (no back-face cull)
  vec2 q = position.xy * 2.0 * r;
  vec2 local = side * q.x + dir * q.y * vStretch;
  vec2 ndc = (p + local / vec2(uAspect, 1.0)) * 2.0 - 1.0;
  gl_Position = vec4(ndc, 0.0, 1.0);
}
`;

const FRAG = /* glsl */ `
varying vec2 vQ;
varying float vFade;
varying float vStretch;
void main() {
  float d = length(vQ);
  if (d > 1.0 || vFade <= 0.0) discard;
  // Hemispherical lens: the offset points inward (refraction flips the image inside the drop).
  float z = sqrt(max(0.0, 1.0 - d * d));
  vec2 n = vQ * (1.0 - z);
  float mask = (1.0 - smoothstep(0.82, 1.0, d)) * vFade;
  float rim = smoothstep(0.6, 0.95, d) * (1.0 - smoothstep(0.95, 1.0, d)) * vFade;
  gl_FragColor = vec4(0.5 - 0.5 * n, mask, rim);
}
`;

export interface LensDroplets {
  readonly texture: Texture;
  /** The half-resolution distortion target (tests read it back). */
  readonly target: WebGLRenderTarget;
  /** rate = drops/s, radial = streak speed (screen/s, 0 = slide), n = active slots. Renders the target. */
  render(renderer: WebGLRenderer, timeS: number, rate: number, radial: number, n: number): void;
  setSize(w: number, h: number): void;
  /** Compiles the program into the target (warm-up). */
  compile(renderer: WebGLRenderer): void;
  dispose(): void;
}

export function createLensDroplets(seed = 1): LensDroplets {
  const rt = new WebGLRenderTarget(2, 2, { type: HalfFloatType, format: RGBAFormat, depthBuffer: false, stencilBuffer: false, magFilter: LinearFilter, minFilter: LinearFilter });
  rt.texture.name = 'lens.droplets';
  const geo = new InstancedBufferGeometry();
  geo.setAttribute('position', new BufferAttribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]), 3));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  const slots = new Float32Array(MAX_SLOTS);
  for (let i = 0; i < MAX_SLOTS; i++) slots[i] = i;
  geo.setAttribute('aSlot', new InstancedBufferAttribute(slots, 1));
  geo.instanceCount = MAX_SLOTS;
  const mat = new ShaderMaterial({
    name: 'lens.droplets',
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uTime: { value: 0 }, uRate: { value: 0 }, uN: { value: MAX_SLOTS }, uSeed: { value: seed % 97 }, uAspect: { value: 16 / 9 },
      uRadial: { value: 0 }, uSlide: { value: 0.02 },
    },
    depthTest: false,
    depthWrite: false,
    transparent: true,
    blending: CustomBlending,
    blendEquation: MaxEquation,
    blendSrc: OneFactor,
    blendDst: OneFactor,
  });
  const mesh = new Mesh(geo, mat);
  mesh.frustumCulled = false;
  const scene = new Scene();
  scene.add(mesh);
  const cam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const u = mat.uniforms;

  const draw = (r: WebGLRenderer): void => {
    const prev = r.getRenderTarget();
    const prevClear = r.getClearAlpha();
    r.setRenderTarget(rt);
    r.setClearColor(0x808000, 0); // RG = 0.5 (no offset), B = 0, A = 0
    r.clear(true, false, false);
    r.render(scene, cam);
    r.setRenderTarget(prev);
    r.setClearColor(0x000000, prevClear);
  };

  return {
    texture: rt.texture,
    target: rt,
    render(r, t, rate, radial, n) {
      u['uTime']!.value = t;
      u['uRate']!.value = rate;
      u['uRadial']!.value = radial;
      u['uN']!.value = Math.min(MAX_SLOTS, n);
      draw(r);
    },
    setSize(w, h) {
      rt.setSize(Math.max(2, Math.round(w / 2)), Math.max(2, Math.round(h / 2)));
      u['uAspect']!.value = w / Math.max(1, h);
    },
    compile(r) {
      const prev = r.getRenderTarget();
      r.setRenderTarget(rt);
      r.compile(scene, cam);
      r.setRenderTarget(prev);
    },
    dispose() {
      geo.dispose();
      mat.dispose();
      rt.dispose();
    },
  };
}
