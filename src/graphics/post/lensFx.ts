// ScreenDistortionEffect (docs/design/rendering.md §4.4): samples the half-resolution droplet / heat-haze
// distortion target (RG = 0.5-biased UV offset, B = mask, A = rim) written by post/lensDroplets.ts.
// While `strength` is 0 the pass that holds this effect stays disabled (zero cost).

import { Uniform, type Texture } from 'three';
import { Effect, EffectAttribute } from 'postprocessing';

const FRAG = /* glsl */ `
uniform sampler2D uDistortion;
uniform float uStrength;
uniform sampler2D uHaze;
uniform float uHazeOn;
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec4 d = texture2D(uDistortion, uv);
  float mask = d.b * uStrength;
  vec2 off = d.rg * 2.0 - 1.0; // −outward normal × (1 − z)
  vec3 c2 = texture2D(inputBuffer, uv + off * 0.03 * mask).rgb * 1.04;
  float lum = dot(inputColor.rgb, vec3(0.2126, 0.7152, 0.0722));
  // G10 heat haze: signed UV offset (target cleared to 0), applied to the whole image under the drops.
  vec3 base = uHazeOn > 0.5 ? texture2D(inputBuffer, uv + texture2D(uHaze, uv).rg).rgb : inputColor.rgb;
  // Refracted image inside the drop, a darker meniscus ring and a sky highlight on the upper edge.
  vec3 c = mix(base, c2, mask);
  c *= 1.0 - 0.35 * d.a * uStrength;
  float spec = smoothstep(0.12, 0.45, dot(-off, vec2(-0.37, 0.93))) * mask;
  c += vec3(0.15 + 0.5 * lum) * spec;
  outputColor = vec4(c, inputColor.a);
}
`;

export class ScreenDistortionEffect extends Effect {
  constructor() {
    super('ScreenDistortionEffect', FRAG, {
      attributes: EffectAttribute.CONVOLUTION,
      uniforms: new Map<string, Uniform>([
        ['uDistortion', new Uniform(null)],
        ['uStrength', new Uniform(0)],
        ['uHaze', new Uniform(null)],
        ['uHazeOn', new Uniform(0)],
      ]),
    });
  }

  set distortion(t: Texture | null) {
    this.uniforms.get('uDistortion')!.value = t;
  }

  /** G10: heat-haze offset target; null switches the haze term off. */
  set haze(t: Texture | null) {
    this.uniforms.get('uHaze')!.value = t;
    this.uniforms.get('uHazeOn')!.value = t ? 1 : 0;
  }

  get strength(): number {
    return this.uniforms.get('uStrength')!.value as number;
  }

  set strength(v: number) {
    this.uniforms.get('uStrength')!.value = v;
  }
}
