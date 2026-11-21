// Trackside furniture (Ç7): start gantry (5 × 2 lamps from frame.lights), marshal posts with LED flag panels
// (frame.yellowSectors), perimeter and braking-zone sponsor boards (fictional sponsors, DESIGN.md §1.4.3), distance
// boards 150/100/50, two overhead banner gantries, painted HAIRPIN GP wordmarks on the T1 / T12 run-offs.

import {
  BufferAttribute, BufferGeometry, CircleGeometry, Color, Group, InstancedMesh, Matrix4, Mesh, PlaneGeometry, Quaternion, Vector3, type Texture,
} from 'three';
import { envMaterial, EnvMode } from '../materials/shared';
import type { Vec3 } from '../../contracts/common';
import type { RenderFrame } from '../../contracts/render';
import type { TrackFrame } from '../../contracts/track';
import { canvasTexture, makeRand } from '../mesh/textures';
import { boxInFrame, SBuf } from './stands';
import type { EnvContext, EnvPart } from './environment';

interface Sponsor { name: string; bg: string; fg: string; accent: string; text: string; small?: string; skew?: boolean; weight: number; track: number; mark: string }

export const SPONSORS: readonly Sponsor[] = [
  { name: 'kuzey', bg: '#0E2A47', fg: '#FFFFFF', accent: '#6EC1FF', text: 'KUZEY AIR', weight: 700, track: 0.08, mark: 'chevron' },
  { name: 'vela', bg: '#101214', fg: '#FFB000', accent: '#FFB000', text: 'VELA FUEL', weight: 800, track: 0.02, mark: 'sail', skew: true },
  { name: 'yali', bg: '#0B3D2E', fg: '#7CE0B5', accent: '#7CE0B5', text: 'YALI ENERJİ', weight: 600, track: 0.1, mark: 'arcs' },
  { name: 'dalga', bg: '#F5F6F8', fg: '#0A0C0F', accent: '#2F6BFF', text: 'DALGA TEK', weight: 700, track: 0.04, mark: 'pulse' },
  { name: 'lale', bg: '#B3122E', fg: '#F4E9D0', accent: '#F4E9D0', text: 'LALE ÇAY', weight: 700, track: 0.04, mark: 'tulip' },
  { name: 'kervan', bg: '#4A1029', fg: '#D8B45A', accent: '#D8B45A', text: 'KERVAN BANK', weight: 700, track: 0.06, mark: 'arch' },
  { name: 'mavi', bg: '#0057B8', fg: '#FFFFFF', accent: '#FFFFFF', text: 'MAVİ ROTA', small: 'LOJİSTİK', weight: 800, track: 0.03, mark: 'route' },
  { name: 'sekant', bg: '#0A0A0A', fg: '#C9CDD2', accent: '#C9CDD2', text: 'SEKANT', weight: 500, track: 0.24, mark: 'ring' },
  { name: 'simit', bg: '#E8A33D', fg: '#5B3A1E', accent: '#5B3A1E', text: 'SİMİT EXPRESS', weight: 800, track: 0.02, mark: 'sesame', skew: true },
  { name: 'apex', bg: '#0A0C0F', fg: '#FFFFFF', accent: '#FF4B1F', text: 'HAIRPIN', small: 'GP', weight: 800, track: 0.06, mark: 'apex' },
];
/** The car sponsors added in 2026-10 (colours / wordmarks after src/graphics/car/sponsors.ts), perimeter boards only
 *  (atlas indices 10–18). Kept separate so SPONSORS (building accents, pit wordmark) stays unchanged. */
