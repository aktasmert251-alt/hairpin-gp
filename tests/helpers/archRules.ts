// The rules of docs/ARCHITECTURE.md §1.2 as pure functions over parsed source files, so tests/arch can run them on the real tree
// and tests/helpers/__tests__/archRules.test.ts can prove that each rule really detects a synthetic violation.

import {
  PRESENTATION_PACKAGES, isExemptFromLayers, layerOf, moduleOf, packageOf, parseImports, resolveRelative, stripComments, type SourceFile,
} from './srcScan';

/** Builds an in-memory SourceFile (used by the rule self-tests). */
export function virtualFile(srcPath: string, text: string): SourceFile {
  const stripped = stripComments(text);
  return { path: `src/${srcPath}`, srcPath, text, stripped, imports: parseImports(stripped) };
}

/** `srcPath -> reason`; known, documented exceptions of rule 1 and 2 (see tests/arch/architecture.test.ts). */
export type LayerExceptions = ReadonlyMap<string, string>;

export function simFilesOf(files: readonly SourceFile[], exceptions: LayerExceptions = new Map()): SourceFile[] {
  return files.filter((f) => !isExemptFromLayers(f.srcPath) && layerOf(f.srcPath) === 'sim' && !exceptions.has(f.srcPath));
}

/** Rule 1: a sim file imports a presentation package or a presentation/glue folder. */
export function ruleSimImports(files: readonly SourceFile[], exceptions?: LayerExceptions): string[] {
  const v: string[] = [];
  for (const f of simFilesOf(files, exceptions)) {
    for (const imp of f.imports) {
      const pkg = packageOf(imp.spec);
      if (pkg && PRESENTATION_PACKAGES.includes(pkg)) {
        v.push(`${f.path}:${imp.line}  sim file imports package "${imp.spec}"`);
        continue;
      }
      const target = resolveRelative(f, imp.spec);
      if (target === null) continue;
      const layer = layerOf(target);
      if (layer === 'presentation' || layer === 'glue') v.push(`${f.path}:${imp.line}  sim file imports ${layer} module "${imp.spec}"`);
    }
  }
  return v;
}

const SIM_TOKENS: [string, RegExp][] = [
  ['Math.random', /\bMath\s*\.\s*random\b/],
  ['Date.now', /\bDate\s*\.\s*now\b/],
  ['performance.now', /\bperformance\s*\.\s*now\b/],
  ['window.', /\bwindow\s*\./],
  ['document.', /\bdocument\s*\./],
  ['localStorage', /\blocalStorage\b/],
  ['requestAnimationFrame', /\brequestAnimationFrame\b/],
];

/** Rule 2: forbidden tokens in sim files (comments are ignored). */
export function ruleSimTokens(files: readonly SourceFile[], exceptions?: LayerExceptions): string[] {
  const v: string[] = [];
  for (const f of simFilesOf(files, exceptions)) {
    f.stripped.split('\n').forEach((line, i) => {
      for (const [name, re] of SIM_TOKENS) if (re.test(line)) v.push(`${f.path}:${i + 1}  forbidden token "${name}"  ${line.trim().slice(0, 100)}`);
    });
  }
  return v;
}

