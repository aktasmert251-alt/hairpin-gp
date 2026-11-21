// Sun + hemisphere lights, per-frame shadow-camera fitting with texel snapping (rendering.md §3), and the PMREM
// env scene (rendering.md §2). Presentation layer.

import { DirectionalLight, Group, HemisphereLight, Scene, Vector3, type PerspectiveCamera } from 'three';
import type { LightingRig } from '../../contracts/environment';
import type { QualityPreset } from '../../contracts/render';
import type { SkyDome } from './sky';

const SHADOW_BIAS: Readonly<Record<QualityPreset['id'], [number, number]>> = {
  low: [-0.0004, 0.045], medium: [-0.0003, 0.035], high: [-0.0003, 0.04], ultra: [-0.0002, 0.03],
};

export interface Lighting {
  sun: DirectionalLight;
  hemi: HemisphereLight;
  group: Group;
  envScene: Scene;
  apply(rig: LightingRig, shadowIntensity: number): void;
  setQuality(q: QualityPreset): void;
  /** Fits the ortho shadow camera around the focus point (rendering.md §3.2). */
  fit(cam: PerspectiveCamera, focus: Vector3 | null): void;
  dispose(): void;
}

export function createLighting(q0: QualityPreset, sky: SkyDome): Lighting {
  const sun = new DirectionalLight(0xffffff, 3);
  sun.name = 'sun';
  sun.castShadow = true;
  const hemi = new HemisphereLight(0xffffff, 0x444444, 0.5);
  hemi.name = 'hemi';
  const group = new Group();
  group.name = 'lighting';
  group.add(sun, sun.target, hemi);

  let q = q0;
  let sunElev = 1;
  const xL = new Vector3();
  const yL = new Vector3();
  const zL = new Vector3();
  const dir = new Vector3(0, 1, 0);
  const tmpF = new Vector3();
  const tmpC = new Vector3();

  const applyShadowParams = (): void => {
    const [bias, nb] = SHADOW_BIAS[q.id];
    const low = sunElev < Math.sin((15 * Math.PI) / 180);
    sun.shadow.bias = bias * (low ? 1.5 : 1);
    sun.shadow.normalBias = nb * (low ? 1.8 : 1);
    sun.shadow.radius = q.shadowRadius;
    const cam = sun.shadow.camera;
    cam.left = -q.shadowExtent;
    cam.right = q.shadowExtent;
    cam.top = q.shadowExtent;
    cam.bottom = -q.shadowExtent;
    cam.near = 1;
    cam.far = low ? 700 : 500;
    cam.updateProjectionMatrix();
    if (sun.shadow.mapSize.x !== q.shadowSize) {
      sun.shadow.mapSize.set(q.shadowSize, q.shadowSize);
      sun.shadow.map?.dispose();
      sun.shadow.map = null;
    }
  };

  // Env scene (PMREM source): the sky dome's env copy, which also draws the ground disc, the horizon ring and the
  // night floodlight panels (sky.ts, uEnv) — one shared program instead of four.
  const envScene = new Scene();
  envScene.name = 'envScene';
  sky.envMesh.renderOrder = -1000;
  envScene.add(sky.envMesh);

  const api: Lighting = {
    sun, hemi, group, envScene,
    apply(rig, shadowIntensity) {
      dir.set(rig.sunDir.x, rig.sunDir.y, rig.sunDir.z).normalize();
      sunElev = dir.y;
      sun.color.setHex(rig.sunColor);
      sun.intensity = rig.sunIntensity;
      // D-027: castShadow stays on (it is part of every program key); overcast / rain fade the shadow intensity instead.
      sun.castShadow = true;
      sun.shadow.intensity = rig.shadows ? shadowIntensity : 0;
      hemi.color.setHex(rig.hemiSky);
      hemi.groundColor.setHex(rig.hemiGround);
      hemi.intensity = rig.hemiIntensity;
      zL.copy(dir).negate();
      xL.set(0, 1, 0);
      if (Math.abs(dir.y) > 0.98) xL.set(0, 0, 1);
      xL.crossVectors(xL, zL).normalize();
      yL.crossVectors(zL, xL).normalize();
      applyShadowParams();
    },
    setQuality(nq) {
      q = nq;
      applyShadowParams();
    },
    fit(cam, focus) {
      const ext = q.shadowExtent;
      if (focus) tmpF.copy(focus);
      else cam.getWorldDirection(tmpF).multiplyScalar(ext * 0.6).add(cam.position);
      cam.getWorldDirection(tmpC);
      tmpC.y = 0;
      if (tmpC.lengthSq() > 1e-6) tmpC.normalize();
      tmpF.addScaledVector(tmpC, 0.4 * ext);
      // Snap the centre to shadow texels in light space.
      const texel = (2 * ext) / q.shadowSize;
      let px = tmpF.dot(xL);
      let py = tmpF.dot(yL);
      const pz = tmpF.dot(zL);
      px = Math.floor(px / texel) * texel;
      py = Math.floor(py / texel) * texel;
      tmpC.copy(xL).multiplyScalar(px).addScaledVector(yL, py).addScaledVector(zL, pz);
      sun.target.position.copy(tmpC);
      sun.position.copy(tmpC).addScaledVector(dir, 250);
      sun.target.updateMatrixWorld();
      sun.updateMatrixWorld();
    },
    dispose() {
      sun.shadow.map?.dispose();
      sun.dispose();
      hemi.dispose();
      group.removeFromParent();
    },
  };
  applyShadowParams();
  return api;
}
