# Rendering specification (replaces the lost report §8)

> Owner: Planner. Implementers: **Grafik-3B** (`src/graphics/**`) and **Çevre** (`src/track/{mesh,scenery,terrain,sky}/**`).
> Inputs: PLAN Ek B (wins on conflict), planner-report §4 (`render.ts`, `environment.ts`), §7.12–§7.14, DESIGN.md §1 (3D art direction, mood per time of day).
> Pinned stack: three 0.186.1, postprocessing 6.39.5, n8ao 2.0.1. Where an API detail below differs from the 6.39.5 / r186 typings, follow the typings and keep the stated behaviour.
> **Art direction rule:** DESIGN.md §1.4.1 (time-of-day and weather grading), §1.4.2 (liveries), §1.4.4 (paint finishes) and §1.4.5 (showroom) are binding targets. The numbers below implement them: key-light colours, exposure, bloom, fog character and grade intent are taken from §1.4.1; intensities and densities are engineering values. ÇEV tunes the rigs in Sprint 2 against the gallery and records final values in `src/track/sky/rigs.ts`; GRA records final grades in `src/graphics/post/lutPresets.ts`. Retuning must keep the §1.4.1 targets (never purple/blue glows, white floodlights, sodium warmth only at the horizon).

## 0. Ownership split

| Concern | Owner | Where |
|---|---|---|
| WebGLRenderer, EffectComposer, all post effects, `QUALITY_PRESETS`, PMREM generation, exposure | GRA-3B | `src/graphics/renderer`, `src/graphics/post`, `src/graphics/presets.ts` |
| Car model, liveries, car materials, wheels, mirrors, ghost | GRA-3B | `src/graphics/car`, `src/graphics/materials` |
| VFX, skid marks, rain streaks, spray, lens droplets, heat haze | GRA-3B | `src/graphics/vfx`, `src/graphics/post/lensFx.ts` |
| Cameras (driving, TV, orbit, free, trailer) | GRA-3B | `src/graphics/camera` |
| Env scene content, `LightingRig` data, sun + hemi lights, shadow-camera fitting, fog object | ÇEV | `src/track/sky` |
| Track, terrain, scenery materials, wet shader, floodlight lightmap | ÇEV | `src/track/{mesh,scenery,terrain}` |

---

## 1. Renderer and colour pipeline

```ts
const renderer = new WebGLRenderer({ canvas, antialias: false, alpha: false, stencil: false, depth: true,
  powerPreference: 'high-performance', preserveDrawingBuffer: false, logarithmicDepthBuffer: false });
renderer.outputColorSpace = SRGBColorSpace;
renderer.toneMapping = NoToneMapping;          // tone mapping happens in the post chain (AgX)
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = PCFShadowMap;        // soft PCF via light.shadow.radius (PCFSoftShadowMap ignores radius)
renderer.info.autoReset = false;               // several passes per frame; GraphicsSystem resets once per frame
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5) * preset.renderScale);
const composer = new EffectComposer(renderer, { frameBufferType: HalfFloatType, multisampling: 0, stencilBuffer: false, depthBuffer: true });
```

- All lighting is linear HDR in half-float buffers until the tone-mapping effect. Display output is sRGB.
- Texture colour spaces: albedo, emissive, livery canvases, UI-like decals → `SRGBColorSpace`; normal, roughness, ORM, masks, lightmaps, LUT data → `NoColorSpace`.
- `scene.background = null`. The sky dome (ÇEV) draws itself first (`renderOrder = -1000`, `depthWrite = false`) and follows the camera; the far backdrop ring is drawn the same way at 0.95 × `far`.
- Camera planes: `near = 0.1 m` (cockpit and T-cam `0.05 m`), `far = preset.far`.
- Fog: `scene.fog = new FogExp2(rig.fogColor, rig.fogDensity)`, updated in place from the live rig every frame. Sky and backdrop shaders apply their own height fog toward `rig.fogColor`.
- Render layers: `0` world, `1` mirror-visible subset, `2` FX scene objects (particles, streaks, glow sprites), `3` debug.
- Shader warmup: `AssetLoader.warmup(renderer, scene, camera)` (`compileAsync`) after the environment, all car LODs, all VFX materials (with one live particle each) and every post effect have been created. Afterwards `renderer.info.programs.length` must not grow during the session (testing-qc.md P-04).

## 2. PMREM environment

- ÇEV builds `envHandle.envScene`: a small synthetic scene, never the real track.

| TOD | Env scene content |
|---|---|
| day | three `Sky` shader dome (turbidity 6, rayleigh 1.4, mieCoefficient 0.005, mieDirectionalG 0.8) at the rig sun direction, tuned so zenith ≈ `#7FB4E2` and horizon ≈ `#D8E6F1` (DESIGN §1.4.1); sun disc emissive, luminance clamped to 30; FBM cloud dome at current cover; ground disc r = 500 m `0x4d4a3f`; horizon silhouette ring `0x55604a` |
| sunset | sunset sun direction; gradient zenith `#2B3F6B` → `#E58A6A` → horizon `#FFA04D` |
| night | gradient dome (zenith `#05070D`, faint stars, sodium glow `#3A2A1A` only in the lowest 8°); 24 emissive floodlight panels (6 × 2 m, **white** `0xffffff`, emissive 8) on a ring r = 120 m at 18 m height; ground disc `0x101012` |
| rain / overcast modifier | flat overcast dome `#8E959D` (zenith) → `#B7BDC3` (horizon) blended in by cloud cover; sun disc hidden when cloud > 0.7 |

- GRA generates: `rt = pmrem.fromScene(envScene, 0, 0.5, 3000, { size: preset.envSize })` (sigma 0; r186 signature with `options.size`). Then `scene.environment = rt.texture` and `scene.environmentIntensity = rig.envIntensity` each frame.
- Regeneration triggers: `setLighting()` calls (session load; `|Δcloud| ≥ 0.1` or `|Δrain| ≥ 0.1`, at most once per 2 s, ARCHITECTURE §5.4) and `setQuality()` when `envSize` changes. The previous render target is disposed right after the swap.
- `pmrem.compileEquirectangularShader()` / `compileCubemapShader()` run during loading so the first regeneration does not compile shaders mid-race.

## 3. Shadows

One `DirectionalLight` (`envHandle.sun`, owned by ÇEV) is the only shadow caster. ÇEV fits its orthographic shadow camera every frame inside `env.update(cam, frame, dt)`.

### 3.1 Per preset

