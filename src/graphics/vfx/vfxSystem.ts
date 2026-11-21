// VfxSystem (docs/design/rendering.md §8): tyre smoke (soft particles), titanium sparks (HDR streaks), gravel/grass
// dust, skid marks and (G6) rain: streaks, tyre spray and rooster tails in one shared pool. Pools are sized from
// the QualityPreset. Emission randomness comes from a hash of (car id, wheel, emission counter), so replays and
// the trailer reproduce. Every VFX program is compiled at init (no new programs when the rain starts).

import { type Camera, CanvasTexture, Color, LinearFilter, type Object3D, LinearMipmapLinearFilter, Matrix4, NormalBlending, type PerspectiveCamera, SRGBColorSpace, Vector2, Vector3 } from 'three';
import type { QualityPreset, RenderContext, RenderFrame, VfxSystem } from '../../contracts/render';
import type { SimEvent } from '../../contracts/sim';
import type { SurfaceType } from '../../contracts/common';
import type { LightingRig } from '../../contracts/environment';
import { attachSubsystem, detachSubsystem, graphicsFor } from '../renderer/registry';
import { PRESET_DERIVED } from '../presets';
import { ParticlePool } from './particlePool';
import { createRainStreaks, type RainStreaks } from './rainStreaks';
import { SkidMarks } from './skidMarks';

const HARD = new Set<SurfaceType>(['asphalt', 'line', 'kerbFlat', 'kerbSausage', 'runoffAsphalt', 'pitAsphalt', 'concrete']);
const WHEELS: readonly [number, number][] = [[0.8, 1.962], [-0.8, 1.962], [0.775, -1.638], [-0.775, -1.638]];
const MAX_CARS = 32;
/** Spray pool = sprayPerCar × this many cars (the grid). */
const SPRAY_CARS = 20;
const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export interface VfxSystemImpl extends VfxSystem {
  setQuality(q: QualityPreset): void;
  /** Flashback / session reset: removes every particle and skid quad. */
  clear(): void;
  counts(): { smoke: number; sparks: number; dust: number; skids: number; spray: number; rain: number };
  /** Sandbox/test inspection. */
  debugPools(): { smoke: ParticlePool | null; sparks: ParticlePool | null; dust: ParticlePool | null; spray: ParticlePool | null };
}

/** Deterministic hash → [0, 1). */
function h01(a: number, b: number, c: number): number {
  let x = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35) ^ Math.imul(c + 0x27d4eb2f, 0x165667b1);
  x ^= x >>> 15;
  x = Math.imul(x, 0x2c1b3c6d);
  x ^= x >>> 12;
  return (x >>> 0) / 4294967296;
}

/** Smoke flipbook 512² (4×4 soft noise puffs), white with alpha. */
function smokeFlipbook(): CanvasTexture {
  const size = 512;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, size, size);
  const cell = size / 4;
  for (let k = 0; k < 16; k++) {
    const cx = (k % 4) * cell + cell / 2;
    const cy = Math.floor(k / 4) * cell + cell / 2;
    // QC2-10: a broad gaussian-like base plus faint detail puffs, all inside the cell (r + rr <= 0.4 cell): sprites
    // blend into each other instead of reading as separate discs, and none is ever clipped to a hard edge.
    const base = g.createRadialGradient(cx, cy, 0, cx, cy, cell * 0.46);
    base.addColorStop(0, 'rgba(235,235,235,0.55)');
    base.addColorStop(0.45, 'rgba(235,235,235,0.3)');
    base.addColorStop(1, 'rgba(235,235,235,0)');
    g.fillStyle = base;
    g.fillRect(cx - cell / 2, cy - cell / 2, cell, cell);
    for (let j = 0; j < 10; j++) {
      const a = h01(k, j, 1) * Math.PI * 2;
      const r = h01(k, j, 2) * cell * 0.16;
      const rr = cell * (0.1 + 0.12 * h01(k, j, 3));
      const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
      const grd = g.createRadialGradient(x, y, 0, x, y, rr);
      const v = Math.round(200 + 55 * h01(k, j, 4));
      grd.addColorStop(0, `rgba(${v},${v},${v},0.12)`);
      grd.addColorStop(1, `rgba(${v},${v},${v},0)`);
      g.fillStyle = grd;
      g.beginPath();
      g.arc(x, y, rr, 0, Math.PI * 2);
      g.fill();
    }
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.minFilter = LinearMipmapLinearFilter;
  t.magFilter = LinearFilter;
  return t;
}

