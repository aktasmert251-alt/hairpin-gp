// Rain streaks (rendering.md §8.2, G6): one instanced draw of camera-facing ribbons inside a 40 × 22 × 40 m box that
// follows the camera (centred 4 m ahead). Positions are world-anchored hashes wrapped into the box in the vertex
// shader, falling at 9 m/s; each streak is oriented along (fall − camera velocity) with length |rel| × 1/60 s
// (0.15–1.2 m; spec 1.8 read as hyperspace at 250 km/h). Width is 0.012 m but never under ~1 px (alpha scaled down to keep the energy), so far streaks
// do not alias. count = round(rainStreaks · rain); alpha 0.28 · rain; brightness by TOD.

import {
  BufferAttribute, InstancedBufferAttribute, InstancedBufferGeometry, Mesh, NormalBlending, ShaderMaterial, Vector3, type PerspectiveCamera,
} from 'three';

const BOX = new Vector3(40, 22, 40);
const FALL = 9;

const VERT = /* glsl */ `
attribute vec3 aSeed;
uniform vec3 uCam;
uniform vec3 uCenter;
uniform vec3 uBox;
uniform float uFall;
uniform vec3 uRel;
uniform float uPx;
varying float vA;
varying float vU;
void main() {
  vec3 lo = uCenter - 0.5 * uBox;
  vec3 p0 = aSeed * uBox;
  p0.y -= uFall;
  vec3 head = lo + mod(p0 - lo, uBox);
  float len = length(uRel);
  vec3 dir = uRel / max(len, 1e-4);
  vec3 p = head - dir * len * position.y;
  vec3 toCam = uCam - p;
  float dist = length(toCam);
  vec3 side = normalize(cross(dir, toCam / max(dist, 1e-3)));
  float w = max(0.012, dist * uPx * 1.2);
  p += side * position.x * w;
  // Energy kept when widened; fade at the box edges and very close to the lens.
  vec3 e = abs(head - uCenter) / (0.5 * uBox);
  float edge = 1.0 - smoothstep(0.75, 1.0, max(e.x, max(e.y, e.z)));
  vA = (0.012 / w) * edge * smoothstep(1.2, 4.0, dist);
  vU = position.y;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;
varying float vA;
varying float vU;
void main() {
  float a = uAlpha * vA * (1.0 - vU * 0.7);
  if (a < 0.002) discard;
  gl_FragColor = vec4(uColor, a);
}
`;

export interface RainStreaks {
  readonly mesh: Mesh;
  update(cam: PerspectiveCamera, rain: number, tod: 'day' | 'sunset' | 'night', time: number, dt: number, lightK: number): void;
  dispose(): void;
}

function hash(i: number, k: number): number {
  let x = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(k + 0x27d4eb2f, 0x165667b1);
  x ^= x >>> 15;
  x = Math.imul(x, 0x2c1b3c6d);
  x ^= x >>> 12;
  return (x >>> 0) / 4294967296;
}

export function createRainStreaks(max: number): RainStreaks {
  const geo = new InstancedBufferGeometry();
  // Ribbon: x across (−0.5..0.5), y along the streak (0 = head, 1 = tail).
  geo.setAttribute('position', new BufferAttribute(new Float32Array([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0]), 3));
  geo.setIndex([0, 2, 1, 0, 3, 2]);
  const seeds = new Float32Array(Math.max(1, max) * 3);
  for (let i = 0; i < max; i++) {
    seeds[i * 3] = hash(i, 1);
    seeds[i * 3 + 1] = hash(i, 2);
    seeds[i * 3 + 2] = hash(i, 3);
  }
  geo.setAttribute('aSeed', new InstancedBufferAttribute(seeds, 3));
  geo.instanceCount = 0;
  const mat = new ShaderMaterial({
    name: 'vfx.rain',
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uCam: { value: new Vector3() }, uCenter: { value: new Vector3() }, uBox: { value: BOX.clone() }, uFall: { value: 0 },
      uRel: { value: new Vector3(0, -0.15, 0) }, uPx: { value: 0.001 }, uColor: { value: new Vector3(0.8, 0.82, 0.86) }, uAlpha: { value: 0 },
    },
    transparent: true,
    depthWrite: false,
    blending: NormalBlending,
    side: 2,
  });
  const mesh = new Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 12;
  mesh.name = 'vfx.rain';
  mesh.visible = false;
  const u = mat.uniforms;
  const camPos = new Vector3(), lastCam = new Vector3(), camVel = new Vector3(), fwd = new Vector3(), rel = new Vector3();
  let haveLast = false;

  return {
    mesh,
    update(cam, rain, tod, time, dt, lightK) {
      const n = Math.min(max, Math.round(max * rain));
      mesh.visible = rain > 0.02 && n > 0;
      cam.getWorldPosition(camPos);
      if (haveLast && dt > 0) {
        const vx = (camPos.x - lastCam.x) / dt, vy = (camPos.y - lastCam.y) / dt, vz = (camPos.z - lastCam.z) / dt;
        // Teleport / cut guard, then smooth (τ 0.1 s).
        if (vx * vx + vy * vy + vz * vz < 150 * 150) camVel.lerp(rel.set(vx, vy, vz), 1 - Math.exp(-dt / 0.1));
      }
      lastCam.copy(camPos);
      haveLast = true;
      if (!mesh.visible) return;
      geo.instanceCount = n;
      cam.getWorldDirection(fwd);
      (u['uCam']!.value as Vector3).copy(camPos);
      (u['uCenter']!.value as Vector3).copy(camPos).addScaledVector(fwd, 4);
      u['uFall']!.value = (time * FALL) % BOX.y;
      // Relative velocity of the rain seen from the camera, times one frame (1/60 s).
      rel.set(-camVel.x, -FALL - camVel.y, -camVel.z).multiplyScalar(1 / 60);
      const len = rel.length();
      if (len < 0.15) rel.multiplyScalar(0.15 / Math.max(len, 1e-4));
      else if (len > 1.2) rel.multiplyScalar(1.2 / len);
      (u['uRel']!.value as Vector3).copy(rel);
      // World size of one pixel per metre of distance.
      u['uPx']!.value = (2 * Math.tan((cam.fov * Math.PI) / 360)) / 1080;
      const b = (tod === 'night' ? 0.45 : tod === 'sunset' ? 0.7 : 0.8) * lightK * 0.7;
      (u['uColor']!.value as Vector3).set(0.92 * b, 0.95 * b, 1.0 * b);
      u['uAlpha']!.value = 0.28 * rain;
    },
    dispose() {
      mesh.removeFromParent();
      geo.dispose();
      mat.dispose();
    },
  };
}