| Preset | `shadowSize` | `shadowExtent` (half-size, m) | Texel | `shadowRadius` | `bias` | `normalBias` | Casters |
|---|---|---|---|---|---|---|---|
| Low | 1024 | 35 | 6.8 cm | 1 | −0.0004 | 0.045 | cars only |
| Medium | 2048 | 55 | 5.4 cm | 2 | −0.0003 | 0.035 | cars, 3D trees, grandstands |
| High | 2048 | 70 | 6.8 cm | 3 | −0.0003 | 0.040 | + gantries, pit building, marshal posts |
| Ultra | 4096 | 90 | 4.4 cm | 4 | −0.0002 | 0.030 | + barriers, fences, light poles |

- Sun elevation below 15° (sunset): `bias × 1.5`, `normalBias × 1.8`, shadow camera `far = 700`. Otherwise `far = 500`, `near = 1`.
- Receivers: track ribbon, terrain, kerbs, run-offs, barriers, buildings, cars. Terrain and track never cast.

### 3.2 Fitting and texel snapping (every frame)
1. Focus point `F` = player car position (driving views) or the camera look target (TV, orbit, free, trailer).
2. Centre `C = F + camForwardXZ · 0.4 · extent` (60 % of the map lies ahead of the camera).
3. Light basis, computed once per rig: `zL = -sunDir`, `xL = normalize(cross(up, zL))` with `up = (0,1,0)` (use `(0,0,1)` when `|sunDir.y| > 0.98`), `yL = cross(zL, xL)`.
4. Project `C` onto `xL`, `yL`; snap each coordinate to `texel = 2·extent/shadowSize` with `Math.floor(v / texel) * texel`; rebuild `C'`.
5. `sun.position = C' + sunDir · 250`; `sun.target.position = C'`; ortho bounds `±extent`; `shadow.camera.updateProjectionMatrix()` only when the preset changes.
6. Shadow strength under clouds: `sun.shadow.intensity = lerp(1, 0.25, cloud)` (property available since r169). When `rig.shadows` is false, `sun.castShadow = false`.

### 3.3 Blob and contact shadows
- Every car gets a soft blob decal (one `InstancedMesh` for all cars, 20 + 1 instances, 2.4 × 5.8 m quad, radial falloff texture 128², `depthWrite = false`, `polygonOffset −2/−2`).
- Opacity: `0.55` outside the shadow frustum, `0.25` inside (contact darkening under the floor). Fades with height above ground (`> 0.3 m` → 0).
- Static environment AO is baked into vertex colours by ÇEV (barrier bases, stand interiors, pit garage mouths): darkening 0.55 at contact, 1.0 at 1.5 m.

---

## 4. Post-processing chain

### 4.1 Pass order (follows PLAN Ek B)

| # | Pass | Low | Medium | High | Ultra |
|---|---|---|---|---|---|
| 1 | `RenderPass(scene, camera)`: opaque, alpha-tested, transparent (glass, ghost) | ✓ | ✓ | ✓ | ✓ |
| 2 | `DepthCopyPass` → depth texture for soft particles | – | ✓ | ✓ | ✓ |
| 3 | `RenderPass(fxScene, camera)`, `clear = false`: particles, rain streaks, glow sprites (layer 2) | merged into 1 (hard particles) | ✓ | ✓ | ✓ |
| 4 | `N8AOPostPass` | – | – | half-res | full-res |
| 5 | `EffectPass A`: AA → Bloom → Exposure → ToneMapping(AgX) → LUT3D → Vignette | FXAA → Exposure → AgX | SMAA → … all | all | all |
| 6 | `EffectPass B`: ChromaticAberration (convolution) | – | when active | when active | when active |
| 7 | `EffectPass C`: `ScreenDistortionEffect` (lens droplets + heat haze, convolution) | in rain | in rain | in rain | in rain / heat haze |

- Each `EffectPass` holds at most one convolution effect (SMAA/FXAA, chromatic aberration, screen distortion). Passes 6 and 7 are disabled (`pass.enabled = false`, zero cost) whenever their effect has nothing to do.
- AA runs on the HDR input, as in postprocessing's standard SMAA usage. Accepted trade-off: slightly weaker edges on very bright speculars.
- N8AO runs after the FX pass because a pass that swaps buffers would lose the depth attachment that pass 3 needs. Accepted trade-off: AO slightly darkens smoke drawn over occluded pixels; keep the AO radius short.
- `?nopost=1` / `setPostEnabled(false)` (CR-09) leaves passes 1, 3 and a single `EffectPass(Exposure, AgX)`.

### 4.2 Effect parameters

| Effect | Parameters |
|---|---|
| **N8AO** High | `halfRes: true`, `depthAwareUpsampling: true`, `aoRadius: 1.6`, `distanceFalloff: 0.5`, `intensity: 2.4`, `aoSamples: 16`, `denoiseSamples: 8`, `denoiseRadius: 12`, `screenSpaceRadius: false`, `gammaCorrection: false`, `color: black`, `transparencyAware: false`, `accumulate: false` |
| **N8AO** Ultra | as High but `halfRes: false`, `aoRadius: 1.8`, `intensity: 2.6`, `aoSamples: 32`, `denoiseRadius: 8` |
| **SMAA** | `new SMAAEffect({ preset: SMAAPreset[preset.smaa], edgeDetectionMode: EdgeDetectionMode.COLOR })` |
| **FXAA** (Low) | `new FXAAEffect()` defaults |
| **Bloom** | `new BloomEffect({ mipmapBlur: true, luminanceThreshold: rig.bloomThreshold, luminanceSmoothing: 0.25, intensity: rig.bloomIntensity, radius: 0.75, levels })` with `levels` 5 / 6 / 7 for Medium / High / Ultra; `resolutionScale 0.5` |
| **Exposure** | custom `ExposureEffect` (`outputColor = vec4(inputColor.rgb * uExposure, inputColor.a)`), `uExposure` eased toward `rig.exposure` with τ = 1 s. Do not rely on `renderer.toneMappingExposure` |
| **Tone mapping** | `new ToneMappingEffect({ mode: ToneMappingMode.AGX })` |
| **LUT** | `new LUT3DEffect(lookupTexture)`, 32³, tetrahedral interpolation on Ultra; lookups on sRGB-encoded values (generator in §4.3) |
| **Vignette** | `new VignetteEffect({ technique: VignetteTechnique.DEFAULT, offset: 0.3, darkness })`, darkness 0.45 day/sunset, 0.55 night; cockpit view × 0.75 |
| **Chromatic aberration** | `new ChromaticAberrationEffect({ offset, radialModulation: true, modulationOffset: 0.25 })`; per frame `a = 0.0011 · smoothstep(160, 330, kmh)` (UV units); `offset.set(a, 0.6·a)`; add `+0.0008` decaying over 0.25 s after a collision with impulse > 8,000 N·s; `a = 0` when `settings.graphics.motionEffects` is false or the view is TV/orbit/trailer; pass disabled when `a < 1e-5` |

