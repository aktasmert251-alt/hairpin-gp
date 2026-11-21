// 2D canvas helpers shared by the Sürüş sandbox scenes (physics, ai): track ribbon, racing line, cars and
// telemetry plots. Sandbox-only (DOM canvas), never imported by game code.

import type { RacingLine, SpeedProfile } from '../../contracts/ai';
import type { TrackData } from '../../contracts/track';

export interface View2D {
  /** World point at the screen origin. */
  cx: number;
  cz: number;
  /** Screen-up direction in world x-z (unit). */
  ux: number;
  uz: number;
  /** px per metre. */
  scale: number;
  ox: number;
  oy: number;
}

export const COLORS = {
  bg: '#0A0C0F', panel: '#11151B', grid: '#1E242D', text: '#F2F4F7', dim: '#8A94A3', asphalt: '#2B3038', edge: '#E8EAED',
  line: '#3DDC97', brake: '#FF5A4E', lift: '#FFC23D', speed: '#4FC3F7', rpm: '#B388FF', thr: '#3DDC97', brk: '#FF5A4E', steer: '#FFC23D',
};

/** World (x, z) → screen; `out` receives [sx, sy]. Screen right = up rotated −90° (car's right). */
export function toScreen(v: View2D, x: number, z: number, out: Float64Array): void {
  const dx = x - v.cx;
  const dz = z - v.cz;
  const rx = -v.uz;
  const rz = v.ux;
  out[0] = v.ox + v.scale * (dx * rx + dz * rz);
  out[1] = v.oy - v.scale * (dx * v.ux + dz * v.uz);
}

const P = new Float64Array(2);

/** Asphalt ribbon + white edges between sample indices [i0, i1) (wrapping), every `step` samples. */
export function drawTrack(g: CanvasRenderingContext2D, data: TrackData, v: View2D, i0: number, i1: number, step: number, closed: boolean): void {
  const n = data.count;
  const idx = (i: number): number => (closed ? ((i % n) + n) % n : Math.max(0, Math.min(n - 1, i)));
  const edge = (side: 1 | -1, i: number): void => {
    const k = idx(i);
    const lx = data.tz[k]!;
    const lz = -data.tx[k]!;
    const w = side > 0 ? data.halfWidthL[k]! : -data.halfWidthR[k]!;
    toScreen(v, data.x[k]! + lx * w, data.z[k]! + lz * w, P);
  };
  g.beginPath();
  for (let i = i0; i <= i1; i += step) {
    edge(1, i);
    if (i === i0) g.moveTo(P[0]!, P[1]!);
    else g.lineTo(P[0]!, P[1]!);
  }
  for (let i = i1; i >= i0; i -= step) {
    edge(-1, i);
    g.lineTo(P[0]!, P[1]!);
  }
  g.closePath();
  g.fillStyle = COLORS.asphalt;
  g.fill();
  g.strokeStyle = COLORS.edge;
  g.lineWidth = 1.5;
  for (const side of [1, -1] as const) {
    g.beginPath();
    for (let i = i0; i <= i1; i += step) {
      edge(side, i);
      if (i === i0) g.moveTo(P[0]!, P[1]!);
      else g.lineTo(P[0]!, P[1]!);
    }
    g.stroke();
  }
}

/** Racing line coloured by speed-profile zone (green throttle, amber lift, red brake). */
export function drawLine(g: CanvasRenderingContext2D, line: RacingLine, prof: SpeedProfile | null, v: View2D, j0: number, j1: number, width: number): void {
  const n = line.count;
  g.lineWidth = width;
  let prevZone = -1;
  for (let j = j0; j <= j1; j++) {
    const i = ((j % n) + n) % n;
    const z = prof ? prof.zone[i]! : 0;
    toScreen(v, line.x[i]!, line.z[i]!, P);
    if (z !== prevZone) {
      if (prevZone >= 0) {
        g.lineTo(P[0]!, P[1]!);
        g.stroke();
      }
      g.strokeStyle = z === 2 ? COLORS.brake : z === 1 ? COLORS.lift : COLORS.line;
      g.beginPath();
      g.moveTo(P[0]!, P[1]!);
      prevZone = z;
    } else g.lineTo(P[0]!, P[1]!);
  }
  g.stroke();
}

