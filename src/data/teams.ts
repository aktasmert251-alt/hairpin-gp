// The 10 fictional teams and 20 drivers (planner-report §4). No real teams, drivers, codes or logos.
// `traits` (D-036): where each car is strong or weak, ratings −1..+1 on top of `perf`.
// T-cam: driver 1 black, driver 2 yellow. `perf` scales AI grip and car power/ClA by up to ±1.5% (TT uses 0).
// Colours follow docs/design/DESIGN.md §1.4.2; `ui` is the HUD strip colour (decision D-001).

import type { AIDriverProfile } from '../contracts/ai';
import type { DriverDef, TeamDef } from '../contracts/data';

function ai(pace: number, consistency: number, aggression: number, wetSkill: number, tyreMgmt: number, startSkill: number, defending: number): AIDriverProfile {
  return { pace, consistency, aggression, wetSkill, tyreMgmt, startSkill, defending };
}

function driver(id: string, name: string, code: string, number: number, nat: string, profile: AIDriverProfile, tcam: 'black' | 'yellow'): DriverDef {
  return { id, name, code, number, nat, ai: profile, tcam };
}

export const TEAMS: readonly TeamDef[] = [
  {
    id: 'anka', name: 'Anka Racing', short: 'ANKA',
    colors: { primary: '#C8102E', secondary: '#F4F4F2', accent: '#D4A72C', ui: '#E8213F' }, finish: 'gloss', perf: 0.01,
    traits: { power: 0.6, lowDrag: 0.0, downforce: 0.4, mechGrip: 0.2, tyreCare: 0.6, ers: 0.0 },
    drivers: [
      driver('aydin', 'Kerem Aydın', 'AYD', 7, 'TR', ai(0.998, 0.86, 0.72, 0.8, 0.7, 0.75, 0.7), 'black'),
      driver('arslan', 'Deniz Arslan', 'ARS', 34, 'TR', ai(0.993, 0.8, 0.66, 0.72, 0.74, 0.68, 0.64), 'yellow'),
    ],
  },
  {
    id: 'aurora', name: 'Aurora GP', short: 'AURORA',
    colors: { primary: '#E8EEF4', secondary: '#1E90FF', accent: '#9FD4FF', ui: '#2AA4FF' }, finish: 'gloss', perf: 0.012,
    traits: { power: -0.2, lowDrag: -0.4, downforce: 0.8, mechGrip: 0.6, tyreCare: 0.2, ers: 0.2 },
    drivers: [
      driver('norberg', 'Elias Norberg', 'NRB', 6, 'SE', ai(1.0, 0.9, 0.68, 0.85, 0.78, 0.82, 0.76), 'black'),
      driver('virtanen', 'Juho Virtanen', 'VIR', 19, 'FI', ai(0.995, 0.88, 0.6, 0.9, 0.8, 0.7, 0.7), 'yellow'),
    ],
  },
  {
    id: 'vortex', name: 'Vortex Motorsport', short: 'VORTEX',
    colors: { primary: '#121314', secondary: '#39F26A', accent: '#F2F4F7', ui: '#3DF06A' }, finish: 'matte', perf: 0.015,
    traits: { power: 0.8, lowDrag: 0.6, downforce: 0.2, mechGrip: 0.0, tyreCare: -0.4, ers: 0.6 },
    drivers: [
      driver('ashby', 'Tom Ashby', 'ASH', 9, 'GB', ai(1.0, 0.92, 0.8, 0.88, 0.76, 0.86, 0.82), 'black'),
      driver('mendes', 'Rafael Mendes', 'MEN', 28, 'BR', ai(0.996, 0.84, 0.78, 0.92, 0.7, 0.8, 0.74), 'yellow'),
    ],
  },
  {
    id: 'solaris', name: 'Solaris Racing', short: 'SOLARIS',
    colors: { primary: '#FF6A13', secondary: '#3B1A6B', accent: '#F2F4F7', ui: '#FF7A1A' }, finish: 'metallic', perf: 0.005,
    traits: { power: 0.2, lowDrag: 0.0, downforce: 0.2, mechGrip: -0.2, tyreCare: 0.2, ers: 0.8 },
    drivers: [
      driver('moretti', 'Luca Moretti', 'MOR', 15, 'IT', ai(0.997, 0.82, 0.82, 0.7, 0.66, 0.78, 0.72), 'black'),
      driver('lambert', 'Hugo Lambert', 'LAM', 41, 'BE', ai(0.992, 0.86, 0.6, 0.76, 0.82, 0.7, 0.68), 'yellow'),
    ],
  },
  {
    id: 'kestrel', name: 'Kestrel Racing', short: 'KESTREL',
    colors: { primary: '#13235B', secondary: '#C9A227', accent: '#F2F4F7', ui: '#6478F0' }, finish: 'gloss', perf: 0,
    traits: { power: -0.2, lowDrag: 0.2, downforce: 0.0, mechGrip: 0.6, tyreCare: 0.4, ers: -0.4 },
    drivers: [
      driver('grant', 'Oliver Grant', 'GRA', 3, 'GB', ai(0.995, 0.88, 0.64, 0.78, 0.8, 0.74, 0.78), 'black'),
      driver('morita', 'Kenji Morita', 'MRT', 25, 'JP', ai(0.99, 0.9, 0.56, 0.74, 0.86, 0.72, 0.66), 'yellow'),
    ],
  },
  {
    id: 'meridian', name: 'Meridian Racing', short: 'MERIDIAN',
    colors: { primary: '#0E8C82', secondary: '#B9C0C7', accent: '#F2F4F7', ui: '#14B8A6' }, finish: 'metallic', perf: 0,
    traits: { power: 0.2, lowDrag: 0.8, downforce: -0.6, mechGrip: 0.0, tyreCare: 0.0, ers: 0.0 },
    drivers: [
      driver('ortega', 'Mateo Ortega', 'ORT', 11, 'ES', ai(0.994, 0.84, 0.74, 0.8, 0.72, 0.76, 0.7), 'black'),
      driver('fischer', 'Noah Fischer', 'FIS', 52, 'DE', ai(0.991, 0.88, 0.58, 0.7, 0.8, 0.66, 0.72), 'yellow'),
    ],
  },
  {
    id: 'titan', name: 'Titan Dynamics', short: 'TITAN',
    colors: { primary: '#3A4048', secondary: '#D7262B', accent: '#B9C0C7', ui: '#9AA4AE' }, finish: 'matte', perf: -0.005,
    traits: { power: 0.6, lowDrag: 0.0, downforce: -0.4, mechGrip: -0.4, tyreCare: -0.2, ers: 0.0 },
    drivers: [
      driver('hale', 'Viktor Hale', 'HAL', 8, 'CA', ai(0.993, 0.8, 0.76, 0.74, 0.7, 0.72, 0.74), 'black'),
      driver('petrov', 'Anton Petrov', 'PET', 70, 'BG', ai(0.989, 0.82, 0.7, 0.82, 0.74, 0.7, 0.68), 'yellow'),
    ],
  },
  {
    id: 'zephyr', name: 'Zephyr Racing', short: 'ZEPHYR',
    colors: { primary: '#6EC6F0', secondary: '#FF5FA8', accent: '#F2F4F7', ui: '#FF6FB5' }, finish: 'gloss', perf: -0.008,
    traits: { power: -0.6, lowDrag: -0.2, downforce: 0.4, mechGrip: 0.2, tyreCare: 0.6, ers: -0.2 },
    drivers: [
      driver('duval', 'Leo Duval', 'DUV', 21, 'FR', ai(0.992, 0.84, 0.66, 0.76, 0.76, 0.74, 0.66), 'black'),
      driver('ruiz', 'Santiago Ruiz', 'RUI', 37, 'MX', ai(0.988, 0.78, 0.74, 0.7, 0.68, 0.7, 0.7), 'yellow'),
    ],
  },
  {
    id: 'ironclad', name: 'Ironclad Racing', short: 'IRONCLAD',
    colors: { primary: '#FFD21A', secondary: '#111214', accent: '#F2F4F7', ui: '#FFE01A' }, finish: 'gloss', perf: -0.012,
    traits: { power: -0.4, lowDrag: 0.0, downforce: -0.4, mechGrip: 0.2, tyreCare: 0.8, ers: -0.4 },
    drivers: [
      driver('whitmore', 'Jack Whitmore', 'WHI', 12, 'AU', ai(0.99, 0.8, 0.78, 0.72, 0.66, 0.76, 0.72), 'black'),
      driver('cole', 'Ethan Cole', 'CLE', 46, 'US', ai(0.986, 0.76, 0.7, 0.68, 0.72, 0.66, 0.64), 'yellow'),
    ],
  },
  {
    id: 'nova', name: 'Nova Corsa', short: 'NOVA',
    colors: { primary: '#F4F5F7', secondary: '#1F4FBF', accent: '#D7262B', ui: '#F2F4F7' }, finish: 'gloss', perf: -0.015,
    traits: { power: -0.4, lowDrag: 0.4, downforce: -0.6, mechGrip: -0.4, tyreCare: -0.2, ers: 0.4 },
    drivers: [
      driver('moreau', 'Julien Moreau', 'MRE', 17, 'MC', ai(0.989, 0.82, 0.68, 0.78, 0.74, 0.72, 0.68), 'black'),
      driver('park', 'Aiden Park', 'PAR', 88, 'NZ', ai(0.985, 0.8, 0.62, 0.74, 0.78, 0.68, 0.62), 'yellow'),
    ],
  },
];

export const DEFAULT_PLAYER_TEAM = 'anka';

export interface DriverEntry { team: TeamDef; driver: DriverDef; idx: 0 | 1 }

/** All 20 drivers in team order (driver 1 then driver 2). */
export const ALL_DRIVERS: readonly DriverEntry[] = TEAMS.flatMap((team) => [
  { team, driver: team.drivers[0], idx: 0 as const },
  { team, driver: team.drivers[1], idx: 1 as const },
]);

export function teamById(id: string): TeamDef | undefined {
  return TEAMS.find((t) => t.id === id);
}

export function driverById(id: string): DriverEntry | undefined {
  return ALL_DRIVERS.find((e) => e.driver.id === id);
}
