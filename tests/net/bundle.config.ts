import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const dir = path.dirname(fileURLToPath(import.meta.url));
export default defineConfig({
  publicDir: false, ssr: { target: 'node', noExternal: true },
  build: {
    ssr: path.join(dir, 'support.ts'), outDir: path.join(dir, '.generated'),
    emptyOutDir: true, target: 'node24', minify: false,
    rolldownOptions: {
      external: ['bufferutil', 'utf-8-validate', /scenery[\\/]environment/],
      output: { format: 'es', entryFileNames: 'support.mjs' },
    },
  },
});
