// Shared environment shading (Ç1 program merging, Ç2 floodlights, Ç3 wet track). Every MeshStandardMaterial of
// the environment is built by `envMaterial()`: one `onBeforeCompile` chunk with a constant customProgramCacheKey, the
// per-material behaviour selected by uniforms (`uApxMode`, `uApxP`, ...), and harmonised feature flags (map, normal
// map, roughness map, vertex colours) so that all materials of one *family* compile to the same WebGLProgram:
//
//   opaque      non-instanced, FrontSide                 track surfaces, terrain, barriers, stands, buildings, boards
//   cutout      non-instanced, DoubleSide, alphaTest     fences, run-off wordmark, armco, roofs, gantry steel
//   inst        InstancedMesh (+instanceColor), FrontSide  3D trees, houses, light poles, lamp heads, marshal panels
//   instCutout  InstancedMesh, DoubleSide, alphaTest     crowd, tree billboards
//
// Custom per-vertex / per-instance data is packed into one attribute `aApx` (vec4) per mode (see EnvMode).
// Global uniforms (time, weather, floodlight lightmap) are shared objects updated once per frame / conditions change.

import {
  Color, DataTexture, DoubleSide, FrontSide, LinearFilter, MeshStandardMaterial, NoColorSpace, RGBAFormat, RepeatWrapping,
  SRGBColorSpace, UnsignedByteType, Vector2, Vector4, type IUniform, type Texture, type WebGLProgramParametersWithUniforms,
} from 'three';

/** Bump when the chunk source changes (part of every env program key). */
export const ENV_PROGRAM_KEY = 'apx-env-16';

export const EnvMode = {
  /** map × colour × (vertex colour). */
  Plain: 0,
  /** Track asphalt family: aApx.x = surface (0 track, 1 run-off, 2 pit lane, 3 painted run-off), .y = racing-line d, .z = puddle propensity. */
  Asphalt: 1,
  /** Paint / kerbs: aApx.x = kind (0 line, 1 flat kerb, 2 sausage, 3 chequer), .y = lateral 0..1 across the kerb. */
  Markings: 2,
  /** Grass verge / astroturf: aApx.x = kind; texA = dry grass. */
  Verge: 3,
  /** Terrain splat: aApx = (near, far, valley); texA = green grass, texB = dirt. */
  Terrain: 4,
  /** Emissive × vertex colour (garage back walls). */
  Garage: 5,
  /** Crowd billboards: aApx = (variant, phase); atlas 8 × 2; bob in the vertex shader. */
  Crowd: 6,
  /** Tree cross-billboards: aApx.x = species (atlas 5 × 1); collapsed inside uApxP.x of the camera. */
  Billboard: 7,
  /** Unlit lamp: black albedo, emissive = emissive × vertex/instance colour (start lights, marshal LEDs, lamp heads). */
  Lamp: 8,
  /** Sea surface (T-B): dark water albedo, two scrolling procedural normal layers + three swell trains, faded far away. */
  Water: 9,
  /** Building façades (T-B): procedural window grid from uv (x: face 0..1, +2 on depth faces; y 0..1; roofs uv < 0) and
   *  aApx = (seed, width, depth, height); lit cells glow at uApxP.x (night strength); the ground floor is a shopfront. */
  Facade: 10,
  /** Molten lava (Volcano Rim): uv in metres (u along the flow); a dark crust of drifting plates with glowing seams and
   *  molten pools, pulsing; emission × uApxP.x (glow strength, raised by eruptions). */
  Lava: 11,
  /** 3D tree crowns (realism pass 2026-11): procedural leaf clumps, dark gaps, hue variation and a roughened normal on
   *  the green (foliage) vertex colours; bark is left plain. Fades to the plain colour with distance. */
  Foliage: 12,
} as const;
export type EnvModeId = (typeof EnvMode)[keyof typeof EnvMode];
export type EnvFamily = 'opaque' | 'cutout' | 'inst' | 'instCutout';

export const GLSL_NOISE = /* glsl */ `
float apxHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float apxNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(apxHash(i), apxHash(i + vec2(1.0, 0.0)), u.x), mix(apxHash(i + vec2(0.0, 1.0)), apxHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float apxFbm(vec2 p) { return 0.5 * apxNoise(p) + 0.25 * apxNoise(p * 2.07 + 5.3) + 0.125 * apxNoise(p * 4.11 + 1.7); }
// Parkland grass: the CC0 grass map averages brown-olive; re-hue it to a lush green at the same luminance.
vec3 apxLush(vec3 c) { return dot(c, vec3(0.3, 0.59, 0.11)) * vec3(0.55, 1.3, 0.22); }
`;

// ---------------------------------------------------------------------------------------------------------------
// GLSL

const V_COMMON = /* glsl */ `
attribute vec4 aApx;
uniform int uApxMode;
uniform float uApxTime;
uniform vec4 uApxP;
varying vec4 vApxA;
varying vec3 vApxWP;
varying vec2 vApxSD;
varying float vApxUp;
`;

const V_BEGIN = /* glsl */ `
if (uApxMode == 6) {
  float apxPh = aApx.y;
  transformed.y += (0.025 + 0.06 * step(0.85, fract(apxPh * 7.3))) * max(0.0, sin(uApxTime * (2.0 + 2.5 * fract(apxPh * 3.1)) + apxPh * 6.2831));
}
#ifdef USE_INSTANCING
// Billboards hand over to the 3D trees inside uApxP.x (collapse to a degenerate point).
if (uApxMode == 7 && distance(instanceMatrix[3].xz, cameraPosition.xz) < uApxP.x) transformed = vec3(0.0);
#endif
`;

const V_END = /* glsl */ `
{
  vec4 apxW = vec4(transformed, 1.0);
#ifdef USE_INSTANCING
  apxW = instanceMatrix * apxW;
#endif
  vApxWP = (modelMatrix * apxW).xyz;
}
vApxA = aApx;
vApxSD = uv;
vApxUp = objectNormal.y;
`;

const F_COMMON = /* glsl */ `
uniform int uApxMode;
uniform float uApxVC;
uniform vec4 uApxP;
uniform sampler2D uApxTexA;
uniform sampler2D uApxTexB;
uniform float uApxTime;
uniform float uApxRain;
uniform float uApxWet;
uniform float uApxLineWet;
uniform sampler2D uApxFlood;
uniform vec4 uApxFloodBox;
uniform vec3 uApxFloodCol;
uniform float uApxFloodK;
uniform float uApxKeyMask;
varying vec4 vApxA;
varying vec3 vApxWP;
varying vec2 vApxSD;
varying float vApxUp;
${GLSL_NOISE}
// Rain ripple rings on a 0.55 m grid, two layers; returns the xz slope of the ripple height field.
vec2 apxRipples(vec2 p, float t) {
  vec2 g = vec2(0.0);
  for (int k = 0; k < 2; k++) {
    vec2 q = p * (k == 0 ? 1.8 : 2.6) + float(k) * 7.31;
    vec2 cell = floor(q);
    vec2 c = cell + 0.2 + 0.6 * vec2(apxHash(cell), apxHash(cell + 17.3));
    float ph = apxHash(cell + 3.7);
    float a = fract(t * (0.9 + 0.5 * ph) + ph);
    vec2 dv = q - c;
    float r = length(dv);
    float ring = r - a * 0.55;
    float w = exp(-ring * ring * 70.0) * (1.0 - a) * (1.0 - a);
    g += dv / max(r, 1e-3) * w * sin(ring * 32.0);
  }
  return g;
}
`;

