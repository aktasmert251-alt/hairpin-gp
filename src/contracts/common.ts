// Contract: shared primitive types. Implemented by: nobody (types only); owned by Yönetici.

export interface Vec3 { x: number; y: number; z: number }
/** Wheel order FL, FR, RL, RR. */
export type Quad<T> = [T, T, T, T];
export type WheelIndex = 0 | 1 | 2 | 3;
/** +1 = LEFT (+d), -1 = right. */
export type Side = 1 | -1;
export type Compound = 'soft' | 'medium' | 'hard' | 'inter' | 'wet';
export type SurfaceType = 'asphalt' | 'line' | 'kerbFlat' | 'kerbSausage' | 'astroturf'
  | 'runoffAsphalt' | 'grass' | 'gravel' | 'pitAsphalt' | 'concrete'
  /** Volcano Rim: volcanic ash blown across the racing surface (≈ 0.85 grip). */
  | 'ash';
export type TimeOfDay = 'day' | 'sunset' | 'night';
export type WeatherPreset = 'dry' | 'light' | 'heavy' | 'variable';
export type QualityId = 'low' | 'medium' | 'high' | 'ultra';
export type CameraId = 'cockpit' | 'tcam' | 'nose' | 'chaseNear' | 'chaseFar';
export type Lang = 'tr' | 'en';
export type Unsubscribe = () => void;
