// Fictional car sponsors (DESIGN.md §1.4.3): every brand has its own wordmark treatment (family / weight / tracking /
// slant / outline, inline, stencil or two-line set) and an original geometric emblem drawn as canvas paths, plus its own
// colour pair. No real brands or logos. Display strings are pre-composed in their final Turkish casing (İ, Ş, Ğ, Ç, Ö).
// Team sets: each team carries a unique combination; a sponsor appears on at most two teams and is title on at most one.

export type Emblem =
  | 'tulip' | 'chevron' | 'wave' | 'sun' | 'ring' | 'arrow' | 'sail' | 'sesame' | 'arch' | 'tyre' | 'drop' | 'dot'
  | 'wing' | 'beam' | 'bolt' | 'diamond' | 'speed' | 'crate';

export interface SponsorBrand {
  text: string;
  /** Second, small line (two-line wordmarks). */
  small?: string;
  bg: string; fg: string;
  /** Accent (emblem / swash / shadow); defaults to fg. */
  ac?: string;
  family: 'cond' | 'text';
  weight: 400 | 500 | 600 | 700 | 800;
  /** Letter spacing in em. */
  track: number;
  /** Slant in degrees (positive leans right). */
  slant: number;
  mode: 'fill' | 'outline' | 'inline' | 'stencil' | 'shadow';
  emblem?: Emblem;
  /** Swash underline under the word. */
  swash?: boolean;
}

export const SPONSOR_BRANDS: Readonly<Record<string, SponsorBrand>> = {
  lale: { text: 'LALE ÇAY', bg: '#B3122E', fg: '#F4E9D0', family: 'text', weight: 600, track: 0.04, slant: 0, mode: 'fill', emblem: 'tulip' },
  kuzey: { text: 'KUZEY AIR', bg: '#0E2A47', fg: '#FFFFFF', ac: '#6EC1FF', family: 'cond', weight: 700, track: 0.1, slant: 0, mode: 'fill', emblem: 'chevron' },
  dalga: { text: 'DALGA TEK', bg: '#F5F6F8', fg: '#0A0C0F', ac: '#2F6BFF', family: 'text', weight: 400, track: 0.02, slant: 0, mode: 'fill', emblem: 'wave' },
  yali: { text: 'YALI ENERJİ', bg: '#0B3D2E', fg: '#7CE0B5', family: 'cond', weight: 600, track: 0.12, slant: 0, mode: 'fill', emblem: 'sun' },
  sekant: { text: 'SEKANT', bg: '#0A0A0A', fg: '#C9CDD2', family: 'cond', weight: 500, track: 0.3, slant: 0, mode: 'fill', emblem: 'ring' },
  mavi: { text: 'MAVİ ROTA', small: 'LOJİSTİK', bg: '#0057B8', fg: '#FFFFFF', family: 'cond', weight: 800, track: 0.02, slant: 0, mode: 'fill', emblem: 'arrow' },
  vela: { text: 'VELA FUEL', bg: '#101214', fg: '#FFB000', family: 'cond', weight: 800, track: 0.02, slant: 12, mode: 'inline', emblem: 'sail' },
  simit: { text: 'SİMİT EXPRESS', bg: '#E8A33D', fg: '#5B3A1E', family: 'cond', weight: 800, track: 0.0, slant: 12, mode: 'fill', emblem: 'sesame', swash: true },
  kervan: { text: 'KERVAN BANK', bg: '#4A1029', fg: '#D8B45A', family: 'cond', weight: 700, track: 0.06, slant: 0, mode: 'outline', emblem: 'arch' },
  akLastik: { text: 'AK LASTİK', bg: '#121212', fg: '#FFFFFF', ac: '#FFC400', family: 'cond', weight: 800, track: 0.0, slant: 20, mode: 'stencil', emblem: 'tyre' },
  ayro: { text: 'AYRO OIL', bg: '#0A4D5C', fg: '#FFFFFF', ac: '#FF8A1F', family: 'cond', weight: 800, track: 0.04, slant: 0, mode: 'shadow', emblem: 'drop' },
  tevenin: { text: 'TEVENİN', bg: '#F5F6F8', fg: '#3A2E9C', family: 'text', weight: 400, track: 0.34, slant: 0, mode: 'fill', emblem: 'dot' },
  goksu: { text: 'GÖKSU', small: 'HAVACILIK', bg: '#1C6FB8', fg: '#FFFFFF', ac: '#BFE3FF', family: 'cond', weight: 600, track: 0.14, slant: 0, mode: 'fill', emblem: 'wing' },
  lazerta: { text: 'LAZERTA', bg: '#0B0D10', fg: '#4DFF7A', family: 'cond', weight: 700, track: 0.18, slant: 0, mode: 'stencil', emblem: 'beam' },
  voltara: { text: 'VOLTARA', small: 'ENERJİ', bg: '#FFD400', fg: '#111111', family: 'cond', weight: 800, track: 0.02, slant: 8, mode: 'fill', emblem: 'bolt' },
  korvis: { text: 'KORVİS', bg: '#5B2A86', fg: '#FFFFFF', ac: '#E6C8FF', family: 'text', weight: 600, track: 0.08, slant: 0, mode: 'outline', emblem: 'diamond' },
  nevra: { text: 'NEVRA SPOR', bg: '#FF5A4E', fg: '#FFFFFF', family: 'cond', weight: 800, track: 0.0, slant: 18, mode: 'fill', emblem: 'speed' },
  tarven: { text: 'TARVEN', small: 'LOJİSTİK', bg: '#1B2A4A', fg: '#FFB547', family: 'cond', weight: 700, track: 0.08, slant: 0, mode: 'inline', emblem: 'crate' },
};

