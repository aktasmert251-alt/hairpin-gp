// Wheel materials and textures (rendering.md §6, DESIGN.md §1.4.4): tyre (ORBIS sidewall atlas + compound band, slick
// sheen, analytic inter/wet tread, motion-smeared sidewall at speed), rim (shaded per `aPart`: closed aero cover in the
// team tint with two radial seams that smear into soft circular streaks at speed, faint brake-glow ring at the cover
// edge), hub (drum, caliper, upright; LOD2 disc glow). Geometry and layout: wheels.ts.
// Instance attributes (carVisuals.ts): tyre aCompound (rgb), aTread (kind 0 slick | 1 inter | 2 wet, rotation blur
// 0..1, u direction ±1); rim aTint (team secondary), aBlur (rotation blur 0..1, brake glow 0..1); hub aGlow.

import { DataTexture, LinearFilter, LinearMipmapLinearFilter, MeshStandardMaterial, RGBAFormat, SRGBColorSpace, UnsignedByteType, type Material, type WebGLProgramParametersWithUniforms } from 'three';
import { COVER_HOLE_R, COVER_R, FRONT_W, RIM_PART, SHOULDER_R, TYRE_R } from './wheels';

/** Sidewall marking per atlas row; row index = tread kind (aTread.x: 0 slick, 1 intermediate, 2 wet). */
export const TYRE_SIDEWALL_LABELS: readonly string[] = ['SLICK · 18', 'INTER · 18', 'WET · 18'];

const f = (n: number): string => n.toFixed(5);

function dataTex(d: Uint8Array, w: number, h: number, mip: boolean): DataTexture {
  const t = new DataTexture(d, w, h, RGBAFormat, UnsignedByteType);
  t.colorSpace = SRGBColorSpace;
  t.generateMipmaps = mip;
  t.minFilter = mip ? LinearMipmapLinearFilter : LinearFilter;
  t.magFilter = LinearFilter;
  t.needsUpdate = true;
  return t;
}

interface SidewallTextures { crisp: DataTexture; smeared: DataTexture }

/**
 * Sidewall atlas 2048 × (256 × rows), one row per tread kind, row 0 at the bottom. Inside a row u = around the tyre,
 * v = bead → shoulder over 0..0.45, tread at 0.5. RGB = rubber with white ORBIS lettering and markings; A = compound
 * band mask (tinted per instance). `smeared` is the same atlas averaged around the circumference (4 px wide): what the
 * sidewall looks like once the wheel spins faster than the eye can follow.
 */
