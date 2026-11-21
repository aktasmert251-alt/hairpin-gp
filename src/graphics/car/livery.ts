// Livery atlas generator (DESIGN.md §1.4.2, rendering.md §7.4). Draws one canvas per car in the atlas layout of
// atlas.ts: side elevations, top plan, swatch strip. Hard-edged shapes only, 12° rising sweeps, one signature
// motif per team, numbers in Barlow Condensed 800. Sponsors (fictional only, DESIGN.md §1.4.3): the title sponsor large on
// the sidepod flank (outlined for contrast), on a brand-colour panel on the rear-wing endplates and across the main plane;
// two or three secondary sponsors on brand-colour panels (engine cover, chassis side, front-wing endplate, nose top).

import type { TeamDef } from '../../contracts/data';
import { resolvedTeam } from '../../data/customTeams';
import { TEAMS } from '../../data/teams';
import { AT, SW } from './atlas';
import { drawWordmark, type SponsorBrand, SPONSOR_BRANDS, TEAM_SPONSORS } from './sponsors';

export { SPONSOR_BRANDS, TEAM_SPONSORS };

export const LIVERY_FONT = 'ApexLiveryCond';
export const LIVERY_TEXT_FONT = 'ApexLiveryText';
/** Both local custom cars use the same runtime atlas path and finish materials as stock cars. */
export const SAFETY_CAR_LIVERY: TeamDef = {
  ...TEAMS[0]!, id: 'safetyCar', name: 'HAIRPIN GP', short: 'SC',
  colors: { primary: '#E8EEF2', secondary: '#687580', accent: '#FF951A', ui: '#FFB21A' }, finish: 'metallic',
};
export function teamForLivery(id: string): TeamDef { return id === 'safetyCar' ? SAFETY_CAR_LIVERY : resolvedTeam(id) ?? TEAMS[0]!; }
let fontPromise: Promise<boolean> | null = null;

/** Registers the OFL Barlow fonts under private family names (graphics never depends on the UI stylesheet). */
export function loadLiveryFonts(): Promise<boolean> {
  if (fontPromise) return fontPromise;
  if (typeof FontFace === 'undefined' || typeof document === 'undefined') return (fontPromise = Promise.resolve(false));
  const base = 'assets/gra/fonts/';
  const faces = [
    new FontFace(LIVERY_FONT, `url(${base}barlow-condensed-latin-800-normal.woff2) format('woff2')`, { weight: '800' }),
    new FontFace(LIVERY_FONT, `url(${base}barlow-condensed-latin-ext-800-normal.woff2) format('woff2')`, { weight: '800', unicodeRange: 'U+0100-024F, U+1E00-1EFF' }),
    new FontFace(LIVERY_FONT, `url(${base}barlow-condensed-latin-700-normal.woff2) format('woff2')`, { weight: '700' }),
    new FontFace(LIVERY_FONT, `url(${base}barlow-condensed-latin-ext-700-normal.woff2) format('woff2')`, { weight: '700', unicodeRange: 'U+0100-024F, U+1E00-1EFF' }),
    new FontFace(LIVERY_FONT, `url(${base}barlow-condensed-latin-600-normal.woff2) format('woff2')`, { weight: '600' }),
    new FontFace(LIVERY_FONT, `url(${base}barlow-condensed-latin-ext-600-normal.woff2) format('woff2')`, { weight: '600', unicodeRange: 'U+0100-024F, U+1E00-1EFF' }),
    new FontFace(LIVERY_FONT, `url(${base}barlow-condensed-latin-500-normal.woff2) format('woff2')`, { weight: '500' }),
    new FontFace(LIVERY_FONT, `url(${base}barlow-condensed-latin-ext-500-normal.woff2) format('woff2')`, { weight: '500', unicodeRange: 'U+0100-024F, U+1E00-1EFF' }),
    new FontFace(LIVERY_TEXT_FONT, `url(${base}barlow-latin-400-normal.woff2) format('woff2')`, { weight: '400' }),
    new FontFace(LIVERY_TEXT_FONT, `url(${base}barlow-latin-ext-400-normal.woff2) format('woff2')`, { weight: '400', unicodeRange: 'U+0100-024F, U+1E00-1EFF' }),
    new FontFace(LIVERY_TEXT_FONT, `url(${base}barlow-latin-600-normal.woff2) format('woff2')`, { weight: '600' }),
    new FontFace(LIVERY_TEXT_FONT, `url(${base}barlow-latin-ext-600-normal.woff2) format('woff2')`, { weight: '600', unicodeRange: 'U+0100-024F, U+1E00-1EFF' }),
  ];
  fontPromise = Promise.all(faces.map((f) => f.load().then((ff) => document.fonts.add(ff))))
    .then(() => true)
    .catch(() => {
      console.warn('[graphics] livery fonts unavailable; using fallback fonts');
      return false;
    });
  return fontPromise;
}

