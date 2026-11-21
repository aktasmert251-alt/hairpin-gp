import type tr from './notify.tr';
import type { DictOf } from '../../../core/i18n/types';

const en: DictOf<typeof tr> = {
  start: {
    jumpStart: { title: 'JUMP START', chip: '+{s} SEC' },
  },
  limits: {
    warning: { title: 'TRACK LIMITS {n}/3', detail: 'T{corner}' },
    blackWhite: { title: 'BLACK AND WHITE FLAG', detail: 'NEXT OFFENCE PENALISED' },
  },
  penalty: {
    trackLimits: { title: 'PENALTY · TRACK LIMITS', chip: '+{s} SEC' },
    cornerCut: { title: 'PENALTY · CORNER CUTTING', chip: '+{s} SEC' },
    pitSpeeding: { title: 'PENALTY · PIT LANE SPEEDING', chip: '+{s} SEC' },
    twoCompound: { title: 'PENALTY · TWO-COMPOUND RULE', chip: '+{s} SEC' },
    collision: { title: 'PENALTY · CAUSING A COLLISION', chip: '+{s} SEC' },
    safetyCar: { title: 'PENALTY · OVERTAKING UNDER THE SAFETY CAR', chip: '+{s} SEC' },
    served: { title: 'PENALTY SERVED', detail: '{s} SEC' },
    pending: { title: 'PENALTY TO SERVE', detail: '{s} SEC' },
  },
  lap: {
    invalid: { title: 'LAP INVALID', detail: '{reason}' },
    personalBest: { title: 'PERSONAL BEST', detail: '{time} · {delta}' },
    fastest: { title: 'FASTEST LAP', detail: '{code} · {time}' },
    final: { title: 'FINAL LAP' },
  },
  flag: {
    yellow: { title: 'YELLOW FLAG', detail: 'SECTOR {sector}' },
    blue: { title: 'BLUE FLAG', detail: 'CAR BEHIND: {code}' },
    chequered: { title: 'CHEQUERED FLAG' },
  },
  drs: {
    enabled: { title: 'DRS ENABLED' },
    disabled: { title: 'DRS DISABLED' },
  },
  weather: {
    rainSoon: { title: 'RAIN IN {min} MIN', detail: '{p}% CHANCE' },
    rainStarted: { title: 'RAIN STARTED' },
    drying: { title: 'TRACK DRYING' },
    intersNow: { title: 'BOX THIS LAP', detail: 'FOR INTERS' },
    wetsNow: { title: 'BOX THIS LAP', detail: 'FOR WETS' },
    slicksNow: { title: 'BOX THIS LAP', detail: 'FOR SLICKS' },
  },
  pit: {
    requested: { title: 'BOX REQUESTED', detail: '{compound}' },
    cancelled: { title: 'BOX CANCELLED' },
    limiter: { title: 'PIT LIMITER' },
    stopTime: { title: 'PIT STOP', detail: '{s} SEC' },
  },
  car: {
    reset: { title: 'CAR RESET TO TRACK' },
  },
  collision: {
    warning: { title: 'WARNING · COLLISION', detail: 'NEXT ONE IS A PENALTY' },
  },
  sc: {
    deployed: { title: 'SAFETY CAR DEPLOYED', detail: 'HOLD POSITION · NO OVERTAKING' },
    ending: { title: 'SAFETY CAR IN THIS LAP', detail: 'GET READY' },
    restart: { title: 'GREEN FLAG', detail: 'RACE RESTARTED' },
  },
  net: {
    notice: { title: 'SERVER NOTICE', detail: '{text}' },
  },
  p2p: {
    hostPaused: { title: 'HOST ON HOLD', detail: 'HOST TAB IN BACKGROUND · ITS CAR MAY STOP' },
    hostResumed: { title: 'HOST IS BACK' },
    hostWasHidden: { title: 'TAB WAS IN THE BACKGROUND', detail: 'KEEP THE TAB IN FRONT WHILE HOSTING' },
  },
  quality: {
    lowered: { title: 'GRAPHICS LOWERED', detail: 'LOW FRAME RATE · {q}' },
  },
  flashback: {
    used: { title: 'FLASHBACK USED', detail: '{left} LEFT' },
    none: { title: 'NO FLASHBACKS LEFT' },
  },
  racingLine: {
    mode: { title: 'RACING LINE: {mode}' },
  },
  settings: {
    modifierRefused: { title: 'CTRL, ALT AND META CANNOT BE BOUND' },
  },
  error: {
    runtime: { title: 'SOMETHING WENT WRONG', detail: 'GAME CONTINUES' },
  },
  reason: {
    trackLimits: 'TRACK LIMITS',
    cornerCut: 'CORNER CUTTING',
    flashback: 'FLASHBACK',
    reset: 'CAR RESET',
    wrongWay: 'WRONG WAY',
  },
  compound: {
    soft: 'SOFT',
    medium: 'MEDIUM',
    hard: 'HARD',
    inter: 'INTER',
    wet: 'WET',
  },
  lineMode: {
    off: 'OFF',
    corners: 'CORNERS',
    full: 'FULL',
  },
};

export default en;
