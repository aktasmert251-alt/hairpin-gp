// Sky dome (rendering.md §1, §2; DESIGN §1.4.1): one shader for day / sunset / night gradients, sun disc and glow,
// FBM cloud layer (cover from ConditionsFrame.cloud), stars and the sodium horizon glow at night, overcast blend.
// Drawn first (renderOrder −1000, no depth write) and centred on the camera; the same program lights the env scene.
// S2-Ç1: a RawShaderMaterial (its program key ignores lights, fog, tone mapping and the output target, so the visible
// dome and the PMREM copy share ONE program), which also draws the distant hill silhouette (was terrain.backdrop) and,
// for the env scene, the ground disc, horizon ring and night floodlight panels (were three basic materials).

import { BackSide, Color, Mesh, RawShaderMaterial, SphereGeometry, Vector3 } from 'three';
import type { TimeOfDay } from '../../contracts/common';
import type { LightingRig } from '../../contracts/environment';
import { OVERCAST, SKY_COLORS } from './rigs';

/** Radiance scale of the env-scene sky relative to the visible dome. */
export const ENV_SKY_SCALE = 0.42;

const VERT = /* glsl */ `
precision highp float;
attribute vec3 position;
uniform mat4 modelMatrix;
uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * viewMatrix * wp;
  gl_Position.z = gl_Position.w * 0.99999;
}`;

