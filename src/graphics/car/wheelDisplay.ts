// Steering-wheel display (CR-16, DESIGN.md §6.3 adapted to the 3D wheel): a 512 × 256 CanvasTexture on the wheel's
// screen (84 × 42 mm). Shows shift LEDs, speed, gear, lap delta, ERS state of charge + mode pips and DRS.
// Redraws at most 30 Hz and only when a displayed value changes (a packed signature); one texture upload per redraw.
// Labels are language-neutral (digits, N/R, the DRS/ERS acronyms), so no i18n is needed in the 3D layer.

import { CanvasTexture, Color, LinearFilter, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace } from 'three';
import type { HudModel } from '../../contracts/hud';
import type { ErsMode } from '../../contracts/vehicle';
import { LIVERY_FONT } from './livery';

const W = 512;
const H = 256;
const MIN_DT = 1 / 30;
/** Screen plane in steering-wheel local space (the display box face points to −z, towards the driver). */
const SCREEN_W = 0.083;
const SCREEN_H = 0.0415;
const SCREEN_POS: readonly [number, number, number] = [0, 0.012, -0.0199];

const C = {
  bg: '#05070A', panel: '#0D1117', line: '#1E2630', fg: '#F2F4F7', fg2: '#9AA4AE', off: '#1A1F26',
  green: '#2ED16B', red: '#FF5C5C', blue: '#5C8FFF', amber: '#FFB21A', purple: '#B470FF',
};
const ERS_MODES: readonly ErsMode[] = ['none', 'medium', 'hotlap', 'overtake'];

export interface WheelDisplay {
  readonly mesh: Mesh;
  /** Latest HUD model (null = idle screen). Cheap: only stores the reference. */
  set(m: HudModel | null): void;
  /** Redraws when the signature changed and ≥ 1/30 s passed. Returns true when a redraw happened. */
  update(timeS: number): boolean;
  /** Redraw count and the last redraw cost in ms (perf checks). */
  stats(): { redraws: number; lastMs: number };
  dispose(): void;
}

