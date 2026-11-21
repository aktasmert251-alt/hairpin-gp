// Gamepad glyphs (2026-10-27): simple drawn badges for standard-mapping buttons. Face buttons are round letter badges
// (A / B / X / Y), shoulders and triggers rounded rectangles (LB / RB / LT / RT), the D-pad an arrow in a square.
// No logos. The fonts have no arrow glyphs (D-007), so D-pad directions use the SVG arrow icons.

import { h, icon } from './dom';

const TEXT: readonly string[] = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'View', 'Start', 'LS', 'RS', '', '', '', '', 'Guide'];
const DPAD: Readonly<Record<number, string>> = { 12: 'arrow-up', 13: 'arrow-down', 14: 'arrow-left', 15: 'arrow-right' };

/** Writes button `b` into an existing chip element (keeps its other classes). */
export function setPadChip(c: HTMLElement, b: number): void {
  c.classList.add('apx-pad');
  c.dataset.pad = String(b);
  const ic = DPAD[b];
  if (ic) c.replaceChildren(icon(ic));
  else c.textContent = TEXT[b] ?? `B${b}`;
}

/** New key-chip styled badge for pad button `b`. */
export function padChip(parent: HTMLElement, b: number): HTMLElement {
  const c = h('span', 'apx-kc', parent);
  setPadChip(c, b);
  return c;
}

/** Plain-text name of button `b` (warnings); D-pad directions as words are not needed there, so they fall back to the index. */
export function padText(b: number): string {
  return TEXT[b] || `D${b - 11}`;
}
