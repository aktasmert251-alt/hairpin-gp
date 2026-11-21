// Exposure (docs/design/rendering.md §4.2): outputColor = inputColor * uExposure, before AgX.
// The graphics system eases `exposure` toward rig.exposure with τ = 1 s; renderer.toneMappingExposure is unused.

import { Uniform } from 'three';
import { Effect } from 'postprocessing';

const FRAG = /* glsl */ `
uniform float uExposure;
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  outputColor = vec4(inputColor.rgb * uExposure, inputColor.a);
}
`;

export class ExposureEffect extends Effect {
  constructor(exposure = 1) {
    super('ExposureEffect', FRAG, { uniforms: new Map([['uExposure', new Uniform(exposure)]]) });
  }

  get exposure(): number {
    return this.uniforms.get('uExposure')!.value as number;
  }

  set exposure(v: number) {
    this.uniforms.get('uExposure')!.value = v;
  }
}
