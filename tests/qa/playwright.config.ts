import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.', testMatch: 'smoke.spec.ts', workers: 1, retries: 0,
  timeout: 360_000, expect: { timeout: 10_000 },
  outputDir: '../../test-results/qa-sweep-2026-10-19/smoke',
  reporter: [['list'], ['json', { outputFile: '../../test-results/qa-sweep-2026-10-19/smoke.json' }]],
  use: {
    baseURL: 'http://127.0.0.1:5180', channel: 'chrome', viewport: { width: 1920, height: 1080 },
    launchOptions: { args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] },
    trace: 'retain-on-failure',
  },
});
