// İstanbul spectator areas (planner-report §7.9, copied as constants per audio.md §4): main grandstand s range and
// bleacher centres (main-track s, m). Crowd gain: 0.30 inside the grandstand, 0.15 within 60 m of a bleacher, 0.03
// elsewhere.

export const GRANDSTAND_FROM = 5089;
export const GRANDSTAND_TO = 130;
export const BLEACHERS: readonly number[] = [264, 1013, 1390, 1433, 2280, 2632, 3238, 3432, 3877, 4563, 4870, 5036];

/** Crowd bed gain at main-track s (track length L). */
export function crowdGain(s: number, L: number): number {
  if (!(s === s) || L <= 0) return 0.03;
  if (s >= GRANDSTAND_FROM || s <= GRANDSTAND_TO) return 0.3;
  for (let i = 0; i < BLEACHERS.length; i++) {
    let d = s - BLEACHERS[i]!;
    if (d > L / 2) d -= L;
    else if (d < -L / 2) d += L;
    if (d < 60 && d > -60) return 0.15;
  }
  return 0.03;
}
