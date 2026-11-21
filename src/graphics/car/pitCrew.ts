// Simplified pit crew (G12, sprint-2 §6): 8 crew per team box, one InstancedMesh for every box (1 draw, no shadow).
// The figure geometry holds all three poses (wait / work / release); per-instance `iPose` collapses the other two in the
// vertex shader, so a pose change only rewrites that box's 8 matrices. Pose per box from `CarRenderState.inPitBox`:
// work while a car of that team is in its box, release for 1.5 s after it leaves, otherwise wait at the garage edge.

import {
  BoxGeometry, BufferGeometry, Color, IcosahedronGeometry, Float32BufferAttribute, InstancedBufferAttribute, InstancedMesh, Matrix4, MeshStandardMaterial, Quaternion, Vector3,
} from 'three';
import type { RenderFrame } from '../../contracts/render';
import type { TrackQuery } from '../../contracts/track';
import { TEAMS } from '../../data/teams';
import { mergeParts } from './geom';

const CREW = 8;
const RELEASE_S = 1.5;
type Pose = 0 | 1 | 2; // wait, work, release

/** Box-local crew spots while working: [lateral (+ toward garage), longitudinal (+ car forward)]. */
const WORK: readonly [number, number][] = [[1.25, 1.95], [-1.25, 1.95], [1.25, -1.65], [-1.25, -1.65], [0, 3.5], [0, -3.3], [2.0, 0.2], [-2.0, 0.2]];

/** Pose bit masks per part (a part shared by several poses is stored once). */
const M_WAIT = 1, M_WORK = 2, M_REL = 4;
/** Colour zones: team primary (overalls), team secondary (trousers, darkened), fixed vertex colour (helmet, visor, boots). */
const PRIM = 0, SEC = 1, FIX = 2;

/**
 * QC2-17: two-tone crew (team-primary overalls, darker team-secondary trousers), white rounded helmet with a dark visor,
 * dark boots. Wait and release share every part except the right arm, so the figure stays within the 250-triangle budget.
 */
function figure(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const push = (g: BufferGeometry, mask: number, zone: number, shade: number): void => {
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
    const n = g.getAttribute('position').count;
    g.setAttribute('color', new Float32BufferAttribute(new Float32Array(n * 3).fill(shade), 3));
    g.setAttribute('aPose', new Float32BufferAttribute(new Float32Array(n).fill(mask), 1));
    g.setAttribute('aZone', new Float32BufferAttribute(new Float32Array(n).fill(zone), 1));
    parts.push(g.index ? g.toNonIndexed() : g);
    g.dispose();
  };
  const box = (mask: number, zone: number, shade: number, w: number, h: number, d: number, x: number, y: number, z: number, rx = 0): void => {
    const g = new BoxGeometry(w, h, d);
    if (rx) g.rotateX(rx);
    push(g.translate(x, y, z), mask, zone, shade);
  };
  const head = (mask: number, y: number, z: number): void => {
    push(new IcosahedronGeometry(0.15, 0).scale(1, 1.08, 1.1).translate(0, y, z), mask, FIX, 0.85);
    box(mask, FIX, 0.02, 0.2, 0.09, 0.05, 0, y + 0.01, z + 0.15);
  };
  const STAND = M_WAIT | M_REL;
  // Standing (wait / release): trousers, boots, overalls top, helmet, left arm; right arm down (wait) or raised (release).
  box(STAND, SEC, 0.45, 0.16, 0.78, 0.18, 0.11, 0.47, 0); box(STAND, SEC, 0.45, 0.16, 0.78, 0.18, -0.11, 0.47, 0);
  box(STAND, FIX, 0.04, 0.17, 0.1, 0.26, 0.11, 0.05, 0.03); box(STAND, FIX, 0.04, 0.17, 0.1, 0.26, -0.11, 0.05, 0.03);
  box(STAND, PRIM, 1, 0.44, 0.62, 0.26, 0, 1.16, 0);
  head(STAND, 1.63, 0);
  box(STAND, PRIM, 1, 0.11, 0.62, 0.12, -0.29, 1.15, 0);
  box(M_WAIT, PRIM, 1, 0.11, 0.62, 0.12, 0.29, 1.15, 0);
  box(M_REL, PRIM, 1, 0.11, 0.62, 0.12, 0.29, 1.78, 0);
  // Work: kneeling, arms reaching forward to the wheel.
  box(M_WORK, SEC, 0.45, 0.16, 0.5, 0.18, 0.11, 0.25, -0.12); box(M_WORK, SEC, 0.45, 0.16, 0.5, 0.18, -0.11, 0.25, -0.12);
  box(M_WORK, PRIM, 1, 0.44, 0.58, 0.26, 0, 0.78, 0.05, 0.35);
  head(M_WORK, 1.18, 0.22);
  box(M_WORK, PRIM, 1, 0.11, 0.12, 0.6, 0.29, 0.86, 0.4); box(M_WORK, PRIM, 1, 0.11, 0.12, 0.6, -0.29, 0.86, 0.4);
  const merged = mergeParts(parts);
  for (const g of parts) g.dispose();
  return merged;
}

