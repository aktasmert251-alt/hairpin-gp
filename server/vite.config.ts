// Server bundle: `vite build --config server/vite.config.ts` → server/dist/apex-server.mjs.
// One self-contained ES module (ws is bundled in), so the VM needs only Node: no npm, no node_modules.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const serverDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: serverDir,
  publicDir: false,
  // The root vite.config.ts is not loaded (explicit --config), so its client settings do not apply here.
  ssr: { target: 'node', noExternal: true },
  build: {
    ssr: path.join(serverDir, 'src/main.ts'),
    outDir: path.join(serverDir, 'dist'),
    emptyOutDir: true,
    target: 'node24',
    minify: false,
    sourcemap: false,
    rolldownOptions: {
      // ws loads these native speed-ups only if present (try/catch require); the bundle never needs them.
      // The lazily imported scenery (three.js) is never used by the server sim; keep it out of the bundle.
      external: ['bufferutil', 'utf-8-validate', /scenery[\/]environment/],
      output: { format: 'es', entryFileNames: 'apex-server.mjs' },
    },
  },
});
