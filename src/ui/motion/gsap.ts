// GSAP registration (sprint-2 §0.7): plugins are registered once here, and the single APEX ease family of
// DESIGN §7.2 is created with CustomEase. Reduced motion (§7.5) = `ui.animations === 'off'`, or `'auto'` while
// `(prefers-reduced-motion: reduce)` matches; the media side is watched with gsap.matchMedia().

import { gsap } from 'gsap';
import { CustomEase } from 'gsap/CustomEase';

let registered = false;

// The Flip plugin is not used: its per-element matrix measurement cost 14–27 ms for a 20-row tower re-order
// (gate ≤ 2 ms), so the tower does its y-only FLIP by hand with plain tweens (DESIGN §7.4).
export function registerGsap(): void {
  if (registered) return;
  registered = true;
  gsap.registerPlugin(CustomEase);
  CustomEase.create('apex.out', '0.22,1,0.36,1');
  CustomEase.create('apex.inOut', '0.65,0,0.35,1');
  CustomEase.create('apex.in', '0.64,0,0.78,0');
  CustomEase.create(
    'apex.settle',
    'M0,0 L0.042,0.040 L0.083,0.137 L0.125,0.262 L0.167,0.394 L0.208,0.521 L0.250,0.636 L0.292,0.734 L0.333,0.814 L0.375,0.878 L0.417,0.926 L0.458,0.962 L0.500,0.987 L0.542,1.003 L0.583,1.013 L0.625,1.018 L0.667,1.020 L0.708,1.019 L0.750,1.018 L0.792,1.015 L0.833,1.013 L0.875,1.010 L0.917,1.008 L0.958,1.006 L1,1',
  );
  // Tweens never leave will-change behind; transforms are forced to 3D only while they run.
  gsap.config({ force3D: 'auto' });
}

export { gsap };

/** Durations in seconds (DESIGN §7.2). */
export const DUR = { fast: 0.14, base: 0.18, slow: 0.22, reduced: 0.12 } as const;

export interface MotionPrefs {
  /** Effective reduced motion right now. */
  reduced(): boolean;
  /** Re-evaluates with a new `ui.animations` value. */
  setMode(mode: 'auto' | 'on' | 'off'): void;
  onChange(cb: (reduced: boolean) => void): () => void;
  dispose(): void;
}

export function createMotionPrefs(initial: 'auto' | 'on' | 'off'): MotionPrefs {
  registerGsap();
  let mode = initial;
  let mediaReduced = false;
  const subs = new Set<(r: boolean) => void>();
  let last: boolean | null = null;
  const eff = (): boolean => mode === 'off' || (mode === 'auto' && mediaReduced);
  const emit = (): void => {
    const r = eff();
    if (r === last) return;
    last = r;
    for (const cb of subs) cb(r);
  };
  const mm = gsap.matchMedia();
  mm.add({ reduce: '(prefers-reduced-motion: reduce)', full: '(prefers-reduced-motion: no-preference)' }, (ctx) => {
    mediaReduced = Boolean(ctx.conditions?.reduce);
    emit();
  });
  last = eff();
  return {
    reduced: eff,
    setMode(m) {
      mode = m;
      emit();
    },
    onChange(cb) {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    dispose() {
      subs.clear();
      mm.revert();
    },
  };
}
