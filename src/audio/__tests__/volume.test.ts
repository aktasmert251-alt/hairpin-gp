// Settings > Audio reach the live mix: master 0 silences at once (all buses sit behind master), and back on restores.
import { describe, expect, it, vi } from 'vitest';
import type { AudioSettings } from '../../contracts/audio';
import { applyLevel, bindVolumes, isSilent, liveVolumes, mediaVolume, volumeGain } from '../volume';

const VOL: AudioSettings = { master: 0.8, engine: 0.9, sfx: 0.8, ambience: 0.6, ui: 0.6 };

function fakeSettings(audio: AudioSettings) {
  let value = { audio };
  const subs = new Set<() => void>();
  return {
    get: () => value,
    subscribe(fn: () => void) { subs.add(fn); return () => { subs.delete(fn); }; },
    setAudio(a: Partial<AudioSettings>) { value = { audio: { ...value.audio, ...a } }; for (const s of subs) s(); },
    listeners: () => subs.size,
  };
}

describe('volume rules', () => {
  it('squares slider values into gains and clamps them', () => {
    expect(volumeGain(0.5)).toBeCloseTo(0.25);
    expect(volumeGain(-1)).toBe(0); expect(volumeGain(2)).toBe(1); expect(volumeGain(Number.NaN)).toBe(0);
  });
  it('a mute (trailer, ?mute) forces master 0 without touching the stored settings', () => {
    expect(liveVolumes(VOL, true)).toEqual({ ...VOL, master: 0 });
    expect(liveVolumes(VOL, false)).toEqual(VOL);
    expect(isSilent({ ...VOL, master: 0 })).toBe(true);
    expect(isSilent(VOL)).toBe(false);
  });
  it('the trailer video follows master: 0 mutes it, a level restores it', () => {
    expect(mediaVolume({ ...VOL, master: 0 })).toEqual({ volume: 0, muted: true });
    expect(mediaVolume(VOL)).toEqual({ volume: volumeGain(0.8), muted: false });
  });
  it('a zero level jumps to silence immediately; other levels glide', () => {
    const p = { cancelScheduledValues: vi.fn(), setValueAtTime: vi.fn(), setTargetAtTime: vi.fn() };
    applyLevel(p as unknown as AudioParam, 0, 3);
    expect(p.cancelScheduledValues).toHaveBeenCalledWith(3);
    expect(p.setValueAtTime).toHaveBeenCalledWith(0, 3);
    expect(p.setTargetAtTime).not.toHaveBeenCalled();
    applyLevel(p as unknown as AudioParam, 0.64, 4);
    expect(p.setTargetAtTime).toHaveBeenCalledWith(0.64, 4, 0.05);
  });
});

describe('bindVolumes (settings -> audio system)', () => {
  it('pushes every settings change live, both directions, and stops on dispose', () => {
    const settings = fakeSettings(VOL);
    const audio = { setVolumes: vi.fn() };
    const bind = bindVolumes(settings, audio, () => false);
    expect(bind.current()).toEqual(VOL);
    settings.setAudio({ master: 0 });
    expect(audio.setVolumes).toHaveBeenLastCalledWith({ ...VOL, master: 0 });
    settings.setAudio({ master: 0.8 });
    expect(audio.setVolumes).toHaveBeenLastCalledWith(VOL);
    settings.setAudio({ sfx: 0 });
    expect(audio.setVolumes).toHaveBeenLastCalledWith({ ...VOL, sfx: 0 });
    // Unrelated settings changes (same audio) do not re-send.
    const n = audio.setVolumes.mock.calls.length;
    settings.setAudio({});
    expect(audio.setVolumes).toHaveBeenCalledTimes(n);
    bind.dispose();
    expect(settings.listeners()).toBe(0);
  });
  it('a temporary mute holds master at 0 even when the slider moves, and lifts back to the setting', () => {
    const settings = fakeSettings(VOL);
    const audio = { setVolumes: vi.fn() };
    let trailer = false;
    const bind = bindVolumes(settings, audio, () => trailer);
    trailer = true; bind.apply();
    expect(audio.setVolumes).toHaveBeenLastCalledWith({ ...VOL, master: 0 });
    settings.setAudio({ master: 0.5 });
    expect(audio.setVolumes).toHaveBeenLastCalledWith({ ...VOL, master: 0 });
    trailer = false; bind.apply();
    expect(audio.setVolumes).toHaveBeenLastCalledWith({ ...VOL, master: 0.5 });
  });
});