### 4.3 Procedural 3D LUT
`src/graphics/post/lut.ts` builds a 32³ RGBA8 `LookupTexture` on the CPU (≈ 1.5 ms). For every lattice point `c` (sRGB-encoded, 0..1):
1. `lin = srgbToLinear(c)`.
2. White balance: `lin *= (1 + 0.10·T + 0.02·N, 1 − 0.02·N, 1 − 0.10·T)` with temperature `T` and tint `N`.
3. Contrast around mid-grey in log space: `L = log2(lin + 1e-4)`; `L = (L − log2(0.18))·contrast + log2(0.18)`; `lin = 2^L`.
4. ASC CDL per channel: `lin = max(0, lin·slope + offset)^power`.
5. Saturation: `luma = dot(lin, (0.2126, 0.7152, 0.0722))`; `lin = luma + (lin − luma)·saturation`.
6. Shadow desaturation: `lin = mix(lin, vec3(luma), w_s·(1 − shadowSat))` with `w_s = 1 − smoothstep(0, 0.35, luma)`.
7. Split toning: `lin = mix(lin, lin·shadowTint·2, w_s·k_s)`; `lin = mix(lin, lin·highTint·2, w_h·k_h)` with `w_h = smoothstep(0.55, 1, luma)`.
8. `out = clamp(linearToSrgb(lin), 0, 1)`.

Grades implement the DESIGN.md §1.4.1 "Grade (LUT)" row:

| Grade | Intent (DESIGN §1.4.1) | T | N | contrast | saturation | shadowSat | slope RGB | offset RGB | power RGB | shadow tint (k_s) | highlight tint (k_h) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| day | neutral, sat +4 %, shadows lifted toward `#1C232C`, warm highlights | +0.02 | 0 | 1.05 | 1.04 | 1.0 | 1, 1, 1 | 0.004, 0.004, 0.006 | 1, 1, 1 | `#1C232C` (0.12) | `#FFF2DC` (0.06) |
| sunset | warm highlights, shadows desaturated blue-grey (not purple), sat +8 % | +0.18 | 0 | 1.10 | 1.08 | 0.75 | 1.04, 0.99, 0.95 | 0.004, 0.002, 0 | 0.98, 1.0, 1.03 | `#26303A` (0.15) | `#FFB070` (0.18) |
| night | high contrast, cool mids | −0.10 | 0 | 1.18 | 0.95 | 0.9 | 0.97, 1.0, 1.04 | 0, 0.002, 0.006 | 1.04, 1.02, 1.0 | `#0D1626` (0.15) | `#E8F0FF` (0.06) |
| overcast (rain) | sat −20 %, cool shift, contrast −10 %, blacks lifted | −0.08 | 0 | 0.90 | 0.80 | 1.0 | 1, 1, 1.01 | 0.015, 0.015, 0.017 | 1, 1, 1 | `#20262C` (0.10) | `#F0F2F4` (0.04) |

- Blending: parameters are interpolated, never the textures. `m = smoothstep(0.3, 0.9, cloud)`; day/sunset use `lerp(todGrade, overcast, m)`; night uses `lerp(night, overcast, 0.5·m)` but keeps night's `T`.
- Regenerate when `|Δm| ≥ 0.05`, at most once per second. `rig.lut` reports `'overcast'` when `m ≥ 0.5` and TOD is not night, else the TOD grade.
- Identity check: a unit test feeds neutral parameters and asserts every lattice point maps to itself within 1/255.

### 4.4 Lens droplets and heat haze (`ScreenDistortionEffect`)
- `src/graphics/post/lensFx.ts` renders a half-resolution `RGBA16F` distortion target each frame: RG = UV offset, B = droplet mask. The effect samples it: `uv2 = uv + off·0.03·mask`; `color = mix(input(uv), input(uv2)·1.04, mask)` plus a 2 % rim highlight.
- **Droplets** are analytic so `seek(t)` is deterministic (no per-frame state). Slot `k` of `N` cycles with period `P = life + gap`; spawn position, radius and life come from `hash(k, cycleIndex, sessionSeed)`. A slot is visible when its cycle is active and `hash01 < rate·P/N`.

| | cockpit, T-cam, nose | chase cams | TV, orbit, trailer |
|---|---|---|---|
| Slots `N` | 48 (Low 24) | 24 (Low 12) | 0 |
| Spawn rate | `rain · (12 + 20·spray)` drops/s | half | – |
| Radius | 0.012–0.035 of screen height | same | – |
| Life | 1.0–3.0 s, fade-out 0.4 s | same | – |
| Motion | < 80 km/h: slide down 0.02 screen/s; ≥ 80 km/h: streak radially outward at `0.15 + 0.6·smoothstep(80, 250, kmh)` screen/s (cockpit and nose only) | slide down only | – |

`spray = wetness · max over cars ahead (Δs < 40 m, |Δd| < 3 m) of (1 − Δs/40)`.
- **Heat haze** (only `lens: 'all'`, i.e. Ultra; only when `wetness < 0.1` and TOD is day or sunset): one sprite per visible car within 60 m, at the exhaust (model `(0, 0.55, −2.45)`), 1.6 × 1.0 m, strength 0.004 UV, noise scrolling at 1.5 Hz.

---

## 5. LightingRig values (the missing §8.10, referenced by report §7.12)

ÇEV ships these in `src/track/sky/rigs.ts` as `BASE_RIGS: Record<TimeOfDay, LightingRig>`. `buildEnvironment` copies the base rig for the session TOD into `envHandle.rig`, and `applyConditions()` rewrites that object in place from the base rig plus the modifiers in §5.3 (never cumulatively).

### 5.1 Sun direction convention
`sunDir` points **from the scene toward the light** (unit vector, world frame +X east, +Y up, +Z south). With azimuth `A` clockwise from north and elevation `e`: `sunDir = (sin A·cos e, sin e, −cos A·cos e)`.

### 5.2 Base rigs

