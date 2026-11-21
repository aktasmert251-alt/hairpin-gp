import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT, rel, walkFiles } from '../helpers/paths';

// D-047: retain debug hooks, storage keys and asset/code identifiers, never the retired display name.
const INTERNAL = /\b(?:__APEX(?:_[A-Z]+)*__|apexgp:v1:[\w:$}{.-]+|ApexLivery(?:Cond|Text))\b/g;
function retiredBrand(source: string): boolean {
  const visible = source.replace(INTERNAL, '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/['"`]\s*\+\s*['"`]/g, ' ')
    .replace(/&(?:nbsp|#160|#x0*a0);/gi, ' ');
  return /\bAPEX\s+GP\b/i.test(visible)
    // The previous geometric initial plus live-text suffix also spelled the retired wordmark.
    || /<text\b[^>]*>\s*PEX\s*<\/text>/i.test(source);
}

describe('D-047 player-visible brand', () => {
  it('recognises plain, mixed-case and split markup/string wordmarks', () => {
    for (const source of ['APEX GP', 'apex gp', '<b>APEX</b><i>GP</i>', "'APEX' + ' GP'", 'APEX&nbsp;GP', '<text class="wm-p">PEX</text>']) {
      expect(retiredBrand(source), source).toBe(true);
    }
    for (const source of ['HAIRPIN GP', '__APEX__', '__APEX_BUILD__', 'apexgp:v1:settings', 'ApexLiveryCond', 'corner.apexS']) {
      expect(retiredBrand(source), source).toBe(false);
    }
  });

  it('does not ship the retired brand in player-facing sources', () => {
    const dirs = ['src/ui', 'src/core/i18n', 'src/track', 'src/graphics', 'src/trailer', 'public'];
    const files = dirs.flatMap((dir) => walkFiles(path.join(ROOT, dir), (f) =>
      /\.(ts|tsx|js|css|html|json|webmanifest|svg|md|txt)$/.test(f) && !f.includes('/__tests__/')));
    files.push(...['index.html', 'README.md', 'CREDITS.md', 'start.bat', 'package.json', 'src/sandbox/router.ts', 'server/src/admin/panel/index.html'].map((f) => path.join(ROOT, f)));
    expect(files.length).toBeGreaterThan(100);
    const hits = files.filter((f) => retiredBrand(readFileSync(f, 'utf8'))).map(rel);
    expect(hits, `Retired display name remains in:\n${hits.join('\n')}`).toEqual([]);
  });
});
