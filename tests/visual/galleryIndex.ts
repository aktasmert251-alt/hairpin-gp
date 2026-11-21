// Gallery bookkeeping: each shot writes its own entry file (robust against parallel workers and worker restarts after a failure);
// `mergeGalleryIndex()` folds every entry whose PNG still exists into test-results/screens/gallery/index.json (the newest entry per
// PNG wins; each entry carries its own run id and timestamp, so a partial run only refreshes the shots it took).

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT, SCREENS_DIR } from '../helpers/paths';

export const GALLERY_DIR = path.join(SCREENS_DIR, 'gallery');
const ENTRIES_DIR = path.join(GALLERY_DIR, '.entries');

export interface GalleryEntry {
  /** Project-relative PNG path. */
  path: string;
  kind: 'scene' | 'point' | 'race-start';
  /** Sandbox scene id, or the screenshot point id for points. */
  scene: string;
  /** URL query (scenes) or the session parameters (points) that produced the picture. */
  params: Record<string, string | number | boolean>;
  timestamp: string;
  runId: string;
  lumaMean: number;
  lumaStdDev: number;
  gpu: string;
  notes?: string;
}

export function runId(): string {
  return process.env.APEX_RUN_ID ?? 'local';
}

export function writeEntry(e: Omit<GalleryEntry, 'timestamp' | 'runId'>): void {
  mkdirSync(ENTRIES_DIR, { recursive: true });
  const entry: GalleryEntry = { ...e, timestamp: new Date().toISOString(), runId: runId() };
  const name = path.basename(e.path, '.png');
  writeFileSync(path.join(ENTRIES_DIR, `${name}.json`), `${JSON.stringify(entry)}\n`);
}

/** Merges all entries with an existing PNG into index.json (sorted by path). Returns the number of entries. */
export function mergeGalleryIndex(): number {
  let names: string[] = [];
  try {
    names = readdirSync(ENTRIES_DIR).filter((n) => n.endsWith('.json'));
  } catch {
    return 0;
  }
  const id = runId();
  const entries: GalleryEntry[] = [];
  for (const n of names) {
    try {
      const e = JSON.parse(readFileSync(path.join(ENTRIES_DIR, n), 'utf8')) as GalleryEntry;
      if (existsSync(path.join(ROOT, e.path))) entries.push(e);
    } catch {
      /* partial write from an interrupted run */
    }
  }
  entries.sort((a, b) => a.path.localeCompare(b.path));
  mkdirSync(GALLERY_DIR, { recursive: true });
  writeFileSync(path.join(GALLERY_DIR, 'index.json'), `${JSON.stringify({ runId: id, generated: new Date().toISOString(), count: entries.length, shots: entries }, null, 2)}\n`);
  return entries.length;
}
