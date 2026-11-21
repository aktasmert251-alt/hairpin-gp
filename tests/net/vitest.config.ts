import { defineConfig } from 'vitest/config';

// Standalone until the Lead adds the net project to the root configuration.
export default defineConfig({
  test: {
    name: 'net', environment: 'node', include: ['tests/net/**/*.test.ts'],
    globalSetup: ['tests/net/setup.ts'], fileParallelism: false, maxConcurrency: 2,
    testTimeout: 240_000, hookTimeout: 60_000,
    reporters: ['default', 'json'], outputFile: { json: 'test-results/net/vitest.json' },
  },
});
