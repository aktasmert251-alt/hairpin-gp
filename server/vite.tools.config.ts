// Test tools bundle (not deployed): `npx vite build --config server/vite.tools.config.ts`
//   → server/dist/tools/apex-bot.mjs (replay bots) and server/dist/tools/ai-bench.mjs (server AI CPU per room).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const serverDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: serverDir,
  publicDir: false,
  ssr: { target: 'node', noExternal: true },
  build: {
    ssr: true,
    outDir: path.join(serverDir, 'dist', 'tools'),
    emptyOutDir: true,
    target: 'node24',
    minify: false,
    sourcemap: false,
    rolldownOptions: {
      input: { 'apex-bot': path.join(serverDir, 'bots/cli.ts'), 'ai-bench': path.join(serverDir, 'bench/aiCpu.ts') },
      // The lazily imported scenery (three.js) is never used by the sim; keep it out of the bundle.
      external: ['bufferutil', 'utf-8-validate', /scenery[\\/]environment/],
      output: { format: 'es', entryFileNames: '[name].mjs', chunkFileNames: '[name]-[hash].mjs' },
    },
  },
});
