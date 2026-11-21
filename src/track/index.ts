// Track module façade (Çevre; contracts/modules.ts TrackModule). The sim's static import graph
// (createSim -> loadTrack) must never pull in three.js: `buildEnvironment` is loaded through a dynamic import.

import type { BuildEnvironment } from '../contracts/environment';
import type { TrackBundle, TrackId } from '../contracts/track';
import type { BuiltTrackId } from './authoring/types';
import { loadRaceTrack } from './registry';
import { createOvalTrack } from './stub/oval';
import { createStraightTrack } from './stub/straight';

/** 'real' since the İstanbul hand-off (H1): loadTrack().data.id === 'istanbul'. */
export const MODULE_STATUS: string = 'real';

export { createStraightTrack } from './stub/straight';
export { createOvalTrack, OVAL_LENGTH, OVAL_RADIUS } from './stub/oval';
export { getTrackExtras } from './build/extras';

/** Sync: builds (once per id) and returns a race track from its baked data (default İstanbul). 'oval' → createOvalTrack(),
 *  'straight' → createStraightTrack(1000). */
export function loadTrack(id: TrackId | BuiltTrackId = 'istanbul'): TrackBundle {
  if (id === 'oval') return createOvalTrack();
  if (id === 'straight') return createStraightTrack(1000);
  return loadRaceTrack(id);
}

/** H3: the real environment (src/track/scenery), loaded lazily so the sim never imports three.js. */
export const buildEnvironment: BuildEnvironment = async (args) => {
  const mod = await import('./scenery/environment');
  return mod.buildEnvironmentReal(args);
};