// Replaces <map_fragment>: albedo per mode. Declares the per-fragment scratch used by later chunks.
const F_MAP = /* glsl */ `
vec3 apxVC = vec3(1.0);
#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA ) || defined( USE_INSTANCING_COLOR )
apxVC = vColor.rgb;
#endif
float apxRough = 1.0;   // roughness multiplier
float apxMinRough = 0.04;
float apxLine = 0.0;    // racing-line weight (asphalt): dries first
vec3 apxWinE = vec3(0.0); // façade window emission (Facade mode)
float apxPud = 0.0;     // puddle propensity 0..1 (asphalt)
float apxGloss = 0.0;   // paint / kerbs: glossier when wet
float apxSpec = 1.0;    // sky-reflection (IBL specular) multiplier: rubber absorbs, so the line reads dark at grazing angles
float apxWetK = uApxP.y;
float apxLeaf = 0.0;     // foliage weight (Foliage mode): drives the normal roughening
// Floodlight lightmap texel (Ç2): r = sqrt(E / 1.6), gb = mean direction to the lamps (xz).
vec4 apxFl = texture2D(uApxFlood, (vApxWP.xz - uApxFloodBox.xy) * uApxFloodBox.zw);
float apxPool = apxFl.r * apxFl.r * 1.6;
// a = lit-surface height + 128 m (0 = none): no pool on ground 15–35 m+ below the lamps' road (elevated decks).
// a = 1 is the clamped floor (lamps below −127 m, the Eifel valley): height unknown, no dimming.
if (apxFl.a * 255.0 > 1.5) apxPool *= 1.0 - smoothstep(15.0, 35.0, apxFl.a * 255.0 - 128.0 - vApxWP.y);
if (uApxMode == 6 || uApxMode == 7) {
#ifdef USE_MAP
  vec2 apxCuv = uApxMode == 6
    ? vec2((mod(vApxA.x, 8.0) + vMapUv.x) / 8.0, (floor(vApxA.x / 8.0) + vMapUv.y) / 2.0)
    : vec2((vApxA.x + vMapUv.x) / 5.0, vMapUv.y);
  vec4 apxTc = texture2D(map, apxCuv);
  if (uApxMode == 6) {
    vec3 shirt = apxVC;
    vec3 skin = mix(vec3(0.55, 0.38, 0.27), vec3(0.85, 0.66, 0.52), fract(vApxA.x * 0.37 + shirt.r));
    vec3 hair = mix(vec3(0.05, 0.04, 0.035), shirt * 0.6, step(0.66, fract(vApxA.x * 0.21)));
    diffuseColor = vec4((apxTc.r * shirt + apxTc.g * skin + apxTc.b * hair) / max(0.001, apxTc.r + apxTc.g + apxTc.b), apxTc.a);
    // Realism pass 2026-11: with distance the per-person colours merge into a muted mass (no confetti sparkle).
    diffuseColor.rgb *= mix(0.55, 1.0, smoothstep(0.0, 0.5, vMapUv.y));
    float apxCd = smoothstep(30.0, 150.0, length(vApxWP - cameraPosition));
    diffuseColor.rgb = mix(diffuseColor.rgb, mix(vec3(dot(diffuseColor.rgb, vec3(0.3333))), vec3(0.3, 0.29, 0.3), 0.5), 0.6 * apxCd);
  } else {
    diffuseColor *= apxTc;
  }
#endif
} else {
  #include <map_fragment>
  vec2 sd = vApxSD;
  if (uApxMode == 0) {
    // Realism pass 2026-11: built surfaces are never one flat colour. Broad weathering stains, and on walls faint
    // vertical rain streaks; both fade with distance (no shimmer) and stay subtle on sponsor boards.
    float wNr = 1.0 - smoothstep(60.0, 220.0, length(vApxWP - cameraPosition));
    float stain = apxFbm(vApxWP.xz * 0.13 + vApxWP.y * 0.19);
    float wall = 1.0 - smoothstep(0.2, 0.6, abs(vApxUp));
    float streak = apxNoise(vec2((vApxWP.x + vApxWP.z) * 1.7, vApxWP.y * 0.09)) * apxNoise(vec2((vApxWP.x - vApxWP.z) * 0.6, vApxWP.y * 0.3 + 4.0));
    float grime = (stain - 0.45) * 0.3 - wall * smoothstep(0.25, 0.6, streak) * 0.16;
    diffuseColor.rgb *= 1.0 + grime * (0.4 + 0.6 * wNr);
  }
  if (uApxMode == 1) {
    float apxMacro = apxFbm(sd * vec2(0.035, 0.12));
    // Realism pass 2026-11: sunlit asphalt is a mid-dark grey (albedo ~0.1), so shadows and rubber read against it.
    diffuseColor.rgb *= (0.86 + 0.26 * apxMacro) * 1.3;
    float surf = vApxA.x;
    apxPud = vApxA.z;
    if (surf < 0.5) {
      float dd = abs(sd.y - vApxA.y);
      float rub = exp(-dd * dd / 1.9) * (0.6 + 0.4 * apxNoise(sd * vec2(0.05, 1.6)));
      rub += 0.25 * exp(-dd * dd / 9.0);
      // Visual pass 2026-10: off the line the asphalt is dusty and sun-bleached (lighter grey, more so toward the
      // edges); on it the rubber is dark. Contrast comes from both sides: darkening an already dark albedo alone read flat.
      float apxCam = length(vApxWP - cameraPosition);
      float dust = smoothstep(1.2, 5.0, dd) * (0.7 + 0.6 * apxNoise(sd * vec2(0.06, 0.8)));
      float grain = dot(diffuseColor.rgb, vec3(0.3333));
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.2, 0.19, 0.175) * (0.75 + 2.5 * grain), 0.45 * dust);
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.026, 0.025, 0.025), 0.68 * clamp(rub, 0.0, 1.0));
      // Repair patches: rectangles in 23 m × 3.6 m cells (≈ 1 cell in 7), fresh dark or old grey, with a sealed seam.
      vec2 pcell = vec2(floor(sd.x / 23.0), floor((sd.y + 40.0) / 3.6));
      float ph = apxHash(pcell + 41.0);
      if (ph > 0.86) {
        vec2 pf = vec2(fract(sd.x / 23.0), fract((sd.y + 40.0) / 3.6));
        vec2 lo = vec2(0.08 + 0.3 * apxHash(pcell + 3.1), 0.04 + 0.2 * apxHash(pcell + 5.3));
        vec2 hi = min(lo + vec2(0.22 + 0.45 * apxHash(pcell + 7.7), 0.5 + 0.4 * apxHash(pcell + 9.1)), vec2(0.97));
        float inP = step(lo.x, pf.x) * step(pf.x, hi.x) * step(lo.y, pf.y) * step(pf.y, hi.y);
        vec2 em = min(pf - lo, hi - pf) * vec2(23.0, 3.6);
        float seam = inP * (1.0 - smoothstep(0.04, 0.1, min(em.x, em.y))) * (1.0 - smoothstep(35.0, 70.0, apxCam));
        diffuseColor.rgb *= mix(1.0, ph > 0.93 ? 0.7 : 1.2, inP) * (1.0 - 0.5 * seam);
      }
      // Sealed cracks (thin meandering noise iso-lines in sparse zones) and the paving joint on the centreline; both
      // fade out before they would alias.
      float apxNr = 1.0 - smoothstep(20.0, 45.0, apxCam);
      float crack = (1.0 - smoothstep(0.006, 0.016, abs(apxNoise(sd * vec2(0.09, 0.32)) - 0.5)))
        * smoothstep(0.58, 0.78, apxNoise(sd * vec2(0.012, 0.06) + 11.0));
      float joint = 1.0 - smoothstep(0.02, 0.06, abs(sd.y + 0.3 * apxNoise(sd * vec2(0.05, 0.0))));
      diffuseColor.rgb *= 1.0 - apxNr * (0.4 * crack + 0.25 * joint);
      // Tyre marks: twin dark tracks (≈ 1.6 m apart) wandering about the racing line, in intermittent runs.
      float wob = (apxNoise(vec2(sd.x * 0.02, 3.0)) - 0.5) * 1.6;
      float tdd = abs(abs(sd.y - vApxA.y - wob) - 0.8);
      float run = smoothstep(0.55, 0.8, apxNoise(vec2(sd.x * 0.012, 7.0 + floor(wob * 2.0))));
      float marks = (1.0 - smoothstep(0.1, 0.24, tdd)) * run * (0.6 + 0.4 * apxNoise(sd * vec2(0.4, 2.0)));
      diffuseColor.rgb *= 1.0 - 0.45 * marks * (1.0 - smoothstep(40.0, 90.0, apxCam));
      // Rubber reads matte-dark at a glance (a glossier line mirrored the bright sky and cancelled its darkening).
      apxRough = 0.95 + 0.05 * clamp(rub, 0.0, 1.0);
      apxMinRough = 0.45;
      // At grazing angles the IBL sky sheen dominates the dark albedo; rubber and fresh patches mute it, dust keeps it.
      apxSpec = 1.0 - 0.75 * clamp(rub, 0.0, 1.0) - 0.25 * marks;
      apxLine = exp(-dd * dd / 2.6);
    } else if (surf < 1.5) {
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(dot(diffuseColor.rgb, vec3(0.33))) * vec3(1.02, 1.02, 1.04), 0.5) * 1.12;
    } else if (surf < 2.5) {
      // Gravel trap (visual pass 2026-10): pebble grain, raked furrows along s, darker coarse patches, and grooves /
      // scattered dark stones where cars ran through near the track edge. Fine detail fades with distance.
      float gCam = length(vApxWP - cameraPosition);
      float gNr = 1.0 - smoothstep(25.0, 70.0, gCam);
      float pebble = apxNoise(sd * 7.0) * 0.6 + apxNoise(sd * 17.0 + 3.0) * 0.4;
      float rake = 0.5 + 0.5 * sin(sd.y * 9.0 + 2.0 * apxNoise(sd * vec2(0.08, 0.3)));
      float coarse = smoothstep(0.45, 0.75, apxFbm(sd * vec2(0.06, 0.14) + 21.0));
      vec3 g = diffuseColor.rgb * mix(vec3(0.9, 0.85, 0.76), vec3(0.55, 0.52, 0.48), coarse) * (0.85 + 0.3 * apxFbm(sd * vec2(0.02, 0.05) + 2.0));
      g *= 1.0 + gNr * (0.32 * (pebble - 0.5) - 0.08 * rake);
      float ruts = smoothstep(0.62, 0.86, apxNoise(vec2(sd.x * 0.05, sd.y * 0.9))) * smoothstep(18.0, 2.0, abs(sd.y) - 8.0);
      g *= 1.0 - 0.35 * ruts;
      diffuseColor.rgb = g;
      apxSpec = 0.6;
    } else {
      float band = step(0.5, fract(sd.x / 6.0));
      // uApxP.x = seaside palette (Aegean): blue / white bands instead of red / blue.
      vec3 paint = uApxP.x > 0.5 ? mix(vec3(0.016, 0.045, 0.14), vec3(0.3, 0.3, 0.29), band) : mix(vec3(0.13, 0.02, 0.022), vec3(0.016, 0.034, 0.105), band);
      float lum = dot(diffuseColor.rgb, vec3(0.3333));
      // Weathered paint: asphalt grain shows through, worn patches, tyre marks of cars running wide.
      float wear = smoothstep(0.25, 0.8, apxFbm(sd * vec2(0.22, 0.45))) * 0.55 + 0.25 * apxNoise(sd * vec2(1.7, 3.1));
      vec3 painted = paint * (0.3 + 3.0 * lum);
      diffuseColor.rgb = mix(painted, diffuseColor.rgb * 1.05, clamp(0.2 + wear, 0.0, 0.85));
      float marks = smoothstep(0.55, 0.85, apxNoise(vec2(sd.x * 0.035, sd.y * 1.3))) * smoothstep(22.0, 9.0, abs(sd.y));
      diffuseColor.rgb *= 1.0 - 0.45 * marks;
      apxRough = 0.8;
      apxMinRough = 0.35;
      apxGloss = 0.5;
    }
  } else if (uApxMode == 2) {
    float kind = vApxA.x, lat = vApxA.y;
    float lum = dot(diffuseColor.rgb, vec3(0.3333));
    vec3 paintCol = vec3(0.86, 0.86, 0.84);
    if (kind > 0.5 && kind < 1.5) {
      float st = step(0.5, fract(sd.x * 0.5));
      paintCol = mix(uApxP.x > 0.5 ? vec3(0.03, 0.13, 0.52) : vec3(0.62, 0.035, 0.04), vec3(0.84, 0.84, 0.82), st);
      float tooth = 1.0 - fract(sd.x / 0.6);
      if (lat > 0.78 && (lat - 0.78) / 0.22 > tooth) paintCol = vec3(0.16, 0.16, 0.17);
      float dirt = smoothstep(0.55, 0.0, lat) * 0.25 + 0.2 * smoothstep(0.6, 0.95, apxNoise(sd * vec2(0.7, 4.0)));
      // Rubber streaks where cars ride the kerb (along s, densest on the track-side half) and chipped paint.
      float kRub = smoothstep(0.45, 0.8, apxNoise(vec2(sd.x * 0.08, lat * 6.0))) * (1.0 - smoothstep(0.3, 0.85, lat));
      float chip = smoothstep(0.8, 0.86, apxNoise(sd * vec2(2.3, 5.0)) * 0.7 + apxNoise(sd * vec2(7.0, 13.0)) * 0.3) * 0.45;
      paintCol *= (1.0 - dirt) * (1.0 - 0.7 * kRub);
      paintCol = mix(paintCol, vec3(0.12, 0.12, 0.13), chip * (1.0 - smoothstep(15.0, 35.0, length(vApxWP - cameraPosition))));
    } else if (kind > 1.5 && kind < 2.5) {
      paintCol = vec3(0.86, 0.62, 0.02);
    } else if (kind > 2.5 && kind < 3.5) {
      float cc = mod(floor(sd.x / 0.5) + floor(sd.y / 0.5), 2.0);
      paintCol = mix(vec3(0.03), vec3(0.86), cc);
    } else if (kind > 3.5) {
      // Team-coloured box markings: colour from the vertex colour.
      paintCol = apxVC;
    }
    diffuseColor.rgb = paintCol * (0.78 + 0.55 * lum);
    apxGloss = 1.0;
  } else if (uApxMode == 3) {
    vec3 dry = texture2D(uApxTexA, sd / 5.5).rgb;
    if (vApxA.x < 0.5) {
      float m = smoothstep(0.42, 0.72, apxFbm(sd * 0.035));
      // uApxP.x = theme greenness (0 golden İstanbul, 1 green parkland): fewer dry patches.
      vec3 grass = uApxP.x > 0.5 ? apxLush(diffuseColor.rgb) : diffuseColor.rgb * vec3(0.92, 1.0, 0.82);
      diffuseColor.rgb = mix(grass, dry * vec3(1.05, 0.98, 0.85), m * 0.7 * (1.0 - 0.85 * uApxP.x));
      float mow = 0.86 + 0.14 * step(0.5, fract(sd.x / 9.0)) + 0.04 * apxNoise(sd * 0.5);
      diffuseColor.rgb *= mow;
      // Realism pass 2026-11: blade grain, darker tufts and yellow-dry flecks close to the camera.
      float gNr = 1.0 - smoothstep(18.0, 70.0, length(vApxWP - cameraPosition));
      float blade = apxNoise(sd * vec2(23.0, 17.0)) * 0.6 + apxNoise(sd * vec2(61.0, 47.0) + 5.0) * 0.4;
      float tuft = smoothstep(0.55, 0.8, apxNoise(sd * 1.7 + 9.0));
      diffuseColor.rgb *= 1.0 + gNr * (0.55 * (blade - 0.5) - 0.22 * tuft);
      diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.35, 1.2, 0.6), gNr * 0.45 * smoothstep(0.62, 0.85, apxNoise(sd * 0.9 + 31.0)));
    } else {
      float lum = dot(diffuseColor.rgb, vec3(0.3333));
      diffuseColor.rgb = vec3(0.05, 0.27, 0.09) * (0.75 + 0.7 * lum);
      // Sun-faded, scuffed paint: macro fade, worn patches showing the grey base, tyre smudges.
      float fadeP = apxFbm(sd * vec2(0.03, 0.2));
      diffuseColor.rgb = mix(diffuseColor.rgb * 0.85, diffuseColor.rgb * vec3(1.4, 1.2, 1.1), fadeP);
      float worn = smoothstep(0.55, 0.75, apxFbm(sd * vec2(0.15, 0.6) + 9.0));
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.16, 0.16, 0.15) * (0.8 + 0.6 * lum), 0.55 * worn);
      float smudge = smoothstep(0.6, 0.85, apxNoise(vec2(sd.x * 0.04, sd.y * 1.1) + 4.0));
      diffuseColor.rgb *= 1.0 - 0.4 * smudge;
      apxGloss = 0.4;
    }
  } else if (uApxMode == 4) {
    vec2 wxz = vApxWP.xz;
    float camD = length(vApxWP - cameraPosition);
    float vNear = vApxA.x, vFar = vApxA.y, vValley = vApxA.z;
    vec3 dry = diffuseColor.rgb * vec3(0.56, 0.48, 0.32);
    vec3 green = texture2D(uApxTexA, wxz / 5.0).rgb;
    green = uApxP.x > 0.5 ? apxLush(green) : green * vec3(0.86, 1.0, 0.74);
    vec3 dirt = texture2D(uApxTexB, wxz / 8.0).rgb * vec3(1.0, 0.92, 0.82);
    // Distance: fade the tiled detail into the macro colour to hide repetition.
    float fade = smoothstep(80.0, 700.0, camD);
    dry = mix(dry, vec3(0.13, 0.1, 0.05), fade * 0.8);
    green = mix(green, uApxP.x > 0.5 ? vec3(0.03, 0.075, 0.014) : vec3(0.04, 0.062, 0.022), fade * 0.75);
    dirt = mix(dirt, vec3(0.1, 0.072, 0.045), fade * 0.75);
    float macro = apxFbm(wxz * 0.0035);
    float g = clamp(smoothstep(0.38, 0.7, macro) * 0.7 + smoothstep(0.05, 0.6, vValley) * 0.75 + vNear * 0.6, 0.0, 1.0);
    // uApxP.x = theme greenness floor (0 golden İstanbul, ~0.85 green parkland).
    g = max(g, min(uApxP.x, 1.0) * (0.85 + 0.15 * macro));
    vec3 col = mix(dry, green, g);
    float slope = 1.0 - vApxUp;
    float dm = clamp(smoothstep(0.12, 0.32, slope) + smoothstep(0.72, 0.88, apxFbm(wxz * 0.011 + 7.0)) * (1.0 - vNear), 0.0, 1.0);
    col = mix(col, dirt, dm * 0.85 * (1.0 - 0.7 * min(uApxP.x, 1.0)));
    // Worn, darker earth along the barrier line; mowing stripes near the track.
    float edgeBand = smoothstep(0.35, 0.75, vNear) * (1.0 - smoothstep(0.85, 1.0, vNear));
    col = mix(col, dirt * 0.6, edgeBand * 0.45 * smoothstep(0.3, 0.7, apxNoise(wxz * 0.08)));
    col *= 1.0 - 0.07 * step(0.5, fract(dot(wxz, vec2(0.707, 0.707)) / 7.0)) * smoothstep(0.6, 0.9, vNear);
    if (vFar > 0.25 && uApxP.x < 2.5) {
      vec2 cell = floor(wxz / vec2(210.0, 140.0));
      float hsh = fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5453);
      vec3 field = hsh < 0.33 ? vec3(0.13, 0.1, 0.05) : hsh < 0.66 ? vec3(0.09, 0.065, 0.04) : vec3(0.045, 0.065, 0.025);
      float furrow = 0.92 + 0.08 * sin(dot(wxz, vec2(0.3, 0.12)) + hsh * 20.0);
      // Parkland (uApxP.x = 1): pasture rather than ploughed fields.
      if (abs(uApxP.x - 1.0) < 0.5) field = apxLush(field) * 1.15;
      col = mix(col, field * furrow, smoothstep(0.25, 0.9, vFar) * 0.45);
    }
    if (uApxP.x > 6.5) {
      // Volcanic theme (uApxP.x = 7, tracks-volcano.md §6): black basalt and rust-red scoria, pale grey ash drifts by the
      // track and in hollows, glossy obsidian flows on steep ground, sulphur-yellow staining on the high crater ground.
      float hY = vApxWP.y;
      float tx = texture2D(uApxTexB, wxz / 8.0).r;
      float mN = apxFbm(wxz * 0.006 + 2.0);
      vec3 basalt = vec3(0.045, 0.042, 0.04) * (0.8 + 0.5 * tx) * (0.85 + 0.3 * apxNoise(wxz * 0.05));
      vec3 scoria = vec3(0.16, 0.06, 0.035) * (0.8 + 0.4 * tx);
      vec3 ashC = vec3(0.17, 0.165, 0.16) * (0.85 + 0.25 * tx);
      vec3 v = mix(basalt, scoria, smoothstep(0.55, 0.75, mN) * 0.85);
      v = mix(v, ashC, clamp(smoothstep(0.55, 0.9, vNear) * 0.45 + smoothstep(0.66, 0.82, apxFbm(wxz * 0.012 + 9.0)) * 0.55 * (1.0 - smoothstep(0.15, 0.3, slope)), 0.0, 1.0));
      // Obsidian: dark glassy streaks on steep ground (low roughness).
      float obs = smoothstep(0.22, 0.42, slope) * smoothstep(0.45, 0.7, apxNoise(vec2(dot(wxz, vec2(0.05, 0.02)), hY * 0.08)));
      v = mix(v, vec3(0.012, 0.012, 0.016), obs * 0.9);
      apxRough = mix(1.0, 0.25, obs);
      // Lava strata on cliffs (dark bands), sulphur staining high up.
      v *= 1.0 - 0.3 * smoothstep(0.85, 0.97, fract(hY / 4.5 + 0.4 * apxNoise(wxz * 0.02))) * smoothstep(0.2, 0.4, slope);
      v = mix(v, vec3(0.36, 0.3, 0.06), smoothstep(0.3, 0.5, slope) * smoothstep(120.0, 170.0, hY) * smoothstep(0.7, 0.85, apxNoise(wxz * 0.03 + 4.0)) * 0.5);
      v = mix(v, vec3(0.05, 0.045, 0.04), fade * 0.4);
      col = v;
    } else if (uApxP.x > 5.5) {
      // Tuff valley theme (uApxP.x = 6, tracks-cappadocia.md §8): dusty olive-gold valley floor with pale dust near the
      // track, soft rose / cream / ochre volcanic-tuff bands on the slopes and the terraced walls, darker eroded gullies.
      float hY = vApxWP.y;
      float tx = texture2D(uApxTexB, wxz / 8.0).r;
      vec3 floorC = mix(col * vec3(1.08, 0.98, 0.78), vec3(0.34, 0.27, 0.17) * (0.85 + 0.3 * tx), 0.45);
      vec3 dust = vec3(0.47, 0.39, 0.29) * (0.88 + 0.22 * tx);
      col = mix(floorC, dust, smoothstep(0.35, 0.8, vNear) * 0.7);
      float sh = hY / 6.5 + 0.8 * apxNoise(wxz * 0.012);
      float tone = apxHash(vec2(floor(sh), 1.9));
      vec3 tuff = tone < 0.33 ? vec3(0.74, 0.48, 0.40) : tone < 0.66 ? vec3(0.80, 0.70, 0.56) : vec3(0.70, 0.48, 0.30);
      tuff *= (0.85 + 0.25 * apxFbm(wxz * 0.03 + hY * 0.05)) * (0.85 + 0.3 * tx);
      tuff *= 1.0 - 0.25 * smoothstep(0.88, 0.98, fract(sh));
      tuff = mix(tuff, vec3(0.42, 0.33, 0.27), fade * 0.4);
      float rocky = smoothstep(0.16, 0.36, slope) + smoothstep(25.0, 70.0, hY) * 0.6;
      col = mix(col, tuff, clamp(rocky, 0.0, 1.0) * (1.0 - 0.85 * vNear));
      col *= 1.0 - 0.3 * smoothstep(0.6, 0.85, apxNoise(wxz * 0.02)) * smoothstep(0.2, 0.4, slope);
    } else if (uApxP.x > 4.5) {
      // Island theme (uApxP.x = 5, tracks-aegean.md §8; sea level y −4): golden straw and olive-green scrub, white
      // limestone on steep ground, pale sand coves at the waterline, a dark wet-sand band, dusty pale verges.
      float hY = vApxWP.y;
      float tx = texture2D(uApxTexB, wxz / 8.0).r;
      vec3 straw = vec3(0.30, 0.235, 0.12) * (0.85 + 0.3 * apxFbm(wxz * 0.01)) * (0.85 + 0.3 * tx);
      float scrubN = apxNoise(wxz * 0.07) * 0.55 + apxFbm(wxz * 0.01 + 5.0) * 0.45;
      vec3 isl = mix(straw, vec3(0.07, 0.095, 0.035) * (0.8 + 0.4 * tx), smoothstep(0.5, 0.66, scrubN) * 0.85);
      isl = mix(isl, mix(straw, vec3(0.06, 0.05, 0.03), 0.2), fade * 0.5);
      isl = mix(isl, vec3(0.40, 0.33, 0.22) * (0.88 + 0.2 * tx), smoothstep(0.3, 0.75, vNear) * 0.7);
      // Steep ground: warm ochre / cream limestone in strata bands with dark ledges, scrub clinging to the ledges.
      float ish = (hY + 4.0) / 3.2 + 0.5 * apxNoise(wxz * 0.02);
      float iband = fract(ish);
      float itone = apxHash(vec2(floor(ish), 9.1));
      vec3 stone = mix(vec3(0.5, 0.38, 0.22), vec3(0.6, 0.55, 0.45), itone) * (0.85 + 0.3 * tx);
      stone *= 1.0 - 0.35 * smoothstep(0.84, 0.96, iband);
      stone = mix(stone, vec3(0.06, 0.09, 0.03), smoothstep(0.6, 0.75, apxNoise(wxz * 0.09 + floor(ish))) * (1.0 - smoothstep(0.2, 0.45, iband)) * 0.8);
      isl = mix(isl, stone, smoothstep(0.24, 0.45, slope) * (1.0 - 0.8 * vNear));
      vec3 beach = vec3(0.56, 0.48, 0.34) * (0.9 + 0.2 * tx);
      isl = mix(isl, beach, (1.0 - smoothstep(-2.6, -1.2, hY)) * (1.0 - smoothstep(0.3, 0.5, slope)));
      isl = mix(isl, beach * 0.55, 1.0 - smoothstep(-3.95, -3.6, hY));
      col = isl;
    } else if (uApxP.x > 3.5) {
      // Desert theme (uApxP.x = 4, tracks-cliff.md §8): wind-rippled sand, compact pale sand by the track, limestone with
      // horizontal strata on the escarpment faces and steep ground.
      float hY = vApxWP.y;
      float tx = texture2D(uApxTexB, wxz / 8.0).r;
      float rip = 0.93 + 0.07 * sin(dot(wxz, vec2(0.55, 0.23)) + 6.0 * apxNoise(wxz * 0.02));
      vec3 sand = vec3(0.40, 0.28, 0.155) * (0.85 + 0.3 * apxFbm(wxz * 0.006)) * (0.85 + 0.3 * tx) * rip;
      sand = mix(sand, vec3(0.30, 0.21, 0.12), fade * 0.5);
      vec3 pale = vec3(0.46, 0.37, 0.25) * (0.88 + 0.2 * tx);
      col = mix(sand, pale, smoothstep(0.25, 0.75, vNear));
      // Limestone escarpment: blocky strata bands (pale cream / tan / dark ledges), vertical cracks, darker in the cracks.
      float sh = hY / 5.5 + 0.6 * apxNoise(wxz * 0.015);
      float band = fract(sh);
      float tone = apxHash(vec2(floor(sh), 3.7));
      vec3 lime = mix(vec3(0.42, 0.35, 0.25), vec3(0.27, 0.2, 0.13), tone);
      lime *= 1.0 - 0.35 * smoothstep(0.86, 0.97, band);
      float crack = smoothstep(0.82, 0.95, apxNoise(vec2(dot(wxz, vec2(0.7, 0.7)) * 0.12, hY * 0.05)));
      lime *= (1.0 - 0.3 * crack) * (0.85 + 0.3 * tx);
      col = mix(col, lime, smoothstep(0.18, 0.38, slope) * (1.0 - 0.8 * vNear));
      // Canyon floor: darker, redder wadi gravel 100 m below the plateau.
      col = mix(col, vec3(0.26, 0.16, 0.09) * (0.8 + 0.4 * tx), smoothstep(-60.0, -100.0, hY) * (1.0 - smoothstep(0.22, 0.45, slope)) * 0.75);
    } else if (uApxP.x > 2.5) {
      // Alpine theme (uApxP.x = 3, tracks-alpine.md §9): meadows in the valley, scree and grey rock on steep or high
      // ground, snowfields above a noisy ≈ 330 m line on the gentler slopes.
      float hY = vApxWP.y;
      float mN = apxFbm(wxz * 0.004 + 3.0);
      col = mix(col, col * vec3(1.12, 1.08, 0.72), smoothstep(0.55, 0.8, mN) * 0.45);
      vec3 rock = vec3(0.17, 0.165, 0.15) * (0.7 + 0.6 * apxNoise(wxz * 0.045)) * (0.8 + 0.4 * texture2D(uApxTexB, wxz / 9.0).r);
      rock = mix(rock, vec3(0.13, 0.125, 0.115), fade * 0.6);
      float rk = smoothstep(0.26, 0.48, slope) + smoothstep(220.0, 520.0, hY) * (0.55 + 0.45 * apxFbm(wxz * 0.006));
      col = mix(col, rock, clamp(rk, 0.0, 1.0) * (1.0 - vNear));
      float snowLine = 540.0 + 220.0 * (apxFbm(wxz * 0.0014) - 0.5);
      float sn = smoothstep(snowLine - 25.0, snowLine + 45.0, hY) * (1.0 - smoothstep(0.3, 0.55, slope + 0.25 * (apxNoise(wxz * 0.012) - 0.5)));
      col = mix(col, vec3(0.78, 0.8, 0.84) * (0.92 + 0.1 * apxNoise(wxz * 0.02)), sn);
    } else if (uApxP.x > 1.5) {
      // Urban theme (uApxP.x = 2): pavements near the track, dark built-up ground with small parks further out.
      vec3 pave = vec3(0.095, 0.088, 0.078) * (0.82 + 0.3 * apxNoise(wxz * 0.35)) * (0.9 + 0.2 * texture2D(uApxTexB, wxz / 8.0).r);
      vec3 urb = mix(vec3(0.04, 0.036, 0.031), green * 0.6, smoothstep(0.52, 0.64, macro));
      col = mix(urb, pave, smoothstep(0.15, 0.55, vNear));
    }
    if (uApxP.x < 0.5) {
      // Golden hills (visual pass 2026-10): bleached straw swathes and dark olive scrub clumps break up the even ochre;
      // no scrub on the verges, and it fades before it could shimmer at range.
      float straw = smoothstep(0.5, 0.78, apxFbm(wxz * 0.006 + 13.0));
      col = mix(col, col * vec3(1.35, 1.25, 1.05), straw * 0.6);
      float scrubN = apxNoise(wxz * 0.09) * 0.55 + apxFbm(wxz * 0.012 + 5.0) * 0.45;
      float scrub = smoothstep(0.62, 0.74, scrubN) * (1.0 - smoothstep(0.45, 0.85, vNear)) * (1.0 - smoothstep(250.0, 600.0, camD));
      col = mix(col, vec3(0.035, 0.042, 0.018), scrub * 0.7);
    }
    col *= 0.7 + 0.5 * apxFbm(wxz * 0.0012 + 3.0);
    col *= 0.85 + 0.3 * apxNoise(wxz * 0.05);
    float tNr = 1.0 - smoothstep(20.0, 90.0, camD);
    col *= 1.0 + tNr * (0.5 * (apxNoise(wxz * 19.0) * 0.6 + apxNoise(wxz * 53.0 + 5.0) * 0.4 - 0.5) - 0.2 * smoothstep(0.55, 0.8, apxNoise(wxz * 1.6 + 9.0)));
    diffuseColor.rgb = col;
  } else if (uApxMode == 9) {
    // uApxP.x = shallow turquoise lagoon (Desert Cliff water park; 0 = deep sea / lake). With vertex colours (Aegean
    // sea): r = shallowness (deep Aegean blue → turquoise), g = foam (coasts, bridge piers, the breakwater).
    if (uApxVC > 0.5) {
      float apxFoam = apxVC.g * (0.45 + 0.55 * apxNoise(vApxWP.xz * 0.5 + vec2(uApxTime * 0.35, -uApxTime * 0.2)));
      diffuseColor.rgb = mix(vec3(0.004, 0.026, 0.07), vec3(0.03, 0.27, 0.29), apxVC.r);
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.72, 0.76, 0.78), smoothstep(0.15, 0.6, apxFoam));
      apxVC = vec3(1.0);
    } else {
      diffuseColor.rgb = mix(vec3(0.010, 0.026, 0.032), vec3(0.025, 0.25, 0.27), uApxP.x);
    }
    apxMinRough = 0.02;
  } else if (uApxMode == 10) {
    if (sd.x >= 0.0) {
      float faceW = sd.x < 1.5 ? vApxA.y : vApxA.z;
      vec2 m = vec2(fract(sd.x) * faceW, sd.y * vApxA.w);
      vec2 cell = floor(m / vec2(3.0, 3.2));
      vec2 f = fract(m / vec2(3.0, 3.2));
      float shop = 1.0 - step(1.0, cell.y);
      vec2 lo = mix(vec2(0.22, 0.3), vec2(0.06, 0.08), shop), hi = mix(vec2(0.78, 0.85), vec2(0.94, 0.78), shop);
      float win = step(lo.x, f.x) * step(f.x, hi.x) * step(lo.y, f.y) * step(f.y, hi.y);
      // No windows in the top 0.6 m (parapet) or on the partial column at the face end.
      win *= step(m.y, vApxA.w - 0.6) * step(cell.x * 3.0 + 3.0, faceW + 0.01);
      // Seed rounded: an interpolated per-instance value is not bit-exact, and the hash would amplify the error.
      float h = apxHash(cell + vec2(floor(vApxA.x + 0.5) * 1.37, floor(sd.x) * 5.1));
      float lit = step(h, mix(0.45, 0.8, shop));
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.045, 0.05, 0.06), win * 0.85);
      vec3 warm = mix(vec3(1.0, 0.7, 0.4), vec3(0.72, 0.84, 1.0), step(0.8, fract(h * 7.3)));
      apxWinE = warm * (win * lit * uApxP.x * (0.5 + 0.9 * fract(h * 3.7)));
      apxRough = mix(1.0, 0.25, win);
    } else {
      diffuseColor.rgb *= 0.55;
    }
  } else if (uApxMode == 12) {
    // Foliage = green vertex colours (bark is brown). Leaf clumps in world space, so every instance differs.
    float isLeaf = step(apxVC.r * 1.15, apxVC.g);
    float lCam = length(vApxWP - cameraPosition);
    float lNear = 1.0 - smoothstep(110.0, 320.0, lCam);
    vec3 lp = vApxWP;
    float c1 = apxNoise(lp.xz * 0.5 + lp.y * 0.42);
    float c2 = apxNoise(vec2(lp.x + lp.z, lp.y * 1.3 - lp.x * 0.4) * 1.5 + 11.0);
    float c3 = apxNoise(vec2(lp.x - lp.z * 0.7, lp.y + lp.z) * 5.0 + 3.0) * (1.0 - smoothstep(40.0, 110.0, lCam)) + 0.5 * smoothstep(40.0, 110.0, lCam);
    float clump = c1 * 0.5 + c2 * 0.33 + c3 * 0.17;
    float gaps = smoothstep(0.34, 0.5, clump);
    vec3 leaf = diffuseColor.rgb * (0.45 + 1.2 * clump) * mix(0.45, 1.0, gaps);
    // Sunlit young leaves are yellower; deep clumps cooler and darker.
    leaf *= mix(vec3(0.82, 0.95, 1.12), vec3(1.45, 1.22, 0.62), smoothstep(0.45, 0.8, c2 * 0.6 + c3 * 0.4));
    apxLeaf = isLeaf * lNear;
    diffuseColor.rgb = mix(diffuseColor.rgb, leaf, apxLeaf);
    // Far crowns keep the macro variation only (no shimmer).
    diffuseColor.rgb *= mix(1.0, 0.78 + 0.44 * c1, isLeaf * (1.0 - lNear));
    apxSpec = mix(1.0, 0.45, isLeaf);
  } else if (uApxMode == 8) {
    diffuseColor.rgb = vec3(0.0);
  } else if (uApxMode == 11) {
    float t = uApxTime;
    vec2 q = sd * 0.055 + vec2(-t * 0.045, 0.0);
    float n1 = apxFbm(q);
    float n2 = apxNoise(q * 4.0 + vec2(t * 0.03, 3.1));
    float seam = 1.0 - smoothstep(0.0, 0.035, abs(n1 - 0.5));
    seam = max(seam, (1.0 - smoothstep(0.0, 0.025, abs(apxFbm(q * 2.3 + 7.0) - 0.5))) * 0.7);
    float hot = smoothstep(0.66, 0.84, apxFbm(q * 0.6 + vec2(-t * 0.02, t * 0.013)));
    float glow = clamp(seam * 0.85 + hot, 0.0, 1.0) * (0.7 + 0.3 * n2);
    float pulse = 0.85 + 0.15 * sin(t * 1.3 + n1 * 9.0);
    diffuseColor.rgb = mix(vec3(0.02, 0.016, 0.014) * (0.6 + 0.8 * n2), vec3(0.2, 0.04, 0.0), glow);
    vec3 hotC = mix(vec3(1.0, 0.1, 0.005), vec3(1.0, 0.55, 0.12), glow * glow);
    // Under the crust the lava still smoulders: a dim red base, brighter toward the hot pools.
    float under = 0.08 + 0.25 * smoothstep(0.45, 0.66, apxFbm(q * 0.6 + vec2(-t * 0.02, t * 0.013)));
    apxWinE = (hotC * glow * pulse * 2.2 + vec3(0.9, 0.08, 0.0) * under * (0.6 + 0.4 * n2)) * uApxP.x;
    apxRough = mix(0.95, 0.45, glow);
  }
}
`;

