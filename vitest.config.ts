import { defineConfig } from 'vitest/config';

// Owned by the Tester (Sprint 1+). `npm test` runs every project below; run one with `npx vitest run --project sim`.
//
//   unit         module unit tests written by the module owners (src/<module>/__tests__) and the helper self-tests
//   arch         static / architecture rules (layers, i18n parity, dependency resolution, IP words, frozen contracts)
//   sim          headless createSim() tests (determinism, snapshots, single writer)
//   integration  presenters, settings migration, replay (Sprint 2+)
//
// All projects run in Node. E2E, perf, leak and gallery specs are Playwright (playwright.config.ts) and are excluded here.
const EXCLUDE = ['node_modules/**', 'dist/**', 'test-results/**', 'tests/e2e/**', 'tests/perf/**', 'tests/leak/**', 'tests/visual/**', '**/*.spec.ts'];

export default defineConfig({
  resolve: {
    dedupe: ['three'],
  },
  test: {
    // Sprint 1 has no integration tests yet (I-01..I-06 are Sprint 2); do not fail on an empty project.
    passWithNoTests: true,
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'node',
          include: ['src/**/__tests__/**/*.test.ts', 'tests/helpers/**/*.test.ts'],
          exclude: EXCLUDE,
          testTimeout: 30_000,
        },
      },
      {
        extends: true,
        test: {
          name: 'arch',
          environment: 'node',
          include: ['tests/arch/**/*.test.ts'],
          exclude: EXCLUDE,
          testTimeout: 30_000,
        },
      },
      {
        extends: true,
        test: {
          name: 'server',
          environment: 'node',
          include: ['server/**/__tests__/**/*.test.ts'],
          exclude: EXCLUDE,
          testTimeout: 30_000,
        },
      },
      {
        extends: true,
        test: {
          name: 'sim',
          environment: 'node',
          include: ['tests/sim/**/*.test.ts'],
          exclude: EXCLUDE,
          // 20 cars x 60 s x 240 Hz twice is a few seconds on stubs and more on the real physics.
          testTimeout: 120_000,
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          environment: 'node',
          include: ['tests/integration/**/*.test.ts'],
          exclude: EXCLUDE,
          testTimeout: 30_000,
        },
      },
    ],
  },
});
