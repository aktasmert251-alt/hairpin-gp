// URL parameters (§3.7), parsed once at boot into LaunchParams. Invalid values become null / defaults.
// Scene-only params are not LaunchParams: `pitLap=<n>` works only in `?scene=race-logic` (QC2-18); in a race, box the
// player through the MFD (Tab, then 1) or `__APEX__.input.press('mfdNext')` + `press('mfd1')`.

import type { Compound, Lang, QualityId, TimeOfDay, WeatherPreset } from '../contracts/common';
import type { LaunchParams } from '../contracts/debug';
import type { ViewId } from '../contracts/render';
import type { RaceTrackId } from '../contracts/track';
import { RACE_TRACKS } from '../data/tracks';
import { isRoomCode, normalizeName } from '../net/protocol';

const WEATHER: readonly WeatherPreset[] = ['dry', 'light', 'heavy', 'variable'];
const TOD: readonly TimeOfDay[] = ['day', 'sunset', 'night'];
const QUALITY: readonly QualityId[] = ['low', 'medium', 'high', 'ultra'];
const CAMS: readonly ViewId[] = ['cockpit', 'tcam', 'nose', 'chaseNear', 'chaseFar', 'tv', 'orbit', 'free', 'trailer'];
const LANGS: readonly Lang[] = ['tr', 'en'];
const TYRES: readonly Compound[] = ['soft', 'medium', 'hard', 'inter', 'wet'];

/** Invalid values warn once per call (not for sandbox scenes, which read their own params, e.g. `weather=rain`). */
let quiet = false;
function warn(name: string, v: string): void {
  if (!quiet) console.warn(`[apex] invalid ?${name}=${v}; using the default`);
}

function pick<T extends string>(name: string, v: string | null, allowed: readonly T[]): T | null {
  if (v === null) return null;
  if ((allowed as readonly string[]).includes(v)) return v as T;
  warn(name, v);
  return null;
}

function flag(v: string | null): boolean {
  return v === '1' || v === 'true' || v === '';
}

function int(name: string, v: string | null, lo: number, hi: number): number | null {
  if (v === null || v.trim() === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n)) {
    warn(name, v);
    return null;
  }
  return Math.min(hi, Math.max(lo, Math.round(n)));
}

function num(name: string, v: string | null, lo: number, hi: number): number | null {
  if (v === null || v.trim() === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n)) {
    warn(name, v);
    return null;
  }
  return Math.min(hi, Math.max(lo, n));
}

export function parseLaunchParams(search: string | URLSearchParams): LaunchParams {
  const p = typeof search === 'string' ? new URLSearchParams(search) : search;
  quiet = !!p.get('scene');
  const mode = p.get('mode');
  if (mode !== null && mode !== 'tt' && mode !== 'race' && mode !== 'menu') warn('mode', mode);
  const autopause = p.get('autopause');
  return {
    scene: p.get('scene') || null,
    mode: mode === 'tt' || mode === 'race' ? mode : 'menu',
    autostart: flag(p.get('autostart')),
    autodrive: flag(p.get('autodrive')),
    weather: pick('weather', p.get('weather'), WEATHER),
    tod: pick('tod', p.get('tod'), TOD),
    // Any lap count 1..99 is accepted (E2E uses laps=1); the menu offers 3/5/10/15/29.
    laps: int('laps', p.get('laps'), 1, 99),
    ai: int('ai', p.get('ai'), 0, 19),
    difficulty: int('difficulty', p.get('difficulty'), 0, 110),
    quality: pick('quality', p.get('quality'), QUALITY),
    seed: int('seed', p.get('seed'), -2147483648, 2147483647),
    cam: pick('cam', p.get('cam'), CAMS),
    lang: pick('lang', p.get('lang'), LANGS),
    team: p.get('team') || null,
    tyre: pick('tyre', p.get('tyre'), TYRES),
    grid: int('grid', p.get('grid'), 1, 20),
    skipLights: p.has('skipLights') ? flag(p.get('skipLights')) : false,
    timescale: num('timescale', p.get('timescale'), 0, 8) ?? 1,
    freeze: p.has('freeze') ? flag(p.get('freeze')) : false,
    mute: p.has('mute') ? flag(p.get('mute')) : false,
    debug: p.has('debug') ? flag(p.get('debug')) : false,
    nopost: p.has('nopost') ? flag(p.get('nopost')) : false,
    s: num('s', p.get('s'), -1e6, 1e6),
    t: num('t', p.get('t'), 0, 3600),
    autopause: autopause === null ? null : flag(autopause),
    record: p.has('record') ? flag(p.get('record')) : false,
    track: trackParam(p),
    server: serverParam(p.get('server')),
    room: checked('room', p.get('room'), (v) => (isRoomCode(v.toUpperCase()) ? v.toUpperCase() : null)),
    name: checked('name', p.get('name'), normalizeName),
  };
}

/** Runs `f` on a given value; null (with a warning) when it rejects it. */
function checked(name: string, v: string | null, f: (v: string) => string | null): string | null {
  if (v === null) return null;
  const r = f(v);
  if (r === null) warn(name, v);
  return r;
}

/** CR-NET-4: `?server=` must be a ws:// or wss:// URL. */
function serverParam(v: string | null): string | null {
  return checked('server', v, (s) => {
    try {
      const u = new URL(s);
      return u.protocol === 'ws:' || u.protocol === 'wss:' ? u.href : null;
    } catch {
      return null;
    }
  });
}

/** CR-TRK-4: `?track=<RaceTrackId>`; anything else → null with a warning (sandbox scenes read their own `track`, e.g. 'oval'). */
function trackParam(p: URLSearchParams): RaceTrackId | null {
  const v = p.get('track');
  return pick('track', v, RACE_TRACKS);
}