| Field | day | sunset | night |
|---|---|---|---|
| `tod` | `'day'` | `'sunset'` | `'night'` |
| `sunDir` | `{ x: -0.196, y: 0.819, z: 0.539 }` (e 55°, A 200° SSW) | `{ x: -0.935, y: 0.105, z: -0.340 }` (e 6°, A 290° WNW) | `{ x: 0.117, y: 0.940, z: 0.321 }` (floodlight key, e 70°, A 160°) |
| `sunColor` | `0xfff4e5` (~5800 K) | `0xffb36b` (~3000 K) | `0xe8f0ff` (~6000 K, white floodlight key) |
| `sunIntensity` | 3.2 | 2.4 | 2.4 |
| `hemiSky` | `0xbcd8ff` | `0x8fa4d6` | `0xa8c4ff` (moon fill) |
| `hemiGround` | `0x6b5a45` | `0x5a3d2b` | `0x0d0c10` |
| `hemiIntensity` | 0.55 | 0.45 | 0.08 |
| `envIntensity` | 1.00 | 0.90 | 0.75 |
| `exposure` | 1.00 | 1.15 | 0.90 |
| `fogColor` | `0xd6d9d2` (thin warm haze) | `0xe7a77a` (warm, horizon) | `0x141a26` (thin cool haze) |
| `fogDensity` (FogExp2) | 0.00022 | 0.00030 | 0.00030 |
| `bloomIntensity` | 0.25 | 0.60 | 0.80 |
| `bloomThreshold` | 0.95 | 0.85 | 0.90 |
| `lut` | `'day'` | `'sunset'` | `'night'` |
| `shadows` | true | true | true |

Night extras (ÇEV constants, not rig fields): floodlight lightmap irradiance `FLOOD_GROUND_INTENSITY = 2.2` at lightmap value 1.0; lamp-head emissive 12; glow sprites 6 m, additive, intensity 2.5. At **sunset** the floodlights are on at 35 % (lightmap × 0.35, lamp heads × 0.5): twilight-race look.

Values follow DESIGN.md §1.4.1 (key colours, exposure, bloom, fog character). Night relies on the floodlight lightmap and emissive panels for brightness, so exposure stays at 0.90 as specified. Fog check (day): 500 m → 1 %, 2 km → 18 %, 4 km → 54 %. Heavy rain at day: 1 km → 42 %.

### 5.3 Overcast and rain modifiers (`applyConditions(c)`)
With `k = c.cloud` and `r = c.rain`, starting from the base rig every time:

| Field | Day / sunset | Night |
|---|---|---|
| `sunIntensity` | × `lerp(1, 0.25, k)` | × `lerp(1, 0.85, k)` (floodlights do not dim) |
| `sunColor` | mix toward `0xd8dde3` by `0.7·k` | unchanged |
| `hemiSky` | mix toward `0xa7b0ba` by `k` | mix toward `0x232a36` by `k` |
| `hemiIntensity` | × `lerp(1, 1.35, k)` | × `lerp(1, 1.15, k)` |
| `envIntensity` | × `lerp(1, 0.85, k)` | unchanged |
| `exposure` | × `lerp(1, 0.85, k)` (rain target 0.85) | unchanged |
| `fogDensity` | × `(1 + 1.0·k + 1.5·r)` | × `(1 + 0.6·k + 1.5·r)` |
| `fogColor` | mix toward `0x9aa1a8` by `k` (DESIGN rain fog) | mix toward `0x1a2029` by `k` |
| `bloomIntensity` | lerp toward 0.50 by `k` | lerp toward 0.80 by `k` (wet floodlight reflections) |
| `bloomThreshold` | lerp toward 0.90 by `k` | unchanged |
| `lut` | `'overcast'` when `smoothstep(0.3, 0.9, k) ≥ 0.5` | `'night'` |
| `shadows` | `k < 0.95`; `sun.shadow.intensity = lerp(1, 0.25, k)` | `true`, intensity × `lerp(1, 0.7, k)` |

`cloud` comes from `ConditionsFrame` (pit-weather.md §4.6). PLAN Ek B's rain rule ("cloud cover 1, sun × 0.25, fog increases") is the `k = 1` row.

---

## 6. Materials

Colours below are physical surface colours. Team colours come from `src/data/teams.ts`; compound stripe colours use the DESIGN.md compound tokens when defined (defaults in brackets).

| Material | three class | Parameters |
|---|---|---|
| Paint, gloss | `MeshPhysicalMaterial` | DESIGN §1.4.4: livery atlas `map`, ORM atlas, `roughness 0.35`, `metalness 0`, `clearcoat 1`, `clearcoatRoughness 0.03`, `envMapIntensity 1.0` |
| Paint, matte | `MeshPhysicalMaterial` | `roughness 0.62`, `metalness 0`, `clearcoat 0`, `sheen 0.15`, `envMapIntensity 0.6` (never mirror-like) |
| Paint, metallic | `MeshPhysicalMaterial` | `roughness 0.30`, `metalness 0.65`, `clearcoat 1`, `clearcoatRoughness 0.05`, `envMapIntensity 1.1`, base colour 10 % darker than the swatch, procedural flake normal 256² tiled 40× (`normalScale 0.15`, High/Ultra only) |
| Carbon, lacquered | `MeshPhysicalMaterial` | albedo `0x121417` / `0x1b1e22` twill, procedural 2×2 twill normal 256² (one repeat per 0.08 m), `roughness 0.32`, `metalness 0`, `clearcoat 0.85`, `clearcoatRoughness 0.06`, `envMapIntensity 0.9` |
| Carbon, raw (floor, plank, diffuser) | `MeshStandardMaterial` | `color 0x0f1011`, `roughness 0.62`, `metalness 0.1`, twill normal × 0.5 |
| Tyre rubber | `MeshStandardMaterial` | `color 0x18181a`, `roughness 0.85` (wet 0.45), `envMapIntensity 0.4`; sidewall strip atlas 1024 × 128: "ORBIS" in white Barlow Condensed 700 and a compound band per instance (S `#E8202A`, M `#F2C200`, H `#EDEFF2`, I `#2DB55A`, W `#2F6FE8`, DESIGN §1.4.4); inter/wet tread groove normal maps |
| Rim | `MeshStandardMaterial` | `color 0x26272b`, `metalness 0.9`, `roughness 0.38`; per-instance stripe tint = team secondary; radial-blur variant crossfaded by `aBlur` |
| Brake disc + caliper | `MeshStandardMaterial` (instanced) | `color 0x2b2b2b`, `roughness 0.8`; emissive ramp from `brakeGlow g`: 0 → `0x5a0a00` (g 0.3) → `0xff3a00` (0.7) → `0xffa040` (1.0); `emissiveIntensity = 6·g²` |
| Metal (exhaust, fasteners) | `MeshStandardMaterial` | exhaust `0x8a6a4f`, `metalness 1`, `roughness 0.35`, heat-tint gradient; fasteners `0x9a9ea3`, `roughness 0.4` |
| Visor | `MeshPhysicalMaterial` | `color 0x0b0e12`, `metalness 0.3`, `roughness 0.08`, `iridescence 0.6` (High/Ultra, else 0), opaque |
| Glass (T-cam lens, light covers) | `MeshPhysicalMaterial` | transparent, `opacity 0.35`, `roughness 0.05`, no transmission |
| Mirror surface | `MeshBasicMaterial` with the mirror RT (`low30`/`high60`), else `MeshStandardMaterial metalness 1 roughness 0.05` |
| Rain light | `MeshBasicMaterial` `0xff1a1a`, HDR intensity uniform: off 0.05, on 4.0, flash = on/off square wave 4 Hz, phase offset `0.07·carId` s |
| Steering-wheel display | `MeshBasicMaterial`, 256 × 128 canvas (gear, 15 LEDs), redrawn at 10 Hz only for the player in cockpit view |
| Ghost | `ShaderMaterial`: fresnel rim in team primary, `opacity = ghostAlpha`, `transparent`, `depthWrite false`, no shadows |