// Replaces <color_fragment>.
const F_COLOR = /* glsl */ `
if (uApxVC > 0.5) diffuseColor.rgb *= apxVC;
#ifdef USE_MAP
// Ç5 alpha-to-coverage emulation for alpha-tested meshes (uApxP.w > 0 = strength, e.g. catch fences): the post chain
// renders without MSAA, so hardware A2C has nothing to resolve. Once the map is minified (mip > 1) the mip-averaged
// alpha (= coverage) is dithered per pixel instead of thresholded, so distant wire mesh keeps its average density
// (reads as a light veil) rather than vanishing to the posts or turning into a solid wall.
if (uApxP.w > 0.0) {
  vec2 apxTs = vec2(textureSize(map, 0));
  vec2 apxDx = dFdx(vMapUv * apxTs), apxDy = dFdy(vMapUv * apxTs);
  float apxMip = max(0.0, 0.5 * log2(max(dot(apxDx, apxDx), dot(apxDy, apxDy))));
  float apxK = smoothstep(0.35, 1.6, apxMip) * uApxP.w;
  float apxIgn = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  diffuseColor.a = mix(diffuseColor.a, step(apxIgn, diffuseColor.a * 1.2), apxK);
}
#endif
`;

// After <roughnessmap_fragment>: per-mode roughness, then the wet model (report §7.13).
const F_ROUGH = /* glsl */ `
roughnessFactor = clamp(roughnessFactor * apxRough, apxMinRough, 1.0);
float apxW = 0.0;
float apxPuddle = 0.0;
if (uApxWet > 0.002 && apxWetK > 0.0) {
  apxW = uApxWet;
  // The racing line dries first.
  if (uApxMode == 1) apxW = mix(apxW, min(uApxWet, uApxLineWet), apxLine);
  apxW *= apxWetK;
  // Covered surfaces (roofs overhead) stay dry: upward-facing only for the wet sheen.
  float up = clamp(vApxUp * 1.2, 0.35, 1.0);
  // Porous albedo darkening (front-loaded: a little water already darkens asphalt, so a drying line reads at W 0.4).
  float apxDamp = smoothstep(0.0, 0.6, apxW);
  diffuseColor.rgb *= mix(1.0, 0.55, apxDamp * (1.0 - 0.45 * apxGloss));
  // A drying line reads lighter than the wet asphalt around it (its rubber darkening would otherwise hide it).
  if (uApxMode == 1) diffuseColor.rgb *= 1.0 + 1.0 * apxLine * max(0.0, smoothstep(0.0, 0.6, uApxWet * apxWetK) - apxDamp);
  // Wet sheen; a saturated surface (W > 0.7) carries a water film and gets glossier still.
  float wetR = mix(mix(0.35, 0.2, smoothstep(0.7, 1.0, apxW)), 0.16, apxGloss) * (uApxMode == 4 ? 1.6 : 1.0);
  roughnessFactor = mix(roughnessFactor, min(roughnessFactor, wetR), clamp(apxW * 2.5, 0.0, 1.0) * up);
  // Puddles: low spots (propensity from the track build: camber edge, sags, flat grade) ± smooth noise in s/d; the
  // water level rises from W 0.4 (most prone spots only) to W 1. A damp rim surrounds each puddle.
  if (uApxMode == 1) {
    vec2 sd = vApxSD;
    float n = apxFbm(sd * vec2(0.07, 0.3)) * 0.85 + apxNoise(sd * vec2(0.4, 1.3)) * 0.15;
    float level = apxPud + (n - 0.45) * 1.1;
    float th = mix(1.0, 0.5, smoothstep(0.4, 1.0, apxW));
    apxPuddle = smoothstep(th, th + 0.05, level);
    float rim = smoothstep(th - 0.1, th, level);
    diffuseColor.rgb *= mix(1.0, 0.85, rim) * mix(1.0, 0.85, apxPuddle);
    roughnessFactor = mix(roughnessFactor, min(roughnessFactor, 0.2), rim);
    roughnessFactor = mix(roughnessFactor, 0.07, apxPuddle);
  }
}
`;

