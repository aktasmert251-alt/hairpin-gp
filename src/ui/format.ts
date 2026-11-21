// HUD and menu number formatting (DESIGN.md §3.4, ui-hud §1). Pure functions; the presenter passes raw ms.
// Timing values use a full stop in both languages (broadcast convention); other decimals follow the locale.
// Negative numbers use U+2212 so "+0.214" and "−0.214" share one advance (D-007). Words (TUR/LAP, SN/SEC,
// KM/SA) come from i18n; helpers that need them take a `t` function so they stay testable in Node.

import type { Lang } from '../contracts/common';

export type TFn = (key: string, params?: Record<string, string | number>) => string;

/** U+2212 MINUS SIGN. */
export const MINUS = '−';
/** Empty lap time (no lap yet). */
export const EMPTY_LAP = '—:——.———';
/** Empty single value (sector not run). */
export const EMPTY = '—';

function pad(n: number, w: number): string {
  let s = String(n);
  while (s.length < w) s = '0' + s;
  return s;
}

function valid(ms: number): boolean {
  return Number.isFinite(ms) && ms > 0;
}

/** `m:ss.mmm` (`1:25.612`, `0:58.204`). Invalid or ≤ 0 → `—:——.———`. */
export function lapTime(ms: number): string {
  if (!valid(ms)) return EMPTY_LAP;
  const t = Math.round(ms);
  const m = Math.floor(t / 60_000);
  const s = Math.floor((t % 60_000) / 1000);
  return `${m}:${pad(s, 2)}.${pad(t % 1000, 3)}`;
}

/** Race total: `h:mm:ss.mmm` from one hour (`1:02:14.512`), else `m:ss.mmm`. */
export function raceTime(ms: number): string {
  if (!valid(ms)) return EMPTY_LAP;
  const t = Math.round(ms);
  if (t < 3_600_000) return lapTime(t);
  const hh = Math.floor(t / 3_600_000);
  const rest = t % 3_600_000;
  return `${hh}:${pad(Math.floor(rest / 60_000), 2)}:${pad(Math.floor((rest % 60_000) / 1000), 2)}.${pad(t % 1000, 3)}`;
}

/** Sector `ss.mmm`, or `m:ss.mmm` at ≥ 60 s. Invalid → `—`. */
export function sectorTime(ms: number): string {
  if (!valid(ms)) return EMPTY;
  const t = Math.round(ms);
  if (t >= 60_000) return lapTime(t);
  return `${Math.floor(t / 1000)}.${pad(t % 1000, 3)}`;
}

/** Unsigned duration `s.mmm` / `m:ss.mmm` (0 allowed). */
function duration(ms: number): string {
  const t = Math.round(Math.abs(ms));
  if (t >= 60_000) return lapTime(t);
  return `${Math.floor(t / 1000)}.${pad(t % 1000, 3)}`;
}

/** Gap `+s.mmm`; `+m:ss.mmm` at ≥ 60 s. */
export function gap(ms: number): string {
  if (!Number.isFinite(ms)) return EMPTY;
  return `+${duration(ms)}`;
}

/** Signed delta, 3 decimals, U+2212 for negative (faster). Zero is `+0.000`. */
export function delta(ms: number): string {
  if (!Number.isFinite(ms)) return EMPTY;
  const r = Math.round(ms);
  return `${r < 0 ? MINUS : '+'}${duration(r)}`;
}

/** Signed seconds with one decimal (flashback offset `−4.6`). Timing value: full stop in both languages. */
export function signedSec(sec: number): string {
  const r = Math.round(sec * 10) / 10;
  const abs = Math.abs(r).toFixed(1);
  if (r === 0) return '0.0';
  return `${r < 0 ? MINUS : '+'}${abs}`;
}

/** Locale decimal: TR `57,5`, EN `57.5`. Negative values use U+2212. */
export function decimal(x: number, digits: number, lang: Lang): string {
  if (!Number.isFinite(x)) return EMPTY;
  const s = Math.abs(x).toFixed(digits);
  const signed = x < 0 && Number(s) !== 0 ? MINUS + s : s;
  return lang === 'tr' ? signed.replace('.', ',') : signed;
}

/** Percent: TR `%57,5` (sign first), EN `57.5%`. `x` is already in percent units. */
export function pct(x: number, digits: number, lang: Lang): string {
  const v = decimal(x, digits, lang);
  return lang === 'tr' ? `%${v}` : `${v}%`;
}

/** Fraction 0..1 as a whole percent (`%62` / `62%`). */
export function pctOf(f: number, lang: Lang): string {
  return pct(Math.round(Math.max(0, Math.min(1, f)) * 100), 0, lang);
}

/** Track length in km, 3 decimals in the locale (`5,349` / `5.349`). */
export function km(m: number, lang: Lang): string {
  return decimal(m / 1000, 3, lang);
}

/** Temperature `24°C` (unit) or `98°` (compact). Rounded; minus is U+2212. */
export function temp(c: number, unit = true): string {
  if (!Number.isFinite(c)) return EMPTY;
  const r = Math.round(c);
  return `${r < 0 ? MINUS : ''}${Math.abs(r)}°${unit ? 'C' : ''}`;
}

/** Integer speed in the chosen units. */
export function speed(kmh: number, units: 'kmh' | 'mph'): string {
  const v = units === 'mph' ? kmh * 0.621371 : kmh;
  return String(Math.max(0, Math.round(Number.isFinite(v) ? v : 0)));
}

/** Gear digit: `N` for 0, `R` for −1. */
export function gear(g: number): string {
  if (g === 0) return 'N';
  if (g < 0) return 'R';
  return String(g);
}

/** `+1 TUR` / `+1 LAP` (upper-cased by CSS under the page lang). */
export function lapsDown(n: number, t: TFn): string {
  return t('hud.tower.lapsDown', { n });
}

/** Penalty chip `+5 SN` / `+5 SEC`. */
export function penalty(sec: number, t: TFn): string {
  return t('hud.penaltySec', { s: Math.round(sec) });
}

/** Locale upper-casing (tr: i → İ, ı → I). Never use bare toUpperCase() on user-facing strings. */
export function upper(s: string, lang: Lang): string {
  return s.toLocaleUpperCase(lang === 'tr' ? 'tr-TR' : 'en-US');
}

/** `lang` for a driver name from its nationality (D-008): TR → tr, everyone else → en. */
export function langForNat(nat: string): Lang {
  return nat.toUpperCase() === 'TR' ? 'tr' : 'en';
}

/**
 * Notification params arrive raw; the UI formats the timing ones: `time`/`best`/`lapMs` → lap time,
 * `delta` → signed delta, `gap` → gap. Strings pass through unchanged.
 */
export function formatParams(p: Record<string, string | number> | undefined, lang: Lang): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  if (!p) return out;
  for (const k of Object.keys(p)) {
    const v = p[k]!;
    if (typeof v !== 'number') {
      out[k] = v;
      continue;
    }
    if (k === 'time' || k === 'best' || k === 'lapMs') out[k] = lapTime(v);
    else if (k === 'delta') out[k] = delta(v);
    else if (k === 'gap') out[k] = gap(v);
    else if (k === 'p' || k === 'pct') out[k] = decimal(v, 0, lang);
    else out[k] = Number.isInteger(v) ? String(v) : decimal(v, 1, lang);
  }
  return out;
}