**Wet car** (Sprint 2, `wetness > 0.2`): paint and carbon `roughness × 0.7`, `clearcoatRoughness 0.02`, a procedural rain-bead normal detail (256², dots) mixed on up-facing surfaces (`normal.y > 0.5`) via `onBeforeCompile`; tyres `roughness 0.45`.

**Track materials** (ÇEV) follow report §7.13 for wetness (`uWet`, `uLineWet`, `uRain`, `uTime`, racing-line 1D texture) and sample the floodlight lightmap at night.

---

## 7. The car model

### 7.1 Parts and triangle targets

| Part | LOD0 | LOD1 | LOD2 | Material |
|---|---|---|---|---|
| Survival cell, nose, cockpit rim | 7,500 | 2,000 | 500 | paint |
| Front wing: 4 elements, endplates, nose pylons | 5,500 | 1,400 | 300 | paint / carbon |
| Front suspension (wishbones, pushrods, track rods) | 2,000 | 400 | – | carbon / trim |
| Rear suspension | 2,000 | 400 | – | carbon / trim |
| Halo | 1,200 | 300 | 80 | paint |
| Driver: helmet, visor, torso, arms, gloves | 4,000 | 900 | 150 | paint atlas / visor |
| Steering wheel with display | 1,000 | – | – | carbon / emissive |
| Sidepods with undercut, inlets, louvres | 6,000 | 1,600 | 400 | paint |
| Engine cover, shark fin, T-cam, airbox | 4,300 | 1,100 | 250 | paint |
| Floor, edge wings, diffuser, plank | 5,500 | 1,200 | 250 | raw carbon |
| Rear wing: main plane, DRS flap, endplates, beam wing, swan-neck pylon | 4,500 | 1,200 | 250 | paint / carbon |
| Mirrors (housing + glass) × 2 | 1,000 | 200 | – | paint / mirror |
| Vanes, front and rear brake ducts | 2,500 | 400 | – | carbon |
| Exhaust, rain light, rear crash structure | 800 | 200 | 60 | trim / emissive |
| Antennas, pitot, camera pods | 200 | – | – | trim |
| **Body** | **48,000** | **12,300** | **2,240** | |
| Wheels × 4 (tyre 1,500 + rim 1,000 + disc/caliper/upright 500 each; LOD1 600, LOD2 160 each) | 12,000 | 2,400 | 640 | instanced |
| **Car total** | **60,000** | **14,700** | **2,880** | PLAN: ≤ 60k / 15k / 3k |

### 7.2 Model space and dimensions (must match physics §5.3)
Origin = ground point under the centre of gravity; +Z forward, +Y up, +X left; world matrix `makeBasis(left, up, fwd).setPosition(p)`.

| Item | Value (m) |
|---|---|
| Front axle z / rear axle z | +1.962 / −1.638 (wheelbase 3.600) |
| Wheel centres x (front / rear), y | ±0.800 / ±0.775, 0.360 |
| Tyre width front / rear | 0.305 / 0.405 |
| Nose tip z / rear-wing trailing edge z | +3.05 / −2.55 (length 5.60) |
| Overall width | 2.00 |
| Plank bottom / sidepod top / halo top / airbox top / T-cam top / rear-wing top / front-wing top | 0.03 / 0.58 / 0.82 / 0.96 / 1.02 / 0.95 / 0.30 |
| Driver eye | (0, 0.77, +0.36) |
| Exhaust / rain light | (0, 0.55, −2.45) / (0, 0.40, −2.50) |
| DRS flap pivot | leading edge of the flap, y 0.86, z −2.42; opens 0.55 rad × `drsFlap` |

### 7.3 LOD selection
- Effective distance `dEff = distance(camera, car) · clamp(camera.fov / 65, 0.25, 1.5)` (TV zoom keeps detail).
- `QualityPreset.carLod = [lod0Max, lod1Max, visibleMax]`: LOD0 below `lod0Max`, LOD1 below `lod1Max`, LOD2 below `visibleMax`, hidden beyond (except player and ghost).
- Hysteresis: moving to a finer LOD requires `dEff < threshold · 0.9`.
- LOD0 cap: at most 4 cars (Ultra 6) at LOD0, the nearest ones; others fall back to LOD1. The player car is always LOD0 in driving views. The ghost always uses LOD1.

### 7.4 Draw-call strategy (20 cars)
- **LOD0 body: 6 draws** (paint, carbon, trim, visor + glass, emissive, mirrors). Animated sub-parts (DRS flap, steering wheel, hands) stay inside the merged meshes and are rotated in the vertex shader by a per-vertex `aPart` id with uniforms `uDrs`, `uSteer`. If this proves impractical, separate meshes are allowed up to the PLAN cap of **8**.
- **LOD1: 3 draws** (paint incl. glass painted dark in the atlas, carbon + trim with vertex colours, emissive).
- **LOD2: 1 draw for all cars**: one `InstancedMesh` (2,240-tri body), livery from a `DataArrayTexture` (one 256² layer per car), per-instance `aLayer`, `aRain`.
- **Wheels: 9 draws for all cars**: per LOD, 3 `InstancedMesh`es (tyre, rim, disc/caliper/upright), 80 instances each. Per-instance attributes: `aCompound` (0–4, stripe colour from a uniform table), `aGlow`, `aBlur` (rim blur crossfade when `ω·R > 25 m/s`), `aTint`. Matrices = car matrix × wheel local (steer on fronts, spin about the axle, `susp[i]` vertical offset).
- **Blobs: 1 draw** (§3.3).
- Worst case (grid start): 4 × 6 + 16 × 3 + 1 + 9 + 1 = **83 main-pass draws** (budget 90); shadow pass ≤ 75.
- **Livery atlases:** one canvas per car (numbers and T-cam colour differ per driver): 1024² on High/Ultra (player 2048²), 512² on Low/Medium. Content follows DESIGN.md §1.4.2 exactly: zones, coverage (primary ≥ 50 %, secondary 20–40 %, accent ≤ 10 %), 12° rising sweeps, one signature motif and the title sponsor from its team table, hard-edged splits (no gradients), exposed carbon zones identical on all teams, numbers in Barlow Condensed 800 on nose top, fin and front-wing endplate (white or ink, ≥ 4.5:1). Sponsor wordmarks use the DESIGN §1.4.3 display strings (pre-composed case). T-cam black (driver 1) / yellow (driver 2). Fonts must be loaded (`AssetLoader.font`) before drawing.

