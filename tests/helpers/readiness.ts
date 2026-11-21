// Vitest-side readiness flags for `it.skipIf(...)` (Node env only; imports the track module).
// Hand-offs: H1 (track), H2 (graphics), H4 (physics + ai). See docs/sprints/sprint-1.md §1.

import { loadTrack } from '../../src/track/index';
import { isStatusReal, moduleStatusSummary } from './moduleStatus';

/** H1: İstanbul track is real when the flag is 'real' AND the default track is İstanbul. */
export const trackReal: boolean = isStatusReal('track') && loadTrack().data.id === 'istanbul';
/** H4: real vehicle physics. */
export const physicsReal: boolean = isStatusReal('physics');
/** H4: real AI. */
export const aiReal: boolean = isStatusReal('ai');
/** H2: real graphics (presets, renderer). */
export const graphicsReal: boolean = isStatusReal('graphics');
export const audioReal: boolean = isStatusReal('audio');
export const uiReal: boolean = isStatusReal('ui');

export const simReal: boolean = physicsReal && aiReal;

export function readinessSummary(): string {
  const s = moduleStatusSummary();
  return `track=${s.track}${trackReal ? '' : '(not istanbul or stub)'} physics=${s.physics} ai=${s.ai} graphics=${s.graphics} audio=${s.audio} ui=${s.ui}`;
}
