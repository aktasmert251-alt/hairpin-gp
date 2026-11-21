// Sim layer (Çevre).
// Surface table (planner-report §5.5). Band type codes in TrackData index into SURFACE_TYPES.

import type { SurfaceType } from '../../contracts/common';
import type { SurfaceProps } from '../../contracts/track';

export const SURFACE_TYPES: readonly SurfaceType[] = [
  'asphalt', 'line', 'kerbFlat', 'kerbSausage', 'astroturf', 'runoffAsphalt', 'grass', 'gravel', 'pitAsphalt', 'concrete', 'ash',
];

export const SURFACE_CODE: Readonly<Record<SurfaceType, number>> = Object.fromEntries(
  SURFACE_TYPES.map((t, i) => [t, i]),
) as Record<SurfaceType, number>;

const G = 9.81;

/** bumpAmp / bumpWavelength in m; dragDecel in m/s² (physics scales gravel by min(1, v/10)). */
export const SURFACE_PROPS: Readonly<Record<SurfaceType, SurfaceProps>> = {
  asphalt: { mu: 1.0, muWetMul: 1.0, rollingResistance: 0.012, dragDecel: 0, bumpAmp: 0, bumpWavelength: 0, loadNoise: 0 },
  line: { mu: 0.92, muWetMul: 0.75, rollingResistance: 0.012, dragDecel: 0, bumpAmp: 0, bumpWavelength: 0, loadNoise: 0 },
  kerbFlat: { mu: 0.94, muWetMul: 0.8, rollingResistance: 0.014, dragDecel: 0, bumpAmp: 0.006, bumpWavelength: 1.0, loadNoise: 0 },
  kerbSausage: { mu: 0.75, muWetMul: 0.7, rollingResistance: 0.03, dragDecel: 0, bumpAmp: 0.04, bumpWavelength: 0.5, loadNoise: 0.4 },
  astroturf: { mu: 0.8, muWetMul: 0.6, rollingResistance: 0.02, dragDecel: 0, bumpAmp: 0.002, bumpWavelength: 0.5, loadNoise: 0 },
  runoffAsphalt: { mu: 0.95, muWetMul: 0.95, rollingResistance: 0.013, dragDecel: 0, bumpAmp: 0, bumpWavelength: 0, loadNoise: 0 },
  grass: { mu: 0.55, muWetMul: 0.6, rollingResistance: 0.05, dragDecel: 0, bumpAmp: 0.02, bumpWavelength: 2.0, loadNoise: 0 },
  gravel: { mu: 0.45, muWetMul: 0.9, rollingResistance: 0.12, dragDecel: 0.25 * G, bumpAmp: 0.03, bumpWavelength: 0.3, loadNoise: 0 },
  pitAsphalt: { mu: 0.98, muWetMul: 1.0, rollingResistance: 0.012, dragDecel: 0, bumpAmp: 0, bumpWavelength: 0, loadNoise: 0 },
  concrete: { mu: 0.9, muWetMul: 0.85, rollingResistance: 0.012, dragDecel: 0, bumpAmp: 0, bumpWavelength: 0, loadNoise: 0 },
  // Volcanic ash on the racing surface (Volcano Rim): fine grit, ≈ 15 % less grip, slightly draggy, a faint rumble.
  ash: { mu: 0.85, muWetMul: 0.8, rollingResistance: 0.016, dragDecel: 0, bumpAmp: 0.002, bumpWavelength: 0.4, loadNoise: 0 },
};
