// Isolate this worktree's browser-test cache from the shared dependency junction.
import base from '../vite.config';
import { defineConfig } from 'vite';
export default defineConfig({ ...base, resolve: { ...base.resolve, preserveSymlinks: true }, cacheDir: 'test-results/vite-codex' });