const FRAG = /* glsl */ `
precision highp float;
uniform float uBackdrop; uniform float uHillAmp; uniform vec3 uBackdropCol; uniform float uCamK;
uniform float uEnv; uniform vec3 uEnvGround; uniform vec3 uEnvRing; uniform float uEnvPanels;
uniform vec3 uZenith; uniform vec3 uMid; uniform vec3 uHorizon; uniform vec3 uGround;
uniform vec3 uOverZenith; uniform vec3 uOverHorizon;
uniform vec3 uSunDir; uniform vec3 uSunColor; uniform float uSunDisc; uniform float uGlow;
uniform float uCloud; uniform float uTime; uniform float uNight; uniform float uStars; uniform float uRain;
uniform vec3 uFogColor; uniform float uHaze; uniform float uSat; uniform float uScale; uniform float uCityGlow;
varying vec3 vDir;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { s += a * noise(p); p = p * 2.03 + vec2(17.1, 9.3); a *= 0.5; }
  return s;
}

void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  float hp = max(h, 0.0);
  // Base gradient: horizon → mid (≈15°) → zenith.
  vec3 col = mix(uHorizon, uMid, smoothstep(0.0, 0.26, hp));
  col = mix(col, uZenith, smoothstep(0.18, 0.95, hp));
  // AgX compresses saturation: pre-compensate so the graded sky lands near the DESIGN targets.
  float skyL = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = max(vec3(0.0), mix(vec3(skyL), col, uSat));
  // City backdrop: the sodium horizon band at night is stronger (uCityGlow 1.6, tracks.md §1.5).
  col *= mix(1.0, uCityGlow, uNight * (1.0 - smoothstep(0.0, 0.35, hp)));
  // Overcast blend by cloud cover.
  vec3 over = mix(uOverHorizon, uOverZenith, smoothstep(0.0, 0.8, hp));
  float ov = smoothstep(0.35, 0.95, uCloud);
  col = mix(col, over * (uNight > 0.5 ? 0.06 : 1.0), ov);
  // Sun glow and disc.
  float mu = dot(d, uSunDir);
  float glow = pow(max(mu, 0.0), 6.0) * 0.18 + pow(max(mu, 0.0), 48.0) * 0.55 + pow(max(mu, 0.0), 2.5) * 0.05;
  col += uSunColor * glow * uGlow * (1.0 - 0.85 * ov);
  float disc = smoothstep(0.99985, 0.99993, mu);
  col += uSunColor * disc * uSunDisc * (1.0 - smoothstep(0.55, 0.8, uCloud));
  // Stars (night) with a little twinkle, hidden by clouds.
  if (uStars > 0.0 && h > 0.02) {
    vec2 sp = d.xz / (h + 0.35) * 220.0;
    vec2 cell = floor(sp);
    float r = hash(cell);
    float star = step(0.9965, r) * smoothstep(0.42, 0.0, length(fract(sp) - 0.5));
    star *= 0.7 + 0.3 * sin(uTime * (1.0 + r * 3.0) + r * 40.0);
    col += vec3(0.85, 0.9, 1.0) * star * uStars * (1.0 - uCloud) * smoothstep(0.02, 0.2, h);
  }
  // Cloud layers (visual pass 2026-11): fair-weather skies are never empty. High cirrus streaks, then a cumulus deck
  // projected on a plane: scattered at uCloud 0, closing to overcast at 1. Shading: bright sun-facing tops with a
  // silver lining toward the sun, darker thick cores and bases, sunset tints from the sun colour, haze at the horizon.
  if (h > 0.0) {
    float sunsetK = clamp((uGlow - 0.9) / 1.3, 0.0, 1.0);
    vec2 wind = vec2(uTime * 0.004, uTime * 0.0017);
    vec2 cp = d.xz / (h + 0.12);
    vec3 sunTint = mix(vec3(1.0), uSunColor, 0.12 + 0.7 * sunsetK);
    float nightK = mix(1.0, 0.06, uNight);
    // Cirrus: long thin streaks, only in the upper sky, thinned out by rain / overcast.
    vec2 cq = vec2(cp.x * 0.42 + cp.y * 0.16, cp.y * 1.9 - cp.x * 0.1) * 0.8 + wind * 0.4 + 20.0;
    float ci = fbm(cq) * 0.7 + noise(cq * 5.0) * 0.3;
    float streak = smoothstep(0.5, 0.82, ci) * smoothstep(0.06, 0.34, h) * (0.42 - 0.3 * ov) * (1.0 - 0.7 * uRain);
    col = mix(col, (vec3(0.93, 0.95, 1.0) * sunTint * (1.0 + 0.5 * sunsetK * max(mu, 0.0))) * nightK + col * 0.25, streak);
    // Cumulus deck.
    vec2 q = cp * 1.05 + wind;
    float base = fbm(q);
    float detail = fbm(q * 3.6 + 3.1 + wind * 1.5);
    float shape = base * 0.8 + detail * 0.2;
    float cover = clamp(0.4 + uCloud * 0.6, 0.0, 1.0);
    float thr = 1.0 - cover;
    float c = smoothstep(thr, thr + 0.13, shape) * smoothstep(0.0, 0.09, h);
    float thick = smoothstep(thr + 0.04, thr + 0.5, shape);
    // Self-shadowing: denser toward the sun = this fragment sits in shade.
    vec2 sd2 = normalize(uSunDir.xz + vec2(1e-4)) * 0.16;
    float toSun = fbm(q + sd2) * 0.8 + detail * 0.2;
    float lit = clamp(0.62 - (toSun - shape) * 3.2, 0.0, 1.0) * (1.0 - 0.55 * thick);
    vec3 cLit = vec3(1.02, 1.0, 0.97) * sunTint * (1.0 + 0.35 * sunsetK);
    vec3 cShade = mix(mix(vec3(0.5, 0.55, 0.66), uMid * 0.75, 0.3), vec3(0.33, 0.28, 0.4), 0.75 * sunsetK);
    cShade = mix(cShade, over * 0.85, ov);
    vec3 cc = mix(cShade, cLit, lit);
    // Silver lining: thin edges glow when looking toward the sun.
    cc += uSunColor * pow(max(mu, 0.0), 10.0) * (1.0 - thick) * (0.35 + 0.9 * sunsetK) * (1.0 - ov);
    cc *= nightK;
    cc = mix(cc, over * nightK, max(uRain * 0.6, ov * 0.5));
    // Aerial perspective: distant clouds sink into the horizon haze.
    cc = mix(cc, uHorizon, exp(-h * 7.0) * 0.55);
    col = mix(col, cc, c * (0.92 - 0.5 * ov));
  }
  // Below the horizon: hazy ground colour; haze band at the horizon toward the fog colour.
  col = mix(col, uGround, smoothstep(0.0, -0.08, h));
  col = mix(col, uFogColor, uHaze * exp(-abs(h) * 22.0));
  col *= uScale;
  float hl = length(d.xz);
  float el = h / max(hl, 1e-4);
  float az = atan(d.z, d.x);
  if (uBackdrop > 0.5) {
    // Hill silhouette 3–6 km away (same profile as the S1 backdrop ring at 0.95·far, base at 0.2·camera height).
    float top = uHillAmp * (0.018 + 0.012 * sin(az * 5.0 + 1.3) * sin(az * 3.0) + 0.008 * sin(az * 17.0) + 0.02 * max(0.0, -sin(az))) - uCamK;
    float m = smoothstep(top + 0.0012, top - 0.0012, el) * step(-0.05 - uCamK, el);
    col = mix(col, uBackdropCol, m);
  }
  if (uEnv > 0.5) {
    // PMREM env scene seen from the origin: ground disc (y −1.5, r 500), horizon ring (r 480, y −15…35),
    // 24 floodlight panels (6 × 2 m at r 120, y 18) at night.
    col = el < -0.003 ? uEnvGround : el < 0.073 ? uEnvRing : col;
    if (uEnvPanels > 0.0) {
      float cell = az / 0.261799;
      float da = abs(fract(cell) - 0.5) * 0.261799;
      // Soft, vertically elongated glow (not hard rectangles): wet low-roughness asphalt reflects them as streaks.
      float de = (el - 0.15) / 0.03;
      float p = 0.5 * exp(-(da * da) / (0.022 * 0.022) - de * de);
      col = mix(col, vec3(uEnvPanels), p);
    }
  }
  gl_FragColor = vec4(col, 1.0);
}`;

