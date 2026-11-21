// Rear-view mirrors (G9, rendering.md §7.6): one HalfFloat render target shared by both mirrors (left / right halves),
// `static` (Low/Medium, D-051 #5: was env reflection only = an empty mirror) 384 × 96 at 15 Hz, `low30` 768 × 192 at
// 30 Hz, `high60` 1024 × 256 at 60 Hz, rendered in the cockpit and T-cam views (D-051 #5). The mirror camera sees
// layer 1 only: cars (LOD1/LOD2 + wheels, tagged by carVisuals) plus the track ribbon, pit lane, terrain, barriers,
// sky, floodlights and lights, tagged here by name once the environment is in the scene. No shadow-map update, no post.
// The glass quads (MeshBasicMaterial, linear HDR map) sit 2 mm behind the static trim glass, facing the driver.

import { BufferAttribute, HalfFloatType, LinearFilter, Matrix4, Mesh, MeshBasicMaterial, type Object3D, PerspectiveCamera, PlaneGeometry, Vector3, WebGLRenderTarget, type Scene, type WebGLRenderer } from 'three';
import type { QualityPreset } from '../../contracts/render';
import { MIRROR_GEO } from './carModel';

export const MIRROR_LAYER = 1;
/** Environment objects drawn in the mirrors (rendering.md §7.6: track ribbon, barriers, sky; + terrain, pit lane, floodlights). */
const ENV_PREFIXES = ['track.', 'pit.track.', 'sky', 'terrain.', 'barrier.', 'flood.'];
/** Glass centre and size (model space): inside the housing bezel, in front of the trim glass (carModel MIRROR_GEO). */
const GLASS_X = MIRROR_GEO.x, GLASS_Y = MIRROR_GEO.y, GLASS_Z = MIRROR_GEO.glassZ, GLASS_W = MIRROR_GEO.w, GLASS_H = MIRROR_GEO.h;
/** Mirror aim in model space: rearward, slightly outward and down. */
const AIM = new Vector3(0.16, -0.05, -1);
/** Virtual eye offset from the glass (outboard, up): from the glass itself the engine cover fills the inner third. */
const EYE_X = 0.12, EYE_Y = 0.06;

export interface Mirrors {
  /** The two glass meshes (left = model +x, right); parent them to the cockpit car's LOD0 group. */
  readonly glass: readonly [Mesh, Mesh];
  setQuality(q: QualityPreset): void;
  /**
   * Renders the mirror target when due. `car` = the cockpit car's world matrix; `swap(on)` switches the car visuals into
   * mirror mode (LOD1 instead of LOD0) around the render. Returns whether the glass should be visible.
   */
  render(renderer: WebGLRenderer, scene: Scene, car: Matrix4, dt: number, swap: (on: boolean) => void): boolean;
  dispose(): void;
}

