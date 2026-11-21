// CameraRig (docs/design/rendering.md §9, CR-02 views). Five driving cameras with exact offsets/FOV/damping,
// critically damped springs (closed form, frame-rate independent), speed FOV, deterministic shake, look-back,
// TV / orbit / free / trailer views and the audio listener. Allocation-free in update().

import { type Material, MathUtils, Matrix4, Mesh, type Object3D, type PerspectiveCamera, Quaternion, Raycaster, Vector3 } from 'three';
import type { CameraId } from '../../contracts/common';
import type { CameraPose, CameraRig, CarRenderState, ListenerPose, RenderContext, RenderFrame, ViewId } from '../../contracts/render';
import type { SimEvent } from '../../contracts/sim';
import type { TrackQuery } from '../../contracts/track';
import { attachSubsystem, graphicsFor } from '../renderer/registry';
import { createTvDirector, type TvDirector, type TvProbe } from './tvDirector';

export const CAMERA_ORDER: readonly CameraId[] = ['chaseNear', 'chaseFar', 'tcam', 'cockpit', 'nose'];
const DRIVING = new Set<ViewId>(CAMERA_ORDER);

interface Onboard { eye: [number, number, number]; pitchDeg: number; fov: number; near: number }
const ONBOARD: Record<'cockpit' | 'tcam' | 'nose', Onboard> = {
  cockpit: { eye: [0, 0.77, 0.36], pitchDeg: -3.5, fov: 75, near: 0.05 },
  tcam: { eye: [0, 1.05, -0.12], pitchDeg: -5, fov: 70, near: 0.05 },
  nose: { eye: [0, 0.62, 1.55], pitchDeg: -2, fov: 72, near: 0.1 },
};
interface Chase { back: number; up: number; aimFwd: number; aimUp: number; fov: number; wPos: number; wHead: number; wVert: number }
const CHASE: Record<'chaseNear' | 'chaseFar', Chase> = {
  chaseNear: { back: 6.5, up: 2.0, aimFwd: 2.0, aimUp: 0.8, fov: 65, wPos: 9, wHead: 5.5, wVert: 6 },
  chaseFar: { back: 9.5, up: 3.0, aimFwd: 3.0, aimUp: 1.0, fov: 62, wPos: 7, wHead: 4.5, wVert: 6 },
};

export interface CameraRigImpl extends CameraRig {
  setView(id: ViewId): void;
  view(): ViewId;
  setOverride(p: CameraPose | null): void;
  /** Kerb / collision shake (glue forwards sim events). */
  onSimEvent(e: SimEvent): void;
  /** settings.graphics.cameraShake (0..1) and motionEffects. */
  setShake(k: number): void;
  setMotionEffects(on: boolean): void;
  /** TV spots come from the track (null = spots generated ahead of the car). */
  setTrack(q: TrackQuery | null): void;
  /** G5: the TV director (hero spots, forced spot for screenshots / trailer). */
  tv(): TvDirector;
  /** Orbit input: yaw/pitch in rad, zoom in m (sandbox keyboard: arrows 60°/s, W/S). */
  orbit(dYaw: number, dPitch: number, dZoom: number): void;
  /** Free-cam input in camera space (m) and look deltas (rad). */
  moveFree(dx: number, dy: number, dz: number, dYaw: number, dPitch: number): void;
  /** Re-snap springs on the next update (teleports, view changes). */
  snap(): void;
}

// ---- critically damped spring (exact) ----
function spring(x: number, v: number, target: number, w: number, dt: number, out: [number, number]): [number, number] {
  const e = Math.exp(-w * dt);
  const d = x - target;
  const c = v + w * d;
  out[0] = target + (d + c * dt) * e;
  out[1] = (v - w * c * dt) * e;
  return out;
}
const tmp2: [number, number] = [0, 0];

