// Namespace `tt` (Grafik-UI), English.

import type { DictOf } from '../../core/i18n/types';
import type tr from './tt.tr';

const en: DictOf<typeof tr> = {
  title: 'Time trial',
  go: 'Go to track',
  track: 'Track',
  team: 'Team and livery',
  tyre: 'Tyre',
  tod: 'Time of day',
  weather: 'Weather',
  weatherValue: { dry: 'dry', light: 'light', heavy: 'heavy' },
  ghost: 'Ghost',
  ghostValue: { pb: 'personal best', rival: 'rival', off: 'off' },
  desc: {
    track: 'Choose which circuit to set your lap on.',
    team: 'In Time Trial every team has identical performance; only the livery changes.',
    ghost: 'Race your personal best lap or the built-in rival lap as a ghost.',
    tyre: 'Softs are the fastest over a single lap.',
  },
  results: {
    title: 'Time trial',
    newPb: 'New personal best',
    pb: 'Personal best',
    noLaps: 'No lap was completed in this session.',
    laps: 'Laps',
    top10: 'Local top 10',
    top10Empty: 'No valid laps saved yet. Your first valid lap is ranked here.',
    lap: 'Lap',
    time: 'Time',
    valid: 'Valid',
    date: 'Date',
    retry: 'Try again',
    menu: 'Quit to menu',
  },
};

export default en;
