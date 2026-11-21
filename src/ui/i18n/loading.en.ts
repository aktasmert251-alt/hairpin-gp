// Namespace `loading` (Grafik-UI), English.

import type { DictOf } from '../../core/i18n/types';
import type tr from './loading.tr';

const en: DictOf<typeof tr> = {
  heading: 'Loading',
  tip: 'Tip',
  stage: 'Loading · {p}',
  mode: { race: 'quick race', timeTrial: 'time trial' },
  tips: {
    gears: 'Shift up and down with E and Q.',
    camera: 'Press C to change the camera.',
    pause: 'Press Esc or P to pause the game.',
    drs: 'In a DRS zone within one second of the car ahead, Space opens the rear wing.',
    ers: 'Pick the ERS mode on the Tab display; when overtaking, F gives you extra power.',
    flashback: 'Made a mistake? R rewinds the last few seconds.',
    mfd: 'Tab cycles through the strategy, ERS, brakes, weather and tyre pages.',
    limits: 'If all four wheels leave the white line, the lap is invalidated.',
    tyres: 'Softs are fast but wear quickly; hards last much longer.',
    brake: 'Brake in a straight line before the corner, then turn in.',
    rain: 'Switch to inters when the track gets wet; full wets are only quicker when it is soaked.',
    hud: 'Press H to cycle the HUD between full, minimal and off.',
    line: 'Press Y to cycle the racing line between off, corners and full.',
    pitLimiter: 'The pit lane limit is 80 km/h; remember to switch the limiter on with L.',
  },
};

export default en;