function makeSidewall(fontFamily: string): SidewallTextures {
  const w = 2048, h = 256, rows = TYRE_SIDEWALL_LABELS.length;
  const vy = (v: number): number => (1 - v) * h;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  const font = (px: number): string => `700 ${Math.round(px)}px "${fontFamily}", "Arial Narrow", sans-serif`;
  const d = new Uint8Array(w * h * rows * 4);
  const sm = new Uint8Array(4 * h * rows * 4);
  const rubber = 26; // ≈ #18181A rubber (sRGB); the material colour stays white
  TYRE_SIDEWALL_LABELS.forEach((label, row) => {
    // R = lettering, G = compound band mask, B = subtle moulded rings (darker rubber).
    g.fillStyle = '#000';
    g.fillRect(0, 0, w, h);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    // Moulded detail: rim-protector edge and a fine ring under the band.
    g.fillStyle = '#0000ff';
    g.fillRect(0, vy(0.075), w, h * 0.006);
    g.fillRect(0, vy(0.415), w, h * 0.005);
    // Compound band ring near the shoulder plus arcs under the logo.
    g.fillStyle = '#00ff00';
    g.fillRect(0, vy(0.395), w, h * 0.04);
    for (const u of [0.25, 0.75]) g.fillRect((u - 0.075) * w, vy(0.15), 0.15 * w, h * 0.028);
    g.fillStyle = '#ff0000';
    for (const u of [0.25, 0.75]) {
      g.save();
      g.translate(u * w, vy(0.27));
      g.scale(1.7, 1);
      g.font = font(h * 0.2);
      g.fillText('ORBIS', 0, 0);
      g.restore();
      g.font = font(h * 0.07);
      g.fillText(label, u * w + w * 0.155, vy(0.27));
      // Small moulded markings between the logos.
      // Small moulded markings between the logos (drawn twice across the u seam).
      g.font = font(h * 0.055);
      for (const x of [(u + 0.25) * w, (u - 0.75) * w]) {
        g.fillText('ORBIS RACING  ·  305/670 R18', x, vy(0.24));
        g.fillText('▶ ROTATION', x, vy(0.13));
      }
    }
    const px = g.getImageData(0, 0, w, h).data;
    for (let y = 0; y < h; y++) {
      const v = 1 - (y + 0.5) / h;
      const base = v > 0.46 ? rubber * 0.85 : rubber;
      const o0 = (row * h + h - 1 - y) * w; // DataTexture row 0 is v = 0 → flip rows, stack atlas rows upward
      let sr = 0, sa = 0;
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const val = Math.round((base - 10 * (px[i + 2]! / 255)) + (232 - base) * (px[i]! / 255));
        const o = (o0 + x) * 4;
        d[o] = d[o + 1] = d[o + 2] = val;
        d[o + 3] = px[i + 1]!;
        sr += val;
        sa += px[i + 1]!;
      }
      // Smeared row: mean over u (averaging in sRGB is fine for this low-contrast result).
      const so = (row * h + h - 1 - y) * 4;
      for (let x = 0; x < 4; x++) {
        const o = (so + x) * 4;
        sm[o] = sm[o + 1] = sm[o + 2] = Math.round(sr / w);
        sm[o + 3] = Math.round(sa / w);
      }
    }
  });
  const crisp = dataTex(d, w, h * rows, true);
  crisp.name = 'apex.wheel.sidewall';
  const smeared = dataTex(sm, 4, h * rows, false);
  smeared.name = 'apex.wheel.sidewallSmeared';
  return { crisp, smeared };
}

// Shared per font family between material libraries (showroom + race), released with the last tyre material.
const sidewalls = new Map<string, { tex: SidewallTextures; refs: number }>();
function retainSidewall(fontFamily: string): SidewallTextures {
  let e = sidewalls.get(fontFamily);
  if (!e) {
    e = { tex: makeSidewall(fontFamily), refs: 0 };
    sidewalls.set(fontFamily, e);
  }
  e.refs++;
  return e.tex;
}
function releaseSidewall(fontFamily: string): void {
  const e = sidewalls.get(fontFamily);
  if (!e || --e.refs > 0) return;
  e.tex.crisp.dispose();
  e.tex.smeared.dispose();
  sidewalls.delete(fontFamily);
}

/**
 * Tyre tread: analytic grooves on the contact face for Wet (deep directional V grooves + three circumferential
 * channels) and Intermediate (finer, shallower sipes from the shoulders + one centre channel). Coordinates come from
 * the wheel-local position (seam-free); edges are anti-aliased with screen-space derivatives and the pattern fades to
 * its mean coverage once a groove pitch drops below ~3 px or the wheel blurs at speed.
 */
