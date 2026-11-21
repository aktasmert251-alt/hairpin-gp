// Generic suspension bridges at the OSM bridge positions (T-B, tracks.md §3.10): two-leg portal towers 165 m above the
// water, a 33 m box deck 64 m up, main and side span cables (parabolas) and hangers as one alpha-tested strip mesh.
// Night: deck-edge and cable lights with a slow, generic colour cycle. 3 draws for all bridges (structure, hangers,
// lights), no new programs. No replica of a specific bridge: proportions only.

import { Color, Group, Mesh, RepeatWrapping } from 'three';
import { envMaterial, EnvMode } from '../materials/shared';
import { canvasTexture } from '../mesh/textures';
import { boxInFrame, SBuf } from './stands';
import type { EnvContext, EnvPart } from './environment';

const TOWER_H = 165;
const DECK_H = 64;
const DECK_W = 16.5; // half width
const SIDE_SPAN = 260;
const HANGER_PITCH = 18;

export function createBridges(c: EnvContext): EnvPart & { triangles: number } {
  const { ex } = c;
  const group = new Group();
  group.name = 'bridges';
  const feats = ex.features.filter((f) => f.kind === 'bridge' && f.xz.length >= 2);
  const sea = ex.authoring.THEME.sea;
  if (!feats.length || !sea) return { root: group, triangles: 0, dispose: () => group.removeFromParent() };
  const W = (p: [number, number]): [number, number] => [(p[0] - ex.reg.cx) * ex.reg.k, (p[1] - ex.reg.cz) * ex.reg.k];

  const st = new SBuf();
  const hang = new SBuf();
  const lights = new SBuf();
  const steel = new Color(0.55, 0.57, 0.6), deckC = new Color(0.36, 0.37, 0.39), dark = new Color(0.16, 0.17, 0.18);
  const cableC = new Color(0.62, 0.64, 0.66), white = new Color(1, 1, 1);
  const y0 = sea.y;
  const deckY = y0 + DECK_H;
  const topY = y0 + TOWER_H - 3;

  for (const f of feats) {
    const [ax, az] = W(f.xz[0]!);
    const [bx, bz] = W(f.xz[1]!);
    const span = Math.hypot(bx - ax, bz - az);
    const dx = (bx - ax) / span, dz = (bz - az) / span;
    const nx = -dz, nz = dx;
    const P = (t: number, side: number, y: number): number[] => [ax + dx * t + nx * side, y, az + dz * t + nz * side];
    // Towers: two legs, three cross beams, a cap.
    for (const t of [0, span]) {
      const o = { x: ax + dx * t, y: y0 - 6, z: az + dz * t };
      for (const s of [-1, 1]) boxInFrame(st, o, [-3.5, 3.5], [s * (DECK_W + 1) - 2.5, s * (DECK_W + 1) + 2.5], [0, TOWER_H + 6], dx, dz, nx, nz, steel);
      for (const yb of [DECK_H - 4, 112, TOWER_H - 2]) boxInFrame(st, o, [-2.5, 2.5], [-DECK_W - 1, DECK_W + 1], [yb + 6, yb + 12], dx, dz, nx, nz, steel, true);
      boxInFrame(st, o, [-6, 6], [-DECK_W - 6, DECK_W + 6], [0, 8], dx, dz, nx, nz, dark);
    }
    // Deck (gentle camber on the main span) with parapets, side spans to the anchorages.
    const deckAt = (t: number): number => deckY + (t > 0 && t < span ? 3 * Math.sin((Math.PI * t) / span) : 0);
    const STEP = 30;
    for (let t = -SIDE_SPAN; t < span + SIDE_SPAN; t += STEP) {
      const t1 = Math.min(t + STEP, span + SIDE_SPAN);
      const ya = deckAt(t), yb = deckAt(t1);
      st.quad([P(t, -DECK_W, ya), P(t1, -DECK_W, yb), P(t, DECK_W, ya), P(t1, DECK_W, yb)], [0, 1, 0], deckC);
      st.quad([P(t, -DECK_W, ya - 3.5), P(t1, -DECK_W, yb - 3.5), P(t, DECK_W, ya - 3.5), P(t1, DECK_W, yb - 3.5)], [0, -1, 0], dark);
      for (const s of [-1, 1]) {
        st.quad([P(t, s * DECK_W, ya - 3.5), P(t1, s * DECK_W, yb - 3.5), P(t, s * DECK_W, ya + 1.1), P(t1, s * DECK_W, yb + 1.1)], [s * nx, 0, s * nz], steel);
        // Deck-edge lights every STEP / 2.
        for (const tt of [t, t + STEP / 2]) {
          const yy = deckAt(tt) + 1.2;
          lights.quad([P(tt - 0.6, s * DECK_W, yy), P(tt + 0.6, s * DECK_W, yy), P(tt - 0.6, s * DECK_W, yy + 0.5), P(tt + 0.6, s * DECK_W, yy + 0.5)], [s * nx, 0, s * nz], white);
        }
      }
    }
    // Anchorage blocks at both ends.
    for (const t of [-SIDE_SPAN, span + SIDE_SPAN]) {
      boxInFrame(st, { x: ax + dx * t, y: y0 - 6, z: az + dz * t }, [-14, 14], [-DECK_W - 4, DECK_W + 4], [0, DECK_H + 6], dx, dz, nx, nz, dark);
    }
    // Cables: main span parabola tower top → just above the deck at mid-span; side spans sag to the anchorages.
    const cableY = (t: number): number => {
      if (t >= 0 && t <= span) {
        const u = (2 * t) / span - 1;
        return deckAt(t) + 3 + (topY - deckY - 3) * u * u;
      }
      const u = t < 0 ? -t / SIDE_SPAN : (t - span) / SIDE_SPAN;
      return topY + (deckY + 2 - topY) * u - 10 * Math.sin(Math.PI * u);
    };
    for (const s of [-1, 1]) {
      const side = s * (DECK_W + 1);
      const CS = 15;
      for (let t = -SIDE_SPAN; t < span + SIDE_SPAN - 1e-6; t += CS) {
        const t1 = t + CS;
        const ya = cableY(t), yb = cableY(t1);
        const r = 0.7;
        st.quad([P(t, side - r, ya + r), P(t1, side - r, yb + r), P(t, side + r, ya + r), P(t1, side + r, yb + r)], [0, 1, 0], cableC);
        st.quad([P(t, side - r, ya - r), P(t1, side - r, yb - r), P(t, side - r, ya + r), P(t1, side - r, yb + r)], [-nx, 0, -nz], cableC);
        st.quad([P(t, side + r, ya - r), P(t1, side + r, yb - r), P(t, side + r, ya + r), P(t1, side + r, yb + r)], [nx, 0, nz], cableC);
        // Hangers: one vertical strip per segment, texture u in hanger pitches.
        if (t >= 0 && t1 <= span + 1e-6) {
          const base = hang.pos.length / 3;
          hang.quad([P(t, side, deckAt(t)), P(t1, side, deckAt(t1)), P(t, side, ya), P(t1, side, yb)], [nx, 0, nz], cableC);
          hang.uv.splice(base * 2, 8, t / HANGER_PITCH, 0, t1 / HANGER_PITCH, 0, t / HANGER_PITCH, 1, t1 / HANGER_PITCH, 1);
        }
        // Cable lights every 30 m.
        if (Math.round(t / CS) % 2 === 0) {
          lights.quad([P(t - 0.9, side, ya + 0.8), P(t + 0.9, side, ya + 0.8), P(t - 0.9, side, ya + 2.2), P(t + 0.9, side, ya + 2.2)], [s * nx, 0, s * nz], white);
        }
      }
    }
  }

  const hangerTex = canvasTexture(64, 8, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.fillStyle = '#c8ccd0';
    g.fillRect(w / 2 - 2, 0, 4, h);
  });
  hangerTex.wrapS = RepeatWrapping;
  const stGeo = st.geometry();
  const hangGeo = hang.geometry();
  const lightGeo = lights.geometry();
  const stMat = envMaterial(c.sh, { name: 'bridges.structure', family: 'opaque', vertexColor: true, roughness: 0.55, metalness: 0.4, wet: 0.4, flood: 0 });
  const hangMat = envMaterial(c.sh, { name: 'bridges.hangers', family: 'cutout', vertexColor: true, map: hangerTex, alphaTest: 0.3, coverage: 1, roughness: 0.5, metalness: 0.5, wet: 0, flood: 0 });
  const lightMat = envMaterial(c.sh, { name: 'bridges.lights', family: 'opaque', mode: EnvMode.Lamp, vertexColor: true, emissive: 0xffffff, emissiveIntensity: 0, wet: 0, flood: 0 });
  const meshes = [new Mesh(stGeo, stMat), new Mesh(hangGeo, hangMat), new Mesh(lightGeo, lightMat)];
  ['bridges.structure', 'bridges.hangers', 'bridges.lights'].forEach((n, k) => {
    meshes[k]!.name = n;
    meshes[k]!.matrixAutoUpdate = false;
    group.add(meshes[k]!);
  });
  meshes[0]!.castShadow = c.quality.id !== 'low';
  meshes[0]!.receiveShadow = true;

  let lightK = 0;
  const col = new Color();
  return {
    root: group,
    triangles: (stGeo.index!.count + hangGeo.index!.count + lightGeo.index!.count) / 3,
    applyConditions(cc) {
      lightK = cc.tod === 'night' ? 1 : cc.tod === 'sunset' ? 0.4 : 0;
      lightMat.emissiveIntensity = 6 * lightK;
      meshes[2]!.visible = lightK > 0;
    },
    update(_cam, frame) {
      if (lightK <= 0) return;
      // Slow generic cycle: warm white → amber → cool blue → violet, ≈ 90 s per loop.
      const h = (0.08 + 0.5 * (0.5 - 0.5 * Math.cos((frame.time * 2 * Math.PI) / 90))) % 1;
      lightMat.emissive.copy(col.setHSL(h, 0.55, 0.62));
    },
    setQuality(qp) {
      meshes[0]!.castShadow = qp.id !== 'low';
    },
    dispose() {
      stGeo.dispose();
      hangGeo.dispose();
      lightGeo.dispose();
      hangerTex.dispose();
      stMat.dispose();
      hangMat.dispose();
      lightMat.dispose();
      group.removeFromParent();
    },
  };
}