const TAN12 = Math.tan((12 * Math.PI) / 180);

/** Relative luminance (WCAG) of a #rrggbb colour. */
function lum(hex: string): number {
  const v = parseInt(hex.slice(1), 16);
  const f = (c: number): number => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f((v >> 16) & 255) + 0.7152 * f((v >> 8) & 255) + 0.0722 * f(v & 255);
}
/** White or ink, whichever has the higher contrast on `bg` (≥ 4.5:1 target). */
export function inkOn(bg: string): string {
  const l = lum(bg);
  const cw = 1.05 / (l + 0.05);
  const ci = (l + 0.05) / (lum('#0A0C0F') + 0.05);
  return cw >= ci ? '#FFFFFF' : '#0A0C0F';
}

export interface LiverySpec { team: TeamDef; number: number; tcam: 'black' | 'yellow'; driverIdx: 0 | 1 }

type Ctx = CanvasRenderingContext2D;

export function drawLivery(spec: LiverySpec, size: number, canvas?: HTMLCanvasElement): HTMLCanvasElement {
  const c = canvas ?? document.createElement('canvas');
  c.width = size;
  c.height = size;
  const g = c.getContext('2d')!;
  const W = size, H = size;
  const { primary: P, secondary: S, accent: A } = spec.team.colors;
  const kx = W / (AT.zNose - AT.zTail);
  const ky = (H * (AT.leftV[1] - AT.leftV[0])) / (AT.yMax - AT.yMin);
  const kt = (H * (AT.topV[1] - AT.topV[0])) / (2 * AT.xHalf);
  const CARBON = '#15171A';

  g.setTransform(1, 0, 0, 1, 0, 0);
  g.fillStyle = P;
  g.fillRect(0, 0, W, H);

  // ---- region transforms (path coordinates in metres) ----
  const sideT = (right: boolean): void => {
    const v0 = right ? AT.rightV[0] : AT.leftV[0];
    g.setTransform(-kx, 0, 0, -ky, kx * AT.zNose, H * (1 - v0) + ky * AT.yMin);
  };
  const topT = (): void => g.setTransform(-kx, 0, 0, -kt, kx * AT.zNose, H * (1 - AT.topV[0]) - kt * AT.xHalf);
  const clipRegion = (v0: number, v1: number): void => {
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.beginPath();
    g.rect(0, H * (1 - v1), W, H * (v1 - v0));
    g.clip();
  };
  const poly = (pts: [number, number][], fill: string): void => {
    g.beginPath();
    pts.forEach(([a, b], i) => (i === 0 ? g.moveTo(a, b) : g.lineTo(a, b)));
    g.closePath();
    g.fillStyle = fill;
    g.fill();
  };
  /** Text in a side region: anchor (z, y) = centre, height in metres; reads correctly from that side. `stroke` outlines it. */
  const sideText = (right: boolean, z: number, y: number, hM: number, txt: string, fill: string, font: string, maxW?: number, stroke?: string): void => {
    const v0 = right ? AT.rightV[0] : AT.leftV[0];
    const cx = kx * (AT.zNose - z);
    const cy = H * (1 - v0) - ky * (y - AT.yMin);
    const px = 100;
    g.setTransform((right ? -kx : kx) / px, 0, 0, ky / px, cx, cy);
    g.font = font.replace('{px}', `${px * hM}px`);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = fill;
    let sx = 1;
    if (maxW) {
      const m = g.measureText(txt).width / px;
      if (m > maxW) sx = maxW / m;
    }
    if (sx !== 1) g.scale(sx, 1);
    if (stroke) {
      g.lineJoin = 'round';
      g.lineWidth = px * hM * 0.16;
      g.strokeStyle = stroke;
      g.strokeText(txt, 0, 0);
    }
    g.fillText(txt, 0, 0);
  };
  const FONTS = { cond: `"${LIVERY_FONT}", "Arial Narrow", sans-serif`, text: `"${LIVERY_TEXT_FONT}", Arial, sans-serif` };
  /** Sponsor wordmark in a side elevation, centre (z, y), box w × h metres; reads correctly from that side. */
  const sideMark = (right: boolean, z: number, y: number, w: number, h: number, brand: SponsorBrand, onPaint?: { fg: string; outline: string }): void => {
    const v0 = right ? AT.rightV[0] : AT.leftV[0];
    g.setTransform((right ? -kx : kx) / 100, 0, 0, ky / 100, kx * (AT.zNose - z), H * (1 - v0) - ky * (y - AT.yMin));
    drawWordmark(g, brand, w * 100, h * 100, FONTS, onPaint);
  };
  /** Wordmark on the top plan across the span (rear-wing main plane), reading from behind. */
  const topMark = (z: number, x: number, len: number, h: number, brand: SponsorBrand): void => {
    g.setTransform(0, kt / 100, kx / 100, 0, kx * (AT.zNose - z), H * (1 - AT.topV[0]) - kt * (x + AT.xHalf));
    drawWordmark(g, brand, len * 100, h * 100, FONTS);
  };
  /** Wordmark along the nose top (runs nose → cockpit). */
  const noseMark = (z: number, len: number, h: number, brand: SponsorBrand): void => {
    g.setTransform(kx / 100, 0, 0, kt / 100, kx * (AT.zNose - z), H * (1 - AT.topV[0]) - kt * AT.xHalf);
    drawWordmark(g, brand, len * 100, h * 100, FONTS);
  };
  /** Text on the top plan, reading from the front of the car (z = up on screen). */
  const topText = (z: number, x: number, hM: number, txt: string, fill: string, font: string, maxW?: number): void => {
    const cx = kx * (AT.zNose - z);
    const cy = H * (1 - AT.topV[0]) - kt * (x + AT.xHalf);
    const px = 100;
    g.setTransform(0, kt / px, kx / px, 0, cx, cy);
    g.font = font.replace('{px}', `${px * hM}px`);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = fill;
    if (maxW) {
      const m = g.measureText(txt).width / px;
      if (m > maxW) g.scale(maxW / m, 1);
    }
    g.fillText(txt, 0, 0);
  };
  const cond = (w: number): string => `${w} {px} "${LIVERY_FONT}", "Arial Narrow", sans-serif`;
  const textFont = `600 {px} "${LIVERY_TEXT_FONT}", Arial, sans-serif`;
  const deal = TEAM_SPONSORS[spec.team.id];
  const sponsor = deal?.title ? SPONSOR_BRANDS[deal.title] ?? null : null;
  const extras = (deal?.extra ?? []).map((k) => SPONSOR_BRANDS[k]).filter((x): x is SponsorBrand => !!x);

  // ---- side elevations ----
  for (const right of [false, true]) {
    g.save();
    const rv = right ? AT.rightV : AT.leftV;
    clipRegion(rv[0], rv[1]);
    sideT(right);
    // Secondary sweep: a hard-edged band rising rearward at 12° from the sidepod inlet, levelling out below the fin.
    const yu = (z: number): number => Math.min(0.36 + (0.62 - z) * TAN12, 0.74);
    const yl = (z: number): number => Math.min(0.13 + (0.62 - z) * TAN12, 0.52);
    const top: [number, number][] = [];
    const bot: [number, number][] = [];
    for (let z = 0.75; z >= -2.75; z -= 0.05) {
      top.push([z, yu(z)]);
      bot.push([z, yl(z)]);
    }
    poly([...top, ...bot.reverse()], S);
    // Accent pinstripe on the band's upper edge (thin, ≤ 10 %).
    const pin: [number, number][] = [];
    for (let z = 0.75; z >= -2.75; z -= 0.05) pin.push([z, yu(z) + 0.022]);
    for (let z = -2.75; z <= 0.75 + 1e-6; z += 0.05) pin.push([z, yu(z)]);
    poly(pin, A);
    // Nose-tip flash (secondary) above the front-wing mainplane.
    poly([[3.2, 0.14], [3.2, 0.5], [2.9, 0.5], [2.98, 0.14]], S);
    // Exposed carbon: bottom edges and undercut.
    poly([[3.2, -0.1], [-2.8, -0.1], [-2.8, 0.115], [3.2, 0.115]], CARBON);
    // Rear-wing endplates: title-sponsor panel.
    poly([[-2.07, 0.5], [-2.07, 0.98], [-2.65, 0.98], [-2.65, 0.5]], P);
    motifSide(g, spec, right, poly);
    // Numbers: fin and front-wing endplate.
    const num = String(spec.number);
    sideText(right, -1.42, 0.845, 0.15, num, inkOn(P), cond(800));
    sideText(right, 2.62, 0.2, 0.1, num, inkOn(P), cond(800));
    // Title sponsor: big outlined wordmark on the sidepod flank, brand panel on the rear-wing endplate.
    if (sponsor) {
      const ink = inkOn(P);
      sideMark(right, -0.5, 0.29, 1.1, 0.19, sponsor, { fg: ink, outline: ink === '#FFFFFF' ? '#0A0C0F' : '#FFFFFF' });
      sideMark(right, -2.3, 0.832, 0.2, 0.058, sponsor); // compact endplate (carRear.ts)
    } else {
      sideText(right, -2.3, 0.832, 0.05, spec.team.short, inkOn(P), cond(800), 0.24);
    }
    // Secondary sponsors: engine cover, chassis side ahead of the cockpit, front-wing endplate.
    if (extras[0]) sideMark(right, -1.08, 0.6, 0.6, 0.11, extras[0]);
    if (extras[1]) sideMark(right, 1.45, 0.4, 0.56, 0.1, extras[1]);
    const ep = extras[2] ?? extras[1] ?? extras[0];
    if (ep) sideMark(right, 2.74, 0.095, 0.5, 0.08, ep);
    // Team short name on the engine cover.
    sideText(right, -0.62, 0.76, 0.07, spec.team.short, inkOn(P), cond(700), 0.5);
    g.restore();
  }

  // ---- top plan ----
  g.save();
  clipRegion(AT.topV[0], AT.topV[1]);
  topT();
  // Secondary on the rear body (matches the side sweep), carbon floor edges outside the bodywork.
  poly([[-0.9, -1.2], [-0.9, 1.2], [-2.8, 1.2], [-2.8, -1.2]], S);
  poly([[-0.9, -0.3], [-0.9, 0.3], [-0.55, 0.3], [-0.55, -0.3]], S);
  poly([[3.2, -0.12], [3.2, 0.12], [2.86, 0.12], [2.86, -0.12]], S);
  // Cockpit opening (dark).
  poly([[0.8, -0.24], [0.8, 0.24], [-0.14, 0.24], [-0.14, -0.24]], '#060607');
  // Front-wing flaps: carbon up to the curled tips (the secondary tip blocks showed as pale caps on the endplates).
  poly([[2.86, -1.1], [2.86, -0.1], [2.38, -0.1], [2.38, -1.1]], CARBON);
  poly([[2.86, 0.1], [2.86, 1.1], [2.38, 1.1], [2.38, 0.1]], CARBON);
  motifTop(g, spec, poly);
  topText(2.42, 0, 0.1, String(spec.number), inkOn(P), cond(800));
  // Rear wing (main plane z −2.08…−2.40, DRS flap −2.40…−2.62): team colour with a secondary-colour trailing-edge band.
  topT();
  poly([[-2.06, -1.2], [-2.06, 1.2], [-2.66, 1.2], [-2.66, -1.2]], P);
  poly([[-2.55, -1.2], [-2.55, 1.2], [-2.66, 1.2], [-2.66, -1.2]], S);
  // Title sponsor across the rear-wing main plane; a secondary sponsor along the nose top.
  if (sponsor) topMark(-2.25, 0, 0.92, 0.17, sponsor);
  const nose = extras[2] ?? extras[0];
  if (nose) noseMark(1.95, 0.62, 0.1, nose);
  g.restore();

  // ---- swatch strip ----
  g.setTransform(1, 0, 0, 1, 0, 0);
  const cw = W / AT.cells;
  const sy0 = H * (1 - AT.swatchV[1]);
  const sh = H * (AT.swatchV[1] - AT.swatchV[0]);
  const cell = (k: number, fill: string): void => {
    g.fillStyle = fill;
    g.fillRect(k * cw, sy0, cw, sh);
  };
  cell(SW.primary, P);
  cell(SW.secondary, S);
  cell(SW.accent, A);
  cell(SW.carbon, CARBON);
  cell(SW.black, '#0B0C0E');
  cell(SW.white, '#F2F4F7');
  cell(SW.tcam, spec.tcam === 'yellow' ? '#F5C400' : '#0E0F11');
  cell(SW.suit, spec.team.id === 'vortex' ? '#1A1C1E' : P);
  cell(SW.glove, '#121314');
  cell(SW.inlet, '#050506');
  // Helmet band (cells 10–15): wraps once around the helmet; front = band centre.
  const hx0 = SW.helmet * cw;
  const hw = W - hx0;
  const d2 = spec.driverIdx === 1;
  g.fillStyle = d2 ? S : '#F2F4F7';
  g.fillRect(hx0, sy0, hw, sh);
  g.fillStyle = d2 ? '#F2F4F7' : P;
  g.fillRect(hx0, sy0 + sh * 0.12, hw, sh * 0.34); // crown band
  g.fillStyle = A;
  g.fillRect(hx0, sy0 + sh * 0.46, hw, sh * 0.06);
  g.fillStyle = '#0B0C0E';
  g.fillRect(hx0, sy0 + sh * 0.86, hw, sh * 0.14); // chin / neck
  return c;
}

