// Settings > Audio > Sound on/off. Off = master 0 (the one switch that silences every bus, the trailer and UI sounds);
// the level before switching off is remembered per device so on restores it. Survives reloads with the settings.
export const LAST_MASTER_KEY = 'apexgp:v1:lastMaster';
export const DEFAULT_MASTER = 0.8;
interface Kv { getItem(key: string): string | null; setItem(key: string, value: string): void }
const local = (): Kv | undefined => { try { return globalThis.localStorage; } catch { return undefined; } };
let memory: number | null = null;

/** The master value to store for the toggle state `on`, given the current master. */
export function soundToggleMaster(on: boolean, current: number, storage: () => Kv | undefined = local): number {
  if (!on) {
    if (current > 0) {
      memory = current;
      try { storage()?.setItem(LAST_MASTER_KEY, String(current)); } catch { /* memory only */ }
    }
    return 0;
  }
  if (current > 0) return current;
  let last = memory;
  try { const raw = Number(storage()?.getItem(LAST_MASTER_KEY)); if (raw > 0 && raw <= 1) last = raw; } catch { /* memory only */ }
  return last !== null && last > 0 && last <= 1 ? last : DEFAULT_MASTER;
}

/** Test hook. */
export function resetSoundToggleMemory(): void { memory = null; }
