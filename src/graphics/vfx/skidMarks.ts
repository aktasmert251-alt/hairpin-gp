// Skid marks (docs/design/rendering.md §8.2): ring buffer of ground quads, one instanced draw. A quad is laid every
// 0.5 m travelled (or 3° heading change) while a wheel slides; the oldest 15 % of the ring fade out.

import { BufferAttribute, DynamicDrawUsage, InstancedBufferAttribute, InstancedBufferGeometry, Mesh, ShaderMaterial } from 'three';

const VERT = /* glsl */ `
attribute vec3 aA;
attribute vec3 aB;
attribute vec2 aWA;   // width, alpha
attribute float aIdx;
uniform float uHead;
uniform float uMax;
varying float vAlpha;
varying float vAcross;
void main() {
  vec3 d = aB - aA;
  float len = length(d);
  if (aWA.y <= 0.0 || len < 1e-4) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vec3 side = normalize(cross(vec3(0.0, 1.0, 0.0), d / len)) * aWA.x * 0.5;
  vec3 p = mix(aA, aB, position.y + 0.5) + side * (position.x * 2.0);
  float age = mod(uHead - aIdx + uMax, uMax);
  vAlpha = aWA.y * (1.0 - smoothstep(uMax * 0.85, uMax, age));
  vAcross = position.x * 2.0;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;
const FRAG = /* glsl */ `
varying float vAlpha;
varying float vAcross;
void main() {
  float edge = 1.0 - smoothstep(0.7, 1.0, abs(vAcross));
  gl_FragColor = vec4(vec3(0.039), vAlpha * edge);
}
`;

export class SkidMarks {
  readonly mesh: Mesh;
  private readonly a: InstancedBufferAttribute;
  private readonly b: InstancedBufferAttribute;
  private readonly wa: InstancedBufferAttribute;
  private readonly idx: InstancedBufferAttribute;
  private readonly mat: ShaderMaterial;
  private readonly geo: InstancedBufferGeometry;
  private head = 0;
  private dirty = false;
  readonly max: number;

  constructor(max: number) {
    this.max = max;
    const g = new InstancedBufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]), 3));
    g.setIndex([0, 2, 1, 0, 3, 2]);
    const mk = (n: number): InstancedBufferAttribute => {
      const at = new InstancedBufferAttribute(new Float32Array(max * n), n);
      at.setUsage(DynamicDrawUsage);
      return at;
    };
    this.a = mk(3);
    this.b = mk(3);
    this.wa = mk(2);
    this.idx = mk(1);
    g.setAttribute('aA', this.a);
    g.setAttribute('aB', this.b);
    g.setAttribute('aWA', this.wa);
    g.setAttribute('aIdx', this.idx);
    g.instanceCount = max;
    this.geo = g;
    this.mat = new ShaderMaterial({
      name: 'vfx.skids', vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
      uniforms: { uHead: { value: 0 }, uMax: { value: max } },
    });
    this.mesh = new Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.mesh.name = 'vfx.skids';
  }

  add(ax: number, ay: number, az: number, bx: number, by: number, bz: number, width: number, alpha: number): void {
    const i = this.head;
    this.a.setXYZ(i, ax, ay, az);
    this.b.setXYZ(i, bx, by, bz);
    this.wa.setXY(i, width, alpha);
    this.idx.setX(i, i);
    this.head = (i + 1) % this.max;
    this.dirty = true;
  }

  flush(): void {
    this.mat.uniforms['uHead']!.value = this.head;
    if (!this.dirty) return;
    for (const at of [this.a, this.b, this.wa, this.idx]) at.needsUpdate = true;
    this.dirty = false;
  }

  clear(): void {
    for (let i = 0; i < this.max; i++) this.wa.setXY(i, 0, 0);
    this.wa.needsUpdate = true;
    this.head = 0;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.geo.dispose();
    this.mat.dispose();
  }
}