export interface SkyDome {
  mesh: Mesh;
  /** A second mesh sharing the material, for the PMREM env scene (centred at the origin). */
  envMesh: Mesh;
  material: RawShaderMaterial;
  update(rig: LightingRig, cloud: number, rain: number, time: number): void;
  follow(cam: { position: Vector3 }, far: number): void;
  dispose(): void;
}

/** hillAmp scales the distant hill silhouette (1 = İstanbul hills, ~0.3 = a flat plain's tree line); cityGlow scales the
 *  night horizon band (1.6 for the city backdrop). */
export function createSky(tod: TimeOfDay, hillAmp = 1, cityGlow = 1): SkyDome {
  const c = (hex: number): Color => new Color().setHex(hex);
  const material = new RawShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uZenith: { value: c(SKY_COLORS[tod].zenith) }, uMid: { value: c(SKY_COLORS[tod].mid) }, uHorizon: { value: c(SKY_COLORS[tod].horizon) },
      uGround: { value: c(0x6d6a5c) }, uOverZenith: { value: c(OVERCAST.zenith) }, uOverHorizon: { value: c(OVERCAST.horizon) },
      uSunDir: { value: new Vector3(0, 1, 0) }, uSunColor: { value: new Color(1, 1, 1) }, uSunDisc: { value: 30 }, uGlow: { value: 1 },
      uCloud: { value: 0 }, uTime: { value: 0 }, uNight: { value: 0 }, uStars: { value: 0 }, uRain: { value: 0 },
      uFogColor: { value: new Color(1, 1, 1) }, uHaze: { value: 0.35 }, uSat: { value: 1.6 }, uScale: { value: 1 }, uCityGlow: { value: cityGlow },
      uBackdrop: { value: 1 }, uHillAmp: { value: hillAmp }, uBackdropCol: { value: new Color(0.12, 0.14, 0.13) }, uCamK: { value: 0 },
      uEnv: { value: 0 }, uEnvGround: { value: c(0x4d4a3f) }, uEnvRing: { value: c(0x55604a) }, uEnvPanels: { value: 0 },
    },
    side: BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
  });
  const geo = new SphereGeometry(1, 48, 24);
  const mesh = new Mesh(geo, material);
  mesh.name = 'sky';
  mesh.renderOrder = -1000;
  mesh.frustumCulled = false;
  // The PMREM copy is dimmer: the sky dome supplies ≈ 25 % of the horizontal illuminance (sun ≈ 75 %), as outdoors;
  // the visible dome keeps the DESIGN colour targets.
  const envMaterial = material.clone();
  envMaterial.name = 'sky.env';
  const envUniforms = { ...material.uniforms, uScale: { value: ENV_SKY_SCALE }, uBackdrop: { value: 0 }, uEnv: { value: 1 } };
  envMaterial.uniforms = envUniforms;
  material.name = 'sky';
  const backdropCol = new Color();
  const overcastFog = new Color(0x9aa1a8);
  const envMesh = new Mesh(geo, envMaterial);
  envMesh.scale.setScalar(900);
  let curTod: TimeOfDay = tod;
  const sunTmp = new Color();
  const setTod = (t: TimeOfDay): void => {
    curTod = t;
    const s = SKY_COLORS[t];
    material.uniforms.uZenith!.value.setHex(s.zenith);
    material.uniforms.uMid!.value.setHex(s.mid);
    material.uniforms.uHorizon!.value.setHex(s.horizon);
    material.uniforms.uGround!.value.setHex(t === 'night' ? 0x0b0c10 : t === 'sunset' ? 0x4a3d31 : 0x5c5a48);
    material.uniforms.uNight!.value = t === 'night' ? 1 : 0;
    material.uniforms.uStars!.value = t === 'night' ? 1.4 : 0;
    material.uniforms.uSunDisc!.value = t === 'night' ? 0 : t === 'sunset' ? 18 : 30;
    material.uniforms.uGlow!.value = t === 'night' ? 0 : t === 'sunset' ? 2.2 : 0.9;
    material.uniforms.uHaze!.value = t === 'night' ? 0.15 : t === 'sunset' ? 0.25 : 0.22;
    material.uniforms.uSat!.value = t === 'night' ? 1.0 : t === 'sunset' ? 1.25 : 1.7;
    material.uniforms.uEnvGround!.value.setHex(t === 'night' ? 0x101012 : t === 'sunset' ? 0x4a3d33 : 0x4d4a3f);
    material.uniforms.uEnvRing!.value.setHex(t === 'night' ? (cityGlow > 1 ? 0x2a2018 : 0x0c0e12) : t === 'sunset' ? 0x3b3a34 : 0x55604a);
    material.uniforms.uEnvPanels!.value = t === 'night' ? 8 : 0;
  };
  setTod(tod);
  return {
    mesh,
    envMesh,
    material,
    update(rig, cloud, rain, time) {
      if (rig.tod !== curTod) setTod(rig.tod);
      const u = material.uniforms;
      u.uSunDir!.value.set(rig.sunDir.x, rig.sunDir.y, rig.sunDir.z).normalize();
      sunTmp.setHex(rig.sunColor);
      u.uSunColor!.value.copy(sunTmp);
      u.uCloud!.value = cloud;
      u.uRain!.value = rain;
      u.uTime!.value = time;
      u.uFogColor!.value.setHex(rig.fogColor);
      // Hazy hill silhouettes: tinted toward the horizon / fog colour of the TOD.
      backdropCol.setHex(rig.tod === 'night' ? 0x050608 : rig.tod === 'sunset' ? 0x4a3f3e : 0x6f7d78).lerp(overcastFog, rig.tod === 'night' ? 0 : cloud * 0.6);
      u.uBackdropCol!.value.copy(backdropCol);
    },
    follow(cam, far) {
      mesh.position.copy(cam.position);
      mesh.scale.setScalar(far * 0.9);
      material.uniforms.uCamK!.value = (0.8 * cam.position.y) / (far * 0.95);
    },
    dispose() {
      geo.dispose();
      material.dispose();
      envMaterial.dispose();
    },
  };
}
