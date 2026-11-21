// Contract: team and driver definitions. Implemented by: Yönetici (src/data/teams.ts).

import type { AIDriverProfile } from './ai';

export interface TeamDef {
  id: string; name: string; short: string;
  /**
   * CSS hex colours (#rrggbb). `ui` (decision D-001) is the HUD strip/dot colour, ≥ 3:1 on graphite panels
   * (docs/design/DESIGN.md §1.4.2); consumers fall back with `colors.ui ?? colors.primary`.
   */
  colors: { primary: string; secondary: string; accent: string; ui: string };
  finish: 'gloss' | 'matte' | 'metallic';
  /** -0.015..+0.015; scales AI grip, power and ClA. Time Trial uses 0 for every car. */
  perf: number;
  /**
   * D-036 car character on top of `perf`: ratings −1..+1, higher = better. Physics maps them to small parameter
   * deltas (power, CdA, ClA, mechanical grip, tyre wear, ERS) so teams are fast in different places; the UI may show
   * them as bars. Time Trial ignores them like `perf`.
   */
  traits: TeamTraits;
  drivers: [DriverDef, DriverDef];
}

export interface TeamTraits {
  /** Engine power: acceleration out of slow corners and on straights. */
  power: number;
  /** Low drag: top speed (lower CdA, usually at the cost of downforce). */
  lowDrag: number;
  /** Aero downforce: high-speed corners (ClA). */
  downforce: number;
  /** Mechanical grip and traction: slow corners, kerbs. */
  mechGrip: number;
  /** Tyre care: slower wear and heat build-up. */
  tyreCare: number;
  /** ERS efficiency: more deploy per lap, better harvest. */
  ers: number;
}

export interface DriverDef {
  id: string; name: string; code: string; number: number;
  /** ISO 3166-1 alpha-2. */
  nat: string;
  ai: AIDriverProfile;
  /** Deviation from §4 (addition): T-cam colour, driver 1 black / driver 2 yellow. */
  tcam: 'black' | 'yellow';
}
