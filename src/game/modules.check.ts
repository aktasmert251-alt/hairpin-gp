// Compile-time check that every module façade matches src/contracts/modules.ts. Never imported at runtime;
// `npm run typecheck` fails here (with a readable assignment error) if an owner breaks a factory signature.

import type * as Ai from '../ai/index';
import type * as Audio from '../audio/index';
import type * as Graphics from '../graphics/index';
import type * as Physics from '../physics/index';
import type * as Race from '../race/index';
import type * as Track from '../track/index';
import type * as Ui from '../ui/index';
import type * as Game from './index';
import type {
  AiModuleExports, AudioModule, GameModule, GraphicsModule, PhysicsModule, RaceModule, TrackModule, UiModule,
} from '../contracts/modules';

declare const track: typeof Track;
declare const physics: typeof Physics;
declare const ai: typeof Ai;
declare const race: typeof Race;
declare const game: typeof Game;
declare const graphics: typeof Graphics;
declare const ui: typeof Ui;
declare const audio: typeof Audio;

export const MODULE_CHECKS: readonly [TrackModule, PhysicsModule, AiModuleExports, RaceModule, GameModule, GraphicsModule, UiModule, AudioModule] = [
  track, physics, ai, race, game, graphics, ui, audio,
];