export function createMirrors(q0: QualityPreset): Mirrors {
  let rt: WebGLRenderTarget | null = null;
  let hz = 0;
  let acc = Infinity;
  let parity = 0, first = 0, last = 1;
  let tagged = -1;
  const cam = new PerspectiveCamera(30, GLASS_W / GLASS_H, 0.3, 250); // 250 m: beyond that a 192-px mirror shows nothing useful
  cam.layers.set(MIRROR_LAYER);
  const mat = new MeshBasicMaterial({ name: 'car.mirrorGlass', fog: false, toneMapped: false });
  const geos: PlaneGeometry[] = [];
  const makeGlass = (side: number): Mesh => {
    // Faces −z (towards the driver). A mirror keeps world left/right, so u runs from model +x to −x on the glass;
    // each mirror samples its own half of the shared target.
    const g = new PlaneGeometry(GLASS_W, GLASS_H).rotateY(Math.PI);
    const pos = g.getAttribute('position');
    const uv = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      const u = 0.5 + pos.getX(i) / GLASS_W; // 0 at −x … 1 at +x (after the flip)
      uv[i * 2] = side * 0.5 + 0.5 * u;
      uv[i * 2 + 1] = 0.5 + pos.getY(i) / GLASS_H;
    }
    g.setAttribute('uv', new BufferAttribute(uv, 2));
    geos.push(g);
    const m = new Mesh(g, mat);
    m.name = side === 0 ? 'mirror.left' : 'mirror.right';
    // Same inward yaw as the housing, about the housing face centre (x, y, pivotZ).
    const sx = side === 0 ? 1 : -1, a = sx * MIRROR_GEO.yaw, dz = GLASS_Z - MIRROR_GEO.pivotZ;
    m.position.set(sx * GLASS_X + dz * Math.sin(a), GLASS_Y, MIRROR_GEO.pivotZ + dz * Math.cos(a));
    m.rotation.y = a;
    m.visible = false;
    return m;
  };
  const glass: [Mesh, Mesh] = [makeGlass(0), makeGlass(1)];

  const p = new Vector3(), t = new Vector3(), up = new Vector3();

  const setQuality = (q: QualityPreset): void => {
    const [w, ht, f]: readonly [number, number, number] = q.mirrors === 'high60' ? [1024, 256, 60] : q.mirrors === 'low30' ? [768, 192, 30] : [384, 96, 15];
    hz = f;
    if (!rt || rt.width !== w || rt.height !== ht) {
      rt?.dispose();
      rt = new WebGLRenderTarget(w, ht, { type: HalfFloatType, magFilter: LinearFilter, minFilter: LinearFilter, depthBuffer: true, stencilBuffer: false });
      rt.texture.name = 'mirror.rt';
      rt.scissorTest = true;
    }
    mat.map = rt ? rt.texture : null;
    mat.needsUpdate = true;
    acc = Infinity;
  };
  setQuality(q0);

  const tagEnv = (scene: Scene): void => {
    if (tagged === scene.children.length) return;
    tagged = scene.children.length;
    scene.traverse((o: Object3D) => {
      if ((o as { isLight?: boolean }).isLight || ENV_PREFIXES.some((k) => o.name.startsWith(k))) o.layers.enable(MIRROR_LAYER);
    });
  };

  return {
    glass,
    setQuality,
    render(renderer, scene, car, dt, swap) {
      if (!rt) return false;
      // high60: both mirrors every frame. low30: one mirror per frame, alternating (each at 30 Hz, flat GPU cost).
      // static: one mirror every other frame (each at 15 Hz, a quarter-size target).
      acc += dt;
      if (acc < (hz >= 30 ? 1 / 60 : 1 / 30) - 1e-3) return true;
      acc = 0;
      if (hz >= 60) {
        first = 0;
        last = 1;
      } else {
        first = last = parity;
        parity ^= 1;
      }
      tagEnv(scene);
      up.setFromMatrixColumn(car, 1);
      // D-051 #5: the post chain's EffectComposer sets renderer.autoClear = false, so the target must be cleared here
      // (scissored to this half); without it the depth buffer kept the nearest depth ever drawn and the glass froze.
      const prevTarget = renderer.getRenderTarget();
      const prevShadow = renderer.shadowMap.autoUpdate;
      renderer.shadowMap.autoUpdate = false;
      swap(true);
      const hw = rt.width / 2;
      for (let side = first; side <= last; side++) {
        const sx = side === 0 ? 1 : -1;
        const ex = sx * (GLASS_X + EYE_X), ey = GLASS_Y + EYE_Y;
        p.set(ex, ey, GLASS_Z).applyMatrix4(car);
        t.set(ex + sx * AIM.x, ey + AIM.y, GLASS_Z + AIM.z).applyMatrix4(car);
        cam.position.copy(p);
        cam.up.copy(up);
        cam.lookAt(t);
        cam.updateMatrixWorld();
        rt.viewport.set(side * hw, 0, hw, rt.height);
        rt.scissor.set(side * hw, 0, hw, rt.height);
        renderer.setRenderTarget(rt);
        renderer.clear(true, true, false);
        renderer.render(scene, cam);
      }
      swap(false);
      renderer.shadowMap.autoUpdate = prevShadow;
      renderer.setRenderTarget(prevTarget);
      return true;
    },
    dispose() {
      for (const m of glass) m.removeFromParent();
      for (const g of geos) g.dispose();
      mat.dispose();
      rt?.dispose();
      rt = null;
    },
  };
}
