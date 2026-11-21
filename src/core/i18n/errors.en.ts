import type tr from './errors.tr';
import type { DictOf } from './types';

const en: DictOf<typeof tr> = {
  noWebgl2: 'This browser does not support WebGL2. HAIRPIN GP needs an up-to-date Chrome, Edge or Firefox.',
  contextLost: 'The graphics context was lost.',
  reload: 'Press Enter to reload',
  session: 'Something went wrong: {message}',
};

export default en;
