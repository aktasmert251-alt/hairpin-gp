import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT, rel, walkFiles } from '../helpers/paths';

// Character classes keep literal names out of code; separators cover common spelling variants.
const patterns = [
  '[m]onza', '[a]utodromo[\\s_-]+nazionale', '[p]arabolica', '[l]esmo', '[a]scari', '[r]ettifilo',
  '[s]pa[\\s_-]+francorchamps', '[f]rancorchamps', '[e]au[\\s_-]+rouge', '[r]aidillon',
  '[s]ilverstone', '[m]aggotts', '[b]ecketts', '[c]opse', '[s]towe', '[iİı]stanbul[\\s_-]+park',
  '[f]ormula[\\s_-]*(?:1|one)',
];
// Only the short championship token needs whole-word boundaries (Ek A).
const banned = new RegExp(`(?:${patterns.join('|')}|(?<![\\p{L}\\p{N}_])[f]1(?![\\p{L}\\p{N}_]))`, 'iu');
const textFile = /\.(ts|tsx|js|mjs|cjs|json|md|html|css|txt|svg|glsl|frag|vert|wgsl|webmanifest|csv|xml|yml|yaml)$/i;

describe('circuit and corner IP names (tracks.md Ek A)', () => {
  it('matches every forbidden phrase case-insensitively with separator variants', () => {
    for (const pattern of patterns) {
      const literal = pattern.replace(/\[([a-z])[İı]*\]/g, '$1').replace(/\[\\s_-\]\+/g, '-').replace('[\\s_-]*', ' ').replace('(?:1|one)', 'one');
      expect(banned.test(literal.toUpperCase()), pattern).toBe(true);
      expect(banned.test(`prefix${literal}Suffix`), pattern).toBe(true);
    }
    expect(banned.test(['f', '1'].join(''))).toBe(true);
    expect(banned.test('f1234')).toBe(false);
    expect(banned.test('Lombardy Park Circuit')).toBe(false);
    expect(banned.test(`${String.fromCharCode(0x130)}STANBUL-PARK`)).toBe(true);
  });
  it('keeps shipped source and public text free of real circuit and corner names', () => {
    const hits: string[] = [];
    for (const dir of ['src', 'public']) {
      for (const file of walkFiles(path.join(ROOT, dir), (f) => textFile.test(f))) {
        readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
          if (banned.test(line)) hits.push(`${rel(file)}:${i + 1}: ${line.trim().slice(0, 140)}`);
        });
      }
    }
    expect(hits, hits.join('\n')).toEqual([]);
  });
});
