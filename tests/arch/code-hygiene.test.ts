// S-AR-07: static code-hygiene rules that QC otherwise checks by hand (testing-qc.md §5.1 C8 and C10; ARCHITECTURE §11).
//   * keyboard handling uses `KeyboardEvent.code`, never `.key`, `.keyCode`, `.which` or `.charCode` (C8);
//   * no `@ts-ignore` / `@ts-nocheck`; `@ts-expect-error` only in tests (C10);
//   * no `any` in type positions in shipped code (C10);
//   * sim code never throws or logs errors inside hot paths is NOT checked here (needs review); see the heap/determinism tests.
// Test and sandbox-GUI helpers are scanned for the first two rules only where noted.

import { describe, expect, it } from 'vitest';
import { loadSourceFiles, type SourceFile } from '../helpers/srcScan';

const files = loadSourceFiles();
const isTest = (f: SourceFile): boolean => /(^|\/)__tests__\//.test(f.srcPath) || /\.test\.ts$/.test(f.srcPath);

function scanLines(list: SourceFile[], re: RegExp, source: 'stripped' | 'text' = 'stripped'): string[] {
  const out: string[] = [];
  for (const f of list) {
    f[source].split('\n').forEach((line, i) => {
      if (re.test(line)) out.push(`${f.path}:${i + 1}  ${line.trim().slice(0, 110)}`);
    });
  }
  return out;
}

describe('S-AR-07 code hygiene', () => {
  it('keyboard handling uses KeyboardEvent.code (no .key / .keyCode / .which / .charCode)', () => {
    const shipped = files.filter((f) => !isTest(f));
    const v = scanLines(shipped, /\b(?:e|ev|evt|event|ke)\s*\.\s*(?:key|keyCode|which|charCode)\b(?!\s*\()|\.\s*(?:keyCode|charCode)\b/);
    expect(v, `use event.code (TEAM-RULES §7):\n  ${v.join('\n  ')}`).toEqual([]);
  });

  it('no @ts-ignore or @ts-nocheck anywhere; @ts-expect-error only in tests', () => {
    const v = [
      ...scanLines(files, /@ts-(?:ignore|nocheck)\b/, 'text'),
      ...scanLines(files.filter((f) => !isTest(f)), /@ts-expect-error\b/, 'text'),
    ];
    expect(v, `ARCHITECTURE §11:\n  ${v.join('\n  ')}`).toEqual([]);
  });

  it('no `any` in type positions in shipped code (use unknown and narrow)', () => {
    const shipped = files.filter((f) => !isTest(f));
    const v = scanLines(shipped, /:\s*any\b(?!\w)|\bas\s+any\b|<any>|<any,|,\s*any>|\bany\[\]|\bArray<any>|\bRecord<[^>]*,\s*any>|=>\s*any\b/);
    expect(v, `ARCHITECTURE §11 forbids any:\n  ${v.join('\n  ')}`).toEqual([]);
  });
});