export function createWheelDisplay(): WheelDisplay {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d')!;
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.minFilter = LinearFilter;
  tex.magFilter = LinearFilter;
  tex.generateMipmaps = false;
  tex.anisotropy = 4;
  // Emissive screen: > 1 so LEDs reach the bloom threshold after exposure.
  const mat = new MeshBasicMaterial({ map: tex, color: new Color(1.6, 1.6, 1.6), fog: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  const geo = new PlaneGeometry(SCREEN_W, SCREEN_H).rotateY(Math.PI);
  const mesh = new Mesh(geo, mat);
  mesh.position.set(SCREEN_POS[0], SCREEN_POS[1], SCREEN_POS[2]);
  mesh.name = 'wheelDisplay';
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.visible = false;

  let model: HudModel | null = null;
  let sig = NaN;
  let lastT = -1;
  let redraws = 0;
  let lastMs = 0;

  const signature = (m: HudModel | null, t: number): number => {
    if (!m) return -1;
    const c = m.car;
    const pitPhase = c.pitLimiter ? (Math.floor(t * 2) & 1) + 1 : 0; // 2 Hz swap
    const delta = m.timing.deltaMs === null ? 99999 : Math.round(m.timing.deltaMs / 10);
    const drs = c.drs === 'open' ? 4 : c.drs === 'available' ? 3 : c.drs === 'disabled' ? 2 : c.drs === 'unavailable' ? 1 : 0;
    let h = Math.round(c.kmh);
    h = h * 31 + (c.gear + 2);
    h = (h * 16 + c.shiftLeds) | 0;
    h = (h * 4 + (c.shiftNow ? 1 : 0) + (c.limiter ? 2 : 0)) | 0;
    h = (h * 3 + pitPhase) | 0;
    h = (h * 100003 + delta) | 0;
    h = (h * 101 + Math.round(c.ers.soc * 100)) | 0;
    h = (h * 5 + Math.max(0, ERS_MODES.indexOf(c.ers.mode))) | 0;
    h = (h * 2 + (c.ers.overtake ? 1 : 0)) | 0;
    h = (h * 5 + drs) | 0;
    return h;
  };

  // Font strings and number labels are built once (redraws then allocate only the delta text).
  const fonts = new Map<number, string>();
  const font = (weight: number, px: number): string => {
    const k = weight * 1000 + px;
    let f = fonts.get(k);
    if (!f) fonts.set(k, (f = `${weight} ${px}px "${LIVERY_FONT}", "Barlow Condensed", "Arial Narrow", sans-serif`));
    return f;
  };
  const NUM: string[] = [];
  for (let i = 0; i <= 420; i++) NUM.push(String(i));
  const num = (v: number): string => NUM[Math.max(0, Math.min(420, Math.round(v)))]!;

  const draw = (m: HudModel | null, t: number): void => {
    g.fillStyle = C.bg;
    g.fillRect(0, 0, W, H);
    // Shift LEDs: 15 skewed segments.
    const n = 15, lw = 26, gap = 5, lh = 16;
    const x0 = (W - (n * lw + (n - 1) * gap)) / 2;
    const c = m?.car;
    const lit = c ? c.shiftLeds : 0;
    const pitSwap = c?.pitLimiter ? Math.floor(t * 2) & 1 : 0;
    for (let i = 0; i < n; i++) {
      let col = C.off;
      if (c) {
        if (c.pitLimiter) col = (i < 7.5) !== (pitSwap === 1) ? C.blue : C.amber;
        else if (c.shiftNow) col = C.blue;
        else if (c.limiter) col = C.red;
        else if (i < lit) col = i < 5 ? C.green : i < 10 ? C.red : C.blue;
      }
      g.fillStyle = col;
      const x = x0 + i * (lw + gap);
      g.beginPath();
      g.moveTo(x + 3, 10);
      g.lineTo(x + lw + 3, 10);
      g.lineTo(x + lw, 10 + lh);
      g.lineTo(x, 10 + lh);
      g.closePath();
      g.fill();
    }
    // Panels.
    g.fillStyle = C.panel;
    g.fillRect(8, 36, 156, 150);
    g.fillRect(348, 36, 156, 150);
    g.strokeStyle = C.line;
    g.lineWidth = 2;
    g.strokeRect(8, 36, 156, 150);
    g.strokeRect(348, 36, 156, 150);
    if (!m || !c) {
      g.fillStyle = C.fg2;
      g.font = font(800, 110);
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('–', W / 2, 118);
      tex.needsUpdate = true;
      return;
    }
    // Gear (centre).
    g.textAlign = 'center';
    g.textBaseline = 'alphabetic';
    g.fillStyle = c.limiter || c.shiftNow ? (c.shiftNow ? C.blue : C.red) : C.fg;
    g.font = font(800, 150);
    g.fillText(c.gear === 0 ? 'N' : c.gear < 0 ? 'R' : num(c.gear), W / 2, 180);
    // Speed (left panel).
    g.fillStyle = C.fg;
    g.font = font(800, 76);
    g.fillText(num(c.kmh), 86, 130);
    g.fillStyle = C.fg2;
    g.font = font(700, 22);
    g.fillText('KM/H', 86, 168);
    // Delta (right panel).
    const d = m.timing.deltaMs;
    if (d === null) {
      g.fillStyle = C.fg2;
      g.font = font(800, 56);
      g.fillText('--.--', 426, 124);
    } else {
      const s = Math.min(99.99, Math.abs(d) / 1000);
      g.fillStyle = d < 0 ? C.green : d > 0 ? C.red : C.fg;
      g.font = font(800, 58);
      g.fillText(`${d < 0 ? '−' : '+'}${s.toFixed(2)}`, 426, 124);
    }
    g.fillStyle = C.fg2;
    g.font = font(700, 22);
    g.fillText(m.timing.deltaRef === 'pb' ? 'PB' : m.timing.deltaRef === 'rival' ? 'P±1' : 'BEST', 426, 168);
    // ERS bar + mode pips (bottom left/centre).
    const by = 206;
    g.fillStyle = C.line;
    g.fillRect(20, by, 300, 14);
    g.fillStyle = c.ers.overtake ? C.purple : C.amber;
    g.fillRect(20, by, 300 * Math.max(0, Math.min(1, c.ers.soc)), 14);
    g.textAlign = 'left';
    g.fillStyle = C.fg2;
    g.font = font(700, 24);
    g.fillText('ERS', 20, by + 44);
    const mode = Math.max(0, ERS_MODES.indexOf(c.ers.mode));
    for (let i = 0; i < 3; i++) {
      g.fillStyle = i < mode ? C.amber : C.off;
      g.fillRect(70 + i * 22, by + 26, 16, 16);
    }
    g.textAlign = 'right';
    g.fillStyle = C.fg;
    g.font = font(800, 28);
    g.fillText(num(c.ers.soc * 100), 320, by + 46);
    // DRS chip (bottom right).
    const drsOn = c.drs === 'open';
    const drsAvail = c.drs === 'available';
    g.fillStyle = drsOn ? C.green : C.panel;
    g.fillRect(352, by - 6, 148, 50);
    g.strokeStyle = drsOn || drsAvail ? C.green : C.line;
    g.lineWidth = 3;
    g.strokeRect(352, by - 6, 148, 50);
    g.textAlign = 'center';
    g.fillStyle = drsOn ? C.bg : drsAvail ? C.green : C.fg2;
    g.font = font(800, 36);
    g.fillText('DRS', 426, by + 32);
    tex.needsUpdate = true;
  };

  return {
    mesh,
    set(m) {
      model = m;
    },
    update(t) {
      if (lastT >= 0 && t - lastT < MIN_DT && t >= lastT) return false;
      const s = signature(model, t);
      if (s === sig) return false;
      const t0 = performance.now();
      draw(model, t);
      lastMs = performance.now() - t0;
      sig = s;
      lastT = t;
      redraws++;
      return true;
    },
    stats: () => ({ redraws, lastMs }),
    dispose() {
      mesh.removeFromParent();
      geo.dispose();
      mat.dispose();
      tex.dispose();
    },
  };
}