export const CAR_SPONSORS: readonly Sponsor[] = [
  { name: 'akLastik', bg: '#121212', fg: '#FFFFFF', accent: '#FFC400', text: 'AK LASTİK', weight: 800, track: 0.0, mark: 'tyre', skew: true },
  { name: 'ayro', bg: '#0A4D5C', fg: '#FFFFFF', accent: '#FF8A1F', text: 'AYRO OIL', weight: 800, track: 0.04, mark: 'drop' },
  { name: 'tevenin', bg: '#F5F6F8', fg: '#3A2E9C', accent: '#3A2E9C', text: 'TEVENİN', weight: 500, track: 0.3, mark: 'dot' },
  { name: 'goksu', bg: '#1C6FB8', fg: '#FFFFFF', accent: '#BFE3FF', text: 'GÖKSU', small: 'HAVACILIK', weight: 600, track: 0.14, mark: 'wing' },
  { name: 'lazerta', bg: '#0B0D10', fg: '#4DFF7A', accent: '#4DFF7A', text: 'LAZERTA', weight: 700, track: 0.18, mark: 'beam' },
  { name: 'voltara', bg: '#FFD400', fg: '#111111', accent: '#111111', text: 'VOLTARA', small: 'ENERJİ', weight: 800, track: 0.02, mark: 'bolt', skew: true },
  { name: 'korvis', bg: '#5B2A86', fg: '#FFFFFF', accent: '#E6C8FF', text: 'KORVİS', weight: 600, track: 0.08, mark: 'diamond' },
  { name: 'nevra', bg: '#FF5A4E', fg: '#FFFFFF', accent: '#FFFFFF', text: 'NEVRA SPOR', weight: 800, track: 0.0, mark: 'speed', skew: true },
  { name: 'tarven', bg: '#1B2A4A', fg: '#FFB547', accent: '#FFB547', text: 'TARVEN', small: 'LOJİSTİK', weight: 700, track: 0.08, mark: 'crate' },
];
/** Board pool: SPONSORS (0–9) then CAR_SPONSORS (10–18). */
export const BOARD_SPONSORS: readonly Sponsor[] = [...SPONSORS, ...CAR_SPONSORS];
export const FONT = '"Barlow Condensed", "Arial Narrow", sans-serif';

export async function loadFonts(): Promise<void> {
  if (typeof FontFace === 'undefined' || !document.fonts) return;
  const base = `${import.meta.env.BASE_URL}assets/gra/fonts/barlow-condensed-`;
  const faces: FontFace[] = [];
  for (const w of [500, 600, 700, 800]) {
    faces.push(new FontFace('Barlow Condensed', `url(${base}latin-${w}-normal.woff2)`, { weight: String(w) }));
    faces.push(new FontFace('Barlow Condensed', `url(${base}latin-ext-${w}-normal.woff2)`, { weight: String(w), unicodeRange: 'U+0100-024F, U+0130-0131' }));
  }
  await Promise.all(faces.map(async (f) => {
    try {
      await f.load();
      document.fonts.add(f);
    } catch {
      // Fallback font is fine for a sandbox; the game preloads its fonts.
    }
  }));
}

