// Minimal typings for n8ao 2.0.1 (the package ships none). Only the API used by src/graphics/post.
declare module 'n8ao' {
  import type { Camera, Color, Scene } from 'three';
  import { Pass } from 'postprocessing';

  export interface N8AOConfiguration {
    aoSamples: number; aoRadius: number; denoiseSamples: number; denoiseRadius: number; distanceFalloff: number; intensity: number;
    denoiseIterations: number; renderMode: 0 | 1 | 2 | 3 | 4; color: Color; gammaCorrection: boolean; screenSpaceRadius: boolean;
    halfRes: boolean; depthAwareUpsampling: boolean; colorMultiply: boolean; transparencyAware: boolean; accumulate: boolean; neuralDenoise: boolean;
  }

  export class N8AOPostPass extends Pass {
    constructor(scene: Scene, camera: Camera, width?: number, height?: number);
    configuration: N8AOConfiguration;
    setQualityMode(mode: 'Performance' | 'Low' | 'Medium' | 'High' | 'Ultra'): void;
    /** Internal: rebuilds the denoise materials (called on construction and on configuration changes). */
    configureDenoisePass(...args: unknown[]): void;
    standardDenoiseMaterial: import('three').ShaderMaterial | null;
    neuralDenoiseMaterial: import('three').ShaderMaterial | null;
  }
}
