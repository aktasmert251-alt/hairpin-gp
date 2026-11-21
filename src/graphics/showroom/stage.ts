// Showroom stage (DESIGN.md §1.4.5), shared by the menu Showroom (CR-15) and the sandbox scenes: dark gradient backdrop, dark glossy concrete floor,
// matte turntable, studio env scene (key softbox front-left 5600 K, cool rim right 7000 K, overhead strip),
// and a shadow-casting key light. Also exports the day LightingRig values of rendering.md §5.2 (until H3).

import {
  BackSide, CircleGeometry, Color, CylinderGeometry, DirectionalLight, Group, HemisphereLight, Mesh, MeshBasicMaterial, MeshPhysicalMaterial,
  MeshStandardMaterial, PlaneGeometry, Scene, ShaderMaterial, SphereGeometry, type Material, type BufferGeometry,
} from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { LightingRig } from '../../contracts/environment';

export const DAY_RIG: Readonly<LightingRig> = {
  tod: 'day', sunDir: { x: -0.196, y: 0.819, z: 0.539 }, sunColor: 0xfff4e5, sunIntensity: 3.2, hemiSky: 0xbcd8ff, hemiGround: 0x6b5a45,
  hemiIntensity: 0.55, envIntensity: 1.0, exposure: 1.0, fogColor: 0xd6d9d2, fogDensity: 0.00022, bloomIntensity: 0.25, bloomThreshold: 0.95,
  lut: 'day', shadows: true,
};

export const SUNSET_RIG: Readonly<LightingRig> = {
  tod: 'sunset', sunDir: { x: -0.935, y: 0.105, z: -0.34 }, sunColor: 0xffb36b, sunIntensity: 2.4, hemiSky: 0x8fa4d6, hemiGround: 0x5a3d2b,
  hemiIntensity: 0.45, envIntensity: 0.9, exposure: 1.15, fogColor: 0xe7a77a, fogDensity: 0.0003, bloomIntensity: 0.6, bloomThreshold: 0.85,
  lut: 'sunset', shadows: true,
};

export const NIGHT_RIG: Readonly<LightingRig> = {
  tod: 'night', sunDir: { x: 0.117, y: 0.94, z: 0.321 }, sunColor: 0xe8f0ff, sunIntensity: 2.4, hemiSky: 0xa8c4ff, hemiGround: 0x0d0c10,
  hemiIntensity: 0.08, envIntensity: 0.75, exposure: 0.9, fogColor: 0x141a26, fogDensity: 0.0003, bloomIntensity: 0.8, bloomThreshold: 0.9,
  lut: 'night', shadows: true,
};

export interface Stage {
  root: Group;
  envScene: Scene;
  key: DirectionalLight;
  rim: DirectionalLight;
  floor: Mesh;
  turntable: Mesh;
  /** Switch between the studio look and an outdoor day look (RoomEnvironment + sun). */
  setMode(mode: 'studio' | 'day'): void;
  dispose(): void;
}

function panel(w: number, h: number, intensity: number, color: number): Mesh {
  const m = new Mesh(new PlaneGeometry(w, h), new MeshBasicMaterial({ color: new Color(color).multiplyScalar(intensity), side: 2 }));
  return m;
}

/** Studio env scene for PMREM: black room, softbox front-left, cool rim strip right, long overhead strip. */
function studioEnv(): Scene {
  const s = new Scene();
  s.background = new Color(0x050607);
  const room = new Mesh(new SphereGeometry(40, 32, 16), new MeshBasicMaterial({ color: 0x0b0d10, side: BackSide }));
  s.add(room);
  // Positions are relative to the showroom camera at (6.2, 1.1, 8.6) looking at the origin.
  const key = panel(6, 4, 3.5, 0xfff1e0); // 5600 K softbox, front-left of the camera
  key.position.set(0.5, 6, 12);
  key.lookAt(0, 0.5, 0);
  const rim = panel(2, 10, 9, 0xdfe8ff); // 7000 K strip, right and behind the car
  rim.position.set(9, 4, -9);
  rim.lookAt(0, 0.5, 0);
  const over = panel(1.6, 16, 7, 0xffffff);
  over.position.set(0, 9, 0);
  over.rotation.x = Math.PI / 2;
  const fill = panel(10, 3, 0.6, 0xbfd0e6);
  fill.position.set(-6, 3, 10);
  fill.lookAt(0, 0.5, 0);
  const floorGlow = panel(30, 30, 0.05, 0x8090a0);
  floorGlow.rotation.x = -Math.PI / 2;
  floorGlow.position.y = -0.5;
  s.add(key, rim, over, fill, floorGlow);
  return s;
}

