// Contract: lighting rig and environment build. Implemented by: Çevre (src/track/** presentation side).

import type { DirectionalLight, HemisphereLight, Object3D, PerspectiveCamera, Scene } from 'three';
import type { TimeOfDay, Vec3 } from './common';
import type { ConditionsFrame } from './conditions';
import type { AssetLoader, QualityPreset, RenderContext, RenderFrame } from './render';
import type { TrackBundle } from './track';

export interface LightingRig {
  tod: TimeOfDay; sunDir: Vec3; sunColor: number; sunIntensity: number; hemiSky: number; hemiGround: number; hemiIntensity: number;
  envIntensity: number; exposure: number; fogColor: number; fogDensity: number; bloomIntensity: number; bloomThreshold: number;
  lut: 'day' | 'sunset' | 'night' | 'overcast'; shadows: boolean;
}

export interface EnvironmentHandle {
  root: Object3D; sun: DirectionalLight; hemi: HemisphereLight; envScene: Scene; rig: LightingRig;
  applyConditions(c: ConditionsFrame): void;
  update(cam: PerspectiveCamera, frame: RenderFrame, dt: number): void;
  setQuality(q: QualityPreset): void;
  dispose(): void;
}

export type BuildEnvironment = (a: {
  track: TrackBundle; quality: QualityPreset; conditions: ConditionsFrame; ctx: RenderContext; assets: AssetLoader; onProgress(p: number): void;
}) => Promise<EnvironmentHandle>;