/** Spray flipbook 256² (4×4 cells): soft round mist blobs that fade to 0 well inside each cell (no square edges). */
function sprayFlipbook(): CanvasTexture {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, size, size);
  const cell = size / 4;
  for (let k = 0; k < 16; k++) {
    const cx = (k % 4) * cell + cell / 2;
    const cy = Math.floor(k / 4) * cell + cell / 2;
    for (let j = 0; j < 10; j++) {
      const a = h01(k, j, 11) * Math.PI * 2;
      const r = h01(k, j, 12) * cell * 0.14;
      const rr = cell * (0.14 + 0.16 * h01(k, j, 13));
      const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
      const grd = g.createRadialGradient(x, y, 0, x, y, rr);
      grd.addColorStop(0, 'rgba(255,255,255,0.30)');
      grd.addColorStop(0.6, 'rgba(255,255,255,0.12)');
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd;
      g.beginPath();
      g.arc(x, y, rr, 0, Math.PI * 2);
      g.fill();
    }
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.minFilter = LinearMipmapLinearFilter;
  t.magFilter = LinearFilter;
  return t;
}

export function createVfx(): VfxSystemImpl {
  let ctx: RenderContext | null = null;
  let q: QualityPreset | null = null;
  let smoke: ParticlePool | null = null;
  let sparks: ParticlePool | null = null;
  let dust: ParticlePool | null = null;
  let skids: SkidMarks | null = null;
  let spray: ParticlePool | null = null;
  let rain: RainStreaks | null = null;
  const sprayAcc = new Float32Array(MAX_CARS * 2);
  const sprayCounter = new Uint32Array(MAX_CARS);
  let tex: CanvasTexture | null = null;
  let sprayTex: CanvasTexture | null = null;
  let time = 0;
  // Per car/wheel emission accumulators, counters and skid anchors (flat arrays, no allocation per frame).
  const acc = new Float32Array(MAX_CARS * 4 * 3);
  const counter = new Uint32Array(MAX_CARS * 8);
  const skidLast = new Float32Array(MAX_CARS * 4 * 4); // x, y, z, valid
  const sparkAcc = new Float32Array(MAX_CARS);
  const m = new Matrix4(), vL = new Vector3(), vU = new Vector3(), vF = new Vector3(), w = new Vector3(), camPos = new Vector3();
  const res = new Vector2();
  const tint = new Color(), tint2 = new Color();
  const counts = { smoke: 0, sparks: 0, dust: 0, skids: 0, spray: 0, rain: 0 };
  // Pending collision bursts (copied from events: the event objects are pooled).
  const burst = new Float32Array(16 * 4);
  let bursts = 0;

  const pools: ParticlePool[] = [];

  const build = (): void => {
    if (!ctx || !q) return;
    const root = graphicsFor(ctx.renderer)?.post.fxScene ?? ctx.scene;
    smoke?.dispose();
    sparks?.dispose();
    dust?.dispose();
    skids?.dispose();
    spray?.dispose();
    rain?.dispose();
    tex ??= smokeFlipbook();
    smoke = new ParticlePool({ name: 'smoke', max: q.smokeMax, kind: 'billboard', drag: 1.6, gravity: -0.15, map: tex, blending: NormalBlending, softFade: 0.6, bounce: 0, stretch: 0.04 });
    dust = new ParticlePool({ name: 'dust', max: q.smokeMax / 2, kind: 'billboard', drag: 1.2, gravity: 0.3, map: tex, blending: NormalBlending, softFade: 0.6, bounce: 0, stretch: 0.03 });
    sparks = new ParticlePool({ name: 'sparks', max: q.smokeMax / 2, kind: 'streak', drag: 0.4, gravity: 9.81, map: null, blending: NormalBlending, softFade: 0.2, bounce: 0.3 });
    skids = new SkidMarks(q.skidQuads);
    // Spray + rooster tails: one pool for every car; lit mist #d5dbe2, soft fade 1 m.
    sprayTex ??= sprayFlipbook();
    spray = new ParticlePool({ name: 'spray', max: q.sprayPerCar * SPRAY_CARS, kind: 'billboard', drag: 1.1, gravity: 1.4, map: sprayTex, blending: NormalBlending, softFade: 1.0, bounce: 0, nearFade: [1.5, 7] });
    rain = createRainStreaks(q.rainStreaks);
    rain.mesh.layers.enable(2);
    root.add(rain.mesh);
    pools.length = 0;
    pools.push(smoke, dust, sparks, spray);
    for (const p of pools) {
      p.mesh.layers.enable(2);
      root.add(p.mesh);
    }
    ctx.scene.add(skids.mesh);
    acc.fill(0);
    skidLast.fill(0);
    sprayAcc.fill(0);
    // Compile every VFX program now, into the post chain's linear target (no hitch when rain or sparks start).
    const sys = graphicsFor(ctx.renderer)?.system as { warmup?: (s: Object3D, c: Camera) => Promise<void> } | undefined;
    if (sys?.warmup) void sys.warmup(root, ctx.camera);
  };

  const sys: VfxSystemImpl = {
    init(c) {
      ctx = c;
      q = c.quality;
      build();
      attachSubsystem(c.renderer, 'vfx', sys);
    },
    setQuality(nq) {
      if (q && nq.smokeMax === q.smokeMax && nq.skidQuads === q.skidQuads && nq.rainStreaks === q.rainStreaks && nq.sprayPerCar === q.sprayPerCar) {
        q = nq;
        return;
      }
      q = nq;
      build();
    },
    clear() {
      smoke?.clear();
      sparks?.clear();
      dust?.clear();
      skids?.clear();
      spray?.clear();
      skidLast.fill(0);
      sprayAcc.fill(0);
    },
    counts: () => counts,
    debugPools: () => ({ smoke, sparks, dust, spray }),
    onSimEvent(e: SimEvent) {
      if (e.type === 'collision' && e.impulse > 2000 && bursts < 16) {
        burst[bursts * 4] = e.x;
        burst[bursts * 4 + 1] = e.y;
        burst[bursts * 4 + 2] = e.z;
        burst[bursts * 4 + 3] = e.impulse;
        bursts++;
      }
    },
    update(frame: RenderFrame, cam: PerspectiveCamera, dt: number) {
      if (!ctx || !q || !smoke || !sparks || !dust || !skids || !spray || !rain) return;
      if (dt > 0) time += dt;
      cam.getWorldPosition(camPos);
      const wet = frame.conditions.wetness;
      for (let ci = 0; ci < frame.cars.length && ci < MAX_CARS; ci++) {
        const cs = frame.cars[ci]!;
        if (!cs.visible || cs.isGhost) continue;
        const dx = cs.px - camPos.x, dz = cs.pz - camPos.z;
        const d2 = dx * dx + dz * dz;
        if (d2 > 300 * 300) continue;
        vF.set(cs.fx, cs.fy, cs.fz);
        vU.set(cs.ux, cs.uy, cs.uz);
        vL.crossVectors(vU, vF);
        m.makeBasis(vL, vU, vF).setPosition(cs.px, cs.py, cs.pz);
        const vx = cs.fx * cs.speed, vy = cs.fy * cs.speed, vz = cs.fz * cs.speed;
        const kmh = Math.abs(cs.speed) * 3.6;
        for (let wi = 0; wi < 4; wi++) {
          const slip = cs.slip[wi];
          const surf = cs.wheelSurface[wi];
          const [wx, wz] = WHEELS[wi]!;
          w.set(wx, 0.06, wz).applyMatrix4(m);
          const k = (ci * 4 + wi) * 3;
          // Tyre smoke.
          if (dt > 0 && slip > 1.15 && kmh > 5 && HARD.has(surf) && wet < 0.2) {
            // QC2-10: the rate grows with speed (45/s up to 90/s at 72 km/h+) and every puff is placed where the wheel was
            // at its sub-frame emission time, so a fast car leaves an even, overlapping trail instead of per-frame clumps.
            const rate = 45 * Math.min(1, (slip - 1.15) / 0.6) * Math.min(2, Math.max(1, kmh / 36));
            acc[k]! += rate * dt;
            while (acc[k]! >= 1) {
              acc[k]! -= 1;
              const back = acc[k]! / rate;
              const n = counter[ci * 8 + wi]!++;
              const r1 = h01(cs.id, wi, n), r2 = h01(cs.id, wi + 8, n), r3 = h01(cs.id, wi + 16, n);
              smoke.spawn(time - back, w.x - vx * back, w.y + 0.1, w.z - vz * back, vx * 0.3 + (r1 - 0.5) * 0.8, 0.6 + r2 * 0.4, vz * 0.3 + (r3 - 0.5) * 0.8,
                1.2 + 1.6 * r2, 0.8, 3.4, 0.87, 0.87, 0.87, 0.3, r1 * 6.28, Math.floor(r3 * 16), w.y);
            }
          }
          // Dust (gravel / grass; a fainter grey plume off volcanic ash).
          if (dt > 0 && (surf === 'gravel' || surf === 'grass' || surf === 'ash') && kmh > 15) {
            acc[k + 1]! += (surf === 'ash' ? 14 : 30) * Math.min(1, kmh / 80) * dt;
            while (acc[k + 1]! >= 1) {
              acc[k + 1]! -= 1;
              const n = counter[ci * 8 + 4 + (wi % 4)]!++;
              const r1 = h01(cs.id, wi + 32, n), r2 = h01(cs.id, wi + 40, n), r3 = h01(cs.id, wi + 48, n);
              const gravel = surf === 'gravel';
              const mud = wet > 0.3;
              // gravel #a08f78, grass #8a8a5c, wet mud #5a4a3a (linear)
              const ash = surf === 'ash';
              // ash #8c8a88 (linear ≈ 0.26)
              const cr = mud ? 0.1 : ash ? 0.26 : gravel ? 0.35 : 0.25, cg = mud ? 0.07 : ash ? 0.25 : gravel ? 0.29 : 0.25, cb = mud ? 0.045 : ash ? 0.245 : gravel ? 0.2 : 0.1;
              dust.spawn(time, w.x, w.y + 0.05, w.z, vx * 0.35 + (r1 - 0.5) * 1.5, 0.8 + r2, vz * 0.35 + (r3 - 0.5) * 1.5,
                mud ? 0.8 : 1.5 + r2, mud ? 0.4 : 0.8, mud ? 1.2 : 3.0, cr, cg, cb, 0.42, r1 * 6.28, Math.floor(r2 * 16), w.y);
            }
          }
          // Skid marks.
          const sk = (ci * 4 + wi) * 4;
          if (slip > 1.2 && HARD.has(surf) && wet < 0.3 && kmh > 3) {
            if (skidLast[sk + 3]! > 0) {
              const ddx = w.x - skidLast[sk]!, ddz = w.z - skidLast[sk + 2]!;
              if (ddx * ddx + ddz * ddz >= 0.25) {
                const alpha = 0.55 * Math.min(1, Math.max(0.25, (slip - 1.2) / 0.5));
                skids.add(skidLast[sk]!, skidLast[sk + 1]! - 0.048, skidLast[sk + 2]!, w.x, w.y - 0.048, w.z, wi < 2 ? 0.3 : 0.38, alpha);
                skidLast[sk] = w.x;
                skidLast[sk + 1] = w.y;
                skidLast[sk + 2] = w.z;
              }
            } else {
              skidLast[sk] = w.x;
              skidLast[sk + 1] = w.y;
              skidLast[sk + 2] = w.z;
              skidLast[sk + 3] = 1;
            }
          } else skidLast[sk + 3] = 0;
        }
        // Tyre spray (rear wheels, 60 % of the car budget) and rooster tail (40 %), rendering.md §8.2.
        const sprayMin = wet > 0.6 ? 30 : 50;
        if (dt > 0 && wet > 0.1 && kmh > sprayMin && d2 < 250 * 250) {
          const inten = Math.pow(wet, 0.8) * smoothstep(sprayMin, 250, kmh) * (d2 > 120 * 120 ? 0.5 : 1);
          const budget = q.sprayPerCar;
          const sx = vx * 0.6, sz = vz * 0.6;
          // Rear tyres: live ≈ rate × 0.9 s → rate = 0.6 · budget / 0.9 per car.
          sprayAcc[ci * 2]! += ((0.6 * budget) / 0.9) * inten * dt;
          while (sprayAcc[ci * 2]! >= 1) {
            sprayAcc[ci * 2]! -= 1;
            const n = sprayCounter[ci]!++;
            const r1 = h01(cs.id, 70, n), r2 = h01(cs.id, 71, n), r3 = h01(cs.id, 72, n), r4 = h01(cs.id, 73, n);
            const wi = 2 + (n & 1);
            const [wx, wz] = WHEELS[wi]!;
            w.set(wx * 1.05, 0.25, wz - 0.35).applyMatrix4(m);
            const lat = (r1 - 0.5) * 3;
            spray.spawn(time, w.x, w.y, w.z, sx + vL.x * lat, 1 + 1.5 * r2, sz + vL.z * lat, 0.6 + 0.6 * r3, 0.8, 4.5,
              0.665, 0.708, 0.757, 0.3, r4 * 6.28, Math.floor(r2 * 16), w.y - 0.3); // spec 0.20 read too thin (quadratic fade)
          }
          // Rooster tail from the diffuser: live ≈ rate × 1.1 s → rate = 0.4 · budget / 1.1.
          sprayAcc[ci * 2 + 1]! += ((0.4 * budget) / 1.1) * inten * dt;
          while (sprayAcc[ci * 2 + 1]! >= 1) {
            sprayAcc[ci * 2 + 1]! -= 1;
            const n = sprayCounter[ci]!++;
            const r1 = h01(cs.id, 80, n), r2 = h01(cs.id, 81, n), r3 = h01(cs.id, 82, n), r4 = h01(cs.id, 83, n);
            w.set(0, 0.25, -2.3).applyMatrix4(m);
            const cone = (r1 - 0.5) * 0.26 * cs.speed; // ±10° of 0.75 × speed
            spray.spawn(time, w.x, w.y, w.z, vx * 0.75 + vL.x * cone, 2.5 + 2.5 * r2, vz * 0.75 + vL.z * cone, 0.8 + 0.6 * r3, 1.2, 6.0,
              0.665, 0.708, 0.757, 0.3, r4 * 6.28, Math.floor(r3 * 16), w.y - 0.3);
          }
        }
        // Sparks from under the plank (cars within 120 m).
        if (dt > 0 && cs.sparks > 0 && d2 < 120 * 120) {
          sparkAcc[ci]! += 400 * cs.sparks * dt * (wet > 0.3 ? 0.5 : 1);
          while (sparkAcc[ci]! >= 1) {
            sparkAcc[ci]! -= 1;
            const n = counter[ci * 8 + 7]!++;
            const r1 = h01(cs.id, 60, n), r2 = h01(cs.id, 61, n), r3 = h01(cs.id, 62, n), r4 = h01(cs.id, 63, n);
            w.set((r1 - 0.5) * 0.6, 0.03, -0.6 + 1.8 * r2).applyMatrix4(m);
            const cone = (r3 - 0.5) * 0.87; // ±25°
            const sx = vx * 0.85 + vL.x * Math.sin(cone) * cs.speed * 0.3;
            const sz = vz * 0.85 + vL.z * Math.sin(cone) * cs.speed * 0.3;
            sparks.spawn(time, w.x, w.y, w.z, sx, vy * 0.85 + 0.5 + 2 * r4, sz, 0.15 + 0.3 * r4, 0.02, 0.02, 1, 1, 1, 1, 0, 0, cs.py);
          }
        }
      }
      // Collision bursts: 40 sparks at the contact point.
      for (let b = 0; b < bursts; b++) {
        const x = burst[b * 4]!, y = burst[b * 4 + 1]!, z = burst[b * 4 + 2]!;
        for (let i = 0; i < 40; i++) {
          const n = counter[7]!++;
          const r1 = h01(999, b, n), r2 = h01(998, b, n), r3 = h01(997, b, n);
          const a = r1 * Math.PI * 2;
          const sp = 4 + 10 * r2;
          sparks.spawn(time, x, y, z, Math.cos(a) * sp, 1 + 3 * r3, Math.sin(a) * sp, 0.15 + 0.3 * r3, 0.02, 0.02, 1, 1, 1, 1, 0, 0, y - 0.3);
        }
      }
      bursts = 0;
      // Per-frame uniforms (soft particles, light), uploads.
      const entry = graphicsFor(ctx.renderer);
      const depth = entry?.post.depthTexture() ?? null;
      const soft = depth !== null && PRESET_DERIVED[q.id].softParticles;
      ctx.renderer.getDrawingBufferSize(res);
      const rig = (entry?.system as { rig?: () => LightingRig | null } | undefined)?.rig?.();
      const light = rig ? 0.35 * rig.sunIntensity + rig.hemiIntensity : 1.5;
      // QC2-10: smoke / dust colour follows the light colour; at night the floodlight key counts less (it only lights
      // patches of the track), and the scene fog applies to the particles too.
      if (rig) {
        tint.setHex(rig.sunColor).multiplyScalar((rig.tod === 'night' ? 0.2 : 0.35) * rig.sunIntensity);
        tint.add(tint2.setHex(rig.hemiSky).multiplyScalar(rig.hemiIntensity));
      } else tint.setRGB(light, light, light);
      if (rig) tint2.setHex(rig.fogColor);
      for (let pi = 0; pi < pools.length; pi++) {
        const p = pools[pi]!;
        const u = p.material.uniforms;
        u['uDepth']!.value = depth;
        u['uSoft']!.value = soft ? (p.material.userData['softFade'] as number) : 0;
        (u['uRes']!.value as Vector2).copy(res);
        u['uNear']!.value = cam.near;
        u['uFar']!.value = cam.far;
        const lv = u['uLight']!.value as number[];
        const fog = u['uFog']!.value as number[];
        if (p === spray || p === sparks) {
          lv[0] = light;
          lv[1] = light;
          lv[2] = light;
        } else {
          lv[0] = tint.r;
          lv[1] = tint.g;
          lv[2] = tint.b;
          fog[0] = tint2.r;
          fog[1] = tint2.g;
          fog[2] = tint2.b;
          fog[3] = rig?.fogDensity ?? 0;
        }
        p.flush(time);
      }
      skids.flush();
      const tod = frame.conditions.tod;
      rain.update(cam, frame.conditions.rain, tod, time, dt, Math.min(1.2, light / 1.5));
      counts.spray = spray.max;
      counts.rain = rain.mesh.visible ? Math.round(q.rainStreaks * frame.conditions.rain) : 0;
      counts.smoke = smoke.max;
      counts.sparks = sparks.max;
      counts.dust = dust.max;
      counts.skids = skids.max;
    },
    dispose() {
      if (ctx) detachSubsystem(ctx.renderer, 'vfx', sys);
      smoke?.dispose();
      sparks?.dispose();
      dust?.dispose();
      skids?.dispose();
      spray?.dispose();
      rain?.dispose();
      spray = null;
      rain = null;
      tex?.dispose();
      sprayTex?.dispose();
      sprayTex = null;
      smoke = sparks = dust = null;
      skids = null;
      tex = null;
      ctx = null;
    },
  };
  return sys;
}
