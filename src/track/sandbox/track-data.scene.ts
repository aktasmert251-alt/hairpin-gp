// ?scene=track-data (Çevre): 2D plot of a track's TrackData (&track=<id>, default istanbul). Arrows pan, +/- zoom, 0 resets.
// &focus=t1…t14 | pit | sf centres on a corner apex / the pit boxes / the S/F line; &zoom=<px per m>.

import type { SandboxScene } from '../../contracts/debug';
import type { TrackData, WallKind } from '../../contracts/track';
import { getTrackExtras } from '../build/extras';
import { loadTrack } from '../index';
import { SURFACE_TYPES } from '../query/surfaces';

const SURFACE_COLOR: Record<string, string> = {
  asphalt: '#3b3e44', line: '#f2f2f2', kerbFlat: '#d7262b', kerbSausage: '#ffd21a', astroturf: '#2f9e5a',
  runoffAsphalt: '#5b5f68', grass: '#3f6b33', gravel: '#c9b07a', pitAsphalt: '#47494f', concrete: '#9a9da3',
};
const WALL_COLOR: Record<WallKind, string> = { armco: '#c9d1da', concrete: '#f4f4f4', tyres: '#111111', tecpro: '#2f6fe8', pitwall: '#ff9f1c', fence: '#a0a0a0' };

