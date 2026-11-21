// Static source scanning for tests/arch: comment stripping, import parsing, layer classification (ARCHITECTURE §1.1).
// A regex-level parser on purpose (no TypeScript compiler API): fast, dependency-free and good enough for the §1.2 rules.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT, SRC, rel, walkFiles } from './paths';

// ---- comment stripping -----------------------------------------------------------------------------------------------------

const REGEX_PREV = new Set(['(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '<', '>', '~', '^']);

/**
 * Removes `//` and block comments while keeping string, template and regex literals intact.
 * Line structure is preserved (comments become spaces / empty text) so offsets map to the same line numbers.
 */
export function stripComments(src: string): string {
  let out = '';
  let i = 0;
  const n = src.length;
  let lastSig = ''; // last significant (non-space, non-comment) char, for regex-literal detection
  let lastWord = '';
  while (i < n) {
    const c = src[i]!;
    const d = src[i + 1];
    if (c === '/' && d === '/') {
      while (i < n && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && d === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) {
        if (src[i] === '\n') out += '\n';
        i++;
      }
      i += 2;
      out += ' ';
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && src[j] !== c && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1;
      out += src.slice(i, j + 1);
      i = j + 1;
      lastSig = c;
      lastWord = '';
      continue;
    }
    if (c === '`') {
      let j = i + 1;
      let depth = 0;
      while (j < n) {
        const ch = src[j]!;
        if (ch === '\\') { j += 2; continue; }
        if (ch === '$' && src[j + 1] === '{') { depth++; j += 2; continue; }
        if (ch === '}' && depth > 0) { depth--; j++; continue; }
        if (ch === '`' && depth === 0) break;
        j++;
      }
      out += src.slice(i, j + 1);
      i = j + 1;
      lastSig = '`';
      lastWord = '';
      continue;
    }
    if (c === '/' && (REGEX_PREV.has(lastSig) || lastSig === '' || lastWord === 'return' || lastWord === 'typeof')) {
      // regex literal
      let j = i + 1;
      let inClass = false;
      while (j < n && src[j] !== '\n') {
        const ch = src[j]!;
        if (ch === '\\') { j += 2; continue; }
        if (ch === '[') inClass = true;
        else if (ch === ']') inClass = false;
        else if (ch === '/' && !inClass) break;
        j++;
      }
      out += src.slice(i, j + 1);
      i = j + 1;
      lastSig = '/';
      lastWord = '';
      continue;
    }
    out += c;
    if (!/\s/.test(c)) {
      lastSig = c;
      if (/[A-Za-z_$]/.test(c)) lastWord = /[A-Za-z0-9_$]/.test(src[i - 1] ?? '') && lastWord ? lastWord + c : c;
      else if (/[0-9]/.test(c) && lastWord) lastWord += c;
      else lastWord = '';
    }
    i++;
  }
  return out;
}

// ---- imports ---------------------------------------------------------------------------------------------------------------

export interface ImportRef {
  /** The module specifier as written. */
  spec: string;
  kind: 'import' | 'export-from' | 'dynamic' | 'side-effect';
  /** true for `import type ...` / `export type ... from`. */
  typeOnly: boolean;
  /** true when every named specifier is inline `type X` (`import { type A, type B }`); still a runtime import under verbatimModuleSyntax. */
  inlineTypesOnly: boolean;
  /** The text of the statement (single line, collapsed). */
  text: string;
  line: number;
}

// Import/export clause forms: `X`, `* as X`, `{ a, b }`, `X, { a }`, `X, * as Y`, `*`.
const CLAUSE = String.raw`(?:\*(?:\s+as\s+[\w$]+)?|[\w$]+(?:\s*,\s*(?:\{[^}]*\}|\*\s+as\s+[\w$]+))?|\{[^}]*\})`;
const IMPORT_FROM = new RegExp(String.raw`(^|[\n;{}])\s*(import|export)\s+(type\s+)?(${CLAUSE})\s*from\s*(['"])([^'"\n]+)\5`, 'g');
const SIDE_EFFECT = /(^|[\n;{}])\s*import\s*(['"])([^'"\n]+)\2/g;
const DYNAMIC = /\bimport\s*\(\s*(['"`])([^'"`\n]+)\1\s*\)/g;

function lineOf(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

/** Parses static, re-export, side-effect and dynamic imports from comment-stripped source. */
export function parseImports(stripped: string): ImportRef[] {
  const out: ImportRef[] = [];
  for (const m of stripped.matchAll(IMPORT_FROM)) {
    const clause = m[4] ?? '';
    const named = /\{([^}]*)\}/.exec(clause);
    const names = named ? named[1]!.split(',').map((x) => x.trim()).filter(Boolean) : [];
    const defaultOrNs = clause.replace(/\{[^}]*\}/, '').replace(/,/g, '').trim();
    const inlineTypesOnly = !m[3] && names.length > 0 && names.every((x) => x.startsWith('type ')) && defaultOrNs === '';
    out.push({
      spec: m[6]!,
      kind: m[2] === 'export' ? 'export-from' : 'import',
      typeOnly: Boolean(m[3]),
      inlineTypesOnly,
      text: `${m[2]} ${m[3] ?? ''}${clause.replace(/\s+/g, ' ')} from '${m[6]}'`,
      line: lineOf(stripped, m.index + m[0].indexOf(m[2]!)),
    });
  }
  for (const m of stripped.matchAll(SIDE_EFFECT)) {
    out.push({ spec: m[3]!, kind: 'side-effect', typeOnly: false, inlineTypesOnly: false, text: `import '${m[3]}'`, line: lineOf(stripped, m.index + m[0].indexOf('import')) });
  }
  for (const m of stripped.matchAll(DYNAMIC)) {
    out.push({ spec: m[2]!, kind: 'dynamic', typeOnly: false, inlineTypesOnly: false, text: `import('${m[2]}')`, line: lineOf(stripped, m.index) });
  }
  return out.sort((a, b) => a.line - b.line);
}

// ---- source files ----------------------------------------------------------------------------------------------------------

export interface SourceFile {
  /** Project-relative path, forward slashes (`src/ai/index.ts`). */
  path: string;
  /** Path relative to `src/` (`ai/index.ts`). */
  srcPath: string;
  text: string;
  stripped: string;
  imports: ImportRef[];
}

let cache: SourceFile[] | null = null;

/** Every `.ts` file under `src/` (parsed once per test file). */
export function loadSourceFiles(): SourceFile[] {
  if (cache) return cache;
  cache = walkFiles(SRC, (f) => f.endsWith('.ts') && !f.endsWith('.d.ts')).map((abs) => {
    const text = readFileSync(abs, 'utf8');
    const stripped = stripComments(text);
    const p = rel(abs);
    return { path: p, srcPath: p.slice('src/'.length), text, stripped, imports: parseImports(stripped) };
  });
  return cache;
}

/** Resolves a relative specifier of `file` to a `src/`-relative path without extension ('' when not relative or outside src). */
export function resolveRelative(file: SourceFile, spec: string): string | null {
  if (!spec.startsWith('.')) return null;
  const abs = path.resolve(path.dirname(path.join(ROOT, file.path)), spec);
  const r = path.relative(SRC, abs).split(path.sep).join('/');
  if (r.startsWith('..')) return null;
  return r.replace(/\.(ts|js|mjs|json)$/, '');
}

// ---- layers (ARCHITECTURE §1.1) --------------------------------------------------------------------------------------------

export type Layer = 'contracts' | 'sim' | 'presentation' | 'glue' | 'neutral';

const SIM_TRACK = /^track\/(data|build|query|authoring|stub)(\/|$)/;
const PRES_TRACK = /^track\/(mesh|scenery|terrain|sky)(\/|$)/;

/** Test and sandbox files are not part of the shipped layers: they may import anything. */
export function isExemptFromLayers(srcPath: string): boolean {
  return /(^|\/)(sandbox|__tests__)(\/|$)/.test(srcPath) || /\.(test|spec)\.ts$/.test(srcPath);
}

/** Layer of a `src/`-relative path (extension optional). Façades (`<module>/index`) follow their module's layer unless listed in FACADE_NEUTRAL. */
export function layerOf(srcPath: string): Layer {
  const p = srcPath.replace(/\.ts$/, '');
  if (p.startsWith('contracts/')) return 'contracts';
  if (/^(physics|ai|race)(\/|$)/.test(p)) return 'sim';
  if (/^game\/sim(\/|$)/.test(p)) return 'sim';
  if (SIM_TRACK.test(p)) return 'sim';
  if (/^core\/math(\/|$)/.test(p) || p === 'core/rng') return 'sim';
  if (/^data(\/|$)/.test(p)) return 'sim';
  // CR-NET (multiplayer-tasks §A.1): the shared protocol + clock are pure so server/** can import them.
  if (p === 'net/protocol' || p === 'net/clock') return 'sim';
  if (/^(graphics|trailer|ui|audio)(\/|$)/.test(p)) return 'presentation';
  if (PRES_TRACK.test(p)) return 'presentation';
  if (p === 'main' || /^core(\/|$)/.test(p) || /^game(\/|$)/.test(p) || /^sandbox(\/|$)/.test(p)) return 'glue';
  return 'neutral';
}

/** Module (top-level folder) of a `src/`-relative path, or '' for files directly in `src/`. */
export function moduleOf(srcPath: string): string {
  const i = srcPath.indexOf('/');
  return i < 0 ? '' : srcPath.slice(0, i);
}

export const PRESENTATION_PACKAGES = ['three', 'postprocessing', 'n8ao', 'gsap', 'lil-gui'];

/** `three`, `three/examples/...`, `postprocessing`, ... */
export function packageOf(spec: string): string | null {
  if (spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('node:')) return null;
  if (spec.startsWith('@')) return spec.split('/').slice(0, 2).join('/');
  return spec.split('/')[0]!;
}
