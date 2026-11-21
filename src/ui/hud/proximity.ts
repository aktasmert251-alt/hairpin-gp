// D-051 #2 proximity indicators: left / right side markers for a car alongside or up to one car length behind, and a
// rear chevron for a car closing from directly behind (max 3 markers). Icon-only (no text); the fill is the team colour
// of the strongest car on that channel (a small functional mark, DESIGN §1 "team colour never fills a large area") on a
// dark rim; the rim turns alarm red (DESIGN §2.1 rule 7) only while the cars overlap / close fast. Placed beside and below the screen centre, never on it; hidden with the HUD off.
// Input is the HudModel minimap (world x/z of every car, AI and remote alike); the player heading is the direction of its
// own motion between HUD updates (the model carries no yaw). Per update: no allocation (arrays grow only when the
// car count changes). Strength drives opacity directly (no tweens on per-frame values); under reduced motion the side
// markers stay at a fixed height instead of following the other car along the side.

import type { HudModel } from '../../contracts/hud';
import { h } from '../dom';
import type { HudCtx, HudWidget } from './ctx';

/** Car length (m), centre to centre when nose touches tail. */
export const CAR_LEN = 5.6;
/** |lateral| below this (m) = directly behind / ahead; above = to the side. */
const LANE = 1.8;
const SIDE_MAX = 6;
const REAR_MAX = 30;

export interface Proximity {
  /** 0..1 strength per channel. */
  left: number; right: number; rear: number;
  /** Longitudinal offset (m, + ahead) of the strongest car on each side. */
  leftF: number; rightF: number;
  leftAlarm: boolean; rightAlarm: boolean; rearAlarm: boolean;
  /** Car index (minimap slot) of the strongest car per channel, −1 = none. */
  leftI: number; rightI: number; rearI: number;
}

export const emptyProximity = (): Proximity => ({ left: 0, right: 0, rear: 0, leftF: 0, rightF: 0, leftAlarm: false, rightAlarm: false, rearAlarm: false, leftI: -1, rightI: -1, rearI: -1 });

export function resetProximity(p: Proximity): void {
  p.left = p.right = p.rear = p.leftF = p.rightF = 0;
  p.leftAlarm = p.rightAlarm = p.rearAlarm = false;
  p.leftI = p.rightI = p.rearI = -1;
}

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/**
 * Folds one other car into `p` (keeps the strongest per channel). `f` = metres ahead of the player (centre to centre),
 * `l` = metres to the player's left, `closing` = m/s the gap shrinks (+ = approaching), `i` = the car's minimap slot.
 */
export function classifyCar(f: number, l: number, closing: number, p: Proximity, i = -1): void {
  const al = Math.abs(l);
  if (al >= LANE) {
    // Side: alongside (|f| < one length) at full strength, fading out over the next length behind.
    if (al > SIDE_MAX || f > CAR_LEN || f < -2 * CAR_LEN) return;
    const along = f >= -CAR_LEN ? 1 : (f + 2 * CAR_LEN) / CAR_LEN;
    const lat = al <= 3 ? 1 : (SIDE_MAX - al) / (SIDE_MAX - 3);
    const s = clamp01(along * lat);
    const alarm = Math.abs(f) < CAR_LEN && al < 3.2;
    if (l > 0) {
      if (s > p.left) {
        p.left = s;
        p.leftF = f;
        p.leftI = i;
      }
      p.leftAlarm ||= alarm;
    } else {
      if (s > p.right) {
        p.right = s;
        p.rightF = f;
        p.rightI = i;
      }
      p.rightAlarm ||= alarm;
    }
    return;
  }
  // Directly behind: only while closing, or when already close.
  if (f > -1 || f < -REAR_MAX) return;
  const d = -f;
  if (closing < 0.5 && d > 12) return;
  const s = clamp01((REAR_MAX - d) / (REAR_MAX - 6)) * clamp01(0.3 + Math.max(0, closing) / 8);
  if (s > p.rear) {
    p.rear = s;
    p.rearI = i;
  }
  p.rearAlarm ||= d < 9 && closing > 3;
}

export interface ProximityWidget extends HudWidget {
  update(m: HudModel, nowMs: number): void;
}

/** Player motion (m) below which the heading is not re-estimated (≈ 4.5 m/s at the 30 Hz HUD rate). */
const MIN_STEP = 0.15;
/** Below this speed (crash, spin, pit box) the motion heading is unreliable and side-by-side moot: hide. */
const MIN_KMH = 20;
/** A jump larger than this (m) between updates is a teleport / flashback: reset the history. */
const MAX_STEP = 40;

