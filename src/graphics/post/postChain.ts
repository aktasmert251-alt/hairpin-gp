// Post-processing chain (docs/design/rendering.md §4.1, PLAN Ek B):
//  1 RenderPass(scene) → 2 DepthCopyPass (soft particles) → 3 RenderPass(fxScene, clear=false)
//  → 4 N8AO → 5 EffectPass A (AA → Bloom → Exposure → AgX → LUT → Vignette)
//  → 6 EffectPass B (chromatic aberration) → 7 EffectPass C (lens droplets / heat haze).
// setQuality rebuilds only the parts whose configuration changed; everything else is toggled in place.

import { Color, HalfFloatType, RGBADepthPacking, Scene, Vector2, type PerspectiveCamera, type Texture, type WebGLRenderer } from 'three';
import {
  BloomEffect, ChromaticAberrationEffect, DepthCopyPass, EdgeDetectionMode, EffectComposer, EffectPass, FXAAEffect, LUT3DEffect,
  type LookupTexture, RenderPass, SMAAEffect, SMAAPreset, ToneMappingEffect, ToneMappingMode, VignetteEffect, VignetteTechnique, type Effect,
} from 'postprocessing';
import { N8AOPostPass } from 'n8ao';
import type { QualityPreset } from '../../contracts/render';
import type { LightingRig } from '../../contracts/environment';
import { PRESET_DERIVED } from '../presets';
import { ExposureEffect } from './exposureEffect';
import { ScreenDistortionEffect } from './lensFx';
import { createLutTexture, updateLutTexture } from './lut';
import { cloneGrade, gradeFor, NEUTRAL_GRADE, type GradeParams } from './lutPresets';
import { applyTrackLook, lookScale, TRACK_LOOKS, type TrackLook } from './trackLooks';

export interface PostChain {
  readonly composer: EffectComposer;
  /** Scene drawn in pass 3 (particles, streaks, glow sprites; layer 2 objects). */
  readonly fxScene: Scene;
  /** RGBA-packed scene depth for soft particles (null on Low: hard particles). */
  depthTexture(): Texture | null;
  setQuality(q: QualityPreset): void;
  setPostEnabled(on: boolean): void;
  /** Per-frame values from the live rig; `dt` drives the exposure ease (τ = 1 s). */
  update(rig: LightingRig | null, cloud: number, dt: number): void;
  /** Chromatic aberration amplitude in UV units (0 disables pass B). */
  setAberration(a: number): void;
  /** Vignette darkness multiplier (cockpit × 0.75). */
  setVignetteScale(k: number): void;
  /** G6: lens distortion (droplets / heat haze) target and strength; 0 disables pass C. */
  setLens(strength: number, distortion: Texture | null): void;
  /** G10: heat-haze offset target (Ultra, dry, day/sunset); null = off. Pass C runs when droplets or haze are active. */
  setHaze(haze: Texture | null): void;
  setCamera(cam: PerspectiveCamera): void;
  /** Disable AO temporarily (long-lens views: half-res depth-aware upsampling yields NaNs below ~20° FOV). */
  suppressAo(on: boolean): void;
  render(dt: number): void;
  setSize(w: number, h: number): void;
  /** Current grade id ('day' | 'sunset' | 'night' | 'overcast'). */
  gradeId(): string;
  /** Force a grade (post scene LUT preview); null returns to the rig-driven grade. */
  forceGrade(id: 'day' | 'sunset' | 'night' | 'overcast' | null): void;
  /** Per-track look (trackLooks.ts) on top of the time-of-day grade; null / unknown id = none. */
  setLook(trackId: string | null): void;
  dispose(): void;
}

/**
 * QC2-16: the N8AO denoise loop samples tDiffuse / sceneDepth with implicit-derivative texture2D after a divergent early
 * return, which D3D reports as X3595 (gradient in a loop with varying iteration). Both are full-screen point lookups,
 * so an explicit LOD 0 gives the same result without derivatives.
 */
