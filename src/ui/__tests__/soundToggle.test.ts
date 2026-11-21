import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_MASTER, LAST_MASTER_KEY, resetSoundToggleMemory, soundToggleMaster } from '../soundToggle';
import { migrateSettings } from '../../core/settings/SettingsStore';

function memoryStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, map: m };
}

describe('Settings > Audio > Sound on/off', () => {
  beforeEach(() => resetSoundToggleMemory());
  it('off sets master 0 and remembers the level; on restores it', () => {
    const s = memoryStorage();
    expect(soundToggleMaster(false, 0.55, () => s)).toBe(0);
    expect(s.map.get(LAST_MASTER_KEY)).toBe('0.55');
    expect(soundToggleMaster(true, 0, () => s)).toBe(0.55);
  });
  it('restores after a reload (new memory) from storage, and falls back to the default', () => {
    const s = memoryStorage();
    soundToggleMaster(false, 0.3, () => s);
    resetSoundToggleMemory();
    expect(soundToggleMaster(true, 0, () => s)).toBe(0.3);
    resetSoundToggleMemory();
    expect(soundToggleMaster(true, 0, () => undefined)).toBe(DEFAULT_MASTER);
    const broken = { getItem: (): string | null => { throw new Error('denied'); }, setItem: (): void => { throw new Error('denied'); } };
    expect(soundToggleMaster(false, 0.4, () => broken)).toBe(0);
    expect(soundToggleMaster(true, 0, () => broken)).toBe(0.4);
  });
  it('on keeps a non-zero master; off at 0 keeps the earlier remembered level', () => {
    const s = memoryStorage();
    expect(soundToggleMaster(true, 0.7, () => s)).toBe(0.7);
    soundToggleMaster(false, 0.6, () => s);
    expect(soundToggleMaster(false, 0, () => s)).toBe(0);
    expect(soundToggleMaster(true, 0, () => s)).toBe(0.6);
  });
  it('master 0 survives a settings reload (the stored 0 is kept, not reset to the default)', () => {
    const saved = JSON.parse(JSON.stringify(migrateSettings({ version: 1, audio: { master: 0 } }))) as unknown;
    expect(migrateSettings(saved).audio.master).toBe(0);
  });
});