// After <normal_fragment_maps>: puddles flatten the normal; rain adds ripple rings on flat wet ground. Water (mode 9):
// three swell trains plus two scrolling noise layers (gradient of the height field), faded with distance.
const F_NORMAL = /* glsl */ `
if (uApxMode == 9) {
  vec2 wp = vApxWP.xz;
  float wt = uApxTime;
  float amp = 0.15 + 0.85 * (1.0 - smoothstep(120.0, 1600.0, length(vApxWP - cameraPosition)));
  vec2 g = vec2(0.8, 0.6) * cos(dot(wp, vec2(0.8, 0.6)) * 0.31 - wt * 0.9) * 0.05;
  g += vec2(-0.5, 0.86) * cos(dot(wp, vec2(-0.5, 0.86)) * 0.53 - wt * 1.3) * 0.035;
  g += vec2(0.2, -0.98) * cos(dot(wp, vec2(0.2, -0.98)) * 1.1 - wt * 1.9) * 0.025;
  vec2 q1 = wp * 0.35 + vec2(wt * 0.05, wt * 0.03);
  vec2 q2 = wp * 0.9 - vec2(wt * 0.04, -wt * 0.06);
  g += vec2(apxNoise(q1 + vec2(0.15, 0.0)) - apxNoise(q1 - vec2(0.15, 0.0)), apxNoise(q1 + vec2(0.0, 0.15)) - apxNoise(q1 - vec2(0.0, 0.15))) * 0.15;
  g += vec2(apxNoise(q2 + vec2(0.15, 0.0)) - apxNoise(q2 - vec2(0.15, 0.0)), apxNoise(q2 + vec2(0.0, 0.15)) - apxNoise(q2 - vec2(0.0, 0.15))) * 0.09;
  g *= amp * (1.0 + 0.8 * uApxRain);
  normal = normalize(normal + (viewMatrix * vec4(-g.x, 0.0, -g.y, 0.0)).xyz);
}
if (uApxMode == 12 && apxLeaf > 0.0) {
  // Leaf masses are not smooth balls: roughen the shading normal with a clump-scale jitter.
  vec3 lq = vApxWP * 1.0;
  vec3 lj = vec3(apxNoise(lq.yz + 1.7), apxNoise(lq.zx + 5.3), apxNoise(lq.xy + 9.1)) - 0.5;
  lj += 0.5 * (vec3(apxNoise(lq.yz * 3.1 + 2.0), apxNoise(lq.zx * 3.1 + 4.0), apxNoise(lq.xy * 3.1 + 6.0)) - 0.5);
  normal = normalize(normal + (viewMatrix * vec4(lj, 0.0)).xyz * 1.9 * apxLeaf);
}
if (apxW > 0.0) {
  float flat0 = max(apxPuddle, 0.6 * apxW * step(0.5, float(uApxMode == 1 || uApxMode == 2)));
  normal = normalize(mix(normal, nonPerturbedNormal, flat0));
  if (uApxRain > 0.01 && (uApxMode == 1 || uApxMode == 2)) {
    // Fade with distance and with the pixel footprint (rings thinner than ~2 px would only sparkle).
    vec2 apxFw = fwidth(vApxWP.xz);
    float fadeR = (1.0 - smoothstep(25.0, 60.0, length(vApxWP - cameraPosition))) * (1.0 - smoothstep(0.012, 0.03, max(apxFw.x, apxFw.y)));
    if (fadeR > 0.0) {
      vec2 g = apxRipples(vApxWP.xz, uApxTime) * uApxRain * fadeR * (0.35 + 0.65 * apxPuddle) * 0.35;
      normal = normalize(normal + (viewMatrix * vec4(g.x, 0.0, g.y, 0.0)).xyz);
    }
  }
}
`;

