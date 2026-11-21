// S-AR-05: `src/contracts/**` is changed only by the Lead (TEAM-RULES §1). This test pins every contract file to the hash recorded
// at the last sprint commit (tests/arch/contracts.baseline.json). It fails when a contract file changes, appears or disappears.
//
// When the Lead legitimately changes contracts (a Lead CR sprint, or accepted change requests applied before a sprint), the
// orchestrator or Tester re-records the baseline in the same commit:
//     UPDATE_CONTRACT_BASELINE=1 npx vitest run --project arch tests/arch/contracts-frozen.test.ts
// Hashes are over LF-normalised text, so line-ending conversion by git does not matter.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT, SRC, walkFiles } from '../helpers/paths';

const BASELINE = path.join(ROOT, 'tests', 'arch', 'contracts.baseline.json');

interface Baseline { recorded: string; note: string; files: Record<string, string> }

function currentHashes(): Record<string, string> {
  const dir = path.join(SRC, 'contracts');
  const out: Record<string, string> = {};
  for (const abs of walkFiles(dir, (f) => f.endsWith('.ts'))) {
    const text = readFileSync(abs, 'utf8').replace(/\r\n/g, '\n');
    out[path.relative(dir, abs).split(path.sep).join('/')] = createHash('sha256').update(text).digest('hex');
  }
  return out;
}

describe('S-AR-05 contracts frozen', () => {
  it('src/contracts/** equals the baseline recorded at the last sprint commit', () => {
    const now = currentHashes();
    if (process.env.UPDATE_CONTRACT_BASELINE === '1') {
      const baseline: Baseline = {
        recorded: new Date().toISOString().slice(0, 10),
        note: 'sha256 of LF-normalised src/contracts/*.ts. Re-record with UPDATE_CONTRACT_BASELINE=1 (see contracts-frozen.test.ts).',
        files: now,
      };
      writeFileSync(BASELINE, `${JSON.stringify(baseline, null, 2)}\n`);
    }
    expect(existsSync(BASELINE), 'tests/arch/contracts.baseline.json exists (record it with UPDATE_CONTRACT_BASELINE=1)').toBe(true);
    const base = JSON.parse(readFileSync(BASELINE, 'utf8')) as Baseline;
    const changed: string[] = [];
    for (const [f, h] of Object.entries(now)) {
      if (base.files[f] === undefined) changed.push(`added    ${f}`);
      else if (base.files[f] !== h) changed.push(`modified ${f}`);
    }
    for (const f of Object.keys(base.files)) if (now[f] === undefined) changed.push(`removed  ${f}`);
    expect(
      changed,
      `src/contracts changed since ${base.recorded} (only the Lead may change contracts, TEAM-RULES §1):\n  ${changed.join('\n  ')}\n` +
        'If this is an accepted Lead change, re-record: UPDATE_CONTRACT_BASELINE=1 npx vitest run --project arch tests/arch/contracts-frozen.test.ts',
    ).toEqual([]);
  });
});