export interface PitCrew {
  readonly mesh: InstancedMesh;
  update(frame: RenderFrame): void;
  dispose(): void;
}

/** Returns null when the track has no pit boxes. */
export function createPitCrew(q: TrackQuery): PitCrew | null {
  const boxes = q.data.pit.boxes;
  if (boxes.length === 0) return null;
  const geo = figure();
  const n = boxes.length * CREW;
  const iPose = new InstancedBufferAttribute(new Float32Array(n), 1);
  geo.setAttribute('iPose', iPose);
  const iSec = new InstancedBufferAttribute(new Float32Array(n * 3), 3);
  geo.setAttribute('iSec', iSec);
  const mat = new MeshStandardMaterial({ name: 'pit.crew', vertexColors: true, roughness: 0.7, metalness: 0 });
  mat.onBeforeCompile = (s) => {
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aPose;\nattribute float aZone;\nattribute float iPose;\nattribute vec3 iSec;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nif (mod(floor(aPose / exp2(iPose) + 0.01), 2.0) < 0.5) transformed = vec3(0.0);')
      .replace('#include <color_vertex>', '#include <color_vertex>\nvColor.rgb = aZone > 1.5 ? color.rgb : color.rgb * (aZone > 0.5 ? iSec : instanceColor.rgb);');
  };
  mat.customProgramCacheKey = () => 'pit.crew';
  const mesh = new InstancedMesh(geo, mat, n);
  mesh.name = 'pit.crew';
  mesh.castShadow = false;
  mesh.receiveShadow = true;

  // Box frames: centre, lateral (+ toward garage) and forward unit vectors.
  const cen = boxes.map(() => new Vector3()), lat = boxes.map(() => new Vector3()), fwd = boxes.map(() => new Vector3());
  const tmp = new Vector3();
  boxes.forEach((b, i) => {
    q.pitWorldFromSD(b.sp, b.d, cen[i]!);
    lat[i]!.copy(q.pitWorldFromSD(b.sp, b.d + 1, tmp)).sub(cen[i]!).setY(0).normalize();
    fwd[i]!.copy(q.pitWorldFromSD(b.sp + 1, b.d, tmp)).sub(cen[i]!).setY(0).normalize();
  });
  const color = new Color();
  boxes.forEach((b, i) => {
    const team = TEAMS.find((t) => t.id === b.teamId);
    color.set(team?.colors.primary ?? 0x888888);
    for (let k = 0; k < CREW; k++) mesh.setColorAt(i * CREW + k, color);
    color.set(team?.colors.secondary ?? 0x333333);
    for (let k = 0; k < CREW; k++) iSec.setXYZ(i * CREW + k, color.r, color.g, color.b);
  });

  const pose = new Int8Array(boxes.length).fill(-1);
  const lastIn = new Float64Array(boxes.length).fill(-1e9);
  const teamBox = new Map<string, number>(boxes.map((b, i) => [b.teamId, i]));
  const inBox = new Uint8Array(boxes.length);
  const m = new Matrix4(), qr = new Quaternion(), p = new Vector3(), one = new Vector3(1, 1, 1), up = new Vector3(0, 1, 0);

  const place = (i: number, ps: Pose): void => {
    for (let k = 0; k < CREW; k++) {
      const [wl, wf] = WORK[k]!;
      // Waiting crew stand in a line at the garage edge, facing the lane.
      const l = ps === 0 ? 3.6 : wl, f = ps === 0 ? -3.0 + (6.0 * k) / (CREW - 1) : wf;
      p.copy(cen[i]!).addScaledVector(lat[i]!, l).addScaledVector(fwd[i]!, f);
      // Working crew face the car (box centre); waiting crew face the lane.
      const heading = ps === 0 ? Math.atan2(-lat[i]!.x, -lat[i]!.z) : Math.atan2(cen[i]!.x - p.x, cen[i]!.z - p.z);
      qr.setFromAxisAngle(up, heading);
      m.compose(p, qr, one);
      mesh.setMatrixAt(i * CREW + k, m);
      iPose.setX(i * CREW + k, ps);
    }
  };

  return {
    mesh,
    update(frame) {
      inBox.fill(0);
      for (let c = 0; c < frame.cars.length; c++) {
        const cs = frame.cars[c]!;
        if (!cs.inPitBox || cs.isGhost) continue;
        const bi = teamBox.get(cs.teamId);
        if (bi !== undefined) inBox[bi] = 1;
      }
      let dirty = false;
      for (let i = 0; i < boxes.length; i++) {
        if (inBox[i]) lastIn[i] = frame.time;
        const ps: Pose = inBox[i] ? 1 : frame.time - lastIn[i]! < RELEASE_S ? 2 : 0;
        if (ps === pose[i]) continue;
        pose[i] = ps;
        place(i, ps);
        dirty = true;
      }
      if (dirty) {
        mesh.instanceMatrix.needsUpdate = true;
        iPose.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        mesh.computeBoundingSphere();
      }
    },
    dispose() {
      mesh.removeFromParent();
      mesh.dispose();
      geo.dispose();
      mat.dispose();
    },
  };
}
