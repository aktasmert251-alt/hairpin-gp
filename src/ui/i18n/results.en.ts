// Namespace `results` (Grafik-UI), English.

import type { DictOf } from '../../core/i18n/types';
import type tr from './results.tr';

const en: DictOf<typeof tr> = {
  heading: 'Race result',
  sub: '{track} · {laps} laps',
  pos: 'Pos',
  driver: 'Driver',
  team: 'Team',
  time: 'Time / gap',
  best: 'Best lap',
  pit: 'Pit',
  penalty: 'Pen',
  points: 'Pts',
  lapsDown: '+{n} lap',
  penaltySec: '+{s} sec',
  retired: 'Retired',
  dsq: 'Disqualified',
  notClassified: 'Not classified',
  continue: 'Main menu',
  restart: 'Restart',
  provisional: 'Provisional',
  empty: 'No results.',
};

export default en;