const TREAD_HALF = FRONT_W / 2 - SHOULDER_R;
const TREAD_GLSL = /* glsl */ `
varying vec3 vTread;
varying vec3 vTyreP;
float treadBand(float d, float w, float fw) { return 1.0 - smoothstep(w - fw, w + fw, d); }
float treadGroove() {
  if (vTread.x < 0.5) return 0.0;
  float r = length(vTyreP.yz);
  float face = smoothstep(${f(TYRE_R - 0.004)}, ${f(TYRE_R - 0.001)}, r);
  if (face <= 0.0) return 0.0;
  float t = vTyreP.x / ${f(TREAD_HALF)};
  float at = abs(t);
  float wet = step(1.5, vTread.x);
  float n = mix(64.0, 36.0, wet);
  float ph = vTread.z * atan(vTyreP.z, vTyreP.y) / 6.2831853 * n + at * mix(0.9, 1.6, wet);
  float fwp = length(vec2(length(dFdx(vTyreP.yz)), length(dFdy(vTyreP.yz)))) / r / 6.2831853 * n + fwidth(at) * 1.6;
  float fwt = fwidth(t);
  float w = mix(0.13, 0.17, wet);
  float d = abs(fract(ph) - 0.5);
  float zone = wet > 0.5 ? smoothstep(0.08, 0.14, at) * (1.0 - smoothstep(0.86, 0.94, at)) : smoothstep(0.3, 0.38, at) * (1.0 - smoothstep(0.9, 0.97, at));
  float vg = treadBand(d, w, fwp) * zone;
  float fade = max(smoothstep(0.15, 0.35, fwp), vTread.y);
  vg = mix(vg, 2.0 * w * zone, fade);
  float cg = treadBand(at, 0.05, fwt);
  cg = max(cg, wet * treadBand(abs(at - 0.52), 0.045, fwt));
  float g = max(vg, cg) * mix(0.65, 1.0, wet);
  return g * face * (1.0 - smoothstep(0.97, 1.03, at));
}
`;

/** Brake glow ramp (rendering.md §6): dark red → orange → yellow-white, emissive × 6 g². */
const GLOW_GLSL = /* glsl */ `
vec3 brakeGlow(float g) {
  g = clamp(g, 0.0, 1.0);
  vec3 ramp = g < 0.3 ? mix(vec3(0.0), vec3(0.102, 0.003, 0.0), g / 0.3)
    : g < 0.7 ? mix(vec3(0.102, 0.003, 0.0), vec3(1.0, 0.042, 0.0), (g - 0.3) / 0.4)
    : mix(vec3(1.0, 0.042, 0.0), vec3(1.0, 0.352, 0.051), (g - 0.7) / 0.3);
  return ramp * 6.0 * g * g;
}
`;

function patch(m: Material, key: string, fn: (s: WebGLProgramParametersWithUniforms) => void): void {
  m.onBeforeCompile = fn;
  m.customProgramCacheKey = () => key;
}

export interface WheelMaterials { tyre: MeshStandardMaterial; rim: MeshStandardMaterial; hub: MeshStandardMaterial }

