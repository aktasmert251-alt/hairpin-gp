import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseLaunchParams } from '../launchParams';

describe('parseLaunchParams', () => {
  it('parses the §3.7 parameters', () => {
    const p = parseLaunchParams('?mode=race&autostart=1&autodrive=1&laps=1&ai=5&quality=ultra&seed=42&cam=tcam&lang=en&skipLights=1&timescale=2&freeze=1&mute=1&debug=1&nopost=1&s=1200&t=3&weather=heavy&tod=night');
    expect(p).toMatchObject({
      mode: 'race', autostart: true, autodrive: true, laps: 1, ai: 5, quality: 'ultra', seed: 42, cam: 'tcam', lang: 'en',
      skipLights: true, timescale: 2, freeze: true, mute: true, debug: true, nopost: true, s: 1200, t: 3, weather: 'heavy', tod: 'night', scene: null,
    });
  });

  it('rejects invalid values and clamps ranges', () => {
    const p = parseLaunchParams('?mode=nope&ai=99&quality=epic&laps=0&lang=de&cam=drone&seed=abc&autopause=0');
    expect(p.mode).toBe('menu');
    expect(p.ai).toBe(19);
    expect(p.quality).toBeNull();
    expect(p.laps).toBe(1);
    expect(p.lang).toBeNull();
    expect(p.cam).toBeNull();
    expect(p.seed).toBeNull();
    expect(p.autopause).toBe(false);
    expect(parseLaunchParams('').autopause).toBeNull();
    expect(parseLaunchParams('?scene=skeleton').scene).toBe('skeleton');
  });

  it('CR-TRK-4: ?track= accepts race track ids only', () => {
    expect(parseLaunchParams('?track=lombardia').track).toBe('lombardia');
    expect(parseLaunchParams('?track=bosphorus').track).toBe('bosphorus');
    expect(parseLaunchParams('').track).toBeNull();
    expect(parseLaunchParams('?scene=ai&track=oval').track).toBeNull();
  });

  it('CR-NET-4: ?server (ws/wss only), ?room (code, upper-cased), ?name (nickname rule)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const p = parseLaunchParams('?server=wss://apex.example.org/ws&room=xk7pq&name=%20%C5%9Eule%20');
    expect([p.server, p.room, p.name]).toEqual(['wss://apex.example.org/ws', 'XK7PQ', 'Şule']);
    expect(parseLaunchParams('?server=ws://192.168.1.5:8787/ws').server).toBe('ws://192.168.1.5:8787/ws');
    expect(warn).not.toHaveBeenCalled();
    const q = parseLaunchParams('?server=https://x.org&room=AB0CD&name=%3Cscript%3E');
    expect([q.server, q.room, q.name]).toEqual([null, null, null]);
    expect(warn).toHaveBeenCalledTimes(3);
    expect(parseLaunchParams('?server=not a url').server).toBeNull();
    const e = parseLaunchParams('');
    expect([e.server, e.room, e.name]).toEqual([null, null, null]);
    warn.mockRestore();
  });
  describe('invalid values fall back with a warning', () => {
    afterEach(() => vi.restoreAllMocks());

    it('weather=rain, tod, quality, track, cam, tyre, lang -> null + one warning each', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const p = parseLaunchParams('?weather=rain&tod=dusk&quality=epic&track=mars&cam=drone&tyre=slick&lang=de');
      expect([p.weather, p.tod, p.quality, p.track, p.cam, p.tyre, p.lang]).toEqual([null, null, null, null, null, null, null]);
      expect(warn).toHaveBeenCalledTimes(7);
    });

    it('non-numeric laps/ai/seed -> null + warning; empty and valid values stay silent', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const p = parseLaunchParams('?laps=abc&ai=x&seed=nan&timescale=zz');
      expect([p.laps, p.ai, p.seed, p.timescale]).toEqual([null, null, null, 1]);
      expect(warn).toHaveBeenCalledTimes(4);
      warn.mockClear();
      parseLaunchParams('?weather=heavy&tod=night&laps=3&mode=race&track=lombardia');
      parseLaunchParams('');
      expect(warn).not.toHaveBeenCalled();
    });

    it('sandbox scenes keep their own params silently', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      expect(parseLaunchParams('?scene=weather&weather=rain&track=oval').weather).toBeNull();
      expect(warn).not.toHaveBeenCalled();
    });
  });
});
