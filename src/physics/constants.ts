// Physics constants (sim layer).

export const G = 9.81;
export const RPM_PER_RADS = 60 / (2 * Math.PI);
export const RADS_PER_RPM = (2 * Math.PI) / 60;
export const DEG = Math.PI / 180;
/** Wheel-spin substeps per 240 Hz tick (960 Hz). */
export const WHEEL_SUBSTEPS = 4;
/** 60 Hz tasks run when tick % 4 === 0 with dt = 4·SIM_DT. */
export const SLOW_EVERY = 4;
/** Auto gearbox thresholds (§5.8). */
export const AUTO_UP_RPM = 11800;
export const AUTO_DOWN_RPM = 7800;
export const AUTO_DOWN_BRAKE_MAX_RPM = 11000;
/** Pit limiter target (pit-weather.md §2.5). */
export const PIT_LIMIT_MS = 79.5 / 3.6;
/** Air density at T: ρ·288.15/(273.15 + T). */
export function airDensity(rho15: number, airC: number): number {
  return (rho15 * 288.15) / (273.15 + airC);
}
