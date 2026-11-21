// RacingLineVisual (sprint-1.md G8): one ribbon draw for the whole lap, 0.6 m wide, 2 cm above the ground with
// polygonOffset, coloured by SpeedProfile.zone (DESIGN tokens: green throttle, yellow lift, red brake).
// Visible 5–220 m ahead of the player; mode 'corners' shows only 250 m before to 50 m after each brake zone.
// Visibility is evaluated in the shader from uPlayerS, so update() only writes uniforms (no allocation).

import { BufferAttribute, BufferGeometry, Color, Mesh, ShaderMaterial } from 'three';
import type { RacingLine, SpeedProfile } from '../../contracts/ai';
import type { RacingLineVisual, RenderContext, RenderFrame } from '../../contracts/render';

const ZONE_COLORS = [new Color('#2ED16B'), new Color('#FFD019'), new Color('#FF5C5C')];
const HALF_W = 0.3;
const LIFT = 0.02;

const VERT = /* glsl */ `
attribute float aS;
attribute vec3 aCol;
attribute float aCorner;
uniform float uPlayerS;
uniform float uLen;
uniform float uMode; // 1 corners, 2 full
varying vec3 vCol;
varying float vAlpha;
varying float vAcross;
void main() {
  float ahead = mod(aS - uPlayerS + uLen, uLen);
  float vis = step(5.0, ahead) * step(ahead, 220.0) * (uMode > 1.5 ? 1.0 : aCorner);
  vAlpha = vis * smoothstep(5.0, 15.0, ahead) * (1.0 - smoothstep(170.0, 220.0, ahead));
  vCol = aCol;
  vAcross = uv.x;
  gl_Position = vis > 0.0 ? projectionMatrix * modelViewMatrix * vec4(position, 1.0) : vec4(2.0, 2.0, 2.0, 1.0);
}
`;
const FRAG = /* glsl */ `
varying vec3 vCol;
varying float vAlpha;
varying float vAcross;
void main() {
  float edge = 1.0 - smoothstep(0.75, 1.0, abs(vAcross * 2.0 - 1.0));
  float a = vAlpha * edge * 0.85;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vCol, a);
}
`;

export function createRacingLineVisual(): RacingLineVisual & { mesh(): Mesh | null } {
  let mesh: Mesh | null = null;
  let geo: BufferGeometry | null = null;
  let mat: ShaderMaterial | null = null;
  let line: RacingLine | null = null;
  let lastProfile: SpeedProfile | null = null;
  let lastWet = -1;

  const applyProfile = (p: SpeedProfile): void => {
    if (!geo || !line) return;
    const n = line.count;
    const col = geo.getAttribute('aCol') as BufferAttribute;
    const cor = geo.getAttribute('aCorner') as BufferAttribute;
    const len = line.s[n - 1]! + line.ds;
    // Corner window: 250 m before to 50 m after every brake-zone sample.
    const inWin = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      if (p.zone[i] !== 2) continue;
      const s = line.s[i]!;
      for (let j = 0; j < n; j++) {
        let d = line.s[j]! - s;
        if (d > len / 2) d -= len;
        else if (d < -len / 2) d += len;
        if (d >= -250 && d <= 50) inWin[j] = 1;
      }
    }
    for (let i = 0; i < n; i++) {
      const c = ZONE_COLORS[Math.min(2, p.zone[i] ?? 0)]!;
      for (let k = 0; k < 2; k++) {
        col.setXYZ(i * 2 + k, c.r, c.g, c.b);
        cor.setX(i * 2 + k, inWin[i]!);
      }
    }
    col.needsUpdate = true;
    cor.needsUpdate = true;
    lastProfile = p;
    lastWet = p.wetness;
  };

  return {
    init(ctx: RenderContext, l: RacingLine) {
      line = l;
      const n = l.count;
      if (n < 2) return;
      const pos = new Float32Array((n + 1) * 2 * 3);
      const s = new Float32Array((n + 1) * 2);
      const uv = new Float32Array((n + 1) * 2 * 2);
      for (let i = 0; i <= n; i++) {
        const a = i % n;
        const b = (i + 1) % n;
        const p = (i + n - 1) % n;
        let tx = l.x[b]! - l.x[p]!, tz = l.z[b]! - l.z[p]!;
        const tl = Math.hypot(tx, tz) || 1;
        tx /= tl;
        tz /= tl;
        // left = (−tz?, …): with +Y up, left of the driving direction (tx, tz) is (tz, −tx) under +Z south.
        const lx = tz, lz = -tx;
        for (let k = 0; k < 2; k++) {
          const side = k === 0 ? HALF_W : -HALF_W;
          const o = (i * 2 + k) * 3;
          pos[o] = l.x[a]! + lx * side;
          pos[o + 1] = l.y[a]! + LIFT;
          pos[o + 2] = l.z[a]! + lz * side;
          s[i * 2 + k] = i === n ? l.s[n - 1]! + l.ds : l.s[a]!;
          uv[(i * 2 + k) * 2] = k;
          uv[(i * 2 + k) * 2 + 1] = 0;
        }
      }
      const idx: number[] = [];
      for (let i = 0; i < n; i++) {
        const a = i * 2;
        idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
      geo = new BufferGeometry();
      geo.setAttribute('position', new BufferAttribute(pos, 3));
      geo.setAttribute('uv', new BufferAttribute(uv, 2));
      geo.setAttribute('aS', new BufferAttribute(s, 1));
      const col = new Float32Array((n + 1) * 2 * 3).fill(0.18);
      geo.setAttribute('aCol', new BufferAttribute(col, 3));
      geo.setAttribute('aCorner', new BufferAttribute(new Float32Array((n + 1) * 2).fill(1), 1));
      geo.setIndex(idx);
      geo.computeBoundingSphere();
      mat = new ShaderMaterial({
        name: 'racingLine', vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, side: 2,
        polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
        uniforms: { uPlayerS: { value: 0 }, uLen: { value: l.s[n - 1]! + l.ds }, uMode: { value: 0 } },
      });
      mesh = new Mesh(geo, mat);
      mesh.name = 'racingLine';
      mesh.frustumCulled = false;
      mesh.renderOrder = 3;
      mesh.visible = false;
      ctx.scene.add(mesh);
    },
    update(frame: RenderFrame) {
      if (!mesh || !mat) return;
      const rl = frame.racingLine;
      // Driving aid only: hidden in TV / orbit / free / trailer views.
      const v = frame.view;
      mesh.visible = rl.mode !== 'off' && v !== 'tv' && v !== 'orbit' && v !== 'free' && v !== 'trailer';
      if (!mesh.visible) return;
      if (rl.profile && (rl.profile !== lastProfile || Math.abs(rl.profile.wetness - lastWet) > 0.05)) applyProfile(rl.profile);
      mat.uniforms['uPlayerS']!.value = rl.playerS;
      mat.uniforms['uMode']!.value = rl.mode === 'full' ? 2 : 1;
    },
    mesh: () => mesh,
    dispose() {
      mesh?.removeFromParent();
      geo?.dispose();
      mat?.dispose();
      mesh = null;
      geo = null;
      mat = null;
      line = null;
      lastProfile = null;
    },
  };
}
