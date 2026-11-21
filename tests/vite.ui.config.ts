import base from '../vite.config';
// Keep the UI test dev cache out of the shared node_modules; preserveSymlinks keeps worktrees (node_modules junction) working.
export default { ...base, resolve: { ...base.resolve, preserveSymlinks: true }, cacheDir: 'test-results/vite-ui-cache' };