export function createStage(withTurntable: boolean): Stage {
  const root = new Group();
  root.name = 'showroomStage';
  const geos: BufferGeometry[] = [];
  const mats: Material[] = [];
  const add = <T extends Mesh>(m: T): T => {
    geos.push(m.geometry);
    mats.push(...(Array.isArray(m.material) ? m.material : [m.material]));
    root.add(m);
    return m;
  };
  // Backdrop: vertical gradient #0A0C0F → #12161C.
  const back = add(new Mesh(new SphereGeometry(120, 32, 16), new ShaderMaterial({
    side: BackSide, depthWrite: false,
    uniforms: { cLow: { value: new Color(0x0a0c0f) }, cHigh: { value: new Color(0x12161c) } },
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'uniform vec3 cLow; uniform vec3 cHigh; varying vec3 vP; void main(){ float t = clamp(vP.y / 60.0 + 0.1, 0.0, 1.0); gl_FragColor = vec4(mix(cLow, cHigh, t), 1.0); }',
  })));
  back.renderOrder = -1000;
  // Floor: dark glossy concrete.
  const floor = add(new Mesh(new CircleGeometry(60, 64), new MeshPhysicalMaterial({ color: 0x0b0c0e, roughness: 0.8, metalness: 0, clearcoat: 0.25, clearcoatRoughness: 0.4, envMapIntensity: 0.2 })));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.045;
  floor.receiveShadow = true;
  const turntable = add(new Mesh(new CylinderGeometry(3.6, 3.65, 0.04, 96), new MeshStandardMaterial({ color: 0x26282c, roughness: 0.8, metalness: 0.0, envMapIntensity: 0.35 })));
  turntable.position.y = -0.0205;
  turntable.receiveShadow = true;
  turntable.visible = withTurntable;
  const key = new DirectionalLight(0xfff1e0, 2.6);
  key.position.set(0.8, 11, 8);
  key.castShadow = true;
  // Tight frustum around the 5.6 m car on the turntable (texel ≈ 4 mm), soft PCF via radius (rendering.md §3).
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -4.2;
  key.shadow.camera.right = 4.2;
  key.shadow.camera.top = 4.2;
  key.shadow.camera.bottom = -4.2;
  key.shadow.camera.near = 4;
  key.shadow.camera.far = 22;
  key.shadow.bias = -0.0002;
  key.shadow.normalBias = 0.03;
  key.shadow.radius = 4;
  key.shadow.blurSamples = 16;
  root.add(key, key.target);
  const rimLight = new DirectionalLight(0xdfe8ff, 2.2);
  rimLight.position.set(8, 4, -9);
  root.add(rimLight);
  const hemi = new HemisphereLight(0xbcd8ff, 0x1a1612, 0.25);
  root.add(hemi);
  let env = studioEnv();
  const room = new RoomEnvironment();
  const stage: Stage = {
    root, envScene: env, key, rim: rimLight, floor, turntable,
    setMode(mode) {
      if (mode === 'day') {
        stage.envScene = room;
        const d = DAY_RIG.sunDir;
        key.color.setHex(DAY_RIG.sunColor);
        key.intensity = DAY_RIG.sunIntensity;
        key.position.set(d.x * 15, d.y * 15, d.z * 15);
        rimLight.intensity = 0;
        hemi.color.setHex(DAY_RIG.hemiSky);
        hemi.groundColor.setHex(DAY_RIG.hemiGround);
        hemi.intensity = DAY_RIG.hemiIntensity;
        (back.material as ShaderMaterial).uniforms['cLow']!.value.setHex(0xd8e6f1);
        (back.material as ShaderMaterial).uniforms['cHigh']!.value.setHex(0x7fb4e2);
        (floor.material as MeshPhysicalMaterial).color.setHex(0x3a3d42);
        (floor.material as MeshPhysicalMaterial).clearcoat = 0;
        (floor.material as MeshPhysicalMaterial).roughness = 0.9;
      } else {
        stage.envScene = env;
      }
    },
    dispose() {
      root.removeFromParent();
      for (const g of geos) g.dispose();
      for (const m of mats) m.dispose();
      key.shadow.map?.dispose();
      key.dispose();
      rimLight.dispose();
      hemi.dispose();
      env.traverse((o) => {
        if (o instanceof Mesh) {
          o.geometry.dispose();
          (o.material as Material).dispose();
        }
      });
      room.dispose();
      env = new Scene();
    },
  };
  return stage;
}