function drawMark(g: CanvasRenderingContext2D, s: Sponsor, x: number, y: number, h: number): number {
  g.save();
  g.fillStyle = s.accent;
  g.strokeStyle = s.accent;
  g.lineWidth = h * 0.09;
  const w = h * 0.9;
  g.beginPath();
  switch (s.mark) {
    case 'chevron': g.moveTo(x, y + h * 0.75); g.lineTo(x + w / 2, y + h * 0.2); g.lineTo(x + w, y + h * 0.75); g.lineTo(x + w * 0.78, y + h * 0.75); g.lineTo(x + w / 2, y + h * 0.45); g.lineTo(x + w * 0.22, y + h * 0.75); g.fill(); break;
    case 'sail': g.moveTo(x + w * 0.2, y + h * 0.1); g.lineTo(x + w, y + h * 0.85); g.lineTo(x + w * 0.2, y + h * 0.85); g.fill(); break;
    case 'arcs': g.arc(x + w / 2, y + h * 0.75, w * 0.42, Math.PI, 0); g.stroke(); g.beginPath(); g.arc(x + w / 2, y + h * 0.75, w * 0.22, Math.PI, 0); g.stroke(); break;
    case 'pulse': g.moveTo(x, y + h / 2); g.lineTo(x + w * 0.35, y + h / 2); g.lineTo(x + w * 0.5, y + h * 0.15); g.lineTo(x + w * 0.62, y + h * 0.85); g.lineTo(x + w * 0.72, y + h / 2); g.lineTo(x + w, y + h / 2); g.stroke(); break;
    case 'tulip': for (const o of [-0.22, 0, 0.22]) { g.beginPath(); g.ellipse(x + w / 2 + o * w, y + h * 0.42, w * 0.12, h * 0.3, o * 1.4, 0, Math.PI * 2); g.fill(); } g.fillRect(x + w / 2 - 2, y + h * 0.55, 4, h * 0.35); break;
    case 'arch': g.arc(x + w / 2, y + h * 0.55, w * 0.38, Math.PI, 0); g.lineTo(x + w * 0.88, y + h * 0.9); g.moveTo(x + w * 0.12, y + h * 0.55); g.lineTo(x + w * 0.12, y + h * 0.9); g.stroke(); break;
    case 'route': g.moveTo(x, y + h * 0.75); g.lineTo(x + w * 0.65, y + h * 0.75); g.lineTo(x + w * 0.65, y + h * 0.3); g.stroke(); g.beginPath(); g.moveTo(x + w * 0.45, y + h * 0.35); g.lineTo(x + w * 0.65, y + h * 0.1); g.lineTo(x + w * 0.85, y + h * 0.35); g.fill(); break;
    case 'ring': g.arc(x + w / 2, y + h / 2, h * 0.36, 0, Math.PI * 2); g.lineWidth = h * 0.05; g.stroke(); g.beginPath(); g.moveTo(x + w / 2, y + h / 2); g.lineTo(x + w / 2 + h * 0.06, y + h * 0.2); g.stroke(); break;
    case 'sesame': g.arc(x + w / 2, y + h / 2, h * 0.34, 0, Math.PI * 2); g.lineWidth = h * 0.12; g.stroke(); g.fillStyle = '#F4E9D0'; for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; g.fillRect(x + w / 2 + Math.cos(a) * h * 0.34 - 2, y + h / 2 + Math.sin(a) * h * 0.34 - 2, 4, 4); } break;
    case 'tyre': g.arc(x + w / 2, y + h / 2, h * 0.36, 0, Math.PI * 2); g.lineWidth = h * 0.14; g.stroke(); g.beginPath(); g.arc(x + w / 2, y + h / 2, h * 0.1, 0, Math.PI * 2); g.fill(); break;
    case 'drop': g.moveTo(x + w / 2, y + h * 0.1); g.quadraticCurveTo(x + w * 0.9, y + h * 0.6, x + w / 2, y + h * 0.88); g.quadraticCurveTo(x + w * 0.1, y + h * 0.6, x + w / 2, y + h * 0.1); g.fill(); break;
    case 'dot': g.arc(x + w / 2, y + h / 2, h * 0.2, 0, Math.PI * 2); g.fill(); break;
    case 'wing': g.moveTo(x, y + h * 0.7); g.quadraticCurveTo(x + w * 0.5, y + h * 0.1, x + w, y + h * 0.25); g.quadraticCurveTo(x + w * 0.55, y + h * 0.45, x + w * 0.3, y + h * 0.75); g.fill(); break;
    case 'beam': g.fillRect(x, y + h * 0.44, w, h * 0.12); g.fillRect(x + w * 0.1, y + h * 0.28, w * 0.5, h * 0.06); g.fillRect(x + w * 0.4, y + h * 0.66, w * 0.5, h * 0.06); break;
    case 'bolt': g.moveTo(x + w * 0.6, y + h * 0.05); g.lineTo(x + w * 0.2, y + h * 0.55); g.lineTo(x + w * 0.48, y + h * 0.55); g.lineTo(x + w * 0.36, y + h * 0.95); g.lineTo(x + w * 0.82, y + h * 0.4); g.lineTo(x + w * 0.54, y + h * 0.4); g.closePath(); g.fill(); break;
    case 'diamond': g.moveTo(x + w / 2, y + h * 0.08); g.lineTo(x + w * 0.88, y + h / 2); g.lineTo(x + w / 2, y + h * 0.92); g.lineTo(x + w * 0.12, y + h / 2); g.closePath(); g.fill(); break;
    case 'speed': for (let k = 0; k < 3; k++) g.fillRect(x + w * (0.1 + 0.12 * k), y + h * (0.28 + 0.17 * k), w * (0.8 - 0.12 * k), h * 0.1); break;
    case 'crate': g.lineWidth = h * 0.08; g.strokeRect(x + w * 0.12, y + h * 0.18, w * 0.76, h * 0.64); g.beginPath(); g.moveTo(x + w * 0.12, y + h * 0.18); g.lineTo(x + w * 0.88, y + h * 0.82); g.moveTo(x + w * 0.88, y + h * 0.18); g.lineTo(x + w * 0.12, y + h * 0.82); g.stroke(); break;
    case 'apex': g.moveTo(x + w * 0.1, y + h * 0.85); g.lineTo(x + w * 0.5, y + h * 0.12); g.lineTo(x + w * 0.9, y + h * 0.85); g.lineTo(x + w * 0.72, y + h * 0.85); g.lineTo(x + w * 0.5, y + h * 0.45); g.lineTo(x + w * 0.28, y + h * 0.85); g.fill(); g.fillRect(x + w * 0.3, y + h * 0.58, w * 0.4, h * 0.08); break;
  }
  g.restore();
  return w;
}

