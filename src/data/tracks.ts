// Race track registry (tracks.md §1.2, D-034/D-035/D-037). Pure data; which of these the track module can build
// right now is decided in src/game/tracks.ts (availableRaceTracks), so the menus never offer a track Çevre has not landed.

import type { RaceTrackId } from '../contracts/track';

/** Menu order. */
export const RACE_TRACKS: readonly RaceTrackId[] = ['istanbul', 'lombardia', 'bosphorus', 'ardennes', 'alpine', 'cliff', 'eifel', 'aegean', 'cappadocia', 'volcano'];

export const DEFAULT_TRACK: RaceTrackId = 'istanbul';

export interface RaceTrackInfo {
  id: RaceTrackId;
  /** i18n key of the pre-composed uppercase name (D-003). */
  nameKey: `tracks.${RaceTrackId}`;
  /** Nominal lap length in m for menus before the track is built; `TrackData.length` is authoritative. */
  lengthM: number;
  /** Default race length in laps (the RACE_LENGTHS menu options apply to every track). */
  defaultLaps: number;
  /** D-037: aero trim for every car on this track, −1..+1 (negative = low downforce / low drag). İstanbul is the 0 baseline. */
  aeroTrim: number;
  /** Race-length options in laps (default: RACE_LENGTHS). Very long tracks offer short races. */
  lapOptions?: readonly number[];
  /** Most AI opponents the race setup offers on this track (default 19; a performance cap on very large maps). */
  maxAi?: number;
}

export const RACE_TRACK_INFO: Readonly<Record<RaceTrackId, RaceTrackInfo>> = {
  istanbul: { id: 'istanbul', nameKey: 'tracks.istanbul', lengthM: 5338, defaultLaps: 3, aeroTrim: 0 },
  lombardia: { id: 'lombardia', nameKey: 'tracks.lombardia', lengthM: 5793, defaultLaps: 3, aeroTrim: -1 },
  bosphorus: { id: 'bosphorus', nameKey: 'tracks.bosphorus', lengthM: 4978, defaultLaps: 3, aeroTrim: 0 },
  // CR-TRK-7: Ardennes (D-048), long and fast → low downforce.
  ardennes: { id: 'ardennes', nameKey: 'tracks.ardennes', lengthM: 7004, defaultLaps: 3, aeroTrim: -0.3 },
  // D-063: Alpine Pass (authored mountain circuit), twisty climb + two long straights → balanced.
  alpine: { id: 'alpine', nameKey: 'tracks.alpine', lengthM: 5649, defaultLaps: 3, aeroTrim: 0 },
  // Desert Cliff (authored escarpment circuit): three DRS straights and the ramp, twisty canyon → slightly low drag.
  cliff: { id: 'cliff', nameKey: 'tracks.cliff', lengthM: 7233, defaultLaps: 3, aeroTrim: -0.2 },
  // Eifel Forest Ring (authored, ≈ 20.4 km): Time Trial first; races default to 1 lap (1–3 offered) and at most 11 AI
  // opponents (12-car field) so the per-tick AI/physics load and the 8-min replay buffer stay in budget.
  // Aegean Islands (authored, mostly bridges over the sea): flowing, three DRS straights → balanced.
  aegean: { id: 'aegean', nameKey: 'tracks.aegean', lengthM: 6089, defaultLaps: 3, aeroTrim: 0 },
  eifel: { id: 'eifel', nameKey: 'tracks.eifel', lengthM: 20450, defaultLaps: 1, aeroTrim: 0, lapOptions: [1, 2, 3], maxAi: 11 },
  // Cappadocia Valley (authored, ≈ 4.5 km): short straights, 21 corners, slow and technical; balanced trim.
  cappadocia: { id: 'cappadocia', nameKey: 'tracks.cappadocia', lengthM: 4502, defaultLaps: 3, aeroTrim: 0 },
  // Volcano Rim (authored, ≈ 5.6 km): climb, rim, descent; long straights and hairpins → balanced.
  volcano: { id: 'volcano', nameKey: 'tracks.volcano', lengthM: 5650, defaultLaps: 3, aeroTrim: 0 },
};

export function isRaceTrackId(v: string | null | undefined): v is RaceTrackId {
  return v != null && (RACE_TRACKS as readonly string[]).includes(v);
}
