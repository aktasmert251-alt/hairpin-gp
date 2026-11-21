// Playwright fixtures for every browser test (testing-qc.md §1).
//
//   import { test, expect } from '../helpers/fixtures';
//
// Gates applied to EVERY test that uses this `test`:
//   * auto fixture `errorGuard`: after the test, fails it when `console.error` was logged by any page of the context, a page
//     threw (`pageerror`), or `window.__APEX__.errors` is non-empty in any open page;
//   * localStorage starts clean (once per tab; a reload inside the test keeps persisted data) unless `cleanStorage` is false;
//   * `apex` fixture: typed `window.__APEX__` client (tests/helpers/apexClient.ts).
//
// Options (per project or per file via `test.use`): `allowedErrors` (regexes for known, documented messages), `cleanStorage`, `blockHmr`.

import { test as base, expect, type BrowserContext, type Page } from '@playwright/test';
import { ApexClient } from './apexClient';
import { BLOCK_VITE_HMR, RESET_STORAGE_ONCE } from './pageInit.mjs';

export interface ApexTestOptions {
  /** Messages that do not fail the error gate (keep this list empty unless a bug is tracked in docs/qa). */
  allowedErrors: RegExp[];
  /** Clear localStorage before the first document of every tab loads. Default true. */
  cleanStorage: boolean;
  /** Replace Vite's HMR WebSocket by an inert one so that edits to src/ by other agents cannot reload the page mid-test. Default true. */
  blockHmr: boolean;
}

interface ApexFixtures {
  apex: ApexClient;
  errorGuard: void;
}

async function pageApexErrors(page: Page): Promise<string[]> {
  if (page.isClosed()) return [];
  try {
    return await page.evaluate(() => [...((window as unknown as { __APEX__?: { errors: string[] } }).__APEX__?.errors ?? [])]);
  } catch {
    return [];
  }
}

export const test = base.extend<ApexFixtures & ApexTestOptions>({
  allowedErrors: [[], { option: true }],
  cleanStorage: [true, { option: true }],
  blockHmr: [true, { option: true }],

  context: async ({ context, cleanStorage, blockHmr }, use) => {
    if (blockHmr) await context.addInitScript(BLOCK_VITE_HMR);
    if (cleanStorage) await context.addInitScript(RESET_STORAGE_ONCE);
    await use(context);
  },

  errorGuard: [
    async ({ context, allowedErrors }, use, testInfo) => {
      const logged: string[] = [];
      const onConsole = (msg: { type(): string; text(): string; location(): { url: string; lineNumber: number } }): void => {
        if (msg.type() !== 'error') return;
        const loc = msg.location();
        logged.push(`console.error: ${msg.text()}${loc.url ? ` (${loc.url}:${loc.lineNumber})` : ''}`);
      };
      const onWebError = (we: { error(): Error }): void => {
        logged.push(`pageerror: ${we.error().message}`);
      };
      context.on('console', onConsole);
      context.on('weberror', onWebError);
      await use();
      context.off('console', onConsole);
      context.off('weberror', onWebError);

      const fromApex: string[] = [];
      for (const p of context.pages()) for (const e of await pageApexErrors(p)) fromApex.push(`__APEX__.errors: ${e}`);

      const seen = new Set<string>();
      const all = [...logged, ...fromApex].filter((line) => {
        const body = line.replace(/^[^:]+:\s*/, '').slice(0, 120);
        if (allowedErrors.some((re) => re.test(line))) return false;
        if (seen.has(body)) return false;
        seen.add(body);
        return true;
      });
      if (all.length > 0) {
        await testInfo.attach('page-errors', { body: all.join('\n'), contentType: 'text/plain' });
        throw new Error(`The page reported ${all.length} error(s) (testing-qc.md §1 gate):\n  - ${all.join('\n  - ')}`);
      }
    },
    { auto: true },
  ],

  apex: async ({ page }, use) => {
    await use(new ApexClient(page));
  },
});

export { expect };
export type { BrowserContext, Page };
