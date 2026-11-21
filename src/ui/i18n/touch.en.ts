// Namespace `touch` (Grafik-UI, mobile 2026-11-21), English.

import type { DictOf } from '../../core/i18n/types';
import type tr from './touch.tr';

const en: DictOf<typeof tr> = {
  rotate: { title: 'Rotate your device', detail: 'HAIRPIN GP plays in landscape.' },
  back: 'Back',
  gas: 'Gas',
  brake: 'Brake',
  left: 'Left',
  right: 'Right',
  drs: 'DRS',
  ers: 'ERS',
  gearUp: 'Gear +',
  gearDown: 'Gear −',
  pit: 'Pit',
  camera: 'Camera',
  mfd: 'MFD',
  pause: 'Pause',
  tiltCenter: 'Centre',
  tiltEnable: 'Enable tilt',
  tiltOff: 'No tilt: use the on-screen wheel',
  settings: {
    section: 'Touch',
    steerMode: 'Steering',
    steerModeValue: { tilt: 'tilt (gyro)', buttons: 'left / right pads', wheel: 'drag wheel' },
    size: 'Control size',
    opacity: 'Control opacity',
    leftHanded: 'Left-handed layout',
    tiltSensitivity: 'Tilt sensitivity',
    tiltDeadzone: 'Tilt deadzone',
    calibrate: 'Centre tilt',
    calibrated: 'centred ({d}°)',
    tiltNeedsHttps: 'tilt needs https',
    pedalSlide: 'Partial gas / brake',
    haptics: 'Vibration',
    test: 'Touch test',
    testValues: 'tilt {a}° · steer {s} · gas {t} · brake {b}',
  },
  desc: {
    steerMode: 'Tilt: turn the phone like a wheel (iPhone asks for permission). Pads: the two pads bottom left. Drag: slide your finger left and right.',
    size: 'Size of the on-screen pads and pedals.',
    leftHanded: 'Pedals move to the left, steering to the right.',
    tilt: 'Sensitivity sets the angle for full lock (1 = 25°); the deadzone ignores small wobbles.',
    calibrate: 'Hold the phone in your driving position and tap: that angle counts as straight.',
    pedalSlide: 'When on, the finger height on a pedal sets the amount (bottom 30 %, top 100 %).',
    haptics: 'A short buzz on kerbs and contact (phones that support it).',
  },
  online: {
    phoneHost: 'Hosting a room on a phone can be slow; a computer is recommended. The screen is kept on.',
    copy: 'Copy',
    share: 'Share',
    paste: 'Paste',
    copied: 'Copied',
  },
};

export default en;