function patchDenoise(ao: N8AOPostPass): void {
  for (const m of [ao.standardDenoiseMaterial, ao.neuralDenoiseMaterial]) {
    if (!m || m.fragmentShader.includes('textureLod(tDiffuse, uv + offset')) continue;
    m.fragmentShader = m.fragmentShader
      .replace('texture2D(tDiffuse, uv + offset)', 'textureLod(tDiffuse, uv + offset, 0.0)')
      .replace('texture2D(sceneDepth, uv + offset)', 'textureLod(sceneDepth, uv + offset, 0.0)');
    m.needsUpdate = true;
  }
}

const SMAA_PRESET: Record<QualityPreset['smaa'], SMAAPreset> = { MEDIUM: SMAAPreset.MEDIUM, HIGH: SMAAPreset.HIGH, ULTRA: SMAAPreset.ULTRA };

export function createPostChain(renderer: WebGLRenderer, scene: Scene, camera: PerspectiveCamera, q0: QualityPreset): PostChain {
  const composer = new EffectComposer(renderer, { frameBufferType: HalfFloatType, multisampling: 0, stencilBuffer: false, depthBuffer: true });
  const fxScene = new Scene();
  fxScene.name = 'apex.fxScene';

  const mainPass = new RenderPass(scene, camera);
  const depthCopy = new DepthCopyPass({ depthPacking: RGBADepthPacking });
  const fxPass = new RenderPass(fxScene, camera);
  fxPass.clear = false;
  fxPass.skipShadowMapUpdate = true;
  fxPass.ignoreBackground = true;
  composer.addPass(mainPass);
  composer.addPass(depthCopy);
  composer.addPass(fxPass);

  let q = q0;
  let postOn = true;
  let ao: N8AOPostPass | null = null;
  let passA: EffectPass | null = null;
  let passAKey = '';
  let passB: EffectPass | null = null;
  let passC: EffectPass | null = null;
  let cam = camera;
  let aoSuppressed = false;
  /** B and C compile their EffectMaterial on first use; render them once (identity at a = 0 / strength 0) after a rebuild. */
  let warmBC = false;
  let hazeOn = false;

  // Long-lived effect state (recreated with pass A when its composition changes).
  let exposure: ExposureEffect | null = null;
  let bloom: BloomEffect | null = null;
  let lutEffect: LUT3DEffect | null = null;
  let vignette: VignetteEffect | null = null;
  const ca = new ChromaticAberrationEffect({ offset: new Vector2(0, 0), radialModulation: true, modulationOffset: 0.25 });
  const lens = new ScreenDistortionEffect();
  const lut: LookupTexture = createLutTexture(NEUTRAL_GRADE);
  const grade: GradeParams = cloneGrade(NEUTRAL_GRADE);
  let gradeM = -1;
  let look: TrackLook | null = null;
  /** Smoothed overcast factor of the current grade (for the look's exposure / bloom scale). */
  let lookM = 0;
  let gradeTod = '';
  let gradeTimer = 1;
  let curGrade = 'day';
  let forced: 'day' | 'sunset' | 'night' | 'overcast' | null = null;
  let expo = 1;
  let caAmp = 0;
  let vigScale = 1;
  let vigBase = 0.45;

  const removePass = (p: EffectPass | null): void => {
    if (!p) return;
    composer.removePass(p);
    p.dispose();
  };

  const buildPassA = (): void => {
    const key = postOn ? `${q.aa}|${q.smaa}|${q.bloom ? PRESET_DERIVED[q.id].bloomLevels : 0}|${q.lut}` : 'bare';
    if (key === passAKey && passA) return;
    // Index of pass A = right after AO (or fx pass).
    removePass(passA);
    passA = null;
    removePass(passB);
    passB = null;
    removePass(passC);
    passC = null;
    exposure = new ExposureEffect(expo);
    const tone = new ToneMappingEffect({ mode: ToneMappingMode.AGX });
    const effects: Effect[] = [];
    bloom = null;
    lutEffect = null;
    vignette = null;
    if (postOn) {
      effects.push(q.aa === 'fxaa' ? new FXAAEffect() : new SMAAEffect({ preset: SMAA_PRESET[q.smaa], edgeDetectionMode: EdgeDetectionMode.COLOR }));
      if (q.bloom) {
        bloom = new BloomEffect({ mipmapBlur: true, luminanceThreshold: 0.95, luminanceSmoothing: 0.25, intensity: 0.25, radius: 0.75, levels: PRESET_DERIVED[q.id].bloomLevels, resolutionScale: 0.5 });
        effects.push(bloom);
      }
      effects.push(exposure, tone);
      if (q.lut) {
        lutEffect = new LUT3DEffect(lut, { tetrahedralInterpolation: q.id === 'ultra' });
        effects.push(lutEffect);
      }
      vignette = new VignetteEffect({ technique: VignetteTechnique.DEFAULT, offset: 0.3, darkness: vigBase * vigScale });
      effects.push(vignette);
    } else {
      effects.push(exposure, tone);
    }
    if (postOn) {
      // Deviation (documented): B (CA) and C (lens) run on the HDR image *before* pass A, so pass A is always the
      // enabled screen pass. Toggling B/C then never flips renderToScreen (which would recompile EffectMaterials).
      passC = new EffectPass(cam, lens);
      passC.enabled = lens.strength > 0 || hazeOn;
      composer.addPass(passC);
      passB = new EffectPass(cam, ca);
      passB.enabled = caAmp >= 1e-5 && q.lens !== 'droplets';
      composer.addPass(passB);
    }
    passA = new EffectPass(cam, ...effects);
    composer.addPass(passA);
    passAKey = key;
    warmBC = postOn;
  };

  const configureAo = (): void => {
    const want = postOn && q.ao !== 'off';
    if (!want || aoSuppressed) {
      if (ao) ao.enabled = false;
      return;
    }
    if (!ao) {
      const size = renderer.getDrawingBufferSize(new Vector2());
      const pass = new N8AOPostPass(scene, cam, size.x, size.y);
      const configureDenoise = pass.configureDenoisePass.bind(pass);
      pass.configureDenoisePass = (...args: unknown[]): void => {
        configureDenoise(...args);
        patchDenoise(pass);
      };
      patchDenoise(pass);
      ao = pass;
      // Insert right after the FX pass (index 3), before the effect passes.
      composer.addPass(ao, 3);
    }
    ao.enabled = true;
    const c = ao.configuration;
    const full = q.ao === 'full';
    c.gammaCorrection = false;
    c.screenSpaceRadius = false;
    c.transparencyAware = false;
    c.accumulate = false;
    c.depthAwareUpsampling = true;
    c.color = new Color(0, 0, 0);
    c.distanceFalloff = 0.5;
    c.denoiseSamples = 8;
    c.halfRes = !full;
    c.aoRadius = full ? 1.8 : 1.6;
    c.intensity = full ? 2.6 : 2.4;
    c.aoSamples = full ? 32 : 16;
    c.denoiseRadius = full ? 8 : 12;
  };

  const applyQuality = (): void => {
    depthCopy.enabled = postOn && PRESET_DERIVED[q.id].softParticles;
    configureAo();
    buildPassA();
  };
  applyQuality();

  const refreshGrade = (rig: LightingRig | null, cloudIn: number, dt: number): void => {
    gradeTimer += dt;
    const tod = forced ?? rig?.tod ?? 'day';
    if (forced) {
      if (gradeTod === `f:${forced}`) return;
      const src = forced === 'overcast' ? 'day' : forced;
      gradeFor(src, forced === 'overcast' ? 1 : 0, grade);
      curGrade = forced;
      gradeTod = `f:${forced}`;
      updateLutTexture(lut, grade);
      return;
    }
    const t = tod as 'day' | 'sunset' | 'night';
    const m = cloudIn < 0 ? 0 : cloudIn > 1 ? 1 : cloudIn;
    if (gradeTod === t && Math.abs(m - gradeM) < 0.05) return;
    if (gradeTod === t && gradeTimer < 1) return;
    const r = gradeFor(t, m, grade);
    applyTrackLook(grade, look, t, t === 'night' ? 0.5 * r.m : r.m);
    lookM = t === 'night' ? 0.5 * r.m : r.m;
    curGrade = r.id;
    gradeTod = t;
    gradeM = m;
    gradeTimer = 0;
    updateLutTexture(lut, grade);
  };

  const chain: PostChain = {
    composer,
    fxScene,
    depthTexture: () => (depthCopy.enabled ? depthCopy.texture : null),
    setQuality(nq) {
      q = nq;
      applyQuality();
    },
    setPostEnabled(on) {
      if (on === postOn) return;
      postOn = on;
      applyQuality();
    },
    update(rig, cloud, dt) {
      const lt = (rig?.tod ?? 'day') as 'day' | 'sunset' | 'night';
      const target = (rig?.exposure ?? 1) * lookScale(look, lt, lookM, 'exposure');
      expo += (target - expo) * (dt > 0 ? 1 - Math.exp(-dt / 1.0) : 1);
      if (dt <= 0 && rig) expo = target;
      if (exposure) exposure.exposure = expo;
      if (bloom && rig) {
        bloom.intensity = rig.bloomIntensity * lookScale(look, lt, lookM, 'bloom');
        bloom.luminanceMaterial.threshold = rig.bloomThreshold;
      }
      vigBase = rig?.tod === 'night' ? 0.55 : 0.45;
      if (vignette) vignette.darkness = vigBase * vigScale;
      if (lutEffect) refreshGrade(rig, cloud, dt);
    },
    setAberration(a) {
      caAmp = a;
      ca.offset.set(a, 0.6 * a);
      if (passB) passB.enabled = a >= 1e-5 && q.lens !== 'droplets';
    },
    setVignetteScale(k) {
      vigScale = k;
    },
    setLens(strength, distortion) {
      lens.distortion = distortion;
      lens.strength = postOn ? strength : 0;
      if (passC) passC.enabled = (lens.strength > 0 && distortion !== null) || hazeOn;
    },
    setHaze(t) {
      hazeOn = postOn && t !== null;
      lens.haze = hazeOn ? t : null;
      if (passC) passC.enabled = (lens.strength > 0) || hazeOn;
    },
    suppressAo(on) {
      if (on === aoSuppressed) return;
      aoSuppressed = on;
      configureAo();
    },
    setCamera(c) {
      cam = c;
      composer.setMainCamera(c);
    },
    render(dt) {
      if (warmBC && passB && passC) {
        warmBC = false;
        const b = passB.enabled, c = passC.enabled;
        if (!b) ca.offset.set(0, 0);
        passB.enabled = passC.enabled = true;
        composer.render(dt);
        ca.offset.set(caAmp, 0.6 * caAmp);
        passB.enabled = b;
        passC.enabled = c;
        return;
      }
      composer.render(dt);
    },
    setSize(w, h) {
      composer.setSize(w, h, false);
    },
    gradeId: () => curGrade,
    setLook(id) {
      const next = id ? TRACK_LOOKS[id] ?? null : null;
      if (next === look) return;
      look = next;
      gradeTod = '';
    },
    forceGrade(id) {
      forced = id;
      gradeTod = '';
      gradeM = -1;
      gradeTimer = 1;
    },
    dispose() {
      composer.dispose();
      ca.dispose();
      lens.dispose();
      lut.dispose();
      ao = null;
      passA = null;
      passB = null;
      passC = null;
    },
  };
  return chain;
}