/** One sponsor board into the rect (any aspect). `transparentBg` for the painted run-off wordmark. */
export function drawSponsor(g: CanvasRenderingContext2D, s: Sponsor, x: number, y: number, w: number, h: number, transparentBg = false): void {
  g.save();
  g.beginPath();
  g.rect(x, y, w, h);
  g.clip();
  if (!transparentBg) {
    g.fillStyle = s.bg;
    g.fillRect(x, y, w, h);
  }
  const th = Math.min(h * 0.62, (w / Math.max(4, s.text.length + (s.small ? 3 : 0))) * 1.55);
  g.font = `${s.weight} ${th}px ${FONT}`;
  (g as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = `${s.track * th}px`;
  const textW = g.measureText(s.text).width;
  g.font = `${s.weight} ${th * 0.42}px ${FONT}`;
  const smallW = s.small ? g.measureText(s.small).width + th * 0.25 : 0;
  const markW = th * 0.9;
  const total = markW + th * 0.35 + textW + smallW;
  let cx = x + (w - total) / 2;
  const cy = y + h / 2;
  drawMark(g, s, cx, cy - th * 0.5, th);
  cx += markW + th * 0.35;
  g.save();
  if (s.skew) {
    g.translate(cx, cy);
    g.transform(1, 0, -0.2126, 1, 0, 0);
    g.translate(-cx, -cy);
  }
  g.fillStyle = s.fg;
  g.textBaseline = 'middle';
  g.font = `${s.weight} ${th}px ${FONT}`;
  g.fillText(s.text, cx, cy + th * 0.04);
  if (s.small) {
    g.font = `${s.weight} ${th * 0.42}px ${FONT}`;
    g.fillStyle = s.name === 'apex' ? s.accent : s.fg;
    if (s.name === 'apex') {
      g.font = `${s.weight} ${th}px ${FONT}`;
      g.fillText(s.small, cx + textW + th * 0.2, cy + th * 0.04);
    } else g.fillText(s.small, cx + textW + th * 0.25, cy + th * 0.22);
  }
  g.restore();
  g.restore();
}

/** Atlas layout (2048 × 3072): rows of 6:1 perimeter cells, 2:1 big boards, 1:1 distance boards, 12:1 banners, run-off
 *  decal; below y 2048 the perimeter cells of CAR_SPONSORS (indices 10–18). */
const ATLAS = 2048;
const ATLAS_H = 3072;
type Cell = [number, number, number, number]; // x, y, w, h in px
function cells() {
  const perim: Cell[] = [];
  const big: Cell[] = [];
  const dist: Cell[] = [];
  const banner: Cell[] = [];
  for (let k = 0; k < 10; k++) perim.push([(k % 2) * 1024, Math.floor(k / 2) * 170, 1024, 170]);
  for (let k = 0; k < CAR_SPONSORS.length; k++) perim.push([(k % 2) * 1024, 2048 + Math.floor(k / 2) * 170, 1024, 170]);
  for (let k = 0; k < 10; k++) big.push([(k % 4) * 512, 850 + Math.floor(k / 4) * 256, 512, 256]);
  for (let k = 0; k < 3; k++) dist.push([1024 + k * 256, 1362, 256, 256]);
  for (let k = 0; k < 2; k++) banner.push([0, 1618 + k * 170, 2048, 170]);
  // Big-board row 3 has slots 8, 9 only: the decal takes the free right half (it overlapped big[8], big[9]).
  const decal: Cell = [1024, 1362, 1024, 256];
  return { perim, big, dist, banner, decal };
}

function buildAtlas(): Texture {
  const C = cells();
  return canvasTexture(ATLAS, ATLAS_H, (g) => {
    g.clearRect(0, 0, ATLAS, ATLAS_H);
    CAR_SPONSORS.forEach((s, k) => drawSponsor(g, s, ...C.perim[10 + k]!));
    SPONSORS.forEach((s, k) => {
      const [x, y, w, h] = C.perim[k]!;
      drawSponsor(g, s, x, y, w, h);
      const [bx, by, bw, bh] = C.big[k]!;
      drawSponsor(g, s, bx, by, bw, bh);
    });
    ['150', '100', '50'].forEach((t, k) => {
      const [x, y, w, h] = C.dist[k]!;
      g.fillStyle = '#0A0C0F';
      g.fillRect(x, y, w, h);
      g.strokeStyle = '#F2F4F7';
      g.lineWidth = 10;
      g.strokeRect(x + 8, y + 8, w - 16, h - 16);
      g.fillStyle = '#F2F4F7';
      g.font = `800 ${h * 0.62}px ${FONT}`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(t, x + w / 2, y + h / 2 + 6);
      g.textAlign = 'left';
    });
    drawSponsor(g, SPONSORS[0]!, ...C.banner[0]!);
    drawSponsor(g, SPONSORS[3]!, ...C.banner[1]!);
    drawSponsor(g, SPONSORS[9]!, ...C.decal, true);
  });
}

/** Adds an all-white `color` attribute (geometries drawn by vertex-colour env families). */
function whiteColors<T extends BufferGeometry>(g: T): T {
  g.setAttribute('color', new BufferAttribute(new Float32Array(g.getAttribute('position').count * 3).fill(1), 3));
  return g;
}

class QBuf {
  pos: number[] = []; nor: number[] = []; uv: number[] = []; idx: number[] = [];
  quad(p: number[][], n: number[], cell: Cell, flipU = false): void {
    const b = this.pos.length / 3;
    const [cx, cy, cw, ch] = cell;
    const u0 = (cx + 1) / ATLAS, u1 = (cx + cw - 1) / ATLAS;
    const v0 = 1 - (cy + ch - 1) / ATLAS_H, v1 = 1 - (cy + 1) / ATLAS_H;
    const uvs = [[u0, v0], [u1, v0], [u0, v1], [u1, v1]];
    p.forEach((q, k) => {
      this.pos.push(q[0]!, q[1]!, q[2]!);
      this.nor.push(n[0]!, n[1]!, n[2]!);
      const uv = uvs[k]!;
      this.uv.push(flipU ? u0 + u1 - uv[0]! : uv[0]!, uv[1]!);
    });
    // p = [bottom-left, bottom-right, top-left, top-right] seen from the front.
    this.idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
  }
  geometry(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute('normal', new BufferAttribute(new Float32Array(this.nor), 3));
    g.setAttribute('uv', new BufferAttribute(new Float32Array(this.uv), 2));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

export async function createTrackside(c: EnvContext): Promise<EnvPart & { triangles: number }> {
  const { track, ex } = c;
  const ground = c.ground!;
  const { data, query: q } = track;
  const L = data.length;
  const S = (s: number): number => q.wrapS(s * ex.sScale);
  const f: TrackFrame = { s: 0, px: 0, py: 0, pz: 0, tx: 1, tz: 0, lx: 0, lz: -1, halfWidthL: 0, halfWidthR: 0, crossSlope: 0, curvature: 0, vCurvature: 0, grade: 0, sector: 0 };
  const P: Vec3 = { x: 0, y: 0, z: 0 };
  await loadFonts();
  const atlas = buildAtlas();
  const C = cells();
  const boards = new QBuf();
  const decals = new QBuf();
  const steel = new SBuf();
  const steelC = new Color(0.1, 0.105, 0.11);
  const whiteC = new Color(0.66, 0.66, 0.64);
  const wallAt = (s: number, side: 1 | -1): number => (side === 1 ? data.wallL : data.wallR)[Math.round(q.wrapS(s)) % data.count]!;
  const inPitRange = (s: number): boolean => q.wrapS(s - ex.pitRange.from) <= q.wrapS(ex.pitRange.to - ex.pitRange.from);

  /** Upright board facing the track at (s, side), centred `w` wide, bottom at `y0` above ground, `back` m behind the wall. */
  const board = (s: number, side: 1 | -1, w: number, h: number, y0: number, back: number, cell: Cell, posts: boolean): void => {
    q.frameAt(s, f);
    const d = side * (wallAt(s, side) + back);
    q.worldFromSD(s, d, P);
    const gy = ground.height(P.x, P.z);
    const nx = -side * f.lx, nz = -side * f.lz; // toward the track
    const ux = nz, uz = -nx; // left-to-right as seen from the track
    const bl = [P.x - ux * w / 2, gy + y0, P.z - uz * w / 2];
    const br = [P.x + ux * w / 2, gy + y0, P.z + uz * w / 2];
    boards.quad([bl, br, [bl[0]!, bl[1]! + h, bl[2]!], [br[0]!, br[1]! + h, br[2]!]], [nx, 0, nz], cell);
    // Back side (plain frame colour) + posts.
    const o = { x: P.x - nx * 0.06, y: gy, z: P.z - nz * 0.06 };
    boxInFrame(steel, o, [-w / 2, w / 2], [0, 0.08], [y0, y0 + h], ux, uz, -nx, -nz, steelC);
    if (posts) for (const u of [-w / 2 + 0.3, w / 2 - 0.3]) boxInFrame(steel, o, [u - 0.06, u + 0.06], [0.08, 0.2], [0, y0], ux, uz, -nx, -nz, steelC);
  };

  // ---- perimeter boards on the straights (A-B-A rhythm, ≤ 3 sponsors per straight) -------------------------
  const TS = ex.authoring.TRACKSIDE;
  const pitSide = ex.pitSide;
  // Sponsor triples not given by the authoring are picked deterministically from the track id.
  const pickRand = makeRand([...data.id].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7));
  const straights = TS.boardStraights.map((st): { from: number; to: number; side: 1 | -1; sponsors: readonly number[] } => {
    if (st.sponsors) return { ...st, sponsors: st.sponsors };
    const n = BOARD_SPONSORS.length;
    const a = Math.floor(pickRand() * n);
    return { ...st, sponsors: [a, (a + 1 + Math.floor(pickRand() * (n - 1))) % n, (a + 1 + Math.floor(pickRand() * (n - 1))) % n] };
  });
  let triangles = 0;
  for (const st of straights) {
    const a = S(st.from);
    const len = q.wrapS(S(st.to) - a);
    const n = Math.floor(len / 6.4);
    for (let k = 0; k < n; k++) {
      const s = q.wrapS(a + k * 6.4 + 3.2);
      if (st.side === pitSide && inPitRange(s)) continue;
      const pattern = [0, 1, 0, 2, 0, 1][k % 6]!;
      board(s, st.side, 6, 1, 1.25, 0.75, C.perim[st.sponsors[pattern]!]!, true);
    }
  }
  // Braking-zone boards (4 × 2 m) and distance boards before the authored corners (outside of the approach).
  TS.distanceBoardCorners.forEach((dc, k0) => {
    const cc = data.corners.find((x) => x.n === dc.n);
    if (!cc) return;
    const k = k0 % 4;
    const side = dc.side;
    for (const [m, idx] of [[150, 0], [100, 1], [50, 2]] as [number, number][]) {
      const s = q.wrapS(cc.entryS - m);
      q.frameAt(s, f);
      // Distance boards stand on the verge just inside the barrier.
      board(s, side, 1.2, 1.0, 0.7, -1.2, C.dist[idx]!, true);
    }
    board(q.wrapS(cc.entryS - 210), side, 4, 2, 0.9, 1.2, C.big[[1, 6, 4, 8][k]!]!, true);
    board(q.wrapS(cc.entryS - 230), side, 4, 2, 0.9, 1.2, C.big[[3, 2, 0, 7][k]!]!, true);
  });

  // ---- banner gantries (s ≈ 1,600 and 4,400) and the start gantry (s = 0) ----------------------------------
  const gantry = (s: number, cell: Cell | null, height: number, extraL = 0): { o: { x: number; y: number; z: number }; ux: number; uz: number; nx: number; nz: number; span: number } => {
    q.frameAt(s, f);
    const dl = Math.min(wallAt(s, 1), f.halfWidthL + 4) + extraL;
    const dr = Math.min(wallAt(s, -1), f.halfWidthR + 4);
    q.worldFromSD(s, (dl - dr) / 2, P);
    const span = dl + dr;
    const o = { x: P.x, y: P.y, z: P.z };
    const ux = -f.lx, uz = -f.lz; // left → right across the track
    const nx = -f.tx, nz = -f.tz; // facing approaching cars
    for (const u of [-span / 2, span / 2]) boxInFrame(steel, o, [u - 0.3, u + 0.3], [-0.3, 0.3], [-0.5, height + 2.2], ux, uz, nx, nz, steelC);
    boxInFrame(steel, o, [-span / 2 - 0.3, span / 2 + 0.3], [-0.45, 0.45], [height + 2.0, height + 2.6], ux, uz, nx, nz, steelC);
    if (cell) {
      for (const dir of [1, -1]) {
        const fx = dir * nx, fz = dir * nz;
        const off = 0.5;
        const w = Math.min(24, span - 1);
        const bl = [o.x - ux * w / 2 * dir + fx * off, o.y + height, o.z - uz * w / 2 * dir + fz * off];
        const br = [o.x + ux * w / 2 * dir + fx * off, o.y + height, o.z + uz * w / 2 * dir + fz * off];
        boards.quad([bl, br, [bl[0]!, bl[1]! + 2, bl[2]!], [br[0]!, br[1]! + 2, br[2]!]], [fx, 0, fz], cell);
      }
      boxInFrame(steel, o, [-Math.min(12, span / 2 - 0.5), Math.min(12, span / 2 - 0.5)], [-0.4, 0.4], [height - 0.05, height + 2.0], ux, uz, nx, nz, whiteC);
    }
    return { o, ux, uz, nx, nz, span };
  };
  TS.gantries.forEach((gs, k) => gantry(S(gs), C.banner[k % C.banner.length]!, 6.5));
  const g0 = gantry(0, null, 6);
  // Light housing with 5 columns × 2 lamps, facing the grid.
  const lampsY = g0.o.y + 6.6;
  boxInFrame(steel, g0.o, [-2.6, 2.6], [-0.35, 0.25], [6.0, 8.0], g0.ux, g0.uz, g0.nx, g0.nz, new Color(0.05, 0.05, 0.055));
  const lampGeo = whiteColors(new CircleGeometry(0.2, 16));
  // Unlit lamps (EnvMode.Lamp in the shared `inst` program): emissive = instance colour.
  const lampMat = envMaterial(c.sh, { name: 'gantry.lamps', family: 'inst', mode: EnvMode.Lamp, vertexColor: true, emissive: 0xffffff, roughness: 0.4, wet: 0, flood: 0 });
  const lamps = new InstancedMesh(lampGeo, lampMat, 10);
  lamps.name = 'gantry.lamps';
  const m4 = new Matrix4();
  const quat = new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), new Vector3(g0.nx, 0, g0.nz));
  for (let col = 0; col < 5; col++) {
    for (let row = 0; row < 2; row++) {
      const u = (col - 2) * 1.0;
      // On the housing face toward the grid (+n).
      m4.compose(new Vector3(g0.o.x + g0.ux * u + g0.nx * 0.27, lampsY + row * 0.62, g0.o.z + g0.uz * u + g0.nz * 0.27), quat, new Vector3(1, 1, 1));
      lamps.setMatrixAt(col * 2 + row, m4);
    }
  }
  const lampOff = new Color(0.08, 0.004, 0.004);
  const lampOn = new Color(14, 0.25, 0.05);
  for (let k = 0; k < 10; k++) lamps.setColorAt(k, lampOff);
  let lastLit = -1;

  // ---- marshal posts with LED panels ----------------------------------------------------------------------
  const posts: { s: number; side: 1 | -1; sector: number }[] = [];
  // 21 posts per lap; long laps (Eifel) one every ≈ 450 m.
  const NPOST = Math.max(21, Math.round(L / 450));
  for (let k = 0; k < NPOST; k++) {
    const s = q.wrapS(125 + (L / NPOST) * k);
    let side: 1 | -1 = k % 2 === 0 ? -1 : 1;
    if (side === pitSide && inPitRange(s)) side = (-pitSide) as 1 | -1;
    posts.push({ s, side, sector: q.sectorAt(s) });
  }
  const panelGeo = whiteColors(new PlaneGeometry(1.1, 0.7));
  const panelMat = lampMat;
  const panels = new InstancedMesh(panelGeo, panelMat, posts.length);
  panels.name = 'marshal.panels';
  const cabinC = new Color(0.68, 0.68, 0.68);
  const roofC = new Color(0.7, 0.12, 0.01);
  const plinthC = new Color(0.12, 0.12, 0.125);
  const winC = new Color(0.02, 0.025, 0.03);
  posts.forEach((p, k) => {
    q.frameAt(p.s, f);
    const w = wallAt(p.s, p.side);
    q.worldFromSD(p.s, p.side * (w + 2.6), P);
    const gy = ground.height(P.x, P.z);
    const nx = -p.side * f.lx, nz = -p.side * f.lz;
    const ux = nz, uz = -nx;
    const o = { x: P.x, y: gy, z: P.z };
    boxInFrame(steel, o, [-1.1, 1.1], [0, 2.2], [0, 2.4], ux, uz, -nx, -nz, cabinC);
    // QC2-17: dark plinth, track-facing window band with a sill, side windows, door at the back, orange fascia stripe.
    boxInFrame(steel, o, [-1.13, 1.13], [-0.03, 2.23], [0, 0.35], ux, uz, -nx, -nz, plinthC);
    boxInFrame(steel, o, [-0.95, 0.95], [-0.03, 0.02], [1.15, 2.05], ux, uz, -nx, -nz, winC);
    boxInFrame(steel, o, [-1.0, 1.0], [-0.12, 0.02], [1.08, 1.15], ux, uz, -nx, -nz, steelC);
    for (const uu of [-1.13, 1.08]) boxInFrame(steel, o, [uu, uu + 0.05], [0.35, 1.5], [1.25, 2.0], ux, uz, -nx, -nz, winC);
    boxInFrame(steel, o, [-0.45, 0.45], [2.18, 2.23], [0.35, 2.15], ux, uz, -nx, -nz, steelC);
    boxInFrame(steel, o, [-1.31, 1.31], [-0.21, 2.41], [2.25, 2.4], ux, uz, -nx, -nz, roofC);
    boxInFrame(steel, o, [-1.3, 1.3], [-0.2, 2.4], [2.4, 2.6], ux, uz, -nx, -nz, roofC, true);
    boxInFrame(steel, o, [1.3, 1.42], [-1.0, -0.88], [0, 3.1], ux, uz, -nx, -nz, steelC);
    m4.compose(new Vector3(P.x + ux * 1.36 + nx * 1.05, gy + 3.35, P.z + uz * 1.36 + nz * 1.05),
      new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), new Vector3(nx, 0, nz)), new Vector3(1, 1, 1));
    panels.setMatrixAt(k, m4);
    boxInFrame(steel, { x: P.x + ux * 1.36 + nx * 0.98, y: gy, z: P.z + uz * 1.36 + nz * 0.98 }, [-0.6, 0.6], [0, 0.06], [2.95, 3.75], ux, uz, -nx, -nz, steelC);
    panels.setColorAt(k, new Color(0.01, 0.012, 0.01));
  });
  const yellow = new Color(3.2, 2.3, 0.05);
  const panelOff = new Color(0.01, 0.012, 0.01);
  const lastYellow: boolean[] = [false, false, false];

  // ---- HAIRPIN GP wordmark painted on the T1 and T12 run-offs ----------------------------------------------------
  for (const n of TS.wordmarkCorners) {
    const cc = data.corners.find((x) => x.n === n);
    if (!cc) continue;
    const s = cc.apexS - 25;
    q.frameAt(s, f);
    const side: 1 | -1 = cc.dir === 'L' ? -1 : 1;
    const hw = side === 1 ? f.halfWidthL : f.halfWidthR;
    const d0 = side * (hw + 5), d1 = side * (hw + 9.5);
    const pts = [[s - 9, d0], [s + 9, d0], [s - 9, d1], [s + 9, d1]].map(([ss, dd]) => {
      q.worldFromSD(ss!, dd!, P);
      return [P.x, P.y + 0.01, P.z];
    });
    // Read from the track side: letters run along s.
    decals.quad(side === -1 ? pts : [pts[1]!, pts[0]!, pts[3]!, pts[2]!], [0, 1, 0], C.decal, false);
  }

  const boardMat = envMaterial(c.sh, { name: 'boards', family: 'opaque', map: atlas, roughness: 0.7, wet: 0.4 });
  const decalMat = envMaterial(c.sh, { name: 'runoff.wordmark', family: 'cutout', map: atlas, roughness: 0.75, alphaTest: 0.4, polygonOffset: -2, wet: 1 });
  const steelMat = envMaterial(c.sh, { name: 'trackside.steel', family: 'cutout', vertexColor: true, roughness: 0.6, metalness: 0.4, wet: 0.5 });
  const geos = [boards.geometry(), decals.geometry(), steel.geometry()];
  const group = new Group();
  group.name = 'trackside';
  const meshes = [new Mesh(geos[0]!, boardMat), new Mesh(geos[1]!, decalMat), new Mesh(geos[2]!, steelMat)];
  for (const m of meshes) {
    m.receiveShadow = true;
    m.castShadow = c.quality.id === 'high' || c.quality.id === 'ultra';
    m.matrixAutoUpdate = false;
    group.add(m);
  }
  group.add(lamps, panels);
  triangles = geos.reduce((a, g) => a + g.index!.count / 3, 0) + 20 * 16 + posts.length * 2;

  return {
    root: group,
    triangles,
    update(_cam, frame: RenderFrame) {
      const lit = frame.lights.out ? 0 : Math.max(0, Math.min(5, frame.lights.lit));
      if (lit !== lastLit) {
        lastLit = lit;
        for (let col = 0; col < 5; col++) for (let row = 0; row < 2; row++) lamps.setColorAt(col * 2 + row, col < lit ? lampOn : lampOff);
        lamps.instanceColor!.needsUpdate = true;
      }
      let changed = false;
      for (let k = 0; k < 3; k++) if (frame.yellowSectors[k] !== lastYellow[k]) { lastYellow[k] = frame.yellowSectors[k]!; changed = true; }
      if (changed) {
        posts.forEach((p, k) => panels.setColorAt(k, lastYellow[p.sector] ? yellow : panelOff));
        panels.instanceColor!.needsUpdate = true;
      }
    },
    setQuality(qp) {
      for (const m of meshes) m.castShadow = qp.id === 'high' || qp.id === 'ultra';
    },
    dispose() {
      for (const g of geos) g.dispose();
      atlas.dispose();
      boardMat.dispose();
      decalMat.dispose();
      steelMat.dispose();
      lampGeo.dispose();
      lampMat.dispose();
      panelGeo.dispose();
      lamps.dispose();
      panels.dispose();
      group.removeFromParent();
    },
  };
}