type Poly = (pts: [number, number][], fill: string) => void;

function motifSide(g: Ctx, s: LiverySpec, _right: boolean, poly: Poly): void {
  const { primary: P, secondary: S, accent: A } = s.team.colors;
  switch (s.team.id) {
    case 'safetyCar':
      // Broad amber chevrons distinguish the support vehicle at race distance.
      for (let k = 0; k < 3; k++) {
        const z = 0.25 - k * 0.48;
        poly([[z, 0.18], [z - 0.18, 0.18], [z - 0.42, 0.68], [z - 0.24, 0.68]], A);
      }
      break;
    case 'anka':
      // Three stacked gold feather-chevrons on the sidepod, pointing forward.
      for (let k = 0; k < 3; k++) {
        const z = 0.42 - k * 0.15;
        const y = 0.27 + (0.62 - z) * TAN12;
        poly([[z + 0.1, y - 0.06], [z, y], [z + 0.1, y + 0.06], [z + 0.05, y + 0.06], [z - 0.05, y], [z + 0.05, y - 0.06]], A);
      }
      break;
    case 'aurora':
      poly([[0.6, 0.1], [-0.2, 0.42], [-1.9, 0.92], [-1.9, 0.8], [-0.3, 0.33], [0.4, 0.1]], A);
      break;
    case 'vortex':
      // Neon rim line wrapping the sidepod.
      poly([[0.66, 0.2], [0.66, 0.56], [-1.4, 0.36], [-1.4, 0.335], [0.63, 0.53], [0.63, 0.2]], S);
      break;
    case 'solaris':
      // Hard 12° split: rear half purple.
      poly([[-0.2, -0.1], [-0.2 - 1.3 * TAN12 * 4, 1.2], [-2.8, 1.2], [-2.8, -0.1]], S);
      break;
    case 'kestrel':
      poly([[0.7, 0.5], [-2.0, 0.93], [-2.0, 0.96], [0.7, 0.53]], S);
      break;
    case 'meridian':
      poly([[3.1, 0.23], [3.1, 0.245], [-2.7, 0.62], [-2.7, 0.605]], S);
      break;
    case 'titan':
      poly([[3.2, -0.1], [3.2, 0.5], [2.86, 0.5], [2.86, -0.1]], S);
      poly([[-2.07, 0.86], [-2.07, 0.98], [-2.65, 0.98], [-2.65, 0.86]], S);
      break;
    case 'zephyr':
      for (let k = 0; k < 3; k++) {
        const z = -0.5 - k * 0.22;
        poly([[z, 0.6], [z - 0.3, 0.82], [z - 0.38, 0.82], [z - 0.08, 0.6]], S);
      }
      break;
    case 'ironclad':
      poly([[0.55, 0.15], [0.55, 0.3], [-0.2, 0.3], [-0.2, 0.15]], S);
      poly([[2.4, 0.15], [2.4, 0.3], [1.6, 0.3], [1.6, 0.15]], S);
      break;
    case 'nova':
      poly([[3.2, 0.3], [3.2, 0.34], [-2.7, 0.66], [-2.7, 0.62]], S);
      poly([[3.2, 0.27], [3.2, 0.29], [-2.7, 0.61], [-2.7, 0.59]], A);
      break;
    default:
      void P;
  }
}