// Replaces <emissivemap_fragment>.
const F_EMISSIVE = /* glsl */ `
#include <emissivemap_fragment>
if (uApxMode == 5 || uApxMode == 8) totalEmissiveRadiance *= apxVC;
if (uApxMode == 10 || uApxMode == 11) totalEmissiveRadiance += apxWinE;
`;

// After <lights_fragment_begin>: at night the key light (cars' floodlight key) only reaches the env inside the light
// pools, so the world is not lit evenly by a moon-strength sun.
const F_KEY = /* glsl */ `
if (uApxKeyMask > 0.0) {
  float apxKey = mix(1.0, clamp(apxPool * 0.45, 0.0, 1.0), uApxKeyMask * uApxP.z);
  reflectedLight.directDiffuse *= apxKey;
  reflectedLight.directSpecular *= apxKey;
}
`;

// After <lights_fragment_maps>: the baked floodlight lightmap as one extra direct light (diffuse + GGX specular).
// Texel: r = sqrt(E / 1.6) (normal irradiance relative to a pool centre), gb = mean direction to the lamps (xz).
const F_FLOOD = /* glsl */ `
if (uApxFloodK > 0.0 && uApxP.z > 0.0) {
  float apxE = apxPool * uApxFloodK * uApxP.z;
  vec2 apxDxz = apxFl.gb * 2.0 - 1.0;
  vec3 apxL = normalize(vec3(apxDxz.x, sqrt(max(0.04, 1.0 - dot(apxDxz, apxDxz))), apxDxz.y));
  IncidentLight apxLight;
  apxLight.direction = normalize((viewMatrix * vec4(apxL, 0.0)).xyz);
  apxLight.color = uApxFloodCol * apxE;
  apxLight.visible = true;
  // The pools come from large lamp heads: widen the specular lobe (area-light roughness) so wet / puddle surfaces show
  // soft glowing streaks, not hard white spots.
  float apxR0 = material.roughness;
  material.roughness = max(material.roughness, 0.28);
  RE_Direct(apxLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight);
  material.roughness = apxR0;
}
#if defined( RE_IndirectSpecular )
// Wet surfaces keep their full reflection (water film over the rubber).
radiance *= mix(apxSpec, 1.0, clamp(apxW * 2.0, 0.0, 1.0));
#endif
`;