const scene: SandboxScene = {
  id: 'track-data',
  title: 'Track data (2D)',
  async create({ canvas, uiRoot, params }) {
    const { data, query: q } = loadTrack((params.get('track') ?? 'istanbul') as TrackData['id']);
    const ex = getTrackExtras(data);
    const ctx = canvas.getContext('2d')!;
    canvas.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;background:#1b1d21';
    let W = 0;
    let H = 0;
    const resize = (): void => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      W = window.innerWidth;
      H = window.innerHeight;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      dirty = true;
    };

    // View: centre (cx, cz) and scale (px per m).
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < data.count; i++) {
      minX = Math.min(minX, data.x[i]!); maxX = Math.max(maxX, data.x[i]!);
      minZ = Math.min(minZ, data.z[i]!); maxZ = Math.max(maxZ, data.z[i]!);
    }
    const home = (): { cx: number; cz: number; k: number } => ({
      cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2, k: Math.min(window.innerWidth / (maxX - minX + 160), window.innerHeight / (maxZ - minZ + 160)),
    });
    let view = home();
    const focus = (params.get('focus') ?? '').toLowerCase();
    const zoomParam = Number(params.get('zoom'));
    const p = { x: 0, y: 0, z: 0 };
    if (/^t\d+$/.test(focus)) {
      const c = data.corners.find((cc) => cc.n === Number(focus.slice(1)));
      if (c) {
        q.worldFromSD(c.apexS, 0, p);
        view = { cx: p.x, cz: p.z, k: 3.2 };
      }
    } else if (focus === 'pit') {
      const b = data.pit.boxes[4]!;
      q.pitWorldFromSD(b.sp, 0, p);
      view = { cx: p.x, cz: p.z, k: 4 };
    } else if (focus === 'sf') {
      view = { cx: 0, cz: 0, k: 4 };
    }
    if (zoomParam > 0) view.k = zoomParam;
    let dirty = true;

    const sx = (x: number): number => (x - view.cx) * view.k + W / 2;
    const sy = (z: number): number => (z - view.cz) * view.k + H / 2;
    const ptSD = (s: number, d: number): [number, number] => {
      q.worldFromSD(s, d, p);
      return [sx(p.x), sy(p.z)];
    };

    const drawBands = (d: TrackData): void => {
      const n = d.count;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        for (const side of [1, -1] as const) {
          const types = side === 1 ? d.bandTypeL : d.bandTypeR;
          const outers = side === 1 ? d.bandOuterL : d.bandOuterR;
          let inner = side === 1 ? d.halfWidthL[i]! : d.halfWidthR[i]!;
          let innerJ = side === 1 ? d.halfWidthL[j]! : d.halfWidthR[j]!;
          for (let b = 0; b < 4; b++) {
            const o = outers[i * 4 + b]!;
            const oj = outers[j * 4 + b]!;
            if (o - inner > 0.01 || oj - innerJ > 0.01) {
              ctx.fillStyle = SURFACE_COLOR[SURFACE_TYPES[types[i * 4 + b]!]!] ?? '#f0f';
              ctx.beginPath();
              const a = ptSD(i, side * inner);
              const bb = ptSD(i, side * o);
              const c = ptSD(i + 1.05, side * oj);
              const e = ptSD(i + 1.05, side * innerJ);
              ctx.moveTo(a[0], a[1]); ctx.lineTo(bb[0], bb[1]); ctx.lineTo(c[0], c[1]); ctx.lineTo(e[0], e[1]);
              ctx.fill();
            }
            inner = Math.max(inner, o);
            innerJ = Math.max(innerJ, oj);
          }
        }
      }
    };

    const ribbon = (fill: string, n: number, at: (k: number, side: 1 | -1) => [number, number]): void => {
      ctx.fillStyle = fill;
      ctx.beginPath();
      for (let k = 0; k < n; k++) {
        const [x, y] = at(k, 1);
        if (k === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      for (let k = n - 1; k >= 0; k--) {
        const [x, y] = at(k, -1);
        ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
    };

    const label = (text: string, x: number, y: number, color = '#ffffff', size = 13): void => {
      ctx.font = `600 ${size}px "Barlow Condensed", "Segoe UI", sans-serif`;
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.75)';
      ctx.strokeText(text, x, y);
      ctx.fillStyle = color;
      ctx.fillText(text, x, y);
    };

    const crossLine = (s: number, color: string, text: string, width = 2): void => {
      const f = q.frameAt(s, { s: 0, px: 0, py: 0, pz: 0, tx: 1, tz: 0, lx: 0, lz: -1, halfWidthL: 0, halfWidthR: 0, crossSlope: 0, curvature: 0, vCurvature: 0, grade: 0, sector: 0 });
      const a = ptSD(s, f.halfWidthL + 3);
      const b = ptSD(s, -f.halfWidthR - 3);
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
      ctx.stroke();
      if (text) label(text, b[0] + 4, b[1] + 4, color, 12);
    };

    const draw = (): void => {
      ctx.fillStyle = '#1b1d21';
      ctx.fillRect(0, 0, W, H);
      drawBands(data);
      // Main asphalt + edge lines.
      ribbon(SURFACE_COLOR.asphalt!, data.count + 1, (k, side) => ptSD(k, side * (side === 1 ? data.halfWidthL[k % data.count]! : data.halfWidthR[k % data.count]!)));
      ctx.strokeStyle = '#f2f2f2';
      ctx.lineWidth = Math.max(1, 0.12 * view.k);
      for (const side of [1, -1] as const) {
        ctx.beginPath();
        for (let k = 0; k <= data.count; k++) {
          const i = k % data.count;
          const [x, y] = ptSD(k, side * ((side === 1 ? data.halfWidthL[i]! : data.halfWidthR[i]!) - 0.06));
          if (k === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      // Racing-line approximation.
      if (ex) {
        ctx.strokeStyle = 'rgba(64,224,208,0.55)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([6, 6]);
        ctx.beginPath();
        for (let k = 0; k <= data.count; k += 2) {
          const [x, y] = ptSD(k, ex.lineD[k % data.count]!);
          if (k === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.setLineDash([]);
      }
      // Pit ribbon, limiter lines and boxes.
      const pit = data.pit;
      if (pit.count > 1) {
        const P = { x: 0, y: 0, z: 0 };
        const pAt = (sp: number, d: number): [number, number] => {
          q.pitWorldFromSD(sp, d, P);
          return [sx(P.x), sy(P.z)];
        };
        const dsp = pit.length / (pit.count - 1);
        ribbon(SURFACE_COLOR.pitAsphalt!, pit.count, (k, side) => pAt(k * dsp, side * pit.halfWidth[k]!));
        for (const [sp, col] of [[pit.limitStartSp, '#ff3b30'], [pit.limitEndSp, '#34c759']] as const) {
          const hw = pit.halfWidth[Math.round(sp / dsp)]!;
          const a = pAt(sp, hw);
          const b = pAt(sp, -hw);
          ctx.strokeStyle = col;
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(a[0], a[1]);
          ctx.lineTo(b[0], b[1]);
          ctx.stroke();
        }
        for (const box of pit.boxes) {
          const [x, y] = pAt(box.sp, box.d);
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(x - 3, y - 3, 6, 6);
          if (view.k > 2) label(box.teamId, x + 5, y - 4, '#ffffff', 11);
        }
      }
      // Walls by kind.
      for (const w of data.walls) {
        ctx.strokeStyle = WALL_COLOR[w.kind];
        ctx.lineWidth = w.kind === 'pitwall' ? 2.5 : 2;
        ctx.beginPath();
        for (let m = 0; m < w.xz.length; m += 2) {
          const x = sx(w.xz[m]!);
          const y = sy(w.xz[m + 1]!);
          if (m === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      // Grid slots.
      for (const g of data.grid) {
        const [x, y] = ptSD(g.s, g.d);
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(x, y, Math.max(2, 0.9 * view.k), 0, Math.PI * 2);
        ctx.fill();
      }
      // Timing lines, DRS, sectors.
      crossLine(0, '#ffffff', 'S/F', 3);
      crossLine(data.sectors[0], '#ffd21a', 'S2');
      crossLine(data.sectors[1], '#ffd21a', 'S3');
      for (const t of data.timingLines) {
        if (t.kind === 'drsDetect') crossLine(t.s, '#ff9f1c', `DRS${t.ref + 1} detect`, 1.5);
        else if (t.kind === 'drsActivate') crossLine(t.s, '#34c759', `DRS${t.ref + 1} on`, 1.5);
        else if (t.kind === 'drsEnd') crossLine(t.s, '#ff3b30', `DRS${t.ref + 1} end`, 1.5);
        else if (t.kind === 'speedTrap') crossLine(t.s, '#bf5af2', 'trap', 1.5);
      }
      // Cut-zone gates.
      for (const cz of data.cutZones) {
        for (const g of cz.gates) {
          const f = q.frameAt(g, { s: 0, px: 0, py: 0, pz: 0, tx: 1, tz: 0, lx: 0, lz: -1, halfWidthL: 0, halfWidthR: 0, crossSlope: 0, curvature: 0, vCurvature: 0, grade: 0, sector: 0 });
          const edge = cz.side === 1 ? f.halfWidthL + 1 : -(f.halfWidthR + 1);
          const a = ptSD(g, edge);
          const b = ptSD(g, edge + cz.side * 6);
          ctx.strokeStyle = '#ff2d95';
          ctx.lineWidth = 2;
          ctx.setLineDash([3, 3]);
          ctx.beginPath();
          ctx.moveTo(a[0], a[1]);
          ctx.lineTo(b[0], b[1]);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }
      // Corner numbers at the apex (outside of the corner).
      for (const c of data.corners) {
        const f = q.frameAt(c.apexS, { s: 0, px: 0, py: 0, pz: 0, tx: 1, tz: 0, lx: 0, lz: -1, halfWidthL: 0, halfWidthR: 0, crossSlope: 0, curvature: 0, vCurvature: 0, grade: 0, sector: 0 });
        const off = c.dir === 'L' ? -(f.halfWidthR + 18 / Math.max(0.4, view.k / 2)) : f.halfWidthL + 18 / Math.max(0.4, view.k / 2);
        const [x, y] = ptSD(c.apexS, off);
        label(`T${c.n}`, x - 8, y + 5, '#ffffff', 16);
      }
      // Legend.
      const items: [string, string][] = [
        ...Object.entries(SURFACE_COLOR), ...Object.entries(WALL_COLOR).map(([k, v]) => [`wall ${k}`, v] as [string, string]),
      ];
      ctx.fillStyle = 'rgba(9,11,14,0.85)';
      ctx.fillRect(12, 12, 190, 22 + items.length * 17);
      items.forEach(([name, col], k) => {
        ctx.fillStyle = col;
        ctx.fillRect(22, 24 + k * 17, 14, 10);
        label(name, 44, 34 + k * 17, '#e8e8e8', 13);
      });
      label(`${data.name.en} ${data.length} m · ${ex?.source ?? ''} · ${view.k.toFixed(2)} px/m`, 12, H - 14, '#e8e8e8', 14);
    };

    const onKey = (e: KeyboardEvent): void => {
      const pan = 120 / view.k;
      let handled = true;
      switch (e.code) {
        case 'ArrowLeft': view.cx -= pan; break;
        case 'ArrowRight': view.cx += pan; break;
        case 'ArrowUp': view.cz -= pan; break;
        case 'ArrowDown': view.cz += pan; break;
        case 'Equal': case 'NumpadAdd': view.k *= 1.25; break;
        case 'Minus': case 'NumpadSubtract': view.k /= 1.25; break;
        case 'Digit0': case 'Numpad0': view = home(); break;
        default: handled = false;
      }
      if (handled) {
        e.preventDefault();
        dirty = true;
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', resize);
    resize();
    void uiRoot;

    return {
      update() {
        if (!dirty) return;
        dirty = false;
        draw();
      },
      dispose() {
        window.removeEventListener('keydown', onKey);
        window.removeEventListener('resize', resize);
      },
    };
  },
};

export default scene;
