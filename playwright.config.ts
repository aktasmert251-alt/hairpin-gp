import { defineConfig } from '@playwright/test';

// Owned by the Tester (Sprint 1+). System Chrome only (`channel: 'chrome'`); never run `npx playwright install`.
//
// Projects (testing-qc.md §2, ARCHITECTURE §13):
//   e2e     tests/e2e     headless; the default of `npm run e2e` (smoke E-SM-01/02, menus, race flows)
//   visual  tests/visual  headless; screenshot gallery -> test-results/screens/gallery/ (npm run shots)
//   perf    tests/perf    HEADED with GPU flags (rendering.md §11.2); one worker; also scripts/perf.mjs
//   leak    tests/leak    headless; L-01..L-03
//
// `npm run e2e` (= `playwright test`) must stay fast and green, so only `e2e` is registered unless you ask for another project:
//   npx playwright test --project=perf     |   npx playwright test --project=visual   |   npx playwright test leak
//   APEX_ALL_PROJECTS=1 npx playwright test          (everything)
// The dev server is started on the Tester's port 5177 and reused when already running. Set APEX_BASE_URL to test another server
// (for example `npm run preview` on 4173); no server is started then.

/** One id per `playwright test` invocation (workers inherit it); the gallery uses it to merge only this run's shots into index.json. */
process.env.APEX_RUN_ID ??= new Date().toISOString().replace(/[:.]/g, '-');

const PORT = 5177;
const BASE_URL = process.env.APEX_BASE_URL ?? `http://localhost:${PORT}`;

/** Flags for functional (headless) runs; same as scripts/shot.mjs. */
const GPU_FLAGS = ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'];
/** rendering.md §11.2 step 2 (perf runs are headed). */
const PERF_FLAGS = [
  '--use-angle=d3d11',
  '--ignore-gpu-blocklist',
  '--force-device-scale-factor=1',
  '--window-size=1920,1080',
  '--window-position=0,0',
  '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding',
  '--disable-backgrounding-occluded-windows',
];

const cli = process.argv.slice(2);
const wantsOtherProject =
  process.env.APEX_ALL_PROJECTS === '1' ||
  cli.some((a) => a === '--project' || a.startsWith('--project=') || /(^|[\\/])(perf|leak|visual)([\\/.]|$)/.test(a) || a === 'perf' || a === 'leak' || a === 'visual');
// Playwright re-evaluates this file inside every worker, where process.argv no longer holds the CLI arguments. Workers inherit the
// environment of the main process, so the decision is passed on through it.
if (wantsOtherProject) process.env.APEX_ALL_PROJECTS = '1';

const viewport = { width: 1920, height: 1080 };

export default defineConfig({
  outputDir: 'test-results/e2e',
  globalSetup: './tests/globalSetup.ts',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: process.env.APEX_WORKERS ? Number(process.env.APEX_WORKERS) : 2,
  retries: process.env.CI ? 1 : 0,
  forbidOnly: Boolean(process.env.CI),
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'test-results/report' }]],
  use: {
    channel: 'chrome',
    baseURL: BASE_URL,
    viewport,
    launchOptions: { args: GPU_FLAGS },
    trace: 'retain-on-failure',
  },
  webServer: process.env.APEX_BASE_URL
    ? undefined
    : {
        command: `npm run dev -- --port ${PORT} --strictPort`,
        url: `http://localhost:${PORT}/`,
        reuseExistingServer: true,
        timeout: 90_000,
        stdout: 'ignore',
        stderr: 'ignore',
      },
  projects: [
    { name: 'e2e', testDir: 'tests/e2e' },
    ...(wantsOtherProject
      ? [
          { name: 'visual', testDir: 'tests/visual', timeout: 180_000 },
          {
            name: 'perf',
            testDir: 'tests/perf',
            timeout: 900_000,
            fullyParallel: false,
            use: { headless: false, launchOptions: { args: PERF_FLAGS } },
          },
          { name: 'leak', testDir: 'tests/leak', timeout: 300_000 },
        ]
      : []),
  ],
});