const wrap = (a: number): number => {
  let r = a % (Math.PI * 2);
  if (r > Math.PI) r -= Math.PI * 2;
  else if (r < -Math.PI) r += Math.PI * 2;
  return r;
};
const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const hash1 = (i: number, s: number): number => {
  let h = Math.imul(i ^ Math.imul(s, 0x9e3779b1), 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return ((h >>> 0) / 4294967296) * 2 - 1;
};
/** Deterministic 1D value noise in [-1, 1]. */
const vnoise = (t: number, seed: number): number => {
  const i = Math.floor(t);
  const f = t - i;
  const u = f * f * (3 - 2 * f);
  return hash1(i, seed) * (1 - u) + hash1(i + 1, seed) * u;
};

/**
 * Raycast probe over the live scene for TV spot placement. Solid = visible opaque meshes (no alpha-tested fences,
 * crowds or foliage, no transparent glass, no sky dome, no cars or VFX). Used once at setTrack (load time).
 */
function sceneProbe(root: Object3D): TvProbe {
  const solids: Object3D[] = [];
  // Large maps (the ≈ 20 km Eifel ring) publish the terrain height on the environment root (userData.groundHeight):
  // the terrain meshes are then tested as a heightfield instead of ray-triangle tests (12 s → < 1 s of TV setup).
  let groundHeight: ((x: number, z: number) => number) | null = null;
  root.traverse((o) => { if (typeof o.userData.groundHeight === 'function') groundHeight = o.userData.groundHeight as (x: number, z: number) => number; });
  const gh = groundHeight as ((x: number, z: number) => number) | null;
  const isSolid = (m: Material): boolean => !m.transparent && m.alphaTest <= 0 && m.visible;
  root.traverse((o) => {
    if (o.name === 'carVisuals' || o.name.startsWith('vfx.') || o.name === 'racingLine') return;
    const mesh = o as Mesh;
    if (!(mesh as { isMesh?: boolean }).isMesh || !o.visible) return;
    if (gh && o.name.startsWith('terrain')) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    if (!mats.every(isSolid)) return;
    const g = mesh.geometry;
    if (!g.boundingSphere) g.computeBoundingSphere();
    if (g.boundingSphere && g.boundingSphere.radius > 2500 && !(o as { isInstancedMesh?: boolean }).isInstancedMesh) {
      // Sky dome or terrain: keep terrain (it occludes), drop back-faced domes.
      if (mats.some((m) => m.side === 1)) return;
    }
    solids.push(o);
  });
  const ray = new Raycaster();
  const o = new Vector3(), d = new Vector3();
  const hits: import('three').Intersection[] = [];
  return {
    inside(x, y, z) {
      o.set(x, y + 80, z);
      d.set(0, -1, 0);
      ray.set(o, d);
      ray.far = 80.5;
      if (gh && gh(x, z) > y) return true;
      hits.length = 0;
      ray.intersectObjects(solids, false, hits);
      return hits.length > 0;
    },
    blocked(x, y, z, tx, ty, tz) {
      o.set(x, y, z);
      d.set(tx - x, ty - y, tz - z);
      const len = d.length();
      d.divideScalar(len);
      ray.set(o, d);
      ray.far = Math.max(0, len - 3);
      if (gh) {
        // Heightfield march every 4 m (the terrain sits ≥ 0.35 m under the road; 0.5 m tolerance).
        const n = Math.ceil(ray.far / 4);
        for (let k = 1; k < n; k++) {
          const t = (k / n) * ray.far;
          if (gh(x + d.x * t, z + d.z * t) > y + d.y * t + 0.5) return true;
        }
      }
      hits.length = 0;
      ray.intersectObjects(solids, false, hits);
      return hits.length > 0;
    },
  };
}

export function createCameraRig(ctx: RenderContext): CameraRigImpl {
  const camera: PerspectiveCamera = ctx.camera;
  let driving: CameraId = 'chaseNear';
  let view: ViewId = 'chaseNear';
  let lookBack = false;
  let fovOffset = 0;
  let shakeK = 0.6;
  let motion = true;
  let override: CameraPose | null = null;
  let track: TrackQuery | null = null;
  let needSnap = true;
  let time = 0;
  let lastDt = 1 / 60;

  // Chase state
  let headX = 0, headV = 0;
  const pos = new Vector3(), posV = new Vector3();
  // Speed FOV
  let dFov = 0;
  // Head motion (cockpit)
  const head = new Vector3(), headVel = new Vector3();
  let headPitch = 0, headRoll = 0;
  // Car kinematics estimate (for β, accelerations)
  const lastCar = new Vector3(), carVel = new Vector3(), carVelS = new Vector3(), lastVel = new Vector3(), carAcc = new Vector3();
  let haveLast = false;
  // Shake impulses
  let kerbAmp = 0, kerbRot = 0, kerbFreq = 22, kerbTau = 0.15;
  let colAmp = 0, colTau = 0.4;
  let bottom = 0;
  // Orbit / free / TV
  let orbYaw = 0.6, orbPitch = 0.22, orbDist = 9;
  const freePos = new Vector3(0, 5, 10);
  let freeYaw = 0, freePitch = -0.2;
  const tvSpot = new Vector3();
  let tvValid = false;
  let tvFov = 30;
  const tvAim = new Vector3();
  let tvSeq = 0;
  const tv = createTvDirector();
  // Listener
  const lPrev = new Vector3(), lVel = new Vector3();
  let lHave = false;

  // Scratch
  const P = new Vector3(), F = new Vector3(), U = new Vector3(), L = new Vector3(), T = new Vector3(), D = new Vector3(), A = new Vector3();
  const M = new Matrix4(), Q = new Quaternion(), Q2 = new Quaternion(), E = new Vector3();
  const X = new Vector3(1, 0, 0), Z = new Vector3(0, 0, 1);

  const setFov = (fov: number, near: number): void => {
    const f = MathUtils.clamp(fov, 6, 100);
    if (Math.abs(camera.fov - f) > 1e-3 || camera.near !== near) {
      camera.fov = f;
      camera.near = near;
      camera.updateProjectionMatrix();
    }
  };

  const carBasis = (cs: CarRenderState): void => {
    P.set(cs.px, cs.py, cs.pz);
    F.set(cs.fx, cs.fy, cs.fz).normalize();
    U.set(cs.ux, cs.uy, cs.uz).normalize();
    L.crossVectors(U, F).normalize();
  };

  /** Camera at model-space eye looking along model forward with pitch (deg); optional backward. */
  const onboard = (o: Onboard, back: boolean, offset: Vector3 | null, extraPitch: number, extraRoll: number): void => {
    const ex = o.eye[0] + (offset?.x ?? 0), ey = o.eye[1] + (offset?.y ?? 0), ez = o.eye[2] + (offset?.z ?? 0);
    camera.position.copy(P).addScaledVector(L, ex).addScaledVector(U, ey).addScaledVector(F, ez);
    // Camera looks down its −Z; build basis (right = −L for forward view).
    M.makeBasis(back ? L : T.copy(L).negate(), U, back ? F : D.copy(F).negate());
    camera.quaternion.setFromRotationMatrix(M);
    Q.setFromAxisAngle(X, MathUtils.degToRad(o.pitchDeg) + extraPitch);
    Q2.setFromAxisAngle(Z, extraRoll);
    camera.quaternion.multiply(Q).multiply(Q2);
  };

  const shakeOffset = (cs: CarRenderState, dt: number, chase: boolean): void => {
    // D-020: shake follows settings.graphics.cameraShake and is fully off without motion effects.
    if (shakeK <= 0 || dt <= 0 || !motion) return;
    const kmh = Math.abs(cs.speed) * 3.6;
    let pAmp = 0, rAmp = 0;
    // Kerb impulse
    kerbAmp *= Math.exp(-dt / kerbTau);
    kerbRot *= Math.exp(-dt / kerbTau);
    colAmp *= Math.exp(-dt / colTau);
    const nk = vnoise(time * kerbFreq, 11);
    pAmp += kerbAmp * nk;
    rAmp += kerbRot * nk;
    const nc = vnoise(time * 10, 23);
    pAmp += colAmp * nc;
    rAmp += colAmp * 20 * nc;
    // Grass / gravel continuous
    let off = 0;
    for (let i = 0; i < 4; i++) if (cs.wheelSurface[i] === 'grass' || cs.wheelSurface[i] === 'gravel') off++;
    if (off > 0) {
      const k = Math.min(1, Math.abs(cs.speed) / 30) * (off / 4);
      const n = vnoise(time * 15, 37);
      pAmp += 0.006 * k * n;
      rAmp += 0.4 * k * n;
    }
    if (!chase) {
      const b = smooth(200, 330, kmh);
      const n = vnoise(time * 28, 41);
      pAmp += 0.0012 * b * n;
      rAmp += 0.06 * b * n;
      if (view === 'cockpit' || view === 'tcam') {
        if (cs.sparks > 0.5) bottom = 1;
        bottom *= Math.exp(-dt / 0.1);
        const nb = vnoise(time * 30, 53);
        pAmp += 0.004 * bottom * nb;
        rAmp += 0.3 * bottom * nb;
      }
    }
    const k = shakeK * (chase ? 0.5 : 1);
    camera.position.addScaledVector(U, pAmp * k).addScaledVector(L, pAmp * 0.6 * k * vnoise(time * 13, 5));
    E.set(MathUtils.degToRad(rAmp * k), MathUtils.degToRad(rAmp * 0.5 * k * vnoise(time * 9, 7)), 0);
    Q.setFromAxisAngle(X, E.x);
    Q2.setFromAxisAngle(Z, E.y);
    camera.quaternion.multiply(Q).multiply(Q2);
  };

  const updateChase = (id: 'chaseNear' | 'chaseFar', cs: CarRenderState, dt: number): void => {
    const c = CHASE[id];
    const yaw = Math.atan2(F.x, F.z);
    let target = yaw;
    const sp = Math.hypot(carVelS.x, carVelS.z);
    if (sp > 10) {
      const vyaw = Math.atan2(carVelS.x, carVelS.z);
      const beta = wrap(vyaw - yaw);
      target = yaw + 0.35 * beta;
    }
    if (needSnap) {
      headX = target;
      headV = 0;
    } else {
      const t = headX + wrap(target - headX);
      spring(headX, headV, t, c.wHead, dt, tmp2);
      headX = tmp2[0];
      headV = tmp2[1];
    }
    const hx = Math.sin(headX), hz = Math.cos(headX);
    const dir = lookBack ? -1 : 1;
    // Horizontal: spring the offset from the car (a spring on the absolute position lags 2v/ω, i.e. ≈ 15 m
    // at 250 km/h); vertical: spring the absolute height (smooths crests and kerbs).
    D.set(-hx * c.back * dir, cs.py + c.up, -hz * c.back * dir);
    if (needSnap) {
      pos.copy(D);
      posV.set(0, 0, 0);
    } else {
      spring(pos.x, posV.x, D.x, c.wPos, dt, tmp2);
      pos.x = tmp2[0];
      posV.x = tmp2[1];
      spring(pos.z, posV.z, D.z, c.wPos, dt, tmp2);
      pos.z = tmp2[0];
      posV.z = tmp2[1];
      spring(pos.y, posV.y, D.y, c.wVert, dt, tmp2);
      pos.y = tmp2[0];
      posV.y = tmp2[1];
    }
    if (pos.y < cs.py + 1.2) pos.y = cs.py + 1.2;
    camera.position.set(cs.px + pos.x, pos.y, cs.pz + pos.z);
    A.set(cs.px + hx * c.aimFwd * dir, cs.py + c.aimUp, cs.pz + hz * c.aimFwd * dir);
    camera.up.set(0, 1, 0);
    camera.lookAt(A);
    const fov = c.fov + fovOffset + (lookBack ? 0 : dFov);
    setFov(MathUtils.clamp(fov, 40, 100), 0.1);
  };

  const updateTv = (cs: CarRenderState, dt: number): void => {
    P.set(cs.px, cs.py, cs.pz);
    const spot = track ? tv.choose(cs.px, cs.pz) : null;
    if (spot) {
      if (tv.cut || !tvValid) {
        tvSpot.set(spot.x, spot.y, spot.z);
        tvValid = true;
        tvAim.copy(P);
        needSnap = true;
      }
    } else {
      const dist = tvValid ? tvSpot.distanceTo(P) : Infinity;
      D.subVectors(tvSpot, P);
      const behind = tvValid && D.x * F.x + D.z * F.z < -60;
      if (!tvValid || dist > 160 || behind) {
        // No track: a spot 80 m ahead, alternating sides, 10 m high.
        tvSeq++;
        const side = tvSeq % 2 === 0 ? 1 : -1;
        tvSpot.set(cs.px + F.x * 80 + L.x * 28 * side, cs.py + 10, cs.pz + F.z * 80 + L.z * 28 * side);
        tvValid = true;
        tvAim.copy(P);
        needSnap = true;
      }
    }
    camera.position.copy(tvSpot);
    const k = needSnap ? 1 : 1 - Math.exp(-3 * dt);
    // Lead room: aim 0.25 s ahead of the car so it sits behind the frame centre, moving into the space.
    const lead = Math.min(25, Math.abs(cs.speed) * 0.25);
    tvAim.lerp(T.set(cs.px + F.x * lead, cs.py + 0.5, cs.pz + F.z * lead), k);
    camera.up.set(0, 1, 0);
    camera.lookAt(tvAim);
    const d2 = Math.max(1, tvSpot.distanceTo(P));
    const fovT = MathUtils.clamp(MathUtils.radToDeg(2 * Math.atan(6 / d2)), 6, 45);
    tvFov += (fovT - tvFov) * (needSnap ? 1 : 1 - Math.exp(-2 * dt));
    // Near 0.5 m: a spot just behind a hoarding or fence never fills the frame with it.
    setFov(tvFov, 0.5);
  };

  const rig: CameraRigImpl = {
    camera,
    setMode(id) {
      driving = id;
      view = id;
      needSnap = true;
    },
    mode: () => driving,
    next() {
      const i = CAMERA_ORDER.indexOf(driving);
      rig.setMode(CAMERA_ORDER[(i + 1) % CAMERA_ORDER.length]!);
      return driving;
    },
    setView(id) {
      if (DRIVING.has(id)) rig.setMode(id as CameraId);
      else {
        view = id;
        needSnap = true;
        tvValid = false;
        if (id === 'free') {
          freePos.copy(camera.position);
          E.set(0, 0, -1).applyQuaternion(camera.quaternion);
          freeYaw = Math.atan2(E.x, E.z);
          freePitch = Math.asin(MathUtils.clamp(E.y, -1, 1));
        }
      }
    },
    view: () => view,
    setOverride(p) {
      override = p;
    },
    setLookBack(on) {
      if (on !== lookBack) needSnap = true;
      lookBack = on;
    },
    setFovOffset(deg) {
      fovOffset = deg;
    },
    setShake(k) {
      shakeK = Math.max(0, Math.min(1, k));
    },
    setMotionEffects(on) {
      if (on === motion) return;
      motion = on;
      if (!on) {
        kerbAmp = kerbRot = colAmp = bottom = 0;
        dFov = 0;
        head.set(0, 0, 0);
        headVel.set(0, 0, 0);
        headPitch = headRoll = 0;
      }
    },
    setTrack(q) {
      track = q;
      ctx.scene.updateMatrixWorld();
      tv.setTrack(q, q ? sceneProbe(ctx.scene) : null);
      tvValid = false;
      // G12: car visuals build the pit crew from the same query (glue only calls rig.setTrack).
      (graphicsFor(ctx.renderer)?.cars as { setTrack?: (t: TrackQuery | null) => void } | null | undefined)?.setTrack?.(q);
    },
    tv: () => tv,
    orbit(dYaw, dPitch, dZoom) {
      orbYaw += dYaw;
      orbPitch = MathUtils.clamp(orbPitch + dPitch, MathUtils.degToRad(5), MathUtils.degToRad(60));
      orbDist = MathUtils.clamp(orbDist + dZoom, 4, 30);
    },
    moveFree(dx, dy, dz, dYaw, dPitch) {
      freeYaw += dYaw;
      freePitch = MathUtils.clamp(freePitch + dPitch, -1.45, 1.45);
      const fx = Math.sin(freeYaw), fz = Math.cos(freeYaw);
      freePos.x += fx * dz + fz * -dx;
      freePos.z += fz * dz - fx * -dx;
      freePos.y += dy;
    },
    snap() {
      needSnap = true;
    },
    onSimEvent(e) {
      if (!motion) return;
      if (e.type === 'kerb') {
        kerbAmp = Math.max(kerbAmp, e.sausage ? 0.01 : 0.003);
        kerbRot = Math.max(kerbRot, e.sausage ? 0.8 : 0.25);
        kerbFreq = e.sausage ? 16 : 22;
        kerbTau = e.sausage ? 0.25 : 0.15;
      } else if (e.type === 'collision') {
        colAmp = Math.max(colAmp, Math.min(0.03, e.impulse / 4e5));
        colTau = 0.4;
      }
    },
    update(frame: RenderFrame, dt: number) {
      // Paused: freeze the shake clock, otherwise the speed buffeting of the frozen car keeps jittering the view.
      if (!frame.paused) time += Math.max(0, dt);
      if (dt > 0) lastDt = dt;
      if (override) {
        camera.position.set(override.px, override.py, override.pz);
        camera.up.set(0, 1, 0);
        camera.lookAt(override.tx, override.ty, override.tz);
        if (override.roll) {
          Q.setFromAxisAngle(Z, override.roll);
          camera.quaternion.multiply(Q);
        }
        setFov(override.fov, 0.1);
        needSnap = true;
        return;
      }
      const cs = frame.cars[frame.playerId];
      if (!cs) return;
      carBasis(cs);
      // Kinematics estimate (world velocity, smoothed; acceleration in car frame).
      if (haveLast && dt > 0) {
        carVel.copy(P).sub(lastCar).divideScalar(dt);
        if (carVel.lengthSq() > 120 * 120) carVel.copy(carVelS); // teleport guard
        carVelS.lerp(carVel, 1 - Math.exp(-dt / 0.08));
        carAcc.copy(carVelS).sub(lastVel).divideScalar(dt);
        lastVel.copy(carVelS);
      } else {
        carVelS.copy(F).multiplyScalar(cs.speed);
        lastVel.copy(carVelS);
        carAcc.set(0, 0, 0);
      }
      if (haveLast && P.distanceToSquared(lastCar) > 50 * 50) needSnap = true;
      lastCar.copy(P);
      haveLast = true;
      // Speed FOV (τ 0.35 s), cockpit × 0.6.
      const kmh = Math.abs(cs.speed) * 3.6;
      const target = motion && !lookBack ? 6 * smooth(80, 300, kmh) * (view === 'cockpit' ? 0.6 : 1) : 0;
      dFov = needSnap || dt <= 0 ? target : dFov + (target - dFov) * (1 - Math.exp(-dt / 0.35));

      switch (view) {
        case 'cockpit':
        case 'tcam':
        case 'nose': {
          const o = ONBOARD[view];
          if (lookBack) {
            onboard({ eye: [0, 1.15, -0.3], pitchDeg: -6, fov: 70, near: 0.05 }, true, null, 0, 0);
            setFov(70 + fovOffset, 0.05);
          } else {
            let ep = 0, er = 0;
            if (view === 'cockpit' && motion) {
              const g = 9.81;
              const aLat = carAcc.dot(L), aLong = carAcc.dot(F);
              const tx = MathUtils.clamp((aLat / g) * 0.01, -0.04, 0.04); // body leans away: model +x is left
              const tz = MathUtils.clamp((-aLong / g) * 0.012, -0.05, 0.05);
              if (needSnap) {
                head.set(0, 0, 0);
                headVel.set(0, 0, 0);
              } else {
                spring(head.x, headVel.x, tx, 12, dt, tmp2);
                head.x = tmp2[0];
                headVel.x = tmp2[1];
                spring(head.z, headVel.z, tz, 12, dt, tmp2);
                head.z = tmp2[0];
                headVel.z = tmp2[1];
              }
              headPitch += (MathUtils.degToRad((-aLong / g) * 0.6) - headPitch) * (1 - Math.exp(-12 * Math.max(dt, 0)));
              headRoll += (MathUtils.degToRad((-aLat / g) * 0.5) - headRoll) * (1 - Math.exp(-12 * Math.max(dt, 0)));
              ep = headPitch;
              er = headRoll;
            }
            onboard(o, false, view === 'cockpit' ? head : null, ep, er);
            setFov(MathUtils.clamp(o.fov + fovOffset + dFov, 40, 100), o.near);
            shakeOffset(cs, dt, false);
          }
          break;
        }
        case 'chaseNear':
        case 'chaseFar':
          updateChase(view, cs, dt);
          if (!lookBack) shakeOffset(cs, dt, true);
          break;
        case 'tv':
          updateTv(cs, dt);
          break;
        case 'orbit': {
          T.set(cs.px, cs.py + 0.5, cs.pz);
          camera.position.set(
            T.x + Math.sin(orbYaw) * Math.cos(orbPitch) * orbDist,
            T.y + Math.sin(orbPitch) * orbDist,
            T.z + Math.cos(orbYaw) * Math.cos(orbPitch) * orbDist,
          );
          camera.up.set(0, 1, 0);
          camera.lookAt(T);
          setFov(45, 0.1);
          break;
        }
        case 'free': {
          camera.position.copy(freePos);
          T.set(Math.sin(freeYaw) * Math.cos(freePitch), Math.sin(freePitch), Math.cos(freeYaw) * Math.cos(freePitch)).add(freePos);
          camera.up.set(0, 1, 0);
          camera.lookAt(T);
          setFov(60, 0.1);
          break;
        }
        case 'trailer':
          break;
      }
      camera.updateMatrixWorld();
      needSnap = false;
    },
    getListener(out: ListenerPose) {
      const e = camera.matrixWorld.elements;
      camera.getWorldPosition(T);
      out.px = T.x;
      out.py = T.y;
      out.pz = T.z;
      out.fx = -e[8]!;
      out.fy = -e[9]!;
      out.fz = -e[10]!;
      out.ux = e[4]!;
      out.uy = e[5]!;
      out.uz = e[6]!;
      // Velocity: finite difference of the camera position, smoothed with τ = 0.1 s.
      if (lHave) {
        D.copy(T).sub(lPrev).divideScalar(lastDt);
        lVel.lerp(D, 1 - Math.exp(-lastDt / 0.1));
      }
      lPrev.copy(T);
      lHave = true;
      out.vx = lVel.x;
      out.vy = lVel.y;
      out.vz = lVel.z;
      out.camera = driving;
      return out;
    },
  };
  attachSubsystem(ctx.renderer, 'rig', rig);
  return rig;
}