### 7.5 Animation channels (from `CarRenderState`)
- Front wheels steer by `steerAngle` (Ackermann 0.3 visually). Steering wheel turns `steerAngle × 8` (max ≈ 176°). Driver head yaw `clamp(0.6·steerAngle, ±0.25 rad)`.
- Wheel rotation = `wheelSpin[i]` (accumulated angle, rad); suspension = `susp[i]` (m).
- DRS flap = `drsFlap`; brake glow per wheel; rain light per `rainLight`.
- `setCockpitCar(id)`: hides that car's helmet and head; keeps halo, steering wheel, hands, mirrors, nose, front wing and wheels.

### 7.6 Mirrors
- `static`: env reflection only.
- `low30`: one `HalfFloat` RT 768 × 192 shared by both mirrors (left/right halves), rendered at 30 Hz. `high60`: 1024 × 256 at 60 Hz.
- Mirror pass: layer 1 only (cars at LOD1/LOD2, track ribbon, barriers, sky), no shadows, no post, vertical FOV 30°, from each mirror toward the rear. Rendered only when the view is `cockpit`.

---

## 8. VFX

### 8.1 Particle engine
- `src/graphics/vfx/particlePool.ts`: one `InstancedBufferGeometry` per family. Per-instance attributes: spawn position, initial velocity, birth time, life, size start/end, colour/alpha, rotation, flipbook offset, ground y.
- Motion is analytic in the vertex shader: `p(t) = p0 + v0·(1 − e^(−k·t))/k + ½·g·t²`, with drag `k` and gravity `g` per family. The CPU only writes newly spawned slots in a ring, uploaded with `attribute.addUpdateRange()`. No per-frame CPU integration and no allocation.
- Emission randomness comes from a hash of (car id, wheel, emission counter), so replays and the trailer are reproducible.
- Soft particles (Medium+): fragment alpha × `smoothstep(0, fadeDist, sceneDepth − particleDepth)` using the `DepthCopyPass` texture. Low uses hard particles plus a 0.5 m near-camera fade.
- Textures are generated at init, never downloaded: smoke flipbook 512² (4 × 4 noise puffs), spray flipbook 256² (2 × 2), spark streak 64 × 16 gradient, droplet normal 128².

### 8.2 Families

| Family | Trigger | Rate | Life | Size | Look | Draws |
|---|---|---|---|---|---|---|
| **Tyre smoke** | `slip[i] > 1.15`, speed > 5 km/h, hard surface (asphalt, line, kerbs, run-off, pit, concrete), `wetness < 0.2` | 45/s per wheel × `clamp((slip − 1.15)/0.6, 0, 1)` | 1.2–2.8 s | 0.5 → 3.2 m | `0xdedede` × hemi light, alpha 0.32 → 0 ease-out; v0 = 0.3 × car velocity + 0.6 m/s up; drag 1.6/s; soft fade 0.6 m | 1 |
| **Sparks** | `sparks > 0` (cars within 120 m); `collision` event with impulse > 2,000 N·s → burst of 40 at the contact point | `400 · sparks` per car | 0.15–0.45 s | streak, length = speed × 0.025 s, width 0.02 m | HDR `0xfff1c0` × 8 → `0xff8a2a` × 3 → 0; v0 = 0.85 × car velocity + cone ±25°, 0.5–2.5 m/s up; gravity 9.81; one ground bounce (restitution 0.3); emitted under the plank at model x ±0.3, z −0.6…+1.2; × 0.5 in the wet | 1 |
| **Dust** | wheel on `gravel` or `grass`, speed > 15 km/h | 30/s per wheel × `min(1, kmh/80)` | 1.5–2.5 s | 0.8 → 3.0 m | gravel `0xa08f78`, grass `0x8a8a5c`; settles (g = −0.3); wet: mud spray `0x5a4a3a`, life 0.8 s, 0.4 → 1.2 m; Ultra adds ≤ 64 instanced stones (ballistic, 1 s) | 1 |
| **Skid marks** | `slip[i] > 1.2` or wheel locked, hard surface, `wetness < 0.3` | a quad every 0.5 m travelled or 3° heading change | ring buffer | 0.30 m front / 0.38 m rear | `0x0a0a0a` multiply, alpha `0.55·clamp((slip − 1.2)/0.5, 0.25, 1)`, y = ground + 0.012 m, `polygonOffset −1/−1`; oldest 15 % of the ring fade out; on flashback quads born after the restore time are removed | 1 |
| **Rain streaks** | `rain > 0.02` | count = `round(rainStreaks · rain)` | endless (wrapping) | width 0.012 m, length = relative speed × 1/60 s, clamped 0.15–1.8 m | camera-local box 40 × 22 × 40 m centred 4 m ahead; positions from instance hash, fall 9 m/s, wrap in the shader; oriented along (fall − camera velocity); alpha 0.28·rain; brightness day 0.8 / sunset 0.7 / night 0.45 | 1 |
| **Tyre spray** | `wetness > 0.1` and speed > 50 km/h (> 30 km/h when W > 0.6) | car budget `sprayPerCar` live particles; rear tyres 60 %, fronts 0 % | 0.6–1.2 s | 0.8 → 4.5 m | `0xd5dbe2` lit, alpha 0.20 → 0; v0 = 0.6 × car velocity ± 1.5 m/s lateral + 1–2.5 m/s up; intensity `wetness^0.8 · smoothstep(50, 250, kmh)` | 1 (shared by all cars) |
| **Rooster tail** | as spray | 40 % of the car's spray budget | 0.8–1.4 s | 1.2 → 6.0 m | from the diffuser (model (0, 0.25, −2.3)), v0 = 0.75 × car velocity + 2.5–5 m/s up, cone 10°; plume 15–30 m long at 300 km/h | (same pool) |

