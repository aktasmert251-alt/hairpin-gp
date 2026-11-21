// S-AR-04: IP words (TEAM-RULES §9, testing-qc.md §2.2, sprint-1 QC gate row 13).
//   * no "F1", "Formula 1" or "Formula1" (case-insensitive, word boundary) in src/, public/ and index.html;
//   * no real team or driver names (denylist below, whole words, case-insensitive).
// Only text files are scanned (fonts, images and other binaries are skipped).

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT, rel, walkFiles } from '../helpers/paths';

const TEXT_EXT = /\.(ts|tsx|js|mjs|cjs|json|md|html|css|txt|svg|glsl|frag|vert|wgsl|webmanifest|csv|xml|yml|yaml)$/i;

function textFiles(): string[] {
  const files = [...walkFiles(path.join(ROOT, 'src'), (f) => TEXT_EXT.test(f)), ...walkFiles(path.join(ROOT, 'public'), (f) => TEXT_EXT.test(f))];
  files.push(path.join(ROOT, 'index.html').split(path.sep).join('/'));
  return files;
}

const MAX_BYTES = 8 * 1024 * 1024;

interface Hit { file: string; line: number; word: string; text: string }

function scan(re: RegExp): Hit[] {
  const hits: Hit[] = [];
  for (const abs of textFiles()) {
    let text: string;
    try {
      text = readFileSync(abs, 'utf8');
    } catch {
      continue;
    }
    if (text.length > MAX_BYTES) continue;
    // Quick reject before splitting into lines.
    if (!re.test(text)) continue;
    text.split('\n').forEach((line, i) => {
      const m = re.exec(line);
      if (m) hits.push({ file: rel(abs), line: i + 1, word: m[0], text: line.trim().slice(0, 100) });
    });
  }
  return hits;
}

function format(hits: Hit[]): string {
  return hits.map((h) => `${h.file}:${h.line}  "${h.word}"  ${h.text}`).join('\n');
}

describe('S-AR-04 IP words', () => {
  it('scans a plausible number of files', () => {
    expect(textFiles().length).toBeGreaterThan(50);
  });

  it('no "F1", "Formula 1" or "Formula1" in src/, public/ or index.html', () => {
    const hits = scan(/\bF1\b|\bFormula[\s_-]*1\b|\bFormula1\b/i);
    expect(hits, format(hits)).toEqual([]);
  });

  it('no real team or driver names', () => {
    const teams = ['Ferrari', 'McLaren', 'Red Bull', 'Mercedes', 'Aston Martin', 'Haas', 'Sauber', 'Alfa Romeo', 'AlphaTauri', 'Alpha Tauri', 'Toro Rosso', 'Racing Bulls', 'Scuderia'];
    const drivers = [
      'Verstappen', 'Hamilton', 'Leclerc', 'Norris', 'Piastri', 'Sainz', 'Alonso', 'Gasly', 'Ocon', 'Albon', 'Tsunoda', 'Hulkenberg', 'Magnussen', 'Bottas',
      'Ricciardo', 'Antonelli', 'Hadjar', 'Bortoleto', 'Colapinto', 'Doohan', 'Schumacher', 'Vettel', 'Raikkonen', 'Lauda', 'Senna',
    ];
    const re = new RegExp(`\\b(${[...teams, ...drivers].map((n) => n.replace(/\s+/g, '\\s+')).join('|')})\\b`, 'i');
    const hits = scan(re);
    expect(hits, `real names are not allowed (TEAM-RULES §9):\n${format(hits)}`).toEqual([]);
  });
});