/** Rule 3: gsap only in src/ui and src/trailer; lil-gui only under sandbox folders. */
export function rulePackageHomes(files: readonly SourceFile[]): string[] {
  const v: string[] = [];
  for (const f of files) {
    for (const imp of f.imports) {
      const pkg = packageOf(imp.spec);
      if (pkg === 'gsap' && !/^(ui|trailer)\//.test(f.srcPath)) v.push(`${f.path}:${imp.line}  gsap outside src/ui and src/trailer`);
      if (pkg === 'lil-gui' && !/(^|\/)sandbox\//.test(f.srcPath)) v.push(`${f.path}:${imp.line}  lil-gui outside a sandbox folder`);
    }
  }
  return v;
}

/** Rule 4: any import of src/contracts that is not `import type`, except frames.ts, sim.ts, replay.ts (D-025) and net.ts (CR-NET-9). */
export function ruleContractImports(files: readonly SourceFile[]): string[] {
  const v: string[] = [];
  for (const f of files) {
    if (f.srcPath.startsWith('contracts/')) continue;
    for (const imp of f.imports) {
      const target = resolveRelative(f, imp.spec);
      if (target === null || !(target === 'contracts' || target.startsWith('contracts/'))) continue;
      const base = target.slice('contracts/'.length);
      if (base === 'frames' || base === 'sim' || base === 'replay' || base === 'net') continue; // D-025 replay / CR-NET-9 protocol constants
      if (imp.typeOnly) continue;
      const hint = imp.inlineTypesOnly ? ' (inline `type` specifiers still emit a runtime import under verbatimModuleSyntax: use `import type { ... }`)' : '';
      v.push(`${f.path}:${imp.line}  runtime import of contract "${imp.spec}"${hint}`);
    }
  }
  return v;
}

/** Names of every `export interface X` in src/contracts, with the file that declares them. */
export function contractInterfaceNames(files: readonly SourceFile[]): Map<string, string> {
  const names = new Map<string, string>();
  for (const f of files) {
    if (!f.srcPath.startsWith('contracts/')) continue;
    for (const m of f.stripped.matchAll(/\bexport\s+interface\s+([A-Za-z_$][\w$]*)/g)) names.set(m[1]!, f.srcPath);
  }
  return names;
}

/** Rule 5: a file outside src/contracts declares an interface (or object `type`) with the name of a contract interface. */
export function ruleNoShadowInterfaces(files: readonly SourceFile[]): string[] {
  const names = contractInterfaceNames(files);
  const v: string[] = [];
  for (const f of files) {
    if (f.srcPath.startsWith('contracts/')) continue;
    for (const m of f.stripped.matchAll(/(^|[\n;{}])\s*(?:export\s+)?(?:declare\s+)?(interface|type)\s+([A-Za-z_$][\w$]*)\b/g)) {
      const name = m[3]!;
      const kind = m[2]!;
      if (!names.has(name)) continue;
      if (kind === 'type' && !/^\s*(<[^>]*>)?\s*=/.test(f.stripped.slice(m.index + m[0].length, m.index + m[0].length + 40))) continue;
      const line = f.stripped.slice(0, m.index + m[0].indexOf(kind)).split('\n').length;
      v.push(`${f.path}:${line}  ${kind} "${name}" shadows contracts/${names.get(name)!.slice('contracts/'.length)}`);
    }
  }
  return v;
}

/** Contract files import types only (frames.ts and sim.ts may import constants from each other). */
export function ruleContractsTypeImportsOnly(files: readonly SourceFile[]): string[] {
  const v: string[] = [];
  for (const f of files) {
    if (!f.srcPath.startsWith('contracts/')) continue;
    for (const imp of f.imports) {
      if (imp.typeOnly) continue;
      const target = resolveRelative(f, imp.spec);
      if (target !== null && /^contracts\/(frames|sim)$/.test(target) && /^contracts\/(frames|sim)\.ts$/.test(f.srcPath)) continue;
      v.push(`${f.path}:${imp.line}  non-type import "${imp.spec}"`);
    }
  }
  return v;
}

/** Contract files hold no runtime declarations except frames.ts, the two sim constants and the two replay layout constants (D-025). */
export function ruleContractsNoRuntime(files: readonly SourceFile[]): string[] {
  const v: string[] = [];
  for (const f of files) {
    if (!f.srcPath.startsWith('contracts/') || f.srcPath === 'contracts/frames.ts') continue;
    for (const m of f.stripped.matchAll(/(^|\n)\s*export\s+(?:declare\s+)?(const|let|var|function|class|enum|default|abstract)\b\s*([A-Za-z_$][\w$]*)?/g)) {
      const name = m[3] ?? m[2];
      if (f.srcPath === 'contracts/sim.ts' && (name === 'SIM_HZ' || name === 'SIM_DT')) continue;
      // D-025: replay layout constants are part of the binary format contract.
      if (f.srcPath === 'contracts/replay.ts' && (name === 'REPLAY_HZ' || name === 'REPLAY_CAR_STRIDE')) continue;
      // CR-NET-9 (D-043): wire-format constants of the online protocol.
      if (f.srcPath === 'contracts/net.ts' && (name === 'PROTOCOL_VERSION' || name === 'NET_STATE_BYTES' || name === 'NET_HZ')) continue;
      const line = f.stripped.slice(0, m.index + 1).split('\n').length;
      v.push(`${f.path}:${line}  runtime export "${m[2]} ${m[3] ?? ''}"`);
    }
  }
  return v;
}

/** Deep imports are allowed between modules of the same owner (TEAM-RULES §1). */
export const MODULE_OWNER: Readonly<Record<string, string>> = {
  core: 'lead', game: 'lead', net: 'lead', race: 'lead', data: 'lead', sandbox: 'lead', contracts: 'lead',
  track: 'environment', graphics: 'graphics', ui: 'graphics', trailer: 'graphics', physics: 'driving', ai: 'driving', audio: 'driving',
};

/** Shared sim leaves every module may import directly (ARCHITECTURE §1.1). */
const SHARED_LEAVES = /^(core\/math(\/|$)|core\/rng$|data\/)/;

/** S-AR-06: cross-owner imports must go through the target module's index (type-only imports and shared leaves excepted). */
export function ruleCrossModuleIndex(files: readonly SourceFile[]): string[] {
  const v: string[] = [];
  for (const f of files) {
    // Unit tests and sandbox scenes (dev tools that wire several modules together) are exempt; production code is not.
    if (/(^|\/)(__tests__|sandbox)\//.test(f.srcPath)) continue;
    const mod = moduleOf(f.srcPath);
    if (!mod || !MODULE_OWNER[mod]) continue;
    for (const imp of f.imports) {
      const target = resolveRelative(f, imp.spec);
      if (target === null) continue;
      const tmod = moduleOf(target) || target;
      if (tmod === mod || tmod === 'contracts' || !MODULE_OWNER[tmod]) continue;
      if (MODULE_OWNER[tmod] === MODULE_OWNER[mod]) continue;
      if (imp.typeOnly || SHARED_LEAVES.test(target)) continue;
      const isIndex = target === tmod || target === `${tmod}/index`;
      if (!isIndex) v.push(`${f.path}:${imp.line}  imports "${imp.spec}" (deep import into ${tmod}, owner ${MODULE_OWNER[tmod]}; use ${tmod}/index)`);
    }
  }
  return v;
}
