// Trailer end card (D-047): the only text in the film is the HAIRPIN GP wordmark. frame-logo-outro style segmented
// assembly of public/assets/gra/brand/hairpin-gp.svg (outlined paths, no font needed): the word slides in, the GP
// block wipes in on its 12° slant, its letters rise inside it, the vermilion apex marker lands last. No glow, no
// letter-by-letter (DESIGN §8.1). One paused GSAP timeline, seeked with totalTime(t); nothing here reads a clock.

import { gsap } from 'gsap';
import { CustomEase } from 'gsap/CustomEase';
import { DURATION, END_T } from './shots';

const MARK_URL = `${import.meta.env.BASE_URL}assets/gra/brand/hairpin-gp.svg`;
/** Mark scale on the 1920 x 1080 stage: 1.85 px per mark unit (cap 185 px, mark 1058 px wide). */
const PX = 1.85;

export interface EndCard {
  seek(t: number): void;
  layout(): void;
  dispose(): void;
}

export async function createEndCard(root: HTMLElement): Promise<EndCard> {
  gsap.registerPlugin(CustomEase);
  const out = CustomEase.create('trl.out', '0.22,1,0.36,1');
  const svgText = await (await fetch(MARK_URL)).text();

  const el = document.createElement('div');
  el.setAttribute('aria-hidden', 'true');
  el.style.cssText = 'position:fixed;left:0;top:0;width:1920px;height:1080px;transform-origin:0 0;pointer-events:none;overflow:hidden;z-index:10';
  const ink = document.createElement('div');
  ink.style.cssText = 'position:absolute;inset:0;background:#050608;opacity:0';
  el.appendChild(ink);
  const holder = document.createElement('div');
  holder.innerHTML = svgText;
  const mark = holder.querySelector('svg')!;
  const [, , vw, vh] = mark.getAttribute('viewBox')!.split(/\s+/).map(Number) as [number, number, number, number];
  const w = vw * PX, h = vh * PX;
  mark.setAttribute('width', String(w));
  mark.setAttribute('height', String(h));
  mark.style.cssText = `position:absolute;left:${(1920 - w) / 2}px;top:${(1080 - h) / 2}px;overflow:visible`;
  ink.appendChild(mark);

  // Segments: word (H Λ I R P I N), marker, block, GP letters. The word and the GP letters get clip groups so
  // they rise / slide out of their own edge instead of fading across the frame.
  const ns = 'http://www.w3.org/2000/svg';
  const group = (cls: string): SVGGElement => {
    const g = document.createElementNS(ns, 'g');
    mark.querySelectorAll(cls).forEach((p) => g.appendChild(p));
    mark.appendChild(g);
    return g;
  };
  const block = mark.querySelector('.hp-b') as SVGPathElement;
  // Word clip: everything left of the GP block's slanted edge, so the name slides out from under the block.
  const bx = Number(block.getAttribute('d')!.match(/^M(-?[\d.]+)/)![1]);
  const slant = (y: number): number => bx - 1 + (110 - y) * Math.tan((12 * Math.PI) / 180);
  const defs = document.createElementNS(ns, 'defs');
  defs.innerHTML = `<clipPath id="trlWord"><polygon points="-20,-10 ${slant(-10)},-10 ${slant(vh + 10)},${vh + 10} -20,${vh + 10}"/></clipPath>`
    + `<clipPath id="trlGp"><path d="${block.getAttribute('d')}"/></clipPath>`;
  mark.prepend(defs);
  const word = group('.hp-w, .hp-l');
  const marker = group('.hp-m');
  const blk = group('.hp-b');
  const letters = group('.hp-g');
  const gpClip = document.createElementNS(ns, 'g');
  gpClip.setAttribute('clip-path', 'url(#trlGp)');
  gpClip.appendChild(letters);
  mark.appendChild(gpClip);
  const wordClip = document.createElementNS(ns, 'g');
  wordClip.setAttribute('clip-path', 'url(#trlWord)');
  wordClip.append(word, marker);
  mark.insertBefore(wordClip, blk);

  const tl = gsap.timeline({ paused: true, defaults: { ease: out } });
  const e0 = END_T;
  // Beats at 120 BPM: 26.0 hit = the vermilion block slams in; the name pours out from under its slanted edge;
  // 26.5 the GP letters rise inside the block; 27.0 the apex marker lands in the Λ (last accent).
  tl.fromTo(ink, { opacity: 0 }, { opacity: 1, duration: 0.45, ease: 'none' }, e0 - 0.2)
    .fromTo(blk, { x: 140 }, { x: 0, duration: 0.45 }, e0)
    .fromTo(blk, { opacity: 0 }, { opacity: 1, duration: 0.12, ease: 'none' }, e0)
    .fromTo(word, { x: bx + 10 }, { x: 0, duration: 0.8 }, e0 + 0.2)
    .fromTo(letters, { y: 100 }, { y: 0, duration: 0.5 }, e0 + 0.5)
    .fromTo(marker, { x: 24, opacity: 0 }, { x: 0, opacity: 1, duration: 0.3 }, e0 + 1.0)
    // Never a frozen frame: the lockup keeps a slow 2 % push to the last frame.
    .fromTo(mark, { scale: 1 }, { scale: 1.02, duration: DURATION - e0, ease: 'none', transformOrigin: '50% 50%' }, e0);
  tl.set({}, {}, DURATION);

  root.appendChild(el);
  const layout = (): void => {
    const k = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
    el.style.transform = `translate(${(window.innerWidth - 1920 * k) / 2}px,${(window.innerHeight - 1080 * k) / 2}px) scale(${k})`;
  };
  layout();
  return {
    seek(t) {
      // GSAP skips the redraw when asked for the same time twice: nudge, then land.
      tl.totalTime(t + 0.001, true);
      tl.totalTime(t, true);
    },
    layout,
    dispose() {
      tl.kill();
      el.remove();
    },
  };
}
