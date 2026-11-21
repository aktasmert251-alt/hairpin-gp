// Tiny DOM helpers for src/ui. HUD writes go through `Txt`/`Attr` caches so the DOM is touched only on change
// and the 30 Hz update path never reads layout (DESIGN §7.7).

import hairpinWordmark from '../../public/assets/gra/brand/hairpin-gp.svg?raw';
import hairpinWordmarkMono from '../../public/assets/gra/brand/hairpin-gp-mono.svg?raw';

const SVG_NS = 'http://www.w3.org/2000/svg';

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, parent?: Element | null, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent?.appendChild(e);
  return e;
}

/** 24-grid icon paths (DESIGN §6.16): 2 px stroke, square caps, miter joins, currentColor. `f:` prefix = filled. */
const ICONS: Record<string, string> = {
  clock: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l3 2M9 2h6"/>',
  up: 'f:<path d="M12 5l8 12H4z"/>',
  down: 'f:<path d="M12 19L4 7h16z"/>',
  'arrow-up': '<path d="M12 20V5M6 11l6-6 6 6"/>',
  'arrow-down': '<path d="M12 4v15M6 13l6 6 6-6"/>',
  'arrow-left': '<path d="M20 12H5M11 6l-6 6 6 6"/>',
  'arrow-right': '<path d="M4 12h15M13 6l6 6-6 6"/>',
  'chev-l': '<path d="M15 5l-7 7 7 7"/>',
  'chev-r': '<path d="M9 5l7 7-7 7"/>',
  drop: '<path d="M12 3c4 5 6 8.5 6 11.5a6 6 0 0 1-12 0C6 11.5 8 8 12 3z"/>',
  flag: '<path d="M5 21V3M5 4h12l-3 4 3 4H5"/>',
  chequered: 'f:<path d="M5 3h2v18H5zM7 4h4v4H7zM11 8h4v4h-4zM15 4h4v4h-4zM7 12h4v4H7zM15 12h4v4h-4z"/><path d="M7 4h12v12H7z" fill="none" stroke="currentColor" stroke-width="1.5"/>',
  'bw-flag': '<path d="M5 21V3M5 4h12v8H5z"/><path d="M5 12L17 4v8z" fill="currentColor" stroke="none"/>',
  stopwatch: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4M9 2h6M19 5l-2 2"/>',
  warn: '<path d="M12 3l9 18H3z"/><path d="M12 10v5M12 17v1"/>',
  info: '<rect x="4" y="4" width="16" height="16"/><path d="M12 11v6M12 7v1"/>',
  bolt: '<path d="M13 2L5 14h6l-1 8 8-12h-6z"/>',
  pit: '<rect x="4" y="4" width="16" height="16"/><path d="M9 17V7h4a3 3 0 0 1 0 6H9"/>',
  check: '<path d="M4 12l5 5L20 6"/>',
  cross: '<path d="M5 5l14 14M19 5L5 19"/>',
  rewind: '<path d="M11 6l-7 6 7 6zM20 6l-7 6 7 6z"/>',
  thermo: '<path d="M10 4h4v10.5a4 4 0 1 1-4 0z"/>',
  tyre: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/>',
  camera: '<rect x="3" y="7" width="18" height="13"/><circle cx="12" cy="13.5" r="3.5"/><path d="M8 7l2-3h4l2 3"/>',
};

export function icon(name: string, cls = ''): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  const def = ICONS[name] ?? ICONS.info!;
  const filled = def.startsWith('f:');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', `apx-i${filled ? ' fill' : ''}${cls ? ' ' + cls : ''}`);
  svg.innerHTML = filled ? def.slice(2) : def;
  return svg;
}

/** Text slot that writes `textContent` only when the string changes. */
export class Txt {
  private v: string | null = null;
  constructor(readonly el: HTMLElement) {}
  set(s: string): void {
    if (s !== this.v) {
      this.v = s;
      this.el.textContent = s;
    }
  }
  reset(): void {
    this.v = null;
  }
}

/** Data-attribute slot that writes only on change. */
export class Attr {
  private v: string | null = null;
  constructor(readonly el: HTMLElement | SVGElement, readonly name: string) {}
  set(s: string): void {
    if (s !== this.v) {
      this.v = s;
      this.el.setAttribute(this.name, s);
    }
  }
}

/** `transform: scaleX(f)` slot rounded to 1/1000, written only on change. */
export class ScaleX {
  private v = -1;
  constructor(readonly el: HTMLElement) {}
  set(f: number): void {
    const q = Math.round(Math.max(0, Math.min(1, f)) * 1000);
    if (q !== this.v) {
      this.v = q;
      this.el.style.transform = `scaleX(${q / 1000})`;
    }
  }
}

/** Committed D-047 outlines; inline so the intro can animate the original segments. */
export function wordmark(cls: string, label: string, mono = false): SVGSVGElement {
  const template = document.createElement('template');
  template.innerHTML = mono ? hairpinWordmarkMono : hairpinWordmark;
  const svg = template.content.querySelector('svg')!;
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', label);
  svg.setAttribute('class', cls);
  return svg;
}
