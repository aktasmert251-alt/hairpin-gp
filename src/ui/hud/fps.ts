// FPS counter (settings.graphics.showFps): a corner readout of frames per second and frame time, own rAF loop,
// refreshed twice a second. Independent of the HUD so it also shows in menus and on the loading screen.

import { h } from '../dom';

export interface FpsCounter {
  setOn(on: boolean): void;
  dispose(): void;
}

const REFRESH_MS = 500;

export function createFpsCounter(parent: HTMLElement): FpsCounter {
  const el = h('div', 'apx-fps', parent);
  el.setAttribute('aria-hidden', 'true');
  Object.assign(el.style, {
    position: 'fixed', top: '6px', right: '8px', zIndex: '9999', pointerEvents: 'none',
    font: '600 12px/1.2 ui-monospace, Consolas, monospace', color: '#fff', background: 'rgba(0,0,0,0.55)',
    padding: '3px 7px', borderRadius: '3px', letterSpacing: '0.02em', display: 'none',
  } satisfies Partial<CSSStyleDeclaration>);
  let raf = 0;
  let frames = 0;
  let worst = 0;
  let windowStart = 0;
  let prev = 0;

  const tick = (now: number): void => {
    raf = requestAnimationFrame(tick);
    if (prev) worst = Math.max(worst, now - prev);
    prev = now;
    frames++;
    const span = now - windowStart;
    if (span < REFRESH_MS) return;
    const fps = (frames * 1000) / span;
    el.textContent = `${Math.round(fps)} FPS · ${(span / frames).toFixed(1)} ms · max ${worst.toFixed(0)} ms`;
    el.style.color = fps >= 55 ? '#7dff9a' : fps >= 30 ? '#ffd166' : '#ff6b6b';
    frames = 0;
    worst = 0;
    windowStart = now;
  };

  return {
    setOn(on) {
      el.style.display = on ? 'block' : 'none';
      if (on && !raf) {
        frames = 0;
        worst = 0;
        prev = 0;
        windowStart = performance.now();
        el.textContent = '… FPS';
        raf = requestAnimationFrame(tick);
      } else if (!on && raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    },
    dispose() {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      el.remove();
    },
  };
}
