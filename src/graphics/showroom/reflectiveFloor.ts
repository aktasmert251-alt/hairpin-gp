// Showroom floor (DESIGN.md §1.4.5): dark glossy concrete with a blurred planar reflection of the car, and a
// dark satin turntable (radius 3.6 m) drawn in the same shader with a thin lit rim and slow radial grain.
// Uses three's Reflector (mirrored camera into a half-res, mip-mapped RT; one extra scene render per frame).

import { LinearFilter, LinearMipmapLinearFilter, PlaneGeometry, type ShaderMaterial, type WebGLRenderer } from 'three';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';

const SHADER = {
  name: 'ShowroomFloor',
  uniforms: {
    color: { value: null },
    tDiffuse: { value: null },
    textureMatrix: { value: null },
    uAngle: { value: 0 },
    uTurnR: { value: 3.6 },
    uRefl: { value: 0.3 },
  },
  vertexShader: /* glsl */ `
    uniform mat4 textureMatrix;
    varying vec4 vUv;
    varying vec2 vPos;
    varying vec3 vWorld;
    void main() {
      vUv = textureMatrix * vec4(position, 1.0);
      vPos = position.xy;
      vec4 w = modelMatrix * vec4(position, 1.0);
      vWorld = w.xyz;
      gl_Position = projectionMatrix * viewMatrix * w;
    }`,
  fragmentShader: /* glsl */ `
    uniform vec3 color;
    uniform sampler2D tDiffuse;
    uniform float uAngle;
    uniform float uTurnR;
    uniform float uRefl;
    varying vec4 vUv;
    varying vec2 vPos;
    varying vec3 vWorld;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float vnoise(vec2 p) {
      vec2 i = floor(p), f = fract(p);
      vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
    }
    void main() {
      float r = length(vPos);
      float inside = 1.0 - smoothstep(uTurnR - 0.006, uTurnR + 0.006, r);
      // Concrete: two octaves of value noise; turntable: fine radial grain that turns with the car.
      float n = vnoise(vPos * 1.7) * 0.6 + vnoise(vPos * 9.0) * 0.4;
      float a = atan(vPos.y, vPos.x) + uAngle;
      float grain = 0.5 + 0.5 * sin(a * 180.0) * (0.5 + 0.5 * vnoise(vec2(a * 12.0, r * 3.0)));
      vec3 concrete = color * (0.75 + 0.5 * n);
      vec3 table = color * (1.35 + 0.12 * grain);
      vec3 base = mix(concrete, table, inside);
      // Blurred reflection: concrete sharper than the satin turntable; fades with distance from the stage.
      vec2 uv = vUv.xy / vUv.w;
      float lod = mix(2.2, 3.2, inside);
      vec2 px = 2.5 * exp2(lod) / vec2(textureSize(tDiffuse, 0));
      vec3 refl = textureLod(tDiffuse, uv, lod).rgb * 0.4
        + (textureLod(tDiffuse, uv + vec2(px.x, 0.0), lod).rgb + textureLod(tDiffuse, uv - vec2(px.x, 0.0), lod).rgb
        + textureLod(tDiffuse, uv + vec2(0.0, px.y), lod).rgb + textureLod(tDiffuse, uv - vec2(0.0, px.y), lod).rgb) * 0.15;
      float k = uRefl * mix(1.0, 0.6, inside) * (1.0 - smoothstep(7.0, 30.0, r));
      // Soft pool of light under the overhead strip.
      float pool = exp(-r * r / 22.0);
      // Thin rim on the turntable edge (screen-space antialiased) plus a soft contact shadow just outside it.
      float wpx = max(fwidth(r), 1e-4);
      float rim = (1.0 - smoothstep(0.0, max(0.006, 1.2 * wpx), abs(r - uTurnR))) * min(1.0, 0.012 / wpx);
      float ao = 1.0 - 0.45 * step(uTurnR, r) * (1.0 - smoothstep(uTurnR, uTurnR + 0.5, r));
      vec3 col = base * ao + vec3(0.030, 0.032, 0.037) * pool * mix(1.0, 1.4, inside);
      col += refl * k + vec3(0.12, 0.13, 0.15) * rim;
      gl_FragColor = vec4(col, 1.0);
      #include <colorspace_fragment>
    }`,
};

export interface ReflectiveFloor {
  readonly mesh: Reflector;
  setAngle(rad: number): void;
  /** Resizes the reflection target to `scale` × the drawing buffer. */
  resize(renderer: WebGLRenderer, scale?: number): void;
  dispose(): void;
}

export function createReflectiveFloor(renderer: WebGLRenderer, opts: { radius?: number; color?: number; strength?: number } = {}): ReflectiveFloor {
  const w = Math.max(256, Math.round(renderer.domElement.width * 0.5));
  const h = Math.max(256, Math.round(renderer.domElement.height * 0.5));
  const geo = new PlaneGeometry(120, 120);
  const mesh = new Reflector(geo, { textureWidth: w, textureHeight: h, color: opts.color ?? 0x0b0c0e, multisample: 0, clipBias: 0.002, shader: SHADER });
  mesh.rotation.x = -Math.PI / 2;
  mesh.name = 'showroomFloor';
  const rt = mesh.getRenderTarget();
  rt.texture.generateMipmaps = true;
  rt.texture.minFilter = LinearMipmapLinearFilter;
  rt.texture.magFilter = LinearFilter;
  const mat = mesh.material as ShaderMaterial;
  mat.uniforms['uTurnR']!.value = opts.radius ?? 3.6;
  mat.uniforms['uRefl']!.value = opts.strength ?? 0.2;
  return {
    mesh,
    setAngle(rad) {
      mat.uniforms['uAngle']!.value = rad;
    },
    resize(r, scale = 0.5) {
      rt.setSize(Math.max(256, Math.round(r.domElement.width * scale)), Math.max(256, Math.round(r.domElement.height * scale)));
    },
    dispose() {
      mesh.removeFromParent();
      geo.dispose();
      mesh.dispose();
    },
  };
}
