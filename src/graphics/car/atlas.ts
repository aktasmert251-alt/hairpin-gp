// Livery atlas layout (one canvas per car). UV v = 0 is the bottom of the canvas (CanvasTexture flipY).
//   v 0.000–0.250  left side elevation  (model +x side; u = nose → tail)
//   v 0.250–0.500  right side elevation (model −x side; drawn mirrored so text reads correctly)
//   v 0.500–0.875  top plan view (u = nose → tail, v = model x from −1.05 to +1.05)
//   v 0.875–1.000  16 swatch cells (flat colours, helmet band, carbon weave)
// Paint triangles are assigned per face: down-facing at plank level (y < 0.1, inside the side band's carbon strip) → carbon cell (higher undersides such as
// the sidepod undercut keep the side elevation: a per-face switch there drew a jagged black edge); up-facing nose/front-wing/rear-wing → plan view;
// other up-facing bodywork → side elevation by height (seam-free); everything else → side by sign of nx.

import { BufferAttribute, type BufferGeometry, Vector3 } from 'three';

export const AT = {
  zNose: 3.12,
  zTail: -2.68,
  yMin: -0.02,
  yMax: 1.1,
  xHalf: 1.05,
  leftV: [0.0, 0.25] as const,
  rightV: [0.25, 0.5] as const,
  topV: [0.5, 0.875] as const,
  swatchV: [0.875, 1.0] as const,
  cells: 16,
} as const;

/** Swatch cells in the paint atlas. */
export const SW = {
  primary: 0, secondary: 1, accent: 2, carbon: 3, black: 4, white: 5, tcam: 6, suit: 7, glove: 8, inlet: 9,
  /** cells 10–15: helmet band (u wraps around the helmet). */
  helmet: 10,
} as const;

export const uOfZ = (z: number): number => (AT.zNose - z) / (AT.zNose - AT.zTail);
export const vSide = (y: number, right: boolean): number => {
  const [a, b] = right ? AT.rightV : AT.leftV;
  return a + ((y - AT.yMin) / (AT.yMax - AT.yMin)) * (b - a);
};
export const vTop = (x: number): number => AT.topV[0] + ((x + AT.xHalf) / (2 * AT.xHalf)) * (AT.topV[1] - AT.topV[0]);
export const cellUv = (cell: number): [number, number] => [(cell + 0.5) / AT.cells, (AT.swatchV[0] + AT.swatchV[1]) / 2];

/** Per-vertex tag: −1 = project, ≥ 0 = swatch cell, 100 = helmet wrap. Added to parts before merging. */
export function tagPart(g: BufferGeometry, tag: number): BufferGeometry {
  const n = g.getAttribute('position').count;
  g.setAttribute('aTag', new BufferAttribute(new Float32Array(n).fill(tag), 1));
  return g;
}

/** Assigns paint-atlas UVs on a merged non-indexed geometry with an `aTag` attribute, then drops the tag. */
export function projectPaintUv(g: BufferGeometry, helmetCentre: Vector3 = new Vector3(0, 0.79, 0.26)): BufferGeometry {
  const p = g.getAttribute('position');
  const tag = g.getAttribute('aTag');
  const uv = new Float32Array(p.count * 2);
  const a = new Vector3(), b = new Vector3(), c = new Vector3(), n = new Vector3(), e1 = new Vector3(), e2 = new Vector3();
  const [cu, cv] = cellUv(SW.carbon);
  for (let i = 0; i < p.count; i += 3) {
    // A swatch tag on any vertex wins (crisp cockpit-tub and inlet edges).
    const t = tag ? Math.max(tag.getX(i), tag.getX(i + 1), tag.getX(i + 2)) : -1;
    if (t >= 0 && t < 100) {
      const [u, v] = cellUv(t);
      for (let k = 0; k < 3; k++) uv.set([u, v], (i + k) * 2);
      continue;
    }
    a.fromBufferAttribute(p, i);
    b.fromBufferAttribute(p, i + 1);
    c.fromBufferAttribute(p, i + 2);
    if (t >= 100) {
      // Helmet band: u = azimuth around the helmet (front = centre of band), v = height in the swatch strip.
      for (let k = 0; k < 3; k++) {
        const q = k === 0 ? a : k === 1 ? b : c;
        const az = Math.atan2(q.x - helmetCentre.x, q.z - helmetCentre.z); // 0 = front
        const u0 = (SW.helmet + 0.02) / AT.cells;
        const u1 = (AT.cells - 0.02) / AT.cells;
        const uu = u0 + (u1 - u0) * (0.5 + az / (2 * Math.PI));
        const hv = Math.min(1, Math.max(0, (q.y - (helmetCentre.y - 0.16)) / 0.32));
        uv.set([uu, AT.swatchV[0] + 0.004 + hv * (AT.swatchV[1] - AT.swatchV[0] - 0.008)], (i + k) * 2);
      }
      continue;
    }
    n.crossVectors(e1.subVectors(b, a), e2.subVectors(c, a));
    const len = n.length() || 1;
    const ny = n.y / len;
    const nx = n.x / len;
    const zc = (a.z + b.z + c.z) / 3;
    const xc = (a.x + b.x + c.x) / 3;
    const yc = (a.y + b.y + c.y) / 3;
    for (let k = 0; k < 3; k++) {
      const q = k === 0 ? a : k === 1 ? b : c;
      let u: number, v: number;
      if (ny > 0.55 && (zc > 2.0 || zc < -2.08)) {
        // Plan view only for the nose/front wing and the rear wing (numbers, sponsor).
        u = uOfZ(q.z);
        v = vTop(q.x);
      } else if (ny > 0.55) {
        // Other up-facing bodywork samples the side elevation by height: top and sides always agree.
        u = uOfZ(q.z);
        v = vSide(q.y, xc < 0);
      } else if (ny < -0.6 && yc < 0.1) {
        u = cu + (uOfZ(q.z) % 0.02) * 0.5;
        v = cv;
      } else {
        // Near-horizontal faces (undercut, pod bottoms) pick the side by position, not by the sign of a tiny nx that
        // flips face to face (that drew a white/colour sawtooth under the sidepods).
        u = uOfZ(q.z);
        v = vSide(q.y, Math.abs(nx) < 0.35 ? xc < 0 : nx < 0);
      }
      uv[(i + k) * 2] = u;
      uv[(i + k) * 2 + 1] = v;
    }
  }
  g.setAttribute('uv', new BufferAttribute(uv, 2));
  if (tag) g.deleteAttribute('aTag');
  return g;
}
