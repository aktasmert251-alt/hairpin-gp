// The Tab MFD is a compact panel docked bottom-right above the status chips and the wheel (not a centred overlay).
// Geometry check in HUD units (--u = k px, k = kView x hud.scale): no overlap with the wheel, the status row or the
// timing panel at hud.scale 0.8-1.25 for 1280x720 up to 4K (kView = height / 1080 on 16:9).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(path.resolve(__dirname, '../styles/hud.css'), 'utf8');
const rule = (sel: string): string => {
  const m = new RegExp(`(^|\\n)${sel.replace('.', '\\.')} \\{([^}]*)\\}`).exec(css);
  if (!m) throw new Error(`no rule ${sel}`);
  return m[2]!;
};
const num = (body: string, re: RegExp): number => Number(re.exec(body)?.[1] ?? NaN);

describe('MFD layout (compact, docked above the wheel)', () => {
  const mfd = rule('.h-mfd');
  it('is docked right/bottom, as wide as the wheel, never centred', () => {
    expect(mfd).toContain('right: var(--sx)');
    expect(mfd).not.toMatch(/left: 50%/);
    expect(num(mfd, /width: calc\(var\(--u\) \* (\d+)\)/)).toBe(num(rule('.h-wheel'), /width: calc\(var\(--u\) \* (\d+)\)/));
  });
  it('clears the wheel + status row and the timing panel at every scale and viewport', () => {
    const bottomU = num(mfd, /bottom: calc\(var\(--sy\) \+ var\(--u\) \* (\d+)\)/);
    const wheelH = num(rule('.h-wheel'), /height: calc\(var\(--u\) \* (\d+)\)/);
    const stat = rule('.h-stat');
    const statTop = num(stat, /bottom: calc\(var\(--sy\) \+ var\(--u\) \* (\d+)\)/) + num(stat, /height: calc\(var\(--u\) \* (\d+)\)/);
    expect(bottomU).toBeGreaterThan(wheelH);
    expect(bottomU).toBeGreaterThanOrEqual(statTop);
    // Panel height in u: head + 4 rows + footer (padding, two 12u lines at 1.15, 4u gap) + bottom padding.
    const head = num(rule('.mfd-head'), /height: calc\(var\(--u\) \* (\d+)\)/);
    const row = num(rule('.mfd-row'), /height: calc\(var\(--u\) \* (\d+)\)/);
    const heightU = head + 4 * row + (8 + 2 * 12 * 1.15 + 4) + 10;
    const timingBottomU = 211; // .h-timing measured height in u (40 px inset above it)
    for (const height of [720, 1080, 1440, 2160]) {
      const kv = height / 1080;
      for (const scale of [0.8, 1, 1.25]) {
        const k = kv * scale;
        const sy = 40 * kv;
        // 12 px minimum fonts can make the footer taller than its u size at small k: allow it.
        const foot = Math.max(0, 2 * 12 * 1.15 - 2 * 12 * 1.15 * k);
        const top = height - sy - (bottomU + heightU) * k - foot;
        expect(top, `${height}p scale ${scale}`).toBeGreaterThan(sy + timingBottomU * k);
      }
    }
  });
});
