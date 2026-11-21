import { createServer } from 'vite';

const server = await createServer({
  configFile: 'vite.worktree.config.ts', configLoader: 'runner',
  cacheDir: 'test-results/qa-sweep-2026-10-19/vite-cache',
  server: { host: '127.0.0.1', port: 5180, strictPort: true },
});
await server.listen();
console.log(`QA Vite PID ${process.pid}`);
server.printUrls();
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await server.close(); process.exit(0); });
