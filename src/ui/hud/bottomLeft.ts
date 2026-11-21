// Bottom-left group (DESIGN §6.4–§6.6): weather strip (2 Hz), minimap (canvas 2D on --apx-panel) and tyre widget.
// The track outline is pre-rendered once per size/flag state into an offscreen canvas; each update only blits it
// and draws the car dots (positions written directly, never tweened). North up; screen-y = world +Z.

import type { HudModel } from '../../contracts/hud';
import type { TrackData } from '../../contracts/track';
import { Attr, h, icon, Txt } from '../dom';
import * as fmt from '../format';
import type { HudCtx, HudWidget } from './ctx';

export interface BottomLeft extends HudWidget {
  el: HTMLElement;
  update(m: HudModel, now: number): void;
  /** Effective k (kView × hud.scale) and device pixel ratio; re-renders the minimap backing store. */
  resize(k: number): void;
  setTrack(t: TrackData | null): void;
  setMinimap(on: boolean): void;
}

const MM_W = 224;
const MM_H = 184;
const INK = '#0A0C0F';
const FG = '#F2F4F7';

export function createBottomLeft(parent: HTMLElement, ctx: HudCtx): BottomLeft {
  const el = h('div', 'h-reg h-bl h-mode-hide', parent);
  el.setAttribute('aria-hidden', 'true');
  // Weather strip
  const wx = h('div', 'h-wx', el);
  const wxRain = new Attr(wx, 'data-rain');
  const cell = (): { l: HTMLElement; v: Txt } => {
    const s = h('span', '', wx);
    return { l: h('span', 'h-lbl', s), v: new Txt(h('span', 'v apx-num', s)) };
  };
  const air = cell();
  const trk = cell();
  const wet = cell();
  const wetCls = new Txt(h('span', 'cls', wet.l.parentElement!));
  wx.appendChild(icon('drop', 'ic'));
  // Minimap + tyres
  const row = h('div', 'h-bl-row', el);
  const mm = h('div', 'h-mm', row);
  const canvas = h('canvas', '', mm);
  const g = canvas.getContext('2d', { alpha: true })!;
  const bg = document.createElement('canvas');
  const bgG = bg.getContext('2d')!;
  const ty = h('div', 'h-ty', row);
  const head = h('div', 'ty-head', ty);
  const ringEl = h('span', 'ty-ring', head);
  const ring = new Txt(ringEl);
  const ringC = new Attr(ringEl, 'data-cmp');
  const tt = h('span', 't', head);
  const tName = new Txt(h('span', '', tt));
  const tAge = new Txt(h('small', 'apx-num', tt));
  const grid = h('div', 'ty-grid', ty);
  const tyres: { s: Attr; w: Txt; tc: Txt }[] = [];
  for (let i = 0; i < 4; i++) {
    const t = h('div', 'ty', grid);
    h('span', 'g', t);
    const vals = h('span', 'vals', t);
    tyres.push({ s: new Attr(t, 'data-s'), w: new Txt(h('span', 'w apx-num', vals)), tc: new Txt(h('span', 'tc apx-num', vals)) });
  }
  const cap = h('div', 'h-lbl ty-cap', ty);

  let track: TrackData | null = null;
  let k = 1;
  let dpr = 1;
  let scale = 1;
  let ox = 0;
  let oz = 0;
  let yellowKey = -1;
  let nextWx = 0;
  let mmOn = true;
  let dnf = new Uint8Array(32);

  const fit = (): void => {
    if (!track) return;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    const xs = [track.x, track.pit.x];
    const zs = [track.z, track.pit.z];
    for (let a = 0; a < 2; a++) {
      const X = xs[a]!, Z = zs[a]!;
      for (let i = 0; i < X.length; i++) {
        if (X[i]! < minX) minX = X[i]!; if (X[i]! > maxX) maxX = X[i]!;
        if (Z[i]! < minZ) minZ = Z[i]!; if (Z[i]! > maxZ) maxZ = Z[i]!;
      }
    }
    const W = canvas.width, H = canvas.height, pad = 10 * k * dpr;
    scale = Math.min((W - 2 * pad) / (maxX - minX), (H - 2 * pad) / (maxZ - minZ));
    ox = (W - (maxX - minX) * scale) / 2 - minX * scale;
    oz = (H - (maxZ - minZ) * scale) / 2 - minZ * scale;
  };

  const path = (gg: CanvasRenderingContext2D, X: Float32Array, Z: Float32Array, from: number, to: number, close: boolean): void => {
    gg.beginPath();
    const n = X.length;
    const step = Math.max(1, Math.floor(n / 1200));
    gg.moveTo(X[from]! * scale + ox, Z[from]! * scale + oz);
    for (let i = from + step; i < to; i += step) gg.lineTo(X[i % n]! * scale + ox, Z[i % n]! * scale + oz);
    gg.lineTo(X[to % n]! * scale + ox, Z[to % n]! * scale + oz);
    if (close) gg.closePath();
  };

  const tick = (gg: CanvasRenderingContext2D, s: number, len: number, color: string, width: number, dash: boolean): void => {
    if (!track) return;
    const i = Math.max(0, Math.min(track.count - 1, Math.round(s)));
    const x = track.x[i]! * scale + ox, z = track.z[i]! * scale + oz;
    // Normal = perpendicular to the tangent (tx, tz).
    const nx = -track.tz[i]!, nz = track.tx[i]!;
    gg.beginPath();
    gg.moveTo(x - nx * len, z - nz * len);
    gg.lineTo(x + nx * len, z + nz * len);
    gg.strokeStyle = color;
    gg.lineWidth = width;
    gg.setLineDash(dash ? [width / 2, width / 2] : []);
    gg.stroke();
    gg.setLineDash([]);
  };

  const renderBg = (yellow: readonly boolean[]): void => {
    bgG.clearRect(0, 0, bg.width, bg.height);
    if (!track) return;
    const u = k * dpr;
    const t = track;
    bgG.lineJoin = 'round';
    bgG.lineCap = 'round';
    // Pit lane: 2 px fg at 30 %, dashed 6/4.
    if (t.pit.count > 1) {
      path(bgG, t.pit.x, t.pit.z, 0, t.pit.count - 1, false);
      bgG.strokeStyle = 'rgba(242,244,247,.3)';
      bgG.lineWidth = 2 * u;
      bgG.setLineDash([6 * u, 4 * u]);
      bgG.stroke();
      bgG.setLineDash([]);
    }
    // Main track: 7 px ink under-stroke at 60 %, 3 px fg at 85 %.
    path(bgG, t.x, t.z, 0, t.count - 1, true);
    bgG.strokeStyle = 'rgba(10,12,15,.6)';
    bgG.lineWidth = 7 * u;
    bgG.stroke();
    bgG.strokeStyle = 'rgba(242,244,247,.85)';
    bgG.lineWidth = 3 * u;
    bgG.stroke();
    // DRS zones: 3 px green at 70 %.
    bgG.strokeStyle = 'rgba(46,209,107,.7)';
    for (const z of t.drsZones) {
      const a = Math.round(z.activateS), b = Math.round(z.endS);
      path(bgG, t.x, t.z, a, b >= a ? b : b + t.count, false);
      bgG.stroke();
    }
    // Yellow-flag sectors: 4 px yellow.
    const bounds = [0, t.sectors[0], t.sectors[1], t.length];
    for (let sct = 0; sct < 3; sct++) {
      if (!yellow[sct]) continue;
      path(bgG, t.x, t.z, Math.round(bounds[sct]!), Math.round(bounds[sct + 1]!) - 1, false);
      bgG.strokeStyle = '#FFD019';
      bgG.lineWidth = 4 * u;
      bgG.stroke();
    }
    // Sector ticks (2 px fg-3) and the chequered S/F tick (6 px).
    tick(bgG, t.sectors[0], 7 * u, '#949EAB', 2 * u, false);
    tick(bgG, t.sectors[1], 7 * u, '#949EAB', 2 * u, false);
    tick(bgG, 0, 8 * u, INK, 6 * u, false);
    tick(bgG, 0, 8 * u, FG, 6 * u, true);
  };

  const relabel = (): void => {
    air.l.textContent = ctx.t('hud.weather.air');
    trk.l.textContent = ctx.t('hud.weather.track');
    wet.l.textContent = ctx.t('hud.weather.wetness');
    cap.textContent = ctx.t('hud.tyre.caption');
    nextWx = 0;
    tName.reset();
    tAge.reset();
    ring.reset();
    wetCls.reset();
  };
  relabel();

  const drawCars = (m: HudModel): void => {
    const W = canvas.width, H = canvas.height;
    g.clearRect(0, 0, W, H);
    if (!track) return;
    g.drawImage(bg, 0, 0);
    const mmd = m.minimap;
    const n = Math.min(mmd.x.length, mmd.z.length);
    if (dnf.length < n) dnf = new Uint8Array(n * 2);
    dnf.fill(0);
    for (const r of m.tower) if ((r.status === 'dnf' || r.status === 'dsq') && r.car < dnf.length) dnf[r.car] = 1;
    const u = k * dpr;
    const r0 = 4.5 * u;
    g.lineWidth = 1.5 * u;
    g.strokeStyle = INK;
    for (let i = 0; i < n; i++) {
      if (i === mmd.player || dnf[i]) continue;
      g.globalAlpha = mmd.inPit[i] ? 0.5 : 1;
      g.beginPath();
      g.arc(mmd.x[i]! * scale + ox, mmd.z[i]! * scale + oz, r0, 0, Math.PI * 2);
      g.fillStyle = mmd.teamColor[i] ?? FG;
      g.fill();
      g.stroke();
    }
    g.globalAlpha = 1;
    const p = mmd.player;
    if (p >= 0 && p < n) {
      g.beginPath();
      g.arc(mmd.x[p]! * scale + ox, mmd.z[p]! * scale + oz, 6.5 * u, 0, Math.PI * 2);
      g.fillStyle = FG;
      g.fill();
      g.lineWidth = 2.5 * u;
      g.strokeStyle = mmd.teamColor[p] ?? '#E8213F';
      g.stroke();
    }
  };

  const api: BottomLeft = {
    el,
    resize(kk) {
      k = kk;
      dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(MM_W * k * dpr);
      canvas.height = Math.round(MM_H * k * dpr);
      bg.width = canvas.width;
      bg.height = canvas.height;
      fit();
      yellowKey = -1;
    },
    setTrack(t) {
      track = t;
      fit();
      yellowKey = -1;
    },
    setMinimap(on) {
      mmOn = on;
      el.dataset.mm = on ? '1' : '0';
    },
    update(m, now) {
      // Weather strip at 2 Hz.
      if (now >= nextWx) {
        nextWx = now + 500;
        const w = m.weather;
        const lang = ctx.lang();
        air.v.set(fmt.temp(w.airC));
        trk.v.set(fmt.temp(w.trackC));
        wet.v.set(fmt.pctOf(w.wetness, lang));
        const cls = w.wetness < 0.1 ? 'dry' : w.wetness < 0.35 ? 'damp' : w.wetness < 0.65 ? 'wet' : 'soaked';
        wetCls.set(ctx.t(`hud.weather.cls.${cls}`));
        wxRain.set(w.rain > 0.05 ? '1' : '0');
      }
      // Tyres
      const tyre = m.car.tyre;
      ring.set(ctx.t(`hud.tyre.letter.${tyre.compound}`));
      ringC.set(tyre.compound);
      tName.set(ctx.t(`hud.tyre.name.${tyre.compound}`));
      tAge.set(ctx.t('hud.tyre.age', { n: tyre.ageLaps }));
      for (let i = 0; i < 4; i++) {
        const v = tyres[i]!;
        const wr = tyre.wear[i]!;
        v.w.set(String(Math.round(wr <= 1 ? wr * 100 : wr)));
        v.tc.set(fmt.temp(tyre.tempC[i]!, false));
        v.s.set(tyre.state[i]!);
      }
      // Minimap
      if (!mmOn || !track) return;
      const y = m.flags.yellow;
      const key = (y[0] ? 1 : 0) | (y[1] ? 2 : 0) | (y[2] ? 4 : 0);
      if (key !== yellowKey) {
        yellowKey = key;
        renderBg(y);
      }
      drawCars(m);
    },
    relabel,
    dispose() {
      el.remove();
      canvas.width = canvas.height = 0;
      bg.width = bg.height = 0;
    },
  };
  return api;
}
