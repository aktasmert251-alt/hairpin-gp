// Volume rules shared by the live mix and the trailer video. Settings sliders are linear 0..1; gains are squared (a
// perceptual taper). Master 0 means silence: every bus sits behind master, and the master gain jumps to 0 at once.
import type { AudioSettings } from '../contracts/audio';

const clamp01 = (x: number): number => (Number.isFinite(x) ? (x < 0 ? 0 : x > 1 ? 1 : x) : 0);

/** Slider value → gain. */
export function volumeGain(x: number): number { return clamp01(x) ** 2; }

/** The volumes the mix should use now: the settings, with master forced to 0 while something mutes the game. */
export function liveVolumes(v: AudioSettings, muted: boolean): AudioSettings {
  return muted ? { ...v, master: 0 } : { ...v };
}

/** True when nothing may be heard. */
export function isSilent(v: AudioSettings): boolean { return volumeGain(v.master) === 0; }

/** A media element (the trailer video) follows the master volume; master 0 mutes it outright. */
export function mediaVolume(v: AudioSettings): { volume: number; muted: boolean } {
  const volume = volumeGain(v.master);
  return { volume, muted: volume === 0 };
}

/** Sets a gain param: a glide to non-zero levels, an immediate jump to 0 (silence must not lag). */
export function applyLevel(p: AudioParam, gain: number, t: number, tau = 0.05): void {
  if (gain === 0) {
    p.cancelScheduledValues(t);
    p.setValueAtTime(0, t);
  } else p.setTargetAtTime(gain, t, tau);
}

interface VolumeSource { get(): { audio: AudioSettings }; subscribe(fn: () => void): () => void }
interface VolumeSink { setVolumes(v: AudioSettings): void }

/**
 * Keeps the audio system on the settings: every settings change (menus, races, the pause screen) reaches setVolumes,
 * with master forced to 0 while `muted()` (trailer playing, ?mute launch). Call `apply()` when `muted()` changes.
 */
export function bindVolumes(settings: VolumeSource, audio: VolumeSink, muted: () => boolean): { current(): AudioSettings; apply(): void; dispose(): void } {
  const current = (): AudioSettings => liveVolumes(settings.get().audio, muted());
  let applied = JSON.stringify(current());
  const apply = (): void => {
    const v = current();
    const key = JSON.stringify(v);
    if (key === applied) return;
    applied = key;
    audio.setVolumes(v);
  };
  const off = settings.subscribe(apply);
  return { current, apply, dispose: off };
}
