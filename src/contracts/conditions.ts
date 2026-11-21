// Contract: weather / time-of-day state. Implemented by: Yönetici (src/race/conditions*).

import type { TimeOfDay, WeatherPreset } from './common';

export interface WeatherKeyframe { t: number; rain: number }

export interface ConditionsState {
  tod: TimeOfDay; preset: WeatherPreset; rain: number; wetness: number; lineWetness: number;
  airC: number; trackC: number; timeline: WeatherKeyframe[]; nextTickT: number;
}

export interface ForecastEntry { inMin: number; rain: number; probability: number }

export interface ConditionsFrame { tod: TimeOfDay; rain: number; wetness: number; lineWetness: number; cloud: number; time: number }
