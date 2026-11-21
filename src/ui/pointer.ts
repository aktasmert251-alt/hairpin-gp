// Pure pointer helpers for the menu controls (no DOM access, unit-tested in Node): which part of a control was
// hit, the stepper index after a step, and the slider value under a pointer x.

/** Index of the first part that contains `target` (Node.contains semantics), or -1. */
export function partOf(target: Node, parts: readonly Node[]): number {
  for (let i = 0; i < parts.length; i++) if (parts[i]!.contains(target)) return i;
  return -1;
}

/** Stepper index after a ±1 step over `n` options: ordered scales clamp (null at the ends), sets wrap. */
export function stepIndex(i: number, d: 1 | -1, n: number, ordered: boolean): number | null {
  if (n <= 0) return null;
  const j = i + d;
  if (ordered) return j < 0 || j >= n ? null : j;
  return (j + n) % n;
}

/** Slider value at client x over a track spanning [left, left + width], snapped to `step` from `min` and clamped. */
export function sliderValueAt(x: number, left: number, width: number, min: number, max: number, step: number): number {
  const f = width > 0 ? Math.max(0, Math.min(1, (x - left) / width)) : 0;
  const raw = min + f * (max - min);
  const snapped = step > 0 ? min + Math.round((raw - min) / step) * step : raw;
  return Math.max(min, Math.min(max, Number(snapped.toFixed(4))));
}