/** Creates the three shared wheel materials. The sidewall textures are released when `tyre` is disposed. */
export function createWheelMaterials(fontFamily: string): WheelMaterials {
  const side = retainSidewall(fontFamily);
  const rows = TYRE_SIDEWALL_LABELS.length.toFixed(1);
  const tyre = new MeshStandardMaterial({ name: 'car.tyre', color: 0xffffff, map: side.crisp, roughness: 0.85, metalness: 0, envMapIntensity: 0.6 });
  tyre.addEventListener('dispose', () => releaseSidewall(fontFamily));
  patch(tyre, 'car.tyre.v3', (s) => {
    s.uniforms['uSideSmear'] = { value: side.smeared };
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aCompound;\nattribute vec3 aTread;\nvarying vec3 vCompound;\nvarying vec3 vTread;\nvarying vec3 vTyreP;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCompound = aCompound;\nvTread = aTread;\nvTyreP = position;');
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform sampler2D uSideSmear;\nvarying vec3 vCompound;\n${TREAD_GLSL}`)
      .replace('#include <map_fragment>', [
        '#ifdef USE_MAP',
        `vec2 sideUv = vec2( vMapUv.x, ( clamp( vMapUv.y, 0.004, 0.996 ) + floor( vTread.x + 0.5 ) ) / ${rows} );`,
        // Spinning: crossfade to the circumferential mean (lettering smears into a grey ring, the band stays).
        'vec4 tyreTex = mix( texture2D( map, sideUv ), texture2D( uSideSmear, sideUv ), vTread.y );',
        'diffuseColor.rgb *= mix( tyreTex.rgb, vCompound, tyreTex.a );',
        '#endif',
        'float treadG = treadGroove();',
        // Rubber is a dark grey, not black: the tyre's form reads in sunlight.
        'diffuseColor.rgb = diffuseColor.rgb * 1.35 + vec3( 0.006 );',
        'diffuseColor.rgb *= 1.0 - 0.6 * treadG;',
      ].join('\n'))
      .replace('#include <roughnessmap_fragment>', [
        '#include <roughnessmap_fragment>',
        // Dry slicks: the worn-in tread face and shoulders are smoother than the sidewall, with fine circumferential
        // scrub streaks (rings in x, so they survive the spin); faded once a streak is under a pixel. Grooves stay matte.
        `float tyreR = length( vTyreP.yz );`,
        `float slickFace = smoothstep( ${f(TYRE_R - 0.03)}, ${f(TYRE_R - 0.004)}, tyreR ) * ( 1.0 - step( 0.5, vTread.x ) );`,
        'float scrubP = vTyreP.x * 420.0;',
        'float scrub = fract( sin( floor( scrubP ) * 91.7 ) * 4375.85 );',
        'scrub = mix( scrub, 0.5, smoothstep( 0.3, 0.8, fwidth( scrubP ) ) );',
        'roughnessFactor *= mix( 1.0, 0.5 + 0.18 * scrub, slickFace );',
        // Lettering is a smoother, slightly raised paint.
        '#ifdef USE_MAP',
        'roughnessFactor *= mix( 1.0, 0.8, smoothstep( 0.3, 0.8, tyreTex.r ) );',
        '#endif',
        'roughnessFactor = mix( roughnessFactor, 0.95, treadG );',
      ].join('\n'))
      .replace('#include <normal_fragment_maps>', [
        '#include <normal_fragment_maps>',
        // Bump from the analytic groove height (same construction as three's perturbNormalArb).
        '{',
        '  float th = -treadG * 0.004;',
        '  vec3 sx = dFdx( -vViewPosition ), sy = dFdy( -vViewPosition );',
        '  vec3 r1 = cross( sy, normal ), r2 = cross( normal, sx );',
        '  float det = dot( sx, r1 ) * faceDirection;',
        '  vec3 grad = sign( det ) * ( dFdx( th ) * r1 + dFdy( th ) * r2 );',
        '  normal = normalize( abs( det ) * normal - grad );',
        '}',
      ].join('\n'));
  });

  const P = RIM_PART;
  const rim = new MeshStandardMaterial({ name: 'car.rim', color: 0xffffff, roughness: 0.35, metalness: 0.85, envMapIntensity: 1 });
  patch(rim, 'car.rim.v3', (s) => {
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aPart;\nattribute vec3 aTint;\nattribute vec2 aBlur;\nvarying vec3 vRimP;\nvarying float vPart;\nvarying vec3 vTint;\nvarying vec2 vBlur;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRimP = position; vPart = aPart; vTint = aTint; vBlur = aBlur;');
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vRimP;\nvarying float vPart;\nvarying vec3 vTint;\nvarying vec2 vBlur;\n${GLOW_GLSL}`)
      .replace('#include <color_fragment>', [
        '#include <color_fragment>',
        'float rr = length( vRimP.yz );',
        'float ra = atan( vRimP.z, vRimP.y );',
        'int part = int( vPart + 0.5 );',
        'vec3 rc = vec3( 0.16, 0.165, 0.175 ); float wRough = 0.32; float wMetal = 0.85; vec3 wGlow = vec3( 0.0 );',
        `if ( part == ${P.barrel} ) { rc = vec3( 0.07 ); wRough = 0.5; }`,
        `else if ( part == ${P.cover} ) {`,
        // Satin team-tinted shell; a bright machined ring at the rim edge and a dark lip around the hub opening.
        '  rc = vTint * 0.8 + 0.02; wMetal = 0.35; wRough = 0.3;',
        `  float edgeR = smoothstep( ${f(COVER_R - 0.011)}, ${f(COVER_R - 0.008)}, rr );`,
        '  rc = mix( rc, vec3( 0.62 ), edgeR ); wMetal = mix( wMetal, 0.9, edgeR ); wRough = mix( wRough, 0.22, edgeR );',
        `  float lip = 1.0 - smoothstep( ${f(COVER_HOLE_R + 0.004)}, ${f(COVER_HOLE_R + 0.007)}, rr );`,
        '  rc = mix( rc, vec3( 0.05 ), lip ); wMetal = mix( wMetal, 0.2, lip );',
        // Two radial panel seams (180° apart) and a fastener ring; they fade out with screen size and rotation blur.
        '  float aw = fwidth( ra ) + 1e-4;',
        '  float sd = abs( fract( ra / 3.14159265 + 0.5 ) - 0.5 ) * 3.14159265 * rr;',
        `  float seam = ( 1.0 - smoothstep( 0.0012, 0.0012 + aw * rr * 1.5, sd ) ) * step( ${f(COVER_HOLE_R + 0.01)}, rr ) * ( 1.0 - edgeR );`,
        '  float dots = 1.0 - smoothstep( 0.0035, 0.0035 + fwidth( rr ) * 1.5 + aw * rr, length( vec2( rr - 0.075, ( fract( ra * 0.95493 + 0.5 ) - 0.5 ) * 1.0472 * rr ) ) );',
        '  float sharp = 1.0 - smoothstep( 0.15, 0.6, vBlur.x );',
        '  rc *= 1.0 - 0.55 * max( seam, dots * 0.8 ) * sharp;',
        // At speed: soft concentric streaks (the seams and fasteners smeared around the axle).
        '  float streak = 0.5 + 0.5 * sin( rr * 420.0 );',
        '  rc *= 1.0 - 0.04 * vBlur.x * streak * ( 1.0 - lip ) * ( 1.0 - smoothstep( 0.5, 2.0, fwidth( rr * 420.0 ) ) );',
        '  wRough = mix( wRough, 0.42, vBlur.x * 0.6 );',
        // Brake heat leaks out only as a faint ring at the cover edge.
        `  wGlow = brakeGlow( vBlur.y ) * 0.12 * smoothstep( ${f(COVER_R - 0.016)}, ${f(COVER_R - 0.004)}, rr );`,
        '}',
        `else if ( part == ${P.nut} ) { rc = vTint * 0.85 + 0.03; wMetal = 0.6; wRough = 0.28; }`,
        `else if ( part == ${P.metal} ) { rc = rr > 0.219 ? vec3( 0.75 ) : vec3( 0.2 ); wRough = rr > 0.219 ? 0.18 : 0.35; }`,
        'diffuseColor.rgb = rc;',
      ].join('\n'))
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = wRough;')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = wMetal;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += wGlow;');
  });

  const hub = new MeshStandardMaterial({ name: 'car.hub', color: 0x2b2b2b, roughness: 0.8, metalness: 0.2, envMapIntensity: 0.6 });
  patch(hub, 'car.hub.v2', (s) => {
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aGlow;\nattribute float aDisc;\nvarying float vGlow;\nvarying float vPart;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = aGlow * step( 0.5, aDisc ) * step( aDisc, 1.5 );\nvPart = aDisc;');
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying float vGlow;\nvarying float vPart;\n${GLOW_GLSL}`)
      // Part colours (aDisc: 0 drum / upright, 1 disc (LOD2), 2 caliper: satin titanium).
      .replace('#include <color_fragment>', '#include <color_fragment>\nif ( vPart > 1.5 ) diffuseColor.rgb = vec3( 0.42, 0.43, 0.46 );\nelse if ( vPart > 0.5 ) diffuseColor.rgb = vec3( 0.075, 0.073, 0.072 );')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nif ( vPart > 1.5 ) roughnessFactor = 0.38;')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nif ( vPart > 1.5 ) metalnessFactor = 0.7;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += brakeGlow( vGlow );');
  });
  return { tyre, rim, hub };
}
