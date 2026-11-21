// Injects the UI stylesheets as <style> tags (removed again on dispose) and runs the fonts gate (DESIGN §3.1):
// every shipped weight is awaited with Turkish glyphs so both latin and latin-ext subsets are in before the
// first UI paint; `font-display: block` then guarantees no fallback face ever shows.

import baseCss from './base.css?inline';
import fontsCss from './fonts.css?inline';
import hudCss from './hud.css?inline';
import menuCss from './menu.css?inline';
import onlineCss from './online.css?inline';
import tokensCss from './tokens.css?inline';
import customTeamsCss from './customTeams.css?inline';
import responsiveCss from './responsive.css?inline';
import aboutCss from './about.css?inline';
import touchCss from './touch.css?inline';

let refs = 0;
let styleEl: HTMLStyleElement | null = null;

export function injectStyles(): () => void {
  refs++;
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.dataset.apx = 'ui';
    styleEl.textContent = [fontsCss, tokensCss, baseCss, hudCss, menuCss, onlineCss, customTeamsCss, responsiveCss, aboutCss, touchCss].join('\n');
    document.head.appendChild(styleEl);
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    refs--;
    if (refs <= 0 && styleEl) {
      styleEl.remove();
      styleEl = null;
      refs = 0;
    }
  };
}

const PROBE = 'İŞĞÇÖÜışğçöü0123';
const FACES = ['500 16px "Barlow Condensed"', '600 16px "Barlow Condensed"', '700 16px "Barlow Condensed"', '800 16px "Barlow Condensed"', '400 16px "Barlow"', '600 16px "Barlow"'];
let gate: Promise<void> | null = null;

/** Resolves when all 12 font files are loaded (or after 4 s, so a missing file never blocks the game). */
export function fontsReady(): Promise<void> {
  if (gate) return gate;
  if (typeof document === 'undefined' || !document.fonts) return (gate = Promise.resolve());
  const all = Promise.all(FACES.map((f) => document.fonts.load(f, PROBE).catch(() => [])));
  gate = Promise.race([all.then(() => undefined), new Promise<void>((r) => setTimeout(r, 4000))]);
  return gate;
}

/** Preload hints for the Condensed 600/700 files (latin + latin-ext), added once at import time. */
export function preloadFonts(): void {
  if (typeof document === 'undefined' || document.querySelector('link[data-apx-font]')) return;
  for (const w of [600, 700]) {
    for (const sub of ['latin', 'latin-ext']) {
      const l = document.createElement('link');
      l.rel = 'preload';
      l.as = 'font';
      l.type = 'font/woff2';
      l.crossOrigin = 'anonymous';
      l.href = `${import.meta.env.BASE_URL}assets/gra/fonts/barlow-condensed-${sub}-${w}-normal.woff2`;
      l.dataset.apxFont = '1';
      document.head.appendChild(l);
    }
  }
}