/** Title sponsor (null = heritage livery) and secondary sponsors per team, in placement order (all combinations unique). */
export const TEAM_SPONSORS: Readonly<Record<string, { title: string | null; extra: readonly string[] }>> = {
  anka: { title: 'lale', extra: ['akLastik', 'tevenin', 'nevra'] },
  aurora: { title: 'kuzey', extra: ['goksu', 'ayro'] },
  vortex: { title: 'dalga', extra: ['lazerta', 'korvis', 'sekant'] },
  solaris: { title: 'yali', extra: ['voltara', 'nevra'] },
  kestrel: { title: 'sekant', extra: ['kervan', 'tevenin'] },
  meridian: { title: 'mavi', extra: ['goksu', 'tarven'] },
  titan: { title: 'vela', extra: ['akLastik', 'lazerta', 'tarven'] },
  zephyr: { title: 'simit', extra: ['voltara', 'ayro'] },
  ironclad: { title: 'kervan', extra: ['korvis', 'vela'] },
  nova: { title: null, extra: ['yali', 'mavi'] },
};

type Ctx = CanvasRenderingContext2D;

/** Original emblem paths, centred at (0, 0) in a box of size `s`. */
function emblem(g: Ctx, kind: Emblem, s: number, fg: string, ac: string, bg: string): void {
  const r = s / 2;
  g.save();
  g.fillStyle = ac;
  g.strokeStyle = ac;
  g.lineJoin = 'round';
  g.lineCap = 'round';
  const path = (pts: [number, number][]): void => {
    g.beginPath();
    pts.forEach(([x, y], i) => (i === 0 ? g.moveTo(x * r, y * r) : g.lineTo(x * r, y * r)));
    g.closePath();
    g.fill();
  };
  switch (kind) {
    case 'tulip':
      for (const a of [-0.45, 0, 0.45]) {
        g.save();
        g.rotate(a);
        g.beginPath();
        g.ellipse(0, -0.25 * r, 0.22 * r, 0.62 * r, 0, 0, Math.PI * 2);
        g.fill();
        g.restore();
      }
      break;
    case 'chevron':
      path([[-0.9, 0.5], [0, -0.55], [0.9, 0.5], [0.5, 0.5], [0, -0.05], [-0.5, 0.5]]);
      break;
    case 'wave':
      g.lineWidth = 0.16 * r;
      for (const dy of [-0.3, 0.3]) {
        g.beginPath();
        for (let i = 0; i <= 16; i++) {
          const x = -0.9 + (1.8 * i) / 16;
          const y = dy + 0.22 * Math.sin(x * 4);
          if (i === 0) g.moveTo(x * r, y * r);
          else g.lineTo(x * r, y * r);
        }
        g.stroke();
      }
      break;
    case 'sun':
      g.beginPath();
      g.arc(0, 0.35 * r, 0.42 * r, Math.PI, 0);
      g.fill();
      g.lineWidth = 0.12 * r;
      for (let k = 0; k < 5; k++) {
        const a = Math.PI + (k + 0.5) * (Math.PI / 5);
        g.beginPath();
        g.moveTo(Math.cos(a) * 0.6 * r, 0.35 * r + Math.sin(a) * 0.6 * r);
        g.lineTo(Math.cos(a) * 0.9 * r, 0.35 * r + Math.sin(a) * 0.9 * r);
        g.stroke();
      }
      break;
    case 'ring':
      g.lineWidth = 0.12 * r;
      g.beginPath();
      g.arc(0, 0, 0.75 * r, 0, Math.PI * 2);
      g.stroke();
      g.beginPath();
      g.moveTo(0, 0);
      g.lineTo(Math.sin(0.21) * 0.6 * r, -Math.cos(0.21) * 0.6 * r);
      g.stroke();
      break;
    case 'arrow':
      path([[-0.9, -0.22], [0.2, -0.22], [0.2, -0.6], [0.95, 0], [0.2, 0.6], [0.2, 0.22], [-0.9, 0.22]]);
      break;
    case 'sail':
      path([[-0.55, 0.75], [0.1, -0.85], [0.7, 0.75]]);
      break;
    case 'sesame':
      g.lineWidth = 0.22 * r;
      g.beginPath();
      g.arc(0, 0, 0.62 * r, 0, Math.PI * 2);
      g.stroke();
      g.fillStyle = bg;
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2;
        g.beginPath();
        g.ellipse(Math.cos(a) * 0.62 * r, Math.sin(a) * 0.62 * r, 0.05 * r, 0.09 * r, a, 0, Math.PI * 2);
        g.fill();
      }
      break;
    case 'arch':
      g.beginPath();
      g.moveTo(-0.8 * r, 0.8 * r);
      g.lineTo(-0.8 * r, -0.1 * r);
      g.arc(0, -0.1 * r, 0.8 * r, Math.PI, 0);
      g.lineTo(0.8 * r, 0.8 * r);
      g.lineTo(0.45 * r, 0.8 * r);
      g.lineTo(0.45 * r, -0.1 * r);
      g.arc(0, -0.1 * r, 0.45 * r, 0, Math.PI, true);
      g.lineTo(-0.45 * r, 0.8 * r);
      g.closePath();
      g.fill();
      break;
    case 'tyre':
      g.lineWidth = 0.3 * r;
      g.beginPath();
      g.arc(0, 0, 0.62 * r, 0, Math.PI * 2);
      g.stroke();
      g.strokeStyle = bg;
      g.lineWidth = 0.08 * r;
      for (let k = 0; k < 10; k++) {
        const a = (k / 10) * Math.PI * 2;
        g.beginPath();
        g.moveTo(Math.cos(a) * 0.5 * r, Math.sin(a) * 0.5 * r);
        g.lineTo(Math.cos(a) * 0.78 * r, Math.sin(a) * 0.78 * r);
        g.stroke();
      }
      break;
    case 'drop':
      g.beginPath();
      g.moveTo(0, -0.9 * r);
      g.bezierCurveTo(0.35 * r, -0.35 * r, 0.62 * r, 0.05 * r, 0.62 * r, 0.3 * r);
      g.arc(0, 0.3 * r, 0.62 * r, 0, Math.PI);
      g.bezierCurveTo(-0.62 * r, 0.05 * r, -0.35 * r, -0.35 * r, 0, -0.9 * r);
      g.fill();
      break;
    case 'dot':
      g.lineWidth = 0.1 * r;
      g.beginPath();
      g.arc(0, 0, 0.7 * r, 0, Math.PI * 2);
      g.stroke();
      g.beginPath();
      g.arc(0, 0, 0.28 * r, 0, Math.PI * 2);
      g.fill();
      break;
    case 'wing':
      path([[-0.95, 0.2], [-0.1, -0.45], [-0.1, -0.15], [-0.75, 0.35]]);
      path([[0.95, 0.2], [0.1, -0.45], [0.1, -0.15], [0.75, 0.35]]);
      path([[-0.12, -0.05], [0.12, -0.05], [0.08, 0.55], [-0.08, 0.55]]);
      break;
    case 'beam':
      g.lineWidth = 0.08 * r;
      g.beginPath();
      g.moveTo(-0.95 * r, 0);
      g.lineTo(0.95 * r, 0);
      g.stroke();
      path([[0, -0.5], [0.32, 0], [0, 0.5], [-0.32, 0]]);
      break;
    case 'bolt':
      path([[0.25, -0.9], [-0.45, 0.1], [-0.02, 0.1], [-0.25, 0.9], [0.5, -0.15], [0.05, -0.15]]);
      break;
    case 'diamond':
      g.lineWidth = 0.14 * r;
      g.beginPath();
      g.moveTo(0, -0.8 * r);
      g.lineTo(0.8 * r, 0);
      g.lineTo(0, 0.8 * r);
      g.lineTo(-0.8 * r, 0);
      g.closePath();
      g.stroke();
      path([[0, -0.3], [0.3, 0], [0, 0.3], [-0.3, 0]]);
      break;
    case 'speed':
      for (const [y, w] of [[-0.45, 0.9], [0, 1.6], [0.45, 1.2]] as const) path([[0.9 - w, y - 0.1], [0.9, y - 0.1], [0.84, y + 0.1], [0.84 - w, y + 0.1]]);
      break;
    case 'crate':
      g.lineWidth = 0.12 * r;
      g.strokeRect(-0.75 * r, -0.75 * r, 1.5 * r, 1.5 * r);
      path([[-0.45, -0.15], [0.1, -0.15], [0.1, -0.42], [0.55, 0], [0.1, 0.42], [0.1, 0.15], [-0.45, 0.15]]);
      break;
  }
  g.restore();
  void fg;
}