function motifTop(_g: Ctx, s: LiverySpec, poly: Poly): void {
  const { secondary: S, accent: A } = s.team.colors;
  switch (s.team.id) {
    case 'safetyCar':
      poly([[3.1, -0.11], [3.1, 0.11], [-2.6, 0.11], [-2.6, -0.11]], A);
      break;
    case 'kestrel':
      poly([[3.1, -0.025], [3.1, 0.025], [-2.6, 0.025], [-2.6, -0.025]], S);
      break;
    case 'nova':
      poly([[3.1, -0.06], [3.1, -0.02], [-2.6, -0.02], [-2.6, -0.06]], S);
      poly([[3.1, 0.02], [3.1, 0.06], [-2.6, 0.06], [-2.6, 0.02]], A);
      break;
    case 'meridian':
      poly([[3.1, -0.012], [3.1, 0.012], [-2.6, 0.012], [-2.6, -0.012]], S);
      break;
    case 'zephyr':
      for (let k = 0; k < 3; k++) {
        const z = -0.5 - k * 0.22;
        poly([[z, -0.25], [z - 0.12, 0.25], [z - 0.2, 0.25], [z - 0.08, -0.25]], S);
      }
      break;
    case 'titan':
      poly([[3.2, -0.2], [3.2, 0.2], [2.86, 0.2], [2.86, -0.2]], S);
      break;
    default:
      break;
  }
}