/** Car body (5.6 × 2.0 m) with 4 wheels; wheel colours from slip σ (≤ 0.8 green → 1 amber → ≥ 1.3 red). */
export function drawCar(
  g: CanvasRenderingContext2D, v: View2D, x: number, z: number, yaw: number, steer: number, color: string, slip: ArrayLike<number> | null, scaleMul = 1,
): void {
  const fx = Math.cos(yaw), fz = -Math.sin(yaw);
  const lx = -Math.sin(yaw), lz = -Math.cos(yaw);
  const corner = (a: number, b: number): void => toScreen(v, x + fx * a + lx * b, z + fz * a + lz * b, P);
  const hl = 2.8 * scaleMul, hw = 0.95 * scaleMul;
  g.beginPath();
  corner(hl, 0.45 * hw); g.moveTo(P[0]!, P[1]!);
  corner(hl, -0.45 * hw); g.lineTo(P[0]!, P[1]!);
  corner(-hl, -hw); g.lineTo(P[0]!, P[1]!);
  corner(-hl, hw); g.lineTo(P[0]!, P[1]!);
  g.closePath();
  g.fillStyle = color;
  g.fill();
  if (!slip) return;
  const wheels = [[1.96, 0.8], [1.96, -0.8], [-1.64, 0.78], [-1.64, -0.78]] as const;
  for (let k = 0; k < 4; k++) {
    const [a, b] = wheels[k]!;
    const s = slip[k]!;
    g.strokeStyle = s < 0.8 ? '#3DDC97' : s < 1.05 ? '#FFC23D' : s < 1.3 ? '#FF8A3D' : '#FF3B3B';
    g.lineWidth = Math.max(2, v.scale * 0.35 * scaleMul);
    const ang = k < 2 ? steer : 0;
    const wfx = Math.cos(yaw + ang), wfz = -Math.sin(yaw + ang);
    const cx = x + fx * a + lx * b, cz = z + fz * a + lz * b;
    g.beginPath();
    toScreen(v, cx + wfx * 0.36, cz + wfz * 0.36, P);
    g.moveTo(P[0]!, P[1]!);
    toScreen(v, cx - wfx * 0.36, cz - wfz * 0.36, P);
    g.lineTo(P[0]!, P[1]!);
    g.stroke();
  }
}

export interface Rect { x: number; y: number; w: number; h: number }

export function panel(g: CanvasRenderingContext2D, r: Rect, title: string): void {
  g.fillStyle = COLORS.panel;
  g.fillRect(r.x, r.y, r.w, r.h);
  g.fillStyle = COLORS.dim;
  g.font = '600 12px "Segoe UI", system-ui, sans-serif';
  g.fillText(title, r.x + 8, r.y + 15);
}

/** Time-series plot of ring buffers (newest at `head - 1`). */
export function plot(g: CanvasRenderingContext2D, r: Rect, series: readonly Float32Array[], colors: readonly string[], head: number, count: number, lo: number, hi: number): void {
  const n = series[0]!.length;
  const top = r.y + 22, bot = r.y + r.h - 6, left = r.x + 6, right = r.x + r.w - 6;
  g.strokeStyle = COLORS.grid;
  g.lineWidth = 1;
  g.beginPath();
  for (let k = 0; k <= 4; k++) {
    const y = top + ((bot - top) * k) / 4;
    g.moveTo(left, y);
    g.lineTo(right, y);
  }
  g.stroke();
  for (let s = 0; s < series.length; s++) {
    const a = series[s]!;
    g.strokeStyle = colors[s]!;
    g.lineWidth = 1.6;
    g.beginPath();
    for (let k = 0; k < count; k++) {
      const i = (head - count + k + n) % n;
      const x = left + ((right - left) * k) / Math.max(1, n - 1);
      const t = (a[i]! - lo) / (hi - lo);
      const y = bot - (bot - top) * (t < 0 ? 0 : t > 1 ? 1 : t);
      if (k === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
  }
}

/** Fits a view to the whole track (north up). */
export function fitView(data: TrackData, w: number, h: number, pad: number): View2D {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < data.count; i++) {
    const x = data.x[i]!, z = data.z[i]!;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  const scale = Math.min((w - 2 * pad) / Math.max(1, maxX - minX), (h - 2 * pad) / Math.max(1, maxZ - minZ));
  return { cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2, ux: 0, uz: -1, scale, ox: w / 2, oy: h / 2 };
}