export function createProximity(parent: HTMLElement, ctx: HudCtx): ProximityWidget {
  const el = h('div', 'h-prox h-mode-hide', parent);
  el.setAttribute('aria-hidden', 'true');
  const left = h('div', 'h-prox-side l', el);
  const right = h('div', 'h-prox-side r', el);
  const rear = h('div', 'h-prox-rear', el);
  h('i', '', rear);
  h('i', '', rear);
  const p = emptyProximity();
  let prevD = new Float32Array(0);
  let hx = 0, hz = 0, has = false;
  let px = 0, pz = 0, pt = -1;
  // Last written values (DOM writes only on change).
  const last = [-1, -1, -1, NaN, NaN, -1, -1, -1];
  // Last written team colour per marker (left, right, rear); the string comes from the model, so no allocation.
  const lastC = ['', '', ''];
  let colors: readonly string[] = [];

  const hide = (): void => {
    resetProximity(p);
    write();
  };
  const setOp = (i: number, e: HTMLElement, v: number): void => {
    const q = Math.round(v * 20) / 20; // 5 % steps
    if (q === last[i]) return;
    last[i] = q;
    e.style.opacity = String(q);
  };
  const setY = (i: number, e: HTMLElement, f: number): void => {
    // + ahead → up; ±1 car length maps to ∓48 u, clamped.
    const y = ctx.reduced() ? 0 : Math.round(Math.max(-1.2, Math.min(2, -f / CAR_LEN)) * 48);
    if (y === last[i]) return;
    last[i] = y;
    e.style.transform = `translateY(calc(var(--u) * ${y}))`;
  };
  const setAlarm = (i: number, e: HTMLElement, a: boolean): void => {
    const v = a ? 1 : 0;
    if (v === last[i]) return;
    last[i] = v;
    e.dataset.alarm = a ? '1' : '0';
  };
  const setC = (i: number, e: HTMLElement, car: number): void => {
    if (car < 0) return; // keep the last colour while fading out
    const c = colors[car] ?? '';
    if (c === lastC[i]) return;
    lastC[i] = c;
    e.style.setProperty('--c', c);
  };
  const write = (): void => {
    setC(0, left, p.leftI);
    setC(1, right, p.rightI);
    setC(2, rear, p.rearI);
    setOp(0, left, p.left);
    setOp(1, right, p.right);
    setOp(2, rear, p.rear);
    if (p.left > 0) setY(3, left, p.leftF);
    if (p.right > 0) setY(4, right, p.rightF);
    setAlarm(5, left, p.leftAlarm);
    setAlarm(6, right, p.rightAlarm);
    setAlarm(7, rear, p.rearAlarm);
  };
  hide();

  return {
    update(m, nowMs) {
      const mm = m.minimap;
      colors = mm.teamColor;
      const n = mm.x.length;
      const me = mm.player;
      if (prevD.length !== n) {
        prevD = new Float32Array(n);
        pt = -1;
      }
      const x0 = mm.x[me] ?? 0, z0 = mm.z[me] ?? 0;
      const dt = pt < 0 ? 0 : (nowMs - pt) / 1000;
      const step = Math.hypot(x0 - px, z0 - pz);
      const fresh = pt < 0 || step > MAX_STEP || dt <= 0 || dt > 0.5;
      if (!fresh && step > MIN_STEP) {
        // Light smoothing of the motion direction (sim jitter, kerbs).
        hx = has ? hx * 0.5 + ((x0 - px) / step) * 0.5 : (x0 - px) / step;
        hz = has ? hz * 0.5 + ((z0 - pz) / step) * 0.5 : (z0 - pz) / step;
        const len = Math.hypot(hx, hz) || 1;
        hx /= len;
        hz /= len;
        has = true;
      }
      if (step > MAX_STEP) has = false;
      px = x0;
      pz = z0;
      pt = nowMs;
      resetProximity(p);
      if (has && m.visible !== 'off' && !m.startLights.visible && m.car.kmh >= MIN_KMH) {
        const myPit = mm.inPit[me];
        for (let i = 0; i < n; i++) {
          if (i === me) continue;
          const rx = mm.x[i]! - x0, rz = mm.z[i]! - z0;
          const d = Math.hypot(rx, rz);
          const closing = fresh ? 0 : (prevD[i]! - d) / dt;
          prevD[i] = d;
          if (d > REAR_MAX + 2 || mm.inPit[i] !== myPit) continue;
          // Left = up × forward = (hz, −hx) in world x/z (three.js, y up).
          classifyCar(rx * hx + rz * hz, rx * hz - rz * hx, closing, p, i);
        }
      } else {
        for (let i = 0; i < n; i++) prevD[i] = Math.hypot(mm.x[i]! - x0, mm.z[i]! - z0);
      }
      write();
    },
    relabel() {},
    dispose() {
      el.remove();
    },
  };
}