/**
 * Draws a sponsor wordmark centred at the current origin into a W × H box (current transform units, y down).
 * `onPaint` = draw straight onto the livery (no panel) with these colours, outlined for contrast.
 */
export function drawWordmark(g: Ctx, b: SponsorBrand, W: number, H: number, fonts: { cond: string; text: string }, onPaint?: { fg: string; outline: string }): void {
  const fg = onPaint?.fg ?? b.fg;
  const ac = onPaint ? onPaint.fg : b.ac ?? b.fg;
  const bg = onPaint ? 'rgba(0,0,0,0)' : b.bg;
  const sk = Math.tan((b.slant * Math.PI) / 180);
  g.save();
  if (!onPaint) {
    g.fillStyle = b.bg;
    g.beginPath();
    g.moveTo(-W / 2 + sk * H / 2, -H / 2);
    g.lineTo(W / 2 + sk * H / 2, -H / 2);
    g.lineTo(W / 2 - sk * H / 2, H / 2);
    g.lineTo(-W / 2 - sk * H / 2, H / 2);
    g.closePath();
    g.fill();
  }
  // Measure the word first, then centre emblem + word as one group inside the box.
  const two = !!b.small;
  const size = H * (two ? 0.52 : 0.66);
  const family = b.family === 'cond' ? fonts.cond : fonts.text;
  g.font = `${b.weight} ${size}px ${family}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  (g as Ctx & { letterSpacing: string }).letterSpacing = `${b.track * size}px`;
  const tw = g.measureText(b.text).width;
  const es = b.emblem ? H * 0.7 : 0;
  const gap = b.emblem ? H * 0.16 : 0;
  const pad = H * 0.12;
  const sx = Math.min(1, (W - 2 * pad - es - gap) / tw);
  const groupW = es + gap + tw * sx;
  const start = -groupW / 2;
  if (b.emblem) {
    g.save();
    g.translate(start + es / 2, 0);
    if (onPaint) {
      g.save();
      g.scale(1.12, 1.12);
      emblem(g, b.emblem, es, onPaint.outline, onPaint.outline, onPaint.outline);
      g.restore();
    }
    emblem(g, b.emblem, es, fg, ac, onPaint ? onPaint.outline : bg);
    g.restore();
  }
  const cy = two ? -H * 0.11 : 0;
  g.translate(start + es + gap + (tw * sx) / 2, cy);
  g.transform(sx, 0, -sk, 1, 0, 0);
  const fillWord = (): void => {
    if (onPaint) {
      g.lineJoin = 'round';
      g.lineWidth = size * 0.18;
      g.strokeStyle = onPaint.outline;
      g.strokeText(b.text, 0, 0);
    }
    switch (b.mode) {
      case 'outline':
        g.lineWidth = size * 0.09;
        g.strokeStyle = fg;
        g.strokeText(b.text, 0, 0);
        g.fillStyle = ac === fg ? 'rgba(0,0,0,0)' : ac;
        if (!onPaint) g.globalAlpha = 0.35;
        g.fillText(b.text, 0, 0);
        g.globalAlpha = 1;
        break;
      case 'shadow':
        g.fillStyle = ac;
        g.fillText(b.text, size * 0.07, size * 0.07);
        g.fillStyle = fg;
        g.fillText(b.text, 0, 0);
        break;
      default:
        g.fillStyle = fg;
        g.fillText(b.text, 0, 0);
    }
    if (b.mode === 'inline' && !onPaint) {
      g.lineWidth = size * 0.035;
      g.strokeStyle = b.bg;
      g.strokeText(b.text, 0, 0);
    }
    if (b.mode === 'stencil') {
      // Stencil bridges: two thin cuts across the letters in the panel (or paint outline) colour.
      g.fillStyle = onPaint ? onPaint.outline : b.bg;
      g.fillRect(-tw / 2 - size, -size * 0.04, tw + 2 * size, size * 0.07);
      if (b.emblem === 'tyre') {
        g.fillStyle = b.ac ?? fg;
        g.fillRect(-tw / 2, size * 0.42, tw, size * 0.08);
      }
    }
  };
  fillWord();
  if (b.swash) {
    g.strokeStyle = fg;
    g.lineWidth = size * 0.07;
    g.beginPath();
    g.moveTo(-tw / 2, size * 0.5);
    g.bezierCurveTo(-tw / 6, size * 0.75, tw / 6, size * 0.3, tw / 2 + size * 0.2, size * 0.45);
    g.stroke();
  }
  (g as Ctx & { letterSpacing: string }).letterSpacing = '0px';
  if (two) {
    const s2 = H * 0.2;
    g.font = `${Math.min(700, b.weight)} ${s2}px ${family}`;
    (g as Ctx & { letterSpacing: string }).letterSpacing = `${s2 * 0.45}px`;
    const w2 = g.measureText(b.small!).width;
    const k2 = Math.min(1, tw / w2) / sx;
    g.save();
    g.scale(Math.min(k2, 1 / sx), 1);
    if (onPaint) {
      g.lineWidth = s2 * 0.2;
      g.strokeStyle = onPaint.outline;
      g.strokeText(b.small!, 0, H * 0.36);
    }
    g.fillStyle = ac;
    g.fillText(b.small!, 0, H * 0.36);
    g.restore();
    (g as Ctx & { letterSpacing: string }).letterSpacing = '0px';
  }
  g.restore();
}
