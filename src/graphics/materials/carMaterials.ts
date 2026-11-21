// Car materials (docs/design/rendering.md §6, DESIGN.md §1.4.4). Shared instances: carbon, trim, visor, emissive,
// LOD1 trim, LOD2 body, wheels, blob — one each for every car. Paint: one instance per car, because each car
// carries its own livery atlas (numbers and T-cam colour differ per driver, rendering.md §7.4).

import {
  Color, DoubleSide, type Material, MeshBasicMaterial, MeshPhysicalMaterial, MeshStandardMaterial, ShaderMaterial, type Texture, Vector2,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import type { QualityPreset } from '../../contracts/render';
import type { TeamDef } from '../../contracts/data';
import { PRESET_DERIVED } from '../presets';
import { createWheelMaterials } from '../car/wheelAppearance';
import { blobTexture, carbonTextures, flakeNormal, releaseTextures, retainTextures, trimTextures } from './textures';

export const COMPOUND_COLORS = { soft: 0xe8202a, medium: 0xf2c200, hard: 0xedeff2, inter: 0x2db55a, wet: 0x2f6fe8 } as const;

export interface CarMaterialLib {
  paint(team: TeamDef, atlas: Texture): MeshPhysicalMaterial;
  readonly carbon: MeshPhysicalMaterial;
  readonly trim: MeshStandardMaterial;
  readonly visor: MeshPhysicalMaterial;
  /** Rain light; per-object intensity via `setEmissive(mesh-callback)` (uniformsNeedUpdate). */
  readonly emissive: ShaderMaterial;
  readonly lodTrim: MeshStandardMaterial;
  readonly lod2: MeshStandardMaterial;
  readonly tyre: MeshStandardMaterial;
  readonly rim: MeshStandardMaterial;
  readonly hub: MeshStandardMaterial;
  readonly blob: MeshBasicMaterial;
  /** G4: dithered ghost (livery atlas + fresnel rim); geometry needs `aPaint` (1 = livery). */
  ghost(team: TeamDef, atlas: Texture): ShaderMaterial;
  /** G7: track wetness 0..1 → wet paint/carbon (shared uniform), tyre and LOD2 roughness. No recompiles. */
  setWetness(w: number): void;
  /** G7: adds the wet-car chunks to a paint shader (callers that own the paint's onBeforeCompile). */
  wetShader(s: WebGLProgramParametersWithUniforms): void;
  setQuality(q: QualityPreset): void;
  /** Every material created so far (warm-up, leak checks). */
  all(): Material[];
  dispose(): void;
}

function patch(m: Material, key: string, fn: (s: WebGLProgramParametersWithUniforms) => void): void {
  m.onBeforeCompile = fn;
  m.customProgramCacheKey = () => key;
}

/**
 * G7 wet car (rendering.md §6): roughness × (1 − 0.3·uWet) and procedural rain beads (≈ 3 cm cells, model x/z) on
 * up-facing surfaces, bending both the base and the clearcoat normal. Always compiled in; uWet = 0 when dry.
 */
function wetShader(s: WebGLProgramParametersWithUniforms, wet: { value: number }): void {
  s.uniforms['uWet'] = wet;
  s.vertexShader = s.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec2 vWetP;\nvarying float vWetUp;\nvarying vec3 vWetX;\nvarying vec3 vWetZ;')
    .replace('#include <begin_vertex>', [
      '#include <begin_vertex>',
      'vWetP = position.xz;',
      'vWetUp = objectNormal.y;',
      'vWetX = ( modelViewMatrix * vec4( 1.0, 0.0, 0.0, 0.0 ) ).xyz;',
      'vWetZ = ( modelViewMatrix * vec4( 0.0, 0.0, 1.0, 0.0 ) ).xyz;',
    ].join('\n'));
  s.fragmentShader = s.fragmentShader
    .replace('#include <common>', [
      '#include <common>',
      'uniform float uWet;',
      'varying vec2 vWetP;\nvarying float vWetUp;\nvarying vec3 vWetX;\nvarying vec3 vWetZ;',
      'vec3 wetBead() {',
      '  vec2 p = vWetP * 33.0;',
      '  vec2 c = floor( p );',
      '  float h = fract( sin( dot( c, vec2( 127.1, 311.7 ) ) ) * 43758.5453 );',
      '  vec2 d = fract( p ) - 0.5 - ( vec2( fract( h * 13.7 ), fract( h * 71.3 ) ) - 0.5 ) * 0.35;',
      '  float r = 0.16 + 0.14 * fract( h * 7.31 );',
      '  float m = step( h, 0.6 * uWet ) * ( 1.0 - smoothstep( 0.8 * r, r, length( d ) ) );',
      '  float up = smoothstep( 0.5, 0.75, vWetUp );',
      '  float aa = 1.0 - smoothstep( 0.25, 0.5, fwidth( p.x ) + fwidth( p.y ) );', // no shimmer once a cell is < ~3 px
      '  vec2 t = d / r * ( m * up * aa * 0.9 );',
      '  return vWetX * t.x + vWetZ * t.y;',
      '}',
    ].join('\n'))
    .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor *= 1.0 - 0.3 * uWet;')
    .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nvec3 wetB = wetBead();\nnormal = normalize( normal + wetB );')
    .replace('#include <clearcoat_normal_fragment_maps>', '#include <clearcoat_normal_fragment_maps>\n#ifdef USE_CLEARCOAT\nclearcoatNormal = normalize( clearcoatNormal + wetB );\n#endif');
}

export function createCarMaterials(q0: QualityPreset, fontFamily: string): CarMaterialLib {
  retainTextures();
  let q = q0;
  const created: Material[] = [];
  const keep = <T extends Material>(m: T): T => {
    created.push(m);
    return m;
  };
  const carbonTex = carbonTextures();
  const trimTex = trimTextures();

  const wet = { value: 0 };
  const carbon = keep(new MeshPhysicalMaterial({
    name: 'car.carbon', color: 0xffffff, map: carbonTex.albedo, normalMap: carbonTex.normal, normalScale: new Vector2(0.35, 0.35),
    roughness: 0.32, metalness: 0, clearcoat: 0.85, clearcoatRoughness: 0.06, envMapIntensity: 0.9,
  }));
  patch(carbon, 'car.carbon.wet', (s) => wetShader(s, wet));
  const trim = keep(new MeshStandardMaterial({
    name: 'car.trim', color: 0xffffff, map: trimTex.map, roughnessMap: trimTex.orm, metalnessMap: trimTex.orm, roughness: 1, metalness: 1, envMapIntensity: 1,
  }));
  const visor = keep(new MeshPhysicalMaterial({
    name: 'car.visor', color: 0x0b0e12, metalness: 0.3, roughness: 0.08, iridescence: 0, iridescenceIOR: 1.6, envMapIntensity: 1.2,
  }));
  const emissive = keep(new ShaderMaterial({
    name: 'car.emissive',
    uniforms: { uIntensity: { value: 0.05 } },
    vertexShader: /* glsl */ `
      attribute vec3 color;
      varying vec3 vColor;
      #include <common>
      void main() { vColor = color; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform float uIntensity;
      varying vec3 vColor;
      void main() { gl_FragColor = vec4(vColor * uIntensity, 1.0); }`,
  }));
  const lodTrim = keep(new MeshStandardMaterial({ name: 'car.lodTrim', vertexColors: true, roughness: 0.55, metalness: 0.15, envMapIntensity: 0.8 }));

  // LOD2: one instanced body for every far car; zone weights per vertex, team colours per instance.
  const lod2 = keep(new MeshStandardMaterial({ name: 'car.lod2', color: 0xffffff, roughness: 0.4, metalness: 0.05, envMapIntensity: 0.9 }));
  patch(lod2, 'car.lod2', (s) => {
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aZone;\nattribute vec3 aPrim;\nattribute vec3 aSec;\nvarying vec3 vBody;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBody = mix(mix(vec3(0.012), aPrim, aZone.x), aSec, aZone.y);');
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vBody;')
      .replace('#include <map_fragment>', 'diffuseColor.rgb *= vBody;');
  });

  // Wheels (tyre, rim, brake/upright): src/graphics/car/wheelAppearance.ts.
  const { tyre, rim, hub } = createWheelMaterials(fontFamily);
  keep(tyre);
  keep(rim);
  keep(hub);
  const blob = keep(new MeshBasicMaterial({
    name: 'car.blob', color: 0x000000, alphaMap: blobTexture(), transparent: true, opacity: 0.5, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  }));

  const paints = new Set<MeshPhysicalMaterial>();
  const applyPaintQuality = (m: MeshPhysicalMaterial): void => {
    const metallic = m.userData['finish'] === 'metallic';
    const flake = metallic && PRESET_DERIVED[q.id].flakeNormal;
    const want = flake ? flakeNormal() : null;
    if (m.normalMap !== want) {
      m.normalMap = want;
      m.needsUpdate = true;
    }
    if (m.map) m.map.anisotropy = q.anisotropy;
  };

  const lib: CarMaterialLib = {
    paint(team, atlas) {
      const finish = team.finish;
      const m = new MeshPhysicalMaterial({ name: `car.paint.${team.id}`, map: atlas, color: 0xffffff });
      m.userData['finish'] = finish;
      if (finish === 'matte') {
        Object.assign(m, { roughness: 0.62, metalness: 0, clearcoat: 0, sheen: 0.15, envMapIntensity: 0.6 });
        m.sheenColor = new Color(0xffffff);
        m.sheenRoughness = 0.6;
      } else if (finish === 'metallic') {
        Object.assign(m, { roughness: 0.3, metalness: 0.65, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 1.1 });
        m.color.setScalar(0.9); // base colour 10 % darker than the swatch
        m.normalScale = new Vector2(0.15, 0.15);
        if (m.map) m.map.repeat.set(1, 1);
      } else {
        Object.assign(m, { roughness: 0.35, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 1.0 });
      }
      applyPaintQuality(m);
      paints.add(m);
      created.push(m);
      return m;
    },
    carbon, trim, visor, emissive, lodTrim, lod2, tyre, rim, hub, blob,
    ghost(team, atlas) {
      // G4: screen-door (ordered 4×4 Bayer) alpha at `uAlpha` = ghostAlpha, so the ghost is opaque-sorted, needs no
      // blending and never fights the transparent pass; livery from the atlas plus a team-primary fresnel rim.
      const m = new ShaderMaterial({
        name: `car.ghost.${team.id}`,
        uniforms: { uColor: { value: new Color(team.colors.primary) }, uAlpha: { value: 0.45 }, uAtlas: { value: atlas } },
        vertexShader: /* glsl */ `
          attribute float aPaint;
          varying vec3 vN; varying vec3 vV; varying vec2 vUv; varying float vPaint;
          void main() {
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
            vUv = uv; vPaint = aPaint;
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uColor; uniform float uAlpha; uniform sampler2D uAtlas;
          varying vec3 vN; varying vec3 vV; varying vec2 vUv; varying float vPaint;
          float bayer4(vec2 p) {
            ivec2 q = ivec2(mod(p, 4.0));
            int i = q.x + q.y * 4;
            int b[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
            return (float(b[i]) + 0.5) / 16.0;
          }
          void main() {
            float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.0);
            float a = uAlpha * (0.6 + 0.4 * f);
            if (a <= bayer4(gl_FragCoord.xy)) discard;
            vec3 base = vPaint > 0.5 ? texture2D(uAtlas, vUv).rgb : vec3(0.035, 0.038, 0.042);
            gl_FragColor = vec4(base * 0.9 + uColor * (0.12 + 1.4 * f), 1.0);
          }`,
        side: DoubleSide,
      });
      created.push(m);
      return m;
    },
    setWetness(w) {
      // Spec threshold "wetness > 0.2", ramped over 0.15–0.35 so a drying track does not pop.
      const t = Math.min(1, Math.max(0, (w - 0.15) / 0.2));
      const k = t * t * (3 - 2 * t);
      wet.value = k;
      tyre.roughness = 0.85 - 0.4 * k;
      lod2.roughness = 0.4 * (1 - 0.3 * k);
    },
    wetShader: (s) => wetShader(s, wet),
    setQuality(nq) {
      q = nq;
      const irid = PRESET_DERIVED[q.id].iridescence ? 0.6 : 0;
      if ((visor.iridescence > 0) !== (irid > 0)) visor.needsUpdate = true;
      visor.iridescence = irid;
      for (const m of paints) applyPaintQuality(m);
      for (const t of [carbon.map!, carbon.normalMap!, tyre.map!]) {
        if (t.anisotropy === q.anisotropy) continue;
        t.anisotropy = q.anisotropy;
        t.needsUpdate = true;
      }
    },
    all: () => created.slice(),
    dispose() {
      for (const m of created) m.dispose();
      created.length = 0;
      paints.clear();
      releaseTextures();
    },
  };
  lib.setQuality(q0);
  return lib;
}