function patch(src: string, marker: string, replacement: string): string {
  if (!src.includes(marker)) throw new Error(`[track] env shader: missing chunk ${marker}`);
  return src.replace(marker, replacement);
}

/** The single env chunk injector (identical source for every env program). */
function injectEnvChunk(sh: WebGLProgramParametersWithUniforms): void {
  let v = sh.vertexShader;
  v = patch(v, '#include <common>', `#include <common>\n${V_COMMON}`);
  v = patch(v, '#include <begin_vertex>', `#include <begin_vertex>\n${V_BEGIN}`);
  v = patch(v, '#include <fog_vertex>', `#include <fog_vertex>\n${V_END}`);
  sh.vertexShader = v;
  let f = sh.fragmentShader;
  f = patch(f, '#include <common>', `#include <common>\n${F_COMMON}`);
  f = patch(f, '#include <map_fragment>', F_MAP);
  f = patch(f, '#include <color_fragment>', F_COLOR);
  f = patch(f, '#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${F_ROUGH}`);
  f = patch(f, '#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${F_NORMAL}`);
  f = patch(f, '#include <emissivemap_fragment>', F_EMISSIVE);
  f = patch(f, '#include <lights_fragment_begin>', `#include <lights_fragment_begin>\n${F_KEY}`);
  f = patch(f, '#include <lights_fragment_maps>', `#include <lights_fragment_maps>\n${F_FLOOD}`);
  sh.fragmentShader = f;
}

// ---------------------------------------------------------------------------------------------------------------
// Shared state

export interface EnvGlobals {
  uApxTime: IUniform<number>;
  uApxRain: IUniform<number>;
  uApxWet: IUniform<number>;
  uApxLineWet: IUniform<number>;
  uApxFlood: IUniform<Texture>;
  uApxFloodBox: IUniform<Vector4>;
  uApxFloodCol: IUniform<Color>;
  uApxFloodK: IUniform<number>;
  uApxKeyMask: IUniform<number>;
}

export interface EnvShared {
  globals: EnvGlobals;
  white: Texture;
  flatNormal: Texture;
  black: Texture;
  /** Materials created through `envMaterial` (for census / dispose bookkeeping by their owners). */
  count(): number;
  setTime(t: number): void;
  setWeather(rain: number, wetness: number, lineWetness: number): void;
  /** Floodlight lightmap (null = none) and its world box [x0, z0, width, depth]. */
  setFloodMap(tex: Texture | null, box: [number, number, number, number]): void;
  /** Floodlight irradiance at lightmap value 1 (0 = off), its colour, and how much the key light is confined to the
   * light pools on env surfaces (1 at night, 0 by day / sunset). */
  setFlood(intensity: number, color: number, keyMask: number): void;
  dispose(): void;
}

function pixel(r: number, g: number, b: number, a: number, srgb: boolean): DataTexture {
  const t = new DataTexture(new Uint8Array([r, g, b, a]), 1, 1, RGBAFormat, UnsignedByteType);
  t.colorSpace = srgb ? SRGBColorSpace : NoColorSpace;
  t.wrapS = t.wrapT = RepeatWrapping;
  t.magFilter = t.minFilter = LinearFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

export function createEnvShared(): EnvShared {
  const white = pixel(255, 255, 255, 255, true);
  const flatNormal = pixel(128, 128, 255, 255, false);
  const black = pixel(0, 128, 128, 255, false);
  let n = 0;
  const globals: EnvGlobals = {
    uApxTime: { value: 0 }, uApxRain: { value: 0 }, uApxWet: { value: 0 }, uApxLineWet: { value: 0 },
    uApxFlood: { value: black }, uApxFloodBox: { value: new Vector4(0, 0, 1, 1) }, uApxFloodCol: { value: new Color(1, 1, 1) },
    uApxFloodK: { value: 0 }, uApxKeyMask: { value: 0 },
  };
  const shared: EnvShared & { _inc(): void } = {
    globals, white, flatNormal, black,
    count: () => n,
    _inc() {
      n++;
    },
    setTime(t) {
      globals.uApxTime.value = t;
    },
    setWeather(rain, wetness, lineWetness) {
      globals.uApxRain.value = Math.min(1, Math.max(0, rain));
      globals.uApxWet.value = Math.min(1, Math.max(0, wetness));
      globals.uApxLineWet.value = Math.min(1, Math.max(0, lineWetness));
    },
    setFloodMap(tex, box) {
      globals.uApxFlood.value = tex ?? black;
      globals.uApxFloodBox.value.set(box[0], box[1], 1 / box[2], 1 / box[3]);
    },
    setFlood(intensity, color, keyMask) {
      const has = globals.uApxFlood.value !== black;
      globals.uApxFloodK.value = has ? intensity : 0;
      globals.uApxFloodCol.value.setHex(color);
      globals.uApxKeyMask.value = has ? keyMask : 0;
    },
    dispose() {
      white.dispose();
      flatNormal.dispose();
      black.dispose();
    },
  };
  return shared;
}

export interface EnvMaterialOptions {
  name: string;
  family: EnvFamily;
  mode?: EnvModeId;
  color?: number | Color;
  roughness?: number;
  metalness?: number;
  map?: Texture | null;
  normalMap?: Texture | null;
  roughnessMap?: Texture | null;
  normalScale?: number;
  emissive?: number | Color;
  emissiveIntensity?: number;
  envMapIntensity?: number;
  alphaTest?: number;
  /** Multiply albedo by the vertex / instance colour (geometry must provide `color` unless instanced). */
  vertexColor?: boolean;
  texA?: Texture | null;
  texB?: Texture | null;
  /** Wet receptivity 0..1 (0 = stays dry: covered, interior, glass). Default 0.8. */
  wet?: number;
  /** Floodlight receptivity 0..1. Default 1. */
  flood?: number;
  /** Mode parameter (Billboard: hand-over distance). */
  param?: number;
  /** Alpha coverage preservation per mip level for alpha-tested meshes (A2C emulation strength 0..1; 0 = off). */
  coverage?: number;
  polygonOffset?: number;
}

/**
 * Creates an env MeshStandardMaterial that shares its WebGLProgram with every other material of the same family.
 * Absent maps are replaced by 1×1 neutral textures so the feature flags (USE_MAP / USE_NORMALMAP / USE_ROUGHNESSMAP)
 * agree across the family.
 */
export function envMaterial(sh: EnvShared, o: EnvMaterialOptions): MeshStandardMaterial {
  const cutout = o.family === 'cutout' || o.family === 'instCutout';
  const m = new MeshStandardMaterial({
    color: o.color ?? 0xffffff,
    roughness: o.roughness ?? 0.85,
    metalness: o.metalness ?? 0,
    map: o.map ?? sh.white,
    normalMap: o.normalMap ?? sh.flatNormal,
    roughnessMap: o.roughnessMap ?? sh.white,
    normalScale: new Vector2(o.normalScale ?? 1, o.normalScale ?? 1),
    emissive: o.emissive ?? 0x000000,
    emissiveIntensity: o.emissiveIntensity ?? 1,
    envMapIntensity: o.envMapIntensity ?? 1,
    // instCutout geometries carry no colour attribute: the instance colour alone feeds vColor.
    vertexColors: o.family !== 'instCutout',
    side: cutout ? DoubleSide : FrontSide,
    alphaTest: cutout ? (o.alphaTest ?? 0.5) : 0,
  });
  m.name = o.name;
  if (o.polygonOffset) {
    m.polygonOffset = true;
    m.polygonOffsetFactor = o.polygonOffset;
    m.polygonOffsetUnits = o.polygonOffset;
  }
  const own = {
    uApxMode: { value: o.mode ?? EnvMode.Plain },
    uApxVC: { value: o.vertexColor ? 1 : 0 },
    uApxP: { value: new Vector4(o.param ?? 0, o.wet ?? 0.8, o.flood ?? 1, o.coverage ?? 0) },
    uApxTexA: { value: o.texA ?? sh.white },
    uApxTexB: { value: o.texB ?? sh.white },
  };
  m.userData.apx = own;
  const g = sh.globals;
  m.onBeforeCompile = (p) => {
    Object.assign(p.uniforms, own, g);
    injectEnvChunk(p);
  };
  m.customProgramCacheKey = () => ENV_PROGRAM_KEY;
  (sh as EnvShared & { _inc(): void })._inc();
  return m;
}

/** Per-material env uniforms (mode, flags, parameters) for live tweaks. */
export function envUniforms(m: MeshStandardMaterial): { uApxMode: IUniform<number>; uApxVC: IUniform<number>; uApxP: IUniform<Vector4> } {
  return m.userData.apx as { uApxMode: IUniform<number>; uApxVC: IUniform<number>; uApxP: IUniform<Vector4> };
}
