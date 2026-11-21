// Game rules (PLAN Ek D).

/** 2025 points for P1..P10; no fastest-lap point. */
export const POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1] as const;

export const RACE_LENGTHS = [3, 5, 10, 15, 29] as const;
export const FLASHBACK_OPTIONS = [0, 3, 5, -1] as const;
export const DIFFICULTY_MIN = 0;
export const DIFFICULTY_MAX = 110;
export const DIFFICULTY_DEFAULT = 70;
export const MAX_AI = 19;

export const PIT_SPEED_LIMIT_KMH = 80;
export const JUMP_START_DISTANCE_M = 0.5;
export const PENALTY_SECONDS = 5;

export function pointsFor(position: number): number {
  return position >= 1 && position <= POINTS.length ? POINTS[position - 1]! : 0;
}