Distance LOD for spray and rooster tail: none beyond 250 m from the camera, 50 % rate between 120 and 250 m.

**Sparks trigger (SÜR, sim, 60 Hz):** `vehicle.sparks = clamp((kmh − 180)/100, 0, 1) · bottom`, smoothed with τ = 0.1 s, where `bottom = 1` when the vertical compression `vCurvature·v² > 4 m/s²`, or a `kerbSausage` contact happens above 120 km/h, else 0. ÇEV places a 25 mm bump in `bumpAmp` at T8 middle apex (s ≈ 2,392 ± 15 m) so sparks appear there at speed.

### 8.3 Pools per preset

| | Low | Medium | High | Ultra |
|---|---|---|---|---|
| Smoke pool (`smokeMax`) | 256 | 512 | 1,024 | 2,048 |
| Sparks pool (`smokeMax / 2`) | 128 | 256 | 512 | 1,024 |
| Dust pool (`smokeMax / 2`) | 128 | 256 | 512 | 1,024 |
| Skid quads (`skidQuads`) | 1,000 | 2,000 | 4,000 | 8,000 |
| Rain streaks at rain = 1 (`rainStreaks`) | 2,000 | 4,000 | 8,000 | 12,000 |
| Spray per car (`sprayPerCar`) | 24 | 48 | 96 | 160 |
| Soft particles | no | yes | yes | yes |
| Heat haze / gravel stones | no | no | no | yes / 64 |

VFX total: ≤ 7 draw calls in the worst case (smoke, sparks, dust, skids, streaks, spray, lens pass).

---

## 9. Cameras

`src/graphics/camera/`. Views are `ViewId = CameraId | 'tv' | 'orbit' | 'free' | 'trailer'` (CR-02). `C` cycles the 5 driving cameras only. The default view comes from `settings.camera.default` (default `chaseNear`).

### 9.1 Driving cameras

| View | Position (model space, m) | Aim | Base FOV (vertical) | Damping | Notes |
|---|---|---|---|---|---|
| `cockpit` | eye (0, 0.77, +0.36) + head offset | forward, pitch −3.5° | 75 | head spring ω = 12 rad/s, ζ = 1 | near 0.05 m; halo and steering wheel visible; `setCockpitCar(player)` |
| `tcam` | (0, 1.05, −0.12) | forward, pitch −5° | 70 | rigid to chassis | near 0.05 m |
| `nose` | (0, 0.62, +1.55) | forward, pitch −2° | 72 | rigid to chassis | |
| `chaseNear` | 6.5 m behind, 2.0 m above (along smoothed heading) | car + fwd·2.0 + up·0.8 | 65 | position ω = 9, heading ω = 5.5, vertical ω = 6 | heading target = yaw + 0.35·β (sideslip, when > 10 m/s) |
| `chaseFar` | 9.5 m behind, 3.0 m above | car + fwd·3.0 + up·1.0 | 62 | position ω = 7, heading ω = 4.5, vertical ω = 6 | same rule |

- Chase cameras use critically damped springs (ζ = 1) and never go below `car.y + 1.2 m`.
- **Head motion (cockpit):** lateral `x = clamp(−aLat/g · 0.010, ±0.04) m`; longitudinal `z = clamp(−aLong/g · 0.012, ±0.05) m`; pitch `−aLong/g · 0.6°`; roll `−aLat/g · 0.5°`; off when `motionEffects` is false.
- **Speed FOV:** `ΔFOV = 6° · smoothstep(80, 300, kmh)` (+6° at 300 km/h, PLAN), smoothed τ = 0.35 s; cockpit uses 0.6 × ΔFOV; off when `motionEffects` is false. Final FOV = base + `settings.graphics.fovOffset` + ΔFOV, clamped to 40°–100°.
- **Look-back (V held):** cockpit/T-cam/nose → camera at (0, 1.15, −0.30) facing backward, pitch −6°, FOV 70. Chase → mirrored in front of the car at the same distance and height, looking back at it. Instant cut in and out; no speed FOV while looking back.

### 9.2 Shake (all × `settings.graphics.cameraShake`; chase cams × 0.5; deterministic value noise over time)

| Source | Position amp (m) | Rotation amp (°) | Frequency | Decay | Views |
|---|---|---|---|---|---|
| Flat kerb (`kerb` event) | 0.003 | 0.25 | 22 Hz | τ 0.15 s | driving |
| Sausage kerb | 0.010 | 0.8 | 16 Hz | τ 0.25 s | driving |
| Grass / gravel (continuous) | 0.006 × min(1, v/30) | 0.4 × min(1, v/30) | 12–18 Hz noise | – | driving |
| Collision | `min(0.03, impulse / 4e5)` | × 20 | 10 Hz | τ 0.4 s | driving |
| High-speed buffet | 0.0012 · smoothstep(200, 330, kmh) | 0.06 · same | 28 Hz noise | – | cockpit, tcam, nose |
| Bottoming (`sparks > 0.5`) | 0.004 | 0.3 | 30 Hz | τ 0.1 s | cockpit, tcam |

### 9.3 Spectator and authored cameras

| View | Rule |
|---|---|
| `tv` | 24 auto spots, one every ≈ 220 m on the outside of the local curvature at `d = ±(halfWidth + 30 m)`, 8 m high, plus 3 hero spots: T1 grandstand (s 250, d −60, h 15), T8 outside (s 2,400, d −55, h 12), T12 (s 4,666, d +40, h 10). Choose the spot whose s lies in [car s − 120, car s + 80]; switch when the car is 60 m past it or more than 160 m away. FOV = `clamp(2·atan(6/dist), 6°, 45°)`; aim ω = 3, FOV ω = 2. Used after the player finishes or retires, in results backgrounds and the trailer |
| `orbit` | distance 4–30 m (default 9), pitch 5°–60°; keyboard: arrows rotate 60°/s, W/S zoom; sandbox may add mouse drag. **Showroom** (DESIGN §1.4.5): fixed 3/4-front camera, eye height 1.1 m, FOV 32°, car centred at x ≈ 62 % of the screen; turntable 6°/s, static 3/4 pose under reduced motion; key softbox front-left 5600 K, cool rim right 7000 K, overhead strip light |
| `free` | debug and sandbox: WASD move, R/F up/down, arrows look, Shift × 4; 20 m/s |
| `trailer` | `CameraRig.setOverride(pose)` from the trailer timeline: centripetal Catmull-Rom through keyed positions and targets, keyed FOV and roll (≤ 2°), handheld noise = 3 sine octaves (0.7, 1.9, 4.3 Hz; 0.03 / 0.012 / 0.004 m) × a keyed `shake`. Evaluated purely from `seek(t)` |

