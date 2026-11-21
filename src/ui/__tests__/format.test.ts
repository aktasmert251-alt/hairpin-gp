// U1: src/ui/format.ts against implementation-handoff step 4, in TR and EN (DESIGN §3.4, §3.6, D-003, D-007).

import { describe, expect, it } from 'vitest';
import { createI18n } from '../../core/i18n/index';
import * as f from '../format';

const MINUS = '−';

function i18nFor(lang: 'tr' | 'en') {
  return createI18n({ lang, syncDocumentLang: false });
}

describe('format: timing values (full stop in both languages)', () => {
  it('lap times are m:ss.mmm', () => {
    expect(f.lapTime(85_612)).toBe('1:25.612');
    expect(f.lapTime(58_204)).toBe('0:58.204');
    expect(f.lapTime(65_318.4)).toBe('1:05.318');
    expect(f.lapTime(0)).toBe(f.EMPTY_LAP);
    expect(f.lapTime(Number.NaN)).toBe(f.EMPTY_LAP);
  });
  it('sectors are ss.mmm, m:ss.mmm from 60 s', () => {
    expect(f.sectorTime(28_412)).toBe('28.412');
    expect(f.sectorTime(9_005)).toBe('9.005');
    expect(f.sectorTime(61_002)).toBe('1:01.002');
    expect(f.sectorTime(0)).toBe(f.EMPTY);
  });
  it('gaps are +s.mmm, +m:ss.mmm from 60 s', () => {
    expect(f.gap(1_204)).toBe('+1.204');
    expect(f.gap(611)).toBe('+0.611');
    expect(f.gap(75_500)).toBe('+1:15.500');
  });
  it('deltas are signed with U+2212 and equal width', () => {
    expect(f.delta(-214)).toBe(`${MINUS}0.214`);
    expect(f.delta(214)).toBe('+0.214');
    expect(f.delta(-214).length).toBe(f.delta(214).length);
    expect(f.delta(0)).toBe('+0.000');
    expect(f.delta(-214)).not.toContain('-');
  });
  it('flashback offset is signed seconds', () => {
    expect(f.signedSec(-4.62)).toBe(`${MINUS}4.6`);
  });
});

describe('format: locale decimals', () => {
  it('TR puts % first and uses a comma', () => {
    expect(f.pct(57.5, 1, 'tr')).toBe('%57,5');
    expect(f.pctOf(0.62, 'tr')).toBe('%62');
    expect(f.pctOf(0, 'tr')).toBe('%0');
    expect(f.km(5349, 'tr')).toBe('5,349');
  });
  it('EN puts % last and uses a full stop', () => {
    expect(f.pct(57.5, 1, 'en')).toBe('57.5%');
    expect(f.pctOf(0.62, 'en')).toBe('62%');
    expect(f.km(5349, 'en')).toBe('5.349');
  });
  it('negative decimals use U+2212', () => {
    expect(f.decimal(-2.5, 1, 'tr')).toBe(`${MINUS}2,5`);
    expect(f.temp(-3)).toBe(`${MINUS}3°C`);
    expect(f.temp(24)).toBe('24°C');
    expect(f.temp(98.4, false)).toBe('98°');
  });
  it('speed is an integer in the chosen units; gear N/R', () => {
    expect(f.speed(287.4, 'kmh')).toBe('287');
    expect(f.speed(100, 'mph')).toBe('62');
    expect(f.gear(0)).toBe('N');
    expect(f.gear(-1)).toBe('R');
    expect(f.gear(7)).toBe('7');
  });
});

describe('format: words through i18n, Turkish casing', () => {
  it('TR: +1 TUR, LİDER, KM/SA, +5 SN', () => {
    const i = i18nFor('tr');
    expect(f.upper(f.lapsDown(1, i.t), 'tr')).toBe('+1 TUR');
    expect(f.upper(i.t('hud.tower.leader'), 'tr')).toBe('LİDER');
    expect(f.upper(i.t('hud.unit.kmh'), 'tr')).toBe('KM/SA');
    expect(f.upper(f.penalty(5, i.t), 'tr')).toBe('+5 SN');
    expect(f.upper(i.t('hud.pit.limiter', { kmh: 80 }), 'tr')).toBe('PİT 80');
  });
  it('EN: +1 LAP, LEADER, KM/H, MPH, +5 SEC', () => {
    const i = i18nFor('en');
    expect(f.upper(f.lapsDown(1, i.t), 'en')).toBe('+1 LAP');
    expect(f.upper(i.t('hud.tower.leader'), 'en')).toBe('LEADER');
    expect(f.upper(i.t('hud.unit.kmh'), 'en')).toBe('KM/H');
    expect(f.upper(i.t('hud.unit.mph'), 'en')).toBe('MPH');
    expect(f.upper(f.penalty(5, i.t), 'en')).toBe('+5 SEC');
  });
  it('tr-TR upper-casing: i → İ, ı → I; English names stay English (D-008)', () => {
    expect(f.upper('en iyi tur', 'tr')).toBe('EN İYİ TUR');
    expect(f.upper('ıslaklık', 'tr')).toBe('ISLAKLIK');
    expect(f.upper('Solaris Racing', 'en')).toBe('SOLARIS RACING');
    expect(f.upper('Elias Norberg', f.langForNat('SE'))).toBe('ELIAS NORBERG');
    expect(f.upper('Kerem Aydın', f.langForNat('TR'))).toBe('KEREM AYDIN');
  });
  it('track name is pre-composed per language (D-003)', () => {
    expect(i18nFor('tr').t('tracks.istanbul')).toBe('İSTANBUL CIRCUIT');
    expect(i18nFor('en').t('tracks.istanbul')).toBe('ISTANBUL CIRCUIT');
  });
  it('notification params: timing numbers are formatted, strings pass through', () => {
    const p = f.formatParams({ code: 'GRA', time: 85_612, delta: -214, n: 2 }, 'tr');
    expect(p).toEqual({ code: 'GRA', time: '1:25.612', delta: `${MINUS}0.214`, n: '2' });
  });
  it('race total time beyond an hour is h:mm:ss.mmm', () => {
    expect(f.raceTime(3_734_512)).toBe('1:02:14.512');
    expect(f.raceTime(85_612)).toBe('1:25.612');
  });
});
