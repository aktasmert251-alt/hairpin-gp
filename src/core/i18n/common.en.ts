import type tr from './common.tr';
import type { DictOf } from './types';

const en: DictOf<typeof tr> = {
  keys: {
    Space: 'Space',
    Enter: 'Enter',
    NumpadEnter: 'Num Enter',
    Escape: 'Esc',
    Backspace: 'Backspace',
    Tab: 'Tab',
    ShiftLeft: 'Left Shift',
    ShiftRight: 'Right Shift',
    CapsLock: 'Caps Lock',
    Delete: 'Del',
    Insert: 'Ins',
    Home: 'Home',
    End: 'End',
    PageUp: 'Page Up',
    PageDown: 'Page Down',
  },
  units: {
    kmh: 'km/h',
    mph: 'mph',
  },
  sandbox: {
    title: 'Sandbox scenes',
    unknown: 'No scene named "{id}".',
    hint: 'Add ?scene=<id> to the address to open a scene.',
  },
  raceLogic: {
    header: '{phase} · race {time} · lights {lit}{out} · yellow {yellow} · DRS {drs}',
    on: 'on',
    off: 'off',
    out: ' (out)',
    cols: 'P|No|Code|Lap|Gap|Last|Best|Pen|TL|Status|Flag|Pit|Stops',
    events: 'Events',
  },
  weatherScene: {
    header: 'Weather {preset} · seed {seed} · {laps} laps ({min} min) · air {air} °C · track {track} °C',
    legend: 'rain|cloud|wetness|racing line|forecast +10 min (rain)',
    time: '{min} min',
  },
  debug: {
    fps: 'FPS {fps} · p95 {p95} ms',
    sim: 'Tick {tick} · overrun {overrun}',
    car: '{kmh} km/h · gear {gear} · s {s} m',
  },
};

export default en;
