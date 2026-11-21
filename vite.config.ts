import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

/**
 * Fails the build if any bundled module resolves outside the project root.
 * Guards against the stray parent <home>\node_modules (framer-motion, tslib) leaking in.
 */
function projectBoundary(): Plugin {
  return {
    name: 'apex:project-boundary',
    apply: 'build',
    buildEnd() {
      const outside: string[] = [];
      for (const id of this.getModuleIds()) {
        if (id.startsWith('\0')) continue;
        const file = id.split('?')[0]!;
        if (!path.isAbsolute(file)) continue;
        const rel = path.relative(projectRoot, file);
        if (rel.startsWith('..') || path.isAbsolute(rel)) outside.push(file);
      }
      if (outside.length > 0) this.error(`Modules resolved outside the project root:\n  ${outside.join('\n  ')}`);
    },
  };
}

// The dev/preview port always comes from the CLI (`npm run dev -- --port <n> --strictPort`).
export default defineConfig({
  base: './',
  plugins: [projectBoundary()],
  // src/core/buildInfo.ts: one id per build / dev-server start (rival ghost cache key, replay header).
  define: { __APEX_BUILD__: JSON.stringify(Date.now().toString(36)) },
  resolve: {
    dedupe: ['three'],
  },
  // Multiplayer dev (design §11.3): the page's same-origin `/ws` reaches a local game server (npm run server, port 8787).
  server: { proxy: { '/ws': { target: 'ws://localhost:8787', ws: true } } },
  preview: { proxy: { '/ws': { target: 'ws://localhost:8787', ws: true } } },
  // D-064: the host room worker (src/net/p2p/hostWorker.ts) bundles the sim, whose track module has a lazy import: ES workers.
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    // Published builds ship no source maps (smaller, and the source lives in the repository anyway).
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
    rolldownOptions: {
      output: {
        // Preserve third-party proprietary notices through production minification.
        comments: { legal: true },
        codeSplitting: {
          groups: [{ name: 'three', test: /[\\/]node_modules[\\/]three[\\/]/ }],
        },
      },
    },
  },
});