### 9.4 Listener
`getListener(out)`: camera world position and basis; velocity = finite difference of camera position smoothed with τ = 0.1 s; `camera` = current driving view (interior audio only for `cockpit`).

---

## 10. `QualityPreset` table (`src/graphics/presets.ts`, `QUALITY_PRESETS`)

Every contract field, all four presets. Fields not owned by GRA (densities, grass) are consumed by ÇEV.

| Field | Low | Medium | High | Ultra |
|---|---|---|---|---|
| `id` | `'low'` | `'medium'` | `'high'` | `'ultra'` |
| `renderScale` | 0.75 | 0.9 | 1.0 | 1.0 |
| `aa` | `'fxaa'` | `'smaa'` | `'smaa'` | `'smaa'` |
| `smaa` | `'MEDIUM'` (unused) | `'MEDIUM'` | `'HIGH'` | `'ULTRA'` |
| `shadowSize` | 1024 | 2048 | 2048 | 4096 |
| `shadowExtent` | 35 | 55 | 70 | 90 |
| `shadowRadius` | 1 | 2 | 3 | 4 |
| `ao` | `'off'` | `'off'` | `'half'` | `'full'` |
| `bloom` | false | true | true | true |
| `lut` | false | true | true | true |
| `lens` | `'droplets'` | `'dropletsCA'` | `'dropletsCA'` | `'all'` (droplets + CA + heat haze) |
| `envSize` | 128 | 256 | 256 | 512 |
| `anisotropy` | 2 | 4 | 8 | 16 |
| `carLod` | [15, 80, 600] | [25, 100, 800] | [30, 120, 1000] | [45, 160, 1500] |
| `mirrors` | `'static'` | `'static'` | `'low30'` | `'high60'` |
| `treeDensity` | 0.35 | 0.6 | 1.0 | 1.3 |
| `crowdDensity` | 0.3 | 0.6 | 1.0 | 1.0 |
| `grassCards` | 0 | 12,000 | 30,000 | 60,000 |
| `rainStreaks` | 2,000 | 4,000 | 8,000 | 12,000 |
| `sprayPerCar` | 24 | 48 | 96 | 160 |
| `smokeMax` | 256 | 512 | 1,024 | 2,048 |
| `skidQuads` | 1,000 | 2,000 | 4,000 | 8,000 |
| `far` | 1,800 | 2,500 | 3,500 | 4,500 |

Derived values (constants keyed by `id`, not contract fields):

| Derived | Low | Medium | High | Ultra |
|---|---|---|---|---|
| Bloom levels | – | 5 | 6 | 7 |
| N8AO | – | – | half, 16 / 8 samples | full, 32 / 8 samples |
| Livery atlas per car (player) | 512 (1024) | 512 (1024) | 1024 (2048) | 1024 (2048) |
| Mirror RT | – | – | 768 × 192 @ 30 Hz | 1024 × 256 @ 60 Hz |
| Lens droplet slots (cockpit / chase) | 24 / 12 | 48 / 24 | 48 / 24 | 48 / 24 |
| Grass-card ring radius | – | 80 m | 100 m | 150 m |
| Shadow casters | cars | + trees, stands | + gantries, buildings, posts | + barriers, fences, poles |
| Visor iridescence | off | off | on | on |

`settings.graphics.custom` may override any field; the settings screen exposes the subset in ui-hud.md §7.

---

## 11. Performance budgets and FPS protocol

### 11.1 GPU budget per pass (1080p, RTX 4060 Laptop, race start, 20 cars)

| Pass | High (ms) | Ultra (ms) |
|---|---|---|
| Shadow map | 1.5 | 2.5 |
| Main render (env + cars) | 4.5 | 7.0 |
| Depth copy + FX pass | 0.8 | 1.2 |
| N8AO | 1.2 | 3.0 |
| Bloom | 0.5 | 0.7 |
| EffectPass A (SMAA, exposure, AgX, LUT, vignette) | 0.6 | 0.9 |
| CA + lens/heat haze | 0.3 | 0.5 |
| **Total** | **≈ 9.4 (≈ 106 fps)** | **≈ 15.8 (≈ 63 fps)** |

Draw-call, triangle, program and CPU budgets: ARCHITECTURE §12. Night + heavy rain on Ultra adds rain streaks, spray and floodlight sprites and must stay ≥ 50 fps (≤ 20 ms).

### 11.2 FPS measurement protocol (`scripts/perf.mjs`, Testçi)
1. **Machine:** on AC power, Windows power mode "Best performance", Chrome assigned the high-performance GPU in Windows graphics settings, no other heavy processes. Close other headed browsers.
2. **Browser:** system Chrome via Playwright, **headed**, flags `--use-angle=d3d11 --ignore-gpu-blocklist --force-device-scale-factor=1 --window-size=1920,1080 --window-position=0,0 --disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows`; viewport 1920 × 1080.
3. **Validity:** read `__APEX__.gpu`; it must contain the discrete GPU name (`NVIDIA`, `RTX 4060`). Otherwise the run is marked `valid: false` and does not count.
4. **Scenarios** (all with `seed=4242&ai=19&laps=3&autodrive=1&autostart=1&skipLights=1&cam=chaseNear&quality=<preset>`):
   - A: `tod=day&weather=dry`;
   - B: `tod=sunset&weather=light`;
   - C (worst case): `tod=night&weather=heavy`.
5. **Run:** wait for `whenReady('sceneReady')`, warm up 10 s, `resetPerf()`, sample 30 s, read `getPerf()`. Cool down 20 s between runs. Run every scenario twice and keep the lower FPS.
6. **Output:** `test-results/perf/<yyyymmdd-hhmm>-<preset>-<scenario>.json` with `{ preset, scenario, url, gpu, valid, fps, frameMsAvg, frameMsP95, frameMsMax, hitches, simOverrun, renderer: { calls, triangles, geometries, textures, programs }, heapMB }` and a summary table in `docs/qa/test-perf.md`.
7. **Gates:** Ultra A ≥ 60 fps, High A ≥ 100 fps, Ultra C ≥ 50 fps; p95 and draw/triangle budgets per ARCHITECTURE §12; `simOverrun = 0`; `hitches = 0` after warm-up.
